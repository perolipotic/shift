import {
  collisionsOf,
  monthOf,
  unresolvedCollisionsOf,
  type Collision,
  type CollisionResolution,
  type LeaveRange,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/marks';
import {
  collisionInputOf,
  resolutionsOf,
  unresolvedOf,
  type LeaveRowsAnswer,
} from '@/features/conflicts/services/conflicts-queue';
import { effectiveResolutionsOf } from '@/features/conflicts/services/replacement-effect';
import {
  acceptedUncoveredOf,
  conflictResolutionsOf,
  leaveHoursKeysOf,
  type ConflictResolution,
} from '@/features/conflicts/services/resolutions';
import { leaveRecordsOf, organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';

/**
 * *Sati*'s unresolved-conflict count (story 5.3d; FR-41, Epic 4 retro R1),
 * as a pure model in a `.ts` that renders nothing (AD-15). The hook only
 * wires the leave read; `./my-hours`, `./organization-hours` and
 * `./hours-export` carry the count beside the figures.
 *
 * DERIVED, NEVER STORED (AD-4). The collisions are `collisionsOf`'s, from the
 * calendar's one snapshot and the live leave the viewer's role reads, through
 * *Raspored*'s own recipe (`collisionInputOf`) — so *Sati* counts exactly what
 * the queue lists and the calendar marks. An admin's are the organization's;
 * a member's are their own, from `my_leave_records()` parsed against their
 * own id: no other member's leave ever reaches them.
 *
 * ONLY THE UNRESOLVED (story 5.4a). The live resolutions the viewer's role
 * reads — the organization's for an admin, the viewer's own from
 * `my_conflict_resolutions()`, parsed against their own id, for a member —
 * drop each collision they match, through the domain's one filter
 * (`unresolvedCollisionsOf`), as the queue's do.
 *
 * THE COUNT CHANGES NO FIGURE (human, 2026-10-01). A shift in conflict still
 * counts in band hours, total and shift count; the count stands beside them.
 *
 * AN ACCEPTED-UNCOVERED OR REPLACED SHIFT IS LEAVE (stories 5.4b, 5.4c). The
 * same resolution rows name the conflicts accepted as uncovered and those
 * resolved by a replacement that still applies (story 5.5d: one whose
 * override is removed, pending or inert counts for nothing, and the shift is
 * band hours and a conflict again) ({@link hoursLeaveKeysOf}); the domain moves each
 * one's shift out of the absent member's band hours, total and shift count
 * (its `leaveMinutes`, shown nowhere: since 2026-10-10 the shift counts only
 * as its leave day). A replacement's own band hours rise through its roster
 * override, with no code here. No other kind does either.
 *
 * THE LEAVE RECORDS RIDE ALONG (leave in days, 2026-10-10). The records the
 * collisions are found from — the same one parse ({@link hoursLeaveOf})
 * — are handed on by member, so the leave figure's days are the domain's
 * charged leave days (`leaveDaysOfMonth`) over the records *Sati* already
 * read: no second read and no second parse.
 *
 * NEVER FIGURES WITHOUT THE COUNT. *Sati* waits for the leave and resolution
 * reads: one that failed, is paused offline, or answered a row that cannot be
 * trusted — and any `RangeError` of the derivation — make *Sati* unavailable,
 * logged.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** TanStack Query's name for a fetch in flight. */
export const FETCH_FETCHING = 'fetching';

/** Still waiting on the leave or resolution read. */
export const HOURS_CONFLICTS_LOADING = 'loading';
/** A read failed, or what it answered cannot be trusted. */
export const HOURS_CONFLICTS_UNAVAILABLE = 'unavailable';
/** The collisions, ready to count. */
export const HOURS_CONFLICTS_READY = 'ready';

export type HoursConflictsState =
  | { readonly kind: typeof HOURS_CONFLICTS_LOADING }
  | {
      readonly kind: typeof HOURS_CONFLICTS_UNAVAILABLE;
      /**
       * Whether reading again can change the answer: true for a read that
       * failed or is paused offline; false for rows that cannot be trusted or
       * a derivation the domain refused, which the same rows would repeat.
       */
      readonly retryable: boolean;
    }
  | {
      readonly kind: typeof HOURS_CONFLICTS_READY;
      readonly collisions: readonly Collision[];
      /**
       * The keys whose absent member's shift counts as leave — accepted as
       * uncovered (story 5.4b) or replaced (story 5.4c) — the viewer reads:
       * every member's for an admin, their own for a member.
       */
      readonly leaveKeys: readonly CollisionResolution[];
      /**
       * Those of {@link leaveKeys} accepted as uncovered; the rest were
       * replaced. The leave's ⓘ names the decision on a decided date's line.
       */
      readonly acceptedKeys: readonly CollisionResolution[];
      /** The live leave records the viewer reads, by member: every member's for an admin, their own for a member. */
      readonly leaveRecords: LeaveRecordsByMember;
    };

/** Leave records by member id; a member with none is absent. */
export type LeaveRecordsByMember = ReadonlyMap<string, readonly LeaveRange[]>;

/** No leave records at all. */
export const NO_LEAVE_RECORDS: LeaveRecordsByMember = new Map();

/** A member's records in {@link LeaveRecordsByMember}: none for a member with none. */
export function leaveRecordsIn(records: LeaveRecordsByMember, memberId: string): readonly LeaveRange[] {
  return records.get(memberId) ?? [];
}

/** What *Sati* takes from the leave rows, parsed once: the unresolved collisions and the records they came from. */
export interface HoursLeave {
  readonly collisions: readonly Collision[];
  /** The live leave records the viewer reads, by member. */
  readonly leaveRecords: LeaveRecordsByMember;
}

/** Records as {@link LeaveRecordsByMember}: each member's ranges, in the order read. */
function byMemberOf(records: readonly { readonly memberId: string; readonly from: string; readonly to: string }[]): LeaveRecordsByMember {
  const byMember = new Map<string, LeaveRange[]>();

  for (const { memberId, from, to } of records) {
    const own = byMember.get(memberId);

    if (own === undefined) byMember.set(memberId, [{ from, to }]);
    else own.push({ from, to });
  }

  return byMember;
}

/**
 * The UNRESOLVED collisions the viewer may count, from the snapshot and the
 * leave and resolution rows their role read, as they came back: every
 * member's for an admin, the viewer's own for a member — and, from the same
 * one parse of the leave rows, the records by member, which the leave
 * figure's charged days are counted over.
 *
 * @throws RangeError when a row cannot be trusted, or on any precondition of
 *   `collisionsOf`.
 */
export function hoursLeaveOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
): HoursLeave {
  const viewer = snapshot.viewer;

  if (!readsOrganizationLeave(viewer.role)) {
    const own = leaveRecordsOf(rows, viewer.memberId);

    if (own === null) throw new RangeError('an own leave record row cannot be trusted');

    const resolutions = conflictResolutionsOf(
      resolutionRows,
      [viewer.memberId],
      snapshot.teams.map((team) => team.id),
      // A member's read from before 0033 answers no link.
      { linkOptional: true },
    );

    if (resolutions === null) throw new RangeError('an own conflict resolution row cannot be trusted');

    const records = own.map((record) => ({ ...record, memberId: viewer.memberId }));

    // THE SAME FUNNEL as the admin's (story 5.5d): a replacement that no
    // longer applies hides nothing, so a member's own *Sati* agrees.
    return {
      collisions: unresolvedCollisionsOf(
        collisionsOf(collisionInputOf(snapshot, records)),
        effectiveResolutionsOf(snapshot, resolutions),
      ),
      leaveRecords: byMemberOf(records),
    };
  }

  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  return { collisions: unresolvedOf(snapshot, records, resolutionRows), leaveRecords: byMemberOf(records) };
}

/**
 * The live resolutions that still apply, of the rows the viewer's role read,
 * parsed as {@link hoursLeaveOf} parses them: every member's for an admin,
 * the viewer's own for a member.
 *
 * @throws RangeError when a row cannot be trusted.
 */
function hoursResolutionsOf(snapshot: CalendarSnapshot, resolutionRows: readonly unknown[]): readonly ConflictResolution[] {
  const viewer = snapshot.viewer;

  if (readsOrganizationLeave(viewer.role)) return resolutionsOf(snapshot, resolutionRows);

  const own = conflictResolutionsOf(
    resolutionRows,
    [viewer.memberId],
    snapshot.teams.map((team) => team.id),
    { linkOptional: true },
  );

  if (own === null) throw new RangeError('an own conflict resolution row cannot be trusted');

  return effectiveResolutionsOf(snapshot, own);
}

/**
 * The keys whose absent member's shift is moved out of the worked hours
 * (stories 5.4b, 5.4c: accepted as uncovered, or replaced), through
 * `leaveHoursKeysOf`, of the rows the viewer's role read.
 *
 * @throws RangeError when a row cannot be trusted.
 */
export function hoursLeaveKeysOf(snapshot: CalendarSnapshot, resolutionRows: readonly unknown[]): readonly CollisionResolution[] {
  return leaveHoursKeysOf(hoursResolutionsOf(snapshot, resolutionRows));
}

/** Whether a read failed or is paused offline, a failed refetch over cached rows included. */
function readFailed(answer: LeaveRowsAnswer): boolean {
  return answer.isError || answer.fetchStatus === FETCH_PAUSED || (!answer.isPending && answer.data === undefined);
}

/**
 * What the leave and resolution reads give *Sati* once the snapshot is in:
 * loading while a failed read is read again — TanStack Query keeps `isError`
 * while the retry is in flight, so the message would otherwise stand
 * unchanged under the press — and while either is pending, a role-gated read
 * not yet enabled included; unavailable when either failed or is paused
 * offline — a failed refetch over cached rows included — or its rows are
 * refused; otherwise the unresolved collisions. A `RangeError` is logged and
 * is unavailable; nothing else is caught.
 */
export function hoursConflictsStateOf(
  snapshot: CalendarSnapshot,
  answer: LeaveRowsAnswer,
  resolutions: LeaveRowsAnswer,
): HoursConflictsState {
  const answers = [answer, resolutions];

  if (answers.some((one) => one.isError && one.fetchStatus === FETCH_FETCHING)) return { kind: HOURS_CONFLICTS_LOADING };

  if (answers.some(readFailed)) return { kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: true };

  if (answer.data === undefined || resolutions.data === undefined) return { kind: HOURS_CONFLICTS_LOADING };

  try {
    const { collisions, leaveRecords } = hoursLeaveOf(snapshot, answer.data, resolutions.data);
    const decided = hoursResolutionsOf(snapshot, resolutions.data);

    return {
      kind: HOURS_CONFLICTS_READY,
      collisions,
      leaveKeys: leaveHoursKeysOf(decided),
      acceptedKeys: acceptedUncoveredOf(decided),
      leaveRecords,
    };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(HOURS_CONFLICTS_UNAVAILABLE, cause);

    return { kind: HOURS_CONFLICTS_UNAVAILABLE, retryable: false };
  }
}

/** Each member's collisions of one month, counted once per surface: {@link conflictCountsOf}. */
export type ConflictCounts = ReadonlyMap<string, number>;

/**
 * THE ONE COUNT: every member's collisions dated in `month` (`YYYY-MM`),
 * walked once, so a table of every member looks each row up rather than
 * walking the collisions again. One collision is one rostered working shift,
 * so a member put on a second team's shift that date counts twice.
 */
export function conflictCountsOf(collisions: readonly Collision[], month: string): ConflictCounts {
  const counts = new Map<string, number>();

  for (const collision of collisions) {
    if (monthOf(collision.date) === month) counts.set(collision.memberId, (counts.get(collision.memberId) ?? 0) + 1);
  }

  return counts;
}

/** A member's count in {@link conflictCountsOf}'s answer: 0 for a member with none. */
export function conflictCountIn(counts: ConflictCounts, memberId: string): number {
  return counts.get(memberId) ?? 0;
}

/**
 * The shifts of `memberId` that count as leave (story 5.4b): the
 * `(date, team)` of each of their accepted-uncovered keys, for the domain's
 * `leaveShifts`.
 */
export function leaveShiftsOf(
  leaveKeys: readonly CollisionResolution[],
  memberId: string,
): readonly { readonly date: string; readonly teamId: string }[] {
  return leaveKeys.filter((key) => key.memberId === memberId).map(({ date, teamId }) => ({ date, teamId }));
}

/** One member's count of `month`, for a surface that shows one member alone. */
export function conflictCountOf(collisions: readonly Collision[], memberId: string, month: string): number {
  return conflictCountIn(conflictCountsOf(collisions, month), memberId);
}
