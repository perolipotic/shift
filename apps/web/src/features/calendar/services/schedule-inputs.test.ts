import { atWorkShiftsOf } from '@shift/domain';
import { describe, expect, it } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { scheduleInputsOfCalendar, type OwnLeaveRecord } from '@/features/calendar/services/schedule-inputs';
import {
  ORGANIZATION,
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarLoanRow,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  loansAnswerOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * STORY 16.2 — the browser's side of AD-19: the calendar snapshot and the
 * viewer's own leave as the domain's `ScheduleInputs`, windowed as the
 * server windows, and nothing derived, named or authored in it. Both
 * fixtures (AD-15). Its equality with `member_schedule_inputs` is the
 * read-parity suite's, over the real database.
 */

const COLLEAGUE = '00000000-0000-4000-8000-0000000000c1';
const WINDOW = { from: '2026-10-01', to: '2026-10-31' };

type Row = Record<string, unknown>;

async function snapshotOf(rows: FixtureRows, extra: { overrides?: readonly Row[]; rosterOverrides?: readonly Row[]; loans?: readonly Row[] } = {}): Promise<CalendarSnapshot> {
  const first = rows.teams[0]?.['id'] as string;
  const second = rows.teams[1]?.['id'] as string;
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(first, SEEDED)])],
          versions: [memberMembershipRow(VIEWER_MEMBER, first, SEEDED), memberMembershipRow(COLLEAGUE, second, SEEDED, ORGANIZATION, 'vozač')],
          statuses: [statusRow(COLLEAGUE, false, '2026-12-01')],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(COLLEAGUE, 'Ana Anić', 'vatrogasac')]),
    overridesAnswerOf(extra.overrides ?? []),
    rosterOverridesAnswerOf(extra.rosterOverrides ?? []),
    loansAnswerOf(extra.loans ?? []),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const OWN_LEAVE: readonly OwnLeaveRecord[] = [
  { id: 'leave-before', from: '2026-09-01', to: '2026-09-03', absenceTypeId: 'annual' },
  { id: 'leave-across', from: '2026-09-29', to: '2026-10-02', absenceTypeId: 'sick', drawsAllowance: false },
  { id: 'leave-half', from: '2026-10-20', to: '2026-10-20', half: 'SECOND', absenceTypeId: 'annual' },
  { id: 'leave-after', from: '2026-11-01', to: '2026-11-01', absenceTypeId: 'annual' },
];

describe('scheduleInputsOfCalendar', () => {
  it.each([
    ['pilot', PILOT],
    ['UJ-5', UJ5],
  ] as const)('carries the %s configuration whole, in canonical order', async (_name, rows) => {
    const snapshot = await snapshotOf(rows);
    const inputs = scheduleInputsOfCalendar(snapshot, [], WINDOW);

    expect(inputs.organizationId).toBe(snapshot.organizationId);
    expect(inputs.timeZone).toBe('Europe/Zagreb');
    expect(inputs.memberId).toBe(VIEWER_MEMBER);
    expect(inputs.teams.map((team) => team.id)).toEqual(snapshot.teams.map((team) => team.id).sort());
    expect(inputs.teams.every((team) => Object.keys(team).sort().join() === 'archived,id,name')).toBe(true);
    expect(inputs.shiftTypes.map((entry) => Object.keys(entry.type).sort().join())).toEqual(inputs.shiftTypes.map(() => 'id,isWorking,name'));
    expect(inputs.shiftTypes.flatMap((entry) => entry.versions)).toHaveLength(snapshot.types.flatMap((type) => type.versions).length);
    expect(inputs.steps).toHaveLength(snapshot.steps.length);
    expect(inputs.assignments).toEqual(snapshot.assignments);
    expect(inputs.assignmentStamps).toEqual(snapshot.assignmentStamps);
  });

  it('carries every member\'s histories and no name, rank or position-free copy of anything else', async () => {
    const inputs = scheduleInputsOfCalendar(await snapshotOf(PILOT), [], WINDOW);

    expect(inputs.members.map((member) => member.id)).toEqual([VIEWER_MEMBER, COLLEAGUE].sort());
    expect(inputs.members.find((member) => member.id === COLLEAGUE)).toEqual({
      id: COLLEAGUE,
      memberships: [{ teamId: 'pilot-smjena-b', position: 'vozač', effectiveFrom: SEEDED }],
      statuses: [{ active: false, effectiveFrom: '2026-12-01' }],
      loans: [],
    });
    expect(JSON.stringify(inputs)).not.toMatch(/Ana Anić|vatrogasac|Lana|Zamjena|reason|author|name":"DVD/);
  });

  it('keeps the live overrides dated in the window, pending ones included, each stamped in µs', async () => {
    const inputs = scheduleInputsOfCalendar(
      await snapshotOf(PILOT, {
        overrides: [
          calendarOverrideRow('override-in', 'pilot-smjena-a', '2026-10-31', 'pilot-dan', { createdAt: '2026-09-12T17:05:00.123456+00:00' }),
          calendarOverrideRow('override-out', 'pilot-smjena-a', '2026-11-01', 'pilot-dan'),
        ],
        rosterOverrides: [
          calendarRosterOverrideRow('roster-in', 'pilot-smjena-a', '2026-10-01', null, COLLEAGUE, {
            createdAt: '2026-09-12T17:05:00+00:00',
            confirmedAt: '2026-09-13T08:00:00.5+00:00',
          }),
          calendarRosterOverrideRow('roster-out', 'pilot-smjena-a', '2026-09-30', null, COLLEAGUE),
        ],
      }),
      [],
      WINDOW,
    );

    expect(inputs.overrides).toEqual([
      { id: 'override-in', teamId: 'pilot-smjena-a', date: '2026-10-31', shiftTypeId: 'pilot-dan', writtenAt: 1789232700123456 },
    ]);
    expect(inputs.rosterOverrides).toEqual([
      { id: 'roster-in', teamId: 'pilot-smjena-a', date: '2026-10-01', memberOutId: null, memberInId: COLLEAGUE, writtenAt: 1789286400500000 },
    ]);
  });

  it('keeps the loans and the own leave that overlap the window, a whole day with no half key', async () => {
    const inputs = scheduleInputsOfCalendar(
      await snapshotOf(PILOT, {
        loans: [
          calendarLoanRow('loan-across', VIEWER_MEMBER, 'pilot-smjena-c', '2026-09-30', '2026-10-01'),
          calendarLoanRow('loan-outside', VIEWER_MEMBER, 'pilot-smjena-c', '2026-11-02', '2026-11-03'),
        ],
      }),
      OWN_LEAVE,
      WINDOW,
    );

    expect(inputs.members.find((member) => member.id === VIEWER_MEMBER)?.loans).toEqual([
      { id: 'loan-across', teamId: 'pilot-smjena-c', from: '2026-09-30', to: '2026-10-01' },
    ]);
    expect(inputs.leave).toEqual([
      { id: 'leave-across', from: '2026-09-29', to: '2026-10-02', absenceTypeId: 'sick' },
      { id: 'leave-half', from: '2026-10-20', to: '2026-10-20', half: 'SECOND', absenceTypeId: 'annual' },
    ]);
    expect(Object.hasOwn(inputs.leave[0]!, 'half')).toBe(false);
  });

  it('is what R12 projects the viewer\'s at-work shifts from', async () => {
    const inputs = scheduleInputsOfCalendar(await snapshotOf(PILOT), OWN_LEAVE, WINDOW);
    const shifts = atWorkShiftsOf(inputs, WINDOW.from, WINDOW.to);

    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.every((shift) => shift.teamId === 'pilot-smjena-a')).toBe(true);
    expect(shifts.some((shift) => shift.date === '2026-10-01' || shift.date === '2026-10-02')).toBe(false);
  });
});
