import { describe, expect, it } from 'vitest';

import {
  datesOfMonth,
  deriveHourBands,
  memberHoursOfMonth,
  memberScheduleOfMonth,
  projectedShiftTypeOn,
  type HourBand,
  type LeaveShift,
  type MemberHours,
  type MemberHoursInput,
  type RosterMember,
  type RosterOverride,
  type RotationAssignment,
  type RotationStep,
  type ShiftType,
  type ShiftTypeOverride,
  type ShiftTypeVersion,
  type ShiftTypeWithVersions,
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
  at,
} from './fixtures.js';

/**
 * Story 4.1a — one member's month, split by band. Node environment, no
 * browser. Every rule runs against both fixtures: the pilot's bands coincide
 * with its changeovers and never split a shift, so band splitting is proven
 * against UJ-5, whose every shift straddles a band edge.
 *
 * The load-bearing assertion is the invariant — band minutes plus unbanded
 * minutes equal the total, and the total is the sum of the timed working
 * shifts' durations — checked against an independent minute-by-minute oracle
 * over both fixtures and over randomized configurations.
 */

// ---------------------------------------------------------------------------
// An independent oracle: minute by minute, sharing no code with `hours.ts`.

/** The band covering each minute of the day: the one with the latest start at or before it, wrapping round. */
function bandOfMinute(bands: readonly HourBand[]): readonly (string | null)[] {
  const table: (string | null)[] = [];
  for (let minute = 0; minute < 1440; minute += 1) {
    let best: HourBand | null = null;
    let latest: HourBand | null = null;
    for (const band of bands) {
      if (band.startMinute <= minute && (best === null || band.startMinute > best.startMinute)) best = band;
      if (latest === null || band.startMinute > latest.startMinute) latest = band;
    }
    table.push((best ?? latest)?.id ?? null);
  }
  return table;
}

function oracleVersionOn(versions: readonly ShiftTypeVersion[], date: string): ShiftTypeVersion | null {
  let found: ShiftTypeVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom <= date && (found === null || version.effectiveFrom > found.effectiveFrom)) found = version;
  }
  return found;
}

function oracleHours(input: MemberHoursInput, month: string): MemberHours {
  const table = bandOfMinute(input.bands);
  const ordered = [...input.bands].sort((a, b) => a.startMinute - b.startMinute);
  const minutes = new Map(ordered.map((band) => [band.id, 0]));
  const counts = new Map(ordered.map((band) => [band.id, 0]));
  let shiftCount = 0;
  let untimedShiftCount = 0;
  let unbandedMinutes = 0;
  let totalMinutes = 0;
  let leaveMinutes = 0;

  for (const day of memberScheduleOfMonth(input, month)) {
    for (const shift of day.shifts) {
      const entry = input.shiftTypes.find((one) => one.type.id === shift.shiftTypeId);
      if (entry === undefined || !entry.type.isWorking) continue;
      const version = oracleVersionOn(entry.versions, day.date);
      if ((input.leaveShifts ?? []).some((one) => one.date === day.date && one.teamId === shift.teamId)) {
        if (version !== null) leaveMinutes += (version.endMinute - version.startMinute + 1440) % 1440 || 1440;
        continue;
      }
      shiftCount += 1;
      if (version === null) {
        untimedShiftCount += 1;
        continue;
      }
      const duration = (version.endMinute - version.startMinute + 1440) % 1440 || 1440;
      totalMinutes += duration;
      const touched = new Set<string>();
      for (let offset = 0; offset < duration; offset += 1) {
        const band = table[(version.startMinute + offset) % 1440]!;
        if (band === null) {
          unbandedMinutes += 1;
        } else {
          minutes.set(band, minutes.get(band)! + 1);
          touched.add(band);
        }
      }
      for (const band of touched) counts.set(band, counts.get(band)! + 1);
    }
  }

  return {
    shiftCount,
    bands: ordered.map((band) => ({ bandId: band.id, minutes: minutes.get(band.id)!, shiftCount: counts.get(band.id)! })),
    unbandedMinutes,
    totalMinutes,
    leaveMinutes,
    untimedShiftCount,
  };
}

function expectInvariant(hours: MemberHours, label: string): void {
  const banded = hours.bands.reduce((sum, band) => sum + band.minutes, 0);
  expect(banded + hours.unbandedMinutes, `${label}: bands + unbanded = total`).toBe(hours.totalMinutes);
  expect(Number.isInteger(hours.leaveMinutes) && hours.leaveMinutes >= 0, `${label}: leave whole and never negative`).toBe(true);
  for (const band of hours.bands) {
    expect(Number.isInteger(band.minutes), `${label}: ${band.bandId} whole minutes`).toBe(true);
    expect(band.shiftCount, `${label}: ${band.bandId} count`).toBeLessThanOrEqual(hours.shiftCount);
  }
}

// ---------------------------------------------------------------------------
// Inputs.

function withVersions(types: readonly ShiftType[], versions: readonly ShiftTypeVersion[]): readonly ShiftTypeWithVersions[] {
  return types.map((type) => ({ type, versions: versions.filter((version) => version.shiftTypeId === type.id) }));
}

function workingOf(types: readonly ShiftType[]): readonly string[] {
  return types.filter((type) => type.isWorking).map((type) => type.id);
}

const FIXTURES = [
  {
    fixture: 'pilot',
    bands: PILOT_HOUR_BANDS,
    types: PILOT_SHIFT_TYPES,
    versions: PILOT_SHIFT_TYPE_VERSIONS,
    teams: PILOT_TEAMS,
    steps: PILOT_ROTATION_STEPS,
    assignments: PILOT_ROTATION_ASSIGNMENTS,
    off: 'pilot-slobodno',
    crossing: 'pilot-noc',
  },
  {
    fixture: 'UJ-5',
    bands: UJ5_HOUR_BANDS,
    types: UJ5_SHIFT_TYPES,
    versions: UJ5_SHIFT_TYPE_VERSIONS,
    teams: UJ5_TEAMS,
    steps: UJ5_ROTATION_STEPS,
    assignments: UJ5_ROTATION_ASSIGNMENTS,
    off: 'uj5-slobodno',
    crossing: 'uj5-nocna',
  },
] as const;

type Fixture = (typeof FIXTURES)[number];

/** The date from which the second member of each team in {@link membersOf} is inactive. */
const SECOND_MEMBER_INACTIVE_FROM = '2026-09-20';

/** Two members per team, from the seeded date on; the second of each team inactive from the 20th. */
function membersOf(teams: readonly { readonly id: string }[]): readonly RosterMember[] {
  return teams.flatMap((team) => [
    { id: `${team.id}-1`, memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }], statuses: [] },
    {
      id: `${team.id}-2`,
      memberships: [{ teamId: team.id, position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
      statuses: [{ active: false, effectiveFrom: SECOND_MEMBER_INACTIVE_FROM }],
    },
  ]);
}

interface FixtureOptions {
  readonly leaveShifts?: readonly LeaveShift[];
  readonly rosterOverrides?: readonly RosterOverride[];
  readonly overrides?: readonly ShiftTypeOverride[];
  readonly bands?: readonly HourBand[];
}

function fixtureInput(fx: Fixture, memberId: string, options: FixtureOptions = {}): MemberHoursInput {
  const members = membersOf(fx.teams);
  const member = members.find((one) => one.id === memberId)!;
  return {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
    assignments: fx.assignments,
    steps: fx.steps,
    overrides: options.overrides ?? [],
    members,
    rosterOverrides: options.rosterOverrides ?? [],
    workingShiftTypeIds: workingOf(fx.types),
    bands: options.bands ?? fx.bands,
    shiftTypes: withVersions(fx.types, fx.versions),
    ...(options.leaveShifts === undefined ? {} : { leaveShifts: options.leaveShifts }),
  };
}

/**
 * One member on one team whose rotation is always `offTypeId`, with the given
 * shift-type overrides on it: exactly the shifts the overrides name.
 */
function soloInput(
  bands: readonly HourBand[],
  shiftTypes: readonly ShiftTypeWithVersions[],
  offTypeId: string,
  shifts: readonly { readonly date: string; readonly shiftTypeId: string }[],
): MemberHoursInput {
  const member: RosterMember = { id: 'm', memberships: [{ teamId: 't', position: null, effectiveFrom: SEEDED_EFFECTIVE_FROM }], statuses: [] };
  return {
    memberId: member.id,
    memberships: member.memberships,
    statuses: member.statuses,
    assignments: [{ teamId: 't', patternId: 'p', offsetStepId: 's0', anchorDate: SEEDED_EFFECTIVE_FROM, effectiveFrom: SEEDED_EFFECTIVE_FROM }],
    steps: [{ id: 's0', patternId: 'p', position: 0, shiftTypeId: offTypeId }],
    overrides: shifts.map((shift) => ({ teamId: 't', ...shift })),
    members: [member],
    rosterOverrides: [],
    workingShiftTypeIds: workingOf(shiftTypes.map((entry) => entry.type)),
    bands,
    shiftTypes,
  };
}

const OFF: ShiftType = { id: 'off', name: 'Off', isWorking: false };

function typeOf(id: string, start: number, end: number, effectiveFrom = SEEDED_EFFECTIVE_FROM): ShiftTypeWithVersions {
  return {
    type: { id, name: id, isWorking: true },
    versions: [{ shiftTypeId: id, effectiveFrom, startMinute: start, endMinute: end }],
  };
}

const offEntry: ShiftTypeWithVersions = { type: OFF, versions: [] };

function bandsOf(hours: MemberHours): Record<string, readonly [number, number]> {
  return Object.fromEntries(hours.bands.map((band) => [band.bandId, [band.minutes, band.shiftCount] as const]));
}

const MONTH = '2026-09';

// ---------------------------------------------------------------------------

describe('a shift is split across the bands it touches, never rounded', () => {
  const bands: readonly HourBand[] = [
    { id: 'b-day', name: 'B', startMinute: at(6) },
    { id: 'b-night', name: 'N', startMinute: at(21) },
  ];

  it('splits a 19:00–07:00 shift under 06:00/21:00 bands into 180 and 540 minutes', () => {
    const hours = memberHoursOfMonth(soloInput(bands, [typeOf('x', at(19), at(7)), offEntry], 'off', [{ date: '2026-09-10', shiftTypeId: 'x' }]), MONTH);
    expect(hours).toEqual({
      shiftCount: 1,
      bands: [
        { bandId: 'b-day', minutes: 180, shiftCount: 1 },
        { bandId: 'b-night', minutes: 540, shiftCount: 1 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 720,
      leaveMinutes: 0,
      untimedShiftCount: 0,
    });
  });

  it('keeps an odd-minute split exact', () => {
    const odd: readonly HourBand[] = [
      { id: 'b1', name: '1', startMinute: at(6, 7) },
      { id: 'b2', name: '2', startMinute: at(21, 53) },
    ];
    const hours = memberHoursOfMonth(soloInput(odd, [typeOf('x', at(19, 1), at(7, 2)), offEntry], 'off', [{ date: '2026-09-10', shiftTypeId: 'x' }]), MONTH);
    // 19:01–21:53 is 172, 21:53–06:07 is 494, 06:07–07:02 is 55.
    expect(bandsOf(hours)).toEqual({ b1: [227, 1], b2: [494, 1] });
    expect(hours.totalMinutes).toBe(721);
  });

  it('lists the bands in start order, those with no minutes included', () => {
    const shuffled: readonly HourBand[] = [
      { id: 'late', name: 'L', startMinute: at(22) },
      { id: 'early', name: 'E', startMinute: at(1) },
      { id: 'noon', name: 'M', startMinute: at(12) },
    ];
    const hours = memberHoursOfMonth(soloInput(shuffled, [typeOf('x', at(13), at(15)), offEntry], 'off', [{ date: '2026-09-10', shiftTypeId: 'x' }]), MONTH);
    expect(hours.bands).toEqual([
      { bandId: 'early', minutes: 0, shiftCount: 0 },
      { bandId: 'noon', minutes: 120, shiftCount: 1 },
      { bandId: 'late', minutes: 0, shiftCount: 0 },
    ]);
    expect(hours.bands.map((band) => band.bandId)).toEqual(deriveHourBands(shuffled).map((window) => window.bandId));
  });

  it('counts a shift once in a band it touches twice, and a crossing band as one stretch', () => {
    // 10:00–10:00 under pilot bands touches Dan at 10–19 and again at 07–10 the next day.
    const hours = memberHoursOfMonth(soloInput(PILOT_HOUR_BANDS, [typeOf('x', at(10), at(10)), offEntry], 'off', [{ date: '2026-09-10', shiftTypeId: 'x' }]), MONTH);
    expect(bandsOf(hours)).toEqual({ 'pilot-dan': [720, 1], 'pilot-noc': [720, 1] });
  });
});

describe('the pilot never splits a shift', () => {
  it('gives 3600 and 2880 minutes, counts 5 and 4, for five Dan and four Noć', () => {
    const fx = FIXTURES[0];
    const team = fx.teams[0]!.id;
    const versions = fx.assignments.filter((assignment) => assignment.teamId === team);
    // Keep the first five Dan and four Noć of September; every other working day is overridden off.
    const kept = { 'pilot-dan': 5, 'pilot-noc': 4 } as Record<string, number>;
    const overrides: ShiftTypeOverride[] = [];
    for (const date of datesOfMonth(MONTH)) {
      const type = projectedShiftTypeOn(versions, fx.steps, date);
      if (type === null || kept[type] === undefined) continue;
      if (kept[type] > 0) kept[type] -= 1;
      else overrides.push({ teamId: team, date, shiftTypeId: fx.off });
    }
    expect(kept).toEqual({ 'pilot-dan': 0, 'pilot-noc': 0 });

    const hours = memberHoursOfMonth(fixtureInput(fx, `${team}-1`, { overrides }), MONTH);
    expect(hours).toEqual({
      shiftCount: 9,
      bands: [
        { bandId: 'pilot-dan', minutes: 3600, shiftCount: 5 },
        { bandId: 'pilot-noc', minutes: 2880, shiftCount: 4 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 6480,
      leaveMinutes: 0,
      untimedShiftCount: 0,
    });
  });

  it('gives 720 and 720 for one 07:00–07:00 shift', () => {
    const hours = memberHoursOfMonth(soloInput(PILOT_HOUR_BANDS, [typeOf('x', at(7), at(7)), offEntry], 'off', [{ date: '2026-09-10', shiftTypeId: 'x' }]), MONTH);
    expect(bandsOf(hours)).toEqual({ 'pilot-dan': [720, 1], 'pilot-noc': [720, 1] });
    expect(hours.totalMinutes).toBe(1440);
    expect(hours.shiftCount).toBe(1);
  });

  it.each(['2026-02', MONTH, '2026-12'])('keeps every pilot shift in one band in %s', (month) => {
    const fx = FIXTURES[0];
    for (const team of fx.teams) {
      const hours = memberHoursOfMonth(fixtureInput(fx, `${team.id}-1`), month);
      expect(hours.bands.reduce((sum, band) => sum + band.shiftCount, 0), team.id).toBe(hours.shiftCount);
    }
  });
});

describe('UJ-5 splits every shift across two bands', () => {
  // Per type: [Jutro, Popodne, Noć] minutes of one shift.
  const SPLIT: Record<string, readonly [number, number, number]> = {
    'uj5-jutarnja': [420, 60, 0],
    'uj5-popodnevna': [0, 420, 60],
    'uj5-nocna': [60, 0, 420],
  };

  it.each(['2026-02', MONTH, '2026-10'])('in %s, for every member', (month) => {
    const fx = FIXTURES[1];
    for (const member of membersOf(fx.teams)) {
      const input = fixtureInput(fx, member.id);
      const hours = memberHoursOfMonth(input, month);
      const expected = [0, 0, 0];
      let shifts = 0;
      for (const day of memberScheduleOfMonth(input, month)) {
        for (const shift of day.shifts) {
          const split = SPLIT[shift.shiftTypeId ?? ''];
          if (split === undefined) continue;
          shifts += 1;
          split.forEach((minutes, index) => (expected[index]! += minutes));
        }
      }
      // The second member of each team is inactive from 2026-09-20, so has no October shift.
      if (member.id.endsWith('-1')) expect(shifts, member.id).toBeGreaterThan(0);
      expect(hours.shiftCount, member.id).toBe(shifts);
      expect(hours.bands.map((band) => band.minutes), member.id).toEqual(expected);
      expect(hours.bands.reduce((sum, band) => sum + band.shiftCount, 0), member.id).toBe(2 * shifts);
      expect(hours.totalMinutes, member.id).toBe(480 * shifts);
      expectInvariant(hours, member.id);
    }
  });
});

describe('both fixtures, every member, against the minute-by-minute oracle', () => {
  const MONTHS = ['2020-01', '2024-02', '2026-03', MONTH, '2026-10', '2026-12'] as const;

  it.each(FIXTURES)('$fixture', (fx) => {
    for (const member of membersOf(fx.teams)) {
      for (const month of MONTHS) {
        const input = fixtureInput(fx, member.id);
        const hours = memberHoursOfMonth(input, month);
        expect(hours, `${member.id} in ${month}`).toEqual(oracleHours(input, month));
        expectInvariant(hours, `${member.id} in ${month}`);
      }
    }
  });
});

describe('daylight saving changes nothing', () => {
  it.each(FIXTURES)('$fixture: every working type on 2026-03-29 and 2026-10-25 is as on an ordinary date', (fx) => {
    const shiftTypes = withVersions(fx.types, fx.versions);
    for (const type of workingOf(fx.types)) {
      const ordinary = memberHoursOfMonth(soloInput(fx.bands, shiftTypes, fx.off, [{ date: '2026-09-10', shiftTypeId: type }]), MONTH);
      for (const date of ['2026-03-29', '2026-10-25']) {
        const hours = memberHoursOfMonth(soloInput(fx.bands, shiftTypes, fx.off, [{ date, shiftTypeId: type }]), date.slice(0, 7));
        expect(hours, `${type} on ${date}`).toEqual(ordinary);
      }
    }
  });

  it('gives a 12-hour pilot shift 720 minutes on both transition dates', () => {
    const shiftTypes = withVersions(PILOT_SHIFT_TYPES, PILOT_SHIFT_TYPE_VERSIONS);
    for (const date of ['2026-03-29', '2026-10-25']) {
      for (const type of ['pilot-dan', 'pilot-noc']) {
        const hours = memberHoursOfMonth(soloInput(PILOT_HOUR_BANDS, shiftTypes, 'pilot-slobodno', [{ date, shiftTypeId: type }]), date.slice(0, 7));
        expect(hours.totalMinutes, `${type} on ${date}`).toBe(720);
        expect(bandsOf(hours)[type], `${type} on ${date}`).toEqual([720, 1]);
      }
    }
  });
});

describe('a shift crossing into the next month counts wholly in its start month', () => {
  it.each(FIXTURES)('$fixture: the crossing type on the last day of the month', (fx) => {
    const shiftTypes = withVersions(fx.types, fx.versions);
    const version = fx.versions.find((one) => one.shiftTypeId === fx.crossing)!;
    const duration = (version.endMinute - version.startMinute + 1440) % 1440 || 1440;
    for (const [month, last, next] of [
      ['2026-09', '2026-09-30', '2026-10'],
      ['2026-12', '2026-12-31', '2027-01'],
      ['2024-02', '2024-02-29', '2024-03'],
    ] as const) {
      const input = soloInput(fx.bands, shiftTypes, fx.off, [{ date: last, shiftTypeId: fx.crossing }]);
      const hours = memberHoursOfMonth(input, month);
      expect(hours.totalMinutes, last).toBe(duration);
      expect(hours.shiftCount, last).toBe(1);
      expectInvariant(hours, last);
      expect(memberHoursOfMonth(input, next).totalMinutes, next).toBe(0);
    }
  });
});

/**
 * The first date of {@link MONTH} before {@link SECOND_MEMBER_INACTIVE_FROM}
 * (so both members of every team in {@link membersOf} are active) on which each
 * team of `works` works per its rotation and, when given, `offTeam` does not.
 *
 * @throws Error when no date of the month qualifies.
 */
function dateWhere(fx: Fixture, works: readonly string[], offTeam: string | null): string {
  const working = new Set(workingOf(fx.types));
  const worksOn = (team: string, date: string): boolean => {
    const type = projectedShiftTypeOn(fx.assignments.filter((one) => one.teamId === team), fx.steps, date);
    return type !== null && working.has(type);
  };
  const found = datesOfMonth(MONTH).find(
    (date) =>
      date < SECOND_MEMBER_INACTIVE_FROM && works.every((team) => worksOn(team, date)) && (offTeam === null || !worksOn(offTeam, date)),
  );
  if (found === undefined) {
    throw new Error(`no qualifying date in ${MONTH} on which ${works.join(', ')} work${offTeam === null ? '' : ` and ${offTeam} is off`}`);
  }
  return found;
}

/** The hours of one shift of `shiftTypeId` on `date`, alone, as {@link subtract} gives them. */
function oneShiftOf(fx: Fixture, date: string, shiftTypeId: string): readonly number[] {
  const shiftTypes = withVersions(fx.types, fx.versions);
  return subtract(
    memberHoursOfMonth(soloInput(fx.bands, shiftTypes, fx.off, [{ date, shiftTypeId }]), MONTH),
    memberHoursOfMonth(soloInput(fx.bands, shiftTypes, fx.off, []), MONTH),
  );
}

function subtract(a: MemberHours, b: MemberHours): readonly number[] {
  return [a.shiftCount - b.shiftCount, a.totalMinutes - b.totalMinutes, ...a.bands.flatMap((band, index) => [band.minutes - b.bands[index]!.minutes, band.shiftCount - b.bands[index]!.shiftCount])];
}

describe('hours follow the roster', () => {
  it.each(FIXTURES)('$fixture: a replacement moves the shift from the member taken off to the one put on, and nobody else', (fx) => {
    const alfa = fx.teams[0]!.id;
    const bravo = fx.teams[1]!.id;
    const date = dateWhere(fx, [alfa], bravo);
    const A = `${alfa}-1`;
    const B = `${bravo}-1`;
    const rosterOverrides: RosterOverride[] = [{ id: 'r1', teamId: alfa, date, memberOutId: A, memberInId: B }];

    // The shift's own hours: one shift of its type, alone.
    const type = projectedShiftTypeOn(fx.assignments.filter((one) => one.teamId === alfa), fx.steps, date)!;
    const one = memberHoursOfMonth(soloInput(fx.bands, withVersions(fx.types, fx.versions), fx.off, [{ date, shiftTypeId: type }]), MONTH);
    const oneShift = subtract(one, memberHoursOfMonth(soloInput(fx.bands, withVersions(fx.types, fx.versions), fx.off, []), MONTH));
    expect(oneShift[0]).toBe(1);

    const before = (id: string): MemberHours => memberHoursOfMonth(fixtureInput(fx, id), MONTH);
    const after = (id: string): MemberHours => memberHoursOfMonth(fixtureInput(fx, id, { rosterOverrides }), MONTH);

    expect(subtract(before(A), after(A))).toEqual(oneShift);
    expect(subtract(after(B), before(B))).toEqual(oneShift);
    for (const member of membersOf(fx.teams)) {
      if (member.id === A || member.id === B) continue;
      expect(after(member.id), member.id).toEqual(before(member.id));
    }
    for (const id of [A, B]) {
      const input = fixtureInput(fx, id, { rosterOverrides });
      expect(memberHoursOfMonth(input, MONTH), id).toEqual(oracleHours(input, MONTH));
    }
  });

  it.each(FIXTURES)('$fixture: a double shift counts both shifts', (fx) => {
    const alfa = fx.teams[0]!.id;
    const bravo = fx.teams[1]!.id;
    const date = dateWhere(fx, [alfa, bravo], null);
    const B = `${bravo}-1`;
    const rosterOverrides: RosterOverride[] = [{ id: 'r1', teamId: alfa, date, memberOutId: null, memberInId: B }];

    const days = memberScheduleOfMonth(fixtureInput(fx, B, { rosterOverrides }), MONTH);
    expect(days.find((day) => day.date === date)!.shifts).toHaveLength(2);

    const alfaType = projectedShiftTypeOn(fx.assignments.filter((one) => one.teamId === alfa), fx.steps, date)!;
    const shiftTypes = withVersions(fx.types, fx.versions);
    const oneShift = subtract(
      memberHoursOfMonth(soloInput(fx.bands, shiftTypes, fx.off, [{ date, shiftTypeId: alfaType }]), MONTH),
      memberHoursOfMonth(soloInput(fx.bands, shiftTypes, fx.off, []), MONTH),
    );
    const before = memberHoursOfMonth(fixtureInput(fx, B), MONTH);
    const after = memberHoursOfMonth(fixtureInput(fx, B, { rosterOverrides }), MONTH);
    expect(subtract(after, before)).toEqual(oneShift);
    expectInvariant(after, B);
  });

  it.each(FIXTURES)('$fixture: a shift-type override to a non-working type contributes nothing', (fx) => {
    const alfa = fx.teams[0]!.id;
    const date = dateWhere(fx, [alfa], null);
    const overrides: ShiftTypeOverride[] = [{ teamId: alfa, date, shiftTypeId: fx.off }];
    const before = memberHoursOfMonth(fixtureInput(fx, `${alfa}-1`), MONTH);
    const after = memberHoursOfMonth(fixtureInput(fx, `${alfa}-1`, { overrides }), MONTH);
    const type = projectedShiftTypeOn(fx.assignments.filter((one) => one.teamId === alfa), fx.steps, date)!;
    const oneShift = oneShiftOf(fx, date, type);
    expect(oneShift[0]).toBe(1);
    expect(oneShift[1]).toBeGreaterThan(0);
    expect(subtract(before, after)).toEqual(oneShift);
  });
});

describe('an accepted-uncovered shift counts as leave, not as work (story 5.4b)', () => {
  it.each(FIXTURES)('$fixture: no leave shifts, or an empty list, leaves every figure as it was', (fx) => {
    for (const member of membersOf(fx.teams)) {
      const plain = memberHoursOfMonth(fixtureInput(fx, member.id), MONTH);
      expect(plain.leaveMinutes, member.id).toBe(0);
      expect(memberHoursOfMonth(fixtureInput(fx, member.id, { leaveShifts: [] }), MONTH), member.id).toEqual(plain);
    }
  });

  it.each(FIXTURES)('$fixture: the shift\'s duration moves out of the bands, the total and the count, into leave', (fx) => {
    const alfa = fx.teams[0]!.id;
    const date = dateWhere(fx, [alfa], null);
    const id = `${alfa}-1`;
    const type = projectedShiftTypeOn(fx.assignments.filter((one) => one.teamId === alfa), fx.steps, date)!;
    const oneShift = oneShiftOf(fx, date, type);
    expect(oneShift[0]).toBe(1);

    const before = memberHoursOfMonth(fixtureInput(fx, id), MONTH);
    const input = fixtureInput(fx, id, { leaveShifts: [{ date, teamId: alfa }] });
    const after = memberHoursOfMonth(input, MONTH);

    expect(subtract(before, after)).toEqual(oneShift);
    expect(after.leaveMinutes).toBe(oneShift[1]);
    expect(after.untimedShiftCount).toBe(before.untimedShiftCount);
    expectInvariant(after, id);
    expect(after).toEqual(oracleHours(input, MONTH));
  });

  it('gives a 12-hour pilot shift 720 leave minutes, and takes 720 and one shift from the rest', () => {
    const shiftTypes = withVersions(PILOT_SHIFT_TYPES, PILOT_SHIFT_TYPE_VERSIONS);
    const shifts = [
      { date: '2026-09-10', shiftTypeId: 'pilot-dan' },
      { date: '2026-09-11', shiftTypeId: 'pilot-dan' },
    ];
    const worked = memberHoursOfMonth(soloInput(PILOT_HOUR_BANDS, shiftTypes, 'pilot-slobodno', shifts), MONTH);
    const accepted = memberHoursOfMonth(
      { ...soloInput(PILOT_HOUR_BANDS, shiftTypes, 'pilot-slobodno', shifts), leaveShifts: [{ date: '2026-09-10', teamId: 't' }] },
      MONTH,
    );
    expect(worked.totalMinutes).toBe(1440);
    expect(accepted).toEqual({
      ...worked,
      shiftCount: 1,
      bands: [
        { bandId: 'pilot-dan', minutes: 720, shiftCount: 1 },
        { bandId: 'pilot-noc', minutes: 0, shiftCount: 0 },
      ],
      totalMinutes: 720,
      leaveMinutes: 720,
    });
  });

  it('moves a midnight-crossing Noć, hand-computed: 720 leave minutes, and the Dan beside it untouched', () => {
    // Dan 07:00–19:00 on the 29th, Noć 19:00–07:00 on the 30th (into October), the Noć accepted.
    const shiftTypes = withVersions(PILOT_SHIFT_TYPES, PILOT_SHIFT_TYPE_VERSIONS);
    const input: MemberHoursInput = {
      ...soloInput(PILOT_HOUR_BANDS, shiftTypes, 'pilot-slobodno', [
        { date: '2026-09-29', shiftTypeId: 'pilot-dan' },
        { date: '2026-09-30', shiftTypeId: 'pilot-noc' },
      ]),
      leaveShifts: [{ date: '2026-09-30', teamId: 't' }],
    };

    expect(memberHoursOfMonth(input, MONTH)).toEqual({
      shiftCount: 1,
      bands: [
        { bandId: 'pilot-dan', minutes: 720, shiftCount: 1 },
        { bandId: 'pilot-noc', minutes: 0, shiftCount: 0 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 720,
      leaveMinutes: 720,
      untimedShiftCount: 0,
    });
    // Wholly in its start month: October holds none of it.
    expect(memberHoursOfMonth(input, '2026-10').leaveMinutes).toBe(0);
  });

  it('adds nothing anywhere for an untimed shift', () => {
    const later = typeOf('x', at(7), at(19), '2026-09-15');
    const base = soloInput(PILOT_HOUR_BANDS, [later, offEntry], 'off', [
      { date: '2026-09-10', shiftTypeId: 'x' },
      { date: '2026-09-20', shiftTypeId: 'x' },
    ]);
    const before = memberHoursOfMonth(base, MONTH);
    const after = memberHoursOfMonth({ ...base, leaveShifts: [{ date: '2026-09-10', teamId: 't' }] }, MONTH);
    expect(before.untimedShiftCount).toBe(1);
    expect(after).toEqual({ ...before, shiftCount: 1, untimedShiftCount: 0, leaveMinutes: 0 });
  });

  it.each(FIXTURES)('$fixture: a leave shift on another team, a date off or another month changes nothing', (fx) => {
    const alfa = fx.teams[0]!.id;
    const bravo = fx.teams[1]!.id;
    const date = dateWhere(fx, [alfa], bravo);
    const id = `${alfa}-1`;
    const before = memberHoursOfMonth(fixtureInput(fx, id), MONTH);
    const leaveShifts: LeaveShift[] = [
      { date, teamId: bravo },
      { date: '2026-10-05', teamId: alfa },
    ];
    expect(memberHoursOfMonth(fixtureInput(fx, id, { leaveShifts }), MONTH)).toEqual(before);
  });
});

describe('zero bands', () => {
  it.each(FIXTURES)('$fixture: every minute is unbanded, and there are no bands', (fx) => {
    const input = fixtureInput(fx, `${fx.teams[0]!.id}-1`, { bands: [] });
    const hours = memberHoursOfMonth(input, MONTH);
    expect(hours.bands).toEqual([]);
    expect(hours.totalMinutes).toBeGreaterThan(0);
    expect(hours.unbandedMinutes).toBe(hours.totalMinutes);
    expect(hours).toEqual(oracleHours(input, MONTH));
  });

  it('leaves unbandedMinutes at 0 whenever any band exists', () => {
    for (const fx of FIXTURES) {
      expect(memberHoursOfMonth(fixtureInput(fx, `${fx.teams[0]!.id}-1`), MONTH).unbandedMinutes).toBe(0);
    }
  });
});

describe('an untimed working shift', () => {
  it('counts as a shift and as untimed, never in minutes', () => {
    const later = typeOf('x', at(7), at(19), '2026-09-15');
    const input = soloInput(PILOT_HOUR_BANDS, [later, offEntry], 'off', [
      { date: '2026-09-10', shiftTypeId: 'x' },
      { date: '2026-09-20', shiftTypeId: 'x' },
    ]);
    const hours = memberHoursOfMonth(input, MONTH);
    expect(hours).toEqual({
      shiftCount: 2,
      bands: [
        { bandId: 'pilot-dan', minutes: 720, shiftCount: 1 },
        { bandId: 'pilot-noc', minutes: 0, shiftCount: 0 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 720,
      leaveMinutes: 0,
      untimedShiftCount: 1,
    });
  });

  it('follows the version in force on each date', () => {
    const changed: ShiftTypeWithVersions = {
      type: { id: 'x', name: 'x', isWorking: true },
      versions: [
        { shiftTypeId: 'x', effectiveFrom: '2026-09-15', startMinute: at(19), endMinute: at(7) },
        { shiftTypeId: 'x', effectiveFrom: SEEDED_EFFECTIVE_FROM, startMinute: at(7), endMinute: at(15) },
      ],
    };
    const hours = memberHoursOfMonth(
      soloInput(PILOT_HOUR_BANDS, [changed, offEntry], 'off', [
        { date: '2026-09-14', shiftTypeId: 'x' },
        { date: '2026-09-15', shiftTypeId: 'x' },
      ]),
      MONTH,
    );
    expect(bandsOf(hours)).toEqual({ 'pilot-dan': [480, 1], 'pilot-noc': [720, 1] });
    expect(hours.totalMinutes).toBe(1200);
  });

  it('ignores days with no rotation in effect', () => {
    const input = { ...soloInput(PILOT_HOUR_BANDS, [typeOf('x', at(7), at(19)), offEntry], 'off', []), assignments: [] };
    expect(memberHoursOfMonth(input, MONTH)).toEqual({
      shiftCount: 0,
      bands: [
        { bandId: 'pilot-dan', minutes: 0, shiftCount: 0 },
        { bandId: 'pilot-noc', minutes: 0, shiftCount: 0 },
      ],
      unbandedMinutes: 0,
      totalMinutes: 0,
      leaveMinutes: 0,
      untimedShiftCount: 0,
    });
  });
});

describe('the preconditions are re-checked, not assumed', () => {
  const good = soloInput(PILOT_HOUR_BANDS, [typeOf('x', at(7), at(19)), offEntry], 'off', [{ date: '2026-09-10', shiftTypeId: 'x' }]);

  it.each(['2026-13', '2026-9', '', 'abc'])('refuses the month %j', (month) => {
    expect(() => memberHoursOfMonth(good, month)).toThrow(RangeError);
  });

  it.each([
    ['a band starting at 1440', { bands: [{ id: 'b1', name: 'B', startMinute: 1440 }] }, 'b1'],
    ['a band starting at 7.5', { bands: [{ id: 'b1', name: 'B', startMinute: 7.5 }] }, '7.5'],
    [
      'two bands sharing an id',
      { bands: [{ id: 'b1', name: 'B', startMinute: 60 }, { id: 'b1', name: 'C', startMinute: 120 }] },
      'b1',
    ],
    [
      'two bands sharing a start',
      { bands: [{ id: 'b1', name: 'B', startMinute: 60 }, { id: 'b2', name: 'C', startMinute: 60 }] },
      'b2',
    ],
    ['a shift type given twice', { shiftTypes: [typeOf('x', at(7), at(19)), typeOf('x', at(8), at(9)), offEntry] }, 'x'],
    [
      'a version of another type',
      { shiftTypes: [{ type: { id: 'x', name: 'x', isWorking: true }, versions: typeOf('y', 0, 60).versions }, offEntry] },
      'y',
    ],
    ['a non-working type with a version', { shiftTypes: [typeOf('x', at(7), at(19)), { type: OFF, versions: typeOf('off', 0, 60).versions }] }, 'off'],
    ['a version ending at 1440', { shiftTypes: [typeOf('x', at(7), 1440), offEntry] }, '1440'],
    ['a version with a bad date', { shiftTypes: [typeOf('x', at(7), at(19), '2026-02-30'), offEntry] }, '2026-02-30'],
    ['a working id that is not a working type', { workingShiftTypeIds: ['x', 'off'] }, 'off'],
    ['a working type missing from the working ids', { workingShiftTypeIds: [] }, 'x'],
    ['a scheduled type that is not given', { shiftTypes: [typeOf('x', at(7), at(19))] }, 'off'],
  ] as const)('throws a RangeError naming the value for %s', (_label, patch, offender) => {
    const input = { ...good, ...patch } as MemberHoursInput;
    expect(() => memberHoursOfMonth(input, MONTH)).toThrow(RangeError);
    expect(() => memberHoursOfMonth(input, MONTH)).toThrow(offender);
  });
});

describe('the invariant, over randomized configurations', () => {
  /** mulberry32 — a small seeded PRNG, so a failure reproduces. */
  function prng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MONTHS = ['2024-02', '2026-02', '2026-03', '2026-09', '2026-10', '2026-12'] as const;

  it('holds, and matches the oracle, over 1000 band and shift-type configurations', () => {
    const random = prng(20260930);
    const int = (below: number): number => Math.floor(random() * below);
    // One draw in eight lands on a boundary the uniform draw would rarely hit.
    const minute = (): number => (random() < 0.125 ? [0, 1439, at(7), at(19)][int(4)]! : int(1440));

    for (let run = 0; run < 1000; run += 1) {
      const starts = new Set<number>();
      const bandCount = int(7);
      while (starts.size < bandCount) starts.add(minute());
      const bands = [...starts].map((startMinute, index) => ({ id: `b${String(index)}`, name: `B${String(index)}`, startMinute }));

      const shiftTypes: ShiftTypeWithVersions[] = [];
      const typeCount = 1 + int(4);
      for (let index = 0; index < typeCount; index += 1) {
        const id = `t${String(index)}`;
        if (random() < 0.2) {
          shiftTypes.push({ type: { id, name: id, isWorking: false }, versions: [] });
          continue;
        }
        const start = minute();
        const end = random() < 0.1 ? start : minute();
        const versions: ShiftTypeVersion[] = [{ shiftTypeId: id, effectiveFrom: random() < 0.15 ? '2026-06-15' : SEEDED_EFFECTIVE_FROM, startMinute: start, endMinute: end }];
        if (random() < 0.2) versions.push({ shiftTypeId: id, effectiveFrom: '2026-09-11', startMinute: minute(), endMinute: minute() });
        shiftTypes.push({ type: { id, name: id, isWorking: true }, versions });
      }

      const stepCount = 1 + int(5);
      const steps: RotationStep[] = Array.from({ length: stepCount }, (_, position) => ({
        id: `s${String(position)}`,
        patternId: 'p',
        position,
        shiftTypeId: shiftTypes[int(shiftTypes.length)]!.type.id,
      }));
      const assignments: RotationAssignment[] = [
        { teamId: 't', patternId: 'p', offsetStepId: `s${String(int(stepCount))}`, anchorDate: SEEDED_EFFECTIVE_FROM, effectiveFrom: SEEDED_EFFECTIVE_FROM },
      ];

      const base = soloInput(bands, shiftTypes, shiftTypes[0]!.type.id, []);
      const input: MemberHoursInput = { ...base, steps, assignments };
      const month = MONTHS[int(MONTHS.length)]!;
      const label = `run ${String(run)} in ${month}`;

      const hours = memberHoursOfMonth(input, month);
      expectInvariant(hours, label);
      expect(hours.unbandedMinutes === 0, `${label}: unbanded only with no bands`).toBe(bands.length > 0 || hours.totalMinutes === 0);
      expect(hours, label).toEqual(oracleHours(input, month));
    }
  });
});
