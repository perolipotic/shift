import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LEAVE_RECORDS_COLUMNS,
  LEAVE_RECORDS_KEY,
  LEAVE_RECORDS_UNAVAILABLE,
  MY_LEAVE_RECORDS_FUNCTION,
  MY_LEAVE_RECORDS_KEY,
  ORGANIZATION_LEAVE_PAGE_ROWS,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  leaveRecordsAfterWriteOf,
  leaveRecordsOf,
  leaveRecordsQueryOptions,
  leaveRecordsStateOf,
  myLeaveRecordsQueryOptions,
  organizationLeaveRecordsOf,
  organizationLeaveRecordsQueryOptions,
  readLeaveRecords,
  readMyLeaveRows,
  readOrganizationLeaveRows,
  type LeaveRecordsAnswer,
  type MyLeaveRecordsRpc,
  type LeaveRecordsQuery,
  type LeaveRecordsTable,
  type OrganizationLeaveRecordsAnswer,
  type OrganizationLeaveRecordsQuery,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';

/**
 * Story 5.1c's read, executed (AD-15): the one query a member's live records
 * are read with, the rows parsed into inclusive ranges, and every answer that
 * cannot be trusted refused as unavailable.
 */

const MEMBER = '00000000-0000-4000-8000-0000000000b2';
const OTHER = '00000000-0000-4000-8000-0000000000b3';
const FIRST = '00000000-0000-4000-8000-0000000000c1';
const SECOND = '00000000-0000-4000-8000-0000000000c2';

afterEach(() => {
  vi.restoreAllMocks();
});

function tableAnswering(answer: LeaveRecordsAnswer | Promise<never>): LeaveRecordsTable & { calls: unknown[] } {
  const calls: unknown[] = [];

  return {
    calls,
    select(columns) {
      calls.push(['select', columns]);

      const query: LeaveRecordsQuery = {
        eq(column, value) {
          calls.push(['eq', column, value]);

          return query;
        },
        is(column, value) {
          calls.push(['is', column, value]);

          return query;
        },
        order(column, options) {
          calls.push(['order', column, options]);

          return answer instanceof Promise ? answer : Promise.resolve(answer);
        },
      };

      return query;
    },
  };
}

describe('the read', () => {
  it("asks for the member's live records, in range order", async () => {
    const table = tableAnswering({ data: [], error: null });

    expect(await readLeaveRecords(table, MEMBER)).toEqual({ ok: true, records: [] });
    expect(table.calls).toEqual([
      ['select', LEAVE_RECORDS_COLUMNS],
      ['eq', 'member_id', MEMBER],
      ['is', 'removed_at', null],
      ['order', 'during', { ascending: true }],
    ]);
  });

  it('asks for the id an amend or a removal names', () => {
    expect(LEAVE_RECORDS_COLUMNS.split(',')).toEqual(['id', 'member_id', 'during']);
  });

  it('parses each canonical range into the inclusive dates it records, with its id, in start order', async () => {
    const table = tableAnswering({
      data: [
        { id: SECOND, member_id: MEMBER, during: '[2026-10-01,2026-10-04)' },
        { id: FIRST, member_id: MEMBER, during: '[2026-09-10,2026-09-15)' },
      ],
      error: null,
    });

    expect(await readLeaveRecords(table, MEMBER)).toEqual({
      ok: true,
      records: [
        { id: FIRST, from: '2026-09-10', to: '2026-09-14' },
        { id: SECOND, from: '2026-10-01', to: '2026-10-03' },
      ],
    });
  });

  it.each([
    ['an error', { data: null, error: { code: '42501' } }],
    ['no array', { data: null, error: null }],
    [
      'a row of another member',
      { data: [{ id: FIRST, member_id: OTHER, during: '[2026-09-10,2026-09-15)' }], error: null },
    ],
    [
      'a range that does not parse',
      { data: [{ id: FIRST, member_id: MEMBER, during: '(2026-09-10,2026-09-15]' }], error: null },
    ],
    ['a row with no id', { data: [{ member_id: MEMBER, during: '[2026-09-10,2026-09-15)' }], error: null }],
    ['a row whose id is no string', { data: [{ id: 7, member_id: MEMBER, during: '[2026-09-10,2026-09-15)' }], error: null }],
    [
      'two rows sharing an id',
      {
        data: [
          { id: FIRST, member_id: MEMBER, during: '[2026-09-10,2026-09-15)' },
          { id: FIRST, member_id: MEMBER, during: '[2026-10-01,2026-10-04)' },
        ],
        error: null,
      },
    ],
    ['a row whose id is empty', { data: [{ id: '', member_id: MEMBER, during: '[2026-09-10,2026-09-15)' }], error: null }],
    [
      'two records sharing a date',
      {
        data: [
          { id: FIRST, member_id: MEMBER, during: '[2026-09-10,2026-09-15)' },
          { id: SECOND, member_id: MEMBER, during: '[2026-09-14,2026-09-20)' },
        ],
        error: null,
      },
    ],
  ] as const)('is unavailable on %s', async (_name, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readLeaveRecords(tableAnswering(answer), MEMBER)).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
  });

  it('is unavailable when the call rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readLeaveRecords(tableAnswering(Promise.reject(new Error('offline'))), MEMBER)).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
  });

  it('keeps ranges that only touch', () => {
    expect(
      leaveRecordsOf(
        [
          { id: FIRST, member_id: MEMBER, during: '[2026-09-10,2026-09-15)' },
          { id: SECOND, member_id: MEMBER, during: '[2026-09-15,2026-09-16)' },
        ],
        MEMBER,
      ),
    ).toEqual([
      { id: FIRST, from: '2026-09-10', to: '2026-09-14' },
      { id: SECOND, from: '2026-09-15', to: '2026-09-15' },
    ]);
  });
});

describe('the query', () => {
  it("reads under the member's own key", () => {
    expect(LEAVE_RECORDS_KEY(MEMBER)).toEqual(['leave-records', MEMBER]);
    expect(leaveRecordsQueryOptions(() => tableAnswering({ data: [], error: null }), MEMBER).queryKey).toEqual(
      LEAVE_RECORDS_KEY(MEMBER),
    );
  });

  it('resolves the records and throws on a failure, so the query settles failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = leaveRecordsQueryOptions(() => tableAnswering({ data: [], error: null }), MEMBER);
    const failed = leaveRecordsQueryOptions(() => tableAnswering({ data: null, error: { code: 'x' } }), MEMBER);

    // The options' `queryFn` ignores its context.
    const run = (options: typeof ok) => (options.queryFn as () => Promise<unknown>)();

    await expect(run(ok)).resolves.toEqual([]);
    await expect(run(failed)).rejects.toThrow(LEAVE_RECORDS_UNAVAILABLE);
  });

  it.each([
    [
      'answered',
      { isPending: false, isError: false, fetchStatus: 'idle', data: [] },
      { records: [], loading: false, refreshing: false },
    ],
    [
      'pending',
      { isPending: true, isError: false, fetchStatus: 'fetching', data: undefined },
      { records: null, loading: true, refreshing: false },
    ],
    [
      're-read over records held',
      { isPending: false, isError: false, fetchStatus: 'fetching', data: [] },
      { records: [], loading: false, refreshing: true },
    ],
    [
      'failed',
      { isPending: false, isError: true, fetchStatus: 'idle', data: undefined },
      { records: null, loading: false, refreshing: false },
    ],
    [
      'a failed refetch over cached records',
      { isPending: false, isError: true, fetchStatus: 'idle', data: [{ id: FIRST, from: '2026-09-10', to: '2026-09-14' }] },
      { records: null, loading: false, refreshing: false },
    ],
    [
      'paused offline',
      { isPending: false, isError: false, fetchStatus: 'paused', data: [] },
      { records: null, loading: false, refreshing: false },
    ],
  ] as const)('gives the card the right state when %s', (_name, answer, state) => {
    expect(leaveRecordsStateOf(answer)).toEqual(state);
  });
});

describe('the records after a write', () => {
  const RECORDS = [{ id: FIRST, from: '2026-09-10', to: '2026-09-14' }];

  it('answers the records only once the re-read has settled successfully', () => {
    expect(leaveRecordsAfterWriteOf({ status: 'success', fetchStatus: 'idle', data: RECORDS })).toEqual(RECORDS);
  });

  it.each([
    ['no entry', undefined],
    ['a failed re-read over the records held', { status: 'error', fetchStatus: 'idle', data: RECORDS }],
    ['a re-read paused offline', { status: 'success', fetchStatus: 'paused', data: RECORDS }],
    ['a re-read still under way', { status: 'success', fetchStatus: 'fetching', data: RECORDS }],
  ] as const)('answers nothing on %s', (_name, state) => {
    expect(leaveRecordsAfterWriteOf(state)).toBeNull();
  });
});

describe("the viewer's own records (story 5.2c)", () => {
  function rpcAnswering(answer: LeaveRecordsAnswer | Promise<never>): MyLeaveRecordsRpc & { calls: unknown[] } {
    const calls: unknown[] = [];

    return {
      calls,
      rpc(fn) {
        calls.push(fn);

        return answer instanceof Promise ? answer : Promise.resolve(answer);
      },
    };
  }

  const ROW = { id: FIRST, member_id: MEMBER, during: '[2026-09-10,2026-09-15)' };

  it('calls my_leave_records with no argument and never selects the table', async () => {
    const client = rpcAnswering({ data: [ROW], error: null });

    expect(await readMyLeaveRows(client)).toEqual({ ok: true, rows: [ROW] });
    expect(client.calls).toEqual([MY_LEAVE_RECORDS_FUNCTION]);
    expect(MY_LEAVE_RECORDS_FUNCTION).toBe('my_leave_records');
  });

  it('answers the rows unparsed, so the viewer they are checked against is the snapshot\'s', async () => {
    const other = { ...ROW, member_id: OTHER };

    expect(await readMyLeaveRows(rpcAnswering({ data: [other], error: null }))).toEqual({ ok: true, rows: [other] });
    expect(leaveRecordsOf([other], MEMBER)).toBeNull();
  });

  it.each([
    ['an error', { data: null, error: { code: '42501' } }],
    ['no array', { data: null, error: null }],
  ] as const)('is unavailable on %s', async (_name, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readMyLeaveRows(rpcAnswering(answer))).toEqual({ ok: false, code: LEAVE_RECORDS_UNAVAILABLE });
  });

  it('is unavailable when the call rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readMyLeaveRows(rpcAnswering(Promise.reject(new Error('offline'))))).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
  });

  it('reads under its own key, and throws on a failure so the query settles failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = myLeaveRecordsQueryOptions(() => rpcAnswering({ data: [ROW], error: null }));
    const failed = myLeaveRecordsQueryOptions(() => rpcAnswering({ data: null, error: { code: 'x' } }));
    const run = (options: typeof ok) => (options.queryFn as () => Promise<unknown>)();

    expect(ok.queryKey).toEqual(MY_LEAVE_RECORDS_KEY);
    expect(MY_LEAVE_RECORDS_KEY).toEqual(['my-leave-records']);
    await expect(run(ok)).resolves.toEqual([ROW]);
    await expect(run(failed)).rejects.toThrow(LEAVE_RECORDS_UNAVAILABLE);
  });
});

/**
 * The organization's table, answering each page in turn from `pages` — a
 * page an answer or a rejection — and recording every call.
 */
function organizationTableAnswering(
  pages: readonly (OrganizationLeaveRecordsAnswer | Promise<never>)[],
): OrganizationLeaveRecordsTable & { calls: unknown[] } {
  const calls: unknown[] = [];
  let next = 0;

  return {
    calls,
    select(columns, options) {
      calls.push(['select', columns, options]);

      const query: OrganizationLeaveRecordsQuery = {
        is(column, value) {
          calls.push(['is', column, value]);

          return query;
        },
        order(column, options) {
          calls.push(['order', column, options]);

          return query;
        },
        range(from, to) {
          calls.push(['range', from, to]);

          const page = pages[next];
          next += 1;

          if (page === undefined) throw new Error('no page left');

          return page instanceof Promise ? page : Promise.resolve(page);
        },
      };

      return query;
    },
  };
}

describe("the organization's records (story 5.3b)", () => {
  const row = (id: string, memberId: string, during: unknown) => ({ id, member_id: memberId, during });
  const A = row(FIRST, MEMBER, '[2026-09-10,2026-09-15)');
  const B = row(SECOND, OTHER, '[2026-09-12,2026-09-13)');
  const LAST = ORGANIZATION_LEAVE_PAGE_ROWS - 1;
  /** `count` distinct rows, numbered from `start`. */
  const many = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => row(`r${String(start + index)}`, MEMBER, '[2026-09-10,2026-09-11)'));

  it('asks for every live record by id, a page at a time, with its exact count and no member filter', async () => {
    const table = organizationTableAnswering([{ data: [A, B], error: null, count: 2 }]);

    expect(await readOrganizationLeaveRows(table)).toEqual({ ok: true, rows: [A, B] });
    expect(table.calls).toEqual([
      ['select', LEAVE_RECORDS_COLUMNS, { count: 'exact' }],
      ['is', 'removed_at', null],
      ['order', 'id', { ascending: true }],
      ['range', 0, LAST],
    ]);
  });

  it('pages the server cap, so a full page is followed and every row is returned', async () => {
    expect(ORGANIZATION_LEAVE_PAGE_ROWS).toBe(1000);
    const first = many(0, ORGANIZATION_LEAVE_PAGE_ROWS);
    const second = many(ORGANIZATION_LEAVE_PAGE_ROWS, ORGANIZATION_LEAVE_PAGE_ROWS);
    const third = many(2 * ORGANIZATION_LEAVE_PAGE_ROWS, 3);
    const total = 2 * ORGANIZATION_LEAVE_PAGE_ROWS + 3;
    const table = organizationTableAnswering([
      { data: first, error: null, count: total },
      { data: second, error: null, count: total },
      { data: third, error: null, count: total },
    ]);

    expect(await readOrganizationLeaveRows(table)).toEqual({ ok: true, rows: [...first, ...second, ...third] });
    expect(table.calls.filter((call) => (call as unknown[])[0] === 'range')).toEqual([
      ['range', 0, LAST],
      ['range', ORGANIZATION_LEAVE_PAGE_ROWS, ORGANIZATION_LEAVE_PAGE_ROWS + LAST],
      ['range', 2 * ORGANIZATION_LEAVE_PAGE_ROWS, 2 * ORGANIZATION_LEAVE_PAGE_ROWS + LAST],
    ]);
  });

  it('asks no page past the count when the rows fill the last page exactly', async () => {
    const first = many(0, ORGANIZATION_LEAVE_PAGE_ROWS);
    const table = organizationTableAnswering([{ data: first, error: null, count: ORGANIZATION_LEAVE_PAGE_ROWS }]);

    expect(await readOrganizationLeaveRows(table)).toEqual({ ok: true, rows: first });
    expect(table.calls.filter((call) => (call as unknown[])[0] === 'range')).toEqual([['range', 0, LAST]]);
  });

  it('is unavailable when a full page holds more rows than the count', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = organizationTableAnswering([{ data: many(0, ORGANIZATION_LEAVE_PAGE_ROWS), error: null, count: 3 }]);

    expect(await readOrganizationLeaveRows(table)).toEqual({ ok: false, code: LEAVE_RECORDS_UNAVAILABLE });
  });

  it.each([
    ['no count', [{ data: [A], error: null }]],
    ['a count above the rows (a capped answer)', [{ data: [A], error: null, count: 2 }]],
    [
      'a count that changes between pages',
      [
        { data: many(0, ORGANIZATION_LEAVE_PAGE_ROWS), error: null, count: ORGANIZATION_LEAVE_PAGE_ROWS + 1 },
        { data: [A], error: null, count: ORGANIZATION_LEAVE_PAGE_ROWS + 2 },
      ],
    ],
    [
      'a later page that fails',
      [
        { data: many(0, ORGANIZATION_LEAVE_PAGE_ROWS), error: null, count: ORGANIZATION_LEAVE_PAGE_ROWS + 1 },
        { data: null, error: { code: '57014' }, count: null },
      ],
    ],
  ] as const)('is unavailable, never a partial list, on %s', async (_name, pages) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readOrganizationLeaveRows(organizationTableAnswering(pages))).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
  });

  it('is unavailable when the call rejects, errors or answers no list', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readOrganizationLeaveRows(organizationTableAnswering([Promise.reject(new Error('down'))]))).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
    expect(await readOrganizationLeaveRows(organizationTableAnswering([{ data: null, error: { code: '42501' } }]))).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
    expect(await readOrganizationLeaveRows(organizationTableAnswering([{ data: null, error: null }]))).toEqual({
      ok: false,
      code: LEAVE_RECORDS_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalledTimes(3);
  });

  it('reads under its own key, and throws on a failure so the query settles failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = organizationLeaveRecordsQueryOptions(() => organizationTableAnswering([{ data: [A], error: null, count: 1 }]));
    const failed = organizationLeaveRecordsQueryOptions(() =>
      organizationTableAnswering([{ data: null, error: { code: 'x' } }]),
    );
    const run = (options: typeof ok) => (options.queryFn as () => Promise<unknown>)();

    expect(ok.queryKey).toEqual(ORGANIZATION_LEAVE_RECORDS_KEY);
    expect(ORGANIZATION_LEAVE_RECORDS_KEY).toEqual(['organization-leave-records']);
    await expect(run(ok)).resolves.toEqual([A]);
    await expect(run(failed)).rejects.toThrow(LEAVE_RECORDS_UNAVAILABLE);
  });

  it("parses every member's rows into inclusive ranges, each with its member", () => {
    expect(organizationLeaveRecordsOf([B, A], [MEMBER, OTHER])).toEqual([
      { id: SECOND, memberId: OTHER, from: '2026-09-12', to: '2026-09-12' },
      { id: FIRST, memberId: MEMBER, from: '2026-09-10', to: '2026-09-14' },
    ]);
  });

  it('lets two members share a date', () => {
    expect(organizationLeaveRecordsOf([A, row(SECOND, OTHER, '[2026-09-10,2026-09-15)')], [MEMBER, OTHER])).toHaveLength(2);
  });

  it.each([
    ['a member not among the members', [A, B], [MEMBER]],
    ['two rows of one member sharing a date', [A, row(SECOND, MEMBER, '[2026-09-14,2026-09-16)')], [MEMBER]],
    ['a range that does not parse', [A, row(SECOND, OTHER, 'garbage')], [MEMBER, OTHER]],
    ['an id two members share', [A, row(FIRST, OTHER, '[2026-09-01,2026-09-02)')], [MEMBER, OTHER]],
    ['a row with no id', [A, row('', OTHER, '[2026-09-01,2026-09-02)')], [MEMBER, OTHER]],
    ['a row that is not a record', [A, 'row'], [MEMBER]],
  ])('refuses the whole answer for %s', (_name, rows, members) => {
    expect(organizationLeaveRecordsOf(rows, members)).toBeNull();
  });
});
