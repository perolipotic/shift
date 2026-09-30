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
 * team's first rotation version there is nothing to override: such an
 * override is PENDING (story 3.5c), never applied, and the date stays without
 * a rotation. So is one a later rotation change left behind.
 * {@link overrideStandingOf} splits the live overrides into those in force
 * and those waiting for the admin's disposition, and callers pass only the
 * ones in force to the derivations below.
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
 * is not applied (it is pending, story 3.5c).
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

/**
 * When one rotation version was saved (story 3.5c): the version of team
 * `teamId` effective from `effectiveFrom` was created at `createdAt`, an
 * integer instant (µs since the epoch) parsed at the edge — no `Date` enters
 * here, and the database's own precision is kept.
 */
export interface RotationVersionStamp {
  readonly teamId: string;
  readonly effectiveFrom: string;
  readonly createdAt: number;
}

/**
 * Any live override — a shift-type one (story 3.5a) or a roster one (story
 * 3.6a) — as the pending rule reads it: its identity, the team and date it
 * changes, and the instant it was written, as an integer instant (µs since the
 * epoch). A shift-type override's is its `confirmedAt` when an admin confirmed
 * it, else its `createdAt`; a roster override's is its `createdAt`.
 */
export interface StampedOverride {
  readonly id: string;
  readonly teamId: string;
  readonly date: string;
  readonly writtenAt: number;
}

/** A live shift-type override with its identity and the instant it was written or last confirmed. */
export interface StampedShiftTypeOverride extends ShiftTypeOverride, StampedOverride {}

/** Every live override, split into those applied and those waiting for the admin's disposition. */
export interface OverrideStanding<Override extends StampedOverride> {
  readonly inForce: readonly Override[];
  readonly pending: readonly Override[];
}

function checkInstant(label: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} ${String(value)}, which is not an integer instant (µs)`);
  }
}

/**
 * Which live overrides are IN FORCE and which are PENDING the admin's
 * disposition after a rotation change (story 3.5c; CAP-9).
 *
 * An override is pending when no rotation version of its team governs its date
 * — there is no rotation to override there — or when the version governing it,
 * the one with the greatest `effectiveFrom` on or before the date (the rule of
 * `rotationAssignmentOn`), was created AFTER the override was written or last
 * confirmed: the shift it was written for is no longer the one projected.
 * Every other override is in force. Only the in-force ones are applied.
 *
 * Nothing is stored: cancelling a scheduled change deletes its versions, the
 * earlier version governs again, and it predates the override. Both lists keep
 * the order of `overrides`.
 *
 * ONE RULE FOR BOTH LAYERS (story 3.6a): a roster override is pending by the
 * same rule, over its `createdAt`. How many overrides one team and date may
 * carry is each layer's own precondition — one shift-type override
 * ({@link overridesByTeamAndDate}), and one roster override per member taken
 * off or put on — so it is checked by the callers of each layer, not here.
 *
 * @throws RangeError when a date or `effectiveFrom` is not a calendar
 *   `YYYY-MM-DD`, when an instant is not an integer, or when two versions of
 *   one team share an `effectiveFrom`.
 */
export function overrideStandingOf<Override extends StampedOverride>(
  versions: readonly RotationVersionStamp[],
  overrides: readonly Override[],
): OverrideStanding<Override> {
  const byTeam = new Map<string, RotationVersionStamp[]>();
  const seen = new Set<string>();
  for (const version of versions) {
    checkDate(`a rotation version of team ${version.teamId} is effective from`, version.effectiveFrom);
    checkInstant(`the rotation version of team ${version.teamId} from ${version.effectiveFrom} was created at`, version.createdAt);
    const key = keyOf(version.teamId, version.effectiveFrom);
    if (seen.has(key)) {
      throw new RangeError(`two rotation versions of team ${version.teamId} are effective from ${version.effectiveFrom}`);
    }
    seen.add(key);
    const team = byTeam.get(version.teamId);
    if (team === undefined) byTeam.set(version.teamId, [version]);
    else team.push(version);
  }
  const inForce: Override[] = [];
  const pending: Override[] = [];
  for (const override of overrides) {
    checkDate(`override ${override.id} of team ${override.teamId} is dated`, override.date);
    checkInstant(`override ${override.id} was written at`, override.writtenAt);
    let governing: RotationVersionStamp | null = null;
    for (const version of byTeam.get(override.teamId) ?? []) {
      if (version.effectiveFrom <= override.date && (governing === null || version.effectiveFrom > governing.effectiveFrom)) {
        governing = version;
      }
    }
    if (governing === null || governing.createdAt > override.writtenAt) pending.push(override);
    else inForce.push(override);
  }
  return { inForce, pending };
}
