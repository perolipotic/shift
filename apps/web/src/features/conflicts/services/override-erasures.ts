import { scheduledShiftTypeOn } from '@shift/domain';

import type { CalendarOverride, CalendarSnapshot } from '@/features/calendar/services/snapshot';
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
 * THE SHIFT-TYPE OVERRIDE'S ERASURE GUARD, SURFACE-NEUTRAL (story 5.5f;
 * AD-5, UX-DR23): the "after" snapshot of every shift-type override write —
 * set, remove, confirm and amend — over the shared diff of
 * `@/features/conflicts/services/erasures`, and one run of the check, as a
 * `.ts` the node suite executes (AD-15). Renders nothing and declares no key.
 * The calendar's day detail guards its set and remove with it; the rotation
 * builder's override review (5.5h) is left to wire confirm and amend.
 *
 * A non-working override on a working day, or removing one that made a
 * non-working day working, takes every rostered member on leave off a
 * working shift: their unresolved conflicts would leave the queue unasked.
 *
 * "AFTER" IS THE SNAPSHOT AS THE WRITE WOULD LEAVE IT, ALWAYS A NEW OBJECT
 * (the calendar's standings are cached per snapshot object):
 *
 * - SET (0019's insert) appends an override written NEWER than every instant
 *   the snapshot holds and never confirmed, so it is in force wherever a
 *   rotation version governs the date (`overrideStandingOf`);
 * - REMOVE (0021) filters the override out by id;
 * - CONFIRM (0022) gives it a `confirmedAt` newer than every instant, which
 *   re-anchors it to the version in force;
 * - AMEND (0022) soft-removes it and inserts a new one with the same team and
 *   date, the new type, and a `createdAt` newer than every instant.
 *
 * The diff runs from the override's date on.
 *
 * REFUSED BEFORE DERIVING, judged on the fresh snapshot, as the database
 * would refuse the write anyway: a set whose team and date a live override
 * already holds ({@link OVERRIDE_CHANGE_TAKEN}, 23505); a remove, confirm or
 * amend of an override no longer live ({@link OVERRIDE_CHANGE_GONE}, P0002);
 * a confirm or amend on an archived team or type
 * ({@link OVERRIDE_CHANGE_ARCHIVED}, 0022's own refusal); an amend to the
 * type the rotation itself projects for the date
 * ({@link OVERRIDE_CHANGE_SAME_AS_PROJECTED}, the amend's preflight). Nothing else is a
 * refusal: any other fault surfaces from the diff, and the check is then
 * unavailable.
 */

/** Setting an override on a team and date (0019's insert). */
export const OVERRIDE_CHANGE_SET = 'set';
/** Removing a live override, by id (0021's `remove_shift_type_override`). */
export const OVERRIDE_CHANGE_REMOVE = 'remove';
/** Confirming a live override after a rotation change (0022's `confirm_shift_type_override`). */
export const OVERRIDE_CHANGE_CONFIRM = 'confirm';
/** Amending a live override to another type (0022's `amend_shift_type_override`). */
export const OVERRIDE_CHANGE_AMEND = 'amend';

export interface OverrideSetChange {
  readonly kind: typeof OVERRIDE_CHANGE_SET;
  readonly teamId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly shiftTypeId: string;
}

export interface OverrideRemoveChange {
  readonly kind: typeof OVERRIDE_CHANGE_REMOVE;
  readonly overrideId: string;
}

export interface OverrideConfirmChange {
  readonly kind: typeof OVERRIDE_CHANGE_CONFIRM;
  readonly overrideId: string;
}

export interface OverrideAmendChange {
  readonly kind: typeof OVERRIDE_CHANGE_AMEND;
  readonly overrideId: string;
  /** The type the amended override names. */
  readonly shiftTypeId: string;
}

export type OverrideChange = OverrideSetChange | OverrideRemoveChange | OverrideConfirmChange | OverrideAmendChange;

/** A live override of the team on the date already holds it (23505): the calendar's `taken`. */
export const OVERRIDE_CHANGE_TAKEN = 'taken';
/** The override is no longer live (P0002): the calendar's and the review's `gone`. */
export const OVERRIDE_CHANGE_GONE = 'gone';
/** The team, or the type the override would name, is archived (0022): the review's `archived`. */
export const OVERRIDE_CHANGE_ARCHIVED = 'archived';

/**
 * An amend to the type the rotation projects for the date: the amend's
 * preflight refuses it (the review's `sameAsProjected`, as the calendar's
 * form refuses a set of it), so it is never derived.
 */
export const OVERRIDE_CHANGE_SAME_AS_PROJECTED = 'sameAsProjected';

/** Why the write would be refused anyway: the write's own refusal code. */
export type OverrideChangeRefusal =
  | typeof OVERRIDE_CHANGE_TAKEN
  | typeof OVERRIDE_CHANGE_GONE
  | typeof OVERRIDE_CHANGE_ARCHIVED
  | typeof OVERRIDE_CHANGE_SAME_AS_PROJECTED;

/** The id the "after" snapshot gives an override not yet written: never a database id. */
export const UNWRITTEN_OVERRIDE_ID = 'unwritten-shift-type-override';

export type OverrideChangeApplied =
  | { readonly ok: true; readonly after: CalendarSnapshot; readonly from: string }
  | { readonly ok: false; readonly code: OverrideChangeRefusal };

/** Whether the team, or the type, is archived in the snapshot. */
function archivedIn(calendar: CalendarSnapshot, teamId: string, shiftTypeId: string): boolean {
  return (
    calendar.teams.some((team) => team.id === teamId && team.archived) ||
    calendar.types.some((type) => type.id === shiftTypeId && type.archived)
  );
}

/**
 * The type the rotation alone projects for `teamId` on `date`, no override
 * applied; `null` where no version governs the date.
 *
 * @throws RangeError on any precondition of `scheduledShiftTypeOn`.
 */
function projectedTypeIdOf(calendar: CalendarSnapshot, teamId: string, date: string): string | null {
  const scheduled = scheduledShiftTypeOn(
    calendar.assignments.filter((assignment) => assignment.teamId === teamId),
    calendar.steps,
    [],
    teamId,
    date,
  );

  return scheduled === null ? null : scheduled.projectedShiftTypeId;
}

/**
 * The calendar snapshot as `change` would leave it, and the date the diff
 * runs from — or the refusal the write would meet anyway. A new object, so
 * the calendar's per-snapshot standings are worked out afresh for it.
 *
 * @throws RangeError when the snapshot's latest instant plus one is not an
 *   instant `isoInstantOf` can write (never for a snapshot the read admitted),
 *   or on any precondition of the amend's projection.
 */
export function overrideChangeSnapshotOf(calendar: CalendarSnapshot, change: OverrideChange): OverrideChangeApplied {
  if (change.kind === OVERRIDE_CHANGE_SET) {
    const taken = calendar.overrides.some((override) => override.teamId === change.teamId && override.date === change.date);

    if (taken) return { ok: false, code: OVERRIDE_CHANGE_TAKEN };

    const added: CalendarOverride = {
      id: UNWRITTEN_OVERRIDE_ID,
      teamId: change.teamId,
      date: change.date,
      shiftTypeId: change.shiftTypeId,
      reason: '',
      createdAt: isoInstantOf(latestInstantOf(calendar) + 1),
      confirmedAt: null,
      authorMemberId: null,
    };

    return { ok: true, after: { ...calendar, overrides: [...calendar.overrides, added] }, from: change.date };
  }

  const changed = calendar.overrides.find((override) => override.id === change.overrideId);

  if (changed === undefined) return { ok: false, code: OVERRIDE_CHANGE_GONE };

  const others = calendar.overrides.filter((override) => override.id !== changed.id);

  if (change.kind === OVERRIDE_CHANGE_REMOVE) {
    return { ok: true, after: { ...calendar, overrides: others }, from: changed.date };
  }

  const shiftTypeId = change.kind === OVERRIDE_CHANGE_AMEND ? change.shiftTypeId : changed.shiftTypeId;

  if (archivedIn(calendar, changed.teamId, shiftTypeId)) return { ok: false, code: OVERRIDE_CHANGE_ARCHIVED };
  if (change.kind === OVERRIDE_CHANGE_AMEND && shiftTypeId === projectedTypeIdOf(calendar, changed.teamId, changed.date)) {
    return { ok: false, code: OVERRIDE_CHANGE_SAME_AS_PROJECTED };
  }

  const newest = isoInstantOf(latestInstantOf(calendar) + 1);
  const written: CalendarOverride =
    change.kind === OVERRIDE_CHANGE_CONFIRM
      ? { ...changed, confirmedAt: newest }
      : {
          ...changed,
          id: UNWRITTEN_OVERRIDE_ID,
          shiftTypeId,
          reason: '',
          createdAt: newest,
          confirmedAt: null,
          authorMemberId: null,
        };

  return { ok: true, after: { ...calendar, overrides: [...others, written] }, from: changed.date };
}

export type OverrideErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: OverrideChangeRefusal }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

/**
 * The check of `change` over `read`'s answer (the three core reads, fresh).
 * Never throws: anything that goes wrong is unavailable, and logged. A write
 * refused anyway answers `refused`, and the surface takes the write's own
 * refusal path, never "cannot check".
 */
export async function overrideErasureCheckOf(
  read: () => Promise<ErasureReads>,
  change: OverrideChange,
  online: boolean,
): Promise<OverrideErasureCheck> {
  return checkedOf(
    read,
    ({ calendar, records, resolutions }): OverrideErasureCheck => {
      const applied = overrideChangeSnapshotOf(calendar, change);

      if (!applied.ok) return { kind: CHECK_REFUSED, code: applied.code };

      const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, applied.after, applied.from, records, resolutions));

      return outcome.ok ? { kind: CHECK_READY, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}
