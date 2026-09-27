/**
 * Shift-type overrides over the projection (story 3.5a; CAP-12, AD-2, DI-2).
 *
 * The schedule is the projection plus an exception layer. A shift-type
 * override records that a team worked another shift type on one date — any
 * type, a non-working one included. It is applied OVER the projection and
 * never written into a rotation row: remove every override and the schedule
 * is the pure projection again, exactly.
 *
 * An override applies only where a rotation is in effect. On a date before a
 * team's first rotation version there is nothing to override, so an override
 * there is ignored and the date stays without a rotation.
 *
 * Only live overrides reach this module: a removed one is filtered out by the
 * read, so at most one override names a team and a date. Two are a breached
 * precondition, as two rotation versions on one date are.
 *
 * Dates are `YYYY-MM-DD` strings; nothing here constructs a `Date`. The
 * engine returns ids, never prose.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate } from './calendar.js';
import { projectedShiftTypeOn, type RotationAssignment, type RotationStep } from './projection.js';

/** One live stored override (`shift_type_overrides`): `teamId` works `shiftTypeId` on `date`. */
export interface ShiftTypeOverride {
  readonly teamId: string;
  readonly date: string;
  readonly shiftTypeId: string;
}

/**
 * The shift type a team works on a date, with what the rotation projects for
 * it. `overridden` is true exactly when an override applies; the projected
 * type may then equal the scheduled one only if the override names it.
 */
export interface ScheduledShiftType {
  readonly shiftTypeId: string;
  readonly projectedShiftTypeId: string;
  readonly overridden: boolean;
}

function keyOf(teamId: string, date: string): string {
  return `${teamId}\u0000${date}`;
}

/**
 * `overrides` indexed by team and date, each date checked.
 *
 * @throws RangeError when an override's date is not a calendar `YYYY-MM-DD`,
 *   or when two overrides name one team and one date.
 */
export function overridesByTeamAndDate(
  overrides: readonly ShiftTypeOverride[],
): ReadonlyMap<string, ShiftTypeOverride> {
  const indexed = new Map<string, ShiftTypeOverride>();
  for (const override of overrides) {
    checkDate(`a shift-type override of team ${override.teamId} is dated`, override.date);
    const key = keyOf(override.teamId, override.date);
    if (indexed.has(key)) {
      throw new RangeError(`two shift-type overrides of team ${override.teamId} are dated ${override.date}`);
    }
    indexed.set(key, override);
  }
  return indexed;
}

/**
 * The scheduled type from an already projected one and the indexed overrides.
 * INTERNAL to the package's month derivations.
 */
export function applyOverride(
  indexed: ReadonlyMap<string, ShiftTypeOverride>,
  teamId: string,
  date: string,
  projectedShiftTypeId: string | null,
): ScheduledShiftType | null {
  if (projectedShiftTypeId === null) return null;
  const override = indexed.get(keyOf(teamId, date));
  if (override === undefined) {
    return { shiftTypeId: projectedShiftTypeId, projectedShiftTypeId, overridden: false };
  }
  return { shiftTypeId: override.shiftTypeId, projectedShiftTypeId, overridden: true };
}

/**
 * The shift type team `teamId` works on `date`: the override for that team
 * and date when there is one, else {@link projectedShiftTypeOn} of the team's
 * rotation `versions` — with the projected type alongside either way. `null`
 * when no rotation version is in effect on `date`; an override on such a date
 * is ignored.
 *
 * `overrides` may name any team and date; only `teamId` on `date` is read, but
 * every override is checked.
 *
 * @throws RangeError when a version belongs to another team than `teamId`,
 *   on every precondition of {@link projectedShiftTypeOn}, and on every one of
 *   {@link overridesByTeamAndDate}.
 */
export function scheduledShiftTypeOn(
  versions: readonly RotationAssignment[],
  steps: readonly RotationStep[],
  overrides: readonly ShiftTypeOverride[],
  teamId: string,
  date: string,
): ScheduledShiftType | null {
  const stranger = versions.find((version) => version.teamId !== teamId);
  if (stranger !== undefined) {
    throw new RangeError(`a rotation assignment of team ${stranger.teamId} was given for team ${teamId}`);
  }
  const indexed = overridesByTeamAndDate(overrides);
  return applyOverride(indexed, teamId, date, projectedShiftTypeOn(versions, steps, date));
}
