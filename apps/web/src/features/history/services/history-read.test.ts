import { describe, expect, it } from 'vitest';

import { persistsKey } from '@/lib/offline/persistence';
import {
  HISTORY_COLUMNS,
  HISTORY_KEY_ROOT,
  HISTORY_PAGE_ROWS,
  HISTORY_UNAVAILABLE,
  historyCursorFilterOf,
  historyKeyOf,
  historyQueryOptions,
  readAuditEventOf,
  readHistoryEvents,
  readHistoryMarkers,
  type HistoryAnswer,
  type HistoryQuery,
  type HistoryTable,
} from '@/features/history/services/history-read';

const PERIOD = { from: '2026-11-01', to: '2026-11-30' };

/** A raw `audit_events` row as PostgREST sends it. */
function row(id: number, occurredAt = '2026-11-10T08:00:00.123456+00:00'): Record<string, unknown> {
  return {
    id,
    table_name: 'teams',
    operation: 'INSERT',
    row_id: `team-${id}`,
    old_row: null,
    new_row: { id: `team-${id}`, name: `T${id}` },
    actor: 'auth-ana',
    session_role: 'authenticated',
    origin: 'trigger',
    transaction_id: String(5000 + id),
    occurred_at: occurredAt,
  };
}

interface Call {
  readonly columns: string;
  readonly steps: string[];
}

/** A stubbed table: each `limit` answers the next page, and every call is recorded. */
function stubbed(pages: readonly HistoryAnswer[]): { table: HistoryTable; calls: Call[] } {
  const calls: Call[] = [];
  let page = 0;

  const table: HistoryTable = {
    select(columns) {
      const call: Call = { columns, steps: [] };

      calls.push(call);

      const query: HistoryQuery = {
        gte: (column, value) => (call.steps.push(`gte ${column} ${value}`), query),
        lt: (column, value) => (call.steps.push(`lt ${column} ${value}`), query),
        eq: (column, value) => (call.steps.push(`eq ${column} ${value}`), query),
        in: (column, values) => (call.steps.push(`in ${column} ${values.join('|')}`), query),
        or: (filters) => (call.steps.push(`or ${filters}`), query),
        order: (column, options) => (call.steps.push(`order ${column} ${options.ascending ? 'asc' : 'desc'}`), query),
        limit: (count) => {
          call.steps.push(`limit ${String(count)}`);
          const answer = pages[page] ?? { data: [], error: null };

          page += 1;
          return Promise.resolve(answer);
        },
      };

      return query;
    },
  };

  return { table, calls };
}

function rows(from: number, count: number, occurredAt?: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => row(from - index, occurredAt));
}

describe('one period is read by keyset on the raw (occurred_at, id)', () => {
  it('reads 2500 events in three pages, and stops at the short one', async () => {
    const { table, calls } = stubbed([
      { data: rows(3000, 1000), error: null },
      { data: rows(2000, 1000), error: null },
      { data: rows(1000, 500), error: null },
    ]);

    const events = await readHistoryEvents(table, PERIOD);

    expect(events).toHaveLength(2500);
    expect(new Set(events.map((event) => event.id)).size).toBe(2500);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.columns).toBe(HISTORY_COLUMNS);
    expect(calls[0]?.steps).toEqual([
      'gte occurred_at 2026-10-31T00:00:00Z',
      'lt occurred_at 2026-12-02T00:00:00Z',
      'order occurred_at desc',
      'order id desc',
      `limit ${String(HISTORY_PAGE_ROWS)}`,
    ]);
    expect(calls[1]?.steps).toContain(
      'or occurred_at.lt."2026-11-10T08:00:00.123456+00:00",and(occurred_at.eq."2026-11-10T08:00:00.123456+00:00",id.lt.2001)',
    );
  });

  it('keeps the cursor the raw string, microseconds and offset as sent, never through a Date', () => {
    expect(historyCursorFilterOf({ occurredAt: '2026-11-10T08:00:00.000001+01:00', id: 42 })).toBe(
      'occurred_at.lt."2026-11-10T08:00:00.000001+01:00",and(occurred_at.eq."2026-11-10T08:00:00.000001+01:00",id.lt.42)',
    );
  });

  it('asks for exactly one page when the first is short, and one more when it is exactly full', async () => {
    const short = stubbed([{ data: rows(10, 3), error: null }]);

    expect(await readHistoryEvents(short.table, PERIOD)).toHaveLength(3);
    expect(short.calls).toHaveLength(1);

    const full = stubbed([{ data: rows(1000, 1000), error: null }, { data: [], error: null }]);

    expect(await readHistoryEvents(full.table, PERIOD)).toHaveLength(1000);
    expect(full.calls).toHaveLength(2);
  });

  it('rejects with the code on a refusal or a row that is not an event', async () => {
    await expect(readHistoryEvents(stubbed([{ data: null, error: { code: '42501' } }]).table, PERIOD)).rejects.toThrow(
      HISTORY_UNAVAILABLE,
    );
    await expect(
      readHistoryEvents(stubbed([{ data: [{ ...row(1), operation: 'TRUNCATE' }], error: null }]).table, PERIOD),
    ).rejects.toThrow(HISTORY_UNAVAILABLE);
  });

  it('rejects the whole read when a middle page fails, never a partial history', async () => {
    const { table, calls } = stubbed([
      { data: rows(3000, 1000), error: null },
      { data: null, error: { code: '57014' } },
      { data: rows(1000, 10), error: null },
    ]);

    await expect(readHistoryEvents(table, PERIOD)).rejects.toThrow(HISTORY_UNAVAILABLE);
    expect(calls).toHaveLength(2);
  });

  it('rejects a page that repeats an event already read, never looping on a cursor that did not move', async () => {
    const { table, calls } = stubbed([
      { data: rows(3000, 1000), error: null },
      { data: rows(3000, 1000), error: null },
      { data: rows(3000, 1000), error: null },
    ]);

    await expect(readHistoryEvents(table, PERIOD)).rejects.toThrow(HISTORY_UNAVAILABLE);
    expect(calls).toHaveLength(2);
  });

  it('asks for no further page once the read is aborted', async () => {
    const controller = new AbortController();
    const pages: HistoryAnswer[] = [{ data: rows(3000, 1000), error: null }, { data: rows(2000, 10), error: null }];
    const { table, calls } = stubbed(pages);
    const read = readHistoryEvents(table, PERIOD, controller.signal);

    controller.abort();

    await expect(read).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('rejects the period when the marker read fails though the events read answers', async () => {
    let call = 0;
    const answers: HistoryAnswer[] = [
      { data: rows(10, 3), error: null },
      { data: null, error: { code: '42501' } },
    ];
    const table: HistoryTable = {
      select() {
        const answer = answers[call] ?? { data: [], error: null };

        call += 1;

        const query: HistoryQuery = {
          gte: () => query,
          lt: () => query,
          eq: () => query,
          in: () => query,
          or: () => query,
          order: () => query,
          limit: () => Promise.resolve(answer),
        };

        return query;
      },
    };
    const options = historyQueryOptions(() => table, PERIOD);
    const queryFn = options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<unknown>;

    await expect(queryFn({ signal: new AbortController().signal })).rejects.toThrow(HISTORY_UNAVAILABLE);
  });

  it('carries on past a page boundary whose next rows share the last row\'s instant, by id', async () => {
    const shared = '2026-11-10T08:00:00.654321+00:00';
    const { table, calls } = stubbed([
      { data: rows(2000, 1000, shared), error: null },
      { data: rows(1000, 4, shared), error: null },
    ]);

    const events = await readHistoryEvents(table, PERIOD);

    expect(events).toHaveLength(1004);
    expect(calls[1]?.steps).toContain(
      `or occurred_at.lt."${shared}",and(occurred_at.eq."${shared}",id.lt.1001)`,
    );
  });

  it('reads the marker and the organization insert, oldest first', async () => {
    const { table, calls } = stubbed([{ data: [], error: null }]);

    await readHistoryMarkers(table);

    expect(calls[0]?.steps).toEqual([
      'eq table_name organizations',
      'in operation HISTORY_BEGINS|INSERT',
      'order id asc',
      'limit 10',
    ]);
  });
});

describe('a row is an event, or the read is unavailable', () => {
  it('reads a table this build does not know as an event, never a failed read', () => {
    expect(readAuditEventOf({ ...row(5), table_name: 'audited_later' })?.tableName).toBe('audited_later');
  });

  it('parses every column, the transaction id as text', () => {
    expect(readAuditEventOf({ ...row(7), transaction_id: 123 })).toEqual({
      id: 7,
      tableName: 'teams',
      operation: 'INSERT',
      rowId: 'team-7',
      oldRow: null,
      newRow: { id: 'team-7', name: 'T7' },
      actor: 'auth-ana',
      sessionRole: 'authenticated',
      origin: 'trigger',
      transactionId: '123',
      occurredAt: '2026-11-10T08:00:00.123456+00:00',
    });
    expect(readAuditEventOf({ ...row(8), id: '8', origin: 'backfill', transaction_id: null })?.id).toBe(8);
  });

  it.each([
    ['an unknown origin', { origin: 'manual' }],
    ['a row that is not an object', { new_row: [1] }],
    ['a missing instant', { occurred_at: '' }],
    ['an instant that is not one', { occurred_at: 'yesterday' }],
    ['an unsafe id', { id: 2 ** 60 }],
    ['an actor that is not text', { actor: 3 }],
  ])('refuses %s', (_, override) => {
    expect(readAuditEventOf({ ...row(9), ...override })).toBeNull();
  });
});

describe('the history is never kept on the device', () => {
  it('keys a period [root, from, to], and no such key is persisted', () => {
    expect(historyKeyOf(PERIOD)).toEqual([HISTORY_KEY_ROOT, '2026-11-01', '2026-11-30']);
    expect(persistsKey(historyKeyOf(PERIOD))).toBe(false);
    expect(persistsKey([HISTORY_KEY_ROOT])).toBe(false);
  });

  it('retries once and is never fresh', () => {
    const options = historyQueryOptions(() => stubbed([]).table, PERIOD);

    expect(options.retry).toBe(1);
    expect(options.staleTime).toBe(0);
  });
});
