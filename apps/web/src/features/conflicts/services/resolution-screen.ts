import { collisionKeyOf, deriveShiftTimes, leaveBalanceOf, shiftTypeVersionOn, type Collision } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { dayDetailOf } from '@/features/calendar/utils/day-detail';
import { calendarTodayOf, dayMonthOf } from '@/features/calendar/utils/month';
import {
  queueOrderOf,
  queueReadFailed,
  unresolvedOf,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
import { ACCEPT_UNCOVERED } from '@/features/conflicts/services/resolutions';
import { durationMessageKey, durationValuesOf, type DurationValues } from '@/features/hour-bands/services/list';
import {
  organizationLeaveRecordsOf,
  type OrganizationLeaveRecord,
} from '@/features/leave/services/leave-list';
import {
  LEAVE_LOADING,
  LEAVE_READY,
  leaveRangeValuesOf,
  memberLeaveBaseOf,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
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
 * the members on leave), the absent member's hours as leave (the shift's
 * duration on its date, none when untimed) and the balance, which accepting
 * leaves unchanged — `leaveBalanceOf` through the member card's own recipe
 * (`memberLeaveBaseOf`).
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

/** The one outcome story 5.4b ships, as the radio group's value. 5.4c and 5.4d add theirs at fixed positions 2 and 3. */
export const OPTION_ACCEPT_UNCOVERED = 'accept-uncovered';

/** The radio group's value while nothing is chosen: Radix's own "none". */
export const NO_OPTION = '';

/** The outcomes, in their fixed order. */
export const RESOLUTION_OPTIONS = [OPTION_ACCEPT_UNCOVERED] as const;

export type ResolutionOption = (typeof RESOLUTION_OPTIONS)[number];

/** The id the choice's heading carries, which names the radio group. */
export const RESOLUTION_CHOICE_HEADING_ID = 'resolution-choice';

/** The ids that name and describe the one card: its title, its sentence and its strip. */
export const RESOLUTION_ACCEPT_TITLE_ID = 'resolution-accept-title';
export const RESOLUTION_ACCEPT_BODY_ID = 'resolution-accept-body';
export const RESOLUTION_ACCEPT_STRIP_ID = 'resolution-accept-strip';
/** The card's description: its sentence, then its strip. */
export const RESOLUTION_ACCEPT_DESCRIBED_BY = `${RESOLUTION_ACCEPT_BODY_ID} ${RESOLUTION_ACCEPT_STRIP_ID}`;

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

/** The outcomes a landed decision can name on the queue: story 5.4b's alone so far. */
export type ResolutionSavedKind = typeof ACCEPT_UNCOVERED;

/** What a landed decision names on the queue (story 5.4b): the outcome, the shift, the date and the member, as shown. */
export interface ResolutionSaved {
  readonly kind: ResolutionSavedKind;
  readonly shiftTypeName: string;
  readonly teamName: string;
  readonly dateShown: string;
  readonly memberName: string;
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
  /** The shift's duration, as the absent member's leave hours; `null` when the shift has no times. */
  readonly leaveHours: ResolutionHours | null;
  /** The absent member's balance in the leave year that holds the conflict's date, which accepting does not change. */
  readonly balanceDays: number;
  /** The insert's columns: the organization and the key. */
  readonly organizationId: string;
  /** What the queue's status line names once the decision lands. */
  readonly saved: ResolutionSaved;
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
  const range = leaveRangeValuesOf(record.record);
  const dateShown = detail.date;
  const typeName = detail.typeName ?? type.name;

  return {
    kind: RESOLUTION_READY,
    view: {
      key: collisionKeyOf(collision),
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
      leaveHours: minutes === null ? null : { key: durationMessageKey(minutes), values: durationValuesOf(minutes) },
      // THE LEAVE YEAR OF THE CONFLICT'S DATE, not today's: the balance the decision is about.
      balanceDays: leaveBalanceOf({ ...base.input, today: collision.date }).balanceDays,
      organizationId: snapshot.organizationId,
      saved: { kind: ACCEPT_UNCOVERED, shiftTypeName: typeName, teamName: detail.teamName, dateShown, memberName: member.name },
    },
  };
}

/** The key the radio card's coverage term reads through: covered of total, and the uncovered mark. */
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

/** The save hint: why Spremi waits, or what saving records. */
export function saveHintMessageKey(
  choice: ResolutionOption | null,
): 'raspored.resolution.hintChoose' | 'raspored.resolution.hintRecorded' {
  return choice === null ? 'raspored.resolution.hintChoose' : 'raspored.resolution.hintRecorded';
}

/** The absent member's hours term: the duration as leave, or the empty mark for an untimed shift. */
export function leaveHoursMessageKey(
  hours: ResolutionHours | null,
): 'raspored.resolution.hoursAsLeave' | 'raspored.resolution.noHours' {
  return hours === null ? 'raspored.resolution.noHours' : 'raspored.resolution.hoursAsLeave';
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

  const { kind, shiftTypeName, teamName, dateShown, memberName } = saved as Record<string, unknown>;

  if (
    kind !== ACCEPT_UNCOVERED ||
    typeof shiftTypeName !== 'string' ||
    typeof teamName !== 'string' ||
    typeof dateShown !== 'string' ||
    typeof memberName !== 'string'
  ) {
    return null;
  }

  return { kind, shiftTypeName, teamName, dateShown, memberName };
}

/** The queue's status line for a landed decision, by its outcome. Exhaustive. */
export function resolutionSavedMessageKey(kind: ResolutionSavedKind): 'raspored.saved' {
  if (kind === ACCEPT_UNCOVERED) return 'raspored.saved';

  const unhandled: never = kind;

  return unhandled;
}
