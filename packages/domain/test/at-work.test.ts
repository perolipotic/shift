import { describe, expect, it } from 'vitest';

import {
  MAX_AT_WORK_RANGE_DAYS,
  atWorkShiftsOf,
  overrideStandingOf,
  type AtWorkShift,
  type ScheduleInputs,
} from '../src/index.js';
import { PARITY_FIXTURES, inputsOf } from '../parity/fixtures.js';

/**
 * R12 (story 16.2): a member's at-work shifts, over the parity fixture of
 * both fixtures (AD-15), whose scene puts every exception kind on or around
 * a daylight-saving transition.
 */

const [pilot, uj5] = PARITY_FIXTURES;
if (pilot === undefined || uj5 === undefined) throw new Error('the parity fixture lost a fixture');

const pilotOf = (memberId: string): ScheduleInputs => inputsOf(pilot.organization, memberId);
const uj5Of = (memberId: string): ScheduleInputs => inputsOf(uj5.organization, memberId);

/** One shift as `[date, team, type, start, end, extras]`, the team and type without their fixture prefix. */
function line(shift: AtWorkShift): string {
  const short = (id: string): string => id.replace(/^(pilot|uj5)-(smjena-)?/, '');
  const extras = [shift.viaOverride ? 'override' : '', shift.loanId ?? '', shift.workedHalf ?? ''].filter((one) => one !== '');
  return [shift.date, short(shift.teamId), short(shift.shiftTypeId), shift.startMinute, shift.endMinute, ...extras].join(' ');
}

const linesOn = (inputs: ScheduleInputs, from: string, to: string): readonly string[] =>
  atWorkShiftsOf(inputs, from, to).map(line);

describe('R12.1 — the working shifts of the member\'s day', () => {
  it('is the rotation\'s working shifts, timed, with no exception at all', () => {
    expect(linesOn(pilotOf('pilot-m2'), '2026-01-01', '2026-01-08')).toEqual([
      '2026-01-01 b noc 1140 1860',
      '2026-01-04 b dan 420 1140',
      '2026-01-05 b noc 1140 1860',
      '2026-01-08 b dan 420 1140',
    ]);
  });

  it('runs a midnight-crossing shift into the next date, on its start date (DI-5)', () => {
    expect(linesOn(uj5Of('uj5-m3'), '2026-10-26', '2026-10-26')).toEqual(['2026-10-26 c nocna 1320 1800']);
  });

  it('follows a loan, with its id, and the effective team after it (R11)', () => {
    expect(linesOn(pilotOf('pilot-m1'), '2026-03-28', '2026-03-31')).toEqual([
      '2026-03-28 c dan 420 1140 pilot-loan-1',
      '2026-03-29 c noc 1140 1860 pilot-loan-1',
      '2026-03-31 a noc 1140 1860',
    ]);
    // On no team, and lent: only the loan's working dates.
    expect(linesOn(pilotOf('pilot-m4'), '2026-03-01', '2027-10-31')).toEqual(['2027-03-27 d noc 1140 1860 pilot-loan-2']);
  });

  it('applies a shift-type override in force, and not one pending review', () => {
    expect(linesOn(pilotOf('pilot-m5'), '2026-03-29', '2026-03-29')).toEqual(['2026-03-29 a dan 420 1140']);
    // D's override of 2027-10-31 is pending: D keeps its projected day off.
    const d = pilot.organization.members.map((member) => member.id).flatMap((id) => linesOn(pilotOf(id), '2027-10-31', '2027-10-31'));
    expect(d.some((one) => one.includes(' d '))).toBe(false);
  });

  it('puts the member on a shift a roster override in force put them on, and drops one it took them off', () => {
    expect(linesOn(pilotOf('pilot-m2'), '2026-10-25', '2026-10-25')).toEqual(['2026-10-25 a noc 1140 1860 override']);
    expect(linesOn(pilotOf('pilot-m1'), '2027-10-24', '2027-10-24')).toEqual([]);
    expect(linesOn(uj5Of('uj5-m1'), '2027-03-28', '2027-03-28')).toEqual(['2027-03-28 c jutarnja 360 840 override']);
    expect(linesOn(uj5Of('uj5-m3'), '2027-03-28', '2027-03-28')).toEqual([]);
  });

  it('keeps a shift a pending roster override would take them off', () => {
    expect(linesOn(pilotOf('pilot-m5'), '2027-10-31', '2027-10-31')).toEqual(['2027-10-31 b noc 1140 1860']);
  });

  it('drops every date of a full-day Leave Record, of any type', () => {
    expect(linesOn(pilotOf('pilot-m1'), '2026-10-25', '2026-10-25')).toEqual([]);
    expect(linesOn(uj5Of('uj5-m1'), '2026-03-29', '2026-04-01')).toEqual(['2026-04-01 a nocna 1320 1800']);
  });

  it('has no shift on a date the member is inactive', () => {
    expect(linesOn(pilotOf('pilot-m3'), '2026-06-01', '2027-10-31')).toEqual([]);
    expect(linesOn(uj5Of('uj5-m4'), '2027-01-01', '2027-05-31')).toEqual([]);
    expect(linesOn(uj5Of('uj5-m4'), '2027-06-01', '2027-06-10').length).toBeGreaterThan(0);
  });

  it('never lists a non-working type, and never another member\'s leave', () => {
    const shifts = atWorkShiftsOf(pilotOf('pilot-m5'), '2026-03-01', '2027-10-31');

    expect(shifts.some((shift) => shift.shiftTypeId === 'pilot-slobodno')).toBe(false);
    // m1's full day on 2026-10-25 is m1's alone.
    expect(linesOn(pilotOf('pilot-m2'), '2026-10-25', '2026-10-25')).toHaveLength(1);
  });
});

describe('R12.2 — a Half-day Record keeps the worked half', () => {
  it('keeps the second half of a day shift when the first is the absence', () => {
    expect(linesOn(pilotOf('pilot-m1'), '2027-10-31', '2027-10-31')).toEqual(['2027-10-31 a dan 780 1140 SECOND']);
  });

  it('keeps the first half of a night when the second is the absence, across midnight', () => {
    expect(linesOn(pilotOf('pilot-m2'), '2027-10-31', '2027-10-31')).toEqual(['2027-10-31 b noc 1140 1500 FIRST']);
  });

  it('keeps the first half of a UJ-5 morning', () => {
    expect(linesOn(uj5Of('uj5-m1'), '2026-10-26', '2026-10-26')).toEqual(['2026-10-26 a jutarnja 360 600 FIRST']);
  });

  it('starts the worked second half of a night after midnight, on the start date', () => {
    const inputs: ScheduleInputs = {
      ...pilotOf('pilot-m2'),
      leave: [{ id: 'night-half', from: '2026-01-01', to: '2026-01-01', half: 'FIRST', absenceTypeId: 'annual' }],
    };

    expect(linesOn(inputs, '2026-01-01', '2026-01-01')).toEqual(['2026-01-01 b noc 1500 1860 SECOND']);
  });

  it('splits nothing on a date holding two working shifts, as hours do', () => {
    const inputs: ScheduleInputs = {
      ...pilotOf('pilot-m2'),
      leave: [{ id: 'two-shifts', from: '2026-10-25', to: '2026-10-25', half: 'FIRST', absenceTypeId: 'annual' }],
      rosterOverrides: [
        ...pilot.organization.rosterOverrides,
        { id: 'extra', teamId: 'pilot-smjena-d', date: '2026-10-25', memberOutId: null, memberInId: 'pilot-m2', writtenAt: 1767225600000000 },
      ],
    };

    expect(linesOn(inputs, '2026-10-25', '2026-10-25')).toEqual(['2026-10-25 a noc 1140 1860 override', '2026-10-25 d dan 420 1140 override']);
  });
});

describe('the window and the preconditions', () => {
  it('takes the window by start date, both ends inclusive', () => {
    expect(linesOn(pilotOf('pilot-m2'), '2026-01-01', '2026-01-01')).toEqual(['2026-01-01 b noc 1140 1860']);
    expect(linesOn(pilotOf('pilot-m2'), '2026-01-02', '2026-01-03')).toEqual([]);
  });

  it('projects across a year boundary, month by month', () => {
    const shifts = atWorkShiftsOf(pilotOf('pilot-m2'), '2026-12-30', '2027-01-03');

    expect(shifts.every((shift) => shift.date >= '2026-12-30' && shift.date <= '2027-01-03')).toBe(true);
    expect(shifts.length).toBeGreaterThan(0);
  });

  it('does not change with the order of the assembly\'s lists', () => {
    const inputs = uj5Of('uj5-m1');
    const reversed: ScheduleInputs = {
      ...inputs,
      teams: [...inputs.teams].reverse(),
      shiftTypes: [...inputs.shiftTypes].reverse(),
      steps: [...inputs.steps].reverse(),
      assignments: [...inputs.assignments].reverse(),
      assignmentStamps: [...inputs.assignmentStamps].reverse(),
      members: [...inputs.members].reverse(),
      overrides: [...inputs.overrides].reverse(),
      rosterOverrides: [...inputs.rosterOverrides].reverse(),
      leave: [...inputs.leave].reverse(),
    };

    expect(atWorkShiftsOf(reversed, '2026-03-01', '2027-10-31')).toEqual(atWorkShiftsOf(inputs, '2026-03-01', '2027-10-31'));
  });

  it('reads the standing of each override as the browser does (overrideStandingOf)', () => {
    const { inForce, pending } = overrideStandingOf(pilot.organization.assignmentStamps, pilot.organization.rosterOverrides);

    expect(inForce.map((one) => one.id)).toEqual(['pilot-roster-1', 'pilot-roster-2']);
    expect(pending.map((one) => one.id)).toEqual(['pilot-roster-3']);
  });

  it('refuses a reversed, overlong or malformed window', () => {
    expect(() => atWorkShiftsOf(pilotOf('pilot-m1'), '2026-02-01', '2026-01-01')).toThrow(/ends before it starts/);
    expect(() => atWorkShiftsOf(pilotOf('pilot-m1'), '2026-01-01', '2028-01-03')).toThrow(new RegExp(String(MAX_AT_WORK_RANGE_DAYS)));
    expect(() => atWorkShiftsOf(pilotOf('pilot-m1'), '2026-01-32', '2026-02-01')).toThrow(RangeError);
  });

  it('refuses a member it is not given, a member given twice, and a team it is not given', () => {
    expect(() => atWorkShiftsOf(pilotOf('nobody'), '2026-01-01', '2026-01-31')).toThrow(/not among the members/);
    const twice = pilotOf('pilot-m1');
    expect(() => atWorkShiftsOf({ ...twice, members: [...twice.members, twice.members[0]!] }, '2026-01-01', '2026-01-31')).toThrow(/given twice/);
    expect(() => atWorkShiftsOf({ ...twice, teams: twice.teams.slice(1) }, '2026-01-01', '2026-01-31')).toThrow(/team pilot-smjena-a/);
  });

  it('refuses a team given twice', () => {
    const inputs = pilotOf('pilot-m1');

    expect(() => atWorkShiftsOf({ ...inputs, teams: [...inputs.teams, inputs.teams[0]!] }, '2026-01-01', '2026-01-31')).toThrow(/team pilot-smjena-a is given twice/);
  });

  it('refuses leave records sharing a date, and a malformed one', () => {
    const inputs = pilotOf('pilot-m1');

    expect(() =>
      atWorkShiftsOf(
        {
          ...inputs,
          leave: [
            { id: 'one', from: '2026-01-01', to: '2026-01-05', absenceTypeId: 'annual' },
            { id: 'two', from: '2026-01-05', to: '2026-01-06', absenceTypeId: 'annual' },
          ],
        },
        '2026-01-01',
        '2026-01-31',
      ),
    ).toThrow(/share a date/);
    expect(() =>
      atWorkShiftsOf({ ...inputs, leave: [{ id: 'bad', from: '2026-01-06', to: '2026-01-05', absenceTypeId: 'annual' }] }, '2026-01-01', '2026-01-31'),
    ).toThrow(RangeError);
  });

  it('refuses a shift type given twice, and a schedule naming one not given', () => {
    const inputs = pilotOf('pilot-m1');

    expect(() => atWorkShiftsOf({ ...inputs, shiftTypes: [...inputs.shiftTypes, inputs.shiftTypes[0]!] }, '2026-01-01', '2026-01-31')).toThrow(/given twice/);
    expect(() => atWorkShiftsOf({ ...inputs, shiftTypes: inputs.shiftTypes.slice(1) }, '2026-01-01', '2026-01-31')).toThrow(/pilot-dan/);
  });

  it('lists no working shift that has no times in effect yet', () => {
    const inputs = pilotOf('pilot-m2');
    const untimed: ScheduleInputs = {
      ...inputs,
      shiftTypes: inputs.shiftTypes.map((entry) =>
        entry.type.id === 'pilot-dan'
          ? { ...entry, versions: entry.versions.map((version) => ({ ...version, effectiveFrom: '2026-01-05' })) }
          : entry,
      ),
    };

    // B's Dan of the 4th has no times yet; the 8th's has.
    expect(linesOn(untimed, '2026-01-01', '2026-01-08')).toEqual([
      '2026-01-01 b noc 1140 1860',
      '2026-01-05 b noc 1140 1860',
      '2026-01-08 b dan 420 1140',
    ]);
  });
});
