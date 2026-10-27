import { leaveBalanceOf, leaveCostOf, leavePreviewOf } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf } from '@/features/calendar/utils/month';
import {
  LEAVE_PREVIEW_READY,
  LEAVE_PREVIEW_REASON,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_RANGE_UNCHANGED,
  LEAVE_READY,
  memberLeaveBaseOf,
  type LeaveMembersSource,
  type LeaveOrganizationSource,
} from '@/features/leave/services/leave-section';
import {
  REQUEST_APPROVED,
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_NOT_PENDING,
  REQUEST_OVERLAPS_LEAVE,
  REQUEST_OVERLAPS_REQUEST,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_WITHDRAWN,
} from '@/features/leave/services/leave-requests';
import {
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
  myLeaveRequestPreviewOf,
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

// ------------------------------------------------------------- story 9.3

describe('the balance input the figures stand on (story 9.3)', () => {
  it('is exposed with the figures, and is the very input they were computed over', () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));

    expect(leave.input).toEqual({
      input: memberScheduleInputOf(pilot, pilot.viewer),
      allowanceDays: 20,
      records: [{ id: 'record-worked', from: '2026-09-10', to: '2026-09-14' }],
      today: '2026-09-26',
      leaveYearStart: { month: 1, day: 1 },
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
    const state = myLeaveRequestPreviewOf(leave, '2026-10-05', '2026-10-07');

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview).toEqual(
      leavePreviewOf({ ...leave.input, range: { from: '2026-10-05', to: '2026-10-07' } }),
    );
    expect(state.preview.balanceAfterDays).toBe(17 - state.preview.costInYearDays);
  });

  it('never gates: over the balance it warns, and the preview still stands', () => {
    const members = { ...MEMBERS, members: [{ id: VIEWER_MEMBER, leaveAllowanceDays: 1 }] };
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { members }), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-10-01', '2026-10-20');

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview.exceedsBalance).toBe(true);
    expect(state.preview.balanceAfterDays).toBeLessThan(0);
  });

  it("warns, never refuses, over the viewer's own leave: the database decides", () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot, { records: rowsOf([WORKED]) }), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-09-12', '2026-09-16');

    expect(state?.kind).toBe(LEAVE_PREVIEW_READY);
    if (state?.kind === LEAVE_PREVIEW_READY) expect(state.preview.overlapsRecord).toBe(true);
  });

  it('states the in-year charge apart when the range crosses the leave year', () => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));
    const state = myLeaveRequestPreviewOf(leave, '2026-12-28', '2027-01-03');

    if (state?.kind !== LEAVE_PREVIEW_READY) throw new Error('no preview');

    expect(state.preview.costInYearDays).toBeLessThan(state.preview.costDays);
  });

  it.each([
    ['one date', '2026-10-05', '', LEAVE_RANGE_INCOMPLETE],
    ['a reversed range', '2026-10-07', '2026-10-05', LEAVE_RANGE_REVERSED],
    ['a range over 366 days', '2026-10-01', '2027-10-05', LEAVE_RANGE_TOO_LONG],
  ] as const)('is a reason, never a preview, for %s', (_name, from, to, reason) => {
    const leave = readyOf(myLeaveOf(sourcesOf(pilot), NOW));

    expect(myLeaveRequestPreviewOf(leave, from, to)).toMatchObject({ kind: LEAVE_PREVIEW_REASON, reason });
  });

  it('is nothing while the figures are not ready', () => {
    expect(myLeaveRequestPreviewOf({ kind: MY_LEAVE_LOADING }, '2026-10-05', '2026-10-07')).toBeNull();
    expect(myLeaveRequestPreviewOf({ kind: MY_LEAVE_UNSCHEDULED }, '2026-10-05', '2026-10-07')).toBeNull();
  });

  it("speaks each reason and refusal in the form's own words, never the admin card's", () => {
    expect(
      (
        [LEAVE_RANGE_INCOMPLETE, LEAVE_RANGE_REVERSED, LEAVE_RANGE_TOO_LONG, LEAVE_RANGE_REFUSED, LEAVE_RANGE_UNCHANGED] as const
      ).map((reason) => myLeaveRequestReasonMessageKey(reason)),
    ).toEqual([
      'godisnji.request.incomplete',
      'godisnji.request.reversed',
      'godisnji.request.tooLong',
      'godisnji.request.refused',
      'godisnji.request.refused',
    ]);
    expect(
      ([REQUEST_OVERLAPS_LEAVE, REQUEST_OVERLAPS_REQUEST, REQUEST_DENIED, REQUEST_FAILED] as const).map((code) =>
        myLeaveRequestSendMessageKey(code),
      ),
    ).toEqual([
      'godisnji.request.overlapsLeave',
      'godisnji.request.overlapsRequest',
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

  it("charges nothing: the viewer's balance is the same with pending requests as without", () => {
    const leave = ready();

    myLeaveRequestsOf(leave, rowsOf([requestRowOf('pending', '2026-10-05', '2026-10-08')]));

    expect(leave.balance).toEqual({ allowanceDays: 20, usedDays: 3, balanceDays: 17 });
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

    expect(viewer).toEqual({ memberId: VIEWER_MEMBER, timeZone: teamless.timeZone, input: null });
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
      ([REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED, REQUEST_WITHDRAWN] as const).map((status) =>
        myLeaveRequestClosedMessageKey(status),
      ),
    ).toEqual([null, 'godisnji.request.decidedOn', 'godisnji.request.decidedOn', 'godisnji.request.withdrawnOn']);
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
      ([REQUEST_PENDING, REQUEST_APPROVED, REQUEST_REJECTED, REQUEST_WITHDRAWN] as const).map((status) =>
        t(myLeaveRequestStatusMessageKey(status)),
      ),
    ).toEqual(['Čeka odluku', 'Odobren', 'Odbijen', 'Povučen']);
    expect(t('godisnji.request.empty')).toBe('Nemaš zahtjeva za godišnji.');
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
