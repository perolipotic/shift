import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isShortStaffed,
  newlyShortStaffedOf,
  peopleAtWorkOn,
  scheduleOfMonth,
  SHORT_STAFFED,
  shortStaffedShiftsOf,
  type CollisionLeaveRecord,
  type RosterMember,
  type RosterOverride,
  type StaffingInput,
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
} from './fixtures.js';

/**
 * Story 11.1 — the staffing rule (R10.1–R10.5; AD-1, AD-7, AD-8, AD-15).
 * Node environment, no browser, against both fixtures. Every team has four
 * members, as the pilot's do, and the minimum is 3 (R10.5).
 */

const FIXTURES = [
  { fixture: 'pilot', types: PILOT_SHIFT_TYPES, teams: PILOT_TEAMS, steps: PILOT_ROTATION_STEPS, assignments: PILOT_ROTATION_ASSIGNMENTS },
  { fixture: 'UJ-5', types: UJ5_SHIFT_TYPES, teams: UJ5_TEAMS, steps: UJ5_ROTATION_STEPS, assignments: UJ5_ROTATION_ASSIGNMENTS },
] as const;

type Fixture = (typeof FIXTURES)[number];

const MONTH = '2026-10';
const TEAM_SIZE = 4;

function memberIdOf(teamId: string, index: number): string {
  return `${teamId}-m${String(index)}`;
}

function membersOf(fx: Fixture): RosterMember[] {
  return fx.teams.flatMap((team) =>
    Array.from({ length: TEAM_SIZE }, (_, index) => ({
      id: memberIdOf(team.id, index),
      memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
      statuses: [],
    })),
  );
}

function inputOf(fx: Fixture, overrides: Partial<StaffingInput> = {}): StaffingInput {
  return {
    teamIds: fx.teams.map((team) => team.id),
    assignments: fx.assignments,
    steps: fx.steps,
    overrides: [],
    members: membersOf(fx),
    rosterOverrides: [],
    workingShiftTypeIds: fx.types.filter((type) => type.isWorking).map((type) => type.id),
    leaveRecords: [],
    minimumMembers: 3,
    ...overrides,
  };
}

/** The first date of {@link MONTH} the first team works a working shift, and that shift's type. */
function workingDayOf(fx: Fixture): { readonly date: string; readonly teamId: string; readonly shiftTypeId: string } {
  const working = new Set(fx.types.filter((type) => type.isWorking).map((type) => type.id));
  const teamId = fx.teams[0]!.id;
  for (const row of scheduleOfMonth({ ...inputOf(fx), teamIds: [teamId] }, MONTH)) {
    const type = row.cells[0]!.shiftTypeId;
    if (type !== null && working.has(type)) return { date: row.date, teamId, shiftTypeId: type };
  }
  throw new Error(`no working day of ${fx.fixture}`);
}

/** The first date of {@link MONTH} the first team works a NON-working shift. */
function offDayOf(fx: Fixture): string {
  const off = new Set(fx.types.filter((type) => !type.isWorking).map((type) => type.id));
  const teamId = fx.teams[0]!.id;
  for (const row of scheduleOfMonth({ ...inputOf(fx), teamIds: [teamId] }, MONTH)) {
    const type = row.cells[0]!.shiftTypeId;
    if (type !== null && off.has(type)) return row.date;
  }
  throw new Error(`no day off of ${fx.fixture}`);
}

function leave(id: string, memberId: string, date: string): CollisionLeaveRecord {
  return { id, memberId, from: date, to: date };
}

describe.each(FIXTURES)('the R10.5 worked example under $fixture: a team of four, minimum 3', (fx) => {
  const { date, teamId, shiftTypeId } = workingDayOf(fx);
  const oneOff = [leave('l0', memberIdOf(teamId, 0), date)];
  const twoOff = [...oneOff, leave('l1', memberIdOf(teamId, 1), date)];

  it('one member on leave: 3 at work, not short-staffed', () => {
    const input = inputOf(fx, { leaveRecords: oneOff });
    expect(peopleAtWorkOn(input, teamId, date)).toEqual({ shiftTypeId, atWork: 3 });
    expect(shortStaffedShiftsOf(input, date, date)).toEqual([]);
  });

  it('two members on leave: 2 at work, short-staffed', () => {
    const input = inputOf(fx, { leaveRecords: twoOff });
    expect(peopleAtWorkOn(input, teamId, date)).toEqual({ shiftTypeId, atWork: 2 });
    expect(shortStaffedShiftsOf(input, date, date)).toEqual([{ code: SHORT_STAFFED, date, teamId, shiftTypeId, atWork: 2, minimum: 3 }]);
  });

  it('one of those two replaced by an override: 3 at work, not short-staffed', () => {
    const replacement: RosterOverride = { id: 'r', teamId, date, memberOutId: memberIdOf(teamId, 0), memberInId: memberIdOf(fx.teams[1]!.id, 0) };
    const input = inputOf(fx, { leaveRecords: twoOff, rosterOverrides: [replacement] });
    expect(peopleAtWorkOn(input, teamId, date)?.atWork).toBe(3);
    expect(shortStaffedShiftsOf(input, date, date)).toEqual([]);
  });

  it('the same team with the minimum empty: never short-staffed', () => {
    const input = inputOf(fx, { leaveRecords: twoOff, minimumMembers: null });
    expect(peopleAtWorkOn(input, teamId, date)).toEqual({ shiftTypeId, atWork: 2 });
    expect(shortStaffedShiftsOf(input, date, date)).toEqual([]);
    // Nor anything over a whole month with nobody rostered at all.
    expect(shortStaffedShiftsOf({ ...input, members: [] }, `${MONTH}-01`, `${MONTH}-31`)).toEqual([]);
  });
});

describe.each(FIXTURES)('people at work under $fixture (R10.1, R10.2)', (fx) => {
  const { date, teamId, shiftTypeId } = workingDayOf(fx);
  const other = fx.teams[1]!.id;

  it('counts a replacement who is on leave as absent', () => {
    const replacement: RosterOverride = { id: 'r', teamId, date, memberOutId: memberIdOf(teamId, 0), memberInId: memberIdOf(other, 0) };
    const input = inputOf(fx, {
      rosterOverrides: [replacement],
      leaveRecords: [leave('l0', memberIdOf(teamId, 0), date), leave('l1', memberIdOf(other, 0), date)],
    });
    // Taken off (not subtracted twice) and replaced by a member who is away: 3 of the 4 remain.
    expect(peopleAtWorkOn(input, teamId, date)?.atWork).toBe(3);
  });

  it('counts a member put on alone, and drops a member taken off alone', () => {
    const putOn: RosterOverride = { id: 'in', teamId, date, memberOutId: null, memberInId: memberIdOf(other, 1) };
    const takenOff: RosterOverride = { id: 'out', teamId, date, memberOutId: memberIdOf(teamId, 2), memberInId: null };
    expect(peopleAtWorkOn(inputOf(fx, { rosterOverrides: [putOn] }), teamId, date)?.atWork).toBe(5);
    expect(peopleAtWorkOn(inputOf(fx, { rosterOverrides: [takenOff] }), teamId, date)?.atWork).toBe(3);
  });

  it('leave on another date, or of another team, changes nothing', () => {
    const input = inputOf(fx, { leaveRecords: [leave('l', memberIdOf(other, 0), date), leave('m', memberIdOf(teamId, 0), '2026-09-01')] });
    expect(peopleAtWorkOn(input, teamId, date)).toEqual({ shiftTypeId, atWork: TEAM_SIZE });
  });

  it('a member covered twice on the date is subtracted once', () => {
    const input = inputOf(fx, {
      leaveRecords: [
        { id: 'a', memberId: memberIdOf(teamId, 0), from: '2026-09-20', to: date },
        { id: 'b', memberId: memberIdOf(teamId, 0), from: date, to: '2026-11-05' },
      ],
    });
    expect(peopleAtWorkOn(input, teamId, date)?.atWork).toBe(3);
  });

  it('a leave range covering the date counts', () => {
    const input = inputOf(fx, { leaveRecords: [{ id: 'l', memberId: memberIdOf(teamId, 0), from: '2026-09-20', to: '2026-11-05' }] });
    expect(peopleAtWorkOn(input, teamId, date)?.atWork).toBe(3);
  });

  it('a record whose type does not draw the allowance still takes the member off work (story 13.2, CAP-23)', () => {
    const input = inputOf(fx, {
      leaveRecords: [{ id: 'l', memberId: memberIdOf(teamId, 0), from: date, to: date, drawsAllowance: false }],
    });
    expect(peopleAtWorkOn(input, teamId, date)?.atWork).toBe(3);
  });

  it('a member on a half day counts as at work (story 13.5, R10.1)', () => {
    const half = inputOf(fx, {
      leaveRecords: [{ id: 'h', memberId: memberIdOf(teamId, 0), from: date, to: date, half: 'FIRST' }],
    });
    expect(peopleAtWorkOn(half, teamId, date)).toEqual({ shiftTypeId, atWork: TEAM_SIZE });
    // Minimum 3, three left after a whole day off, one of them on a half day: 3 at work, not short-staffed.
    const threeLeft = inputOf(fx, {
      leaveRecords: [
        leave('l', memberIdOf(teamId, 1), date),
        { id: 'h', memberId: memberIdOf(teamId, 0), from: date, to: date, half: 'SECOND' },
      ],
    });
    expect(peopleAtWorkOn(threeLeft, teamId, date)?.atWork).toBe(3);
    expect(shortStaffedShiftsOf(threeLeft, date, date)).toEqual([]);
  });

  it('a non-working day is never short-staffed, even with nobody at work', () => {
    const off = offDayOf(fx);
    const input = inputOf(fx, { members: [], minimumMembers: 99 });
    expect(peopleAtWorkOn(input, teamId, off)).toBeNull();
    expect(shortStaffedShiftsOf({ ...input, teamIds: [teamId] }, off, off)).toEqual([]);
  });

  it('a team before its first rotation version works nothing and is never short', () => {
    const input = inputOf(fx, { members: [], assignments: fx.assignments.map((a) => ({ ...a, effectiveFrom: '2030-01-01' })) });
    expect(peopleAtWorkOn(input, teamId, date)).toBeNull();
    expect(shortStaffedShiftsOf(input, `${MONTH}-01`, `${MONTH}-31`)).toEqual([]);
  });

  it('a shift-type override to a non-working type removes the shift, and to a working type adds it', () => {
    const offType = fx.types.find((type) => !type.isWorking)!.id;
    const offInput = inputOf(fx, { members: [], overrides: [{ teamId, date, shiftTypeId: offType }] });
    expect(peopleAtWorkOn(offInput, teamId, date)).toBeNull();
    const offDate = offDayOf(fx);
    const onInput = inputOf(fx, { overrides: [{ teamId, date: offDate, shiftTypeId }] });
    expect(peopleAtWorkOn(onInput, teamId, offDate)).toEqual({ shiftTypeId, atWork: TEAM_SIZE });
  });

  it('a member deactivated from a date leaves the later shifts short where the count falls (§11.2 Q5)', () => {
    const members = membersOf(fx).map((member) =>
      member.id === memberIdOf(teamId, 0) || member.id === memberIdOf(teamId, 1)
        ? { ...member, statuses: [{ active: false, effectiveFrom: date }] }
        : member,
    );
    const input = inputOf(fx, { members, teamIds: [teamId] });
    const short = shortStaffedShiftsOf(input, `${MONTH}-01`, `${MONTH}-31`);
    expect(short.length).toBeGreaterThan(0);
    expect(short.every((shift) => shift.date >= date && shift.atWork === 2)).toBe(true);
    expect(short[0]?.date).toBe(date);
  });

  it('every working shift of a month with nobody rostered is short, soonest first then in team order', () => {
    const input = inputOf(fx, { members: [] });
    const short = shortStaffedShiftsOf(input, `${MONTH}-01`, `${MONTH}-31`);
    const expected = scheduleOfMonth(input, MONTH).flatMap((row) =>
      row.cells
        .filter((cell) => cell.shiftTypeId !== null && input.workingShiftTypeIds.includes(cell.shiftTypeId))
        .map((cell) => ({ code: SHORT_STAFFED, date: row.date, teamId: cell.teamId, shiftTypeId: cell.shiftTypeId!, atWork: 0, minimum: 3 })),
    );
    expect(short).toEqual(expected);
    expect(short.length).toBeGreaterThan(0);
  });

  it('the minimum is current-state: raising it re-reports past dates (AD-2, R10.4)', () => {
    const past = inputOf(fx, { leaveRecords: [leave('l', memberIdOf(teamId, 0), date)] });
    expect(shortStaffedShiftsOf(past, date, date)).toEqual([]);
    expect(shortStaffedShiftsOf({ ...past, minimumMembers: 4 }, date, date)).toEqual([
      { code: SHORT_STAFFED, date, teamId, shiftTypeId, atWork: 3, minimum: 4 },
    ]);
  });

  it('a window across months walks each month once', () => {
    const input = inputOf(fx, { members: [] });
    const across = shortStaffedShiftsOf(input, '2026-09-25', '2026-11-05');
    const byMonths = [
      ...shortStaffedShiftsOf(input, '2026-09-25', '2026-09-30'),
      ...shortStaffedShiftsOf(input, '2026-10-01', '2026-10-31'),
      ...shortStaffedShiftsOf(input, '2026-11-01', '2026-11-05'),
    ];
    expect(across).toEqual(byMonths);
    expect(across[0]!.date >= '2026-09-25' && across.at(-1)!.date <= '2026-11-05').toBe(true);
  });
});

describe.each(FIXTURES)('newlyShortStaffedOf under $fixture (R10.4)', (fx) => {
  const { date, teamId, shiftTypeId } = workingDayOf(fx);
  const oneOff = inputOf(fx, { leaveRecords: [leave('l0', memberIdOf(teamId, 0), date)] });
  const twoOff = inputOf(fx, { leaveRecords: [leave('l0', memberIdOf(teamId, 0), date), leave('l1', memberIdOf(teamId, 1), date)] });
  const threeOff = inputOf(fx, {
    leaveRecords: [leave('l0', memberIdOf(teamId, 0), date), leave('l1', memberIdOf(teamId, 1), date), leave('l2', memberIdOf(teamId, 2), date)],
  });

  it('reports a shift the change makes short, as "after" derives it', () => {
    expect(newlyShortStaffedOf(oneOff, twoOff, date, date)).toEqual([{ code: SHORT_STAFFED, date, teamId, shiftTypeId, atWork: 2, minimum: 3 }]);
  });

  it('does not report a shift already short before, nor one only short before', () => {
    expect(newlyShortStaffedOf(twoOff, threeOff, date, date)).toEqual([]);
    expect(newlyShortStaffedOf(twoOff, oneOff, date, date)).toEqual([]);
  });

  it('matches by team and date: a working type changed to another, still short, is not new', () => {
    const otherWorking = fx.types.find((type) => type.isWorking && type.id !== shiftTypeId)!.id;
    const after = { ...twoOff, overrides: [{ teamId, date, shiftTypeId: otherWorking }] };
    expect(shortStaffedShiftsOf(after, date, date)).toHaveLength(1);
    expect(newlyShortStaffedOf(twoOff, after, date, date)).toEqual([]);
  });

  it('reports a day off a shift-type override turns into a short working shift', () => {
    const offDate = offDayOf(fx);
    const before = inputOf(fx, { leaveRecords: [leave('o0', memberIdOf(teamId, 0), offDate), leave('o1', memberIdOf(teamId, 1), offDate)] });
    const after = { ...before, overrides: [{ teamId, date: offDate, shiftTypeId }] };
    expect(newlyShortStaffedOf(before, after, offDate, offDate)).toEqual([
      { code: SHORT_STAFFED, date: offDate, teamId, shiftTypeId, atWork: 2, minimum: 3 },
    ]);
  });

  it('reports, over a window, only the shifts the change makes short', () => {
    const before = inputOf(fx, { teamIds: [teamId] });
    const after = { ...before, leaveRecords: twoOff.leaveRecords };
    const window = newlyShortStaffedOf(before, after, `${MONTH}-01`, `${MONTH}-31`);
    expect(window).toEqual([{ code: SHORT_STAFFED, date, teamId, shiftTypeId, atWork: 2, minimum: 3 }]);
  });

  it('a minimum raised between before and after reports what the new minimum makes short', () => {
    expect(newlyShortStaffedOf(oneOff, { ...oneOff, minimumMembers: 4 }, date, date)).toEqual([
      { code: SHORT_STAFFED, date, teamId, shiftTypeId, atWork: 3, minimum: 4 },
    ]);
  });

  it('reports nothing with the minimum empty on the after side', () => {
    expect(newlyShortStaffedOf(oneOff, { ...twoOff, minimumMembers: null }, date, date)).toEqual([]);
  });

  it('reads its inputs and writes nothing', () => {
    const frozen = JSON.stringify([oneOff, twoOff]);
    newlyShortStaffedOf(oneOff, twoOff, `${MONTH}-01`, `${MONTH}-31`);
    expect(JSON.stringify([oneOff, twoOff])).toBe(frozen);
  });
});

describe('isShortStaffed (R10.2, story 11.2)', () => {
  it('is fewer at work than the minimum, and never with the setting empty', () => {
    expect(isShortStaffed(2, 3)).toBe(true);
    expect(isShortStaffed(0, 1)).toBe(true);
    expect(isShortStaffed(3, 3)).toBe(false);
    expect(isShortStaffed(4, 3)).toBe(false);
    expect(isShortStaffed(0, null)).toBe(false);
  });
});

describe('breached preconditions throw a RangeError naming the value', () => {
  const fx = FIXTURES[0];
  const input = inputOf(fx);

  it('refuses a window that ends before it starts, or a non-calendar date', () => {
    expect(() => shortStaffedShiftsOf(input, '2026-10-10', '2026-10-09')).toThrow(RangeError);
    expect(() => shortStaffedShiftsOf(input, '2026-02-30', '2026-03-01')).toThrow(/2026-02-30/);
    expect(() => peopleAtWorkOn(input, fx.teams[0]!.id, '2026-13-01')).toThrow(RangeError);
  });

  it('refuses a minimum that is not a whole number of at least 1', () => {
    for (const minimum of [0, -1, 2.5, Number.NaN]) {
      expect(() => shortStaffedShiftsOf({ ...input, minimumMembers: minimum }, '2026-10-01', '2026-10-01')).toThrow(RangeError);
    }
  });

  it('refuses a leave record given twice or ending before it starts', () => {
    const record = leave('l', memberIdOf(fx.teams[0]!.id, 0), '2026-10-01');
    expect(() => shortStaffedShiftsOf({ ...input, leaveRecords: [record, record] }, '2026-10-01', '2026-10-01')).toThrow(/"l"/);
    expect(() =>
      shortStaffedShiftsOf({ ...input, leaveRecords: [{ ...record, from: '2026-10-02' }] }, '2026-10-01', '2026-10-01'),
    ).toThrow(RangeError);
  });
});

describe('the result is ids, codes and numbers only (AD-8, FR-18a)', () => {
  it('carries exactly the report fields', () => {
    const fx = FIXTURES[0];
    const [first] = shortStaffedShiftsOf(inputOf(fx, { members: [] }), `${MONTH}-01`, `${MONTH}-31`);
    expect(Object.keys(first!).sort()).toEqual(['atWork', 'code', 'date', 'minimum', 'shiftTypeId', 'teamId']);
  });

  it('a position on the membership changes nothing', () => {
    const fx = FIXTURES[0];
    const { date, teamId } = workingDayOf(fx);
    const ranked = membersOf(fx).map((member) => ({
      ...member,
      memberships: member.memberships.map((version) => ({ ...version, position: 'zapovjednik' })),
    }));
    expect(peopleAtWorkOn(inputOf(fx, { members: ranked }), teamId, date)).toEqual(peopleAtWorkOn(inputOf(fx), teamId, date));
  });

  it('reads no name, fire rank or team position', () => {
    const source = readFileSync(new URL('../src/staffing.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\brank/i);
    expect(code).not.toMatch(/\bname\b/);
    expect(code).not.toMatch(/\bposition\b/);
    expect(code).not.toMatch(/teamPosition|team_position|fireRank|fire_rank/i);
  });
});
