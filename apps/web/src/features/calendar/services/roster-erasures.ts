import { ROSTER_GONE, ROSTER_TAKEN } from '@/features/calendar/services/roster-write';
import type { CalendarRosterOverride, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import {
  erasuresOf,
  erasuresOutcomeOf,
  isoInstantOf,
  latestInstantOf,
  type ErasureRow,
} from '@/features/conflicts/services/erasures';

/**
 * THE CALENDAR ROSTER CHANGE'S ERASURE GUARD (story 5.5b; AD-5, UX-DR23):
 * the "after" snapshot of the two roster-override writes of the day detail —
 * saving a change, and removing one — over the surface-neutral diff of
 * `@/features/conflicts/services/erasures`, and one run of the check, as a
 * `.ts` the node suite executes (AD-15). Renders nothing and declares no key.
 *
 * Taking a member on leave off a day's roster, or removing an override that
 * put them on, would otherwise take the unresolved conflict out of the queue
 * without anyone deciding it.
 *
 * "AFTER" IS THE SNAPSHOT AS THE WRITE WOULD LEAVE IT. A save appends the
 * change, written NEWER than every instant the snapshot holds, so it is in
 * force wherever a real insert would be (`overrideStandingOf`); a removal
 * filters the override out by id. The diff runs from the change's date on.
 */

/** The kind of a roster change saved from the day detail's form (an insert, 0026). */
export const ROSTER_CHANGE_SAVE = 'save';
/** The kind of a live roster change removed, by id (`remove_roster_override`, 0027). */
export const ROSTER_CHANGE_REMOVAL = 'removal';

/**
 * A roster change saved: the team and date of the day open, and the members
 * the preflight passed — `memberOutId` taken off, `memberInId` put on, `null`
 * for the side not chosen (never both).
 */
export interface RosterSaveChange {
  readonly kind: typeof ROSTER_CHANGE_SAVE;
  readonly teamId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly memberOutId: string | null;
  readonly memberInId: string | null;
}

/** A live roster change removed: its id alone. */
export interface RosterRemovalChange {
  readonly kind: typeof ROSTER_CHANGE_REMOVAL;
  readonly overrideId: string;
}

export type RosterChange = RosterSaveChange | RosterRemovalChange;

/** Which of the two writes a roster change is. */
export type RosterChangeKind = RosterChange['kind'];

/** The id the "after" snapshot gives a change not yet saved: never a database id. */
export const PENDING_ROSTER_CHANGE_ID = 'pending-roster-change';

/** Why the database would refuse the write anyway: the write's own refusal code. */
export type RosterChangeRefusal = typeof ROSTER_GONE | typeof ROSTER_TAKEN;

export type RosterChangeApplied =
  | { readonly ok: true; readonly after: CalendarSnapshot; readonly from: string }
  | { readonly ok: false; readonly code: RosterChangeRefusal };

/**
 * Whether a live override of the same team and date already takes
 * `memberOutId` off or puts `memberInId` on: 0026's live keys, which refuse
 * the insert (`23505`, {@link ROSTER_TAKEN}).
 */
function liveKeyTaken(overrides: readonly CalendarRosterOverride[], change: RosterSaveChange): boolean {
  return overrides.some(
    (override) =>
      override.teamId === change.teamId &&
      override.date === change.date &&
      ((change.memberOutId !== null && override.memberOutId === change.memberOutId) ||
        (change.memberInId !== null && override.memberInId === change.memberInId)),
  );
}

/**
 * The calendar snapshot as `change` would leave it, and the date the diff
 * runs from — or the refusal the write would meet anyway: a removal of an
 * override the snapshot no longer holds ({@link ROSTER_GONE}), or a save
 * that a live key already holds ({@link ROSTER_TAKEN}). Nothing else is a
 * refusal: any other fault surfaces as a `RangeError` from the diff, and the
 * check is then unavailable. A new object, so the calendar's per-snapshot
 * standings are worked out afresh for it.
 *
 * @throws RangeError when the snapshot's latest instant plus one is not an
 *   instant `isoInstantOf` can write (never for a snapshot the read admitted).
 */
export function rosterChangeSnapshotOf(calendar: CalendarSnapshot, change: RosterChange): RosterChangeApplied {
  if (change.kind === ROSTER_CHANGE_REMOVAL) {
    const removed = calendar.rosterOverrides.find((override) => override.id === change.overrideId);

    if (removed === undefined) return { ok: false, code: ROSTER_GONE };

    return {
      ok: true,
      after: { ...calendar, rosterOverrides: calendar.rosterOverrides.filter((override) => override.id !== removed.id) },
      from: removed.date,
    };
  }

  if (liveKeyTaken(calendar.rosterOverrides, change)) return { ok: false, code: ROSTER_TAKEN };

  const added: CalendarRosterOverride = {
    id: PENDING_ROSTER_CHANGE_ID,
    teamId: change.teamId,
    date: change.date,
    memberOutId: change.memberOutId,
    memberInId: change.memberInId,
    reason: '',
    createdAt: isoInstantOf(latestInstantOf(calendar) + 1),
    authorMemberId: null,
  };

  return { ok: true, after: { ...calendar, rosterOverrides: [...calendar.rosterOverrides, added] }, from: change.date };
}

export type RosterErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: RosterChangeRefusal }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

/**
 * The check of `change` over `read`'s answer (the three core reads, fresh).
 * Never throws: anything that goes wrong is unavailable, and logged. A write
 * refused anyway answers `refused`, and the day detail takes the write's own
 * refusal path, never "cannot check".
 */
export async function rosterErasureCheckOf(
  read: () => Promise<ErasureReads>,
  change: RosterChange,
  online: boolean,
): Promise<RosterErasureCheck> {
  return checkedOf(
    read,
    ({ calendar, records, resolutions }): RosterErasureCheck => {
      const applied = rosterChangeSnapshotOf(calendar, change);

      if (!applied.ok) return { kind: CHECK_REFUSED, code: applied.code };

      const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, applied.after, applied.from, records, resolutions));

      return outcome.ok ? { kind: CHECK_READY, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}
