/**
 * What saving a rotation will actually do (CAP-10, FR-25, FR-26; story 2.5).
 *
 * Three warnings, computed for the rotation being saved and returned as DATA —
 * a stable `SCREAMING_SNAKE` code and its values, never a sentence. They
 * inform and never block: nothing here refuses anything.
 *
 * THE WINDOW is the next full cycle: `cycleLength` dates starting on the save
 * date. Each team's shift type on a date comes from `projectedShiftType` — the
 * modulo lives in `projection.ts` and nowhere else.
 *
 *   - COVERAGE_GAP: a date on which a WORKING shift type that appears in the
 *     pattern has no team on it (human decision 2026-09-26, option b).
 *   - DUPLICATE_COVERAGE: a date on which two or more teams are on the same
 *     working type.
 *   - REST_GAP: a run of two or more CYCLICALLY consecutive working steps in
 *     the pattern — the run wraps from the last step to the first (human
 *     decision 2026-09-26, option a). `minutes` is the sum of the run's
 *     nominal durations on the save date (`shiftDurationOn`), or `null` when
 *     any is unknown. When EVERY step works the run never ends: one warning,
 *     `endless`, over one whole cycle. One warning per run, for the pattern,
 *     not per team.
 *
 * Coverage warnings carry only the dates that have one, so an empty `dates`
 * never occurs: a code with nothing to report is simply absent.
 *
 * Nothing here reads a name, a fire rank or a team position; a step's
 * `position` only orders the pattern.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';
import { shiftDurationOn, type ShiftType, type ShiftTypeVersion } from './duration.js';
import { orderedSteps, projectedShiftType, type RotationAssignment, type RotationStep } from './projection.js';

export const COVERAGE_GAP = 'COVERAGE_GAP';
export const DUPLICATE_COVERAGE = 'DUPLICATE_COVERAGE';
export const REST_GAP = 'REST_GAP';

/** One date of a coverage warning, and the working types it concerns, in pattern order. */
export interface WarningDate {
  readonly date: string;
  readonly shiftTypeIds: readonly string[];
}

export interface CoverageGapWarning {
  readonly code: typeof COVERAGE_GAP;
  readonly dates: readonly WarningDate[];
}

export interface DuplicateCoverageWarning {
  readonly code: typeof DUPLICATE_COVERAGE;
  readonly dates: readonly WarningDate[];
}

export interface RestGapWarning {
  readonly code: typeof REST_GAP;
  /** The run's nominal minutes on the save date; `null` when any duration is unknown. */
  readonly minutes: number | null;
  /** The run's types, in the order they are worked. */
  readonly shiftTypeIds: readonly string[];
  /** Every step works: the run is the whole cycle and never ends. */
  readonly endless: boolean;
}

export type RotationWarning = CoverageGapWarning | DuplicateCoverageWarning | RestGapWarning;

/** The rotation being saved, as the domain reads it. */
export interface RotationWarningInput {
  /** The steps of the ONE pattern being saved. */
  readonly steps: readonly RotationStep[];
  /** One assignment per team, each on that pattern. */
  readonly assignments: readonly RotationAssignment[];
  /** Every shift type a step may name. */
  readonly shiftTypes: readonly ShiftType[];
  /** Every version of those types' times. */
  readonly versions: readonly ShiftTypeVersion[];
  /** The save date: the window starts here, and durations are read on it. */
  readonly date: string;
}

/**
 * The warnings for `input`: COVERAGE_GAP, then DUPLICATE_COVERAGE, then one
 * REST_GAP per run in pattern order — each only when it has something to say.
 *
 * @throws RangeError naming the value when the date is not a calendar
 *   `YYYY-MM-DD`, when a step names a type not given, when two assignments
 *   belong to one team, or on any precondition of `projectedShiftType` and
 *   `shiftDurationOn`.
 */
export function rotationWarningsOf(input: RotationWarningInput): readonly RotationWarning[] {
  const { assignments, date } = input;
  checkDate('the save date', date);

  const patternId = input.steps[0]?.patternId ?? '';
  const ordered = orderedSteps(input.steps, patternId);
  const typeById = new Map(input.shiftTypes.map((type) => [type.id, type]));
  const typeOf = (shiftTypeId: string): ShiftType => {
    const type = typeById.get(shiftTypeId);
    if (type === undefined) {
      throw new RangeError(`shift type ${shiftTypeId} is named by a step but was not given`);
    }
    return type;
  };

  const teams = new Set<string>();
  for (const assignment of assignments) {
    if (teams.has(assignment.teamId)) {
      throw new RangeError(`team ${assignment.teamId} is given two assignments; pass one per team`);
    }
    teams.add(assignment.teamId);
  }

  // The working types the pattern names, once each, in pattern order.
  const working = [
    ...new Set(ordered.map((step) => step.shiftTypeId).filter((id) => typeOf(id).isWorking)),
  ];

  const gaps: WarningDate[] = [];
  const duplicates: WarningDate[] = [];
  for (const day of windowOf(date, ordered.length)) {
    const teamsOn = new Map<string, number>();
    for (const assignment of assignments) {
      const shiftTypeId = projectedShiftType(ordered, assignment, day);
      teamsOn.set(shiftTypeId, (teamsOn.get(shiftTypeId) ?? 0) + 1);
    }
    const uncovered = working.filter((id) => (teamsOn.get(id) ?? 0) === 0);
    const doubled = working.filter((id) => (teamsOn.get(id) ?? 0) >= 2);
    if (uncovered.length > 0) gaps.push({ date: day, shiftTypeIds: uncovered });
    if (doubled.length > 0) duplicates.push({ date: day, shiftTypeIds: doubled });
  }

  const warnings: RotationWarning[] = [];
  if (gaps.length > 0) warnings.push({ code: COVERAGE_GAP, dates: gaps });
  if (duplicates.length > 0) warnings.push({ code: DUPLICATE_COVERAGE, dates: duplicates });

  const minutesOf = (shiftTypeId: string): number | null => {
    const type = typeOf(shiftTypeId);
    return shiftDurationOn(
      type,
      input.versions.filter((version) => version.shiftTypeId === shiftTypeId),
      date,
    );
  };
  for (const run of workingRunsOf(ordered.map((step) => typeOf(step.shiftTypeId)))) {
    const shiftTypeIds = run.types.map((type) => type.id);
    let minutes: number | null = 0;
    for (const shiftTypeId of shiftTypeIds) {
      const one = minutesOf(shiftTypeId);
      minutes = minutes === null || one === null ? null : minutes + one;
    }
    warnings.push({ code: REST_GAP, minutes, shiftTypeIds, endless: run.endless });
  }

  return warnings;
}

/** `count` consecutive dates from `from`; shorter only where the calendar ends (9999-12-31). */
function windowOf(from: string, count: number): readonly string[] {
  const first = civilDayNumber(from);
  const dates: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const day = dateOfCivilDay(first + offset);
    if (day === null) break;
    dates.push(day);
  }
  return dates;
}

interface WorkingRun {
  readonly types: readonly ShiftType[];
  readonly endless: boolean;
}

/**
 * The runs of two or more cyclically consecutive working steps, each in the
 * order worked, ordered by the step each run starts on. Every step working is
 * one endless run, whatever the length.
 */
function workingRunsOf(types: readonly ShiftType[]): readonly WorkingRun[] {
  if (types.length === 0) return [];
  if (types.every((type) => type.isWorking)) return [{ types, endless: true }];

  // Start just after a free step, so a run that wraps is walked in one piece.
  // The walk ends on that free step, which closes the last run.
  const indexed = types.map((type, index) => ({ type, index }));
  const free = types.findIndex((type) => !type.isWorking);
  const walk = [...indexed.slice(free + 1), ...indexed.slice(0, free + 1)];
  const runs: { readonly start: number; readonly run: WorkingRun }[] = [];
  let current: ShiftType[] = [];
  let start = 0;
  for (const { type, index } of walk) {
    if (type.isWorking) {
      if (current.length === 0) start = index;
      current.push(type);
      continue;
    }
    if (current.length >= 2) runs.push({ start, run: { types: current, endless: false } });
    current = [];
  }
  return runs.sort((left, right) => left.start - right.start).map(({ run }) => run);
}
