import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COVERAGE_GAP,
  DUPLICATE_COVERAGE,
  REST_GAP,
  rotationWarningsOf,
  type RotationAssignment,
  type RotationStep,
  type RotationWarningInput,
  type ShiftType,
  type ShiftTypeVersion,
} from '../src/index.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_SHIFT_TYPE_VERSIONS,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_SHIFT_TYPE_VERSIONS,
} from './fixtures.js';

/**
 * Story 2.5 — what saving a rotation will actually do (CAP-10, FR-25, FR-26).
 * Every domain row of the spec's I/O matrix, over both fixtures. The save date
 * is 2026-09-26: 2460 days after the seeded anchor, so the pilot's Smjena A
 * and UJ-5's Smjena A both stand on step 1 that day.
 */

const SAVE_DATE = '2026-09-26';

const pilot = (overrides: Partial<RotationWarningInput> = {}): RotationWarningInput => ({
  steps: PILOT_ROTATION_STEPS,
  assignments: PILOT_ROTATION_ASSIGNMENTS,
  shiftTypes: PILOT_SHIFT_TYPES,
  versions: PILOT_SHIFT_TYPE_VERSIONS,
  date: SAVE_DATE,
  ...overrides,
});

const uj5 = (overrides: Partial<RotationWarningInput> = {}): RotationWarningInput => ({
  steps: UJ5_ROTATION_STEPS,
  assignments: UJ5_ROTATION_ASSIGNMENTS,
  shiftTypes: UJ5_SHIFT_TYPES,
  versions: UJ5_SHIFT_TYPE_VERSIONS,
  date: SAVE_DATE,
  ...overrides,
});

/** A pattern of the pilot's types, by id, as steps of pattern `p`. */
function stepsOf(typeIds: readonly string[]): readonly RotationStep[] {
  return typeIds.map((shiftTypeId, position) => ({
    id: `p-step-${String(position)}`,
    patternId: 'p',
    position,
    shiftTypeId,
  }));
}

/** Teams `t0…`, each on the given step index, anchored on the save date. */
function teamsAt(offsets: readonly number[], anchor = SAVE_DATE): readonly RotationAssignment[] {
  return offsets.map((offset, team) => ({
    teamId: `t${String(team)}`,
    patternId: 'p',
    offsetStepId: `p-step-${String(offset)}`,
    anchorDate: anchor,
    effectiveFrom: anchor,
  }));
}

const DAN = 'pilot-dan';
const NOC = 'pilot-noc';
const SLOB = 'pilot-slobodno';

function codesOf(input: RotationWarningInput): readonly string[] {
  return rotationWarningsOf(input).map((warning) => warning.code);
}

describe('rotationWarningsOf — the pilot', () => {
  it('reports no gap, no duplicate, and one 24 h rest gap for Dan → Noć', () => {
    expect(rotationWarningsOf(pilot())).toEqual([
      { code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: false },
    ]);
  });

  it('reports the same for the pilot re-expressed on the save date (A–D on steps 1–4)', () => {
    const warnings = rotationWarningsOf(
      pilot({ steps: stepsOf([DAN, NOC, SLOB, SLOB]), assignments: teamsAt([0, 1, 2, 3]) }),
    );

    expect(warnings).toEqual([{ code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: false }]);
  });

  it('warns of both a gap and a duplicate when A and B share step 1', () => {
    const warnings = rotationWarningsOf(
      pilot({ steps: stepsOf([DAN, NOC, SLOB, SLOB]), assignments: teamsAt([0, 0, 2, 3]) }),
    );

    expect(warnings).toEqual([
      {
        code: COVERAGE_GAP,
        dates: [
          { date: '2026-09-26', shiftTypeIds: [NOC] },
          { date: '2026-09-29', shiftTypeIds: [DAN] },
        ],
      },
      {
        code: DUPLICATE_COVERAGE,
        dates: [
          { date: '2026-09-26', shiftTypeIds: [DAN] },
          { date: '2026-09-27', shiftTypeIds: [NOC] },
        ],
      },
      { code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: false },
    ]);
  });

  it('reports no rest gap when a free step separates the working ones', () => {
    const codes = codesOf(pilot({ steps: stepsOf([DAN, SLOB, NOC, SLOB]), assignments: teamsAt([0, 1, 2, 3]) }));

    expect(codes).not.toContain(REST_GAP);
  });

  it('finds a run that wraps from the last step to the first, in the order worked', () => {
    const warnings = rotationWarningsOf(
      pilot({ steps: stepsOf([NOC, SLOB, DAN]), assignments: teamsAt([0, 1, 2]) }),
    );

    expect(warnings.filter((warning) => warning.code === REST_GAP)).toEqual([
      { code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: false },
    ]);
  });

  it('calls a pattern with no free step endless, over one whole cycle', () => {
    expect(rotationWarningsOf(pilot({ steps: stepsOf([DAN]), assignments: teamsAt([0]) }))).toEqual([
      { code: REST_GAP, minutes: 720, shiftTypeIds: [DAN], endless: true },
    ]);
    expect(
      rotationWarningsOf(pilot({ steps: stepsOf([DAN, NOC]), assignments: teamsAt([0, 1]) })).find(
        (warning) => warning.code === REST_GAP,
      ),
    ).toEqual({ code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: true });
  });

  it('reports one warning per run, not per team, and none for a single working step', () => {
    const warnings = rotationWarningsOf(
      pilot({
        steps: stepsOf([DAN, NOC, SLOB, DAN, SLOB, NOC, DAN, SLOB]),
        assignments: teamsAt([0, 1, 2, 3, 4]),
      }),
    );

    expect(warnings.filter((warning) => warning.code === REST_GAP)).toEqual([
      { code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: false },
      { code: REST_GAP, minutes: 1440, shiftTypeIds: [NOC, DAN], endless: false },
    ]);
  });

  it('gives minutes null when a working type in the run has no times', () => {
    const warnings = rotationWarningsOf(
      pilot({ versions: PILOT_SHIFT_TYPE_VERSIONS.filter((version) => version.shiftTypeId !== NOC) }),
    );

    expect(warnings).toEqual([{ code: REST_GAP, minutes: null, shiftTypeIds: [DAN, NOC], endless: false }]);
  });

  it('reads durations on the save date, so a later correction is not applied early', () => {
    const later: ShiftTypeVersion = {
      shiftTypeId: DAN,
      effectiveFrom: '2026-10-01',
      startMinute: 420,
      endMinute: 900,
    };
    const versions = [...PILOT_SHIFT_TYPE_VERSIONS, later];

    expect(rotationWarningsOf(pilot({ versions }))).toEqual([
      { code: REST_GAP, minutes: 1440, shiftTypeIds: [DAN, NOC], endless: false },
    ]);
    expect(rotationWarningsOf(pilot({ versions, date: '2026-10-01' }))).toEqual([
      { code: REST_GAP, minutes: 1200, shiftTypeIds: [DAN, NOC], endless: false },
    ]);
  });
});

describe('rotationWarningsOf — UJ-5', () => {
  it('reports gaps on 4 of the 5 dates, no duplicate, and a 24 h rest gap J → P → N', () => {
    expect(rotationWarningsOf(uj5())).toEqual([
      {
        code: COVERAGE_GAP,
        dates: [
          { date: '2026-09-27', shiftTypeIds: ['uj5-jutarnja'] },
          { date: '2026-09-28', shiftTypeIds: ['uj5-jutarnja', 'uj5-popodnevna'] },
          { date: '2026-09-29', shiftTypeIds: ['uj5-popodnevna', 'uj5-nocna'] },
          { date: '2026-09-30', shiftTypeIds: ['uj5-nocna'] },
        ],
      },
      {
        code: REST_GAP,
        minutes: 1440,
        shiftTypeIds: ['uj5-jutarnja', 'uj5-popodnevna', 'uj5-nocna'],
        endless: false,
      },
    ]);
  });

  it('covers exactly one cycle from the save date', () => {
    const gap = rotationWarningsOf(uj5({ date: '2026-09-27' })).find(
      (warning) => warning.code === COVERAGE_GAP,
    );

    expect(gap?.code === COVERAGE_GAP ? gap.dates.map((one) => one.date) : null).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ]);
  });

  it('crosses a month and a year end in its window', () => {
    const gap = rotationWarningsOf(uj5({ date: '2026-12-30' })).find(
      (warning) => warning.code === COVERAGE_GAP,
    );

    expect(gap?.code === COVERAGE_GAP ? gap.dates.map((one) => one.date) : []).toEqual(
      expect.arrayContaining(['2027-01-01', '2027-01-02', '2027-01-03']),
    );
  });
});

describe('rotationWarningsOf — inputs', () => {
  it('reads no name: renaming every type changes nothing, and a name getter is never touched', () => {
    const blind = (types: readonly ShiftType[]): readonly ShiftType[] =>
      types.map((type) =>
        Object.defineProperty({ id: type.id, isWorking: type.isWorking } as ShiftType, 'name', {
          get(): never {
            throw new Error(`name of ${type.id} was read`);
          },
        }),
      );

    expect(rotationWarningsOf(pilot({ shiftTypes: blind(PILOT_SHIFT_TYPES) }))).toEqual(
      rotationWarningsOf(pilot()),
    );
    expect(rotationWarningsOf(uj5({ shiftTypes: blind(UJ5_SHIFT_TYPES) }))).toEqual(
      rotationWarningsOf(uj5()),
    );
  });

  it('reads no fire rank or team position, and returns no text', () => {
    const source = readFileSync(new URL('../src/warnings.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\brank/i);
    expect(code).not.toMatch(/\.name\b/);
    expect(code).not.toMatch(/teamPosition|team_position|fireRank|fire_rank/);
  });

  it('throws a RangeError for an unknown type, a doubled team or a bad date', () => {
    expect(() => rotationWarningsOf(pilot({ shiftTypes: PILOT_SHIFT_TYPES.slice(1) }))).toThrow(RangeError);
    const doubled = [...PILOT_ROTATION_ASSIGNMENTS, ...PILOT_ROTATION_ASSIGNMENTS.slice(0, 1)];

    expect(() => rotationWarningsOf(pilot({ assignments: doubled }))).toThrow(RangeError);
    expect(() => rotationWarningsOf(pilot({ date: '2026-02-30' }))).toThrow(RangeError);
    expect(() => rotationWarningsOf(pilot({ steps: [] }))).toThrow(RangeError);
  });

  it('stops the window where the calendar ends, at 9999-12-31', () => {
    // A and B share step 1: day 1 has a gap and a duplicate, day 2 a
    // duplicate, and days 3 and 4 would fall in year 10000, so they are cut.
    const last = '9999-12-30';
    const warnings = rotationWarningsOf(
      pilot({
        steps: stepsOf([DAN, NOC, SLOB, SLOB]),
        assignments: teamsAt([0, 0, 2, 3], last),
        date: last,
      }),
    );

    expect(warnings.filter((warning) => warning.code !== REST_GAP)).toEqual([
      { code: COVERAGE_GAP, dates: [{ date: '9999-12-30', shiftTypeIds: [NOC] }] },
      {
        code: DUPLICATE_COVERAGE,
        dates: [
          { date: '9999-12-30', shiftTypeIds: [DAN] },
          { date: '9999-12-31', shiftTypeIds: [NOC] },
        ],
      },
    ]);
  });

  it('walks a window across a leap day, 2028-02-28 → 02-29 → 03-01 → 03-02', () => {
    const start = '2028-02-28';
    const warnings = rotationWarningsOf(
      pilot({
        steps: stepsOf([DAN, NOC, SLOB, SLOB]),
        assignments: teamsAt([0, 0, 2, 3], start),
        date: start,
      }),
    );

    expect(warnings.filter((warning) => warning.code !== REST_GAP)).toEqual([
      {
        code: COVERAGE_GAP,
        dates: [
          { date: '2028-02-28', shiftTypeIds: [NOC] },
          { date: '2028-03-02', shiftTypeIds: [DAN] },
        ],
      },
      {
        code: DUPLICATE_COVERAGE,
        dates: [
          { date: '2028-02-28', shiftTypeIds: [DAN] },
          { date: '2028-02-29', shiftTypeIds: [NOC] },
        ],
      },
    ]);
  });

  it('counts a working type that repeats in the pattern once, by the teams on it', () => {
    const steps = stepsOf([DAN, SLOB, DAN, SLOB]);

    // Teams on steps 1 and 3 both work Dan on the same dates and rest together.
    expect(rotationWarningsOf(pilot({ steps, assignments: teamsAt([0, 2]) }))).toEqual([
      {
        code: COVERAGE_GAP,
        dates: [
          { date: '2026-09-27', shiftTypeIds: [DAN] },
          { date: '2026-09-29', shiftTypeIds: [DAN] },
        ],
      },
      {
        code: DUPLICATE_COVERAGE,
        dates: [
          { date: '2026-09-26', shiftTypeIds: [DAN] },
          { date: '2026-09-28', shiftTypeIds: [DAN] },
        ],
      },
    ]);
    // Teams on steps 1 and 2 alternate: Dan is covered once every day.
    expect(rotationWarningsOf(pilot({ steps, assignments: teamsAt([0, 1]) }))).toEqual([]);
  });
});
