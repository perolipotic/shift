import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AMEND_LEAVE_RECORD_FUNCTION,
  LEAVE_DENIED,
  LEAVE_FAILED,
  LEAVE_GONE,
  LEAVE_OVERLAP,
  LEAVE_RECORDS_TABLE,
  REMOVE_LEAVE_RECORD_FUNCTION,
  amendLeave,
  leaveChangeFailureOf,
  leaveInsertFailureOf,
  isCalendarDate,
  leaveRangeOf,
  recordLeave,
  removeLeave,
  type LeaveAmendAnswer,
  type LeaveQuery,
  type LeaveRecordRpc,
  type LeaveReadAnswer,
  type LeaveTable,
  type LeaveWriteAnswer,
} from '@/features/leave/services/leave-write';

/**
 * Story 5.1b's write, executed (AD-15): what the insert sends, every refusal
 * of the spec's matrix mapped to its code, and the overlap's one follow-up
 * read of the conflicting record's dates.
 */

const ORGANIZATION = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000b2';

interface FakeTable extends LeaveTable {
  readonly sent: unknown[];
  readonly read: unknown[][];
}

function tableAnswering(
  insertAnswer: LeaveWriteAnswer | Promise<never>,
  readAnswer: LeaveReadAnswer | Promise<never> = { data: [], error: null },
): FakeTable {
  const sent: unknown[] = [];
  const read: unknown[][] = [];

  return {
    sent,
    read,
    insert(values) {
      sent.push(values);

      return insertAnswer instanceof Promise ? insertAnswer : Promise.resolve(insertAnswer);
    },
    select(columns) {
      const call: unknown[] = [['select', columns]];

      read.push(call);

      const query: LeaveQuery = {
        eq(column, value) {
          call.push(['eq', column, value]);

          return query;
        },
        neq(column, value) {
          call.push(['neq', column, value]);

          return query;
        },
        is(column, value) {
          call.push(['is', column, value]);

          return query;
        },
        overlaps(column, range) {
          call.push(['overlaps', column, range]);

          return query;
        },
        order(column, options) {
          call.push(['order', column, options]);

          return query;
        },
        limit(count) {
          call.push(['limit', count]);

          return readAnswer instanceof Promise ? readAnswer : Promise.resolve(readAnswer);
        },
      };

      return query;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recording leave (story 5.1b)', () => {
  it('names the table 0028 created', () => {
    expect(LEAVE_RECORDS_TABLE).toBe('leave_records');
  });

  it('inserts the three facts, the range as an inclusive daterange, and reads nothing back', async () => {
    const table = tableAnswering({ error: null });

    expect(await recordLeave(table, ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14')).toEqual({ ok: true });
    expect(table.sent).toEqual([{ organization_id: ORGANIZATION, member_id: MEMBER, during: '[2026-09-10,2026-09-14]' }]);
    expect(table.read).toEqual([]);
  });

  it('answers an overlap with the earliest conflicting live record’s inclusive dates, read once, and logs nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: { code: '23P01' } }, { data: [{ during: '[2026-09-12,2026-09-21)' }], error: null });

    expect(await recordLeave(table, ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14')).toEqual({
      ok: false,
      code: LEAVE_OVERLAP,
      conflict: { from: '2026-09-12', to: '2026-09-20' },
    });
    expect(table.read).toEqual([
      [
        ['select', 'during'],
        ['eq', 'organization_id', ORGANIZATION],
        ['eq', 'member_id', MEMBER],
        ['is', 'removed_at', null],
        ['overlaps', 'during', '[2026-09-10,2026-09-14]'],
        ['order', 'during', { ascending: true }],
        ['limit', 1],
      ],
    ]);
    expect(logged).not.toHaveBeenCalled();
  });

  it.each([
    ['a refused read', { data: null, error: { code: '42501' } }],
    ['no row', { data: [], error: null }],
    ['a row with no range', { data: [{}], error: null }],
    ['a row that is not an object', { data: ['x'], error: null }],
    ['a range that is not canonical', { data: [{ during: '(2026-09-12,2026-09-21]' }], error: null }],
    ['a malformed answer', null as unknown as LeaveReadAnswer],
    ['a thrown read', 'throws'],
  ] as const)('answers an overlap with the code alone after %s', async (_label, readAnswer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering(
      { error: { code: '23P01' } },
      readAnswer === 'throws' ? Promise.reject(new Error('offline')) : (readAnswer as LeaveReadAnswer),
    );

    expect(await recordLeave(table, ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14')).toEqual({
      ok: false,
      code: LEAVE_OVERLAP,
      conflict: null,
    });
  });

  it.each([
    ['42501', LEAVE_DENIED],
    ['23514', LEAVE_FAILED],
    ['22000', LEAVE_FAILED],
    ['23503', LEAVE_FAILED],
    ['23505', LEAVE_FAILED],
    [undefined, LEAVE_FAILED],
  ] as const)('maps a refused insert %s to %s, and reads nothing back', async (code, expected) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: { code } });

    expect(await recordLeave(table, ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14')).toEqual({
      ok: false,
      code: expected,
    });
    expect(table.read).toEqual([]);
    expect(leaveInsertFailureOf({ code })).toBe(expected);
    // Only a failure is logged; a refusal is an ordinary outcome.
    expect(logged).toHaveBeenCalledTimes(expected === LEAVE_FAILED ? 1 : 0);
  });

  it.each([
    ['an absent error', {}],
    ['an undefined error', { error: undefined }],
    ['a string error', { error: '23P01' }],
    ['a numeric error', { error: 42 }],
  ])('reads an insert answer with %s as failed, never throwing', async (_label, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering(answer as unknown as LeaveWriteAnswer);

    expect(await recordLeave(table, ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14')).toEqual({
      ok: false,
      code: LEAVE_FAILED,
    });
    expect(table.read).toEqual([]);
  });

  it.each([
    ['2026-13-45', '2026-09-14'],
    ['2026-02-30', '2026-03-02'],
    ['2026-09-10', '2026-9-14'],
    ['2026-09-10', '2026-09-14,2026-09-20]'],
    ['2026-09-10)', '2026-09-14'],
    ['', '2026-09-14'],
    ['2026-09-10', '20260-09-14'],
    ['2026-09-10T00:00', '2026-09-14'],
  ])('refuses %s–%s as failed without a request', async (from, to) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: null });

    expect(await recordLeave(table, ORGANIZATION, MEMBER, from, to)).toEqual({ ok: false, code: LEAVE_FAILED });
    expect(table.sent).toEqual([]);
    expect(table.read).toEqual([]);
  });

  it('reads a thrown call or a malformed answer as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await recordLeave(tableAnswering(Promise.reject(new Error('offline'))), ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14'),
    ).toEqual({ ok: false, code: LEAVE_FAILED });
    expect(
      await recordLeave(tableAnswering(null as unknown as LeaveWriteAnswer), ORGANIZATION, MEMBER, '2026-09-10', '2026-09-14'),
    ).toEqual({ ok: false, code: LEAVE_FAILED });
  });
});

describe('a calendar date', () => {
  it.each(['2026-09-10', '2028-02-29', '0001-01-01', '9999-12-31'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(['2026-13-45', '2026-02-29', '2026-00-10', '2026-09-00', '2026-9-10', '10000-01-01', '', 'x', '2026-09-10 '])(
    'refuses %j',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});

describe('a stored range read back as inclusive dates', () => {
  it.each([
    ['[2026-09-12,2026-09-21)', { from: '2026-09-12', to: '2026-09-20' }],
    ['[2026-09-10,2026-09-11)', { from: '2026-09-10', to: '2026-09-10' }],
    ['[2026-02-20,2026-03-01)', { from: '2026-02-20', to: '2026-02-28' }],
    ['[2028-02-20,2028-03-01)', { from: '2028-02-20', to: '2028-02-29' }],
    ['[2026-12-20,2027-01-01)', { from: '2026-12-20', to: '2026-12-31' }],
    ['[0001-01-01,0001-01-02)', { from: '0001-01-01', to: '0001-01-01' }],
    ['[9999-12-01,10000-01-01)', { from: '9999-12-01', to: '9999-12-31' }],
  ] as const)('reads %s', (during, expected) => {
    expect(leaveRangeOf(during)).toEqual(expected);
  });

  it.each([null, 42, '', 'empty', '[2026-09-12,2026-09-21]', '(2026-09-12,2026-09-21)', '[2026-09-12,)', '[2026-09-12,2026-09-12)', '[2026-13-45,2026-09-21)', '[2026-09-12,2026-02-30)', '[2026-09-12,2026-13-01)', '[2026-9-12,2026-09-21)', '[2026-09-12,100000-01-01)'])(
    'refuses %s',
    (during) => {
      expect(leaveRangeOf(during)).toBeNull();
    },
  );
});

const RECORD = '00000000-0000-4000-8000-0000000000c3';
const REPLACEMENT = '00000000-0000-4000-8000-0000000000d4';

interface FakeRpc extends LeaveRecordRpc {
  readonly called: unknown[];
}

function rpcAnswering(answer: LeaveAmendAnswer | Promise<never>): FakeRpc {
  const called: unknown[] = [];

  return {
    called,
    rpc(fn: string, args: unknown) {
      called.push([fn, args]);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  } as FakeRpc;
}

describe('removing a leave record (story 5.2a)', () => {
  it('names the function 0029 created', () => {
    expect(REMOVE_LEAVE_RECORD_FUNCTION).toBe('remove_leave_record');
  });

  it('calls the removal with the record alone, and lands', async () => {
    const client = rpcAnswering({ data: null, error: null });

    expect(await removeLeave(client, RECORD)).toEqual({ ok: true });
    expect(client.called).toEqual([['remove_leave_record', { p_record_id: RECORD }]]);
  });

  it.each([
    ['P0002', LEAVE_GONE, 0],
    ['42501', LEAVE_DENIED, 0],
    ['23P01', LEAVE_FAILED, 1],
    ['23514', LEAVE_FAILED, 1],
    [undefined, LEAVE_FAILED, 1],
  ] as const)('maps a refused removal %s to %s', async (code, expected, logs) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await removeLeave(rpcAnswering({ data: null, error: { code } }), RECORD)).toEqual({ ok: false, code: expected });
    expect(logged).toHaveBeenCalledTimes(logs);
  });

  it.each([
    ['a thrown call', 'throws'],
    ['a null answer', null],
    ['an absent error', {}],
    ['a string error', { error: 'P0002' }],
  ] as const)('reads %s as failed, never throwing', async (_label, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = rpcAnswering(
      answer === 'throws' ? Promise.reject(new Error('offline')) : (answer as unknown as LeaveAmendAnswer),
    );

    expect(await removeLeave(client, RECORD)).toEqual({ ok: false, code: LEAVE_FAILED });
  });
});

describe('amending a leave record (story 5.2a)', () => {
  it('names the function 0029 created', () => {
    expect(AMEND_LEAVE_RECORD_FUNCTION).toBe('amend_leave_record');
  });

  it('sends the record and the inclusive dates, answers the replacement\'s id, and reads nothing back', async () => {
    const client = rpcAnswering({ data: REPLACEMENT, error: null });
    const table = tableAnswering({ error: null });

    expect(await amendLeave(client, table, ORGANIZATION, MEMBER, RECORD, '2026-09-12', '2026-09-20')).toEqual({
      ok: true,
      id: REPLACEMENT,
    });
    expect(client.called).toEqual([
      ['amend_leave_record', { p_record_id: RECORD, p_from: '2026-09-12', p_to: '2026-09-20' }],
    ]);
    expect(table.sent).toEqual([]);
    expect(table.read).toEqual([]);
  });

  it('answers an overlap with the earliest conflicting live record other than the amended one, read once, and logs nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: null }, { data: [{ during: '[2026-09-18,2026-09-26)' }], error: null });

    expect(
      await amendLeave(rpcAnswering({ data: null, error: { code: '23P01' } }), table, ORGANIZATION, MEMBER, RECORD, '2026-09-12', '2026-09-20'),
    ).toEqual({ ok: false, code: LEAVE_OVERLAP, conflict: { from: '2026-09-18', to: '2026-09-25' } });
    expect(table.read).toEqual([
      [
        ['select', 'during'],
        ['eq', 'organization_id', ORGANIZATION],
        ['eq', 'member_id', MEMBER],
        ['is', 'removed_at', null],
        ['neq', 'id', RECORD],
        ['overlaps', 'during', '[2026-09-12,2026-09-20]'],
        ['order', 'during', { ascending: true }],
        ['limit', 1],
      ],
    ]);
    expect(table.sent).toEqual([]);
    expect(logged).not.toHaveBeenCalled();
  });

  it('answers an overlap with the code alone when the conflict cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: null }, { data: [], error: null });

    expect(
      await amendLeave(rpcAnswering({ data: null, error: { code: '23P01' } }), table, ORGANIZATION, MEMBER, RECORD, '2026-09-12', '2026-09-20'),
    ).toEqual({ ok: false, code: LEAVE_OVERLAP, conflict: null });
  });

  it.each([
    ['P0002', LEAVE_GONE],
    ['42501', LEAVE_DENIED],
    ['22000', LEAVE_FAILED],
    ['22008', LEAVE_FAILED],
    ['23514', LEAVE_FAILED],
    ['23503', LEAVE_FAILED],
    [undefined, LEAVE_FAILED],
  ] as const)('maps a refused amend %s to %s, and reads nothing back', async (code, expected) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: null });

    expect(
      await amendLeave(rpcAnswering({ data: null, error: { code } }), table, ORGANIZATION, MEMBER, RECORD, '2026-09-12', '2026-09-20'),
    ).toEqual({ ok: false, code: expected });
    expect(leaveChangeFailureOf({ code })).toBe(expected);
    expect(table.read).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(expected === LEAVE_FAILED ? 1 : 0);
  });

  it.each([
    ['a thrown call', 'throws'],
    ['a null answer', null],
    ['an absent error', {}],
    ['a numeric error', { error: 42 }],
    ['no id', { data: null, error: null }],
    ['an empty id', { data: '', error: null }],
    ['a non-string id', { data: [REPLACEMENT], error: null }],
  ] as const)('reads %s as failed, never throwing', async (_label, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = rpcAnswering(
      answer === 'throws' ? Promise.reject(new Error('offline')) : (answer as unknown as LeaveAmendAnswer),
    );

    expect(await amendLeave(client, tableAnswering({ error: null }), ORGANIZATION, MEMBER, RECORD, '2026-09-12', '2026-09-20')).toEqual({
      ok: false,
      code: LEAVE_FAILED,
    });
  });

  it.each([
    ['2026-13-45', '2026-09-14'],
    ['2026-09-10', '2026-02-30'],
    ['', '2026-09-14'],
  ])('refuses %s–%s as failed without a request', async (from, to) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client = rpcAnswering({ data: REPLACEMENT, error: null });

    expect(await amendLeave(client, tableAnswering({ error: null }), ORGANIZATION, MEMBER, RECORD, from, to)).toEqual({
      ok: false,
      code: LEAVE_FAILED,
    });
    expect(client.called).toEqual([]);
  });
});
