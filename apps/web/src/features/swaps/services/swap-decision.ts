import type { QueryKey } from '@tanstack/react-query';
import { monthOf } from '@shift/domain';

import { CALENDAR_KEY, type CalendarSnapshot, type CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { unknownSnapshotIdsOf } from '@/features/calendar/services/snapshot-skew';
import { memberMonthDeltasOf, type MemberMonthDelta } from '@/features/calendar/utils/change-preview';
import { dayDetailOf, rosterOverlapOf, type RosterOverlap } from '@/features/calendar/utils/day-detail';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { queueReadFailed, type LeaveRowsAnswer } from '@/features/conflicts/services/conflicts-queue';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { ACTING_ADMINS_KEY, actorNamesOf } from '@/features/conflicts/services/resolved-conflicts';
import { hoursLeaveKeysOf } from '@/features/hours/services/hours-conflicts';
import { ORGANIZATION_LEAVE_RECORDS_KEY, organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { configurationReportOf, type ShortStaffedReport } from '@/features/staffing/services/short-staffed';
import { swapStaleOf } from '@/features/swaps/services/my-swaps';
import {
  ORGANIZATION_SWAP_REQUESTS_KEY,
  SWAP_ACCEPTED,
  SWAP_APPROVED,
  SWAP_DEACTIVATED,
  SWAP_DECLINED,
  SWAP_PROPOSED,
  SWAP_REJECTED,
  SWAP_WITHDRAWN,
  organizationSwapFoundOf,
  swapFirstDateOf,
  swapLastDateOf,
  type OrganizationSwap,
  type OrganizationSwapFound,
  type SwapStatus,
} from '@/features/swaps/services/organization-swaps';
import { swapAppliedOf, swapDayOf, type SwapShiftKey } from '@/features/swaps/services/swap-proposal';
import { NO_DEPENDENTS, SWAP_REQUEST_DECISION_DEPENDENTS } from '@/features/teams/services/dependents';
import { formatDate, formatIsoDate, formatTime } from '@/lib/i18n/format';

/**
 * AN ADMIN DECIDES A SWAP ON ITS OWN SCREEN (story 12.4; R9.2, R9.3,
 * UX-DR33, UX-DR46): the rules of `/za-odluku/zamjena/$requestId`, on 9.4's
 * leave request decision screen's pattern, as a pure `.ts` the node suite
 * executes (AD-15). Codes, names and operands only; the components word them.
 *
 * THE STATES. Loading while a read the screen stands on is unanswered;
 * unavailable when one failed or answered something that cannot be trusted;
 * missing when no swap has that id; otherwise the swap — WAITING (open and
 * accepted), with what it does and both decisions, or READ-ONLY (any other
 * status), with its status word, and who decided and when for a decided one.
 *
 * WHAT IT DOES IS A WARNING, NEVER A GATE (R9.3). The swap's own two-change
 * "after" (`swapAppliedOf`, the proposal's and the colleague's very preview)
 * over the calendar snapshot, and from it: who works which date; each
 * member's signed hour delta per month (`memberMonthDeltasOf`, each member's
 * own live leave keys, as their *Sati* counts them); the leave of a member it
 * puts on a shift that date (the organization's live leave); a double booking
 * of that member (`rosterOverlapOf`, over the "after"); and the shifts it
 * newly leaves short of people (`configurationReportOf`, from the earlier date
 * to the later). A preview that cannot be derived is one neutral line, and
 * both decisions stay.
 *
 * TWO THINGS DO DECIDE. A PAST swap (either date before the organization's
 * today) says *Datum je prošao*, and *Odobri* stays (product owner,
 * 2026-11-07). A STALE swap (`swapStaleOf`: the given shift no longer the
 * proposer's working shift, the return shift no longer the colleague's, or
 * the roster change refused) withholds *Odobri* and says why; *Odbij* stays.
 *
 * APPROVAL IS GUARDED (AD-5). The erasure check diffs the swap's "after"
 * from the earlier date over FRESH reads ({@link swapErasureCheckOf}): stale
 * then refuses; an erasure is confirmed in the shared `ErasureDialog` first;
 * a check that cannot be derived refuses the write, with a retry. Then
 * `decide_swap_request`, whose refusals map by SQLSTATE
 * ({@link swapDecisionFailureOf}). Rejection records the decision alone.
 */

// ------------------------------------------------------------------ the states

/** Still waiting on a read: the skeleton. */
export const SWAP_SCREEN_LOADING = 'loading';
/** A read failed, or answered something that cannot be trusted: one alert and a retry. */
export const SWAP_SCREEN_UNAVAILABLE = 'unavailable';
/** No swap has that id: "Zamjena ne postoji." */
export const SWAP_SCREEN_MISSING = 'missing';
/** An open, accepted swap: what it does, *Odobri* and *Odbij*. */
export const SWAP_SCREEN_WAITING = 'waiting';
/** Any other swap, opened by URL: read-only. */
export const SWAP_SCREEN_CLOSED = 'closed';

/** What the screen logs for an answer it will not draw: never shown. */
export const SWAP_DECISION_UNTRUSTED = 'SWAP_DECISION_UNTRUSTED';

/** A shift as the screen names it: the day detail's own day (`subota 26.09.2026`) and the team. */
export interface SwapDayShown {
  readonly day: string;
  readonly teamName: string;
}

/** What every drawn swap names: the swap, whose it is, and its shifts. */
export interface SwapDecisionFacts {
  readonly swap: OrganizationSwap;
  readonly proposerName: string;
  readonly addresseeName: string;
  readonly given: SwapDayShown;
  readonly returnShift: SwapDayShown | null;
  /** The earlier of its dates, `12.09.2026`: the date the queue row and its status line name. */
  readonly dateShown: string;
}

/** One date the swap changes: on `team`'s shift that day, `inName` works instead of `outName`. */
export interface SwapDecisionLine {
  readonly day: string;
  readonly teamName: string;
  readonly inName: string;
  readonly outName: string;
}

/** One member's hours of one month as the swap moves them, named. */
export interface SwapDecisionHours extends MemberMonthDelta {
  readonly name: string;
}

/** A member the swap puts on a shift on a date they have leave. */
export interface SwapDecisionLeave {
  readonly name: string;
  readonly day: string;
}

/** What the swap does once approved: the warnings, none of them a gate. */
export interface SwapDecisionPreview {
  readonly lines: readonly SwapDecisionLine[];
  /** The proposer's months first, then the colleague's, each in month order; `0` included. */
  readonly hours: readonly SwapDecisionHours[];
  readonly onLeave: readonly SwapDecisionLeave[];
  readonly overlaps: readonly RosterOverlap[];
  /** What it would newly leave short of people, from the earlier date to the later; `null` while the setting is empty. */
  readonly shortStaffed: ShortStaffedReport | null;
}

/** A read-only swap's line: who decided and when; `null` for one never decided (withdrawn, declined, proposed). */
export interface SwapDecidedLine {
  /** The deciding admin's name, or `null` when they are no longer a member. */
  readonly actor: string | null;
  /** `20.09.2026` */
  readonly date: string;
  /** `14:05` */
  readonly time: string;
}

export type SwapDecisionScreen =
  | { readonly kind: typeof SWAP_SCREEN_LOADING }
  | { readonly kind: typeof SWAP_SCREEN_UNAVAILABLE }
  | { readonly kind: typeof SWAP_SCREEN_MISSING }
  | {
      readonly kind: typeof SWAP_SCREEN_WAITING;
      readonly facts: SwapDecisionFacts;
      /** Either date before the organization's today: *Datum je prošao*. *Odobri* stays. */
      readonly past: boolean;
      /** No longer applies: *Odobri* is withheld, with the reason; *Odbij* stays. */
      readonly stale: boolean;
      /**
       * What it does, a stale swap's included; `null` when the change is
       * refused, the preview's reads cannot be read, or it cannot be derived
       * (the neutral line, or a stale swap's reason alone).
       */
      readonly preview: SwapDecisionPreview | null;
    }
  | { readonly kind: typeof SWAP_SCREEN_CLOSED; readonly facts: SwapDecisionFacts; readonly line: SwapDecidedLine | null };

/** The reads the screen stands on, each as far as it is read here. */
export interface SwapDecisionSources {
  /** The organization's swaps (`ORGANIZATION_SWAP_REQUESTS_KEY`): unparsed rows. */
  readonly swaps: LeaveRowsAnswer;
  readonly calendar: CalendarSurfaceState;
  /** The organization's live leave: the preview's leave lines, its short-staffed report, and the erasure check's. */
  readonly records: LeaveRowsAnswer;
  /** The organization's live resolutions: each member's leave keys. */
  readonly resolutions: LeaveRowsAnswer;
  /** The acting admins' names (`actingAdminsQueryOptions`): read only for a decided swap. */
  readonly actors: LeaveRowsAnswer;
  /** Whether the calendar snapshot is being read again: a skew then waits for it. */
  readonly snapshotFetching?: boolean;
}

/**
 * The swap the read answered, before any other read: loading, unavailable,
 * missing, or the swap. `parsed` is the answer's rows already parsed for
 * `requestId` (the hook's memo), so they are not parsed twice per render.
 */
export function decidedSwapOf(
  answer: LeaveRowsAnswer,
  requestId: string,
  parsed?: OrganizationSwapFound | null,
): OrganizationSwap | typeof SWAP_SCREEN_LOADING | typeof SWAP_SCREEN_UNAVAILABLE | typeof SWAP_SCREEN_MISSING {
  if (queueReadFailed(answer)) return SWAP_SCREEN_UNAVAILABLE;
  if (answer.data === undefined) return SWAP_SCREEN_LOADING;

  const found = parsed === undefined ? organizationSwapFoundOf(answer.data, requestId) : parsed;

  if (found === null) {
    console.error(SWAP_DECISION_UNTRUSTED, 'swap');

    return SWAP_SCREEN_UNAVAILABLE;
  }

  return found.swap ?? SWAP_SCREEN_MISSING;
}

/** Whether the swap waits for an admin, so the preview's reads are made. */
export function swapNeedsPreview(swap: OrganizationSwap | null): boolean {
  return swap !== null && swap.status === SWAP_ACCEPTED;
}

/** Whether the swap was decided, so its deciding admin's name is read. */
export function swapNeedsActors(swap: OrganizationSwap | null): boolean {
  return swap !== null && swap.decision !== null;
}

/**
 * A shift as the screen names it: the day detail's own day, or the bare
 * date, and the team's name.
 *
 * @throws RangeError when the snapshot lacks the team, or the date cannot be formatted.
 */
function dayShownOf(snapshot: CalendarSnapshot, shift: SwapShiftKey): SwapDayShown {
  const teamName = snapshot.teams.find((team) => team.id === shift.teamId)?.name;
  const day = swapDayOf(snapshot, shift)?.date ?? formatIsoDate(shift.date);

  if (teamName === undefined) throw new RangeError(`team ${shift.teamId} is not in the snapshot`);
  if (day === null) throw new RangeError(`the date ${shift.date} cannot be formatted`);

  return { day, teamName };
}

/**
 * The facts every drawn swap names.
 *
 * @throws RangeError when the snapshot lacks a member or a team, or a date cannot be formatted.
 */
function factsOf(snapshot: CalendarSnapshot, swap: OrganizationSwap): SwapDecisionFacts {
  const names = new Map(snapshot.members.map((member) => [member.id, member.name]));
  const proposerName = names.get(swap.proposerId);
  const addresseeName = names.get(swap.addresseeId);
  const firstDate = swapFirstDateOf(swap);
  const dateShown = formatIsoDate(firstDate);

  if (proposerName === undefined) throw new RangeError(`member ${swap.proposerId} is not in the snapshot`);
  if (addresseeName === undefined) throw new RangeError(`member ${swap.addresseeId} is not in the snapshot`);
  if (dateShown === null) throw new RangeError(`the date ${firstDate} cannot be formatted`);

  return {
    swap,
    proposerName,
    addresseeName,
    given: dayShownOf(snapshot, swap.given),
    returnShift: swap.returnShift === null ? null : dayShownOf(snapshot, swap.returnShift),
    dateShown,
  };
}

/** Whether a swap's date is before `today`: the given one, or the return one. */
export function swapPastOf(swap: OrganizationSwap, today: string): boolean {
  return swap.given.date < today || (swap.returnShift !== null && swap.returnShift.date < today);
}

/**
 * What the swap does once approved (R9.3): the warnings over its two-change
 * "after", none of them a gate. `null` when the change is refused (the stale
 * check then says why).
 *
 * @throws RangeError when a leave or resolution row cannot be trusted, or on
 *   any precondition of the derivations.
 */
export function swapDecisionPreviewOf(
  snapshot: CalendarSnapshot,
  swap: OrganizationSwap,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): SwapDecisionPreview | null {
  const applied = swapAppliedOf(snapshot, swap);

  if (!applied.ok) return null;

  const after = applied.after;
  const names = new Map(snapshot.members.map((member) => [member.id, member.name]));
  const nameOf = (memberId: string): string => {
    const name = names.get(memberId);

    if (name === undefined) throw new RangeError(`member ${memberId} is not in the snapshot`);

    return name;
  };
  // WHO IS PUT ON WHICH SHIFT: the colleague on the given one, and the proposer on the return one.
  const putOn: readonly { readonly shift: SwapShiftKey; readonly inId: string; readonly outId: string }[] = [
    { shift: swap.given, inId: swap.addresseeId, outId: swap.proposerId },
    ...(swap.returnShift === null ? [] : [{ shift: swap.returnShift, inId: swap.proposerId, outId: swap.addresseeId }]),
  ];
  const lines = putOn.map(({ shift, inId, outId }): SwapDecisionLine => {
    const shown = dayShownOf(snapshot, shift);

    return { day: shown.day, teamName: shown.teamName, inName: nameOf(inId), outName: nameOf(outId) };
  });

  // EACH MEMBER'S OWN LEAVE KEYS, as their *Sati* counts them: the organization's, filtered to them.
  const keys = hoursLeaveKeysOf(snapshot, resolutionRows);
  const months = [...new Set(putOn.map(({ shift }) => monthOf(shift.date)))].sort();
  const hours = memberMonthDeltasOf(snapshot, after, [swap.proposerId, swap.addresseeId], months, (memberId) =>
    keys.filter((key) => key.memberId === memberId),
  ).map((delta) => ({ ...delta, name: nameOf(delta.memberId) }));

  const records = organizationLeaveRecordsOf(
    recordRows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const onLeave = putOn
    .filter(({ shift, inId }) =>
      records.some((record) => record.memberId === inId && record.from <= shift.date && shift.date <= record.to),
    )
    .map(({ shift, inId }) => ({ name: nameOf(inId), day: dayShownOf(snapshot, shift).day }));

  // A DOUBLE BOOKING over the "after": the member's other shifts as the swap leaves them.
  const overlaps = putOn.flatMap(({ shift, inId }) => {
    const detail = dayDetailOf(after, shift.teamId, shift.date);
    const overlap = detail === null ? null : rosterOverlapOf(after, detail, inId);

    return overlap === null ? [] : [overlap];
  });

  return {
    lines,
    hours,
    onLeave,
    overlaps,
    shortStaffed: configurationReportOf(
      snapshot,
      after,
      { from: swapFirstDateOf(swap), to: swapLastDateOf(swap) },
      { isPending: false, isError: false, data: recordRows },
    ),
  };
}

/** {@link swapDecisionPreviewOf}, GUARDED: a preview that cannot be derived is none, logged, and never takes the screen down. */
function guardedPreviewOf(
  snapshot: CalendarSnapshot,
  swap: OrganizationSwap,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): SwapDecisionPreview | null {
  try {
    return swapDecisionPreviewOf(snapshot, swap, recordRows, resolutionRows);
  } catch (cause) {
    console.error(SWAP_DECISION_UNTRUSTED, cause);

    return null;
  }
}

/** A decided swap's line in the organization's zone. */
function decidedLineOf(swap: OrganizationSwap, actors: readonly unknown[], timeZone: string): SwapDecidedLine | null {
  if (swap.decision === null) return null;

  const decidedAt = new Date(swap.decision.decidedAt);

  return {
    actor: actorNamesOf(actors).get(swap.decision.decidedBy) ?? null,
    date: formatDate(decidedAt, timeZone),
    time: formatTime(decidedAt, timeZone),
  };
}

/** Whether a read failed (unavailable), is still pending (loading), or answered. */
function readStateOf(answer: LeaveRowsAnswer): typeof SWAP_SCREEN_UNAVAILABLE | typeof SWAP_SCREEN_LOADING | null {
  if (queueReadFailed(answer)) return SWAP_SCREEN_UNAVAILABLE;

  return answer.data === undefined ? SWAP_SCREEN_LOADING : null;
}

/**
 * The screen for `requestId` from its reads at `now`. The swap read decides
 * first (loading, unavailable, missing); then the calendar snapshot, which
 * every drawn swap stands on — the names, the shifts and the organization's
 * zone; then a waiting swap's preview reads, or a decided one's acting
 * admins' names. A member or team the snapshot does not hold yet is a skew:
 * loading while the snapshot is read again, otherwise unavailable with its
 * retry.
 */
export function swapDecisionOf(
  sources: SwapDecisionSources,
  requestId: string,
  now: Date,
  parsed?: OrganizationSwapFound | null,
): SwapDecisionScreen {
  const swap = decidedSwapOf(sources.swaps, requestId, parsed);

  if (swap === SWAP_SCREEN_LOADING || swap === SWAP_SCREEN_UNAVAILABLE || swap === SWAP_SCREEN_MISSING) return { kind: swap };

  const { calendar } = sources;

  if (calendar.refusal !== null || (!calendar.loading && calendar.snapshot === null)) return { kind: SWAP_SCREEN_UNAVAILABLE };
  if (calendar.snapshot === null) return { kind: SWAP_SCREEN_LOADING };

  const snapshot = calendar.snapshot;
  const row = (sources.swaps.data ?? []).filter(
    (one) => typeof one === 'object' && one !== null && (one as Record<string, unknown>)['id'] === requestId,
  );

  if (unknownSnapshotIdsOf(snapshot, undefined, undefined, undefined, row).length > 0) {
    return sources.snapshotFetching === true ? { kind: SWAP_SCREEN_LOADING } : { kind: SWAP_SCREEN_UNAVAILABLE };
  }

  let facts: SwapDecisionFacts;

  try {
    facts = factsOf(snapshot, swap);
  } catch (cause) {
    console.error(SWAP_DECISION_UNTRUSTED, cause);

    return { kind: SWAP_SCREEN_UNAVAILABLE };
  }

  if (swap.status === SWAP_ACCEPTED) {
    // THE PREVIEW'S READS NEVER TAKE THE SWAP DOWN: failed or paused, the
    // preview is the neutral unknown line and *Odbij* stays reachable (an
    // approval's own erasure check refuses on its own while they cannot be
    // read); only while they are still pending is the screen loading.
    const previewUnreadable = queueReadFailed(sources.records) || queueReadFailed(sources.resolutions);

    if (!previewUnreadable && (sources.records.data === undefined || sources.resolutions.data === undefined)) {
      return { kind: SWAP_SCREEN_LOADING };
    }

    return {
      kind: SWAP_SCREEN_WAITING,
      facts,
      past: swapPastOf(swap, calendarTodayOf(snapshot, now)),
      stale: swapStaleOf(snapshot, swap),
      // A STALE SWAP STILL SHOWS what can be derived (none when the change itself is refused).
      preview: previewUnreadable
        ? null
        : guardedPreviewOf(snapshot, swap, sources.records.data ?? [], sources.resolutions.data ?? []),
    };
  }

  if (swap.decision === null) return { kind: SWAP_SCREEN_CLOSED, facts, line: null };

  const actors = readStateOf(sources.actors);

  if (actors !== null) return { kind: actors };

  return { kind: SWAP_SCREEN_CLOSED, facts, line: decidedLineOf(swap, sources.actors.data ?? [], snapshot.timeZone) };
}

/**
 * The screen's reads as one snapshot (story 8.2): the swaps and the calendar
 * for every swap; for a waiting one the organization's live leave and
 * resolutions too; for a decided one the acting admins' names.
 */
export function swapDecisionSurfaceKeysOf(waiting: boolean, decided: boolean): readonly QueryKey[] {
  return [
    ORGANIZATION_SWAP_REQUESTS_KEY,
    CALENDAR_KEY,
    ...(waiting ? [ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY] : []),
    ...(decided ? [ACTING_ADMINS_KEY] : []),
  ];
}

// ------------------------------------------------------------------ the words

/** A swap's status as the screen's badge says it. Exhaustive. */
export function swapStatusMessageKey(
  status: SwapStatus,
):
  | 'zaOdluku.swap.status.waitingDecision'
  | 'zaOdluku.swap.status.waitingColleague'
  | 'zaOdluku.swap.status.approved'
  | 'zaOdluku.swap.status.rejected'
  | 'zaOdluku.swap.status.deactivated'
  | 'zaOdluku.swap.status.withdrawn'
  | 'zaOdluku.swap.status.declined' {
  switch (status) {
    case SWAP_ACCEPTED:
      return 'zaOdluku.swap.status.waitingDecision';
    case SWAP_PROPOSED:
      return 'zaOdluku.swap.status.waitingColleague';
    case SWAP_APPROVED:
      return 'zaOdluku.swap.status.approved';
    case SWAP_REJECTED:
      return 'zaOdluku.swap.status.rejected';
    case SWAP_DEACTIVATED:
      return 'zaOdluku.swap.status.deactivated';
    case SWAP_WITHDRAWN:
      return 'zaOdluku.swap.status.withdrawn';
    case SWAP_DECLINED:
      return 'zaOdluku.swap.status.declined';
    default: {
      const unhandled: never = status;

      return unhandled;
    }
  }
}

// ---------------------------------------------------------------- the erasure

/** The swap no longer applies over fresh reads: approval is refused as stale, and the screen read again. */
export const SWAP_DECISION_STALE = 'stale';

/** One run of the approval's erasure check (AD-5). */
export type SwapErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: typeof SWAP_DECISION_STALE }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

/**
 * THE APPROVAL'S ERASURE CHECK over `read`'s fresh answer: stale is refused
 * before anything is derived; otherwise the swap's two-change "after" is
 * diffed with `erasuresOf` from the EARLIER of its dates. Never throws:
 * anything that goes wrong — offline included — is unavailable, logged, and
 * the approval is refused with a retry; nothing is written unchecked.
 */
export async function swapErasureCheckOf(
  read: () => Promise<ErasureReads>,
  swap: OrganizationSwap,
  online: boolean,
): Promise<SwapErasureCheck> {
  return checkedOf(
    read,
    ({ calendar, records, resolutions }): SwapErasureCheck => {
      if (swapStaleOf(calendar, swap)) return { kind: CHECK_REFUSED, code: SWAP_DECISION_STALE };

      const applied = swapAppliedOf(calendar, swap);

      if (!applied.ok) return { kind: CHECK_REFUSED, code: SWAP_DECISION_STALE };

      const outcome = erasuresOutcomeOf(() =>
        erasuresOf(calendar, applied.after, swapFirstDateOf(swap), records, resolutions),
      );

      return outcome.ok ? { kind: CHECK_READY, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}

// ---------------------------------------------------------------- the decision

/** The admin's decision (0049). */
export const DECIDE_SWAP_REQUEST_FUNCTION = 'decide_swap_request';

/** *Odobri* and *Odbij*, as 0049's `p_outcome`. */
export type SwapDecisionChoice = typeof SWAP_APPROVED | typeof SWAP_REJECTED;

/** No longer waiting (P0002): withdrawn, or decided by another admin, in the meantime. */
export const SWAP_DECISION_NOT_WAITING = 'notWaiting';
/** Not allowed (42501): not an active admin. */
export const SWAP_DECISION_DENIED = 'denied';
/** A member is inactive on a date of it (55000): the swap stays accepted, to be rejected. */
export const SWAP_DECISION_MEMBER_INACTIVE = 'memberInactive';
/** A live override already holds a key the approval writes (23505): the roster changed, reject it. */
export const SWAP_DECISION_TAKEN = 'taken';
/** A team of it was archived (23514): reject it. */
export const SWAP_DECISION_ARCHIVED = 'archived';
/** Anything else — the network, a malformed answer: try again. */
export const SWAP_DECISION_FAILED = 'failed';

export type SwapDecisionFailure =
  | typeof SWAP_DECISION_NOT_WAITING
  | typeof SWAP_DECISION_DENIED
  | typeof SWAP_DECISION_MEMBER_INACTIVE
  | typeof SWAP_DECISION_TAKEN
  | typeof SWAP_DECISION_ARCHIVED
  | typeof SWAP_DECISION_FAILED
  | typeof SWAP_DECISION_STALE;

export type SwapDecisionOutcome = { readonly ok: true } | { readonly ok: false; readonly code: SwapDecisionFailure };

export interface SwapDecisionError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The definer call, named structurally so it can be stubbed. */
export interface DecideSwapRequestRpc {
  rpc(fn: string, args: Readonly<Record<string, unknown>>): PromiseLike<{ readonly error: SwapDecisionError | null }>;
}

/** The SQLSTATEs and messages 0049's decision and the override insert refuse with. */
const REFUSALS: readonly { readonly code: string; readonly message: string | null; readonly failure: SwapDecisionFailure }[] = [
  { code: 'P0002', message: 'SWAP_REQUEST_NOT_OPEN', failure: SWAP_DECISION_NOT_WAITING },
  { code: '42501', message: 'SWAP_REQUEST_DECISION_REFUSED', failure: SWAP_DECISION_DENIED },
  { code: '55000', message: 'SWAP_REQUEST_MEMBER_INACTIVE', failure: SWAP_DECISION_MEMBER_INACTIVE },
  { code: '23505', message: null, failure: SWAP_DECISION_TAKEN },
];

/** 23514 is any check; 0036 names the archived team's own, and only that one is "archived". */
const CHECK_VIOLATION = '23514';
const ROSTER_OVERRIDE_ARCHIVED = 'ROSTER_OVERRIDE_ARCHIVED';

/**
 * A refused decision by SQLSTATE, or by 0049's message when the code is
 * missing: P0002 no longer waiting, 42501 not allowed, 55000 a member
 * inactive, 23505 the roster already changed, 23514 with 0036's
 * `ROSTER_OVERRIDE_ARCHIVED` an archived team (any other check is failed);
 * anything else failed.
 */
export function swapDecisionFailureOf(error: SwapDecisionError): SwapDecisionFailure {
  if (error.message === ROSTER_OVERRIDE_ARCHIVED) return SWAP_DECISION_ARCHIVED;
  if (error.code === CHECK_VIOLATION) return SWAP_DECISION_FAILED;

  const byCode = REFUSALS.find((refusal) => refusal.code === error.code);

  if (byCode !== undefined) return byCode.failure;

  const byMessage = REFUSALS.find((refusal) => refusal.message !== null && refusal.message === error.message);

  return byMessage?.failure ?? SWAP_DECISION_FAILED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * *Odobri* or *Odbij* on `requestId`: 0049's definer, which decides who may
 * decide what. An approval sends `reason` (*Odobrena zamjena*, the overrides'
 * free-text reason, 0026); a rejection sends none. NOTHING IS CHECKED HERE
 * and nothing is optimistic; the caller re-reads after any outcome.
 */
export async function decideSwapRequest(
  client: DecideSwapRequestRpc,
  requestId: string,
  choice: SwapDecisionChoice,
  reason: string | null,
): Promise<SwapDecisionOutcome> {
  let answered: unknown;

  try {
    answered = await client.rpc(DECIDE_SWAP_REQUEST_FUNCTION, {
      p_request_id: requestId,
      p_outcome: choice,
      p_reason: choice === SWAP_APPROVED ? reason : null,
    });
  } catch (cause) {
    console.error(SWAP_DECISION_FAILED, cause);

    return { ok: false, code: SWAP_DECISION_FAILED };
  }

  if (!isRecord(answered)) {
    console.error(SWAP_DECISION_FAILED, typeof answered);

    return { ok: false, code: SWAP_DECISION_FAILED };
  }

  const error: unknown = answered['error'];

  if (error === null) return { ok: true };
  if (!isRecord(error)) {
    console.error(SWAP_DECISION_FAILED, typeof error);

    return { ok: false, code: SWAP_DECISION_FAILED };
  }

  const code = swapDecisionFailureOf(error as SwapDecisionError);

  if (code === SWAP_DECISION_FAILED) console.error(code, (error as SwapDecisionError).code);

  return { ok: false, code };
}

/**
 * What a decision's outcome makes stale, besides the organization's swaps
 * (the caller's own key): a landed decision, and every refusal that says the
 * swap or the roster moved, re-read everything an approval changes
 * (`SWAP_REQUEST_DECISION_DEPENDENTS`); a refusal of the session, or a
 * failure, nothing more.
 */
export function swapDecisionRefreshKeysOf(outcome: SwapDecisionChoice | SwapDecisionFailure): readonly QueryKey[] {
  switch (outcome) {
    case SWAP_APPROVED:
    case SWAP_REJECTED:
    case SWAP_DECISION_NOT_WAITING:
    case SWAP_DECISION_MEMBER_INACTIVE:
    case SWAP_DECISION_TAKEN:
    case SWAP_DECISION_ARCHIVED:
    case SWAP_DECISION_STALE:
      return SWAP_REQUEST_DECISION_DEPENDENTS;
    case SWAP_DECISION_DENIED:
    case SWAP_DECISION_FAILED:
      return NO_DEPENDENTS;
    default: {
      const unhandled: never = outcome;

      return unhandled;
    }
  }
}

/** The refusal of a decision as its alert's line. Exhaustive. */
export function swapDecisionFailureMessageKey(
  code: SwapDecisionFailure,
):
  | 'zaOdluku.swap.notWaiting'
  | 'zaOdluku.swap.denied'
  | 'zaOdluku.swap.memberInactive'
  | 'zaOdluku.swap.taken'
  | 'zaOdluku.swap.archived'
  | 'zaOdluku.swap.failed'
  | 'zaOdluku.swap.stale' {
  switch (code) {
    case SWAP_DECISION_NOT_WAITING:
      return 'zaOdluku.swap.notWaiting';
    case SWAP_DECISION_DENIED:
      return 'zaOdluku.swap.denied';
    case SWAP_DECISION_MEMBER_INACTIVE:
      return 'zaOdluku.swap.memberInactive';
    case SWAP_DECISION_TAKEN:
      return 'zaOdluku.swap.taken';
    case SWAP_DECISION_ARCHIVED:
      return 'zaOdluku.swap.archived';
    case SWAP_DECISION_FAILED:
      return 'zaOdluku.swap.failed';
    case SWAP_DECISION_STALE:
      return 'zaOdluku.swap.stale';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}
