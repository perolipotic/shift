import { describe, expect, it } from 'vitest';

import { persistsKey } from '@/lib/offline/persistence';
import {
  HISTORY_COLUMNS,
  HISTORY_KEY_ROOT,
  HISTORY_PAGE_ROWS,
  HISTORY_REQUEST_CHUNK,
  HISTORY_UNAVAILABLE,
  historyCursorFilterOf,
  historyKeyOf,
  historyQueryOptions,
  readAuditEventOf,
  readHistoryDeparted,
  readHistoryEvents,
  readHistoryMarkers,
  type HistoryAnswer,
  type HistoryQuery,
  type HistoryRead,
  type HistoryTable,
  type HistoryTableName,
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

describe('a decision whose request has no event read is named through the request as it stands (retro A3)', () => {
  /** A decision event of `table` for request `rowId`. */
  function decisionRow(id: number, table: string, rowId: string): Record<string, unknown> {
    return {
      ...row(id),
      table_name: table,
      row_id: rowId,
      new_row: { request_id: rowId, outcome: 'rejected' },
    };
  }

  interface SourceCall {
    readonly table: HistoryTableName;
    readonly columns: string;
    readonly steps: string[];
  }

  /**
   * A stubbed source: `audit_events` answers `events` then the markers (none);
   * each request table answers from `requests`, filtered by the ids asked for,
   * or `refusal` when set.
   */
  function source(
    events: readonly Record<string, unknown>[],
    requests: Partial<Record<HistoryTableName, readonly Record<string, unknown>[]>>,
    refusal?: HistoryTableName,
  ): { source: (table: HistoryTableName) => HistoryTable; calls: SourceCall[] } {
    const calls: SourceCall[] = [];

    return {
      calls,
      source: (table) => ({
        select(columns) {
          const call: SourceCall = { table, columns, steps: [] };
          let ids: readonly string[] = [];
          let marker = false;

          calls.push(call);

          const query: HistoryQuery = {
            gte: (column, value) => (call.steps.push(`gte ${column} ${value}`), query),
            lt: (column, value) => (call.steps.push(`lt ${column} ${value}`), query),
            eq: (column, value) => (call.steps.push(`eq ${column} ${value}`), (marker = true), query),
            in: (column, values) => (call.steps.push(`in ${column} ${String(values.length)}`), (ids = values), query),
            or: () => query,
            order: () => query,
            limit: (count) => {
              call.steps.push(`limit ${String(count)}`);

              if (table === refusal) return Promise.resolve({ data: null, error: { code: '42501' } });
              if (table === 'audit_events') return Promise.resolve({ data: marker ? [] : events, error: null });

              const rows = (requests[table] ?? []).filter((candidate) => ids.includes(String(candidate['id'])));

              return Promise.resolve({ data: rows, error: null });
            },
          };

          return query;
        },
      }),
    };
  }

  async function read(stub: ReturnType<typeof source>): Promise<HistoryRead> {
    const options = historyQueryOptions(stub.source, PERIOD);
    const queryFn = options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<HistoryRead>;

    return queryFn({ signal: new AbortController().signal });
  }

  it('reads the current rows of the unmatched requests, by id, with the subject columns alone', async () => {
    const stub = source(
      [decisionRow(3, 'leave_request_decisions', 'req-1'), decisionRow(2, 'swap_request_decisions', 'swap-1')],
      {
        leave_requests: [{ id: 'req-1', member_id: 'member-ana' }],
        swap_requests: [
          { id: 'swap-1', proposer_id: 'member-ana', addressee_id: 'member-ivo', team_id: 'team-a', return_team_id: null },
        ],
      },
    );

    const answer = await read(stub);

    expect(answer.requests).toEqual([
      { tableName: 'leave_requests', id: 'req-1', row: { id: 'req-1', member_id: 'member-ana' } },
      {
        tableName: 'swap_requests',
        id: 'swap-1',
        row: { id: 'swap-1', proposer_id: 'member-ana', addressee_id: 'member-ivo', team_id: 'team-a', return_team_id: null },
      },
    ]);
    expect(stub.calls.filter((call) => call.table === 'leave_requests')).toEqual([
      { table: 'leave_requests', columns: 'id,member_id', steps: ['in id 1', 'limit 1'] },
    ]);
    expect(stub.calls.find((call) => call.table === 'swap_requests')?.columns).toBe(
      'id,proposer_id,addressee_id,team_id,return_team_id',
    );
  });

  it('issues no request read when every decision\'s request has an event read', async () => {
    const request = { ...row(4), table_name: 'leave_requests', row_id: 'req-1', new_row: { id: 'req-1', member_id: 'm' } };
    const stub = source([decisionRow(5, 'leave_request_decisions', 'req-1'), request], {});

    expect((await read(stub)).requests).toEqual([]);
    expect(stub.calls.filter((call) => call.table !== 'audit_events')).toEqual([]);
    // The events, the markers, and the departed read (retro A9) of the member id and the actor no `members` row names.
    expect(stub.calls).toHaveLength(4);
  });

  it('leaves a request no longer there absent, and the read whole', async () => {
    const stub = source([decisionRow(5, 'leave_request_decisions', 'req-gone')], { leave_requests: [] });

    expect((await read(stub)).requests).toEqual([]);
  });

  it(`asks for at most ${String(HISTORY_REQUEST_CHUNK)} ids a call, every call at once`, async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `req-${String(index)}`);
    const stub = source(
      ids.map((id, index) => decisionRow(1000 - index, 'leave_request_decisions', id)),
      { leave_requests: ids.map((id) => ({ id, member_id: 'member-ana' })) },
    );

    expect((await read(stub)).requests).toHaveLength(250);
    expect(stub.calls.filter((call) => call.table === 'leave_requests').map((call) => call.steps[0])).toEqual([
      'in id 100',
      'in id 100',
      'in id 50',
    ]);
  });

  it('issues every request chunk before any answers', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `req-${String(index)}`);
    const events = ids.map((id, index) => decisionRow(1000 - index, 'leave_request_decisions', id));
    let asked = 0;
    let answer: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const audit = source(events, {});
    const options = historyQueryOptions(
      (table) =>
        table === 'audit_events'
          ? audit.source(table)
          : {
              select: () => {
                const query: HistoryQuery = {
                  gte: () => query,
                  lt: () => query,
                  eq: () => query,
                  in: () => query,
                  or: () => query,
                  order: () => query,
                  limit: () => {
                    asked += 1;
                    return pending.then(() => ({ data: [], error: null }));
                  },
                };

                return query;
              },
            },
      PERIOD,
    );
    const queryFn = options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<HistoryRead>;
    const read = queryFn({ signal: new AbortController().signal });

    await expect.poll(() => asked).toBe(2);
    answer?.();
    expect((await read).requests).toEqual([]);
  });

  it('asks for no request once the read is aborted', async () => {
    const controller = new AbortController();
    const stub = source([decisionRow(5, 'leave_request_decisions', 'req-1')], {});
    const options = historyQueryOptions(stub.source, PERIOD);
    const queryFn = options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<HistoryRead>;
    const read = queryFn({ signal: controller.signal });

    controller.abort();

    await expect(read).rejects.toThrow();
    expect(stub.calls.map((call) => call.table)).not.toContain('leave_requests');
  });

  it('makes the whole read unavailable when a request read is refused', async () => {
    const stub = source([decisionRow(5, 'leave_request_decisions', 'req-1')], {}, 'leave_requests');

    await expect(read(stub)).rejects.toThrow(HISTORY_UNAVAILABLE);
  });

  it.each([
    ['a member that is not text', { id: 'req-1', member_id: 7 }],
    ['an id not asked for', { id: 'req-9', member_id: 'member-ana' }],
    ['no member', { id: 'req-1' }],
  ])('makes the whole read unavailable on %s', async (_, request) => {
    // The audit table alone comes from the stub; the request table answers `request` as sent.
    const stub = source([decisionRow(5, 'leave_request_decisions', 'req-1')], {});
    const options = historyQueryOptions(
      (table) =>
        table === 'leave_requests'
          ? {
              select: () => {
                const query: HistoryQuery = {
                  gte: () => query,
                  lt: () => query,
                  eq: () => query,
                  in: () => query,
                  or: () => query,
                  order: () => query,
                  limit: () => Promise.resolve({ data: [request], error: null }),
                };

                return query;
              },
            }
          : stub.source(table),
      PERIOD,
    );
    const queryFn = options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<HistoryRead>;

    await expect(queryFn({ signal: new AbortController().signal })).rejects.toThrow(HISTORY_UNAVAILABLE);
  });

  it('makes the whole read unavailable on a swap request missing its team', async () => {
    const stub = source([decisionRow(5, 'swap_request_decisions', 'swap-1')], {
      swap_requests: [{ id: 'swap-1', proposer_id: 'a', addressee_id: 'b', team_id: null, return_team_id: null }],
    });

    await expect(read(stub)).rejects.toThrow(HISTORY_UNAVAILABLE);
  });
});

describe('a departed member is named from their DELETE event, read inside the same query (retro A9)', () => {
  /** A `members` DELETE event as PostgREST sends it. */
  function deleted(id: number, memberId: string, authUserId: string): Record<string, unknown> {
    return {
      ...row(id),
      table_name: 'members',
      operation: 'DELETE',
      row_id: memberId,
      old_row: { id: memberId, auth_user_id: authUserId, name: `Name ${memberId}` },
      new_row: null,
      actor: null,
      session_role: 'postgres',
    };
  }

  /**
   * `audit_events`: the period's `events` (a call with `gte`), no marker, and
   * for a `members` DELETE call the `departed` rows whose asked column holds
   * an asked id, or `answer` when set.
   */
  function audit(
    events: readonly Record<string, unknown>[],
    departed: readonly Record<string, unknown>[],
    answer?: HistoryAnswer,
  ): { table: HistoryTable; calls: Call[] } {
    const calls: Call[] = [];

    const table: HistoryTable = {
      select(columns) {
        const call: Call = { columns, steps: [] };
        let asked: { column: string; ids: readonly string[] } | null = null;

        calls.push(call);

        const query: HistoryQuery = {
          gte: (column, value) => (call.steps.push(`gte ${column} ${value}`), query),
          lt: (column, value) => (call.steps.push(`lt ${column} ${value}`), query),
          eq: (column, value) => (call.steps.push(`eq ${column} ${value}`), query),
          in: (column, values) => (
            call.steps.push(`in ${column} ${String(values.length)}`), (asked = { column, ids: values }), query
          ),
          or: () => query,
          order: (column, options) => (call.steps.push(`order ${column} ${options.ascending ? 'asc' : 'desc'}`), query),
          limit: (count) => {
            call.steps.push(`limit ${String(count)}`);

            if (call.steps.some((step) => step.startsWith('gte'))) return Promise.resolve({ data: events, error: null });
            if (!call.steps.includes('eq table_name members')) return Promise.resolve({ data: [], error: null });
            if (answer !== undefined) return Promise.resolve(answer);

            const { column, ids } = asked ?? { column: '', ids: [] };
            const found = departed.filter((candidate) => {
              const key =
                column === 'row_id'
                  ? candidate['row_id']
                  : (candidate['old_row'] as Record<string, unknown> | null)?.['auth_user_id'];

              return typeof key === 'string' && ids.includes(key);
            });

            return Promise.resolve({ data: found, error: null });
          },
        };

        return query;
      },
    };

    return { table, calls };
  }

  async function read(table: HistoryTable): Promise<HistoryRead> {
    const options = historyQueryOptions(() => table, PERIOD);
    const queryFn = options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<HistoryRead>;

    return queryFn({ signal: new AbortController().signal });
  }

  const written = {
    ...row(20),
    table_name: 'leave_records',
    row_id: 'leave-1',
    new_row: { id: 'leave-1', member_id: 'member-gone' },
    actor: 'auth-gone',
  };

  it('reads the DELETE events by row_id for member ids and by the old auth user for actors, each once', async () => {
    const { table, calls } = audit([written], [deleted(7, 'member-gone', 'auth-gone')]);

    const answer = await read(table);

    expect(answer.departed.map((event) => event.id)).toEqual([7]);
    expect(answer.departed[0]?.oldRow).toEqual({ id: 'member-gone', auth_user_id: 'auth-gone', name: 'Name member-gone' });

    const departedCalls = calls.filter((call) => call.steps.includes('eq table_name members'));

    expect(departedCalls).toEqual([
      {
        columns: HISTORY_COLUMNS,
        steps: ['eq table_name members', 'eq operation DELETE', 'in row_id 1', 'order id desc', 'limit 1000'],
      },
      {
        columns: HISTORY_COLUMNS,
        steps: ['eq table_name members', 'eq operation DELETE', 'in old_row->>auth_user_id 1', 'order id desc', 'limit 1000'],
      },
    ]);
  });

  it('issues no departed read when the read names everybody', async () => {
    const member = {
      ...row(21),
      table_name: 'members',
      row_id: 'member-ana',
      new_row: { id: 'member-ana', auth_user_id: 'auth-ana', name: 'Ana' },
    };
    const leave = { ...written, new_row: { id: 'leave-1', member_id: 'member-ana' }, actor: 'auth-ana' };
    const { table, calls } = audit([leave, member], []);

    expect((await read(table)).departed).toEqual([]);
    expect(calls.filter((call) => call.steps.includes('eq table_name members'))).toEqual([]);
  });

  it(`asks for at most ${String(HISTORY_REQUEST_CHUNK)} ids a call`, async () => {
    const memberIds = Array.from({ length: 250 }, (_, index) => `member-${String(index)}`);
    const { table, calls } = audit([], []);

    await readHistoryDeparted(table, { memberIds, authUserIds: [] });

    expect(calls.map((call) => call.steps.find((step) => step.startsWith('in ')))).toEqual([
      'in row_id 100',
      'in row_id 100',
      'in row_id 50',
    ]);
  });

  it('makes the whole read unavailable on a refusal', async () => {
    const { table } = audit([written], [], { data: null, error: { code: '42501' } });

    await expect(read(table)).rejects.toThrow(HISTORY_UNAVAILABLE);
  });

  it('makes the whole read unavailable on a row that is not a DELETE of an id asked for', async () => {
    const insert = { ...deleted(8, 'member-gone', 'auth-gone'), operation: 'INSERT', old_row: null, new_row: {} };
    const stranger = deleted(9, 'member-stranger', 'auth-stranger');

    await expect(read(audit([written], [], { data: [insert], error: null }).table)).rejects.toThrow(HISTORY_UNAVAILABLE);
    await expect(read(audit([written], [], { data: [stranger], error: null }).table)).rejects.toThrow(
      HISTORY_UNAVAILABLE,
    );
  });

  it('makes the whole read unavailable on a full page, never a silently cut answer', async () => {
    const full = Array.from({ length: HISTORY_PAGE_ROWS }, (_, index) => deleted(index + 1, 'member-gone', 'auth-gone'));

    await expect(read(audit([written], [], { data: full, error: null }).table)).rejects.toThrow(HISTORY_UNAVAILABLE);
  });

  it('asks for nothing once the read is aborted', async () => {
    const { table, calls } = audit([], []);
    const controller = new AbortController();

    controller.abort();

    await expect(readHistoryDeparted(table, { memberIds: ['m'], authUserIds: [] }, controller.signal)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
