/**
 * Rotation projection (CAP-8, CAP-11, AD-2, AD-3, AD-7; engine rules R1.1–R1.7).
 *
 * A rotation is stored as a pattern, its ordered steps (each naming a shift
 * type), and a team's assignment to it — versioned, effective from a date,
 * each version naming a pattern, the step the team stands on at the anchor
 * date, and that anchor. Nothing projected is stored; the shift type a team
 * works on any date is computed here and nowhere else:
 *
 *   offsetIndex = index of the offset step among the pattern's steps by position
 *   shiftType   = steps[(offsetIndex + daysBetween(anchor, date)) mod cycleLength]
 *
 * The modulo is a TRUE modulo, so a date before the anchor resolves (R1.2).
 * The cycle length is the number of steps and nothing assumes a week (R1.3). A
 * shift type may repeat within a pattern (R1.4). Gaps between step positions
 * are harmless: steps are ordered by position and read by index.
 *
 * The offset is a STEP, never an integer, so an empty pattern (R1.5) and an
 * offset outside the cycle (R1.6) are unrepresentable in the schema
 * (`0016_rotation.sql`). They are re-checked on entry here all the same.
 *
 * Dates are `YYYY-MM-DD` strings and day arithmetic is civil, never a `Date`.
 * The engine returns ids, never prose, and nothing here reads a name, a fire
 * rank or a team position.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber } from './calendar.js';

/** One stored rotation pattern (`rotation_patterns`). Immutable. */
export interface RotationPattern {
  readonly id: string;
}

/**
 * One stored step of a pattern (`rotation_steps`). Immutable.
 *
 * `position` orders the steps of one pattern: a non-negative integer, unique
 * within the pattern, with gaps allowed.
 */
export interface RotationStep {
  readonly id: string;
  readonly patternId: string;
  readonly position: number;
  readonly shiftTypeId: string;
}

/**
 * One stored version of a team's rotation (`rotation_assignments`).
 *
 * In effect from `effectiveFrom` until the team's next version. On
 * `anchorDate` the team stands on `offsetStepId`, a step of `patternId`; the
 * anchor may lie before or after `effectiveFrom`.
 */
export interface RotationAssignment {
  readonly teamId: string;
  readonly patternId: string;
  readonly offsetStepId: string;
  readonly anchorDate: string;
  readonly effectiveFrom: string;
}

/**
 * A true mathematical modulo: the result is in `[0, divisor)` for a positive
 * divisor, whatever the sign of `value` — unlike JavaScript's `%`, which keeps
 * the sign of the dividend.
 */
function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * The number of days from `from` to `to`: positive when `to` is later,
 * negative when it is earlier, and 0 on the same date. Civil-day arithmetic
 * on the proleptic Gregorian calendar, never a `Date`.
 *
 * @throws RangeError naming the value when either date is not a calendar
 *   `YYYY-MM-DD`.
 */
export function daysBetween(from: string, to: string): number {
  checkDate('the first date', from);
  checkDate('the second date', to);
  return civilDayNumber(to) - civilDayNumber(from);
}

/**
 * The version of ONE team's rotation in effect on `date`: the one with the
 * greatest `effectiveFrom` on or before it, or `null` when none has begun yet —
 * a date before the first version has no rotation, and none is invented.
 *
 * @throws RangeError naming the value when `date`, a version's `effectiveFrom`
 *   or its `anchorDate` is not a calendar `YYYY-MM-DD`, when the versions
 *   belong to more than one team, or when two versions share an
 *   `effectiveFrom`.
 */
export function rotationAssignmentOn(
  versions: readonly RotationAssignment[],
  date: string,
): RotationAssignment | null {
  checkDate('the date', date);

  const seen = new Set<string>();
  const teamId = versions[0]?.teamId;
  let inEffect: RotationAssignment | null = null;
  for (const version of versions) {
    const { effectiveFrom } = version;
    if (version.teamId !== teamId) {
      throw new RangeError(
        `rotation assignments of teams ${teamId} and ${version.teamId} were given together; pass one team's versions`,
      );
    }
    checkDate(`a rotation assignment of team ${teamId} is effective from`, effectiveFrom);
    checkDate(`the anchor of team ${teamId}'s rotation from ${effectiveFrom}`, version.anchorDate);
    if (seen.has(effectiveFrom)) {
      throw new RangeError(`two rotation assignments of team ${teamId} are effective from ${effectiveFrom}`);
    }
    seen.add(effectiveFrom);
    if (effectiveFrom <= date && (inEffect === null || effectiveFrom > inEffect.effectiveFrom)) {
      inEffect = version;
    }
  }
  return inEffect;
}

/**
 * The steps of ONE pattern, ordered by position.
 *
 * @throws RangeError naming the value when there are no steps, when they
 *   belong to a pattern other than `patternId`, when a position is not a
 *   non-negative integer, or when two steps share a position or an id.
 */
function orderedSteps(steps: readonly RotationStep[], patternId: string): readonly RotationStep[] {
  if (steps.length === 0) {
    throw new RangeError(`rotation pattern ${patternId} has no steps, so it names no shift on any date`);
  }
  const positions = new Set<number>();
  const ids = new Set<string>();
  for (const step of steps) {
    if (step.patternId !== patternId) {
      throw new RangeError(
        `step ${step.id} belongs to rotation pattern ${step.patternId}, not ${patternId}; pass one pattern's steps`,
      );
    }
    if (!Number.isInteger(step.position) || step.position < 0) {
      throw new RangeError(`step ${step.id} is at position ${step.position}, not a non-negative integer`);
    }
    if (positions.has(step.position)) {
      throw new RangeError(`two steps of rotation pattern ${patternId} are at position ${step.position}`);
    }
    if (ids.has(step.id)) {
      throw new RangeError(`step ${step.id} of rotation pattern ${patternId} is given twice`);
    }
    positions.add(step.position);
    ids.add(step.id);
  }
  return [...steps].sort((left, right) => left.position - right.position);
}

/**
 * The shift type `assignment` projects for its team on `date`, as an id:
 *
 *   steps[(offsetIndex + daysBetween(anchor, date)) mod cycleLength]
 *
 * `steps` are the steps of the assignment's pattern, in any order. The answer
 * is defined for every date, before the anchor too; whether the assignment is
 * in effect on `date` is {@link rotationAssignmentOn}'s question, not this one.
 *
 * @throws RangeError naming the value when `date` or the anchor is not a
 *   calendar `YYYY-MM-DD`, when there are no steps, when a step belongs to
 *   another pattern, when a position is not a non-negative integer, when two
 *   steps share a position, or when the offset step is not in the pattern.
 */
export function projectedShiftType(
  steps: readonly RotationStep[],
  assignment: RotationAssignment,
  date: string,
): string {
  checkDate('the date', date);
  checkDate(`the anchor of team ${assignment.teamId}'s rotation`, assignment.anchorDate);

  const ordered = orderedSteps(steps, assignment.patternId);
  const offsetIndex = ordered.findIndex((step) => step.id === assignment.offsetStepId);
  if (offsetIndex < 0) {
    throw new RangeError(
      `offset step ${assignment.offsetStepId} is not a step of rotation pattern ${assignment.patternId}`,
    );
  }
  const index = modulo(offsetIndex + daysBetween(assignment.anchorDate, date), ordered.length);
  // `index` is in [0, length) by construction. Checked all the same, so a
  // defect in the arithmetic surfaces as a RangeError naming it, never as a
  // TypeError on an undefined step.
  const step = ordered[index];
  if (step === undefined) {
    throw new RangeError(
      `index ${index} names no step of rotation pattern ${assignment.patternId}, which has ${ordered.length}`,
    );
  }
  return step.shiftTypeId;
}

/**
 * The shift type ONE team works on `date`, as an id, from all of its rotation
 * versions: the version in effect on `date` ({@link rotationAssignmentOn}),
 * projected through the steps of the pattern THAT version names. `steps` may
 * hold the steps of several patterns — a rotation change points a new version
 * at a new pattern, and earlier dates still project through the old one.
 * `null` when no version is in effect yet.
 *
 * @throws RangeError when a precondition of {@link rotationAssignmentOn} or
 *   {@link projectedShiftType} is breached, including a version whose pattern
 *   has no steps among those given.
 */
export function projectedShiftTypeOn(
  versions: readonly RotationAssignment[],
  steps: readonly RotationStep[],
  date: string,
): string | null {
  const assignment = rotationAssignmentOn(versions, date);
  if (assignment === null) return null;
  return projectedShiftType(
    steps.filter((step) => step.patternId === assignment.patternId),
    assignment,
    date,
  );
}
