import { describe, expect, it } from 'vitest';

import {
  adjacentMonth,
  datesOfMonth,
  monthOf,
  projectedShiftTypeOn,
  scheduleOfMonth,
  type RotationAssignment,
  type RotationStep,
} from '../src/index.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_TEAMS,
  SEEDED_EFFECTIVE_FROM,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * Story 3.1 — a month of the schedule. Node environment, no browser. With no
 * exception layer yet, the month must equal the pure projection day by day
 * (stories 3.5 and 3.6 extend this to "all overrides removed").
 */

const FIXTURES = [
  { fixture: 'pilot', teams: PILOT_TEAMS, steps: PILOT_ROTATION_STEPS, assignments: PILOT_ROTATION_ASSIGNMENTS },
  { fixture: 'UJ-5', teams: UJ5_TEAMS, steps: UJ5_ROTATION_STEPS, assignments: UJ5_ROTATION_ASSIGNMENTS },
] as const;

const MONTHS = ['2019-12', '2020-01', '2024-02', '2026-02', '2026-09', '2031-02', '9999-12'] as const;

describe('datesOfMonth', () => {
  it.each([
    ['a 31-day month', '2026-10', 31],
    ['a 30-day month', '2026-09', 30],
    ['a February in a common year', '2026-02', 28],
    ['a February in a leap year', '2024-02', 29],
    ['a February in 1900, not a leap year', '1900-02', 28],
    ['a February in 2000, a leap year', '2000-02', 29],
    ['the first month of the calendar', '0001-01', 31],
    ['the last month of the calendar', '9999-12', 31],
  ] as const)('lists every date of %s', (_label, month, length) => {
    const dates = datesOfMonth(month);
    expect(dates).toHaveLength(length);
    expect(dates[0]).toBe(`${month}-01`);
    expect(dates.at(-1)).toBe(`${month}-${String(length)}`);
    for (const [index, date] of dates.entries()) {
      expect(date).toBe(`${month}-${String(index + 1).padStart(2, '0')}`);
    }
  });

  it.each(['2026-13', '2026-00', '0000-12', '10000-01', '2026-9', 'abc', '', '2026-09-01'])(
    'refuses %j with a RangeError',
    (month) => {
      expect(() => datesOfMonth(month)).toThrow(RangeError);
    },
  );
});

describe('monthOf', () => {
  it('names the month of a date', () => {
    expect(monthOf('2026-09-26')).toBe('2026-09');
    expect(monthOf('0001-01-01')).toBe('0001-01');
    expect(monthOf('9999-12-31')).toBe('9999-12');
  });

  it.each(['2026-02-30', '2026-09', 'abc'])('refuses %j with a RangeError', (date) => {
    expect(() => monthOf(date)).toThrow(RangeError);
  });
});

describe('adjacentMonth', () => {
  it.each([
    ['2026-09', 1, '2026-10'],
    ['2026-09', -1, '2026-08'],
    ['2026-12', 1, '2027-01'],
    ['2027-01', -1, '2026-12'],
    ['0001-02', -1, '0001-01'],
    ['9999-11', 1, '9999-12'],
  ] as const)('moves from %s by %i to %s', (month, step, expected) => {
    expect(adjacentMonth(month, step)).toBe(expected);
  });

  it('is null outside 0001-01…9999-12', () => {
    expect(adjacentMonth('0001-01', -1)).toBeNull();
    expect(adjacentMonth('9999-12', 1)).toBeNull();
  });

  it('refuses a bad month or step with a RangeError', () => {
    expect(() => adjacentMonth('2026-13', 1)).toThrow(RangeError);
    expect(() => adjacentMonth('abc', -1)).toThrow(RangeError);
    expect(() => adjacentMonth('2026-09', 2 as 1)).toThrow(RangeError);
    expect(() => adjacentMonth('2026-09', 0 as 1)).toThrow(RangeError);
  });
});

describe('scheduleOfMonth', () => {
  it.each(FIXTURES)('$fixture: every cell equals projectedShiftTypeOn for its team and date', ({ teams, steps, assignments }) => {
    const teamIds = teams.map((team) => team.id);
    for (const month of MONTHS) {
      const rows = scheduleOfMonth({ teamIds, assignments, steps }, month);
      expect(rows.map((row) => row.date)).toEqual(datesOfMonth(month));
      for (const row of rows) {
        expect(row.cells.map((cell) => cell.teamId)).toEqual(teamIds);
        for (const cell of row.cells) {
          const versions = assignments.filter((assignment) => assignment.teamId === cell.teamId);
          expect(cell.shiftTypeId, `${cell.teamId} on ${row.date}`).toBe(projectedShiftTypeOn(versions, steps, row.date));
        }
      }
    }
  });

  it.each(FIXTURES)('$fixture: a month before every version is null in every cell', ({ teams, steps, assignments }) => {
    const rows = scheduleOfMonth({ teamIds: teams.map((team) => team.id), assignments, steps }, '2019-12');
    expect(rows).toHaveLength(31);
    expect(rows.flatMap((row) => row.cells).every((cell) => cell.shiftTypeId === null)).toBe(true);
    // And the month the versions begin is fully projected.
    const first = scheduleOfMonth({ teamIds: teams.map((team) => team.id), assignments, steps }, SEEDED_EFFECTIVE_FROM.slice(0, 7));
    expect(first.flatMap((row) => row.cells).every((cell) => cell.shiftTypeId !== null)).toBe(true);
  });

  it('projects 28 and 29 days of February', () => {
    const input = { teamIds: [PILOT_TEAMS[0]!.id], assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS };
    expect(scheduleOfMonth(input, '2031-02')).toHaveLength(28);
    expect(scheduleOfMonth(input, '2028-02')).toHaveLength(29);
    expect(scheduleOfMonth(input, '2031-02').every((row) => row.cells[0]!.shiftTypeId !== null)).toBe(true);
  });

  it('switches pattern on the day a change takes effect in the middle of the month (story 2.6)', () => {
    const changedSteps: readonly RotationStep[] = [...PILOT_ROTATION_STEPS]
      .reverse()
      .map((step, position) => ({ ...step, id: `changed-${step.id}`, patternId: 'changed', position }));
    const old = PILOT_ROTATION_ASSIGNMENTS[0]!;
    const changed: RotationAssignment = {
      teamId: old.teamId,
      patternId: 'changed',
      offsetStepId: changedSteps[0]!.id,
      anchorDate: '2026-10-15',
      effectiveFrom: '2026-10-15',
    };
    const steps = [...PILOT_ROTATION_STEPS, ...changedSteps];
    const rows = scheduleOfMonth({ teamIds: [old.teamId], assignments: [old, changed], steps }, '2026-10');

    let differs = false;
    for (const row of rows) {
      const cell = row.cells[0]!.shiftTypeId;
      if (row.date < '2026-10-15') {
        expect(cell, row.date).toBe(projectedShiftTypeOn([old], PILOT_ROTATION_STEPS, row.date));
      } else {
        expect(cell, row.date).toBe(projectedShiftTypeOn([changed], changedSteps, row.date));
        if (cell !== projectedShiftTypeOn([old], PILOT_ROTATION_STEPS, row.date)) differs = true;
      }
    }
    expect(differs).toBe(true);
    // The change's first day starts the new pattern at its offset.
    expect(rows[14]!.cells[0]!.shiftTypeId).toBe(changedSteps[0]!.shiftTypeId);
  });

  it('keeps the column order asked for and ignores versions of teams not asked for', () => {
    const teamIds = [PILOT_TEAMS[2]!.id, PILOT_TEAMS[0]!.id];
    const rows = scheduleOfMonth(
      { teamIds, assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS },
      '2026-09',
    );
    for (const row of rows) expect(row.cells.map((cell) => cell.teamId)).toEqual(teamIds);
  });

  it('gives a team with no version null on every date, and no teams no cells', () => {
    const rows = scheduleOfMonth({ teamIds: ['no-rotation'], assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS }, '2026-09');
    expect(rows.every((row) => row.cells[0]!.shiftTypeId === null)).toBe(true);
    const empty = scheduleOfMonth({ teamIds: [], assignments: [], steps: [] }, '2026-09');
    expect(empty).toHaveLength(30);
    expect(empty.every((row) => row.cells.length === 0)).toBe(true);
  });

  it('projects the calendar bounds', () => {
    const input = { teamIds: PILOT_TEAMS.map((team) => team.id), assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS };
    expect(scheduleOfMonth(input, '9999-12').at(-1)!.date).toBe('9999-12-31');
    expect(scheduleOfMonth(input, '0001-01').every((row) => row.cells.every((cell) => cell.shiftTypeId === null))).toBe(true);
  });

  it('throws a RangeError on bad input', () => {
    const input = { teamIds: [PILOT_TEAMS[0]!.id], assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS };
    expect(() => scheduleOfMonth(input, '2026-13')).toThrow(RangeError);
    expect(() => scheduleOfMonth(input, 'abc')).toThrow(RangeError);
    expect(() => scheduleOfMonth({ ...input, teamIds: ['a', 'a'] }, '2026-09')).toThrow(/team a/);
    // A version whose pattern has no steps among those given.
    expect(() => scheduleOfMonth({ ...input, steps: UJ5_ROTATION_STEPS }, '2026-09')).toThrow(RangeError);
    // Two versions of one team on one date.
    const twin = { ...PILOT_ROTATION_ASSIGNMENTS[0]! };
    expect(() =>
      scheduleOfMonth({ ...input, assignments: [PILOT_ROTATION_ASSIGNMENTS[0]!, twin] }, '2026-09'),
    ).toThrow(RangeError);
  });
});
