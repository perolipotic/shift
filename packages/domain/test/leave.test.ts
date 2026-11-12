import { describe, expect, it } from 'vitest';

import {
  carryOverExpiryOf,
  datesOfMonth,
  daysBetween,
  drawsAllowance,
  isLeaveDay,
  leaveAllowanceOf,
  leaveBalanceOf,
  leaveCostOf,
  leaveDaysOfMonth,
  leavePreviewOf,
  leaveYearNumberOf,
  leaveYearOf,
  MAX_LEAVE_RANGE_DAYS,
  memberScheduleOfMonth,
  type LeaveAllowance,
  type LeaveBalanceInput,
  type LeaveCarryOver,
  type MemberScheduleInput,
  type MembershipVersion,
  type RosterMember,
  type RosterOverride,
  type StatusVersion,
} from '../src/index.js';
import {
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_TEAMS,
  SEEDED_ANCHOR_DATE,
  SEEDED_EFFECTIVE_FROM,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * Story 5.1a — the leave rule (R4.2, R4.5–R4.7). Node environment, no
 * browser. Every case that reads a schedule runs against both fixtures, and
 * the cost is checked against an oracle that projects each date by hand from
 * the fixture's steps and offsets, using its own day arithmetic. The oracle
 * still enumerates nothing through `leave.ts`, but it does trust the
 * fixture's shape (offset = team index, one shared anchor).
 */

const FIXTURES = [
  {
    fixture: 'pilot',
    types: PILOT_SHIFT_TYPES,
    teams: PILOT_TEAMS,
    steps: PILOT_ROTATION_STEPS,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
  },
  {
    fixture: 'UJ-5',
    types: UJ5_SHIFT_TYPES,
    teams: UJ5_TEAMS,
    steps: UJ5_ROTATION_STEPS,
    assignments: UJ5_ROTATION_ASSIGNMENTS,
  },
] as const;

type Fixture = (typeof FIXTURES)[number];

function workingOf(fx: Fixture): readonly string[] {
  return fx.types.filter((type) => type.isWorking).map((type) => type.id);
}

/** Days from 1970-01-01 to `date`, by the platform's UTC calendar: the test's own arithmetic, not the package's. */
function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Each date from `from` to `to`, inclusive, by the same UTC arithmetic. */
function utcDatesOf(from: string, to: string): readonly string[] {
  const dates: string[] = [];
  for (let day = utcDay(from); day <= utcDay(to); day += 1) dates.push(new Date(day * 86_400_000).toISOString().slice(0, 10));
  return dates;
}

/**
 * The oracle: the step a team stands on on `date`, by the projection formula
 * over the fixture (each team's offset is its index, every anchor
 * {@link SEEDED_ANCHOR_DATE}), with day offsets from the test's own UTC
 * arithmetic rather than the package's date helpers.
 */
function stepOf(fx: Fixture, teamIndex: number, date: string): number {
  const cycle = fx.steps.length;
  return (((teamIndex + utcDay(date) - utcDay(SEEDED_ANCHOR_DATE)) % cycle) + cycle) % cycle;
}

function oracleWorking(fx: Fixture, teamIndex: number, date: string): boolean {
  const step = fx.steps[stepOf(fx, teamIndex, date)]!;
  return workingOf(fx).includes(step.shiftTypeId);
}

/** The team standing on step `step` on `date`. */
function teamOnStep(fx: Fixture, date: string, step: number): number {
  const index = fx.teams.findIndex((_, teamIndex) => stepOf(fx, teamIndex, date) === step);
  if (index < 0) throw new Error(`no team of ${fx.fixture} on step ${String(step)} on ${date}`);
  return index;
}

/** One member per team, from the seeded date on. */
function membersOf(fx: Fixture): readonly RosterMember[] {
  return fx.teams.map((team) => ({
    id: `${team.id}-1`,
    memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
    statuses: [],
  }));
}

interface InputOptions {
  readonly rosterOverrides?: readonly RosterOverride[];
  readonly memberships?: readonly MembershipVersion[];
  readonly statuses?: readonly StatusVersion[];
}

function inputOf(fx: Fixture, teamIndex: number, options: InputOptions = {}): MemberScheduleInput {
  const members = membersOf(fx);
  const member = members[teamIndex]!;
  return {
    memberId: member.id,
    memberships: options.memberships ?? member.memberships,
    statuses: options.statuses ?? member.statuses,
    assignments: fx.assignments,
    steps: fx.steps,
    overrides: [],
    members,
    rosterOverrides: options.rosterOverrides ?? [],
    workingShiftTypeIds: workingOf(fx),
  };
}

const MARCH_FIRST = { month: 3, day: 1 } as const;

/** An allowance with no version: `days` in every leave year (story 13.3). */
function startingAt(days: number): LeaveAllowance {
  return { startingDays: days, versions: [] };
}

// ---------------------------------------------------------------------------

describe('the worked example (R4.2): leave 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan costs 3', () => {
  const pilot = FIXTURES[0];
  const team = teamOnStep(pilot, '2026-09-10', 0);
  const input = inputOf(pilot, team);

  it('stands on that exact schedule', () => {
    const shifts = memberScheduleOfMonth(input, '2026-09')
      .filter((day) => day.date >= '2026-09-10' && day.date <= '2026-09-14')
      .map((day) => day.shifts.map((shift) => shift.shiftTypeId));
    expect(shifts).toEqual([['pilot-dan'], ['pilot-noc'], ['pilot-slobodno'], ['pilot-slobodno'], ['pilot-dan']]);
  });

  it('costs 3 leave days', () => {
    expect(leaveCostOf(input, '2026-09-10', '2026-09-14')).toBe(3);
  });
});

describe('UJ-5 (R4.2): 5 dates over Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno cost 3', () => {
  const uj5 = FIXTURES[1];
  const team = teamOnStep(uj5, '2026-09-10', 0);
  const input = inputOf(uj5, team);

  it('stands on that exact schedule', () => {
    const shifts = memberScheduleOfMonth(input, '2026-09')
      .filter((day) => day.date >= '2026-09-10' && day.date <= '2026-09-14')
      .map((day) => day.shifts.map((shift) => shift.shiftTypeId));
    expect(shifts).toEqual([['uj5-jutarnja'], ['uj5-popodnevna'], ['uj5-nocna'], ['uj5-slobodno'], ['uj5-slobodno']]);
  });

  it('costs 3 leave days', () => {
    expect(leaveCostOf(input, '2026-09-10', '2026-09-14')).toBe(3);
  });
});

describe.each(FIXTURES)('the cost of a range under $fixture (R4.2)', (fx) => {
  it('equals the oracle for every team over ranges across months and years', () => {
    const ranges = [
      ['2026-09-01', '2026-09-30'],
      ['2026-12-20', '2027-01-12'],
      ['2028-02-25', '2028-03-03'],
      ['2026-09-07', '2026-09-07'],
    ] as const;
    for (let teamIndex = 0; teamIndex < fx.teams.length; teamIndex += 1) {
      for (const [from, to] of ranges) {
        const dates = utcDatesOf(from, to);
        const expected = dates.filter((date) => oracleWorking(fx, teamIndex, date)).length;
        expect(leaveCostOf(inputOf(fx, teamIndex), from, to), `${fx.fixture} team ${String(teamIndex)} ${from}–${to}`).toBe(expected);
      }
    }
  });

  it('counts a date with two working shifts once: their own, and one a roster override puts them on', () => {
    const date = '2026-09-10';
    const own = teamOnStep(fx, date, 0);
    const other = teamOnStep(fx, date, 1);
    const otherMember = membersOf(fx)[other]!.id;
    const ownMember = membersOf(fx)[own]!.id;
    const input = inputOf(fx, own, {
      rosterOverrides: [{ id: 'r1', teamId: fx.teams[other]!.id, date, memberOutId: otherMember, memberInId: ownMember }],
    });
    const day = memberScheduleOfMonth(input, '2026-09').find((one) => one.date === date)!;
    expect(day.shifts).toHaveLength(2);
    expect(isLeaveDay(day, input.workingShiftTypeIds)).toBe(true);
    expect(leaveCostOf(input, date, date)).toBe(1);
  });

  it('charges a date a roster override puts them on when their own is not working', () => {
    const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
    // A date on which some team is off and some team works step 0 (UJ-5 has fewer teams than steps).
    const date = datesOfMonth('2026-09').find(
      (one) => fx.teams.some((_, i) => stepOf(fx, i, one) === offStep) && fx.teams.some((_, i) => stepOf(fx, i, one) === 0),
    )!;
    const own = teamOnStep(fx, date, offStep);
    const other = teamOnStep(fx, date, 0);
    const input = inputOf(fx, own, {
      rosterOverrides: [
        { id: 'r1', teamId: fx.teams[other]!.id, date, memberOutId: membersOf(fx)[other]!.id, memberInId: membersOf(fx)[own]!.id },
      ],
    });
    expect(leaveCostOf(inputOf(fx, own), date, date)).toBe(0);
    expect(leaveCostOf(input, date, date)).toBe(1);
  });

  it('costs 0 on a date a roster override takes them off their only shift', () => {
    const date = '2026-09-10';
    const own = teamOnStep(fx, date, 0);
    const input = inputOf(fx, own, {
      rosterOverrides: [{ id: 'r1', teamId: fx.teams[own]!.id, date, memberOutId: membersOf(fx)[own]!.id, memberInId: null }],
    });
    expect(leaveCostOf(inputOf(fx, own), date, date)).toBe(1);
    expect(leaveCostOf(input, date, date)).toBe(0);
  });

  it('costs 0 on dates while inactive', () => {
    const team = teamOnStep(fx, '2026-09-10', 0);
    const input = inputOf(fx, team, { statuses: [{ active: false, effectiveFrom: '2026-09-01' }] });
    expect(leaveCostOf(input, '2026-09-01', '2026-09-30')).toBe(0);
    const back = inputOf(fx, team, {
      statuses: [
        { active: false, effectiveFrom: '2026-09-01' },
        { active: true, effectiveFrom: '2026-09-16' },
      ],
    });
    expect(leaveCostOf(back, '2026-09-01', '2026-09-30')).toBe(leaveCostOf(inputOf(fx, team), '2026-09-16', '2026-09-30'));
  });

  it('costs 0 on a date while inactive even when a roster override puts them on a working shift', () => {
    const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
    const date = datesOfMonth('2026-09').find(
      (one) => fx.teams.some((_, i) => stepOf(fx, i, one) === offStep) && fx.teams.some((_, i) => stepOf(fx, i, one) === 0),
    )!;
    const own = teamOnStep(fx, date, offStep);
    const other = teamOnStep(fx, date, 0);
    // `members` keeps the member active, so the override applies and the schedule shows the shift;
    // the member's own statuses say inactive, and an inactive date costs nothing whatever the schedule holds.
    const input = inputOf(fx, own, {
      statuses: [{ active: false, effectiveFrom: '2026-09-01' }],
      rosterOverrides: [
        { id: 'r1', teamId: fx.teams[other]!.id, date, memberOutId: membersOf(fx)[other]!.id, memberInId: membersOf(fx)[own]!.id },
      ],
    });
    const day = memberScheduleOfMonth(input, '2026-09').find((one) => one.date === date)!;
    expect(isLeaveDay(day, input.workingShiftTypeIds)).toBe(true);
    expect(leaveCostOf(input, date, date)).toBe(0);
  });

  it('costs 0 on dates on no team, and before the first membership', () => {
    const team = teamOnStep(fx, '2026-09-10', 0);
    const teamId = fx.teams[team]!.id;
    const left = inputOf(fx, team, {
      memberships: [
        { teamId, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM },
        { teamId: null, position: null, effectiveFrom: '2026-09-01' },
      ],
    });
    expect(leaveCostOf(left, '2026-09-01', '2026-09-30')).toBe(0);
    const late = inputOf(fx, team, { memberships: [{ teamId, position: null, effectiveFrom: '2026-10-01' }] });
    expect(leaveCostOf(late, '2026-09-01', '2026-09-30')).toBe(0);
  });
});

describe.each(FIXTURES)('the charged leave days of a month under $fixture (R4.2)', (fx) => {
  it('splits a record over a month edge into each month, the months summing to its cost', () => {
    const record = { from: '2026-09-25', to: '2026-10-06' };
    for (let teamIndex = 0; teamIndex < fx.teams.length; teamIndex += 1) {
      const input = inputOf(fx, teamIndex);
      const september = leaveDaysOfMonth(input, [record], '2026-09');
      const october = leaveDaysOfMonth(input, [record], '2026-10');
      expect(september).toEqual(utcDatesOf(record.from, '2026-09-30').filter((date) => oracleWorking(fx, teamIndex, date)));
      expect(october).toEqual(utcDatesOf('2026-10-01', record.to).filter((date) => oracleWorking(fx, teamIndex, date)));
      expect(september.length + october.length).toBe(leaveCostOf(input, record.from, record.to));
      expect(leaveDaysOfMonth(input, [record], '2026-11')).toEqual([]);
    }
  });

  it('collects every record of the month, in date order, whatever order the records come in', () => {
    const team = teamOnStep(fx, '2026-09-10', 0);
    const input = inputOf(fx, team);
    const records = [
      { from: '2026-09-20', to: '2026-09-24' },
      { from: '2026-09-02', to: '2026-09-06' },
    ];
    const days = leaveDaysOfMonth(input, records, '2026-09');
    expect(days).toEqual([...days].sort());
    expect(days.length).toBe(leaveCostOf(input, '2026-09-02', '2026-09-06') + leaveCostOf(input, '2026-09-20', '2026-09-24'));
  });

  it('counts no date with no working shift', () => {
    const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
    const date = datesOfMonth('2026-09').find((one) => fx.teams.some((_, i) => stepOf(fx, i, one) === offStep))!;
    const input = inputOf(fx, teamOnStep(fx, date, offStep));
    expect(leaveDaysOfMonth(input, [{ from: date, to: date }], '2026-09')).toEqual([]);
  });

  it('counts no date while inactive', () => {
    const team = teamOnStep(fx, '2026-09-10', 0);
    const record = { from: '2026-09-01', to: '2026-09-30' };
    const inactive = inputOf(fx, team, { statuses: [{ active: false, effectiveFrom: '2026-09-01' }] });
    expect(leaveDaysOfMonth(inputOf(fx, team), [record], '2026-09').length).toBeGreaterThan(0);
    expect(leaveDaysOfMonth(inactive, [record], '2026-09')).toEqual([]);
  });

  it('refuses a bad month or record', () => {
    const input = inputOf(fx, 0);
    expect(() => leaveDaysOfMonth(input, [], '2026-13')).toThrow(RangeError);
    expect(() => leaveDaysOfMonth(input, [{ from: '2026-09-14', to: '2026-09-10' }], '2026-09')).toThrow(/^leave record 0 /);
    expect(() => leaveDaysOfMonth(input, [{ from: '2026-09-1x', to: '2026-09-20' }], '2026-09')).toThrow(/^the start of leave record 0 /);
  });

  it('renders the month past a malformed record lying wholly in another month: inverted, too long or an impossible date', () => {
    const team = teamOnStep(fx, '2026-09-10', 0);
    const input = inputOf(fx, team);
    const good = { from: '2026-09-08', to: '2026-09-12' };
    const outside = [
      { from: '2026-11-14', to: '2026-11-10' },
      { from: '2026-11-31', to: '2026-12-02' },
      { from: '2024-01-01', to: '2025-12-31' },
    ];
    expect(leaveDaysOfMonth(input, [...outside, good], '2026-09')).toEqual(leaveDaysOfMonth(input, [good], '2026-09'));
    expect(leaveDaysOfMonth(input, [{ from: '2026-01-01', to: '2026-12-31' }], '2026-09').length).toBe(
      leaveCostOf(input, '2026-09-01', '2026-09-30'),
    );
  });

  it('checks a record reaching the month whole, as leaveCostOf does: a bad end beyond the month still fails it', () => {
    const input = inputOf(fx, 0);
    // Straddling: one end inside September, the record inverted or too long as a whole.
    expect(() => leaveDaysOfMonth(input, [{ from: '2026-09-20', to: '2026-08-25' }], '2026-09')).toThrow(/^leave record 0 .*ends before it starts/);
    expect(() => leaveDaysOfMonth(input, [{ from: '2025-06-01', to: '2026-09-02' }], '2026-09')).toThrow(/^leave record 0 .*longer than/);
    expect(() => leaveCostOf(input, '2025-06-01', '2026-09-02')).toThrow(RangeError);
    // An impossible date on a record reaching the month fails it.
    expect(() => leaveDaysOfMonth(input, [{ from: '2026-09-28', to: '2026-10-32' }], '2026-09')).toThrow(/^the end of leave record 0 /);
    // An end that is not date-shaped cannot be placed, and fails every month, wherever the other end is.
    expect(() => leaveDaysOfMonth(input, [{ from: '2026-09-28', to: '2026-10-3x' }], '2026-09')).toThrow(/^the end of leave record 0 /);
    expect(() => leaveDaysOfMonth(input, [{ from: 'soon', to: '2026-12-02' }], '2026-09')).toThrow(/^the start of leave record 0 /);
  });
});

describe('isLeaveDay (R4.2) is the per-date rule', () => {
  const shift = (shiftTypeId: string | null) => ({
    teamId: 't',
    shiftTypeId,
    projectedShiftTypeId: shiftTypeId,
    overridden: false,
    rosterChanged: false,
    viaOverride: false,
  });

  it('is true with one or more working shifts, false with none', () => {
    expect(isLeaveDay({ date: '2026-09-10', shifts: [shift('w')] }, ['w'])).toBe(true);
    expect(isLeaveDay({ date: '2026-09-10', shifts: [shift('w'), shift('v')] }, ['w', 'v'])).toBe(true);
    expect(isLeaveDay({ date: '2026-09-10', shifts: [shift('off')] }, ['w'])).toBe(false);
    expect(isLeaveDay({ date: '2026-09-10', shifts: [shift(null)] }, ['w'])).toBe(false);
    expect(isLeaveDay({ date: '2026-09-10', shifts: [] }, ['w'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('the leave year (R4.6)', () => {
  it('starts on 1 March: 2026-02-10 falls in 2025-03-01–2026-02-28', () => {
    expect(leaveYearOf('2026-02-10', { month: 3, day: 1 })).toEqual({ from: '2025-03-01', to: '2026-02-28' });
  });

  it('includes its start date and its last date', () => {
    expect(leaveYearOf('2026-03-01', { month: 3, day: 1 })).toEqual({ from: '2026-03-01', to: '2027-02-28' });
    expect(leaveYearOf('2027-02-28', { month: 3, day: 1 })).toEqual({ from: '2026-03-01', to: '2027-02-28' });
  });

  it('is the calendar year when it starts on 1 January', () => {
    expect(leaveYearOf('2026-09-10', { month: 1, day: 1 })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('takes a mid-month start day', () => {
    expect(leaveYearOf('2026-07-14', { month: 7, day: 15 })).toEqual({ from: '2025-07-15', to: '2026-07-14' });
    expect(leaveYearOf('2026-07-15', { month: 7, day: 15 })).toEqual({ from: '2026-07-15', to: '2027-07-14' });
  });

  it('includes 29 February in a leap year', () => {
    expect(leaveYearOf('2028-02-29', { month: 3, day: 1 })).toEqual({ from: '2027-03-01', to: '2028-02-29' });
    expect(leaveYearOf('2028-03-01', { month: 3, day: 1 })).toEqual({ from: '2028-03-01', to: '2029-02-28' });
    expect(daysBetween('2027-03-01', '2028-02-29') + 1).toBe(366);
  });

  it('is cut at the calendar ends', () => {
    expect(leaveYearOf('0001-02-01', { month: 3, day: 1 })).toEqual({ from: '0001-01-01', to: '0001-02-28' });
    expect(leaveYearOf('9999-12-31', { month: 3, day: 1 })).toEqual({ from: '9999-03-01', to: '9999-12-31' });
  });
});

// ---------------------------------------------------------------------------

describe.each(FIXTURES)('the balance and the preview under $fixture (R4.5–R4.7)', (fx) => {
  const team = teamOnStep(fx, '2026-09-10', 0);
  const input = inputOf(fx, team);
  // 2026-09-10 is a working date for this member; the worked-example window costs 3.
  const base = (overrides: Partial<LeaveBalanceInput> = {}): LeaveBalanceInput => ({
    input,
    allowance: startingAt(20),
    records: [],
    today: '2026-09-01',
    leaveYearStart: MARCH_FIRST,
    ...overrides,
  });

  it('keeps balance = allowance − used, with no record', () => {
    expect(leaveBalanceOf(base())).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 0, balanceDays: 20 });
  });

  it('counts every record inside the current year', () => {
    const balance = leaveBalanceOf(
      base({
        records: [
          { from: '2026-09-10', to: '2026-09-14' },
          { from: '2026-10-01', to: '2026-10-31' },
        ],
      }),
    );
    const expected = leaveCostOf(input, '2026-09-10', '2026-09-14') + leaveCostOf(input, '2026-10-01', '2026-10-31');
    expect(balance.usedDays).toBe(expected);
    expect(balance.balanceDays).toBe(balance.allowanceDays - balance.usedDays);
  });

  it('counts only the dates inside the current year of a record straddling its start', () => {
    const record = { from: '2026-02-20', to: '2026-03-10' };
    const balance = leaveBalanceOf(base({ records: [record] }));
    expect(balance.usedDays).toBe(leaveCostOf(input, '2026-03-01', '2026-03-10'));
    expect(balance.usedDays).toBeLessThan(leaveCostOf(input, record.from, record.to));
  });

  it('counts only the dates inside the current year of a record straddling its end', () => {
    const balance = leaveBalanceOf(base({ records: [{ from: '2027-02-20', to: '2027-03-10' }] }));
    expect(balance.usedDays).toBe(leaveCostOf(input, '2027-02-20', '2027-02-28'));
  });

  it('ignores a record wholly in another year', () => {
    expect(leaveBalanceOf(base({ records: [{ from: '2025-09-10', to: '2025-09-14' }] })).usedDays).toBe(0);
  });

  it('goes negative over allowance, never refusing', () => {
    const balance = leaveBalanceOf(base({ allowance: startingAt(1), records: [{ from: '2026-09-10', to: '2026-09-14' }] }));
    expect(balance).toEqual({ allowanceDays: 1, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: -2 });
  });

  it('previews a range across leave years: the cost counts all dates, the charge only this year', () => {
    const today = '2027-02-10';
    const range = { from: '2027-02-20', to: '2027-03-10' };
    const preview = leavePreviewOf({ ...base({ today }), range });
    expect(preview.costDays).toBe(leaveCostOf(input, range.from, range.to));
    expect(preview.costInYearDays).toBe(leaveCostOf(input, '2027-02-20', '2027-02-28'));
    expect(preview.costInYearDays).toBeLessThan(preview.costDays);
    expect(preview.balanceAfterDays).toBe(20 - preview.costInYearDays);
    expect(preview.exceedsBalance).toBe(false);
  });

  it('previews a range straddling the start of the leave year: cost = in-year charge + the part before it', () => {
    const range = { from: '2026-02-20', to: '2026-03-10' };
    const preview = leavePreviewOf({ ...base(), range });
    const before = leaveCostOf(input, '2026-02-20', '2026-02-28');
    expect(before).toBeGreaterThan(0);
    expect(preview.costInYearDays).toBe(leaveCostOf(input, '2026-03-01', '2026-03-10'));
    expect(preview.costDays).toBe(preview.costInYearDays + before);
  });

  it('charges nothing for a range wholly in the next year', () => {
    const preview = leavePreviewOf({ ...base(), range: { from: '2027-03-10', to: '2027-03-14' } });
    expect(preview.costDays).toBeGreaterThan(0);
    expect(preview.costInYearDays).toBe(0);
    expect(preview.balanceAfterDays).toBe(20);
  });

  it('flags over balance: allowance 2, used 1, new cost 3 gives −2', () => {
    const preview = leavePreviewOf({
      ...base({ allowance: startingAt(2), records: [{ from: '2026-09-10', to: '2026-09-10' }] }),
      range: { from: '2026-09-14', to: '2026-09-18' },
    });
    expect(leaveBalanceOf(base({ allowance: startingAt(2), records: [{ from: '2026-09-10', to: '2026-09-10' }] }))).toEqual({
      allowanceDays: 2,
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
      usedDays: 1,
      balanceDays: 1,
    });
    expect(preview).toEqual({
      allowanceDays: 2,
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
      usedDays: 1,
      balanceDays: 1,
      costDays: 3,
      costInYearDays: 3,
      balanceAfterDays: -2,
      endBalanceAfterDays: -2,
      exceedsBalance: true,
      exceedsAfterExpiry: false,
      overlapsRecord: false,
    });
  });

  it('does not flag a range that uses the balance exactly', () => {
    const preview = leavePreviewOf({ ...base({ allowance: startingAt(3) }), range: { from: '2026-09-10', to: '2026-09-14' } });
    expect(preview).toEqual({
      allowanceDays: 3,
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
      usedDays: 0,
      balanceDays: 3,
      costDays: 3,
      costInYearDays: 3,
      balanceAfterDays: 0,
      endBalanceAfterDays: 0,
      exceedsBalance: false,
      exceedsAfterExpiry: false,
      overlapsRecord: false,
    });
  });

  it('carries the balance before the range, equal to leaveBalanceOf', () => {
    const records = [{ from: '2026-09-10', to: '2026-09-14' }];
    const preview = leavePreviewOf({ ...base({ records }), range: { from: '2026-10-01', to: '2026-10-05' } });
    const balance = leaveBalanceOf(base({ records }));
    expect({
      allowanceDays: preview.allowanceDays,
      carriedDays: preview.carriedDays,
      lapsedDays: preview.lapsedDays,
      carryOverExpiry: preview.carryOverExpiry,
      usedDays: preview.usedDays,
      balanceDays: preview.balanceDays,
    }).toEqual(balance);
  });

  it('does not flag a range charging 0 when the balance is already negative', () => {
    const preview = leavePreviewOf({
      ...base({ allowance: startingAt(1), records: [{ from: '2026-09-10', to: '2026-09-14' }] }),
      range: { from: '2027-03-10', to: '2027-03-14' },
    });
    expect(preview.balanceDays).toBe(-2);
    expect(preview.costInYearDays).toBe(0);
    expect(preview.balanceAfterDays).toBe(-2);
    expect(preview.exceedsBalance).toBe(false);
  });

  it('flags a range charging 1 when the balance is already negative', () => {
    const workDate = datesOfMonth('2026-09').find((date) => date > '2026-09-14' && oracleWorking(fx, team, date))!;
    const preview = leavePreviewOf({
      ...base({ allowance: startingAt(1), records: [{ from: '2026-09-10', to: '2026-09-14' }] }),
      range: { from: workDate, to: workDate },
    });
    expect(preview.balanceDays).toBe(-2);
    expect(preview.costInYearDays).toBe(1);
    expect(preview.balanceAfterDays).toBe(-3);
    expect(preview.exceedsBalance).toBe(true);
  });

  it('does not flag a range charging 0 when the balance is 0', () => {
    const offDate = datesOfMonth('2026-09').find((date) => !oracleWorking(fx, team, date))!;
    const preview = leavePreviewOf({ ...base({ allowance: startingAt(0) }), range: { from: offDate, to: offDate } });
    expect(preview.balanceDays).toBe(0);
    expect(preview.costInYearDays).toBe(0);
    expect(preview.exceedsBalance).toBe(false);
  });

  it('never charges a date an existing record covers, and flags the overlap', () => {
    const records = [{ from: '2026-09-10', to: '2026-09-12' }];
    const range = { from: '2026-09-11', to: '2026-09-18' };
    const preview = leavePreviewOf({ ...base({ records }), range });
    expect(preview.overlapsRecord).toBe(true);
    expect(preview.costDays).toBe(leaveCostOf(input, range.from, range.to));
    expect(preview.costInYearDays).toBe(leaveCostOf(input, '2026-09-13', '2026-09-18'));
    expect(preview.costInYearDays).toBeLessThan(preview.costDays);
    expect(preview.balanceAfterDays).toBe(preview.balanceDays - preview.costInYearDays);
  });

  it('charges nothing for a range wholly inside an existing record, and does not flag the balance', () => {
    const records = [{ from: '2026-09-10', to: '2026-09-14' }];
    const preview = leavePreviewOf({ ...base({ allowance: startingAt(3), records }), range: { from: '2026-09-10', to: '2026-09-14' } });
    expect(preview.balanceDays).toBe(0);
    expect(preview.costDays).toBe(3);
    expect(preview.costInYearDays).toBe(0);
    expect(preview.balanceAfterDays).toBe(0);
    expect(preview.exceedsBalance).toBe(false);
    expect(preview.overlapsRecord).toBe(true);
  });

  it('does not flag a range that only touches a record', () => {
    const preview = leavePreviewOf({ ...base({ records: [{ from: '2026-09-10', to: '2026-09-12' }] }), range: { from: '2026-09-13', to: '2026-09-14' } });
    expect(preview.overlapsRecord).toBe(false);
  });

  // STORY 13.2 (CAP-23, Q9): only records of a drawing absence type use the
  // allowance; every other rule sees every record.
  it('counts only drawing records in the balance; an absent flag draws', () => {
    const annual = { from: '2026-09-10', to: '2026-09-14' };
    const sick = { from: '2026-10-01', to: '2026-10-31', drawsAllowance: false };
    const training = { from: '2026-11-02', to: '2026-11-06', drawsAllowance: true };
    const balance = leaveBalanceOf(base({ records: [annual, sick, training] }));
    const expected = leaveCostOf(input, annual.from, annual.to) + leaveCostOf(input, training.from, training.to);
    expect(leaveCostOf(input, sick.from, sick.to)).toBeGreaterThan(0);
    expect(balance.usedDays).toBe(expected);
    expect(balance.balanceDays).toBe(20 - expected);
    expect(leaveBalanceOf(base({ records: [sick] }))).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 0, balanceDays: 20 });
  });

  it('still refuses two overlapping records whatever their type', () => {
    const records = [
      { from: '2026-09-10', to: '2026-09-14' },
      { from: '2026-09-12', to: '2026-09-16', drawsAllowance: false },
    ];
    expect(() => leaveBalanceOf(base({ records }))).toThrow(/records 0 and 1/);
  });

  it('previews a non-drawing range: its cost is reported, it charges 0 and never exceeds', () => {
    const range = { from: '2026-09-10', to: '2026-09-14', drawsAllowance: false };
    const preview = leavePreviewOf({ ...base({ allowance: startingAt(0) }), range });
    expect(preview.costDays).toBe(3);
    expect(preview.costInYearDays).toBe(0);
    expect(preview.balanceAfterDays).toBe(0);
    expect(preview.exceedsBalance).toBe(false);
  });

  it('flags a non-drawing range overlapping a record, and a drawing range overlapping a non-drawing record charges only the uncovered dates', () => {
    const sick = [{ from: '2026-09-10', to: '2026-09-12', drawsAllowance: false }];
    const overSick = leavePreviewOf({ ...base({ records: sick }), range: { from: '2026-09-11', to: '2026-09-18' } });
    expect(overSick.overlapsRecord).toBe(true);
    expect(overSick.usedDays).toBe(0);
    expect(overSick.costInYearDays).toBe(leaveCostOf(input, '2026-09-13', '2026-09-18'));
    const sickOverAnnual = leavePreviewOf({
      ...base({ records: [{ from: '2026-09-10', to: '2026-09-12' }] }),
      range: { from: '2026-09-11', to: '2026-09-18', drawsAllowance: false },
    });
    expect(sickOverAnnual.overlapsRecord).toBe(true);
    expect(sickOverAnnual.costInYearDays).toBe(0);
  });

  it('charges the leave days of a month for every record, whatever its type', () => {
    const records = [
      { from: '2026-09-10', to: '2026-09-14', drawsAllowance: false },
      { from: '2026-09-20', to: '2026-09-24' },
    ];
    expect(leaveDaysOfMonth(input, records, '2026-09')).toEqual(
      leaveDaysOfMonth(input, records.map(({ from, to }) => ({ from, to })), '2026-09'),
    );
  });
});

describe('the allowance per leave year (story 13.3)', () => {
  it('numbers a leave year by the calendar year it begins in', () => {
    expect(leaveYearNumberOf('2026-02-28', MARCH_FIRST)).toBe(2025);
    expect(leaveYearNumberOf('2026-03-01', MARCH_FIRST)).toBe(2026);
    expect(leaveYearNumberOf('2026-12-31', { month: 1, day: 1 })).toBe(2026);
    expect(leaveYearNumberOf('2026-07-14', { month: 7, day: 15 })).toBe(2025);
    expect(leaveYearNumberOf('0001-02-01', MARCH_FIRST)).toBe(0);
    for (const date of ['2026-02-28', '2026-03-01', '2027-02-28', '9999-12-31']) {
      expect(leaveYearNumberOf(date, MARCH_FIRST)).toBe(Number(leaveYearOf(date, MARCH_FIRST).from.slice(0, 4)));
    }
  });

  it('reads the starting allowance in every year with no version', () => {
    for (const year of [1, 2025, 2026, 9999]) expect(leaveAllowanceOf(startingAt(20), year)).toBe(20);
  });

  it('uses a version from its own year, never before it', () => {
    const allowance: LeaveAllowance = { startingDays: 20, versions: [{ id: 1, leaveYear: 2026, days: 25 }] };
    expect(leaveAllowanceOf(allowance, 2026)).toBe(25);
    expect(leaveAllowanceOf(allowance, 2025)).toBe(20);
  });

  it('inherits the latest earlier year’s version', () => {
    const allowance: LeaveAllowance = {
      startingDays: 20,
      versions: [
        { id: 3, leaveYear: 2024, days: 22 },
        { id: 1, leaveYear: 2026, days: 25 },
        { id: 2, leaveYear: 2029, days: 30 },
      ],
    };
    expect(leaveAllowanceOf(allowance, 2027)).toBe(25);
    expect(leaveAllowanceOf(allowance, 2025)).toBe(22);
    expect(leaveAllowanceOf(allowance, 2023)).toBe(20);
  });

  it('takes the highest id of a corrected year, in any order', () => {
    const versions = [
      { id: 2, leaveYear: 2026, days: 24 },
      { id: 1, leaveYear: 2026, days: 25 },
    ];
    expect(leaveAllowanceOf({ startingDays: 20, versions }, 2026)).toBe(24);
    expect(leaveAllowanceOf({ startingDays: 20, versions: [...versions].reverse() }, 2027)).toBe(24);
  });

  it('balances a past leave year with that year’s allowance', () => {
    const input = inputOf(FIXTURES[0], 0);
    const allowance: LeaveAllowance = { startingDays: 20, versions: [{ id: 1, leaveYear: 2026, days: 25 }] };
    const at = (today: string) => leaveBalanceOf({ input, allowance, records: [], today, leaveYearStart: MARCH_FIRST });
    expect(at('2026-02-10')).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 0, balanceDays: 20 });
    expect(at('2026-09-01')).toEqual({ allowanceDays: 25, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 0, balanceDays: 25 });
    expect(at('2027-09-01').allowanceDays).toBe(25);
    const preview = leavePreviewOf({ input, allowance, records: [], today: '2026-02-10', leaveYearStart: MARCH_FIRST, range: { from: '2026-02-10', to: '2026-02-10' } });
    expect(preview.allowanceDays).toBe(20);
  });

  it('refuses a malformed allowance or version', () => {
    const at = (allowance: LeaveAllowance) => () => leaveAllowanceOf(allowance, 2026);
    expect(at({ startingDays: -1, versions: [] })).toThrow(RangeError);
    expect(at({ startingDays: 20, versions: [{ id: 1, leaveYear: 2026, days: -1 }] })).toThrow(/version 0 is -1 days/);
    expect(at({ startingDays: 20, versions: [{ id: 1, leaveYear: 2026, days: 1.5 }] })).toThrow(/1\.5/);
    expect(at({ startingDays: 20, versions: [{ id: 1, leaveYear: 2026.5, days: 1 }] })).toThrow(/leave year 2026\.5/);
    expect(at({ startingDays: 20, versions: [{ id: 1, leaveYear: 0, days: 1 }] })).toThrow(/leave year 0/);
    expect(at({ startingDays: 20, versions: [{ id: 1, leaveYear: 10000, days: 1 }] })).toThrow(/leave year 10000/);
    expect(at({ startingDays: 20, versions: [{ id: 0, leaveYear: 2026, days: 1 }] })).toThrow(/id 0/);
    // A malformed version in a later year still fails: the input is checked whole.
    expect(at({ startingDays: 20, versions: [{ id: 1, leaveYear: 2030, days: -1 }] })).toThrow(RangeError);
    expect(() => leaveAllowanceOf(startingAt(20), 2026.5)).toThrow(RangeError);
    expect(() => leaveYearNumberOf('2026-13-01', MARCH_FIRST)).toThrow(/"2026-13-01"/);
    const input = inputOf(FIXTURES[0], 0);
    expect(() =>
      leaveBalanceOf({
        input,
        allowance: { startingDays: 20, versions: [{ id: 1, leaveYear: 2026, days: -1 }] },
        records: [],
        today: '2026-09-01',
        leaveYearStart: MARCH_FIRST,
      }),
    ).toThrow(RangeError);
  });
});

describe('carry-over (story 13.4b, R4.13–R4.15)', () => {
  const input = inputOf(FIXTURES[0], 0);
  const JANUARY_FIRST = { month: 1, day: 1 } as const;
  const setting = (overrides: Partial<LeaveCarryOver> = {}): LeaveCarryOver => ({
    maxDays: 5,
    expiryMonth: 6,
    expiryDay: 30,
    firstLeaveYear: 2027,
    ...overrides,
  });

  /** The first `count` dates on or after `from` that cost a leave day, each as a one-date record. */
  const leaveDatesFrom = (from: string, count: number): readonly { from: string; to: string }[] => {
    const records: { from: string; to: string }[] = [];
    let year = Number(from.slice(0, 4));
    let month = Number(from.slice(5, 7));
    while (records.length < count) {
      const key = `${String(year)}-${String(month).padStart(2, '0')}`;
      const dates = datesOfMonth(key);
      for (const date of leaveDaysOfMonth(input, [{ from: dates[0]!, to: dates[dates.length - 1]! }], key)) {
        if (date >= from && records.length < count) records.push({ from: date, to: date });
      }
      month = month === 12 ? 1 : month + 1;
      if (month === 1) year += 1;
    }
    return records;
  };

  const at = (overrides: Partial<LeaveBalanceInput>): LeaveBalanceInput => ({
    input,
    allowance: startingAt(20),
    records: [],
    today: '2027-09-01',
    leaveYearStart: JANUARY_FIRST,
    carryOver: setting(),
    ...overrides,
  });

  const balanced = (balance: { allowanceDays: number; carriedDays: number; usedDays: number; balanceDays: number }) =>
    expect(balance.balanceDays).toBe(balance.allowanceDays + balance.carriedDays - balance.usedDays);

  // The worked example: 2026 uses 14 of 20; 2027 uses 3 before 30.06.
  const workedRecords = [...leaveDatesFrom('2026-02-01', 14), ...leaveDatesFrom('2027-01-10', 3)];

  it('runs the worked example after the expiry: carried 3, lapsed 2, balance 20', () => {
    const balance = leaveBalanceOf(at({ records: workedRecords }));
    expect(balance).toEqual({
      allowanceDays: 20,
      carriedDays: 3,
      lapsedDays: 2,
      carryOverExpiry: '2027-06-30',
      usedDays: 3,
      balanceDays: 20,
    });
  });

  it('counts every carried day before the expiry, and through it', () => {
    for (const today of ['2027-03-01', '2027-06-30']) {
      const balance = leaveBalanceOf(at({ records: workedRecords, today }));
      expect(balance).toMatchObject({ carriedDays: 5, lapsedDays: 0, carryOverExpiry: '2027-06-30', balanceDays: 22 });
      balanced(balance);
    }
    expect(leaveBalanceOf(at({ records: workedRecords, today: '2027-07-01' })).lapsedDays).toBe(2);
  });

  it('lapses nothing when the carried days are all consumed by the expiry', () => {
    const records = [...leaveDatesFrom('2026-02-01', 14), ...leaveDatesFrom('2027-01-10', 7)];
    const balance = leaveBalanceOf(at({ records }));
    expect(balance).toMatchObject({ carriedDays: 5, lapsedDays: 0, usedDays: 7, balanceDays: 18 });
  });

  it('caps the carried days, and carries nothing from an overdrawn year', () => {
    const capped = leaveBalanceOf(at({ records: leaveDatesFrom('2026-02-01', 11), today: '2027-03-01' }));
    expect(capped).toMatchObject({ carriedDays: 5, balanceDays: 25 });
    const overdrawn = leaveBalanceOf(
      at({
        allowance: { startingDays: 10, versions: [{ id: 1, leaveYear: 2027, days: 20 }] },
        records: leaveDatesFrom('2026-02-01', 14),
        today: '2027-03-01',
      }),
    );
    expect(overdrawn).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 0, balanceDays: 20 });
  });

  it('carries the previous year’s allowance when it had no record', () => {
    expect(leaveBalanceOf(at({ today: '2027-03-01', carryOver: setting({ maxDays: 30 }) }))).toMatchObject({ carriedDays: 20, balanceDays: 40 });
  });

  it('carries nothing into a year before the first', () => {
    const balance = leaveBalanceOf(at({ records: workedRecords, carryOver: setting({ firstLeaveYear: 2028 }) }));
    expect(balance).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 17 });
  });

  it('chains from the first year: the previous year’s carried days feed the next', () => {
    // 2025 uses 15 of 20; 2026 uses 20, the first 5 before 30.06.
    const records = [...leaveDatesFrom('2025-02-01', 15), ...leaveDatesFrom('2026-02-01', 20)];
    const today = '2027-03-01';
    const chained = leaveBalanceOf(at({ records, today, carryOver: setting({ firstLeaveYear: 2026 }) }));
    expect(chained).toMatchObject({ carriedDays: 5, balanceDays: 25 });
    // Nothing carried into 2026 when 2027 is the first: 2026 ends at 0.
    expect(leaveBalanceOf(at({ records, today })).carriedDays).toBe(0);
    // R4.15: changing an earlier year's records recomputes the later carry.
    const fewer = leaveBalanceOf(at({ records: [...leaveDatesFrom('2025-02-01', 18), ...leaveDatesFrom('2026-02-01', 20)], today, carryOver: setting({ firstLeaveYear: 2026 }) }));
    expect(fewer.carriedDays).toBe(2);
  });

  it('reads the chain’s years with their own allowances', () => {
    const allowance: LeaveAllowance = { startingDays: 20, versions: [{ id: 1, leaveYear: 2026, days: 16 }] };
    const balance = leaveBalanceOf(at({ allowance, records: leaveDatesFrom('2026-02-01', 14), today: '2027-03-01' }));
    expect(balance).toMatchObject({ allowanceDays: 16, carriedDays: 2, balanceDays: 18 });
  });

  it('skips non-drawing records, in the year carried from and the year carried into', () => {
    const sick = (records: readonly { from: string; to: string }[]) => records.map((record) => ({ ...record, drawsAllowance: false }));
    const balance = leaveBalanceOf(at({ records: [...sick(leaveDatesFrom('2026-02-01', 18)), ...sick(leaveDatesFrom('2027-01-10', 3))] }));
    expect(balance).toMatchObject({ carriedDays: 0, lapsedDays: 5, usedDays: 0, balanceDays: 20 });
  });

  it('places the expiry on or after the leave year’s first day', () => {
    expect(carryOverExpiryOf(2027, JANUARY_FIRST, setting())).toBe('2027-06-30');
    expect(carryOverExpiryOf(2027, { month: 7, day: 1 }, setting())).toBe('2028-06-30');
    expect(carryOverExpiryOf(2027, { month: 6, day: 15 }, setting({ expiryDay: 15 }))).toBe('2027-06-15');
    expect(carryOverExpiryOf(9999, { month: 7, day: 1 }, setting())).toBe('9999-12-31');
    // A start of 01.07.: the leave year 2027 is 01.07.2027–30.06.2028.
    const records = [...leaveDatesFrom('2026-08-01', 14), ...leaveDatesFrom('2028-01-10', 3)];
    const balance = leaveBalanceOf(at({ records, today: '2028-03-01', leaveYearStart: { month: 7, day: 1 } }));
    expect(balance).toMatchObject({ carriedDays: 5, carryOverExpiry: '2028-06-30', balanceDays: 22 });
  });

  it('previews a range after the expiry against the year’s end, never the carried days', () => {
    // 2027: allowance 10, 5 carried; 1 day before 30.06. and 10 after it.
    const allowance: LeaveAllowance = { startingDays: 20, versions: [{ id: 1, leaveYear: 2027, days: 10 }] };
    const after = leaveDatesFrom('2027-07-01', 12);
    const records = [...leaveDatesFrom('2026-02-01', 15), ...leaveDatesFrom('2027-01-10', 1), ...after.slice(0, 10)];
    const base = at({ allowance, records, today: '2027-03-01' });
    expect(leaveBalanceOf(base)).toMatchObject({ carriedDays: 5, usedDays: 11, balanceDays: 4 });

    const late = leavePreviewOf({ ...base, range: { from: after[10]!.from, to: after[11]!.to } });
    // The warning is the expiry's: the balance is still 2 today, and −2 once 30.06. has passed.
    expect(late).toMatchObject({
      costInYearDays: 2,
      balanceDays: 4,
      balanceAfterDays: 2,
      endBalanceAfterDays: -2,
      exceedsBalance: true,
      exceedsAfterExpiry: true,
    });

    const early = leaveDatesFrom('2027-02-01', 2);
    const inTime = leavePreviewOf({ ...base, range: { from: early[0]!.from, to: early[1]!.to } });
    expect(inTime.costInYearDays).toBe(leaveCostOf(input, early[0]!.from, early[1]!.to));
    expect(inTime.balanceAfterDays).toBe(4 - inTime.costInYearDays);
    expect(inTime.exceedsBalance).toBe(inTime.costInYearDays > 2);
    expect(inTime.exceedsAfterExpiry).toBe(false);
  });

  it('flags a range in the previous leave year that shrinks the carry below zero, though it charges nothing this year', () => {
    // 2027: allowance 0, 5 carried from 2026 (15 of 20 used), 3 days before 30.06.
    const allowance: LeaveAllowance = { startingDays: 20, versions: [{ id: 1, leaveYear: 2027, days: 0 }] };
    const records = [...leaveDatesFrom('2026-02-01', 15), ...leaveDatesFrom('2027-01-10', 3)];
    const base = at({ allowance, records, today: '2027-03-01' });
    expect(leaveBalanceOf(base)).toMatchObject({ carriedDays: 5, balanceDays: 2 });

    const late2026 = leaveDatesFrom('2026-10-01', 3);
    const preview = leavePreviewOf({ ...base, range: { from: late2026[0]!.from, to: late2026[2]!.to } });
    expect(preview.costInYearDays).toBe(0);
    // 2026 ends at 2, so 2 carry: 0 + 2 − 3 = −1, today and after the expiry.
    expect(preview).toMatchObject({ balanceAfterDays: -1, endBalanceAfterDays: -1, exceedsBalance: true, exceedsAfterExpiry: false });

    // One day in 2026 leaves 4 carried: 1 today, 0 after the expiry (3 consumed): lower, but no warning.
    const one = leavePreviewOf({ ...base, range: late2026[0]! });
    expect(one).toMatchObject({ costInYearDays: 0, balanceAfterDays: 1, endBalanceAfterDays: 0, exceedsBalance: false });
  });

  it('previews a range before the expiry, after it has passed, as consuming the carried days', () => {
    const base = at({ records: workedRecords });
    const early = leaveDatesFrom('2027-02-01', 1);
    const preview = leavePreviewOf({ ...base, range: early[0]! });
    expect(preview).toMatchObject({ carriedDays: 3, balanceDays: 20, costInYearDays: 1, balanceAfterDays: 20, exceedsBalance: false });
  });

  it('reads an absent or null setting as no carry-over, every figure as before', () => {
    const records = workedRecords;
    const absent = leaveBalanceOf({ input, allowance: startingAt(20), records, today: '2027-09-01', leaveYearStart: JANUARY_FIRST });
    expect(absent).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 17 });
    expect(leaveBalanceOf(at({ records, carryOver: null }))).toEqual(absent);
    const range = leaveDatesFrom('2027-08-01', 1)[0]!;
    expect(leavePreviewOf({ ...at({ records, carryOver: null }), range })).toMatchObject({ balanceAfterDays: 16, exceedsBalance: false });
  });

  it('refuses a malformed setting, naming it', () => {
    const refused = (carryOver: LeaveCarryOver) => () => leaveBalanceOf(at({ carryOver }));
    expect(refused(setting({ maxDays: 0 }))).toThrow(/carry-over cap is 0 days/);
    expect(refused(setting({ maxDays: 2.5 }))).toThrow(RangeError);
    expect(refused(setting({ expiryMonth: 13 }))).toThrow(/month 13/);
    expect(refused(setting({ expiryDay: 31 }))).toThrow(/day 31 of month 6/);
    expect(refused(setting({ expiryMonth: 2, expiryDay: 29 }))).toThrow(/day 29 of month 2/);
    expect(refused(setting({ firstLeaveYear: 0 }))).toThrow(/first leave year carried into is 0/);
    expect(refused(setting({ firstLeaveYear: 10000 }))).toThrow(RangeError);
    // Checked even when no year is carried into yet.
    expect(() => leaveBalanceOf(at({ carryOver: setting({ maxDays: 0, firstLeaveYear: 2099 }) }))).toThrow(RangeError);
    expect(() => carryOverExpiryOf(0, JANUARY_FIRST, setting())).toThrow(/leave year is 0/);
  });
});

describe('drawsAllowance (story 13.2)', () => {
  it('reads an absent flag as drawing, and only false as not', () => {
    expect(drawsAllowance({ from: '2026-09-10', to: '2026-09-10' })).toBe(true);
    expect(drawsAllowance({ from: '2026-09-10', to: '2026-09-10', drawsAllowance: true })).toBe(true);
    expect(drawsAllowance({ from: '2026-09-10', to: '2026-09-10', drawsAllowance: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('a breached precondition throws a RangeError naming the value', () => {
  const fx = FIXTURES[0];
  const input = inputOf(fx, 0);
  const base: LeaveBalanceInput = { input, allowance: startingAt(20), records: [], today: '2026-09-01', leaveYearStart: MARCH_FIRST };

  it('refuses a range ending before it starts', () => {
    expect(() => leaveCostOf(input, '2026-09-14', '2026-09-10')).toThrow(RangeError);
    expect(() => leaveCostOf(input, '2026-09-14', '2026-09-10')).toThrow(/"2026-09-14".*"2026-09-10"/);
    expect(() => leavePreviewOf({ ...base, range: { from: '2026-09-14', to: '2026-09-10' } })).toThrow(/"2026-09-14"/);
    expect(() => leaveBalanceOf({ ...base, records: [{ from: '2026-09-14', to: '2026-09-10' }] })).toThrow(/"2026-09-14"/);
  });

  it('refuses two records sharing a date, naming both by index', () => {
    const records = [
      { from: '2026-10-01', to: '2026-10-05' },
      { from: '2026-09-01', to: '2026-09-03' },
      { from: '2026-09-03', to: '2026-09-04' },
    ];
    expect(() => leaveBalanceOf({ ...base, records })).toThrow(RangeError);
    expect(() => leaveBalanceOf({ ...base, records })).toThrow(/records 1 and 2 share "2026-09-03"/);
    expect(() => leavePreviewOf({ ...base, records, range: { from: '2026-11-01', to: '2026-11-01' } })).toThrow(/records 1 and 2/);
  });

  it('names a bad record once, by its index', () => {
    const records = [
      { from: '2026-09-01', to: '2026-09-03' },
      { from: '2026-09-14', to: '2026-09-10' },
    ];
    expect(() => leaveBalanceOf({ ...base, records })).toThrow(/^leave record 1 runs from "2026-09-14" to "2026-09-10"/);
  });

  it(`refuses a range or record longer than ${String(MAX_LEAVE_RANGE_DAYS)} days`, () => {
    expect(MAX_LEAVE_RANGE_DAYS).toBe(366);
    expect(leaveCostOf(input, '2027-03-01', '2028-02-29')).toBeGreaterThan(0);
    expect(() => leaveCostOf(input, '2027-03-01', '2028-03-01')).toThrow(RangeError);
    expect(() => leaveCostOf(input, '2026-09-01', '2206-09-10')).toThrow(/"2206-09-10"/);
    expect(() => leavePreviewOf({ ...base, range: { from: '2026-09-01', to: '2206-09-10' } })).toThrow(/"2206-09-10"/);
    expect(() => leaveBalanceOf({ ...base, records: [{ from: '2026-09-01', to: '2206-09-10' }] })).toThrow(/^leave record 0 .*"2206-09-10"/);
  });

  it('refuses a non-date', () => {
    expect(() => leaveCostOf(input, '2026-02-30', '2026-03-02')).toThrow(/"2026-02-30"/);
    expect(() => leaveCostOf(input, '2026-09-01', 'soon')).toThrow(/"soon"/);
    expect(() => leaveYearOf('2026-13-01', { month: 3, day: 1 })).toThrow(/"2026-13-01"/);
    expect(() => leaveBalanceOf({ ...base, today: '2026-9-1' })).toThrow(/"2026-9-1"/);
  });

  it('refuses a leave-year start day outside 1–28, or a month outside 1–12', () => {
    expect(() => leaveYearOf('2026-09-01', { month: 3, day: 29 })).toThrow(RangeError);
    expect(() => leaveYearOf('2026-09-01', { month: 3, day: 29 })).toThrow(/29/);
    expect(() => leaveYearOf('2026-09-01', { month: 3, day: 0 })).toThrow(/day 0/);
    expect(() => leaveYearOf('2026-09-01', { month: 13, day: 1 })).toThrow(/month 13/);
    expect(() => leaveYearOf('2026-09-01', { month: 1.5, day: 1 })).toThrow(/month 1.5/);
    expect(() => leaveBalanceOf({ ...base, leaveYearStart: { month: 2, day: 29 } })).toThrow(/day 29/);
  });

  it('refuses a negative or fractional allowance', () => {
    expect(() => leaveBalanceOf({ ...base, allowance: startingAt(-1) })).toThrow(RangeError);
    expect(() => leaveBalanceOf({ ...base, allowance: startingAt(-1) })).toThrow(/-1/);
    expect(() => leaveBalanceOf({ ...base, allowance: startingAt(2.5) })).toThrow(/2\.5/);
    expect(() => leavePreviewOf({ ...base, allowance: startingAt(-1), range: { from: '2026-09-10', to: '2026-09-10' } })).toThrow(/-1/);
  });
});
