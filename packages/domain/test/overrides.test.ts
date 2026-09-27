import { describe, expect, it } from 'vitest';

import {
  datesOfMonth,
  memberScheduleOfMonth,
  projectedShiftTypeOn,
  scheduleOfMonth,
  scheduledShiftTypeOn,
  type RotationAssignment,
  type ShiftTypeOverride,
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
 * Story 3.5a — a shift-type override over the projection (CAP-12, DI-2).
 * Node environment, no browser, against both fixtures. The load-bearing
 * assertion is "all overrides removed equals the pure projection": with no
 * override, every cell and every day is exactly `projectedShiftTypeOn`.
 */

const FIXTURES = [
  { fixture: 'pilot', teams: PILOT_TEAMS, steps: PILOT_ROTATION_STEPS, assignments: PILOT_ROTATION_ASSIGNMENTS },
  { fixture: 'UJ-5', teams: UJ5_TEAMS, steps: UJ5_ROTATION_STEPS, assignments: UJ5_ROTATION_ASSIGNMENTS },
] as const;

const MONTHS = ['2019-12', '2020-01', '2024-02', '2026-09', '2031-02', '9999-12'] as const;

function versionsOf(assignments: readonly RotationAssignment[], teamId: string): readonly RotationAssignment[] {
  return assignments.filter((assignment) => assignment.teamId === teamId);
}

const alfa = PILOT_TEAMS[0]!.id;
const alfaVersions = versionsOf(PILOT_ROTATION_ASSIGNMENTS, alfa);

/** The first date of September 2026 on which Smjena A projects `shiftTypeId`. */
function alfaDateProjecting(shiftTypeId: string): string {
  const date = datesOfMonth('2026-09').find(
    (day) => projectedShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, day) === shiftTypeId,
  );
  if (date === undefined) throw new Error(`Smjena A never projects ${shiftTypeId} in 2026-09`);
  return date;
}

describe('with no override, the schedule equals the pure projection', () => {
  it.each(FIXTURES)('$fixture: scheduledShiftTypeOn', ({ teams, steps, assignments }) => {
    for (const team of teams) {
      const versions = versionsOf(assignments, team.id);
      for (const month of MONTHS) {
        for (const date of datesOfMonth(month)) {
          const projected = projectedShiftTypeOn(versions, steps, date);
          expect(scheduledShiftTypeOn(versions, steps, [], team.id, date), `${team.id} on ${date}`).toEqual(
            projected === null ? null : { shiftTypeId: projected, projectedShiftTypeId: projected, overridden: false },
          );
        }
      }
    }
  });

  it.each(FIXTURES)('$fixture: scheduleOfMonth, every cell', ({ teams, steps, assignments }) => {
    const teamIds = teams.map((team) => team.id);
    for (const month of MONTHS) {
      for (const row of scheduleOfMonth({ teamIds, assignments, steps, overrides: [] }, month)) {
        for (const cell of row.cells) {
          const projected = projectedShiftTypeOn(versionsOf(assignments, cell.teamId), steps, row.date);
          expect(cell, `${cell.teamId} on ${row.date}`).toEqual({
            teamId: cell.teamId,
            shiftTypeId: projected,
            projectedShiftTypeId: projected,
            overridden: false,
          });
        }
      }
    }
  });

  it.each(FIXTURES)('$fixture: memberScheduleOfMonth, every day', ({ teams, steps, assignments }) => {
    for (const team of teams) {
      const memberships = [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
      for (const month of MONTHS) {
        for (const day of memberScheduleOfMonth({ memberships, statuses: [], assignments, steps, overrides: [] }, month)) {
          const projected = day.teamId === null ? null : projectedShiftTypeOn(versionsOf(assignments, team.id), steps, day.date);
          expect(day, `${team.id} on ${day.date}`).toEqual({
            date: day.date,
            teamId: day.date >= SEEDED_EFFECTIVE_FROM ? team.id : null,
            shiftTypeId: projected,
            projectedShiftTypeId: projected,
            overridden: false,
          });
        }
      }
    }
  });

  it.each(FIXTURES)('$fixture: removing every override restores the projection exactly', ({ teams, steps, assignments }) => {
    const teamIds = teams.map((team) => team.id);
    // An override on every team on every tenth day, each naming another team's step type.
    const overrides: ShiftTypeOverride[] = [];
    for (const [index, teamId] of teamIds.entries()) {
      for (const date of datesOfMonth('2026-09').filter((_, day) => day % 10 === index % 10)) {
        overrides.push({ teamId, date, shiftTypeId: steps[(index + 1) % steps.length]!.shiftTypeId });
      }
    }
    const withOverrides = scheduleOfMonth({ teamIds, assignments, steps, overrides }, '2026-09');
    const without = scheduleOfMonth({ teamIds, assignments, steps, overrides: [] }, '2026-09');
    for (const [rowIndex, row] of withOverrides.entries()) {
      for (const [cellIndex, cell] of row.cells.entries()) {
        const pure = without[rowIndex]!.cells[cellIndex]!;
        // The projected type is never touched by an override.
        expect(cell.projectedShiftTypeId, `${cell.teamId} on ${row.date}`).toBe(pure.shiftTypeId);
        const override = overrides.find((entry) => entry.teamId === cell.teamId && entry.date === row.date);
        expect(cell.overridden).toBe(override !== undefined);
        expect(cell.shiftTypeId).toBe(override?.shiftTypeId ?? pure.shiftTypeId);
      }
    }
  });
});

describe('scheduledShiftTypeOn', () => {
  it('replaces a working type with another working type, keeping the projected one', () => {
    const date = alfaDateProjecting('pilot-dan');
    const overrides = [{ teamId: alfa, date, shiftTypeId: 'pilot-noc' }];
    expect(scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, overrides, alfa, date)).toEqual({
      shiftTypeId: 'pilot-noc',
      projectedShiftTypeId: 'pilot-dan',
      overridden: true,
    });
  });

  it('turns an off day into a working one, and a working day into an off one', () => {
    const off = alfaDateProjecting('pilot-slobodno');
    const working = alfaDateProjecting('pilot-noc');
    const overrides = [
      { teamId: alfa, date: off, shiftTypeId: 'pilot-dan' },
      { teamId: alfa, date: working, shiftTypeId: 'pilot-slobodno' },
    ];
    expect(scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, overrides, alfa, off)).toEqual({
      shiftTypeId: 'pilot-dan',
      projectedShiftTypeId: 'pilot-slobodno',
      overridden: true,
    });
    expect(scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, overrides, alfa, working)).toEqual({
      shiftTypeId: 'pilot-slobodno',
      projectedShiftTypeId: 'pilot-noc',
      overridden: true,
    });
  });

  it('marks an override naming the projected type as overridden all the same', () => {
    const date = alfaDateProjecting('pilot-dan');
    expect(
      scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, [{ teamId: alfa, date, shiftTypeId: 'pilot-dan' }], alfa, date),
    ).toEqual({ shiftTypeId: 'pilot-dan', projectedShiftTypeId: 'pilot-dan', overridden: true });
  });

  it('ignores an override on a date with no rotation in effect', () => {
    const overrides = [{ teamId: alfa, date: '2019-12-31', shiftTypeId: 'pilot-noc' }];
    expect(scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, overrides, alfa, '2019-12-31')).toBeNull();
    expect(scheduledShiftTypeOn([], PILOT_ROTATION_STEPS, [{ teamId: 'none', date: '2026-09-01', shiftTypeId: 'x' }], 'none', '2026-09-01')).toBeNull();
  });

  it("reads only the team's own override on the date asked for", () => {
    const date = alfaDateProjecting('pilot-dan');
    const bravo = PILOT_TEAMS[1]!.id;
    const overrides = [
      { teamId: bravo, date, shiftTypeId: 'pilot-noc' },
      { teamId: alfa, date: '2026-09-30', shiftTypeId: 'pilot-noc' },
    ];
    const scheduled = scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, overrides, alfa, date);
    expect(scheduled).toEqual({ shiftTypeId: 'pilot-dan', projectedShiftTypeId: 'pilot-dan', overridden: false });
  });

  it('throws a RangeError on two overrides of one team and date, a bad date, or another team\'s versions', () => {
    const date = alfaDateProjecting('pilot-dan');
    const twice = [
      { teamId: alfa, date, shiftTypeId: 'pilot-noc' },
      { teamId: alfa, date, shiftTypeId: 'pilot-slobodno' },
    ];
    expect(() => scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, twice, alfa, date)).toThrow(new RegExp(date));
    expect(() =>
      scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, [{ teamId: alfa, date: '2026-02-30', shiftTypeId: 'x' }], alfa, date),
    ).toThrow(RangeError);
    expect(() => scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, [], PILOT_TEAMS[1]!.id, date)).toThrow(RangeError);
    expect(() => scheduledShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, [], alfa, '2026-02-30')).toThrow(RangeError);
  });
});

describe('scheduleOfMonth and memberScheduleOfMonth apply overrides', () => {
  it.each(FIXTURES)('$fixture: one override changes exactly one cell', ({ teams, steps, assignments }) => {
    const teamIds = teams.map((team) => team.id);
    const [first] = teamIds;
    const date = '2026-09-14';
    const projected = projectedShiftTypeOn(versionsOf(assignments, first!), steps, date)!;
    const other = steps.find((step) => step.shiftTypeId !== projected)!.shiftTypeId;
    const rows = scheduleOfMonth({ teamIds, assignments, steps, overrides: [{ teamId: first!, date, shiftTypeId: other }] }, '2026-09');
    const pure = scheduleOfMonth({ teamIds, assignments, steps, overrides: [] }, '2026-09');
    for (const [rowIndex, row] of rows.entries()) {
      for (const [cellIndex, cell] of row.cells.entries()) {
        if (row.date === date && cell.teamId === first) {
          expect(cell).toEqual({ teamId: first, shiftTypeId: other, projectedShiftTypeId: projected, overridden: true });
        } else {
          expect(cell).toEqual(pure[rowIndex]!.cells[cellIndex]);
        }
      }
    }
  });

  it('ignores an override in a month before any rotation', () => {
    const rows = scheduleOfMonth(
      {
        teamIds: [alfa],
        assignments: PILOT_ROTATION_ASSIGNMENTS,
        steps: PILOT_ROTATION_STEPS,
        overrides: [{ teamId: alfa, date: '2019-12-10', shiftTypeId: 'pilot-noc' }],
      },
      '2019-12',
    );
    expect(rows[9]!.cells[0]).toEqual({ teamId: alfa, shiftTypeId: null, projectedShiftTypeId: null, overridden: false });
  });

  it("applies the override of the member's team on that date, and none on a day they are on no team", () => {
    const bravo = PILOT_TEAMS[1]!.id;
    const memberships = [
      { teamId: alfa, position: null, effectiveFrom: '2026-09-01' },
      { teamId: null, position: null, effectiveFrom: '2026-09-20' },
    ];
    const overrides = [
      { teamId: alfa, date: '2026-09-05', shiftTypeId: 'pilot-noc' },
      { teamId: bravo, date: '2026-09-06', shiftTypeId: 'pilot-noc' },
      { teamId: alfa, date: '2026-09-25', shiftTypeId: 'pilot-noc' },
    ];
    const days = memberScheduleOfMonth(
      { memberships, statuses: [], assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS, overrides },
      '2026-09',
    );
    for (const day of days) {
      const projected = day.teamId === null ? null : projectedShiftTypeOn(alfaVersions, PILOT_ROTATION_STEPS, day.date);
      expect(day.projectedShiftTypeId, day.date).toBe(projected);
      if (day.date === '2026-09-05') {
        expect(day).toMatchObject({ teamId: alfa, shiftTypeId: 'pilot-noc', overridden: true });
      } else {
        expect(day.shiftTypeId, day.date).toBe(projected);
        expect(day.overridden, day.date).toBe(false);
      }
    }
  });

  it('throws a RangeError on two overrides of one team and date', () => {
    const overrides = [
      { teamId: alfa, date: '2026-09-05', shiftTypeId: 'pilot-noc' },
      { teamId: alfa, date: '2026-09-05', shiftTypeId: 'pilot-dan' },
    ];
    expect(() =>
      scheduleOfMonth({ teamIds: [alfa], assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS, overrides }, '2026-09'),
    ).toThrow(/2026-09-05/);
    expect(() =>
      memberScheduleOfMonth(
        { memberships: [], statuses: [], assignments: PILOT_ROTATION_ASSIGNMENTS, steps: PILOT_ROTATION_STEPS, overrides },
        '2026-09',
      ),
    ).toThrow(/2026-09-05/);
  });
});
