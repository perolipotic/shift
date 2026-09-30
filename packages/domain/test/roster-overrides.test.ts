import { describe, expect, it } from 'vitest';

import {
  checkRosterOverrides,
  datesOfMonth,
  memberScheduleOfMonth,
  overrideStandingOf,
  projectedShiftTypeOn,
  rosterOn,
  scheduleOfMonth,
  shiftRoster,
  type MemberScheduleInput,
  type RosterMember,
  type RosterOverride,
  type ScheduleInput,
} from '../src/index.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_TEAMS,
  SEEDED_EFFECTIVE_FROM,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_TEAMS,
  shiftTypeScheduleOf,
  soleShiftDaysOf,
} from './fixtures.js';

/**
 * Story 3.6a — a roster override over the default roster (CAP-12, DI-2).
 * Node environment, against both fixtures. The load-bearing assertions are
 * "no roster override equals the default derivation" and "every roster
 * override pending equals the default derivation": every roster is then
 * `shiftRoster`, and every member's month the shift-type schedule's.
 */

const FIXTURES = [
  {
    fixture: 'pilot',
    teams: PILOT_TEAMS,
    types: PILOT_SHIFT_TYPES,
    steps: PILOT_ROTATION_STEPS,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
  },
  {
    fixture: 'UJ-5',
    teams: UJ5_TEAMS,
    types: UJ5_SHIFT_TYPES,
    steps: UJ5_ROTATION_STEPS,
    assignments: UJ5_ROTATION_ASSIGNMENTS,
  },
] as const;

const MONTH = '2026-09';

/** Two members per team, from the seeded date on; the second of each team inactive from the 20th. */
function membersOf(teams: readonly { readonly id: string }[]): readonly RosterMember[] {
  return teams.flatMap((team) => [
    { id: `${team.id}-1`, memberships: [{ teamId: team.id, position: 'commander', effectiveFrom: SEEDED_EFFECTIVE_FROM }], statuses: [] },
    {
      id: `${team.id}-2`,
      memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
      statuses: [{ active: false, effectiveFrom: '2026-09-20' }],
    },
  ]);
}

function workingOf(types: readonly { readonly id: string; readonly isWorking: boolean }[]): readonly string[] {
  return types.filter((type) => type.isWorking).map((type) => type.id);
}

const pilotMembers = membersOf(PILOT_TEAMS);
const pilotWorking = workingOf(PILOT_SHIFT_TYPES);
const alfa = PILOT_TEAMS[0]!.id;
const bravo = PILOT_TEAMS[1]!.id;
const A = `${alfa}-1`;
const A2 = `${alfa}-2`;
const B = `${bravo}-1`;

function versionsOf(teamId: string): typeof PILOT_ROTATION_ASSIGNMENTS {
  return PILOT_ROTATION_ASSIGNMENTS.filter((assignment) => assignment.teamId === teamId);
}

function isWorkingOn(teamId: string, date: string): boolean {
  const type = projectedShiftTypeOn(versionsOf(teamId), PILOT_ROTATION_STEPS, date);
  return type !== null && pilotWorking.includes(type);
}

/** A September date on which Alfa works and Bravo is off: C can be added from Bravo. */
const D = datesOfMonth(MONTH).find((date) => isWorkingOn(alfa, date) && !isWorkingOn(bravo, date) && date < '2026-09-20')!;

/** A September date on which Alfa is off. */
const OFF = datesOfMonth(MONTH).find((date) => !isWorkingOn(alfa, date))!;

function override(id: string, date: string, memberOutId: string | null, memberInId: string | null, teamId = alfa): RosterOverride {
  return { id, teamId, date, memberOutId, memberInId };
}

function pilotSchedule(rosterOverrides: readonly RosterOverride[]): ReturnType<typeof scheduleOfMonth> {
  const input: ScheduleInput = {
    teamIds: PILOT_TEAMS.map((team) => team.id),
    assignments: PILOT_ROTATION_ASSIGNMENTS,
    steps: PILOT_ROTATION_STEPS,
    overrides: [],
    members: pilotMembers,
    rosterOverrides,
    workingShiftTypeIds: pilotWorking,
  };
  return scheduleOfMonth(input, MONTH);
}

function pilotMonthOf(memberId: string, rosterOverrides: readonly RosterOverride[]): ReturnType<typeof memberScheduleOfMonth> {
  const member = pilotMembers.find((one) => one.id === memberId)!;
  const input: MemberScheduleInput = {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
    steps: PILOT_ROTATION_STEPS,
    overrides: [],
    members: pilotMembers,
    rosterOverrides,
    workingShiftTypeIds: pilotWorking,
  };
  return memberScheduleOfMonth(input, MONTH);
}

function dayOf(days: ReturnType<typeof memberScheduleOfMonth>, date: string): ReturnType<typeof memberScheduleOfMonth>[number] {
  return days.find((day) => day.date === date)!;
}

function cellAt(rows: ReturnType<typeof scheduleOfMonth>, teamId: string, date: string): ReturnType<typeof scheduleOfMonth>[number]['cells'][number] {
  return rows.find((row) => row.date === date)!.cells.find((cell) => cell.teamId === teamId)!;
}

describe('with no roster override, every roster and every month is the default derivation', () => {
  it.each(FIXTURES)('$fixture: rosterOn is shiftRoster on every team and date', ({ teams }) => {
    const members = membersOf(teams);
    for (const team of teams) {
      for (const date of datesOfMonth(MONTH)) {
        expect(rosterOn(members, [], team.id, date), `${team.id} on ${date}`).toEqual({
          roster: shiftRoster(members, team.id, date).map((entry) => ({ ...entry, added: false })),
          removed: [],
          applied: [],
        });
      }
    }
  });

  it.each(FIXTURES)('$fixture: scheduleOfMonth marks no cell and changes no type', ({ teams, types, steps, assignments }) => {
    const teamIds = teams.map((team) => team.id);
    const rows = scheduleOfMonth(
      { teamIds, assignments, steps, overrides: [], members: membersOf(teams), rosterOverrides: [], workingShiftTypeIds: workingOf(types) },
      MONTH,
    );
    expect(rows).toEqual(shiftTypeScheduleOf({ teamIds, assignments, steps, overrides: [] }, MONTH));
    expect(rows.flatMap((row) => row.cells).some((cell) => cell.rosterChanged)).toBe(false);
  });

  it.each(FIXTURES)('$fixture: every member\'s month is their own team\'s', ({ teams, types, steps, assignments }) => {
    const members = membersOf(teams);
    for (const member of members) {
      const days = memberScheduleOfMonth(
        {
          memberId: member.id,
          memberships: member.memberships,
          statuses: member.statuses,
          assignments,
          steps,
          overrides: [],
          members,
          rosterOverrides: [],
          workingShiftTypeIds: workingOf(types),
        },
        MONTH,
      );
      const sole = soleShiftDaysOf({ memberships: member.memberships, statuses: member.statuses, assignments, steps, overrides: [] }, MONTH);
      for (const [index, day] of days.entries()) {
        const expected = sole[index]!;
        expect(day.shifts, `${member.id} on ${day.date}`).toEqual(
          expected.teamId === null
            ? []
            : [
                {
                  teamId: expected.teamId,
                  shiftTypeId: expected.shiftTypeId,
                  projectedShiftTypeId: expected.projectedShiftTypeId,
                  overridden: expected.overridden,
                  rosterChanged: false,
                  viaOverride: false,
                },
              ],
        );
      }
    }
  });
});

describe('rosterOn', () => {
  it('replaces: the member taken off is gone, the one put on is added with no position', () => {
    const replace = override('r1', D, A, B);
    expect(rosterOn(pilotMembers, [replace], alfa, D)).toEqual({
      roster: [
        { memberId: A2, position: null, added: false },
        { memberId: B, position: null, added: true },
      ],
      removed: [A],
      applied: [replace],
    });
  });

  it('adds alone, and removes alone', () => {
    const add = override('r1', D, null, B);
    const remove = override('r2', D, A2, null);
    const shown = rosterOn(pilotMembers, [add, remove], alfa, D);
    expect(shown.roster).toEqual([
      { memberId: A, position: 'commander', added: false },
      { memberId: B, position: null, added: true },
    ]);
    expect(shown.removed).toEqual([A2]);
    expect(shown.applied).toEqual([add, remove]);
  });

  it('leaves inert an override taking off someone not on the roster, or putting on someone already on it', () => {
    const offStranger = override('r1', D, B, null);
    const onAlready = override('r2', D, null, A);
    // A replacement is one action: a stranger taken off makes the whole of it inert.
    const halfStale = override('r3', D, B, `${PILOT_TEAMS[2]!.id}-1`);
    // Inactive on the day: not on the default roster, so not removable.
    const inactive = override('r4', '2026-09-25', A2, null);
    for (const [one, date] of [
      [offStranger, D],
      [onAlready, D],
      [halfStale, D],
      [inactive, '2026-09-25'],
    ] as const) {
      expect(rosterOn(pilotMembers, [one], alfa, date)).toEqual(rosterOn(pilotMembers, [], alfa, date));
    }
  });

  it('reads only the team and date asked for', () => {
    const elsewhere = [override('r1', D, B, null, bravo), override('r2', OFF, A, null)];
    expect(rosterOn(pilotMembers, elsewhere, alfa, D)).toEqual(rosterOn(pilotMembers, [], alfa, D));
  });

  it('throws a RangeError on a bad shape, a bad date, or two live overrides of one member', () => {
    expect(() => checkRosterOverrides([override('r1', D, null, null)])).toThrow(/r1/);
    expect(() => checkRosterOverrides([override('r1', D, A, A)])).toThrow(/r1/);
    expect(() => checkRosterOverrides([override('r1', '2026-02-30', A, null)])).toThrow(RangeError);
    expect(() => checkRosterOverrides([override('r1', D, A, null), override('r2', D, A, B)])).toThrow(/off/);
    expect(() => checkRosterOverrides([override('r1', D, null, B), override('r2', D, A, B)])).toThrow(/put/);
    // The same member on two teams' shifts, or off one and on another, is no breach.
    expect(() => checkRosterOverrides([override('r1', D, null, B), override('r2', D, null, B, PILOT_TEAMS[2]!.id)])).not.toThrow();
    expect(() => rosterOn(pilotMembers, [override('r1', D, null, null)], alfa, D)).toThrow(RangeError);
  });
});

describe('scheduleOfMonth marks a cell whose roster changed', () => {
  it('marks exactly the team and date an override applies on', () => {
    const rows = pilotSchedule([override('r1', D, A, B)]);
    for (const row of rows) {
      for (const cell of row.cells) {
        expect(cell.rosterChanged, `${cell.teamId} on ${row.date}`).toBe(cell.teamId === alfa && row.date === D);
      }
    }
    // The type is never touched.
    expect(rows.map((row) => row.cells.map(({ rosterChanged: _, ...cell }) => cell))).toEqual(
      pilotSchedule([]).map((row) => row.cells.map(({ rosterChanged: _, ...cell }) => cell)),
    );
  });

  it('marks nothing for an inert override, or one on an off day', () => {
    expect(pilotSchedule([override('r1', D, B, null), override('r2', OFF, A, B)])).toEqual(pilotSchedule([]));
  });

  it('follows a shift-type override: a working day made off makes its roster override inert', () => {
    const input: ScheduleInput = {
      teamIds: [alfa],
      assignments: PILOT_ROTATION_ASSIGNMENTS,
      steps: PILOT_ROTATION_STEPS,
      overrides: [{ teamId: alfa, date: D, shiftTypeId: 'pilot-slobodno' }],
      members: pilotMembers,
      rosterOverrides: [override('r1', D, A, B)],
      workingShiftTypeIds: pilotWorking,
    };
    expect(cellAt(scheduleOfMonth(input, MONTH), alfa, D)).toMatchObject({ overridden: true, rosterChanged: false });
    // And an off day made working admits it.
    const made = { ...input, overrides: [{ teamId: alfa, date: OFF, shiftTypeId: 'pilot-dan' }], rosterOverrides: [override('r1', OFF, A, B)] };
    expect(cellAt(scheduleOfMonth(made, MONTH), alfa, OFF)).toMatchObject({ overridden: true, rosterChanged: true });
  });
});

describe("memberScheduleOfMonth follows the member's roster overrides", () => {
  it('replace: A loses the day, B gains Alfa on it', () => {
    const replace = [override('r1', D, A, B)];
    expect(dayOf(pilotMonthOf(A, replace), D).shifts).toEqual([]);
    const bDay = dayOf(pilotMonthOf(B, replace), D);
    const alfaType = projectedShiftTypeOn(versionsOf(alfa), PILOT_ROTATION_STEPS, D);
    const bravoType = projectedShiftTypeOn(versionsOf(bravo), PILOT_ROTATION_STEPS, D);
    expect(bDay.shifts).toEqual([
      { teamId: bravo, shiftTypeId: bravoType, projectedShiftTypeId: bravoType, overridden: false, rosterChanged: false, viaOverride: false },
      { teamId: alfa, shiftTypeId: alfaType, projectedShiftTypeId: alfaType, overridden: false, rosterChanged: true, viaOverride: true },
    ]);
    // A2 stays on the changed shift, and says so.
    expect(dayOf(pilotMonthOf(A2, replace), D).shifts).toEqual([
      { teamId: alfa, shiftTypeId: alfaType, projectedShiftTypeId: alfaType, overridden: false, rosterChanged: true, viaOverride: false },
    ]);
    // Every other day of every one of them is unchanged.
    for (const memberId of [A, A2, B]) {
      const changed = pilotMonthOf(memberId, replace).filter((day) => day.date !== D);
      const pure = pilotMonthOf(memberId, []).filter((day) => day.date !== D);
      expect(changed).toEqual(pure);
    }
  });

  it('remove only: the day is empty; an off day of their own team is never dropped', () => {
    expect(dayOf(pilotMonthOf(A, [override('r1', D, A, null)]), D).shifts).toEqual([]);
    expect(pilotMonthOf(A, [override('r1', OFF, A, null)])).toEqual(pilotMonthOf(A, []));
  });

  it('inert: a replacement whose member taken off is not on the roster gives nobody anything', () => {
    const stale = [override('r1', D, B, `${PILOT_TEAMS[2]!.id}-1`)];
    for (const member of pilotMembers) {
      expect(pilotMonthOf(member.id, stale), member.id).toEqual(pilotMonthOf(member.id, []));
    }
  });

  it('adds a member who is on no team that day', () => {
    const loner: RosterMember = { id: 'loner', memberships: [], statuses: [] };
    const members = [...pilotMembers, loner];
    const days = memberScheduleOfMonth(
      {
        memberId: 'loner',
        memberships: [],
        statuses: [],
        assignments: PILOT_ROTATION_ASSIGNMENTS,
        steps: PILOT_ROTATION_STEPS,
        overrides: [],
        members,
        rosterOverrides: [override('r1', D, null, 'loner')],
        workingShiftTypeIds: pilotWorking,
      },
      MONTH,
    );
    expect(days.filter((day) => day.shifts.length > 0).map((day) => day.date)).toEqual([D]);
    expect(dayOf(days, D).shifts[0]).toMatchObject({ teamId: alfa, viaOverride: true, rosterChanged: true });
  });
});

/** A fixture's two first teams, its members, and a month derivation over them with `rosterOverrides`. */
function fixtureOf({ teams, types, steps, assignments }: (typeof FIXTURES)[number]) {
  const members = membersOf(teams);
  const working = workingOf(types);
  const [first, second] = [teams[0]!.id, teams[1]!.id];
  const works = (teamId: string, date: string): boolean => {
    const type = projectedShiftTypeOn(
      assignments.filter((assignment) => assignment.teamId === teamId),
      steps,
      date,
    );
    return type !== null && working.includes(type);
  };
  const schedule = (rosterOverrides: readonly RosterOverride[]) =>
    scheduleOfMonth(
      { teamIds: teams.map((team) => team.id), assignments, steps, overrides: [], members, rosterOverrides, workingShiftTypeIds: working },
      MONTH,
    );
  const monthOf = (memberId: string, rosterOverrides: readonly RosterOverride[]) => {
    const member = members.find((one) => one.id === memberId)!;
    return memberScheduleOfMonth(
      {
        memberId,
        memberships: member.memberships,
        statuses: member.statuses,
        assignments,
        steps,
        overrides: [],
        members,
        rosterOverrides,
        workingShiftTypeIds: working,
      },
      MONTH,
    );
  };
  return { members, first, second, works, schedule, monthOf };
}

describe('the member put on must be active on the date (story 3.6a, review loop 1)', () => {
  it.each(FIXTURES)('$fixture: an inactive member put on leaves the whole override inert', (fixture) => {
    const { members, first, second, works, schedule, monthOf } = fixtureOf(fixture);
    // The second member of each team is inactive from the 20th.
    const date = datesOfMonth(MONTH).find((day) => day >= '2026-09-20' && works(first, day))!;
    const inactive = `${second}-2`;
    const out = `${first}-1`;
    for (const change of [override('r1', date, out, inactive, first), override('r1', date, null, inactive, first)]) {
      expect(rosterOn(members, [change], first, date)).toEqual(rosterOn(members, [], first, date));
      expect(schedule([change])).toEqual(schedule([]));
      // Neither the member put on gains the shift, nor the member taken off loses it.
      expect(monthOf(inactive, [change])).toEqual(monthOf(inactive, []));
      expect(monthOf(out, [change])).toEqual(monthOf(out, []));
    }
    // Active again, the same replacement applies.
    const before = datesOfMonth(MONTH).find((day) => day < '2026-09-20' && works(first, day))!;
    expect(rosterOn(members, [override('r1', before, out, inactive, first)], first, before).applied).toHaveLength(1);
  });
});

describe('a double shift is allowed (story 3.6a, review loop 1)', () => {
  it.each(FIXTURES)('$fixture: a member put on another team\'s shift while their own team works has both, own first', (fixture) => {
    const { members, first, second, works, schedule, monthOf } = fixtureOf(fixture);
    const date = datesOfMonth(MONTH).find((day) => day < '2026-09-20' && works(first, day) && works(second, day))!;
    expect(date, 'no date on which both teams work').toBeDefined();
    const put = `${second}-1`;
    const change = override('r1', date, null, put, first);

    expect(rosterOn(members, [change], first, date).roster.map((entry) => [entry.memberId, entry.added])).toEqual([
      [`${first}-1`, false],
      [`${first}-2`, false],
      [put, true],
    ]);
    // Their own team's roster is untouched.
    expect(rosterOn(members, [change], second, date)).toEqual(rosterOn(members, [], second, date));
    expect(schedule([change]).find((row) => row.date === date)!.cells.map((cell) => cell.rosterChanged)).toEqual(
      fixture.teams.map((team) => team.id === first),
    );
    const day = dayOf(monthOf(put, [change]), date);
    expect(day.shifts.map((shift) => [shift.teamId, shift.viaOverride, shift.rosterChanged])).toEqual([
      [second, false, false],
      [first, true, true],
    ]);
  });
});

describe('only roster overrides IN FORCE reach a rule (story 3.5c\'s rule, story 3.6a)', () => {
  it.each(FIXTURES)('$fixture: every roster override pending equals the default derivation', ({ teams, types, steps, assignments }) => {
    const members = membersOf(teams);
    const changeFrom = '2026-09-11';
    const stamps = [
      ...assignments.map((assignment) => ({ teamId: assignment.teamId, effectiveFrom: assignment.effectiveFrom, createdAt: 1_000 })),
      ...assignments.map((assignment) => ({ teamId: assignment.teamId, effectiveFrom: changeFrom, createdAt: 3_000 })),
    ];
    // On every team, every date from the change on: its first member replaced by the next team's.
    const overrides = teams.flatMap((team, index) =>
      datesOfMonth(MONTH)
        .filter((date) => date >= changeFrom)
        .map((date) => ({
          id: `${team.id}-${date}`,
          teamId: team.id,
          date,
          memberOutId: `${team.id}-1`,
          memberInId: `${teams[(index + 1) % teams.length]!.id}-1`,
          writtenAt: 2_000,
        })),
    );
    const standing = overrideStandingOf(stamps, overrides);
    expect(standing.pending).toEqual(overrides);
    const teamIds = teams.map((team) => team.id);
    const base = { teamIds, assignments, steps, overrides: [], members, workingShiftTypeIds: workingOf(types) };
    expect(scheduleOfMonth({ ...base, rosterOverrides: standing.inForce }, MONTH)).toEqual(
      scheduleOfMonth({ ...base, rosterOverrides: [] }, MONTH),
    );
    for (const team of teams) {
      for (const date of datesOfMonth(MONTH)) {
        expect(rosterOn(members, standing.inForce, team.id, date)).toEqual(rosterOn(members, [], team.id, date));
      }
    }
    for (const member of members) {
      const input = {
        memberId: member.id,
        memberships: member.memberships,
        statuses: member.statuses,
        assignments,
        steps,
        overrides: [],
        members,
        workingShiftTypeIds: workingOf(types),
      };
      expect(memberScheduleOfMonth({ ...input, rosterOverrides: standing.inForce }, MONTH)).toEqual(
        memberScheduleOfMonth({ ...input, rosterOverrides: [] }, MONTH),
      );
    }
    // With no change saved, the same overrides are all in force and change the month.
    const unchanged = overrideStandingOf(stamps.slice(0, assignments.length), overrides);
    expect(unchanged.inForce).toEqual(overrides);
  });
});
