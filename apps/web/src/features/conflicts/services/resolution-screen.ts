import { collisionKeyOf, deriveShiftTimes, leaveBalanceOf, leaveCostOf, shiftTypeVersionOn, type Collision } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { dayDetailOf } from '@/features/calendar/utils/day-detail';
import { MODE_SVE, calendarTodayOf, dayMonthOf, type CalendarSearch } from '@/features/calendar/utils/month';
import {
  replacementCandidatesOf,
  type CandidateGroup,
  type CandidateGroupKind,
  type ReplacementCandidate,
} from '@/features/calendar/utils/replacement-candidates';
import {
  liveResolutionsOf,
  queueOrderOf,
  queueReadFailed,
  unresolvedOf,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
import { heldByReplacement } from '@/features/conflicts/services/replacement-effect';
import { ACCEPT_UNCOVERED, REPLACE_MEMBER } from '@/features/conflicts/services/resolutions';
import { durationMessageKey, durationValuesOf, type DurationValues } from '@/features/hour-bands/services/list';
import {
  organizationLeaveRecordsOf,
  type LeaveRecord,
  type OrganizationLeaveRecord,
} from '@/features/leave/services/leave-list';
import {
  AMEND_ENDS,
  AMEND_REMOVES,
  AMEND_STARTS,
  LEAVE_AMEND_ACTION,
  LEAVE_LOADING,
  LEAVE_PREVIEW_READY,
  LEAVE_READY,
  LEAVE_REMOVE_ACTION,
  amendTargetOf,
  leavePreviewStateOf,
  leaveRangeValuesOf,
  memberLeaveBaseOf,
  type LeaveHandoff,
  type ResolutionAmendKind,
  type ResolutionAmendTarget,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
  type LeaveRecordsInput,
} from '@/features/leave/services/leave-section';
import { positionsShown, rosterPositionMessageKey } from '@/features/members/utils/position';
import { ranksShown, rosterRankMessageKey } from '@/features/members/utils/rank';

/**
 * One conflict's resolution screen (story 5.4b; CAP-16, UX-DR10, UX-DR11,
 * UX-DR28, UX-DR29), as a pure view model in a `.ts` that renders nothing
 * (AD-15). The hook only wires the reads and the write; the node suite
 * executes this.
 *
 * THE SAME UNRESOLVED SET AS THE QUEUE. The conflict is found among
 * *Raspored*'s own derivation — `unresolvedOf` over the calendar's one
 * snapshot, the organization's live leave and its live resolutions — in the
 * queue's own order (`queueOrderOf`), so `K od N` and ‹ › are exactly the
 * queue's rows. A conflict that is not among them — already resolved, a URL
 * that names nothing, or a member no longer on leave that date — is
 * {@link RESOLUTION_MISSING}: the screen says it is no longer open, and links
 * back. Nothing here decides whether a collision exists; the domain does.
 *
 * THE FACTS AND THE STRIP are read off the same answers: the shift type and
 * its times on the date, the team, the absent member with rank and position
 * (information only, never used), the causing record's range and what it
 * costs, and who else works that day, from the day detail's roster
 * (`dayDetailOf`) less every member on live leave that date. The strip's
 * three terms are coverage (`covered of total`, the roster with and without
 * the members on leave), the absent member's leave in days (the conflict's
 * date as *Godišnji* charges it, `leaveCostOf` over that one date: `1 dan
 * godišnjeg` — leave is counted in days, never hours, human 2026-10-10) and
 * the balance, which accepting
 * leaves unchanged — `leaveBalanceOf` through the member card's own recipe
 * (`memberLeaveBaseOf`).
 *
 * AMENDING THE LEAVE (story 5.4d) is the third card, and writes nothing. It
 * states the range that would clear this conflict (rule A, human,
 * 2026-10-02: a date before the record's end moves its start to the day
 * after; its last day moves its end to the day before; a one-day record is
 * removed) — a computation, never a recommendation — and its strip reads the
 * coverage one higher with the absent member working, the shift's hours as
 * work, and the balance in the conflict date's leave year once those days are
 * given back. Its Spremi hands that range to the member page's own amend or
 * removal (`amendHandoffOf`); the conflict clears by derivation once that
 * amend is saved (5.4a).
 *
 * REPLACING (story 5.4c) is the second card. Its candidates are
 * `replacementCandidatesOf`'s three groups for the conflict's team and date,
 * over the same snapshot and leave; its strip reads the coverage one higher
 * (`covered + 1 of total`), never "Nepokriveno", and the same hours and
 * balance as the first card — the replacement's override only adds, so the
 * absent member stays rostered on leave (human, 2026-10-02).
 *
 * A KEY STILL HELD (story 5.5d). A conflict back among the unresolved
 * because the snapshot holds its `replace_member` resolution's override
 * pending after a rotation save, or inert, still has that live row holding
 * 0031's key, so no new decision can be saved on it until the override is
 * removed in the calendar, which 0033 makes end the resolution too.
 * {@link ResolutionView.held} says so: the screen states it as Spremi's hint,
 * with the way to that day in the calendar, and Spremi waits.
 *
 * NEVER A PARTIAL SCREEN. A read that failed or is paused offline, a row that
 * cannot be trusted, and any `RangeError` of a derivation make the screen
 * unavailable, logged, with a retry.
 */

/** Still waiting on a read: the skeleton. */
export const RESOLUTION_LOADING = 'loading';
/** A read failed, or what it answered breaches a rule: one alert with a retry. */
export const RESOLUTION_UNAVAILABLE = 'unavailable';
/** The conflict is not among the unresolved: the screen says so and links back. */
export const RESOLUTION_MISSING = 'missing';
/** Everything read: the facts, the choice and the strip. */
export const RESOLUTION_READY = 'ready';

/** Story 5.4b's outcome, as the radio group's value: fixed position 1. */
export const OPTION_ACCEPT_UNCOVERED = 'accept-uncovered';

/** Story 5.4c's outcome: fixed position 2. */
export const OPTION_REPLACE_MEMBER = 'replace-member';

/** Story 5.4d's outcome: fixed position 3. It records no resolution; it opens the leave amend. */
export const OPTION_AMEND_LEAVE = 'amend-leave';

/** The radio group's value while nothing is chosen: Radix's own "none". */
export const NO_OPTION = '';

/** The outcomes, in their fixed order. */
export const RESOLUTION_OPTIONS = [OPTION_ACCEPT_UNCOVERED, OPTION_REPLACE_MEMBER, OPTION_AMEND_LEAVE] as const;

export type ResolutionOption = (typeof RESOLUTION_OPTIONS)[number];

/** The id the choice's heading carries, which names the radio group. */
export const RESOLUTION_CHOICE_HEADING_ID = 'resolution-choice';

/** The ids that name and describe the first card: its title, its sentence and its strip. */
export const RESOLUTION_ACCEPT_TITLE_ID = 'resolution-accept-title';
export const RESOLUTION_ACCEPT_BODY_ID = 'resolution-accept-body';
export const RESOLUTION_ACCEPT_STRIP_ID = 'resolution-accept-strip';
/** The card's description: its sentence, then its strip. */
export const RESOLUTION_ACCEPT_DESCRIBED_BY = `${RESOLUTION_ACCEPT_BODY_ID} ${RESOLUTION_ACCEPT_STRIP_ID}`;

/** The same three for the second card (story 5.4c). */
export const RESOLUTION_REPLACE_TITLE_ID = 'resolution-replace-title';
export const RESOLUTION_REPLACE_BODY_ID = 'resolution-replace-body';
export const RESOLUTION_REPLACE_STRIP_ID = 'resolution-replace-strip';
export const RESOLUTION_REPLACE_DESCRIBED_BY = `${RESOLUTION_REPLACE_BODY_ID} ${RESOLUTION_REPLACE_STRIP_ID}`;

/** The same three for the third card (story 5.4d). */
export const RESOLUTION_AMEND_TITLE_ID = 'resolution-amend-title';
export const RESOLUTION_AMEND_BODY_ID = 'resolution-amend-body';
export const RESOLUTION_AMEND_STRIP_ID = 'resolution-amend-strip';
export const RESOLUTION_AMEND_DESCRIBED_BY = `${RESOLUTION_AMEND_BODY_ID} ${RESOLUTION_AMEND_STRIP_ID}`;

/** The id the candidate picker's heading carries, which names its own radio group (story 5.4c). */
export const RESOLUTION_CANDIDATES_HEADING_ID = 'resolution-candidates';

/** The id one candidate group's heading carries, which names that group. */
export function candidateGroupHeadingId(kind: CandidateGroupKind): string {
  return `resolution-candidates-${kind}`;
}

/** The candidate picker's value while nobody is chosen: Radix's own "none". */
export const NO_CANDIDATE = '';
/** The id the save hint carries, which describes the save button. */
export const RESOLUTION_SAVE_HINT_ID = 'resolution-save-hint';

/** The conflict a resolution screen is opened for: the route's three params. */
export interface ResolutionParams {
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
}

/** An adjacent conflict, for ‹ and ›: where it goes, and the date its label names. */
export interface ResolutionLink extends ResolutionParams {
  /** `01.10.` */
  readonly dayMonth: string;
}

/** A duration as `t()` renders it: `12 h`. */
export interface ResolutionHours {
  readonly key: ReturnType<typeof durationMessageKey>;
  readonly values: DurationValues;
}

/** The outcomes a landed decision can name on the queue: stories 5.4b and 5.4c. */
export type ResolutionSavedKind = typeof ACCEPT_UNCOVERED | typeof REPLACE_MEMBER;

/** What every landed decision names on the queue: the shift, the date and the member, as shown. */
interface ResolutionSavedFacts {
  readonly shiftTypeName: string;
  readonly teamName: string;
  readonly dateShown: string;
  readonly memberName: string;
}

/**
 * What a landed decision names on the queue (stories 5.4b, 5.4c): the
 * outcome and the facts, and for a replacement the replacement's name.
 */
export type ResolutionSaved =
  | (ResolutionSavedFacts & { readonly kind: typeof ACCEPT_UNCOVERED })
  | (ResolutionSavedFacts & { readonly kind: typeof REPLACE_MEMBER; readonly replacementName: string });

// THE DATE RULE lives beside the leave card that re-applies it on arrival (story 5.4d).
export {
  AMEND_ENDS,
  AMEND_REMOVES,
  AMEND_STARTS,
  amendTargetOf,
  type ResolutionAmendKind,
  type ResolutionAmendTarget,
} from '@/features/leave/services/leave-section';

/** The third card's figures (story 5.4d): the target, the date it names, and the balance once it is saved. */
export interface ResolutionAmend {
  readonly target: ResolutionAmendTarget;
  /** `03.10.`, the date the card and the hint name: the new start or the new end; `null` for a removal. */
  readonly dateShown: string | null;
  /** The balance after it, in the conflict date's leave year. */
  readonly balanceDays: number;
  /** What it gives back: the balance after it less the balance now. */
  readonly gainedDays: number;
}

/**
 * The third card's figures for `record` and the conflict's `date`, over the
 * member's balance input. Both balances are the conflict date's leave year,
 * as the other cards'; the amend's is `leavePreviewStateOf`'s, against every
 * record but this one, and a removal's is the balance without it.
 *
 * @throws RangeError on {@link amendTargetOf}'s, or when the domain will not cost the new range.
 */
export function resolutionAmendOf(input: LeaveRecordsInput, record: LeaveRecord, date: string): ResolutionAmend {
  const target = amendTargetOf(record, date);
  const inYear = { ...input, today: date };
  const before = leaveBalanceOf(inYear).balanceDays;
  let after: number;

  if (target.kind === AMEND_REMOVES) {
    after = leaveBalanceOf({ ...inYear, records: input.records.filter((one) => one.id !== record.id) }).balanceDays;
  } else {
    const preview = leavePreviewStateOf(inYear, target.range.from, target.range.to, record);

    if (preview.kind !== LEAVE_PREVIEW_READY) throw new RangeError(`the amend of ${record.id} cannot be costed: ${preview.reason}`);

    after = preview.preview.balanceAfterDays;
  }

  return {
    target,
    dateShown:
      target.kind === AMEND_STARTS
        ? dayMonthOf(target.range.from)
        : target.kind === AMEND_ENDS
          ? dayMonthOf(target.range.to)
          : null,
    balanceDays: after,
    gainedDays: after - before,
  };
}

/** The screen, ready to render. */
export interface ResolutionView {
  readonly key: string;
  /** How many unresolved conflicts there are: the queue's count. */
  readonly count: number;
  /** This conflict's place in the queue's order, from 1. */
  readonly position: number;
  readonly previous: ResolutionLink | null;
  readonly next: ResolutionLink | null;
  readonly shiftTypeName: string;
  /** `07:00–19:00`, or `null` for a working type with no times on the date. */
  readonly times: string | null;
  readonly teamName: string;
  /** `četvrtak 10.09.2026`: the day detail's own wording. */
  readonly dateShown: string;
  readonly memberName: string;
  /** The rank's label key, or `null` when none is shown. */
  readonly rankKey: ReturnType<typeof rosterRankMessageKey>;
  /** The position's label key, or `null` when none is shown. */
  readonly positionKey: ReturnType<typeof rosterPositionMessageKey>;
  /** The causing record's range, as the member's leave card writes it. */
  readonly leaveFrom: string;
  readonly leaveTo: string;
  /** What that record costs, in days. */
  readonly leaveCostDays: number;
  /** The team's members who work that day: the roster less every member on live leave, by name. */
  readonly coworkers: readonly string[];
  /** The roster on that date. */
  readonly total: number;
  /** The roster less every member on live leave that date. */
  readonly covered: number;
  /** The shift's duration, as the hours the third card has the absent member work; `null` when the shift has no times. */
  readonly shiftHours: ResolutionHours | null;
  /**
   * The conflict's date as leave, in days: what *Godišnji* charges for it
   * (`leaveCostOf` over the one date), the first two cards' leave term.
   */
  readonly leaveDays: number;
  /** The absent member's balance in the leave year that holds the conflict's date, which neither outcome changes. */
  readonly balanceDays: number;
  /** Who may be put on the shift (story 5.4c): the three groups, in their fixed order, each by name. */
  readonly candidates: readonly CandidateGroup[];
  /** Whether rank and position are shown beside a candidate: where the organization uses them. */
  readonly rankShown: boolean;
  readonly positionShown: boolean;
  /** The coverage once someone is put on: {@link covered} + 1. */
  readonly replaceCovered: number;
  /** `02.10.`, the conflict's date as the third card's sentence names it (story 5.4d). */
  readonly dayMonth: string;
  /** The causing record, which the third card hands to the member page. */
  readonly leaveRecordId: string;
  /** The third card's target and figures (story 5.4d). */
  readonly amend: ResolutionAmend;
  /**
   * Whether a live resolution still holds this conflict's key although it is
   * unresolved (story 5.5d): a replacement whose override no longer applies.
   * The screen says to remove the override in the calendar and decide again;
   * a save refused on the key says the same.
   */
  readonly held: boolean;
  /** Where the held line's "Ukloni je u kalendaru" goes: the grid on the conflict's month, narrowed to its team. */
  readonly heldCalendar: CalendarSearch;
  /** The insert's columns: the organization and the key. */
  readonly organizationId: string;
  /** What the queue's status line names once an acceptance lands; a replacement adds its name ({@link replacedSavedOf}). */
  readonly saved: Extract<ResolutionSaved, { readonly kind: typeof ACCEPT_UNCOVERED }>;
}

export type ResolutionScreen =
  | { readonly kind: typeof RESOLUTION_LOADING }
  | { readonly kind: typeof RESOLUTION_UNAVAILABLE }
  | { readonly kind: typeof RESOLUTION_MISSING; readonly count: number }
  | { readonly kind: typeof RESOLUTION_READY; readonly view: ResolutionView };

/** The five reads the screen stands on: the queue's three, and the member card's two for the balance. */
export interface ResolutionSources {
  readonly calendar: CalendarSurfaceState;
  readonly records: LeaveRowsAnswer;
  readonly resolutions: LeaveRowsAnswer;
  /** The member list: the allowance. */
  readonly members: LeaveMembersSource;
  /** The organization snapshot: where the leave year begins. */
  readonly organization: LeaveOrganizationSource;
  /** Whether a failed read is being read again ({@link refetchingAfterFailure}): loading, never the alert. */
  readonly refetching?: boolean;
}

/** TanStack Query's names for a fetch in flight, and one it has not started (offline). */
const FETCH_FETCHING = 'fetching';
const FETCH_PAUSED = 'paused';

/** Whether the member list failed, is paused offline, or settled with nothing: the balance's allowance. */
function membersReadFailed(members: LeaveMembersSource): boolean {
  return members.paused || (!members.loading && (members.refusal !== null || members.members === null));
}

/** Whether the organization snapshot failed, is paused offline, or settled with nothing: the balance's leave year. */
function organizationReadFailed(organization: LeaveOrganizationSource): boolean {
  return (
    organization.fetchStatus === FETCH_PAUSED ||
    (!organization.isPending && (organization.isError || organization.data === undefined || !organization.data.ok))
  );
}

/** A read as far as its retry is seen: whether it failed, and whether it is fetching. */
export interface ResolutionReadState {
  readonly isError: boolean;
  readonly fetchStatus: string;
}

/**
 * Whether any read failed and is being read again: the screen's loading, so
 * the retry is seen to work rather than the alert standing unchanged.
 */
export function refetchingAfterFailure(reads: readonly ResolutionReadState[]): boolean {
  return reads.some((read) => read.isError && read.fetchStatus === FETCH_FETCHING);
}

/** An adjacent conflict's link. */
function linkOf(collision: Collision | undefined): ResolutionLink | null {
  if (collision === undefined) return null;

  return {
    memberId: collision.memberId,
    date: collision.date,
    teamId: collision.teamId,
    dayMonth: dayMonthOf(collision.date),
  };
}

/** Whether a live record of `memberId` covers `date`. */
function onLeave(records: readonly OrganizationLeaveRecord[], memberId: string, date: string): boolean {
  return records.some((record) => record.memberId === memberId && record.from <= date && date <= record.to);
}

/**
 * The shift's duration on its date, in minutes, or `null` for a working type
 * with no version in effect.
 *
 * @throws RangeError for a type the snapshot lacks.
 */
function shiftMinutesOf(snapshot: CalendarSnapshot, collision: Collision): number | null {
  const type = snapshot.types.find((one) => one.id === collision.shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

  const version = shiftTypeVersionOn(type.versions, collision.date);

  return version === null ? null : deriveShiftTimes(version.startMinute, version.endMinute).durationMinutes;
}

/**
 * The conflict among the unresolved, in the queue's order, with its
 * neighbours — or `null` when it is not among them.
 *
 * @throws RangeError when a row cannot be trusted, or on any precondition of
 *   `collisionsOf`.
 */
export function resolutionPlaceOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  resolutionRows: readonly unknown[],
  params: ResolutionParams,
  today: string,
): {
  readonly ordered: readonly Collision[];
  readonly index: number;
} {
  const ordered = queueOrderOf(unresolvedOf(snapshot, records, resolutionRows), today);
  const key = collisionKeyOf(params);

  return { ordered, index: ordered.findIndex((collision) => collisionKeyOf(collision) === key) };
}

/**
 * The screen from its five reads, the route's params and `now`: unavailable
 * when any read failed or is paused offline — first, so a failure is never
 * hidden behind another's skeleton — loading while the queue's reads are
 * pending; missing once they are in and the conflict is not among the
 * unresolved; loading again while the balance's reads are pending; otherwise
 * the screen. A `RangeError` is logged and is unavailable; nothing else is
 * caught.
 */
export function resolutionScreenOf(sources: ResolutionSources, params: ResolutionParams, now: Date): ResolutionScreen {
  const { calendar, records, resolutions, members, organization } = sources;

  // A failed read being read again is loading, not the refusal (as *Sati*'s
  // `hoursConflictsStateOf`): TanStack Query keeps `isError` while the retry
  // is in flight, so the alert would otherwise stand unchanged under the press.
  if (sources.refetching === true) return { kind: RESOLUTION_LOADING };

  if (
    calendar.refusal !== null ||
    (!calendar.loading && calendar.snapshot === null) ||
    queueReadFailed(records) ||
    queueReadFailed(resolutions) ||
    membersReadFailed(members) ||
    organizationReadFailed(organization)
  ) {
    return { kind: RESOLUTION_UNAVAILABLE };
  }

  const snapshot = calendar.snapshot;
  const rows = records.data;
  const resolutionRows = resolutions.data;

  if (snapshot === null || rows === undefined || resolutionRows === undefined) return { kind: RESOLUTION_LOADING };

  try {
    return resolutionScreenFrom(sources, snapshot, rows, resolutionRows, params, now);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(RESOLUTION_UNAVAILABLE, cause);

    return { kind: RESOLUTION_UNAVAILABLE };
  }
}

/**
 * {@link resolutionScreenOf} once the queue's three reads are in.
 *
 * @throws RangeError when a row cannot be trusted, on any precondition of the
 *   domain, or when the conflict names a member, team or type the inputs lack.
 */
function resolutionScreenFrom(
  sources: ResolutionSources,
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  params: ResolutionParams,
  now: Date,
): ResolutionScreen {
  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const today = calendarTodayOf(snapshot, now);
  const { ordered, index } = resolutionPlaceOf(snapshot, records, resolutionRows, params, today);
  const collision = ordered[index];

  if (collision === undefined) return { kind: RESOLUTION_MISSING, count: ordered.length };

  // The balance, through the member card's own recipe: the member's records
  // here are the organization's read, filtered to them.
  const base = memberLeaveBaseOf(
    {
      members: sources.members,
      calendar: { snapshot, loading: false },
      organization: sources.organization,
      records: {
        records: records
          .filter((record) => record.memberId === collision.memberId)
          .map(({ id, from, to }) => ({ id, from, to })),
        loading: false,
        refreshing: false,
      },
    },
    collision.memberId,
    now,
  );

  if (base.kind === LEAVE_LOADING) return { kind: RESOLUTION_LOADING };
  if (base.kind !== LEAVE_READY) throw new RangeError(`the balance of ${collision.memberId} is ${base.kind}`);

  const record = base.rows.find((row) => row.record.id === collision.leaveRecordId);

  if (record === undefined) throw new RangeError(`leave record ${collision.leaveRecordId} was not read`);

  const member = snapshot.members.find((one) => one.id === collision.memberId);
  const type = snapshot.types.find((one) => one.id === collision.shiftTypeId);
  const detail = dayDetailOf(snapshot, collision.teamId, collision.date);

  if (member === undefined) throw new RangeError(`member ${collision.memberId} is not in the snapshot`);
  if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);
  if (detail === null) throw new RangeError(`team ${collision.teamId} is not in the snapshot`);

  const absent = detail.roster.find((one) => one.id === collision.memberId);

  // A collision is a shift the member is rostered on (R6.1): one the day's
  // roster does not hold is a derivation that disagrees with itself.
  if (absent === undefined) {
    throw new RangeError(`member ${collision.memberId} is not on the roster of ${collision.teamId} on ${collision.date}`);
  }

  // ONE LIST for the coverage and the names: the roster less every member on live leave.
  const working = detail.roster.filter((one) => !onLeave(records, one.id, collision.date));
  const coworkers = working.map((one) => {
    if (one.name === null) throw new RangeError(`member ${one.id} is rostered but has no name in the snapshot`);

    return one.name;
  });
  const minutes = shiftMinutesOf(snapshot, collision);
  const candidates = replacementCandidatesOf(snapshot, records, collision.teamId, collision.date);
  const range = leaveRangeValuesOf(record.record);
  const dateShown = detail.date;
  const typeName = detail.typeName ?? type.name;
  const key = collisionKeyOf(collision);
  // Unresolved, yet a live row holds this key: a replacement the snapshot holds pending or inert.
  const held = liveResolutionsOf(snapshot, resolutionRows).some(
    (resolution) => collisionKeyOf(resolution) === key && heldByReplacement(snapshot, resolution),
  );

  return {
    kind: RESOLUTION_READY,
    view: {
      key,
      count: ordered.length,
      position: index + 1,
      previous: linkOf(ordered[index - 1]),
      next: linkOf(ordered[index + 1]),
      shiftTypeName: typeName,
      times: detail.range,
      teamName: detail.teamName,
      dateShown,
      memberName: member.name,
      rankKey: rosterRankMessageKey(member.fireRank, ranksShown(snapshot)),
      positionKey: rosterPositionMessageKey(absent.position, positionsShown(snapshot)),
      leaveFrom: range.from,
      leaveTo: range.to,
      leaveCostDays: record.costDays,
      coworkers,
      total: detail.roster.length,
      covered: coworkers.length,
      shiftHours: minutes === null ? null : { key: durationMessageKey(minutes), values: durationValuesOf(minutes) },
      leaveDays: leaveCostOf(base.input.input, collision.date, collision.date),
      // THE LEAVE YEAR OF THE CONFLICT'S DATE, not today's: the balance the decision is about.
      balanceDays: leaveBalanceOf({ ...base.input, today: collision.date }).balanceDays,
      candidates,
      rankShown: ranksShown(snapshot),
      positionShown: positionsShown(snapshot),
      replaceCovered: coworkers.length + 1,
      dayMonth: dayMonthOf(collision.date),
      leaveRecordId: record.record.id,
      amend: resolutionAmendOf(base.input, record.record, collision.date),
      held,
      heldCalendar: heldCalendarSearchOf(collision),
      organizationId: snapshot.organizationId,
      saved: { kind: ACCEPT_UNCOVERED, shiftTypeName: typeName, teamName: detail.teamName, dateShown, memberName: member.name },
    },
  };
}

/** The key a radio card's coverage term reads through: covered of total (the first card adds the uncovered mark). */
export function coverageMessageKey(): 'raspored.resolution.coverage' {
  return 'raspored.resolution.coverage';
}

/** The facts line: with the shift's times, or without them for an untimed shift. */
export function shiftFactsMessageKey(times: string | null): 'raspored.resolution.shiftTimed' | 'raspored.resolution.shift' {
  return times === null ? 'raspored.resolution.shift' : 'raspored.resolution.shiftTimed';
}

/** Who else works: the names, or the sentence for nobody. */
export function coworkersMessageKey(
  coworkers: readonly string[],
): 'raspored.resolution.coworkers' | 'raspored.resolution.noCoworkers' {
  return coworkers.length === 0 ? 'raspored.resolution.noCoworkers' : 'raspored.resolution.coworkers';
}

/**
 * The save hint: why Spremi waits — no card, or the second card with nobody
 * picked (story 5.4c), or with nobody to pick at all, which only another
 * outcome can resolve — or what saving does: records the decision, or, on the
 * third card (story 5.4d), opens the leave amend with its date or the
 * record's removal.
 */
export function saveHintMessageKey(
  choice: ResolutionOption | null,
  replacementId: string | null = null,
  candidatesExist = true,
  amendKind: ResolutionAmendKind | null = null,
):
  | 'raspored.resolution.hintChoose'
  | 'raspored.resolution.hintChooseReplacement'
  | 'raspored.resolution.hintNoCandidates'
  | 'raspored.resolution.hintRecorded'
  | 'raspored.resolution.hintAmend'
  | 'raspored.resolution.hintAmendRemove' {
  if (choice === null) return 'raspored.resolution.hintChoose';
  if (choice === OPTION_REPLACE_MEMBER && !candidatesExist) return 'raspored.resolution.hintNoCandidates';
  if (choice === OPTION_REPLACE_MEMBER && replacementId === null) return 'raspored.resolution.hintChooseReplacement';
  if (choice === OPTION_AMEND_LEAVE) {
    return amendKind === AMEND_REMOVES ? 'raspored.resolution.hintAmendRemove' : 'raspored.resolution.hintAmend';
  }

  return 'raspored.resolution.hintRecorded';
}

/**
 * The calendar's search for the held line's link (story 5.5d): *Sve smjene*
 * on the conflict's month, narrowed to its team. The day itself opens from
 * its cell: which day is open is not in the URL (story 3.4b).
 */
export function heldCalendarSearchOf(conflict: { readonly date: string; readonly teamId: string }): CalendarSearch {
  return { prikaz: MODE_SVE, mjesec: conflict.date.slice(0, 7), smjena: conflict.teamId };
}

/** Where the held hint's link goes in its sentence: a character no translation holds. */
const HELD_ACTION_SLOT = '\u0000';

/**
 * The held hint (story 5.5d) split around its link: what `format` — the
 * sentence `raspored.resolution.heldHint` translated with `action` as its
 * slot — says before the link and after it. The link's own words are
 * `raspored.resolution.heldAction`.
 */
export function heldHintPartsOf(format: (action: string) => string): { readonly before: string; readonly after: string } {
  const [before = '', after = ''] = format(HELD_ACTION_SLOT).split(HELD_ACTION_SLOT);

  return { before, after };
}

/**
 * Whether Spremi can save: a card, and for the second one a candidate (story
 * 5.4c); the third at once (story 5.4d). Never while the key is `held` (story
 * 5.5d): saving is known to fail until the replacement is removed.
 */
export function readyToSave(choice: ResolutionOption | null, replacementId: string | null, held = false): boolean {
  if (held || choice === null) return false;
  if (choice === OPTION_REPLACE_MEMBER) return replacementId !== null;

  return true;
}

/** Where Spremi pressed too early sends focus (story 5.4c). */
export const SAVE_FOCUS_CHOICE = 'choice';
export const SAVE_FOCUS_REPLACE = 'replace';
export const SAVE_FOCUS_CANDIDATES = 'candidates';

/**
 * Where focus goes when Spremi is pressed before it can save: the first card
 * while none is chosen; the first candidate while the second card waits for a
 * pick; the second card itself when there is nobody to pick, so the admin
 * can move to another outcome. `null` once it can save.
 */
export function saveFocusOf(
  choice: ResolutionOption | null,
  replacementId: string | null,
  candidatesExist: boolean,
): typeof SAVE_FOCUS_CHOICE | typeof SAVE_FOCUS_REPLACE | typeof SAVE_FOCUS_CANDIDATES | null {
  if (choice === null) return SAVE_FOCUS_CHOICE;
  if (readyToSave(choice, replacementId)) return null;

  return candidatesExist ? SAVE_FOCUS_CANDIDATES : SAVE_FOCUS_REPLACE;
}

/** The candidate of `view` with `id`, in whichever group, or `null` for none — a pick a re-read took away included. */
export function replacementOf(view: ResolutionView, id: string | null): ReplacementCandidate | null {
  if (id === null) return null;

  for (const group of view.candidates) {
    const found = group.candidates.find((candidate) => candidate.id === id);

    if (found !== undefined) return found;
  }

  return null;
}

/** The candidate picker's value as a candidate's id, or `null` for nobody. */
export function candidateIdOf(value: string): string | null {
  return value === NO_CANDIDATE ? null : value;
}

/** Whether there is anybody at all to put on the shift. */
export function hasCandidates(view: ResolutionView): boolean {
  return view.candidates.some((group) => group.candidates.length > 0);
}

/** What the queue's status line names once a replacement by `replacementName` lands (story 5.4c). */
export function replacedSavedOf(saved: ResolutionView['saved'], replacementName: string): ResolutionSaved {
  return { ...saved, kind: REPLACE_MEMBER, replacementName };
}

/** The third card's sentence (story 5.4d), by its target. Exhaustive. */
export function amendBodyMessageKey(
  kind: ResolutionAmendKind,
):
  | 'raspored.resolution.amendBodyStarts'
  | 'raspored.resolution.amendBodyEnds'
  | 'raspored.resolution.amendBodyRemoves' {
  switch (kind) {
    case AMEND_STARTS:
      return 'raspored.resolution.amendBodyStarts';
    case AMEND_ENDS:
      return 'raspored.resolution.amendBodyEnds';
    case AMEND_REMOVES:
      return 'raspored.resolution.amendBodyRemoves';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}

/** The third card's hours term: the duration as work, or the empty mark for an untimed shift. */
export function workHoursMessageKey(
  hours: ResolutionHours | null,
): 'raspored.resolution.hoursAsWork' | 'raspored.resolution.noHours' {
  return hours === null ? 'raspored.resolution.noHours' : 'raspored.resolution.hoursAsWork';
}

/**
 * The router state the third card's Spremi takes to the member page (story
 * 5.4d): the record, the range or its removal, and the conflict it came from.
 * Nothing goes in the URL, and nothing is written.
 */
export function amendHandoffOf(view: ResolutionView, origin: ResolutionParams): LeaveHandoff {
  const from = { memberId: origin.memberId, date: origin.date, teamId: origin.teamId };
  const target = view.amend.target;

  return target.kind === AMEND_REMOVES
    ? { kind: LEAVE_REMOVE_ACTION, recordId: view.leaveRecordId, origin: from }
    : { kind: LEAVE_AMEND_ACTION, recordId: view.leaveRecordId, range: target.range, origin: from };
}

/**
 * The absent member's leave term: the days as leave, `1 dan godišnjeg`, or
 * the empty mark for a date that charges none. A conflict's date charges 0
 * only when the member is inactive on it (R4.2: a leave day needs the member
 * active, with a working shift — and a conflict always has the shift), a
 * state a collision should not reach but the strip still states truthfully.
 */
export function leaveDaysMessageKey(days: number): 'raspored.resolution.daysAsLeave' | 'raspored.resolution.noDays' {
  return days === 0 ? 'raspored.resolution.noDays' : 'raspored.resolution.daysAsLeave';
}

/** The radio group's value as an option, or `null` for anything else. */
export function resolutionOptionOf(value: string): ResolutionOption | null {
  return (RESOLUTION_OPTIONS as readonly string[]).includes(value) ? (value as ResolutionOption) : null;
}

// ---------------------------------------------------------------- the notice

/** The router state a landed decision returns to the queue with. Never the URL, never storage. */
export const RESOLUTION_SAVED_STATE = 'resolutionSaved';

/**
 * The history entry's state with `saved` added under
 * {@link RESOLUTION_SAVED_STATE}, every other field kept — the router's own
 * keys included.
 */
export function withResolutionSaved<State extends object>(state: State, saved: ResolutionSaved): State {
  return { ...state, [RESOLUTION_SAVED_STATE]: saved };
}

/** The history entry's state without the status line's content: what a reload finds. */
export function withoutResolutionSaved(state: unknown): Record<string, unknown> {
  if (typeof state !== 'object' || state === null) return {};

  const { [RESOLUTION_SAVED_STATE]: _saved, ...rest } = state as Record<string, unknown>;

  return rest;
}

/** What the queue's status line does on one location (story 5.4b): what it shows, and whether the entry is cleared. */
export interface ResolutionSavedStep {
  /** The line shown, or `null` for none. */
  readonly shown: ResolutionSaved | null;
  /** Whether to replace the entry with its state less the line's content, through the router. */
  readonly clear: boolean;
  /** Whether the next location is that replace landing, which keeps the line. */
  readonly clearing: boolean;
}

/**
 * THE STATUS LINE PER LOCATION. A location that brings a saved decision
 * shows it and clears it off its entry (so a reload, or Back to it later,
 * finds none); the replace that clearing makes keeps the line; any other
 * location — a navigation to the same route, the Raspored tab included —
 * drops it.
 */
export function resolutionSavedStepOf(shown: ResolutionSaved | null, state: unknown, clearing: boolean): ResolutionSavedStep {
  const arrived = resolutionSavedOf(state);

  if (arrived !== null) return { shown: arrived, clear: true, clearing: true };
  if (clearing) return { shown, clear: false, clearing: false };

  return { shown: null, clear: false, clearing: false };
}

/** The status line's content from router state as it came back, or `null` for none or anything malformed. */
export function resolutionSavedOf(state: unknown): ResolutionSaved | null {
  if (typeof state !== 'object' || state === null) return null;

  const saved: unknown = (state as Record<string, unknown>)[RESOLUTION_SAVED_STATE];

  if (typeof saved !== 'object' || saved === null) return null;

  const { kind, shiftTypeName, teamName, dateShown, memberName, replacementName } = saved as Record<string, unknown>;

  if (
    typeof shiftTypeName !== 'string' ||
    typeof teamName !== 'string' ||
    typeof dateShown !== 'string' ||
    typeof memberName !== 'string'
  ) {
    return null;
  }

  if (kind === ACCEPT_UNCOVERED) return { kind, shiftTypeName, teamName, dateShown, memberName };

  if (kind === REPLACE_MEMBER && typeof replacementName === 'string') {
    return { kind, shiftTypeName, teamName, dateShown, memberName, replacementName };
  }

  return null;
}

/** The queue's status line for a landed decision, by its outcome. Exhaustive. */
export function resolutionSavedMessageKey(kind: ResolutionSavedKind): 'raspored.saved' | 'raspored.savedReplace' {
  if (kind === ACCEPT_UNCOVERED) return 'raspored.saved';
  if (kind === REPLACE_MEMBER) return 'raspored.savedReplace';

  const unhandled: never = kind;

  return unhandled;
}
