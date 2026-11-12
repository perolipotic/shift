import { halfDayShiftOf, leaveBalanceOf, leaveCostOf, leavePreviewOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ANNUAL_LEAVE_ID } from '@/features/absence-types/services/list';
import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import {
  LEAVE_FROM_FIELD,
  LEAVE_HALF_FIELD,
  LEAVE_HALF_REFUSED,
  LEAVE_HALF_UNCHOSEN,
  LEAVE_PREVIEW_READY,
  LEAVE_PREVIEW_REASON,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_RANGE_UNCHANGED,
  LEAVE_READY,
  LEAVE_TYPE_FIELD,
  LEAVE_TYPE_UNCHOSEN,
  leaveHalfOptionsOf,
  memberLeaveBaseOf,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
} from '@/features/leave/services/leave-section';
import {
  REQUEST_APPROVED,
  REQUEST_CLOSED_ON_DEACTIVATION,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_WITHDRAWN,
} from '@/features/leave/services/leave-request-list';
import {
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_IN_PAST,
  REQUEST_NOT_PENDING,
  REQUEST_OVERLAPS_LEAVE,
  REQUEST_OVERLAPS_REQUEST,
  REQUEST_MEMBER_INACTIVE,
} from '@/features/leave/services/leave-request-write';
import {
  LEAVE_REQUEST_HALF_OPTIONS_FAILED,
  LEAVE_REQUEST_IN_PAST,
  LEAVE_REQUEST_SENT_STATE,
  MY_LEAVE_LOADING,
  MY_LEAVE_READY,
  MY_LEAVE_UNAVAILABLE,
  MY_LEAVE_UNSCHEDULED,
  MY_REQUESTS_LOADING,
  MY_REQUESTS_READY,
  MY_REQUESTS_UNAVAILABLE,
  leaveRequestSentOf,
  leaveRequestSentStepOf,
  leaveRequestSentValuesOf,
  myLeaveMessageKey,
  myLeaveRequestHalfOptionsOf,
  myLeaveRequestHalfPreviewOf,
  myLeaveRequestPreviewOf,
  myLeaveRequestEarliestOf,
  myLeaveRequestClosedMessageKey,
  myLeaveRequestReasonMessageKey,
  myLeaveRequestSendMessageKey,
  myLeaveRequestStatusMessageKey,
  myLeaveRequestWithdrawMessageKey,
  myLeaveRequestsOf,
  myLeaveRequestsViewerOf,
  withLeaveRequestSent,
  withoutLeaveRequestSent,
  myLeaveOf,
  myLeaveRowsStateOf,
  myLeaveTilesOf,
  type MyLeave,
  type MyLeaveRowsState,
  type MyLeaveSources,
} from '@/features/leave/services/my-leave';
import { initLocalization, t } from '@/lib/i18n';
import { nextIsoDate } from '@/lib/i18n/format';
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

/** Story 13.2: a record of annual leave, which draws down the allowance. */
const ANNUAL_RECORD = { absenceTypeId: ANNUAL_LEAVE_ID, drawsAllowance: true } as const;

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
  members: [{ id: VIEWER_MEMBER, leaveAllowance: { startingDays: 20, versions: [] } }],
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

    expect(leave.balance).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 17 });
    expect(leave.balance).toEqual(
      leaveBalanceOf({
        input: memberScheduleInputOf(pilot, pilot.viewer),
        allowance: { startingDays: 20, versions: [] },
        records: [{ from: '2026-09-10', to: '2026-09-14' }],
        today: '2026-09-26',
        leaveYearStart: { month: 1, day: 1 },
      }),
    );
  });

  it('charges only records whose type draws down the allowance (story 13.2): a non-drawing record is not used', () => {
    const sick = { ...rowOf('record-sick', '2026-10-05', '2026-10-09'), absence_type_id: 'sick-type', draws_allowance: false };
    const typed = { ...WORKED, absence_type_id: ANNUAL_LEAVE_ID, draws_allowance: true };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([typed, sick]) }), NOW));

    expect(leave.balance).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 17 });
  });

  it('is unavailable when a row carries a type it cannot trust (story 13.2)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { ...WORKED, absence_type_id: 'sick-type' };

    expect(myLeaveOf(sourcesOf(pilot, { records: rowsOf([broken]) }), NOW)).toEqual({ kind: MY_LEAVE_UNAVAILABLE });
  });

  it('shows 20 / 0 / 20 with no records', () => {
    expect(readyOf(myLeaveOf(sourcesOf(pilot), NOW)).balance).toEqual({
      allowanceDays: 20,
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
      usedDays: 0,
      balanceDays: 20,
    });
  });

  it('counts the UJ5 fixture through the same rule', () => {
    const record = rowOf('record-uj5', '2026-09-26', '2026-10-01');

    // Jutarnja, Popodnevna, Noćna, Slobodno, Slobodno.
    expect(readyOf(myLeaveOf(sourcesOf(uj5, { records: rowsOf([record]) }), NOW)).balance).toEqual({
      allowanceDays: 20,
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
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
              { ...ANNUAL_RECORD, id: 'record-worked', from: '2026-09-10', to: '2026-09-14' },
              { ...ANNUAL_RECORD, id: 'record-later', from: '2026-10-05', to: '2026-10-07' },
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
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
      usedDays: 1,
      balanceDays: 19,
    });
  });

  it('shows a negative balance as a number when the days used exceed the allowance', () => {
    const members = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowance: { startingDays: 1, versions: [] } }] };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { members, records: rowsOf([WORKED]) }), NOW));

    expect(leave.balance).toEqual({ allowanceDays: 1, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: -2 });
    expect(t('count.days', { count: leave.balance.balanceDays })).toContain('−2 dana');
  });

  it('balances against the allowance of the leave year it counts, not the starting one (story 13.3)', () => {
    // NOW is 2026-09-26: leave year 2026. Its later correction wins; 2027's does not apply yet.
    const members = {
      ...MEMBERS,
      members: [
        {
          id: VIEWER_MEMBER,
          leaveAllowance: {
            startingDays: 20,
            versions: [
              { id: 1, leaveYear: 2026, days: 25 },
              { id: 2, leaveYear: 2026, days: 24 },
              { id: 3, leaveYear: 2027, days: 40 },
            ],
          },
        },
      ],
    };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { members, records: rowsOf([WORKED]) }), NOW));

    expect(leave.balance).toEqual({ allowanceDays: 24, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 21 });
    // The request form's preview stands on the same input: the same resolved allowance.
    const state = myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07', ANNUAL_LEAVE_ID);

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview.allowanceDays).toBe(24);
    expect(leavePreviewOf({ ...leave.input, range: { from: '2026-10-05', to: '2026-10-07' } }).allowanceDays).toBe(24);
  });

  it("reads the viewer's own row out of an admin's whole member list", () => {
    const members = {
      ...MEMBERS,
      members: [
        { id: 'someone-else', leaveAllowance: { startingDays: 30, versions: [] } },
        { id: VIEWER_MEMBER, leaveAllowance: { startingDays: 20, versions: [] } },
      ],
    };

    expect(readyOf(myLeaveOf(sourcesOf(pilot, { members, records: rowsOf([WORKED]) }), NOW)).balance).toEqual({
      allowanceDays: 20,
      carriedDays: 0,
      lapsedDays: 0,
      carryOverExpiry: null,
      usedDays: 3,
      balanceDays: 17,
    });
  });
});

describe('carried days (story 13.4b)', () => {
  it('passes the organization’s setting into the input the figures and the request preview stand on', () => {
    const carryOver = { maxDays: 5, expiryMonth: 12, expiryDay: 31, firstLeaveYear: 2026 };
    const organization: LeaveOrganizationSource = {
      ...ORGANIZATION,
      data: { ok: true, snapshot: { leaveYearStartMonth: 1, leaveYearStartDay: 1, carryOver } },
    };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { organization, records: rowsOf([WORKED]) }), NOW));

    expect(leave.input.carryOver).toEqual(carryOver);
    expect(leave.balance).toEqual({
      allowanceDays: 20,
      carriedDays: 5,
      lapsedDays: 0,
      carryOverExpiry: '2026-12-31',
      usedDays: 3,
      balanceDays: 22,
    });
    expect(leave.balance).toEqual(leaveBalanceOf(leave.input));
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
    ["the member list holds no row of the viewer's", { members: { ...MEMBERS, members: [{ id: 'x', leaveAllowance: { startingDays: 20, versions: [] } }] } }],
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
    const members = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowance: { startingDays: 2.5, versions: [] } }] };

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
    expect(myLeaveTilesOf({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 17 })).toEqual([
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

// ------------------------------------------------------------- story 9.3

describe('the balance input the figures stand on (story 9.3)', () => {
  it('is exposed with the figures, and is the very input they were computed over', () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));

    expect(leave.input).toEqual({
      input: memberScheduleInputOf(pilot, pilot.viewer),
      allowance: { startingDays: 20, versions: [] },
      records: [{ ...ANNUAL_RECORD, id: 'record-worked', from: '2026-09-10', to: '2026-09-14' }],
      today: '2026-09-26',
      leaveYearStart: { month: 1, day: 1 },
      carryOver: null,
    });
    expect(leaveBalanceOf(leave.input)).toEqual(leave.balance);
    expect(leave.organizationId).toBe(pilot.organizationId);
    expect(leave.memberId).toBe(VIEWER_MEMBER);
    expect(leave.timeZone).toBe(pilot.timeZone);
  });
});

describe("the request form's preview (story 9.3)", () => {
  it("is the domain's preview over the figures' input: the cost and the balance after it", () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07', ANNUAL_LEAVE_ID);

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview).toEqual(
      leavePreviewOf({ ...leave.input, range: { from: '2026-10-05', to: '2026-10-07' } }),
    );
    expect(state.preview.balanceAfterDays).toBe(17 - state.preview.costInYearDays);
  });

  it('never gates: over the balance it warns, and the preview still stands', () => {
    const members = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowance: { startingDays: 1, versions: [] } }] };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { members }), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-10-01', '2026-10-20', ANNUAL_LEAVE_ID);

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview.exceedsBalance).toBe(true);
    expect(state.preview.balanceAfterDays).toBeLessThan(0);
  });

  it("warns, never refuses, over the viewer's own leave: the database decides", () => {
    const ahead = rowOf('record-ahead', '2026-10-12', '2026-10-17');
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED, ahead]) }), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-10-14', '2026-10-18', ANNUAL_LEAVE_ID);

    expect(state?.kind).toBe(LEAVE_PREVIEW_READY);
    if (state?.kind === LEAVE_PREVIEW_READY) expect(state.preview.overlapsRecord).toBe(true);
  });

  it('states the in-year charge apart when the range crosses the leave year', () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-12-28', '2027-01-03', ANNUAL_LEAVE_ID);

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview.costInYearDays).toBeLessThan(state.preview.costDays);
  });

  it.each([
    ['one date', '2026-10-05', '', LEAVE_RANGE_INCOMPLETE],
    ['a reversed range', '2026-10-07', '2026-10-05', LEAVE_RANGE_REVERSED],
    ['a range over 366 days', '2026-10-01', '2027-10-05', LEAVE_RANGE_TOO_LONG],
  ] as const)('is a reason, never a preview, for %s', (_name, from, to, reason) => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));

    expect(myLeaveRequestPreviewOf(leave, from, to, ANNUAL_LEAVE_ID)).toMatchObject({ kind: LEAVE_PREVIEW_REASON, reason });
  });

  it.each([
    ['a range that ended', '2026-09-10', '2026-09-14'],
    ['a range that started yesterday', '2026-09-25', '2026-09-30'],
    ['a past start with no end yet', '2026-09-25', ''],
    ['a past start after its end', '2026-09-25', '2026-09-20'],
  ] as const)('refuses %s on Od, before any other reason: past leave is an admin\'s to record (0047)', (_name, from, to) => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));

    expect(myLeaveRequestPreviewOf(leave, from, to, ANNUAL_LEAVE_ID)).toEqual({
      kind: LEAVE_PREVIEW_REASON,
      reason: LEAVE_REQUEST_IN_PAST,
      field: LEAVE_FROM_FIELD,
    });
  });

  it("takes a range starting on the organization's today, and offers it as the earliest date (0047)", () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));

    expect(myLeaveRequestPreviewOf(leave, '2026-09-26', '2026-09-28', ANNUAL_LEAVE_ID)?.kind).toBe(LEAVE_PREVIEW_READY);
    expect(myLeaveRequestEarliestOf(leave)).toBe('2026-09-26');
    expect(myLeaveRequestEarliestOf({ kind: MY_LEAVE_LOADING })).toBeNull();
  });

  // STORY 13.2b: the member chooses the type; nothing is preselected.
  it('is the unchosen-type reason on the type group until a type is chosen, after the past start', () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));

    expect(myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07', null)).toEqual({
      kind: LEAVE_PREVIEW_REASON,
      reason: LEAVE_TYPE_UNCHOSEN,
      field: LEAVE_TYPE_FIELD,
    });
    expect(myLeaveRequestReasonMessageKey(LEAVE_TYPE_UNCHOSEN)).toBe('godisnji.request.typeUnchosen');
    expect(myLeaveRequestPreviewOf(leave, '2026-09-25', '2026-09-28', null)).toMatchObject({ reason: LEAVE_REQUEST_IN_PAST });
  });

  it('previews a type that does not draw: its days, and the balance after it the balance now', () => {
    const sick = { id: 'type-sick', organizationId: pilot.organizationId, name: 'Bolovanje', drawsAllowance: false };
    const typed = { ...pilot, absenceTypes: [...(pilot.absenceTypes ?? []), sick] };
    const leave = readyOf(myLeaveOf(sourcesOf(typed, { records: rowsOf([WORKED]) }), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07', 'type-sick');

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(leave.absenceTypes?.map((type) => type.name)).toEqual(['Godišnji odmor', 'Bolovanje']);
    expect(state.type).toEqual({ id: 'type-sick', drawsAllowance: false });
    expect(state.preview.costDays).toBeGreaterThan(0);
    expect(state.preview.balanceAfterDays).toBe(leave.balance.balanceDays);
  });

  it('is nothing while the snapshot holds no type catalog (cached before 13.2), and the figures still stand', () => {
    const { absenceTypes: _types, ...cached } = pilot;
    const leave = readyOf(myLeaveOf(sourcesOf(cached as typeof pilot), NOW));

    expect(leave.absenceTypes).toBeNull();
    expect(leave.balance.allowanceDays).toBe(20);
    expect(myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07', ANNUAL_LEAVE_ID)).toBeNull();
    // An empty catalog offers no card: the same.
    expect(readyOf(myLeaveOf(sourcesOf({ ...pilot, absenceTypes: [] }), NOW)).absenceTypes).toBeNull();
  });

  it('is nothing while the figures are not ready', () => {
    expect(myLeaveRequestPreviewOf({ kind: MY_LEAVE_LOADING }, '2026-10-05', '2026-10-07', ANNUAL_LEAVE_ID)).toBeNull();
    expect(myLeaveRequestPreviewOf({ kind: MY_LEAVE_UNSCHEDULED }, '2026-10-05', '2026-10-07', ANNUAL_LEAVE_ID)).toBeNull();
  });

  // STORY 13.5b: the half day, through the admin dialog's rule and the domain's one cost.
  describe('the half day (story 13.5b)', () => {
    /** The first date from `from` on which the viewer's schedule holds exactly one working shift, or none. */
    function dateOf(leave: ReturnType<typeof readyOf>, working: boolean): string {
      for (let day = 1; day <= 28; day += 1) {
        const date = `2026-10-${String(day).padStart(2, '0')}`;

        if ((halfDayShiftOf(leave.input.input, date) !== null) === working) return date;
      }

      throw new Error('no such date');
    }

    it('costs a chosen half 0,5 through the domain, the range carrying its half, and the balance after it lower by 0.5', () => {
      const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));
      const date = dateOf(leave, true);
      const state = myLeaveRequestPreviewOf(leave, date, date, ANNUAL_LEAVE_ID, { on: true, half: 'FIRST' });

      if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

      expect(state.range).toEqual({ from: date, to: date, drawsAllowance: true, half: 'FIRST' });
      expect(state.preview.costDays).toBe(0.5);
      expect(state.preview).toEqual(leavePreviewOf({ ...leave.input, range: state.range }));
      expect(state.preview.balanceAfterDays).toBe(leave.balance.balanceDays - 0.5);
      expect(t('count.days', { count: state.preview.costDays })).toBe('0,5 dana');
    });

    it('is the unchosen-half reason on the half field while the switch is on and no card is chosen', () => {
      const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
      const date = dateOf(leave, true);

      expect(myLeaveRequestPreviewOf(leave, date, date, ANNUAL_LEAVE_ID, { on: true, half: null })).toEqual({
        kind: LEAVE_PREVIEW_REASON,
        reason: LEAVE_HALF_UNCHOSEN,
        field: LEAVE_HALF_FIELD,
      });
      expect(myLeaveRequestReasonMessageKey(LEAVE_HALF_UNCHOSEN)).toBe('godisnji.request.halfUnchosen');
    });

    it("refuses a half on a date without exactly one working shift, in the member's own words", () => {
      const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
      const date = dateOf(leave, false);

      for (const half of ['FIRST', null] as const) {
        expect(myLeaveRequestPreviewOf(leave, date, date, ANNUAL_LEAVE_ID, { on: true, half })).toEqual({
          kind: LEAVE_PREVIEW_REASON,
          reason: LEAVE_HALF_REFUSED,
          field: LEAVE_HALF_FIELD,
        });
      }
      expect(myLeaveRequestReasonMessageKey(LEAVE_HALF_REFUSED)).toBe('godisnji.request.halfRefused');
      expect(t('godisnji.request.halfRefused')).toBe('Taj dan nemaš točno jednu radnu smjenu.');
      expect(leaveHalfOptionsOf(pilot, leave.input.input, date)).toBeNull();
    });

    it('offers two cards with times on a date with one working shift', () => {
      const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
      const options = leaveHalfOptionsOf(pilot, leave.input.input, dateOf(leave, true));

      expect(options?.map((option) => option.half)).toEqual(['FIRST', 'SECOND']);
      expect(options?.every((option) => option.times !== null)).toBe(true);
    });

    it('draws the cards only while offered and on, and refuses the half day when they cannot be drawn', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
      const date = dateOf(leave, true);
      const on = { on: true, half: null } as const;

      expect(myLeaveRequestHalfOptionsOf(leave, pilot, date, date, on)).toEqual(leaveHalfOptionsOf(pilot, leave.input.input, date));
      expect(myLeaveRequestHalfOptionsOf(leave, pilot, date, date, { on: false, half: null })).toBeNull();
      expect(myLeaveRequestHalfOptionsOf(leave, pilot, date, '2026-10-28', on)).toBeNull();
      expect(myLeaveRequestHalfOptionsOf(leave, null, date, date, on)).toBeNull();
      expect(myLeaveRequestHalfOptionsOf({ kind: MY_LEAVE_LOADING }, pilot, date, date, on)).toBeNull();

      // A snapshot the domain refuses (a shift type version with no minutes): no card can be drawn.
      const broken = {
        ...pilot,
        types: pilot.types.map((type) => ({
          ...type,
          versions: type.versions.map((version) => ({ ...version, startMinute: Number.NaN, endMinute: Number.NaN })),
        })),
      };
      const failed = myLeaveRequestHalfOptionsOf(leave, broken, date, date, on);

      expect(failed).toBe(LEAVE_REQUEST_HALF_OPTIONS_FAILED);
      expect(error).toHaveBeenCalled();
      // Then the reason is the refusal on the half field, never "choose a half" with no card to choose.
      const unchosen = myLeaveRequestPreviewOf(leave, date, date, ANNUAL_LEAVE_ID, on);

      expect(unchosen).toMatchObject({ reason: LEAVE_HALF_UNCHOSEN });
      expect(myLeaveRequestHalfPreviewOf(unchosen, failed)).toEqual({
        kind: LEAVE_PREVIEW_REASON,
        reason: LEAVE_HALF_REFUSED,
        field: LEAVE_HALF_FIELD,
      });
      expect(myLeaveRequestHalfPreviewOf(unchosen, null)).toBe(unchosen);
      expect(myLeaveRequestHalfPreviewOf(null, failed)).toBeNull();
    });

    it('ignores the half over more than one date: a whole-day range, costed as one', () => {
      const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
      const state = myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07', ANNUAL_LEAVE_ID, { on: true, half: 'SECOND' });

      if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

      expect(state.range).not.toHaveProperty('half');
      expect(state.preview.costDays).toBe(leaveCostOf(leave.input.input, '2026-10-05', '2026-10-07'));
    });

    it('leaves a whole day as before when the switch is off', () => {
      const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
      const date = dateOf(leave, true);

      expect(myLeaveRequestPreviewOf(leave, date, date, ANNUAL_LEAVE_ID, { on: false, half: null })).toEqual(
        myLeaveRequestPreviewOf(leave, date, date, ANNUAL_LEAVE_ID),
      );
    });
  });

  it("speaks each reason and refusal in the form's own words, never the admin card's", () => {
    expect(
      (
        [
          LEAVE_RANGE_INCOMPLETE,
          LEAVE_RANGE_REVERSED,
          LEAVE_RANGE_TOO_LONG,
          LEAVE_RANGE_REFUSED,
          LEAVE_RANGE_UNCHANGED,
          LEAVE_HALF_UNCHOSEN,
          LEAVE_HALF_REFUSED,
        ] as const
      ).map((reason) => myLeaveRequestReasonMessageKey(reason)),
    ).toEqual([
      'godisnji.request.incomplete',
      'godisnji.request.reversed',
      'godisnji.request.tooLong',
      'godisnji.request.refused',
      'godisnji.request.refused',
      'godisnji.request.halfUnchosen',
      'godisnji.request.halfRefused',
    ]);
    // STORY 13.5b: never the admin dialog's third-person words.
    expect(t('godisnji.request.halfUnchosen')).not.toBe(t('ljudi.leaveRecord.halfUnchosen'));
    expect(t('godisnji.request.halfRefused')).not.toBe(t('ljudi.leaveRecord.halfRefused'));
    expect(myLeaveRequestReasonMessageKey(LEAVE_REQUEST_IN_PAST)).toBe('godisnji.request.inPastReason');
    expect(
      (
        [
          REQUEST_OVERLAPS_LEAVE,
          REQUEST_OVERLAPS_REQUEST,
          REQUEST_MEMBER_INACTIVE,
          REQUEST_IN_PAST,
          REQUEST_DENIED,
          REQUEST_FAILED,
        ] as const
      ).map((code) => myLeaveRequestSendMessageKey(code)),
    ).toEqual([
      'godisnji.request.overlapsLeave',
      'godisnji.request.overlapsRequest',
      'godisnji.request.memberInactive',
      'godisnji.request.inPast',
      'godisnji.request.denied',
      'godisnji.request.failed',
    ]);
    expect(
      ([REQUEST_NOT_PENDING, REQUEST_DENIED, REQUEST_FAILED] as const).map((code) => myLeaveRequestWithdrawMessageKey(code)),
    ).toEqual([
      'godisnji.request.withdrawNotPending',
      'godisnji.request.withdrawDenied',
      'godisnji.request.withdrawFailed',
    ]);
    expect(t('godisnji.request.overlapsLeave')).not.toBe(t('godisnji.request.overlapsRequest'));
    expect(t('godisnji.request.memberInactive')).toBe('Zahtjev nije poslan: u tom rasponu tvoj status je neaktivan.');
  });
});

describe("Godišnji's list of the viewer's requests (story 9.3)", () => {
  function requestRowOf(
    id: string,
    from: string,
    toExclusive: string,
    { closedAt = null as string | null, decisions = [] as unknown[], memberId = VIEWER_MEMBER } = {},
  ) {
    return { id, member_id: memberId, during: `[${from},${toExclusive})`, closed_at: closedAt, leave_request_decisions: decisions };
  }

  const ready = () => readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));

  it('lists every request soonest first, with its cost, status word and closing date', () => {
    const list = myLeaveRequestsOf(
      ready(),
      rowsOf([
        requestRowOf('withdrawn', '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T22:30:00Z' }),
        requestRowOf('pending', '2026-10-05', '2026-10-08'),
        requestRowOf('approved', '2026-10-12', '2026-10-13', {
          closedAt: '2026-10-01T08:00:00Z',
          decisions: [{ outcome: 'approved' }],
        }),
      ]),
    );

    if (list.kind !== MY_REQUESTS_READY) throw new Error(list.kind);

    expect(list.rows.map((row) => [row.request.id, row.request.status, row.withdrawable])).toEqual([
      ['pending', REQUEST_PENDING, true],
      ['approved', REQUEST_APPROVED, false],
      ['withdrawn', REQUEST_WITHDRAWN, false],
    ]);
    expect(list.rows[0]).toMatchObject({
      from: '05.10.2026',
      to: '07.10.2026',
      label: '05.10.2026–07.10.2026',
      costDays: leaveCostOf(memberScheduleInputOf(pilot, pilot.viewer), '2026-10-05', '2026-10-07'),
      closedOn: null,
    });
    // 22:30 UTC on 20.10 is the 21st in Zagreb: the organization's date.
    expect(list.rows[2]?.closedOn).toBe('21.10.2026');
  });

  // STORY 13.2b: the viewer sees the type of each of their own requests.
  it('names the type of each request, annual leave for a row read before 0054, and is unavailable for one it cannot name', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sick = { id: 'type-sick', organizationId: pilot.organizationId, name: 'Bolovanje', drawsAllowance: false };
    const viewer = { ...ready(), absenceTypes: [...(pilot.absenceTypes ?? []), sick] };
    const list = myLeaveRequestsOf(
      viewer,
      rowsOf([
        { ...requestRowOf('sick', '2026-10-05', '2026-10-08'), absence_type_id: 'type-sick' },
        requestRowOf('old', '2026-10-12', '2026-10-13'),
      ]),
    );

    if (list.kind !== MY_REQUESTS_READY) throw new Error(list.kind);

    expect(list.rows.map((row) => [row.request.id, row.request.absenceTypeId, row.typeName])).toEqual([
      ['sick', 'type-sick', 'Bolovanje'],
      ['old', ANNUAL_LEAVE_ID, 'Godišnji odmor'],
    ]);
    expect(
      myLeaveRequestsOf(ready(), rowsOf([{ ...requestRowOf('unknown', '2026-10-05', '2026-10-08'), absence_type_id: 'type-gone' }])),
    ).toEqual({ kind: MY_REQUESTS_UNAVAILABLE });
    expect(
      myLeaveRequestsOf(ready(), rowsOf([{ ...requestRowOf('bad', '2026-10-05', '2026-10-08'), absence_type_id: 7 }])),
    ).toEqual({ kind: MY_REQUESTS_UNAVAILABLE });
    expect(
      myLeaveRequestsOf({ ...ready(), absenceTypes: null }, rowsOf([requestRowOf('old', '2026-10-12', '2026-10-13')])),
    ).toEqual({ kind: MY_REQUESTS_UNAVAILABLE });
  });

  // STORY 13.5b: a half-day request costs 0.5 through the domain's one rule.
  it('costs a half-day request half a day, and an old row without the column a whole day', () => {
    const leave = ready();
    let date = '';

    for (let day = 1; day <= 28 && date === ''; day += 1) {
      const candidate = `2026-10-${String(day).padStart(2, '0')}`;

      if (halfDayShiftOf(leave.input.input, candidate) !== null) date = candidate;
    }

    const upper = nextIsoDate(date) ?? date;
    const list = myLeaveRequestsOf(
      leave,
      rowsOf([{ ...requestRowOf('half', date, upper), half: 'FIRST' }, requestRowOf('whole', date, upper, { closedAt: '2026-10-01T08:00:00Z' })]),
    );

    if (list.kind !== MY_REQUESTS_READY) throw new Error(list.kind);

    expect(list.rows.map((row) => [row.request.id, row.request.half ?? null, row.costDays])).toEqual(
      expect.arrayContaining([
        ['half', 'FIRST', 0.5],
        ['whole', null, 1],
      ]),
    );
  });

  it("charges nothing: the viewer's balance is the same with pending requests as without", () => {
    const leave = ready();

    myLeaveRequestsOf(leave, rowsOf([requestRowOf('pending', '2026-10-05', '2026-10-08')]));

    expect(leave.balance).toEqual({ allowanceDays: 20, carriedDays: 0, lapsedDays: 0, carryOverExpiry: null, usedDays: 3, balanceDays: 17 });
    expect(leave.input.records).toHaveLength(1);
  });

  it('is empty, loading or unavailable as its read is', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(myLeaveRequestsOf(ready(), rowsOf([]))).toEqual({ kind: MY_REQUESTS_READY, rows: [] });
    expect(myLeaveRequestsOf(ready(), { rows: null, loading: true })).toEqual({ kind: MY_REQUESTS_LOADING });
    expect(myLeaveRequestsOf(ready(), { rows: null, loading: false })).toEqual({ kind: MY_REQUESTS_UNAVAILABLE });
    expect(
      myLeaveRequestsOf(ready(), rowsOf([requestRowOf('other', '2026-10-05', '2026-10-08', { memberId: 'someone-else' })])),
    ).toEqual({ kind: MY_REQUESTS_UNAVAILABLE });
  });

  it("stands on the requests read alone: an unscheduled member's list is drawn, each row without its cost", async () => {
    const teamless = await snapshotOf(PILOT, { viewers: [viewerRow([])] });
    const leave = myLeaveOf(sourcesOf(teamless), NOW);

    expect(leave.kind).toBe(MY_LEAVE_UNSCHEDULED);

    const viewer = myLeaveRequestsViewerOf(teamless, leave);
    const list = myLeaveRequestsOf(viewer, rowsOf([requestRowOf('pending', '2026-10-05', '2026-10-08')]));

    expect(viewer).toEqual({
      memberId: VIEWER_MEMBER,
      timeZone: teamless.timeZone,
      input: null,
      absenceTypes: teamless.absenceTypes,
    });
    if (list.kind !== MY_REQUESTS_READY) throw new Error(list.kind);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ costDays: null, withdrawable: true, label: '05.10.2026–07.10.2026' });
  });

  it('is drawn while the figures are unavailable too, and costs a row once they are ready', () => {
    const unavailable = myLeaveRequestsViewerOf(pilot, { kind: MY_LEAVE_UNAVAILABLE });
    const rows = rowsOf([requestRowOf('pending', '2026-10-05', '2026-10-08')]);
    const without = myLeaveRequestsOf(unavailable, rows);
    const withCost = myLeaveRequestsOf(myLeaveRequestsViewerOf(pilot, ready()), rows);

    if (without.kind !== MY_REQUESTS_READY || withCost.kind !== MY_REQUESTS_READY) throw new Error('not ready');
    expect(without.rows[0]?.costDays).toBeNull();
    expect(withCost.rows[0]?.costDays).not.toBeNull();
  });

  it('words the closing date by status: decided, or withdrawn; none while pending', () => {
    expect(
      ([REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED, REQUEST_WITHDRAWN, REQUEST_CLOSED_ON_DEACTIVATION] as const).map(
        (status) => myLeaveRequestClosedMessageKey(status),
      ),
    ).toEqual([
      null,
      'godisnji.request.decidedOn',
      'godisnji.request.decidedOn',
      'godisnji.request.withdrawnOn',
      'godisnji.request.closedOn',
    ]);
    expect(t('godisnji.request.closedOn', { date: '21.10.2026' })).toBe('Zatvoreno 21.10.2026');
    expect(t('godisnji.request.decidedOn', { date: '21.10.2026' })).toBe('Odlučeno 21.10.2026');
    expect(t('godisnji.request.withdrawnOn', { date: '21.10.2026' })).toBe('Povučeno 21.10.2026');
  });

  it("names a refused withdrawal's range", () => {
    expect(t(myLeaveRequestWithdrawMessageKey(REQUEST_NOT_PENDING), { from: '05.10.2026', to: '07.10.2026' })).toBe(
      'Zahtjev 05.10.2026–07.10.2026 više ne čeka odluku.',
    );
  });

  it('says each status as its own word', () => {
    expect(
      ([REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED, REQUEST_WITHDRAWN, REQUEST_CLOSED_ON_DEACTIVATION] as const).map(
        (status) => t(myLeaveRequestStatusMessageKey(status)),
      ),
    ).toEqual(['Čeka odluku', 'Odobren', 'Odbijen', 'Povučen', 'Zatvoren deaktivacijom']);
    expect(t('godisnji.request.empty')).toBe('Nemaš zahtjeva za odsutnost.');
  });
});

describe("the sent line's hand-over (story 9.3)", () => {
  const sent = { from: '2026-10-05', to: '2026-10-07' };

  it('rides the history entry and keeps every other field', () => {
    const state = withLeaveRequestSent({ key: 'router' }, sent);

    expect(state).toEqual({ key: 'router', [LEAVE_REQUEST_SENT_STATE]: sent });
    expect(leaveRequestSentOf(state)).toEqual(sent);
    expect(withoutLeaveRequestSent(state)).toEqual({ key: 'router' });
    expect(leaveRequestSentValuesOf(sent)).toEqual({ from: '05.10.2026', to: '07.10.2026' });
  });

  it('reads nothing malformed', () => {
    expect(leaveRequestSentOf(null)).toBeNull();
    expect(leaveRequestSentOf({ [LEAVE_REQUEST_SENT_STATE]: { from: 'x', to: '2026-10-07' } })).toBeNull();
  });

  it('shows on the location that brings it and clears it, keeps through the clearing, and drops after', () => {
    const arrived = leaveRequestSentStepOf(null, withLeaveRequestSent({}, sent), false);

    expect(arrived).toEqual({ shown: sent, clear: true, clearing: true });
    expect(leaveRequestSentStepOf(sent, {}, true)).toEqual({ shown: sent, clear: false, clearing: false });
    expect(leaveRequestSentStepOf(sent, {}, false)).toEqual({ shown: null, clear: false, clearing: false });
  });
});
