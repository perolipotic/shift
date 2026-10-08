import { collisionKeyOf, collisionsOf, unresolvedCollisionsOf, type Collision, type LeaveRange } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { collisionInputOf, resolutionsOf } from '@/features/conflicts/services/conflicts-queue';
import type { LeaveRecord } from '@/features/leave/services/leave-list';
import type { ReplacementResolutionsSource } from '@/features/leave/services/leave-section';
import { formatIsoDayMonth, formatIsoWeekdayShortName } from '@/lib/i18n/format';

/**
 * STORY 7.12: the conflicts a leave change creates, clears and keeps, shown
 * in the leave dialog and the removal confirmation BEFORE anything is saved,
 * as a pure view model in a `.ts` that renders nothing (AD-15).
 *
 * ONE COMPUTATION. The collisions are `@shift/domain`'s `collisionsOf` over
 * *Raspored*'s own recipe (`collisionInputOf`), filtered by the one
 * resolution filter (`unresolvedCollisionsOf`) through the queue's own funnel
 * (`resolutionsOf`) — so a saved record's created conflicts are exactly the
 * rows the queue then lists for the member. Nothing here decides a collision.
 *
 * THE THREE CHANGES:
 * - A NEW RECORD: *created* is every unresolved collision of the candidate,
 *   which carries a placeholder id no stored record can carry.
 * - AN AMEND: "before" is the target's collisions over the current records,
 *   "after" the same records with the target's range replaced (same id).
 *   *Cleared* is the target's unresolved collisions "after" no longer raises,
 *   *kept* those it still raises, and *created* the unresolved collisions
 *   "after" raises that "before" did not. A resolved collision that stays
 *   covered keeps its resolution (0031 soft-removes only the uncovered
 *   dates), so it is neither kept nor cleared; every group counts only the
 *   unresolved, as the queue does.
 * - A REMOVAL: *cleared* is every unresolved collision of the record.
 *
 * NEVER A GUESS, NEVER A GATE. While the resolutions read is pending, failed,
 * paused offline or being re-read — or the calendar snapshot is being re-read
 * (`refreshing`), as a dialog's opening asks for — or when the domain or the
 * funnel throws, the answer is
 * *unknown* (logged): one neutral line, and the save stays offered. Codes and
 * operands only; the dialog formats.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';
/** TanStack Query's name for a fetch under way: over cached rows, the rows about to be replaced. */
const FETCH_FETCHING = 'fetching';

/** What a preview that cannot be trusted logs: never shown. */
export const LEAVE_CONFLICTS_UNAVAILABLE = 'LEAVE_CONFLICTS_UNAVAILABLE';

/**
 * The id a new record's candidate carries: stored ids are UUIDs, so no
 * stored record can carry this one.
 */
export const LEAVE_CANDIDATE_ID = 'leave-candidate';

/** The conflicts are known: zero or more in each group. */
export const LEAVE_CONFLICTS_KNOWN = 'known';
/** The resolutions read is pending, failed or paused, or the derivation threw: one line says so. */
export const LEAVE_CONFLICTS_UNKNOWN = 'unknown';

/** One conflict as the dialog names it: `pon 21.12. Dan`. */
export interface LeaveConflictLine {
  /** `collisionKeyOf`'s key: a line's stable identity. */
  readonly key: string;
  /** `pon`, the short weekday. */
  readonly weekday: string;
  /** `21.12.` */
  readonly date: string;
  /** The shift type's name. */
  readonly type: string;
}

export type LeaveConflicts =
  | {
      readonly kind: typeof LEAVE_CONFLICTS_KNOWN;
      /** Raised by the change and by nothing before it. */
      readonly created: readonly LeaveConflictLine[];
      /** Unresolved now, and gone once the change lands. */
      readonly cleared: readonly LeaveConflictLine[];
      /** Unresolved now, and still raised once the change lands. */
      readonly kept: readonly LeaveConflictLine[];
    }
  | { readonly kind: typeof LEAVE_CONFLICTS_UNKNOWN };

/** The change previewed: a new range, an amend of `target` to `next`, or `target`'s removal (`next` null). */
export interface LeaveConflictChange {
  /** The record amended or removed; null for a new record. */
  readonly target: LeaveRecord | null;
  /** The range the change leaves; null for a removal. */
  readonly next: LeaveRange | null;
}

/** Whether two inclusive ranges share a date. */
function overlaps(first: LeaveRange, second: LeaveRange): boolean {
  return first.from <= second.to && second.from <= first.to;
}

/**
 * The conflicts `change` would create, clear and keep for `memberId`, from
 * the organization's resolutions read, the calendar snapshot and the
 * member's live `records`.
 *
 * Null — nothing to say — for a range that shares a date with another of
 * the member's records: the domain refuses two such records, the database
 * will refuse the save, and the preview's overlap note already says so.
 * Null too for a change that is neither (no target and no range).
 *
 * `refreshing`: the calendar snapshot is being re-read, so what it holds now
 * is about to be replaced — unknown, as a re-read of the resolutions is.
 */
export function leaveConflictsOf(
  resolutions: ReplacementResolutionsSource,
  snapshot: CalendarSnapshot,
  memberId: string,
  records: readonly LeaveRecord[],
  change: LeaveConflictChange,
  refreshing = false,
): LeaveConflicts | null {
  const { target, next } = change;
  const others = target === null ? records : records.filter((record) => record.id !== target.id);

  if (next !== null && others.some((record) => overlaps(record, next))) return null;

  if (
    refreshing ||
    resolutions.isPending ||
    resolutions.isError ||
    resolutions.fetchStatus === FETCH_PAUSED ||
    resolutions.fetchStatus === FETCH_FETCHING
  ) {
    return { kind: LEAVE_CONFLICTS_UNKNOWN };
  }
  if (resolutions.data === undefined) return { kind: LEAVE_CONFLICTS_UNKNOWN };

  try {
    const resolved = resolutionsOf(snapshot, resolutions.data);
    const types = new Map(snapshot.types.map((type) => [type.id, type.name]));
    const collisionsWith = (live: readonly LeaveRecord[], id: string): readonly Collision[] =>
      collisionsOf(collisionInputOf(snapshot, live.map((record) => ({ ...record, memberId })))).filter(
        (collision) => collision.leaveRecordId === id,
      );
    const lineOf = (collision: Collision): LeaveConflictLine => {
      const weekday = formatIsoWeekdayShortName(collision.date);
      const date = formatIsoDayMonth(collision.date);
      const type = types.get(collision.shiftTypeId);

      if (weekday === null || date === null) throw new RangeError(`the date ${collision.date} cannot be formatted`);
      if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

      return { key: collisionKeyOf(collision), weekday, date, type };
    };

    if (target === null) {
      if (next === null) return null;

      const candidate = { id: LEAVE_CANDIDATE_ID, from: next.from, to: next.to };
      const created = unresolvedCollisionsOf(collisionsWith([...others, candidate], LEAVE_CANDIDATE_ID), resolved);

      return { kind: LEAVE_CONFLICTS_KNOWN, created: created.map(lineOf), cleared: [], kept: [] };
    }

    const before = collisionsWith(records, target.id);
    const unresolvedBefore = unresolvedCollisionsOf(before, resolved);

    if (next === null) {
      return { kind: LEAVE_CONFLICTS_KNOWN, created: [], cleared: unresolvedBefore.map(lineOf), kept: [] };
    }

    const after = collisionsWith([...others, { id: target.id, from: next.from, to: next.to }], target.id);
    const beforeKeys = new Set(before.map(collisionKeyOf));
    const afterKeys = new Set(after.map(collisionKeyOf));

    return {
      kind: LEAVE_CONFLICTS_KNOWN,
      created: unresolvedCollisionsOf(
        after.filter((collision) => !beforeKeys.has(collisionKeyOf(collision))),
        resolved,
      ).map(lineOf),
      cleared: unresolvedBefore.filter((collision) => !afterKeys.has(collisionKeyOf(collision))).map(lineOf),
      kept: unresolvedBefore.filter((collision) => afterKeys.has(collisionKeyOf(collision))).map(lineOf),
    };
  } catch (cause) {
    console.error(LEAVE_CONFLICTS_UNAVAILABLE, cause);

    return { kind: LEAVE_CONFLICTS_UNKNOWN };
  }
}

/** Whether the conflicts cannot be checked now: the removal confirmation then says so. */
export function leaveConflictsUnknown(conflicts: LeaveConflicts | null): boolean {
  return conflicts !== null && conflicts.kind === LEAVE_CONFLICTS_UNKNOWN;
}

/** How many unresolved conflicts a removal clears; 0 when none or unknown — the confirmation then says nothing. */
export function leaveRemoveClearsOf(conflicts: LeaveConflicts | null): number {
  return conflicts === null || conflicts.kind === LEAVE_CONFLICTS_UNKNOWN ? 0 : conflicts.cleared.length;
}
