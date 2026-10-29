import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LEAVE_REQUEST_COLUMNS,
  LEAVE_REQUEST_KEY,
  LEAVE_REQUESTS_COLUMNS,
  LEAVE_REQUESTS_UNAVAILABLE,
  MY_LEAVE_REQUESTS_KEY,
  ORGANIZATION_LEAVE_REQUESTS_KEY,
  REQUEST_APPROVED,
  REQUEST_CLOSED_ON_DEACTIVATION,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_WITHDRAWN,
  leaveRequestFoundOf,
  leaveRequestQueryOptions,
  leaveRequestStatusOf,
  leaveRequestsOf,
  myLeaveRequestsQueryOptions,
  organizationLeaveRequestsOf,
  organizationLeaveRequestsQueryOptions,
  readLeaveRequestRows,
  readMyLeaveRequestRows,
  readOrganizationLeaveRequestRows,
  type LeaveRequestsTable,
  type OrganizationLeaveRequestsTable,
} from '@/features/leave/services/leave-request-list';

/** Stories 9.3–9.5: the read side of the 0040 boundary of leave requests, executed (AD-15). */

const MEMBER = 'member-1';

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

/** The member and by-id reads' select, answering `answer` and recording each call's columns, filter and value. */
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

describe('the status, derived as 0040 stores it', () => {
  it.each([
    ['pending while closed_at is null', null, [], REQUEST_PENDING],
    ['approved by its decision', '2026-10-20T08:00:00Z', [{ outcome: 'approved' }], REQUEST_APPROVED],
    ['rejected by its decision', '2026-10-20T08:00:00Z', [{ outcome: 'rejected' }], REQUEST_REJECTED],
    ['withdrawn when closed with no decision', '2026-10-20T08:00:00Z', [], REQUEST_WITHDRAWN],
    ['approved from a one-to-one embed', '2026-10-20T08:00:00Z', { outcome: 'approved' }, REQUEST_APPROVED],
    ['withdrawn from a null one-to-one embed', '2026-10-20T08:00:00Z', null, REQUEST_WITHDRAWN],
    // 0041: closed by the member's deactivation, as its own outcome.
    ['closed on deactivation by its decision', '2026-10-20T08:00:00Z', [{ outcome: 'deactivated' }], REQUEST_CLOSED_ON_DEACTIVATION],
  ] as const)('is %s', (_name, closedAt, decisions, status) => {
    expect(leaveRequestStatusOf(closedAt, decisions)).toBe(status);
  });

  it.each([
    ['a pending request with a decision', null, [{ outcome: 'approved' }]],
    ['a pending request with a deactivation decision', null, [{ outcome: 'deactivated' }]],
    ['the status word stored as an outcome', '2026-10-20T08:00:00Z', [{ outcome: 'closedOnDeactivation' }]],
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

  it("are none at all for a row with no member, even when the viewer's id is empty too (retro 8–9: the one row parse)", () => {
    expect(leaveRequestsOf([rowOf('x', '2026-11-02', '2026-11-05', { memberId: '' })], '')).toBeNull();
  });
});

describe('the read', () => {
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

  it('reads a request closed on its member\'s deactivation as decided by the deactivating admin (0041)', () => {
    const requests = organizationLeaveRequestsOf([
      rowOf('req-closed', '2026-11-02', '2026-11-05', {
        closedAt: DECIDED,
        decisions: [{ outcome: 'deactivated', decided_by: 'admin-auth', decided_at: DECIDED }],
      }),
    ]);

    expect(requests?.[0]?.status).toBe(REQUEST_CLOSED_ON_DEACTIVATION);
    expect(requests?.[0]?.decision).toEqual({
      outcome: REQUEST_CLOSED_ON_DEACTIVATION,
      decidedBy: 'admin-auth',
      decidedAt: DECIDED,
    });
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
