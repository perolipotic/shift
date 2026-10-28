import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DECIDE_LEAVE_REQUEST_FUNCTION,
  LEAVE_REQUEST_COLUMNS,
  LEAVE_REQUEST_KEY,
  REQUEST_APPROVAL_STALE,
  decideLeaveRequest,
  leaveRequestDecideFailureOf,
  ORGANIZATION_LEAVE_REQUESTS_KEY,
  leaveRequestFoundOf,
  leaveRequestQueryOptions,
  organizationLeaveRequestsOf,
  organizationLeaveRequestsQueryOptions,
  readOrganizationLeaveRequestRows,
  type OrganizationLeaveRequestsTable,
  readLeaveRequestRows,
  type DecideLeaveRequestRpc,
  LEAVE_REQUESTS_COLUMNS,
  LEAVE_REQUESTS_UNAVAILABLE,
  MY_LEAVE_REQUESTS_KEY,
  REQUEST_APPROVED,
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_NOT_PENDING,
  REQUEST_OVERLAPS_LEAVE,
  REQUEST_OVERLAPS_REQUEST,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_WITHDRAWN,
  WITHDRAW_LEAVE_REQUEST_FUNCTION,
  leaveRequestSendFailureOf,
  leaveRequestStatusOf,
  leaveRequestWithdrawFailureOf,
  leaveRequestsOf,
  myLeaveRequestsQueryOptions,
  readMyLeaveRequestRows,
  sendLeaveRequest,
  withdrawLeaveRequest,
  type LeaveRequestInsertTable,
  type LeaveRequestsTable,
  type WithdrawLeaveRequestRpc,
} from '@/features/leave/services/leave-requests';

/** Story 9.3: the 0040 boundary of a member's own requests, executed (AD-15). */

const MEMBER = 'member-1';
const ORGANIZATION = 'organization-1';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A row as the select answers it: the range canonical, its upper bound exclusive. */
function rowOf(
  id: string,
  from: string,
  toExclusive: string,
  { closedAt = null as string | null, decisions = [] as unknown, memberId = MEMBER } = {},
) {
  return {
    id,
    member_id: memberId,
    during: `[${from},${toExclusive})`,
    closed_at: closedAt,
    leave_request_decisions: decisions,
  };
}

describe('the status, derived as 0040 stores it', () => {
  it.each([
    ['pending while closed_at is null', null, [], REQUEST_PENDING],
    ['approved by its decision', '2026-10-20T08:00:00Z', [{ outcome: 'approved' }], REQUEST_APPROVED],
    ['rejected by its decision', '2026-10-20T08:00:00Z', [{ outcome: 'rejected' }], REQUEST_REJECTED],
    ['withdrawn when closed with no decision', '2026-10-20T08:00:00Z', [], REQUEST_WITHDRAWN],
    ['approved from a one-to-one embed', '2026-10-20T08:00:00Z', { outcome: 'approved' }, REQUEST_APPROVED],
    ['withdrawn from a null one-to-one embed', '2026-10-20T08:00:00Z', null, REQUEST_WITHDRAWN],
  ] as const)('is %s', (_name, closedAt, decisions, status) => {
    expect(leaveRequestStatusOf(closedAt, decisions)).toBe(status);
  });

  it.each([
    ['a pending request with a decision', null, [{ outcome: 'approved' }]],
    ['two decisions', '2026-10-20T08:00:00Z', [{ outcome: 'approved' }, { outcome: 'rejected' }]],
    ['an unknown outcome', '2026-10-20T08:00:00Z', [{ outcome: 'maybe' }]],
    ['a closed_at that is no text', 42, []],
  ] as const)('cannot be said of %s', (_name, closedAt, decisions) => {
    expect(leaveRequestStatusOf(closedAt, decisions)).toBeNull();
  });
});

describe("the viewer's own requests", () => {
  it('are parsed and sorted by the range start, soonest first, the inclusive last date restored', () => {
    const rows = [
      rowOf('later', '2026-11-02', '2026-11-05'),
      rowOf('sooner', '2026-10-28', '2026-10-31', { closedAt: '2026-10-20T08:00:00Z', decisions: [{ outcome: 'rejected' }] }),
    ];

    expect(leaveRequestsOf(rows, MEMBER)).toEqual([
      { id: 'sooner', from: '2026-10-28', to: '2026-10-30', status: REQUEST_REJECTED, closedAt: '2026-10-20T08:00:00Z' },
      { id: 'later', from: '2026-11-02', to: '2026-11-04', status: REQUEST_PENDING, closedAt: null },
    ]);
  });

  it('keep two closed requests over the same dates, which 0040 allows, in a stable order', () => {
    const rows = [
      rowOf('b', '2026-11-02', '2026-11-05', { closedAt: '2026-10-21T08:00:00Z' }),
      rowOf('a', '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T08:00:00Z' }),
    ];

    expect(leaveRequestsOf(rows, MEMBER)?.map((request) => request.id)).toEqual(['a', 'b']);
  });

  it.each([
    ["another member's row", [rowOf('x', '2026-11-02', '2026-11-05', { memberId: 'someone-else' })]],
    ['a row with no id', [{ ...rowOf('x', '2026-11-02', '2026-11-05'), id: '' }]],
    ['two rows with one id', [rowOf('x', '2026-11-02', '2026-11-05'), rowOf('x', '2026-12-02', '2026-12-05')]],
    ['a range that does not parse', [{ ...rowOf('x', '2026-11-02', '2026-11-05'), during: 'empty' }]],
    ['a status that cannot be derived', [rowOf('x', '2026-11-02', '2026-11-05', { decisions: [{ outcome: 'approved' }] })]],
    ['a row that is no object', [null]],
  ] as const)('are none at all when the rows hold %s', (_name, rows) => {
    expect(leaveRequestsOf(rows, MEMBER)).toBeNull();
  });
});

describe('the read', () => {
  function tableAnswering(answer: unknown): LeaveRequestsTable & { calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      select: (named) => ({
        eq: (column, value) => {
          calls.push([named, column, value]);

          return Promise.resolve(answer) as never;
        },
      }),
    };
  }

  it("selects the request columns and the embedded decision, filtered to the viewer's own member row, under its own key", async () => {
    const table = tableAnswering({ data: [rowOf('x', '2026-11-02', '2026-11-05')], error: null });

    expect(await readMyLeaveRequestRows(table, MEMBER)).toEqual({ ok: true, rows: [rowOf('x', '2026-11-02', '2026-11-05')] });
    expect(table.calls).toEqual([[LEAVE_REQUESTS_COLUMNS, 'member_id', MEMBER]]);
    expect(LEAVE_REQUESTS_COLUMNS).toContain('leave_request_decisions(outcome)');
    expect(myLeaveRequestsQueryOptions(() => table, MEMBER).queryKey).toEqual(MY_LEAVE_REQUESTS_KEY);
  });

  it('waits for the snapshot to name the viewer', () => {
    expect(myLeaveRequestsQueryOptions(() => tableAnswering(null), null).enabled).toBe(false);
    expect(myLeaveRequestsQueryOptions(() => tableAnswering(null), MEMBER).enabled).toBe(true);
  });

  it.each([
    ['an error', { data: null, error: { code: '42501' } }],
    ['no error key at all, as a malformed answer', { data: [] }],
    ['no list', { data: {}, error: null }],
    ['no answer', null],
  ] as const)('is unavailable on %s', async (_name, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readMyLeaveRequestRows(tableAnswering(answer), MEMBER)).toEqual({
      ok: false,
      code: LEAVE_REQUESTS_UNAVAILABLE,
    });
  });

  it('is unavailable when the call throws, and the query rejects with the code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table: LeaveRequestsTable = { select: () => ({ eq: () => Promise.reject(new Error('network')) }) };
    const options = myLeaveRequestsQueryOptions(() => table, MEMBER);

    expect(await readMyLeaveRequestRows(table, MEMBER)).toEqual({ ok: false, code: LEAVE_REQUESTS_UNAVAILABLE });
    await expect((options.queryFn as () => Promise<unknown>)()).rejects.toThrow(LEAVE_REQUESTS_UNAVAILABLE);
  });
});

describe('the send', () => {
  function insertAnswering(answer: unknown): LeaveRequestInsertTable & { sent: unknown[] } {
    const sent: unknown[] = [];

    return {
      sent,
      insert: (values) => {
        sent.push(values);

        return Promise.resolve(answer) as never;
      },
    };
  }

  it('inserts the three facts, the range as an inclusive daterange literal, the ids as given', async () => {
    const table = insertAnswering({ error: null });

    expect(await sendLeaveRequest(table, ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({ ok: true });
    expect(table.sent).toEqual([{ organization_id: ORGANIZATION, member_id: MEMBER, during: '[2026-11-02,2026-11-04]' }]);
  });

  it.each([
    ['an overlap with live leave', { code: '23P01', message: 'LEAVE_REQUEST_OVERLAPS_LEAVE' }, REQUEST_OVERLAPS_LEAVE],
    ['an overlap with a pending request', { code: '23P01', message: 'conflicting key value violates exclusion constraint' }, REQUEST_OVERLAPS_REQUEST],
    ['a refusal', { code: '42501', message: 'new row violates row-level security policy' }, REQUEST_DENIED],
    ['a check', { code: '23514', message: 'leave_requests_during_at_most_366_days' }, REQUEST_FAILED],
  ] as const)('maps %s by SQLSTATE and message', async (_name, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestSendFailureOf(error)).toBe(code);
    expect(await sendLeaveRequest(insertAnswering({ error }), ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code,
    });
  });

  it.each([
    ['a date that is no calendar date', '2026-02-30', '2026-03-02'],
    ['a reversed range', '2026-11-04', '2026-11-02'],
  ])('sends nothing for %s', async (_name, from, to) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = insertAnswering({ error: null });

    expect(await sendLeaveRequest(table, ORGANIZATION, MEMBER, from, to)).toEqual({ ok: false, code: REQUEST_FAILED });
    expect(table.sent).toEqual([]);
  });

  it("fails on an answer with no error key, as leave-write's answeredErrorOf reads one", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await sendLeaveRequest(insertAnswering({}), ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
  });

  it('fails, never throws, when the call throws or answers nothing it can read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing: LeaveRequestInsertTable = { insert: () => Promise.reject(new Error('network')) };

    expect(await sendLeaveRequest(throwing, ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
    expect(await sendLeaveRequest(insertAnswering(null), ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
  });
});

describe('the withdrawal', () => {
  function rpcAnswering(answer: unknown): WithdrawLeaveRequestRpc & { calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      rpc: (fn, args) => {
        calls.push([fn, args]);

        return Promise.resolve(answer) as never;
      },
    };
  }

  it("calls 0040's definer with the request's id", async () => {
    const client = rpcAnswering({ error: null });

    expect(await withdrawLeaveRequest(client, 'request-1')).toEqual({ ok: true });
    expect(client.calls).toEqual([[WITHDRAW_LEAVE_REQUEST_FUNCTION, { p_request_id: 'request-1' }]]);
  });

  it.each([
    ['no longer pending', { code: 'P0002', message: 'LEAVE_REQUEST_NOT_PENDING' }, REQUEST_NOT_PENDING],
    ['not allowed', { code: '42501', message: 'LEAVE_REQUEST_WITHDRAWAL_REFUSED' }, REQUEST_DENIED],
    ['anything else', { code: '22P02', message: 'invalid input syntax for type uuid' }, REQUEST_FAILED],
  ] as const)('maps %s', async (_name, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestWithdrawFailureOf(error)).toBe(code);
    expect(await withdrawLeaveRequest(rpcAnswering({ error }), 'request-1')).toEqual({ ok: false, code });
  });

  it('fails, never throws, when the call throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client: WithdrawLeaveRequestRpc = { rpc: () => Promise.reject(new Error('network')) };

    expect(await withdrawLeaveRequest(client, 'request-1')).toEqual({ ok: false, code: REQUEST_FAILED });
  });
});

describe('one request by its id (story 9.4)', () => {
  const REQUEST = '11111111-1111-4111-8111-111111111111';
  const decided = (outcome: string) => [{ outcome, decided_by: 'admin-auth', decided_at: '2026-10-20T08:15:00Z' }];

  it('is missing with no row, and the request with its member and range with one, no member filter applied', () => {
    expect(leaveRequestFoundOf([], REQUEST)).toEqual({ request: null });
    expect(leaveRequestFoundOf([rowOf(REQUEST, '2026-11-02', '2026-11-05', { memberId: 'member-2' })], REQUEST)).toEqual({
      request: {
        id: REQUEST,
        memberId: 'member-2',
        from: '2026-11-02',
        to: '2026-11-04',
        status: REQUEST_PENDING,
        closedAt: null,
        decision: null,
        createdAt: null,
      },
    });
    // Story 9.5: when it was sent, once the read answers it; anything that is not an instant cannot be trusted.
    const sent = { ...rowOf(REQUEST, '2026-11-02', '2026-11-05'), created_at: '2026-10-19T07:00:00+00:00' };

    expect(leaveRequestFoundOf([sent], REQUEST)?.request?.createdAt).toBe('2026-10-19T07:00:00+00:00');
    expect(leaveRequestFoundOf([{ ...sent, created_at: 'never' }], REQUEST)).toBeNull();
    expect(LEAVE_REQUEST_COLUMNS).toContain('created_at');
  });

  it('carries who decided and when for an approved or rejected request, as a list or as one object', () => {
    const approved = leaveRequestFoundOf(
      [rowOf(REQUEST, '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T08:15:00Z', decisions: decided('approved') })],
      REQUEST,
    );

    expect(approved?.request?.status).toBe(REQUEST_APPROVED);
    expect(approved?.request?.decision).toEqual({
      outcome: REQUEST_APPROVED,
      decidedBy: 'admin-auth',
      decidedAt: '2026-10-20T08:15:00Z',
    });

    const rejected = leaveRequestFoundOf(
      [rowOf(REQUEST, '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T08:15:00Z', decisions: decided('rejected')[0] })],
      REQUEST,
    );

    expect(rejected?.request?.decision?.outcome).toBe(REQUEST_REJECTED);
  });

  it('carries no decision for a withdrawn request, only its closing instant', () => {
    const found = leaveRequestFoundOf([rowOf(REQUEST, '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T08:15:00Z' })], REQUEST);

    expect(found?.request?.status).toBe(REQUEST_WITHDRAWN);
    expect(found?.request?.decision).toBeNull();
    expect(found?.request?.closedAt).toBe('2026-10-20T08:15:00Z');
  });

  it.each([
    ['two rows', [rowOf(REQUEST, '2026-11-02', '2026-11-05'), rowOf(REQUEST, '2026-11-02', '2026-11-05')]],
    ['a row of another id', [rowOf('other', '2026-11-02', '2026-11-05')]],
    ['a range that does not parse', [{ ...rowOf(REQUEST, '2026-11-02', '2026-11-05'), during: 'x' }]],
    ['no member', [{ ...rowOf(REQUEST, '2026-11-02', '2026-11-05'), member_id: null }]],
    [
      'a decision without its author',
      [rowOf(REQUEST, '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T08:15:00Z', decisions: [{ outcome: 'approved', decided_at: 'x' }] })],
    ],
    [
      'a decision without its instant',
      [rowOf(REQUEST, '2026-11-02', '2026-11-05', { closedAt: '2026-10-20T08:15:00Z', decisions: [{ outcome: 'rejected', decided_by: 'a' }] })],
    ],
  ])('cannot be trusted with %s', (_name, rows) => {
    expect(leaveRequestFoundOf(rows, REQUEST)).toBeNull();
  });

  function tableAnswering(answer: unknown): LeaveRequestsTable & { calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      select: (columns) => ({
        eq: (column, value) => {
          calls.push([columns, column, value]);

          return Promise.resolve(answer) as never;
        },
      }),
    };
  }

  it('selects the request columns with the decision and its author, by the id alone, under its own key', async () => {
    const table = tableAnswering({ data: [], error: null });

    expect(await readLeaveRequestRows(table, REQUEST)).toEqual({ ok: true, rows: [] });
    expect(table.calls).toEqual([[LEAVE_REQUEST_COLUMNS, 'id', REQUEST]]);
    expect(LEAVE_REQUEST_COLUMNS).toContain('leave_request_decisions(outcome,decided_by,decided_at)');
    expect(leaveRequestQueryOptions(() => table, REQUEST).queryKey).toEqual(LEAVE_REQUEST_KEY(REQUEST));
    expect(LEAVE_REQUEST_KEY(REQUEST)).toEqual(['leave-request', REQUEST]);
  });

  it('asks nothing for an id that is not a uuid: no request can carry it', async () => {
    const table = tableAnswering({ data: [rowOf('x', '2026-11-02', '2026-11-05')], error: null });

    expect(await readLeaveRequestRows(table, 'not-a-uuid')).toEqual({ ok: true, rows: [] });
    expect(table.calls).toEqual([]);
  });

  it('is unavailable when the read fails or throws, and the query rejects with the code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readLeaveRequestRows(tableAnswering({ data: null, error: { code: '42501' } }), REQUEST)).toEqual({
      ok: false,
      code: LEAVE_REQUESTS_UNAVAILABLE,
    });

    const throwing: LeaveRequestsTable = { select: () => ({ eq: () => Promise.reject(new Error('network')) }) };

    await expect(leaveRequestQueryOptions(() => throwing, REQUEST).queryFn?.({} as never)).rejects.toThrow(
      LEAVE_REQUESTS_UNAVAILABLE,
    );
  });
});

describe("the organization's requests (story 9.5)", () => {
  const DECIDED = '2026-10-20T08:15:00Z';

  it('parses every request of every member with the decision screen\'s parse, soonest first', () => {
    const rows = [
      rowOf('req-later', '2026-11-10', '2026-11-12', { memberId: 'member-2' }),
      rowOf('req-approved', '2026-11-02', '2026-11-05', {
        closedAt: DECIDED,
        decisions: [{ outcome: 'approved', decided_by: 'admin-auth', decided_at: DECIDED }],
      }),
      rowOf('req-withdrawn', '2026-11-03', '2026-11-04', { closedAt: DECIDED }),
    ];
    const requests = organizationLeaveRequestsOf(rows);

    expect(requests?.map((request) => [request.id, request.memberId, request.status])).toEqual([
      ['req-approved', MEMBER, REQUEST_APPROVED],
      ['req-withdrawn', MEMBER, REQUEST_WITHDRAWN],
      ['req-later', 'member-2', REQUEST_PENDING],
    ]);
    expect(requests?.[0]?.decision).toEqual({ outcome: REQUEST_APPROVED, decidedBy: 'admin-auth', decidedAt: DECIDED });
    expect(requests?.[0]).toMatchObject({ from: '2026-11-02', to: '2026-11-04' });
  });

  it.each([
    ['two rows of one id', [rowOf('r', '2026-11-02', '2026-11-05'), rowOf('r', '2026-11-10', '2026-11-12')]],
    ['no id', [{ ...rowOf('r', '2026-11-02', '2026-11-05'), id: null }]],
    ['a range that does not parse', [{ ...rowOf('r', '2026-11-02', '2026-11-05'), during: 'x' }]],
    ['a decision without its author', [rowOf('r', '2026-11-02', '2026-11-05', { closedAt: DECIDED, decisions: [{ outcome: 'rejected', decided_at: DECIDED }] })]],
    ['a row that is not a request', [null]],
  ])('cannot be trusted with %s: the whole answer, never a partial list', (_name, rows) => {
    expect(organizationLeaveRequestsOf(rows)).toBeNull();
  });

  function pagedTable(pages: readonly unknown[]): OrganizationLeaveRequestsTable & { calls: unknown[] } {
    const calls: unknown[] = [];
    let page = 0;
    const query = {
      order: (column: string, options: { readonly ascending: boolean }) => {
        calls.push(['order', column, options.ascending]);

        return query;
      },
      range: (from: number, to: number) => {
        calls.push(['range', from, to]);

        return Promise.resolve(pages[page++]) as never;
      },
    };

    return {
      calls,
      select: (columns, options) => {
        calls.push(['select', columns, options.count]);

        return query;
      },
    };
  }

  it('selects every request with its decision, ordered by id, counted exactly, under its own key', async () => {
    const rows = [rowOf('r', '2026-11-02', '2026-11-05')];
    const table = pagedTable([{ data: rows, error: null, count: 1 }]);

    expect(await readOrganizationLeaveRequestRows(table)).toEqual({ ok: true, rows });
    expect(table.calls).toEqual([
      ['select', LEAVE_REQUEST_COLUMNS, 'exact'],
      ['order', 'id', true],
      ['range', 0, 999],
    ]);
    expect(organizationLeaveRequestsQueryOptions(() => table).queryKey).toEqual(ORGANIZATION_LEAVE_REQUESTS_KEY);
    expect(ORGANIZATION_LEAVE_REQUESTS_KEY).toEqual(['organization-leave-requests']);
  });

  it('is unavailable when the read fails or its count disagrees, and the query rejects with the code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readOrganizationLeaveRequestRows(pagedTable([{ data: null, error: { code: '42501' }, count: null }]))).toEqual({
      ok: false,
      code: LEAVE_REQUESTS_UNAVAILABLE,
    });
    expect(await readOrganizationLeaveRequestRows(pagedTable([{ data: [], error: null, count: 2 }]))).toEqual({
      ok: false,
      code: LEAVE_REQUESTS_UNAVAILABLE,
    });
    await expect(
      organizationLeaveRequestsQueryOptions(() => pagedTable([{ data: null, error: { code: 'x' }, count: null }])).queryFn?.({} as never),
    ).rejects.toThrow(LEAVE_REQUESTS_UNAVAILABLE);
  });
});

describe('the decision (story 9.4)', () => {
  function rpcAnswering(answer: unknown): DecideLeaveRequestRpc & { calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      rpc: (fn, args) => {
        calls.push([fn, args]);

        return Promise.resolve(answer) as never;
      },
    };
  }

  it("calls 0040's definer with the request's id and the outcome, approval or rejection", async () => {
    const client = rpcAnswering({ data: 'record-1', error: null });

    expect(await decideLeaveRequest(client, 'request-1', REQUEST_APPROVED)).toEqual({ ok: true });
    expect(await decideLeaveRequest(rpcAnswering({ data: null, error: null }), 'request-1', REQUEST_REJECTED)).toEqual({
      ok: true,
    });
    expect(client.calls).toEqual([[DECIDE_LEAVE_REQUEST_FUNCTION, { p_request_id: 'request-1', p_outcome: 'approved' }]]);
  });

  it.each([
    ['no longer pending', { code: 'P0002', message: 'LEAVE_REQUEST_NOT_PENDING' }, REQUEST_NOT_PENDING],
    ['a stale approval', { code: '23P01', message: 'LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE' }, REQUEST_APPROVAL_STALE],
    ['not allowed', { code: '42501', message: 'LEAVE_REQUEST_DECISION_REFUSED' }, REQUEST_DENIED],
    ['anything else', { code: '22023', message: 'LEAVE_REQUEST_OUTCOME_UNKNOWN' }, REQUEST_FAILED],
  ] as const)('maps %s', async (_name, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestDecideFailureOf(error)).toBe(code);
    expect(await decideLeaveRequest(rpcAnswering({ error }), 'request-1', REQUEST_APPROVED)).toEqual({ ok: false, code });
  });

  it('fails, never throws, when the call throws or answers nothing it can read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client: DecideLeaveRequestRpc = { rpc: () => Promise.reject(new Error('network')) };

    expect(await decideLeaveRequest(client, 'request-1', REQUEST_REJECTED)).toEqual({ ok: false, code: REQUEST_FAILED });
    expect(await decideLeaveRequest(rpcAnswering(null), 'request-1', REQUEST_REJECTED)).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
  });
});
