import { leaveBalanceOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import {
  LEAVE_READY,
  memberLeaveBaseOf,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
} from '@/features/leave/services/leave-section';
import {
  MY_LEAVE_LOADING,
  MY_LEAVE_READY,
  MY_LEAVE_UNAVAILABLE,
  MY_LEAVE_UNSCHEDULED,
  myLeaveMessageKey,
  myLeaveOf,
  myLeaveRowsStateOf,
  myLeaveTilesOf,
  type MyLeave,
  type MyLeaveRowsState,
  type MyLeaveSources,
} from '@/features/leave/services/my-leave';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  UJ5,
  VIEWER_MEMBER,
  calendarOrganizationRow,
  calendarTableOf,
  membersAnswerOf,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.2c's view model, executed (AD-15): every row of the spec's matrix,
 * over both fixtures, every figure compared against `@shift/domain` itself
 * and against the admin card's figures for the same member — *Godišnji* shows
 * the domain's numbers and never its own.
 */

/** 2026-09-26 in Zagreb: the fixtures' today. */
const NOW = new Date('2026-09-26T10:00:00Z');

async function snapshotOf(
  rows: FixtureRows,
  { viewers = null as readonly Record<string, unknown>[] | null } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    { data: [calendarOrganizationRow(rows, { viewers })], error: null, count: 1 },
    membersAnswerOf(),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  uj5 = await snapshotOf(UJ5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MEMBERS: LeaveMembersSource = {
  members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 20 }],
  refusal: null,
  loading: false,
  paused: false,
};

const ORGANIZATION: LeaveOrganizationSource = {
  data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1 } },
  isPending: false,
  isError: false,
  fetchStatus: 'idle',
};

/** A row as `my_leave_records()` answers it: the range canonical, its upper bound exclusive. */
function rowOf(id: string, from: string, toExclusive: string, memberId: string = VIEWER_MEMBER) {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

function rowsOf(rows: readonly unknown[]): MyLeaveRowsState {
  return { rows, loading: false };
}

function sourcesOf(snapshot: CalendarSnapshot, overrides: Partial<MyLeaveSources> = {}): MyLeaveSources {
  return {
    members: MEMBERS,
    calendar: { snapshot, loading: false },
    organization: ORGANIZATION,
    records: rowsOf([]),
    ...overrides,
  };
}

function readyOf(leave: MyLeave): Extract<MyLeave, { kind: typeof MY_LEAVE_READY }> {
  if (leave.kind !== MY_LEAVE_READY) throw new Error(`not ready: ${leave.kind}`);

  return leave;
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan — 3 leave days. */
const WORKED = rowOf('record-worked', '2026-09-10', '2026-09-15');

describe("the viewer's figures", () => {
  it('shows 20 / 3 / 17 for an allowance of 20 and one own record costing 3 this year, as the domain does', () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));

    expect(leave.balance).toEqual({ allowanceDays: 20, usedDays: 3, balanceDays: 17 });
    expect(leave.balance).toEqual(
      leaveBalanceOf({
        input: memberScheduleInputOf(pilot, pilot.viewer),
        allowanceDays: 20,
        records: [{ from: '2026-09-10', to: '2026-09-14' }],
        today: '2026-09-26',
        leaveYearStart: { month: 1, day: 1 },
      }),
    );
  });

  it('shows 20 / 0 / 20 with no records', () => {
    expect(readyOf(myLeaveOf(sourcesOf(pilot), NOW)).balance).toEqual({
      allowanceDays: 20,
      usedDays: 0,
      balanceDays: 20,
    });
  });

  it('counts the UJ5 fixture through the same rule', () => {
    const record = rowOf('record-uj5', '2026-09-26', '2026-10-01');

    // Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno.
    expect(readyOf(myLeaveOf(sourcesOf(uj5, { records: rowsOf([record]) }), NOW)).balance).toEqual({
      allowanceDays: 20,
      usedDays: 3,
      balanceDays: 17,
    });
  });

  it("equals the admin card's figures for the same member, from the same reads", () => {
    for (const snapshot of [pilot, uj5]) {
      const rows = [WORKED, rowOf('record-later', '2026-10-05', '2026-10-08')];
      const mine = readyOf(myLeaveOf(sourcesOf(snapshot, { records: rowsOf(rows) }), NOW));
      const card = memberLeaveBaseOf(
        {
          members: MEMBERS,
          calendar: { snapshot, loading: false },
          organization: ORGANIZATION,
          records: {
            records: [
              { id: 'record-worked', from: '2026-09-10', to: '2026-09-14' },
              { id: 'record-later', from: '2026-10-05', to: '2026-10-07' },
            ],
            loading: false,
            refreshing: false,
          },
        },
        VIEWER_MEMBER,
        NOW,
      );

      if (card.kind !== LEAVE_READY) throw new Error(card.kind);

      expect(mine.balance).toEqual(card.balance);
    }
  });

  it('restores the balance when a record is removed: a removed record is never answered', () => {
    const before = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));
    const after = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([]) }), NOW));

    expect(before.balance.balanceDays).toBe(17);
    expect(after.balance.balanceDays).toBe(20);
  });

  it('counts only the dates inside the current leave year for a record crossing its start', () => {
    const organization: LeaveOrganizationSource = {
      ...ORGANIZATION,
      data: { ok: true, snapshot: { leaveYearStartMonth: 9, leaveYearStartDay: 12 } },
    };

    // From 12.09 the range holds Slobodno, Slobodno, Dan.
    expect(readyOf(myLeaveOf(sourcesOf(pilot, { organization, records: rowsOf([WORKED]) }), NOW)).balance).toEqual({
      allowanceDays: 20,
      usedDays: 1,
      balanceDays: 19,
    });
  });

  it('shows a negative balance as a number when the days used exceed the allowance', () => {
    const members = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 1 }] };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { members, records: rowsOf([WORKED]) }), NOW));

    expect(leave.balance).toEqual({ allowanceDays: 1, usedDays: 3, balanceDays: -2 });
    expect(t('count.days', { count: leave.balance.balanceDays })).toContain('−2 dana');
  });

  it("reads the viewer's own row out of an admin's whole member list", () => {
    const members = {
      ...MEMBERS,
      members: [
        { id: 'someone-else', leaveAllowanceDays: 30 },
        { id: VIEWER_MEMBER, leaveAllowanceDays: 20 },
      ],
    };

    expect(readyOf(myLeaveOf(sourcesOf(pilot, { members, records: rowsOf([WORKED]) }), NOW)).balance).toEqual({
      allowanceDays: 20,
      usedDays: 3,
      balanceDays: 17,
    });
  });
});

describe("what stands in the figures' place", () => {
  it.each([
    ['the member list', { members: { ...MEMBERS, loading: true, members: null } }],
    ['the calendar', { calendar: { snapshot: null, loading: true } }],
    ['the organization', { organization: { data: undefined, isPending: true, isError: false, fetchStatus: 'fetching' } }],
    ['the records', { records: { rows: null, loading: true } }],
  ] as const)('is loading while %s is', (_name, overrides) => {
    expect(myLeaveOf(sourcesOf(pilot, overrides), NOW)).toEqual({ kind: MY_LEAVE_LOADING });
  });

  it.each([
    ['the records read fails', { records: { rows: null, loading: false } }],
    ['the calendar read fails', { calendar: { snapshot: null, loading: false } }],
    [
      'the organization read fails',
      { organization: { data: undefined, isPending: false, isError: true, fetchStatus: 'idle' } },
    ],
    [
      'the organization answers a refusal',
      { organization: { data: { ok: false }, isPending: false, isError: false, fetchStatus: 'idle' } },
    ],
    ['the organization refetch is paused offline', { organization: { ...ORGANIZATION, fetchStatus: 'paused' } }],
    ['the member list is refused', { members: { members: null, refusal: 'MEMBERS_REFUSED', loading: false, paused: false } }],
    ['the member list refetch is paused offline', { members: { ...MEMBERS, paused: true } }],
    ["the member list holds no row of the viewer's", { members: { ...MEMBERS, members: [{ id: 'x', leaveAllowanceDays: 20 }] } }],
  ] as const)('is unavailable when %s', (_name, overrides) => {
    expect(myLeaveOf(sourcesOf(pilot, overrides), NOW)).toEqual({ kind: MY_LEAVE_UNAVAILABLE });
  });

  it('is unavailable over a failure even while another read is still loading', () => {
    expect(
      myLeaveOf(
        sourcesOf(pilot, { records: { rows: null, loading: false }, calendar: { snapshot: null, loading: true } }),
        NOW,
      ),
    ).toEqual({ kind: MY_LEAVE_UNAVAILABLE });
  });

  it.each([
    ["another member's row", [WORKED, rowOf('record-other', '2026-10-05', '2026-10-08', 'someone-else')]],
    ['a range that does not parse', [{ id: 'record-bad', member_id: VIEWER_MEMBER, during: 'empty' }]],
    ['a row with no id', [{ member_id: VIEWER_MEMBER, during: '[2026-09-10,2026-09-15)' }]],
    ['two rows sharing a date', [WORKED, rowOf('record-overlap', '2026-09-12', '2026-09-20')]],
  ] as const)('is unavailable, never a figure, when the records hold %s', (_name, rows) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(myLeaveOf(sourcesOf(pilot, { records: rowsOf(rows) }), NOW)).toEqual({ kind: MY_LEAVE_UNAVAILABLE });
  });

  it('is unavailable when the domain refuses what it is given (a RangeError)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const members = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 2.5 }] };

    expect(myLeaveOf(sourcesOf(pilot, { members }), NOW)).toEqual({ kind: MY_LEAVE_UNAVAILABLE });
    expect(error).toHaveBeenCalledWith(MY_LEAVE_UNAVAILABLE, expect.any(RangeError));
  });

  it('is unavailable, never a crashed render, when the computation throws anything else', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new TypeError('not a range');
    const snapshot = {
      ...pilot,
      get assignments(): never {
        throw failure;
      },
    } as CalendarSnapshot;

    expect(myLeaveOf(sourcesOf(snapshot), NOW)).toEqual({ kind: MY_LEAVE_UNAVAILABLE });
    expect(error).toHaveBeenCalledWith(MY_LEAVE_UNAVAILABLE, failure);
  });

  it('is unscheduled, with no figure, when the viewer has never been on a team', async () => {
    const teamless = await snapshotOf(PILOT, { viewers: [viewerRow([])] });

    expect(myLeaveOf(sourcesOf(teamless, { records: rowsOf([WORKED]) }), NOW)).toEqual({
      kind: MY_LEAVE_UNSCHEDULED,
    });
  });

  it("gives each its own line, the unscheduled one worded to the viewer and never the admin card's", () => {
    expect(myLeaveMessageKey(MY_LEAVE_UNSCHEDULED)).toBe('godisnji.unscheduled');
    expect(myLeaveMessageKey(MY_LEAVE_UNAVAILABLE)).toBe('godisnji.unavailable');
    expect(t('godisnji.unscheduled')).not.toBe(t('ljudi.leaveRecord.unscheduled'));
    expect(t('godisnji.unscheduled')).toContain('Za tebe');
  });
});

describe('the tiles', () => {
  it('are the allowance, the days used and the balance, in that order, each in whole days', () => {
    expect(myLeaveTilesOf({ allowanceDays: 20, usedDays: 3, balanceDays: 17 })).toEqual([
      { label: 'godisnji.allowance', days: 20 },
      { label: 'godisnji.used', days: 3 },
      { label: 'godisnji.balance', days: 17 },
    ]);
    expect(t('count.days', { count: 17 })).toBe('17 dana');
    expect(t('count.days', { count: 1 })).toBe('1 dan');
    expect(t('count.days', { count: 0 })).toBe('0 dana');
  });
});

describe("the own records' state", () => {
  it.each([
    ['answered', { isPending: false, isError: false, fetchStatus: 'idle', data: [WORKED] }, { rows: [WORKED], loading: false }],
    ['pending', { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined }, { rows: null, loading: true }],
    ['failed', { isPending: false, isError: true, fetchStatus: 'idle', data: undefined }, { rows: null, loading: false }],
    [
      'a failed refetch over cached rows',
      { isPending: false, isError: true, fetchStatus: 'idle', data: [WORKED] },
      { rows: null, loading: false },
    ],
    [
      'paused offline over cached rows',
      { isPending: false, isError: false, fetchStatus: 'paused', data: [WORKED] },
      { rows: null, loading: false },
    ],
  ] as const)('is %s', (_name, answer, state) => {
    expect(myLeaveRowsStateOf(answer)).toEqual(state);
  });
});
