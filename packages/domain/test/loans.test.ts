import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  HOURS_FIGURE_BAND,
  HOURS_FIGURE_LEAVE,
  HOURS_FIGURE_TOTAL,
  LEAVE_HALF_FIRST,
  collisionsOf,
  datesOfMonth,
  explainMemberHours,
  leaveCostOf,
  memberHoursOfMonth,
  memberScheduleOfMonth,
  checkLoans,
  effectiveTeamOn,
  loanOn,
  membershipOn,
  peopleAtWorkOn,
  rosterOn,
  scheduleOfMonth,
  shiftRoster,
  shortStaffedShiftsOf,
  type CollisionLeaveRecord,
  type Loan,
  type HourBand,
  type HoursFigureCode,
  type MemberHoursInput,
  type RosterMember,
  type RosterOverride,
  type RotationAssignment,
  type RotationStep,
  type ShiftType,
  type ShiftTypeOverride,
  type ShiftTypeVersion,
} from '../src/index.js';
import {
  PILOT_HOUR_BANDS,
  PILOT_ROTATION_ASSIGNMENTS,
  PILOT_ROTATION_STEPS,
  PILOT_SHIFT_TYPES,
  PILOT_SHIFT_TYPE_VERSIONS,
  PILOT_TEAMS,
  SEEDED_EFFECTIVE_FROM,
  UJ5_HOUR_BANDS,
  UJ5_ROTATION_ASSIGNMENTS,
  UJ5_ROTATION_STEPS,
  UJ5_SHIFT_TYPES,
  UJ5_SHIFT_TYPE_VERSIONS,
  UJ5_TEAMS,
} from './fixtures.js';

/**
 * STORY 18.1 — the loan rule (R11). THE GUARD (R11.4): with no Loan, every
 * figure derived from rosters is identical to what it was before Loans
 * existed, over both fixtures.
 */

interface Fixture {
  readonly name: string;
  readonly bands: readonly HourBand[];
  readonly types: readonly ShiftType[];
  readonly versions: readonly ShiftTypeVersion[];
  readonly teams: readonly { readonly id: string }[];
  readonly steps: readonly RotationStep[];
  readonly assignments: readonly RotationAssignment[];
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'pilot',
    bands: PILOT_HOUR_BANDS,
    types: PILOT_SHIFT_TYPES,
    versions: PILOT_SHIFT_TYPE_VERSIONS,
    teams: PILOT_TEAMS,
    steps: PILOT_ROTATION_STEPS,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
  },
  {
    name: 'UJ-5',
    bands: UJ5_HOUR_BANDS,
    types: UJ5_SHIFT_TYPES,
    versions: UJ5_SHIFT_TYPE_VERSIONS,
    teams: UJ5_TEAMS,
    steps: UJ5_ROTATION_STEPS,
    assignments: UJ5_ROTATION_ASSIGNMENTS,
  },
];

const MONTHS = ['2026-03', '2026-04'] as const;
const WINDOW = { from: '2026-03-01', to: '2026-04-30' } as const;
const MINIMUM_MEMBERS = 3;

const workingOf = (fixture: Fixture): readonly string[] =>
  fixture.types.filter((type) => type.isWorking).map((type) => type.id);

/**
 * An organization on `fixture` exercising every roster path: per team a member
 * with a position, one deactivated mid-window, one who moves to the next team
 * mid-window; and one member on no team at all.
 */
function membersOf(fixture: Fixture): readonly RosterMember[] {
  const { teams } = fixture;
  return [
    ...teams.flatMap((team, index): RosterMember[] => [
      { id: `${team.id}-1`, memberships: [{ teamId: team.id, position: 'voditelj', effectiveFrom: SEEDED_EFFECTIVE_FROM }], statuses: [] },
      {
        id: `${team.id}-2`,
        memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
        statuses: [{ active: false, effectiveFrom: '2026-03-20' }],
      },
      {
        id: `${team.id}-3`,
        memberships: [
          { teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM },
          { teamId: teams[(index + 1) % teams.length]!.id, position: null, effectiveFrom: '2026-04-06' },
        ],
        statuses: [],
      },
      {
        id: `${team.id}-4`,
        memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
        statuses: [],
      },
    ]),
    { id: 'teamless', memberships: [], statuses: [] },
  ];
}

/** On every date of the window, the first team's member 1 is replaced by the second team's, and the third team loses member 4. */
function rosterOverridesOf(fixture: Fixture): readonly RosterOverride[] {
  const [a, b, c] = fixture.teams;
  return datesOfMonth('2026-03').flatMap((date): RosterOverride[] => [
    { id: `swap-${date}`, teamId: a!.id, date, memberOutId: `${a!.id}-1`, memberInId: `${b!.id}-1` },
    { id: `off-${date}`, teamId: c!.id, date, memberOutId: `${c!.id}-4`, memberInId: null },
  ]);
}

function shiftTypeOverridesOf(fixture: Fixture): readonly ShiftTypeOverride[] {
  const [, b] = fixture.teams;
  const off = fixture.types.find((type) => !type.isWorking)!.id;
  return [
    { teamId: b!.id, date: '2026-03-05', shiftTypeId: off },
    { teamId: b!.id, date: '2026-04-15', shiftTypeId: workingOf(fixture)[0]! },
  ];
}

function leaveRecordsOf(fixture: Fixture): readonly CollisionLeaveRecord[] {
  const [a, b, c] = fixture.teams;
  return [
    { id: 'leave-a1', memberId: `${a!.id}-1`, from: '2026-03-08', to: '2026-03-14' },
    { id: 'leave-b4', memberId: `${b!.id}-4`, from: '2026-03-25', to: '2026-04-09' },
    { id: 'leave-c3', memberId: `${c!.id}-3`, from: '2026-04-02', to: '2026-04-02', half: LEAVE_HALF_FIRST },
    { id: 'leave-teamless', memberId: 'teamless', from: '2026-03-01', to: '2026-03-03' },
  ];
}

interface Organization {
  readonly fixture: Fixture;
  readonly members: readonly RosterMember[];
}

function shared(organization: Organization) {
  const { fixture, members } = organization;
  return {
    assignments: fixture.assignments,
    steps: fixture.steps,
    overrides: shiftTypeOverridesOf(fixture),
    members,
    rosterOverrides: rosterOverridesOf(fixture),
    workingShiftTypeIds: workingOf(fixture),
  };
}

function hoursInputOf(organization: Organization, member: RosterMember): MemberHoursInput {
  const { fixture } = organization;
  return {
    memberId: member.id,
    memberships: member.memberships,
    statuses: member.statuses,
    loans: member.loans,
    ...shared(organization),
    bands: fixture.bands,
    shiftTypes: fixture.types.map((type) => ({ type, versions: fixture.versions.filter((version) => version.shiftTypeId === type.id) })),
  };
}

/** Every figure an hours explanation can be of: the total, each band, and leave. */
const figuresOf = (fixture: Fixture): readonly HoursFigureCode[] => [
  { code: HOURS_FIGURE_TOTAL },
  ...fixture.bands.map((band) => ({ code: HOURS_FIGURE_BAND, bandId: band.id }) as const),
  { code: HOURS_FIGURE_LEAVE },
];

/** Every figure the engine derives from rosters, for one organization over the window. */
function derivedFiguresOf(organization: Organization) {
  const { fixture, members } = organization;
  const teamIds = fixture.teams.map((team) => team.id);
  const leaveRecords = leaveRecordsOf(fixture);
  const scheduleInput = { teamIds, ...shared(organization) };
  return {
    schedule: MONTHS.map((month) => scheduleOfMonth(scheduleInput, month)),
    rosters: MONTHS.flatMap((month) =>
      datesOfMonth(month).flatMap((date) => teamIds.map((teamId) => rosterOn(members, rosterOverridesOf(fixture), teamId, date))),
    ),
    members: members.map((member) => {
      const input = hoursInputOf(organization, member);
      return {
        id: member.id,
        schedule: MONTHS.map((month) => memberScheduleOfMonth(input, month)),
        hours: MONTHS.map((month) => memberHoursOfMonth(input, month)),
        explanations: MONTHS.map((month) => figuresOf(fixture).map((figure) => explainMemberHours(input, month, figure))),
        leaveCost: leaveCostOf(input, WINDOW.from, WINDOW.to),
      };
    }),
    collisions: collisionsOf({ ...shared(organization), leaveRecords }),
    shortStaffed: shortStaffedShiftsOf({ ...scheduleInput, leaveRecords, minimumMembers: MINIMUM_MEMBERS }, WINDOW.from, WINDOW.to),
  };
}

const digestOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * The digest of {@link derivedFiguresOf} for each fixture, computed on the
 * engine BEFORE Loans existed (commit 5a8bb95, the base of story 18.1), with
 * this file's no-loan organization. A change that moves any roster-derived
 * figure of an organization with no Loan changes a digest.
 */
const BEFORE_LOANS: Readonly<Record<string, string>> = {
  pilot: 'f397da30fdf29f4fe2fab3506e1246d4720ae3fac1e0494ac717d72d6216295d',
  'UJ-5': '4a7dc99233ced8ffae54ebfa288c4d532cb4123a264c3178d8c6bec832ef4efb',
};

describe('R11.4 — with no Loan, every derived figure is what it was before Loans', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: rosters, schedules, hours, leave cost, collisions and staffing digest as before`, () => {
      const figures = derivedFiguresOf({ fixture, members: membersOf(fixture) });
      // Non-trivial: the organization has collisions, short-staffed shifts and applied overrides.
      expect(figures.collisions.length).toBeGreaterThan(0);
      expect(figures.shortStaffed.length).toBeGreaterThan(0);
      expect(digestOf(figures)).toBe(BEFORE_LOANS[fixture.name]);
    });
  }
});

describe('R11.4 — an empty or out-of-window Loan list derives exactly as none', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: \`loans: []\` on every member, and loans wholly outside the window, digest as before`, () => {
      const empty = membersOf(fixture).map((member) => ({ ...member, loans: [] }));
      expect(digestOf(derivedFiguresOf({ fixture, members: empty }))).toBe(BEFORE_LOANS[fixture.name]);

      const [, b] = fixture.teams;
      const outside = membersOf(fixture).map((member, index) => ({
        ...member,
        loans: [
          { id: `before-${index}`, teamId: b!.id, from: '2026-01-01', to: '2026-02-28' },
          { id: `after-${index}`, teamId: b!.id, from: '2026-05-01', to: '2026-06-30' },
        ],
      }));
      expect(digestOf(derivedFiguresOf({ fixture, members: outside }))).toBe(BEFORE_LOANS[fixture.name]);
    });
  }
});

/** Deep-freezes `value`, so a derivation that wrote to its input would throw. */
function frozen<Value>(value: Value): Value {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) frozen(nested);
    Object.freeze(value);
  }
  return value;
}

describe('R11.6 — the worked example on the pilot fixture', () => {
  const fixture = FIXTURES[0]!;
  const [a, , c] = PILOT_TEAMS;
  const A = a!.id;
  const C = c!.id;
  const LENT = `${A}-1`;
  const LOAN: Loan = { id: 'loan-ana', teamId: C, from: '2026-03-10', to: '2026-03-12' };
  const COVERED: readonly string[] = ['2026-03-10', '2026-03-11', '2026-03-12'];

  /** The pilot organization of {@link membersOf}, the lent member with or without the loan, deep-frozen. */
  function organizationOf(loans: readonly Loan[] | undefined): Organization {
    const members = membersOf(fixture).map((member) =>
      member.id === LENT && loans !== undefined ? { ...member, loans } : member,
    );
    return frozen({ fixture, members });
  }
  /** The lent member's input with no shift-type override and the given roster overrides. */
  const inputOf = (organization: Organization, rosterOverrides: readonly RosterOverride[] = []): MemberHoursInput =>
    frozen({
      ...hoursInputOf(organization, organization.members.find((member) => member.id === LENT)!),
      overrides: [],
      rosterOverrides,
    });
  const lent = organizationOf([LOAN]);
  const home = organizationOf(undefined);
  const roster = (organization: Organization, teamId: string, date: string): readonly string[] =>
    rosterOn(organization.members, [], teamId, date).roster.map((entry) => entry.memberId);
  const scheduledType = (teamId: string, date: string): string | null =>
    scheduleOfMonth({ teamIds: [teamId], ...shared(home), overrides: [], rosterOverrides: [] }, '2026-03').find((row) => row.date === date)!
      .cells[0]!.shiftTypeId;
  const staffingInput = (organization: Organization, teamIds: readonly string[]) => ({
    teamIds,
    ...shared(organization),
    overrides: [],
    rosterOverrides: [],
    leaveRecords: [],
    minimumMembers: 4,
  });

  it("A's rosters on the 10th–12th lose them, C's gain them, and the 9th and 13th are A's", () => {
    for (const date of COVERED) {
      expect(roster(lent, A, date)).not.toContain(LENT);
      expect(roster(lent, C, date)).toContain(LENT);
      expect(shiftRoster(lent.members, C, date)).toContainEqual({ memberId: LENT, position: null });
    }
    for (const date of ['2026-03-09', '2026-03-13']) {
      expect(roster(lent, A, date)).toContain(LENT);
      expect(roster(lent, C, date)).not.toContain(LENT);
      expect(shiftRoster(lent.members, A, date)).toContainEqual({ memberId: LENT, position: 'voditelj' });
    }
  });

  it("their month follows C's shift types on the 10th–12th and is A's again on the 13th", () => {
    const days = memberScheduleOfMonth(inputOf(lent), '2026-03');
    for (const date of COVERED) {
      const type = scheduledType(C, date);
      expect(days.find((day) => day.date === date)!.shifts).toEqual([
        { teamId: C, shiftTypeId: type, projectedShiftTypeId: type, overridden: false, rosterChanged: false, viaOverride: false },
      ]);
    }
    expect(days.find((day) => day.date === '2026-03-13')!.shifts.map((shift) => shift.teamId)).toEqual([A]);
    const before = memberScheduleOfMonth(inputOf(home), '2026-03');
    expect(days.filter((day) => !COVERED.includes(day.date))).toEqual(before.filter((day) => !COVERED.includes(day.date)));
  });

  it('their hours, leave cost and collisions are those of a member of C for those three days', () => {
    // The loan derives as a membership of C from the 10th to the 12th would, and writes no membership.
    const moved: RosterMember = {
      id: LENT,
      statuses: [],
      memberships: [
        { teamId: A, position: 'voditelj', effectiveFrom: SEEDED_EFFECTIVE_FROM },
        { teamId: C, position: null, effectiveFrom: '2026-03-10' },
        { teamId: A, position: 'voditelj', effectiveFrom: '2026-03-13' },
      ],
    };
    const movedOrganization: Organization = { fixture, members: home.members.map((member) => (member.id === LENT ? moved : member)) };
    const lentInput = inputOf(lent);
    const movedInput = inputOf(movedOrganization);
    expect(memberHoursOfMonth(lentInput, '2026-03')).toEqual(memberHoursOfMonth(movedInput, '2026-03'));
    expect(memberHoursOfMonth(lentInput, '2026-03')).not.toEqual(memberHoursOfMonth(inputOf(home), '2026-03'));
    for (const figure of figuresOf(fixture)) {
      expect(explainMemberHours(lentInput, '2026-03', figure)).toEqual(explainMemberHours(movedInput, '2026-03', figure));
    }
    expect(leaveCostOf(lentInput, '2026-03-01', '2026-03-31')).toBe(leaveCostOf(movedInput, '2026-03-01', '2026-03-31'));

    const leaveRecords: readonly CollisionLeaveRecord[] = [{ id: 'leave', memberId: LENT, from: '2026-03-09', to: '2026-03-13' }];
    const collisions = collisionsOf({ ...shared(lent), overrides: [], rosterOverrides: [], leaveRecords });
    expect(collisions).toEqual(collisionsOf({ ...shared(movedOrganization), overrides: [], rosterOverrides: [], leaveRecords }));
    expect(collisions.some((collision) => collision.teamId === C)).toBe(true);
    for (const collision of collisions) expect(collision.teamId).toBe(COVERED.includes(collision.date) ? C : A);
  });

  it('staffing is derived for both teams: A has one fewer at work and C one more on each working shift', () => {
    let working = 0;
    for (const date of COVERED) {
      for (const [teamId, delta] of [
        [A, -1],
        [C, 1],
      ] as const) {
        const before = peopleAtWorkOn(staffingInput(home, []), teamId, date);
        const after = peopleAtWorkOn(staffingInput(lent, []), teamId, date);
        if (before === null) {
          expect(after).toBeNull();
          continue;
        }
        working += 1;
        expect(after).toEqual({ shiftTypeId: before.shiftTypeId, atWork: before.atWork + delta });
      }
    }
    expect(working).toBeGreaterThanOrEqual(2);
    const short = shortStaffedShiftsOf(staffingInput(lent, [A, C]), '2026-03-10', '2026-03-12');
    expect(short.length).toBeGreaterThan(0);
    expect(short.every((shift) => shift.teamId === A && shift.atWork === 3)).toBe(true);
  });

  it('roster overrides still apply on top: one on C may take the lent member off, one on A taking them off is inert', () => {
    const date = COVERED.find((one) => scheduledType(C, one) !== 'pilot-slobodno')!;
    const offC: RosterOverride = { id: 'off-c', teamId: C, date, memberOutId: LENT, memberInId: `${A}-4` };
    const onC = rosterOn(lent.members, [offC], C, date);
    expect(onC.applied).toEqual([offC]);
    expect(onC.roster.map((entry) => entry.memberId)).not.toContain(LENT);
    const day = memberScheduleOfMonth(inputOf(lent, [offC]), '2026-03').find((one) => one.date === date)!;
    expect(day.shifts.some((shift) => shift.teamId === C)).toBe(false);

    const offA: RosterOverride = { id: 'off-a', teamId: A, date, memberOutId: LENT, memberInId: null };
    expect(rosterOn(lent.members, [offA], A, date).applied).toEqual([]);
  });

  it('no Rotation Assignment and no team membership changes (R11.5)', () => {
    const member = lent.members.find((one) => one.id === LENT)!;
    expect(member.memberships).toEqual(home.members.find((one) => one.id === LENT)!.memberships);
    expect(membershipOn(member.memberships, '2026-03-11')).toEqual({ teamId: A, position: 'voditelj' });
    expect(effectiveTeamOn(member, '2026-03-11')).toEqual({ teamId: C, position: null, loanId: LOAN.id });
    expect(effectiveTeamOn(member, '2026-03-13')).toEqual({ teamId: A, position: 'voditelj', loanId: null });
    // Every input above is deep-frozen, the fixture's assignments included: a derivation that wrote to one would have thrown.
    expect(Object.isFrozen(fixture.assignments[0])).toBe(true);
    expect(fixture.assignments).toEqual(PILOT_ROTATION_ASSIGNMENTS);
  });
});

describe('effectiveTeamOn, loanOn and checkLoans (R11.1, R11.3)', () => {
  const home = { teamId: 'a', position: 'p', effectiveFrom: '2026-01-01' };
  const loan: Loan = { id: 'l', teamId: 'c', from: '2026-03-10', to: '2026-03-12' };

  it('is the home team with no loan, the loan team on a covered date, inclusive at both ends', () => {
    expect(effectiveTeamOn({ memberships: [home] }, '2026-03-11')).toEqual({ teamId: 'a', position: 'p', loanId: null });
    expect(effectiveTeamOn({ memberships: [home], loans: [] }, '2026-03-11')).toEqual({ teamId: 'a', position: 'p', loanId: null });
    expect(effectiveTeamOn({ memberships: [home], loans: [loan] }, '2026-03-09')?.teamId).toBe('a');
    expect(effectiveTeamOn({ memberships: [home], loans: [loan] }, '2026-03-10')?.teamId).toBe('c');
    expect(effectiveTeamOn({ memberships: [home], loans: [loan] }, '2026-03-12')?.teamId).toBe('c');
    expect(effectiveTeamOn({ memberships: [home], loans: [loan] }, '2026-03-13')?.teamId).toBe('a');
    expect(loanOn([loan], '2026-03-11')).toBe(loan);
    expect(loanOn([loan], '2026-03-13')).toBeNull();
  });

  it('lends a member on no team: for the range they work with the loan team (FR-88)', () => {
    expect(effectiveTeamOn({ memberships: [], loans: [loan] }, '2026-03-11')).toEqual({ teamId: 'c', position: null, loanId: 'l' });
    expect(effectiveTeamOn({ memberships: [], loans: [loan] }, '2026-03-13')).toBeNull();
    const nomad: RosterMember = { id: 'n', memberships: [], statuses: [], loans: [loan] };
    expect(shiftRoster([nomad], 'c', '2026-03-11')).toEqual([{ memberId: 'n', position: null }]);
  });

  it('puts an inactive member on no roster, lent or not', () => {
    const gone: RosterMember = { id: 'g', memberships: [home], statuses: [{ active: false, effectiveFrom: '2026-03-11' }], loans: [loan] };
    expect(shiftRoster([gone], 'c', '2026-03-10')).toEqual([{ memberId: 'g', position: null }]);
    expect(shiftRoster([gone], 'c', '2026-03-11')).toEqual([]);
    expect(shiftRoster([gone], 'a', '2026-03-11')).toEqual([]);
  });

  it("a loan to the home team derives as the home team (refusing one is the store's, story 18.2)", () => {
    const own: RosterMember = { id: 'o', memberships: [home], statuses: [], loans: [{ ...loan, teamId: 'a' }] };
    expect(shiftRoster([own], 'a', '2026-03-11')).toEqual([{ memberId: 'o', position: 'p' }]);
    expect(effectiveTeamOn(own, '2026-03-11')).toEqual({ teamId: 'a', position: 'p', loanId: null });
  });

  it('follows a home-team move inside a loan: the loan wins while it covers, the new home after', () => {
    const moving: RosterMember = {
      id: 'v',
      memberships: [home, { teamId: 'b', position: null, effectiveFrom: '2026-03-11' }],
      statuses: [],
      loans: [loan],
    };
    expect(['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'].map((date) => effectiveTeamOn(moving, date)?.teamId)).toEqual([
      'c',
      'c',
      'c',
      'b',
    ]);
    // A loan to the team they moved INTO derives as that home team from the move on.
    const toNewHome: RosterMember = { ...moving, loans: [{ ...loan, teamId: 'b' }] };
    expect(effectiveTeamOn(toNewHome, '2026-03-10')).toEqual({ teamId: 'b', position: null, loanId: 'l' });
    expect(effectiveTeamOn(toNewHome, '2026-03-11')).toEqual({ teamId: 'b', position: null, loanId: null });
  });

  it.each([
    ['a start that is not a date', [{ ...loan, from: '2026-02-30' }], 'not a calendar date'],
    ['an end that is not a date', [{ ...loan, to: '2026-3-12' }], 'not a calendar date'],
    ['an end before the start', [{ ...loan, from: '2026-03-12', to: '2026-03-10' }], 'ends before it starts'],
    ['two loans with one id', [loan, { ...loan, from: '2026-04-01', to: '2026-04-02' }], 'two loans have the id'],
    ['two loans sharing a date', [loan, { ...loan, id: 'm', from: '2026-03-12', to: '2026-03-20' }], 'never overlap'],
    ['one loan inside another', [{ ...loan, id: 'm', from: '2026-03-11', to: '2026-03-11' }, loan], 'never overlap'],
  ] as const)('refuses %s, wherever a roster is derived', (_, loans, message) => {
    expect(() => checkLoans(loans)).toThrow(RangeError);
    expect(() => checkLoans(loans)).toThrow(message);
    expect(() => shiftRoster([{ id: 'x', memberships: [home], statuses: [], loans }], 'a', '2026-01-05')).toThrow(message);
    expect(() =>
      memberScheduleOfMonth(
        { memberId: 'x', memberships: [home], statuses: [], loans, assignments: [], steps: [], overrides: [], members: [], rosterOverrides: [], workingShiftTypeIds: [] },
        '2026-01',
      ),
    ).toThrow(message);
  });

  it('accepts loans back to back', () => {
    expect(() => checkLoans([loan, { ...loan, id: 'm', from: '2026-03-13', to: '2026-03-14' }])).not.toThrow();
  });
});

describe("a lent member's own month (memberScheduleOfMonth, through the one rule)", () => {
  const fixture = FIXTURES[0]!;
  const [a, b, c] = PILOT_TEAMS.map((team) => team.id);
  const working = workingOf(fixture);
  const base = { assignments: fixture.assignments, steps: fixture.steps, overrides: [], rosterOverrides: [], workingShiftTypeIds: working };
  const typeOf = (teamId: string, date: string): string | null =>
    scheduleOfMonth({ teamIds: [teamId], ...base, members: [] }, monthOfDate(date)).find((row) => row.date === date)!.cells[0]!.shiftTypeId;
  const teamsOf = (input: Parameters<typeof memberScheduleOfMonth>[0], month: string): Record<string, readonly string[]> =>
    Object.fromEntries(memberScheduleOfMonth(input, month).map((day) => [day.date, day.shifts.map((shift) => shift.teamId)]));
  function monthOfDate(date: string): string {
    return date.slice(0, 7);
  }

  it("gives a teamless lent member the loan team's shifts on covered dates and nothing after", () => {
    const loans: readonly Loan[] = [{ id: 'n', teamId: c!, from: '2026-03-10', to: '2026-03-12' }];
    const nomad: RosterMember = { id: 'nomad', memberships: [], statuses: [], loans };
    const days = memberScheduleOfMonth({ memberId: 'nomad', memberships: [], statuses: [], loans, members: [nomad], ...base }, '2026-03');
    for (const day of days) {
      const covered = day.date >= '2026-03-10' && day.date <= '2026-03-12';
      expect(day.shifts).toEqual(covered ? [expect.objectContaining({ teamId: c, shiftTypeId: typeOf(c!, day.date) })] : []);
    }
  });

  it('gives a lent member no shift from their deactivation date, while the loan still covers it', () => {
    const loans: readonly Loan[] = [{ id: 'g', teamId: c!, from: '2026-03-05', to: '2026-03-20' }];
    const statuses = [{ active: false, effectiveFrom: '2026-03-12' }];
    const memberships = [{ teamId: a!, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
    const gone: RosterMember = { id: 'gone', memberships, statuses, loans };
    const days = memberScheduleOfMonth({ memberId: 'gone', memberships, statuses, loans, members: [gone], ...base }, '2026-03');
    for (const day of days) {
      if (day.date >= '2026-03-12') expect(day).toEqual({ date: day.date, active: false, shifts: [] });
      else expect(day.shifts.map((shift) => shift.teamId)).toEqual([day.date >= '2026-03-05' ? c : a]);
    }
  });

  it('follows a loan across a month boundary, in both months', () => {
    const loans: readonly Loan[] = [{ id: 'x', teamId: c!, from: '2026-03-30', to: '2026-04-02' }];
    const memberships = [{ teamId: a!, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
    const input = { memberId: 'm', memberships, statuses: [], loans, members: [{ id: 'm', memberships, statuses: [], loans }], ...base };
    expect(teamsOf(input, '2026-03')['2026-03-29']).toEqual([a]);
    expect(teamsOf(input, '2026-03')['2026-03-30']).toEqual([c]);
    expect(teamsOf(input, '2026-03')['2026-03-31']).toEqual([c]);
    expect(teamsOf(input, '2026-04')['2026-04-02']).toEqual([c]);
    expect(teamsOf(input, '2026-04')['2026-04-03']).toEqual([a]);
  });

  it('lends to a team with no rotation: the member holds its empty cell, as a member of it would', () => {
    const loans: readonly Loan[] = [{ id: 'z', teamId: 'no-rotation', from: '2026-03-10', to: '2026-03-10' }];
    const memberships = [{ teamId: a!, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
    const days = memberScheduleOfMonth({ memberId: 'm', memberships, statuses: [], loans, members: [], ...base }, '2026-03');
    expect(days.find((day) => day.date === '2026-03-10')!.shifts).toEqual([
      { teamId: 'no-rotation', shiftTypeId: null, projectedShiftTypeId: null, overridden: false, rosterChanged: false, viaOverride: false },
    ]);
  });

  it('a home-team override putting the lent member back on applies: a double shift, as for any member put on another team', () => {
    const loans: readonly Loan[] = [{ id: 'd', teamId: c!, from: '2026-03-10', to: '2026-03-13' }];
    const memberships = [{ teamId: a!, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
    const members: RosterMember[] = [
      { id: 'm', memberships, statuses: [], loans },
      { id: 'mate', memberships, statuses: [] },
    ];
    // A covered date on which A works: the lent member is off A's base roster, so putting them on applies.
    const on = ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13'].find((one) => working.includes(typeOf(a!, one) ?? ''))!;
    const back: RosterOverride = { id: 'back', teamId: a!, date: on, memberOutId: null, memberInId: 'm' };
    expect(rosterOn(members, [back], a!, on).applied).toEqual([back]);
    const shifts = memberScheduleOfMonth({ memberId: 'm', memberships, statuses: [], loans, members, ...base, rosterOverrides: [back] }, '2026-03').find(
      (day) => day.date === on,
    )!.shifts;
    expect(shifts.map((shift) => [shift.teamId, shift.viaOverride])).toEqual([
      [c, false],
      [a, true],
    ]);
  });

  it("reads the member's entry in `members` when `loans` is absent, and refuses two different lists", () => {
    const loans: readonly Loan[] = [{ id: 'e', teamId: b!, from: '2026-03-10', to: '2026-03-12' }];
    const memberships = [{ teamId: a!, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
    const members: RosterMember[] = [{ id: 'm', memberships, statuses: [], loans }];
    expect(teamsOf({ memberId: 'm', memberships, statuses: [], members, ...base }, '2026-03')['2026-03-11']).toEqual([b]);
    expect(teamsOf({ memberId: 'm', memberships, statuses: [], loans: [...loans].reverse(), members, ...base }, '2026-03')['2026-03-11']).toEqual([b]);
    expect(() => memberScheduleOfMonth({ memberId: 'm', memberships, statuses: [], loans: [], members, ...base }, '2026-03')).toThrow(
      'differ from those of their entry',
    );
  });

  it("a loan changes who works, never a team's shift type: the team grid is unchanged", () => {
    const loans: readonly Loan[] = [{ id: 'g', teamId: c!, from: '2026-03-10', to: '2026-03-12' }];
    const memberships = [{ teamId: a!, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }];
    const grid = (members: readonly RosterMember[]) => scheduleOfMonth({ teamIds: [a!, b!, c!], ...base, members }, '2026-03');
    expect(grid([{ id: 'm', memberships, statuses: [], loans }])).toEqual(grid([{ id: 'm', memberships, statuses: [] }]));
  });
});
