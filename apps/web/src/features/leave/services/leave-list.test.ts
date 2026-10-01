import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LEAVE_RECORDS_COLUMNS,
  LEAVE_RECORDS_KEY,
  LEAVE_RECORDS_UNAVAILABLE,
  leaveRecordsAfterWriteOf,
  leaveRecordsOf,
  leaveRecordsQueryOptions,
  leaveRecordsStateOf,
  readLeaveRecords,
  type LeaveRecordsAnswer,
  type LeaveRecordsQuery,
  type LeaveRecordsTable,
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
