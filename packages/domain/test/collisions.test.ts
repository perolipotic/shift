import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  collisionKeyOf,
  collisionsOf,
  datesOfMonth,
  leaveCostOf,
  MAX_LEAVE_RANGE_DAYS,
  scheduleOfMonth,
  unresolvedCollisionsOf,
  type Collision,
  type CollisionInput,
  type CollisionLeaveRecord,
  type CollisionResolution,
  type MemberScheduleInput,
  type RosterMember,
  type RosterOverride,
  type ShiftTypeOverride,
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
 * Story 5.3a — a collision is derived from leave, one per working shift, and
 * stored nowhere (R6.1, R6.2, R6.8, R7.1, R7.3; AD-4). Node environment, no
 * browser, against both fixtures. The load-bearing property is agreement with
 * the cost: for every member, the distinct collision dates are what
 * `leaveCostOf` charges over their records.
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

function offTypeOf(fx: Fixture): string {
  return fx.types.find((type) => !type.isWorking)!.id;
}

/** Days from 1970-01-01 to `date`, by the platform's UTC calendar: the test's own arithmetic. */
function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** The step a team stands on on `date` (each team's offset is its index, one shared anchor). */
function stepOf(fx: Fixture, teamIndex: number, date: string): number {
  const cycle = fx.steps.length;
  return (((teamIndex + utcDay(date) - utcDay(SEEDED_ANCHOR_DATE)) % cycle) + cycle) % cycle;
}

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
  readonly members?: readonly RosterMember[];
  readonly overrides?: readonly ShiftTypeOverride[];
  readonly rosterOverrides?: readonly RosterOverride[];
}

function inputOf(fx: Fixture, leaveRecords: readonly CollisionLeaveRecord[], options: InputOptions = {}): CollisionInput {
  return {
    assignments: fx.assignments,
    steps: fx.steps,
    overrides: options.overrides ?? [],
    members: options.members ?? membersOf(fx),
    rosterOverrides: options.rosterOverrides ?? [],
    workingShiftTypeIds: workingOf(fx),
    leaveRecords,
  };
}

/** One member's schedule input carved out of an organization-wide one: what `leaveCostOf` reads. */
function memberInputOf(input: CollisionInput, memberId: string): MemberScheduleInput {
  const member = input.members.find((one) => one.id === memberId)!;
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    assignments: input.assignments,
    steps: input.steps,
    overrides: input.overrides,
    members: input.members,
    rosterOverrides: input.rosterOverrides,
    workingShiftTypeIds: input.workingShiftTypeIds,
  };
}

function memberOf(fx: Fixture, teamIndex: number): string {
  return membersOf(fx)[teamIndex]!.id;
}

/** A date of September 2026 on which some team is off and some team works step 0. */
function offAndStepZeroDate(fx: Fixture): string {
  const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
  return datesOfMonth('2026-09').find(
    (one) => fx.teams.some((_, i) => stepOf(fx, i, one) === offStep) && fx.teams.some((_, i) => stepOf(fx, i, one) === 0),
  )!;
}

function expectOrdered(collisions: readonly Collision[]): void {
  for (let i = 1; i < collisions.length; i += 1) {
    const a = collisions[i - 1]!;
    const b = collisions[i]!;
    expect(
      a.date < b.date || (a.date === b.date && (a.teamId < b.teamId || (a.teamId === b.teamId && a.memberId < b.memberId))),
      `${JSON.stringify(a)} before ${JSON.stringify(b)}`,
    ).toBe(true);
  }
}

// ---------------------------------------------------------------------------

describe('the worked example (R6.1): leave 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan raises 3', () => {
  const pilot = FIXTURES[0];
  const team = teamOnStep(pilot, '2026-09-10', 0);
  const memberId = memberOf(pilot, team);
  const input = inputOf(pilot, [{ id: 'leave-1', memberId, from: '2026-09-10', to: '2026-09-14' }]);

  it('raises one collision per working shift, soonest first', () => {
    const teamId = pilot.teams[team]!.id;
    expect(collisionsOf(input)).toEqual([
      { memberId, date: '2026-09-10', teamId, shiftTypeId: 'pilot-dan', leaveRecordId: 'leave-1' },
      { memberId, date: '2026-09-11', teamId, shiftTypeId: 'pilot-noc', leaveRecordId: 'leave-1' },
      { memberId, date: '2026-09-14', teamId, shiftTypeId: 'pilot-dan', leaveRecordId: 'leave-1' },
    ]);
  });

  it('agrees with the cost of 3', () => {
    expect(leaveCostOf(memberInputOf(input, memberId), '2026-09-10', '2026-09-14')).toBe(3);
  });
});

describe('UJ-5 (R6.1): 5 dates over Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno raise 3', () => {
  const uj5 = FIXTURES[1];
  const team = teamOnStep(uj5, '2026-09-10', 0);
  const memberId = memberOf(uj5, team);

  it('raises 3, soonest first', () => {
    const teamId = uj5.teams[team]!.id;
    expect(collisionsOf(inputOf(uj5, [{ id: 'leave-1', memberId, from: '2026-09-10', to: '2026-09-14' }]))).toEqual([
      { memberId, date: '2026-09-10', teamId, shiftTypeId: 'uj5-jutarnja', leaveRecordId: 'leave-1' },
      { memberId, date: '2026-09-11', teamId, shiftTypeId: 'uj5-popodnevna', leaveRecordId: 'leave-1' },
      { memberId, date: '2026-09-12', teamId, shiftTypeId: 'uj5-nocna', leaveRecordId: 'leave-1' },
    ]);
  });
});

describe.each(FIXTURES)('the collision rule under $fixture (R6.1, R7.1, R7.3)', (fx) => {
  const date = '2026-09-10';
  const own = teamOnStep(fx, date, 0);
  const ownMember = memberOf(fx, own);
  const ownTeam = fx.teams[own]!.id;

  it('raises nothing over non-working dates only', () => {
    // Two consecutive September dates on which their own team is off.
    const dates = datesOfMonth('2026-09');
    const isOff = (one: string): boolean => !workingOf(fx).includes(fx.steps[stepOf(fx, own, one)]!.shiftTypeId);
    const start = dates.findIndex((one, index) => isOff(one) && index + 1 < dates.length && isOff(dates[index + 1]!));
    const from = dates[start]!;
    const to = dates[start + 1]!;
    const input = inputOf(fx, [{ id: 'l', memberId: ownMember, from, to }]);
    expect(collisionsOf(input)).toEqual([]);
    expect(leaveCostOf(memberInputOf(input, ownMember), from, to)).toBe(0);
  });

  it('raises two collisions, one per team, when a roster override puts them on another team: cost 1', () => {
    const other = teamOnStep(fx, date, 1);
    const input = inputOf(fx, [{ id: 'l', memberId: ownMember, from: date, to: date }], {
      rosterOverrides: [{ id: 'r1', teamId: fx.teams[other]!.id, date, memberOutId: memberOf(fx, other), memberInId: ownMember }],
    });
    const collisions = collisionsOf(input);
    expect(collisions).toHaveLength(2);
    expect(new Set(collisions.map((one) => one.teamId))).toEqual(new Set([ownTeam, fx.teams[other]!.id]));
    expect(new Set(collisions.map(collisionKeyOf)).size).toBe(2);
    expectOrdered(collisions);
    expect(leaveCostOf(memberInputOf(input, ownMember), date, date)).toBe(1);
  });

  it('raises one on a team a roster override puts them on when their own shift is off', () => {
    const offDate = offAndStepZeroDate(fx);
    const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
    const offTeam = teamOnStep(fx, offDate, offStep);
    const workTeam = teamOnStep(fx, offDate, 0);
    const input = inputOf(fx, [{ id: 'l', memberId: memberOf(fx, offTeam), from: offDate, to: offDate }], {
      rosterOverrides: [
        { id: 'r1', teamId: fx.teams[workTeam]!.id, date: offDate, memberOutId: memberOf(fx, workTeam), memberInId: memberOf(fx, offTeam) },
      ],
    });
    expect(collisionsOf(input)).toEqual([
      {
        memberId: memberOf(fx, offTeam),
        date: offDate,
        teamId: fx.teams[workTeam]!.id,
        shiftTypeId: fx.steps[0]!.shiftTypeId,
        leaveRecordId: 'l',
      },
    ]);
  });

  it('raises nothing on a date a roster override takes them off their only shift', () => {
    const records = [{ id: 'l', memberId: ownMember, from: date, to: date }];
    expect(collisionsOf(inputOf(fx, records))).toHaveLength(1);
    const takenOff = inputOf(fx, records, {
      rosterOverrides: [{ id: 'r1', teamId: ownTeam, date, memberOutId: ownMember, memberInId: null }],
    });
    expect(collisionsOf(takenOff)).toEqual([]);
  });

  it('follows a shift-type override: working to non-working, and the reverse', () => {
    const records = [{ id: 'l', memberId: ownMember, from: date, to: date }];
    expect(collisionsOf(inputOf(fx, records, { overrides: [{ teamId: ownTeam, date, shiftTypeId: offTypeOf(fx) }] }))).toEqual([]);

    const offDate = datesOfMonth('2026-09').find((one) => !workingOf(fx).includes(fx.steps[stepOf(fx, own, one)]!.shiftTypeId))!;
    const offRecords = [{ id: 'l', memberId: ownMember, from: offDate, to: offDate }];
    expect(collisionsOf(inputOf(fx, offRecords))).toEqual([]);
    const working = workingOf(fx)[0]!;
    expect(collisionsOf(inputOf(fx, offRecords, { overrides: [{ teamId: ownTeam, date: offDate, shiftTypeId: working }] }))).toEqual([
      { memberId: ownMember, date: offDate, teamId: ownTeam, shiftTypeId: working, leaveRecordId: 'l' },
    ]);
  });

  it('raises nothing for a member on no team (R7.1)', () => {
    const members = membersOf(fx).map((member) =>
      member.id === ownMember
        ? { ...member, memberships: [...member.memberships, { teamId: null, position: null, effectiveFrom: '2026-09-01' }] }
        : member,
    );
    expect(collisionsOf(inputOf(fx, [{ id: 'l', memberId: ownMember, from: '2026-09-01', to: '2026-09-30' }], { members }))).toEqual([]);
  });

  it('raises only the active dates before a deactivation mid-range (R7.3)', () => {
    const records = [{ id: 'l', memberId: ownMember, from: '2026-09-01', to: '2026-09-30' }];
    const members = membersOf(fx).map((member) =>
      member.id === ownMember ? { ...member, statuses: [{ active: false, effectiveFrom: '2026-09-15' }] } : member,
    );
    const input = inputOf(fx, records, { members });
    const collisions = collisionsOf(input);
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions.every((one) => one.date < '2026-09-15')).toBe(true);
    expect(collisions).toEqual(collisionsOf(inputOf(fx, records)).filter((one) => one.date < '2026-09-15'));
  });

  it('raises nothing on an inactive date even when a roster override puts them on a working shift', () => {
    const offDate = offAndStepZeroDate(fx);
    const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
    const offTeam = teamOnStep(fx, offDate, offStep);
    const workTeam = teamOnStep(fx, offDate, 0);
    const offMember = memberOf(fx, offTeam);
    // The member's statuses in `members` say inactive: the put-on override is inert, and the date
    // raises nothing, exactly as it costs nothing.
    const members = membersOf(fx).map((member) =>
      member.id === offMember ? { ...member, statuses: [{ active: false, effectiveFrom: '2026-09-01' }] } : member,
    );
    const input = inputOf(fx, [{ id: 'l', memberId: offMember, from: offDate, to: offDate }], {
      members,
      rosterOverrides: [{ id: 'r1', teamId: fx.teams[workTeam]!.id, date: offDate, memberOutId: memberOf(fx, workTeam), memberInId: offMember }],
    });
    expect(collisionsOf(input)).toEqual([]);
    expect(leaveCostOf(memberInputOf(input, offMember), offDate, offDate)).toBe(0);
  });

  it('raises one for an active member on no team whom a roster override puts on a working shift, as the cost charges it', () => {
    const workTeam = teamOnStep(fx, date, 0);
    const loner: RosterMember = { id: 'no-team', memberships: [], statuses: [] };
    const input = inputOf(fx, [{ id: 'l', memberId: loner.id, from: '2026-09-01', to: '2026-09-30' }], {
      members: [...membersOf(fx), loner],
      rosterOverrides: [{ id: 'r1', teamId: fx.teams[workTeam]!.id, date, memberOutId: memberOf(fx, workTeam), memberInId: loner.id }],
    });
    expect(collisionsOf(input)).toEqual([
      { memberId: loner.id, date, teamId: fx.teams[workTeam]!.id, shiftTypeId: fx.steps[0]!.shiftTypeId, leaveRecordId: 'l' },
    ]);
    expect(leaveCostOf(memberInputOf(input, loner.id), '2026-09-01', '2026-09-30')).toBe(1);
  });

  it('raises the active dates on both sides of a deactivation and reactivation inside one range (R7.3)', () => {
    const records = [{ id: 'l', memberId: ownMember, from: '2026-09-01', to: '2026-09-30' }];
    const members = membersOf(fx).map((member) =>
      member.id === ownMember
        ? {
            ...member,
            statuses: [
              { active: false, effectiveFrom: '2026-09-10' },
              { active: true, effectiveFrom: '2026-09-20' },
            ],
          }
        : member,
    );
    const input = inputOf(fx, records, { members });
    const collisions = collisionsOf(input);
    const always = collisionsOf(inputOf(fx, records));
    expect(collisions).toEqual(always.filter((one) => one.date < '2026-09-10' || one.date >= '2026-09-20'));
    expect(collisions.some((one) => one.date < '2026-09-10')).toBe(true);
    expect(collisions.some((one) => one.date >= '2026-09-20')).toBe(true);
    expect(new Set(collisions.map((one) => one.date)).size).toBe(leaveCostOf(memberInputOf(input, ownMember), '2026-09-01', '2026-09-30'));
  });

  it('raises one each for two members on leave on the same shift, ordered by member', () => {
    const second: RosterMember = {
      id: `${ownTeam}-0`,
      memberships: [{ teamId: ownTeam, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
      statuses: [],
    };
    const input = inputOf(
      fx,
      [
        { id: 'l1', memberId: ownMember, from: date, to: date },
        { id: 'l2', memberId: second.id, from: date, to: date },
      ],
      { members: [...membersOf(fx), second] },
    );
    expect(collisionsOf(input)).toEqual([
      { memberId: second.id, date, teamId: ownTeam, shiftTypeId: fx.steps[0]!.shiftTypeId, leaveRecordId: 'l2' },
      { memberId: ownMember, date, teamId: ownTeam, shiftTypeId: fx.steps[0]!.shiftTypeId, leaveRecordId: 'l1' },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe.each(FIXTURES)('agreement with the cost under $fixture', (fx) => {
  const ranges = [
    ['2026-09-01', '2026-09-30'],
    ['2026-12-20', '2027-01-12'],
    ['2028-02-25', '2028-03-03'],
    ['2026-10-07', '2026-10-07'],
  ] as const;

  /** Every member on leave over every range: one record per range. */
  function allOnLeave(input: Omit<CollisionInput, 'leaveRecords'>): CollisionInput {
    return {
      ...input,
      leaveRecords: input.members.flatMap((member) =>
        ranges.map(([from, to], index) => ({ id: `${member.id}-leave-${String(index)}`, memberId: member.id, from, to })),
      ),
    };
  }

  function expectAgreement(input: CollisionInput): void {
    const collisions = collisionsOf(input);
    expectOrdered(collisions);
    expect(new Set(collisions.map(collisionKeyOf)).size).toBe(collisions.length);
    for (const member of input.members) {
      const records = input.leaveRecords.filter((record) => record.memberId === member.id);
      const cost = records.reduce((sum, record) => sum + leaveCostOf(memberInputOf(input, member.id), record.from, record.to), 0);
      const dates = new Set(collisions.filter((one) => one.memberId === member.id).map((one) => one.date));
      expect(dates.size, `${fx.fixture} ${member.id}`).toBe(cost);
      for (const one of collisions.filter((c) => c.memberId === member.id)) {
        const record = records.find((r) => r.id === one.leaveRecordId)!;
        expect(one.date >= record.from && one.date <= record.to).toBe(true);
      }
    }
  }

  it('the distinct (member, date) pairs equal leaveCostOf for every member, over ranges across months and years', () => {
    expectAgreement(allOnLeave(inputOf(fx, [])));
  });

  it('still agrees with roster overrides, a shift-type override, a move to no team and a deactivation', () => {
    const date = '2026-09-10';
    const a = teamOnStep(fx, date, 0);
    const b = teamOnStep(fx, date, 1);
    const offDate = offAndStepZeroDate(fx);
    const offStep = fx.steps.findIndex((step) => !workingOf(fx).includes(step.shiftTypeId));
    const offTeam = teamOnStep(fx, offDate, offStep);
    const workTeam = teamOnStep(fx, offDate, 0);
    const members = membersOf(fx).map((member, index) => {
      if (index === fx.teams.length - 1 && index !== a && index !== b) {
        return { ...member, statuses: [{ active: false, effectiveFrom: '2026-09-20' }] };
      }
      return member;
    });
    const extra: RosterMember = {
      id: `${fx.teams[a]!.id}-2`,
      memberships: [
        { teamId: fx.teams[a]!.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM },
        { teamId: null, position: null, effectiveFrom: '2026-09-25' },
      ],
      statuses: [],
    };
    const input = allOnLeave(
      inputOf(fx, [], {
        members: [...members, extra],
        overrides: [{ teamId: fx.teams[a]!.id, date: '2026-09-14', shiftTypeId: offTypeOf(fx) }],
        rosterOverrides: [
          { id: 'r1', teamId: fx.teams[b]!.id, date, memberOutId: memberOf(fx, b), memberInId: memberOf(fx, a) },
          { id: 'r2', teamId: fx.teams[workTeam]!.id, date: offDate, memberOutId: null, memberInId: memberOf(fx, offTeam) },
        ],
      }),
    );
    expectAgreement(input);
    // Collisions can outnumber the cost: the put-on date gives two collisions for one leave day.
    const ofA = collisionsOf(input).filter((one) => one.memberId === memberOf(fx, a) && one.date === date);
    expect(ofA).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe.each(FIXTURES)('detection mutates nothing under $fixture (R6.2)', (fx) => {
  it('passes a frozen input, and leaves the schedule equal before and after', () => {
    const date = '2026-09-10';
    const own = teamOnStep(fx, date, 0);
    const other = teamOnStep(fx, date, 1);
    const input = inputOf(fx, [{ id: 'l', memberId: memberOf(fx, own), from: '2026-09-01', to: '2026-09-30' }], {
      overrides: [{ teamId: fx.teams[own]!.id, date: '2026-09-14', shiftTypeId: offTypeOf(fx) }],
      rosterOverrides: [{ id: 'r1', teamId: fx.teams[other]!.id, date, memberOutId: memberOf(fx, other), memberInId: memberOf(fx, own) }],
    });
    const snapshot = structuredClone(input);
    const scheduleInput = { ...input, teamIds: fx.teams.map((team) => team.id) };
    const before = scheduleOfMonth(scheduleInput, '2026-09');

    deepFreeze(input);
    expect(() => collisionsOf(input)).not.toThrow();
    expect(collisionsOf(input).length).toBeGreaterThan(0);

    expect(input).toEqual(snapshot);
    expect(scheduleOfMonth(scheduleInput, '2026-09')).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe('breached preconditions throw a RangeError naming the value', () => {
  const fx = FIXTURES[0];
  const memberId = memberOf(fx, 0);

  it('refuses a range that ends before it starts, or a non-date', () => {
    expect(() => collisionsOf(inputOf(fx, [{ id: 'bad', memberId, from: '2026-09-14', to: '2026-09-10' }]))).toThrow(
      new RangeError('leave record "bad" runs from "2026-09-14" to "2026-09-10", which ends before it starts'),
    );
    expect(() => collisionsOf(inputOf(fx, [{ id: 'bad', memberId, from: '2026-02-30', to: '2026-03-02' }]))).toThrow(/2026-02-30/);
  });

  it('refuses a record of a member not among the members', () => {
    expect(() => collisionsOf(inputOf(fx, [{ id: 'l', memberId: 'stranger', from: '2026-09-10', to: '2026-09-10' }]))).toThrow(
      RangeError,
    );
    expect(() => collisionsOf(inputOf(fx, [{ id: 'l', memberId: 'stranger', from: '2026-09-10', to: '2026-09-10' }]))).toThrow(
      /"stranger"/,
    );
  });

  it('refuses a range longer than MAX_LEAVE_RANGE_DAYS', () => {
    // 2026-09-01 + 366 days is 2027-09-02: 367 days, both ends included.
    expect(() => collisionsOf(inputOf(fx, [{ id: 'long', memberId, from: '2026-09-01', to: '2027-09-02' }]))).toThrow(
      new RangeError(`leave record "long" runs from "2026-09-01" to "2027-09-02", 367 days, longer than ${String(MAX_LEAVE_RANGE_DAYS)}`),
    );
    expect(() => collisionsOf(inputOf(fx, [{ id: 'year', memberId, from: '2026-09-01', to: '2027-09-01' }]))).not.toThrow();
  });

  it('refuses a member id given twice among the members', () => {
    const members = [...membersOf(fx), { ...membersOf(fx)[1]!, id: memberId }];
    expect(() => collisionsOf(inputOf(fx, [], { members }))).toThrow(
      new RangeError(`member ${JSON.stringify(memberId)} is given twice among the members`),
    );
  });

  it('refuses a duplicate record id', () => {
    const records = [
      { id: 'dup', memberId, from: '2026-09-10', to: '2026-09-10' },
      { id: 'dup', memberId: memberOf(fx, 1), from: '2026-09-12', to: '2026-09-12' },
    ];
    expect(() => collisionsOf(inputOf(fx, records))).toThrow(RangeError);
    expect(() => collisionsOf(inputOf(fx, records))).toThrow(/"dup"/);
  });

  it('refuses overlapping records of one member, but not of two', () => {
    const overlapping = [
      { id: 'a', memberId, from: '2026-09-10', to: '2026-09-14' },
      { id: 'b', memberId, from: '2026-09-14', to: '2026-09-16' },
    ];
    expect(() => collisionsOf(inputOf(fx, overlapping))).toThrow(RangeError);
    expect(() => collisionsOf(inputOf(fx, overlapping))).toThrow(/"2026-09-14"/);
    const twoMembers = [overlapping[0]!, { ...overlapping[1]!, memberId: memberOf(fx, 1) }];
    expect(() => collisionsOf(inputOf(fx, twoMembers))).not.toThrow();
  });
});

describe('the edges of the input', () => {
  const fx = FIXTURES[0];

  it('gives nothing for no leave records', () => {
    expect(collisionsOf(inputOf(fx, []))).toEqual([]);
  });

  it('skips a member with no records, even when their data is unusable', () => {
    const broken: RosterMember = {
      id: 'broken',
      memberships: [
        { teamId: fx.teams[0]!.id, position: null, effectiveFrom: 'not-a-date' },
        { teamId: fx.teams[0]!.id, position: null, effectiveFrom: 'not-a-date' },
      ],
      statuses: [{ active: true, effectiveFrom: '2026-02-30' }],
    };
    const team = teamOnStep(fx, '2026-09-10', 0);
    const records = [{ id: 'l', memberId: memberOf(fx, team), from: '2026-09-10', to: '2026-09-10' }];
    expect(collisionsOf(inputOf(fx, records, { members: [...membersOf(fx), broken] }))).toEqual(collisionsOf(inputOf(fx, records)));
    expect(collisionsOf(inputOf(fx, [], { members: [broken] }))).toEqual([]);
  });
});

describe('collisionKeyOf (AD-4)', () => {
  it('keys (memberId, date, teamId), whatever the shift type or record', () => {
    const one: Collision = { memberId: 'm', date: '2026-09-10', teamId: 't', shiftTypeId: 's1', leaveRecordId: 'l1' };
    const other: Collision = { ...one, shiftTypeId: 's2', leaveRecordId: 'l2' };
    expect(collisionKeyOf(one)).toBe(collisionKeyOf(other));
    expect(collisionKeyOf(one)).not.toBe(collisionKeyOf({ ...one, teamId: 'u' }));
    expect(collisionKeyOf(one)).not.toBe(collisionKeyOf({ ...one, memberId: 'n' }));
    expect(collisionKeyOf(one)).not.toBe(collisionKeyOf({ ...one, date: '2026-09-11' }));
  });
});

describe.each(FIXTURES)('unresolvedCollisionsOf under $fixture (story 5.4a)', (fx) => {
  const team = teamOnStep(fx, '2026-09-10', 0);
  const memberId = memberOf(fx, team);
  const records = [{ id: 'leave-1', memberId, from: '2026-09-10', to: '2026-09-14' }];
  const collisions = collisionsOf(inputOf(fx, records));
  const keyOf = (collision: Collision): CollisionResolution => ({ memberId: collision.memberId, date: collision.date, teamId: collision.teamId });

  it('derives 3 collisions to filter', () => {
    expect(collisions).toHaveLength(3);
  });

  it('keeps every collision, as given, when nothing is resolved', () => {
    expect(unresolvedCollisionsOf(collisions, [])).toEqual(collisions);
  });

  it('drops exactly the resolved one and keeps the order of the rest', () => {
    const [first, second, third] = collisions as [Collision, Collision, Collision];
    expect(unresolvedCollisionsOf(collisions, [keyOf(second)])).toEqual([first, third]);
    expect(unresolvedCollisionsOf(collisions, [keyOf(third), keyOf(first)])).toEqual([second]);
    expect(unresolvedCollisionsOf(collisions, collisions.map(keyOf))).toEqual([]);
  });

  it('matches whatever shift type or leave record the collision carries', () => {
    const [first] = collisions as [Collision];
    const moved = { ...first, shiftTypeId: 'other', leaveRecordId: 'leave-2' };
    expect(unresolvedCollisionsOf([moved], [keyOf(first)])).toEqual([]);
  });

  it('keeps the other team\'s collision when a roster override puts the member on two teams and one is resolved', () => {
    const date = '2026-09-10';
    const other = teamOnStep(fx, date, 1);
    const twoTeams = collisionsOf(
      inputOf(fx, [{ id: 'l', memberId, from: date, to: date }], {
        rosterOverrides: [{ id: 'r1', teamId: fx.teams[other]!.id, date, memberOutId: memberOf(fx, other), memberInId: memberId }],
      }),
    );
    expect(twoTeams).toHaveLength(2);
    const [resolved, kept] = twoTeams as [Collision, Collision];
    expect(unresolvedCollisionsOf(twoTeams, [keyOf(resolved)])).toEqual([kept]);
    expect(unresolvedCollisionsOf(twoTeams, [keyOf(kept)])).toEqual([resolved]);
  });

  it('a resolution that matches no collision has no effect', () => {
    const [first] = collisions as [Collision];
    const strays: CollisionResolution[] = [
      { ...keyOf(first), teamId: 'no-such-team' },
      { ...keyOf(first), memberId: 'no-such-member' },
      { ...keyOf(first), date: '2026-09-20' },
    ];
    expect(unresolvedCollisionsOf(collisions, strays)).toEqual(collisions);
    expect(unresolvedCollisionsOf([], collisions.map(keyOf))).toEqual([]);
  });

  it('mutates neither input', () => {
    const given = collisions.map((one) => ({ ...one }));
    const resolutions = [keyOf(collisions[0]!)];
    const frozen = Object.freeze([...collisions.map((one) => Object.freeze({ ...one }))]);
    unresolvedCollisionsOf(frozen, Object.freeze(resolutions.map((one) => Object.freeze(one))));
    expect(collisions).toEqual(given);
    expect(resolutions).toEqual([keyOf(collisions[0]!)]);
  });
});

describe('the result is ids and codes only (AD-8)', () => {
  it('carries exactly the five id fields', () => {
    const fx = FIXTURES[0];
    const team = teamOnStep(fx, '2026-09-10', 0);
    const [first] = collisionsOf(inputOf(fx, [{ id: 'l', memberId: memberOf(fx, team), from: '2026-09-10', to: '2026-09-10' }]));
    expect(Object.keys(first!).sort()).toEqual(['date', 'leaveRecordId', 'memberId', 'shiftTypeId', 'teamId']);
  });

  it('reads no name, fire rank or team position', () => {
    const source = readFileSync(new URL('../src/collisions.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // Any access at all — `.name`, `['name']`, `{ name }`, `{ position: p }` — names the identifier.
    expect(code).not.toMatch(/\brank/i);
    expect(code).not.toMatch(/\bname\b/);
    expect(code).not.toMatch(/\bposition\b/);
    expect(code).not.toMatch(/teamPosition|team_position|fireRank|fire_rank/i);
  });
});
