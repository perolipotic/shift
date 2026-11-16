import { queryOptions } from '@tanstack/react-query';
import {
  historyReadWindowOf,
  type AuditOperation,
  type AuditOrigin,
  type AuditRow,
  type HistoryPeriod,
} from '@shift/domain';

/**
 * THE CHANGE HISTORY'S ONE READ (story 14.2; AD-11 "Reading it"): a direct
 * PostgREST select of `audit_events` under RLS — no RPC, no view — of one
 * period, newest first, keyset-paged on the raw `(occurred_at, id)`, plus the
 * organization's `HISTORY_BEGINS` and own `INSERT` events.
 *
 * THE CURSOR IS NEVER A `Date`. `occurred_at` carries microseconds a JS
 * `Date` drops, so the next page is asked for with the string exactly as
 * PostgREST sent it, and the `id` as read: `occurred_at < c` or
 * `occurred_at = c and id < i`, which the index
 * `(organization_id, occurred_at desc, id desc)` serves.
 *
 * NEVER KEPT ON THE DEVICE. {@link HISTORY_KEY_ROOT} is in neither of the
 * persisted key lists (`@/lib/offline/persistence`), and no route that reads
 * it is offline-readable: history holds departed members' details, and the
 * offline role guard trusts a cached role (AD-11).
 *
 * ONE SNAPSHOT PER PERIOD (AD-13): the whole period is read afresh on every
 * load — no incremental cache — so an event that committed behind the cursor
 * during a multi-page read is on the next read (focus, reconnect, retry or a
 * period change).
 */

/** The table read (0061). */
export const HISTORY_TABLE = 'audit_events';

/** The query key's root. Never persisted. */
export const HISTORY_KEY_ROOT = 'change-history';

/** Every column but the organization, which RLS already fixes. */
export const HISTORY_COLUMNS =
  'id,table_name,operation,row_id,old_row,new_row,actor,session_role,origin,transaction_id,occurred_at';

/** PostgREST's `max_rows` (supabase/config.toml): a page holds at most this many. */
export const HISTORY_PAGE_ROWS = 1000;

/** How many marker candidates are read: an organization has one marker and one INSERT at most. */
export const HISTORY_MARKER_ROWS = 10;

/** The history could not be read, or what came back cannot be trusted. */
export const HISTORY_UNAVAILABLE = 'HISTORY_UNAVAILABLE';

const OCCURRED_AT = 'occurred_at';
const ID = 'id';
const DESCENDING = { ascending: false } as const;
const ASCENDING = { ascending: true } as const;

/** As much of a PostgREST answer as this module reads. */
export interface HistoryAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly code?: string | undefined } | null;
}

/** The calls made on `audit_events`, named structurally so they can be stubbed. `select` alone: nothing writes. */
export interface HistoryQuery {
  gte(column: string, value: string): HistoryQuery;
  lt(column: string, value: string): HistoryQuery;
  eq(column: string, value: string): HistoryQuery;
  in(column: string, values: readonly string[]): HistoryQuery;
  or(filters: string): HistoryQuery;
  order(column: string, options: { readonly ascending: boolean }): HistoryQuery;
  limit(count: number): PromiseLike<HistoryAnswer>;
}

export interface HistoryTable {
  select(columns: string): HistoryQuery;
}

/** One event as read, before its zone day is known. */
export interface ReadAuditEvent {
  readonly id: number;
  readonly tableName: string;
  readonly operation: AuditOperation;
  readonly rowId: string;
  readonly oldRow: AuditRow | null;
  readonly newRow: AuditRow | null;
  readonly actor: string | null;
  readonly sessionRole: string;
  readonly origin: AuditOrigin;
  readonly transactionId: string | null;
  /** Exactly as PostgREST sent it. */
  readonly occurredAt: string;
}

/** What one period's read answers. */
export interface HistoryRead {
  /** The period's events, newest first by `(occurred_at, id)`. */
  readonly events: readonly ReadAuditEvent[];
  /** The organization's `HISTORY_BEGINS` and `organizations` `INSERT` events, oldest first. */
  readonly markers: readonly ReadAuditEvent[];
}

const OPERATIONS: readonly AuditOperation[] = ['INSERT', 'UPDATE', 'DELETE', 'HISTORY_BEGINS'];
const ORIGINS: readonly AuditOrigin[] = ['trigger', 'backfill'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowOf(value: unknown): AuditRow | null | undefined {
  if (value === null) return null;

  return isRecord(value) ? value : undefined;
}

/**
 * One row as an event, or `null` when it is not one: a malformed row makes
 * the whole read unavailable, never a partial history. A table this build
 * does not know is NOT malformed: the domain draws it as an `other` record
 * with raw fields, so an audited table shipped before the SPA never breaks
 * the history.
 */
export function readAuditEventOf(row: unknown): ReadAuditEvent | null {
  if (!isRecord(row)) return null;

  const {
    id,
    table_name: tableName,
    operation,
    row_id: rowId,
    old_row: rawOld,
    new_row: rawNew,
    actor,
    session_role: sessionRole,
    origin,
    transaction_id: transactionId,
    occurred_at: occurredAt,
  } = row;
  const oldRow = rowOf(rawOld);
  const newRow = rowOf(rawNew);
  const knownOperation = OPERATIONS.find((candidate) => candidate === operation);
  const knownOrigin = ORIGINS.find((candidate) => candidate === origin);
  const numericId = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;

  if (
    typeof numericId !== 'number' ||
    !Number.isSafeInteger(numericId) ||
    typeof tableName !== 'string' ||
    knownOperation === undefined ||
    typeof rowId !== 'string' ||
    oldRow === undefined ||
    newRow === undefined ||
    (actor !== null && typeof actor !== 'string') ||
    typeof sessionRole !== 'string' ||
    knownOrigin === undefined ||
    (transactionId !== null && typeof transactionId !== 'string' && typeof transactionId !== 'number') ||
    typeof occurredAt !== 'string' ||
    // Read as an instant once, for its zone day; the cursor keeps the string.
    Number.isNaN(Date.parse(occurredAt))
  ) {
    return null;
  }

  return {
    id: numericId,
    tableName,
    operation: knownOperation,
    rowId,
    oldRow,
    newRow,
    actor,
    sessionRole,
    origin: knownOrigin,
    transactionId: transactionId === null ? null : String(transactionId),
    occurredAt,
  };
}

function eventsOf(answer: HistoryAnswer): ReadAuditEvent[] {
  if (answer.error !== null || !Array.isArray(answer.data)) throw new Error(HISTORY_UNAVAILABLE);

  return (answer.data as readonly unknown[]).map((row) => {
    const event = readAuditEventOf(row);

    if (event === null) throw new Error(HISTORY_UNAVAILABLE);

    return event;
  });
}

/** The next page's filter: strictly after the cursor in `(occurred_at desc, id desc)` order. */
export function historyCursorFilterOf(cursor: Pick<ReadAuditEvent, 'occurredAt' | 'id'>): string {
  const at = `"${cursor.occurredAt}"`;

  return `${OCCURRED_AT}.lt.${at},and(${OCCURRED_AT}.eq.${at},${ID}.lt.${String(cursor.id)})`;
}

/**
 * Every event of the padded window of `period`, newest first: pages of
 * {@link HISTORY_PAGE_ROWS} by keyset, stopping at the first short page.
 *
 * @throws Error(HISTORY_UNAVAILABLE) on a refusal or a row that is not an event.
 */
export async function readHistoryEvents(table: HistoryTable, period: HistoryPeriod): Promise<readonly ReadAuditEvent[]> {
  const window = historyReadWindowOf(period);
  const events: ReadAuditEvent[] = [];
  let cursor: ReadAuditEvent | null = null;

  for (;;) {
    let query = table.select(HISTORY_COLUMNS).gte(OCCURRED_AT, window.from).lt(OCCURRED_AT, window.to);

    if (cursor !== null) query = query.or(historyCursorFilterOf(cursor));

    const page = eventsOf(await query.order(OCCURRED_AT, DESCENDING).order(ID, DESCENDING).limit(HISTORY_PAGE_ROWS));

    events.push(...page);

    // A short page is the last one, so nothing is asked past the end.
    if (page.length < HISTORY_PAGE_ROWS) break;

    cursor = page[page.length - 1] ?? null;
    if (cursor === null) break;
  }

  return events;
}

/** The organization's marker and own INSERT events, whatever the period. */
export async function readHistoryMarkers(table: HistoryTable): Promise<readonly ReadAuditEvent[]> {
  return eventsOf(
    await table
      .select(HISTORY_COLUMNS)
      .eq('table_name', 'organizations')
      .in('operation', ['HISTORY_BEGINS', 'INSERT'])
      .order(ID, ASCENDING)
      .limit(HISTORY_MARKER_ROWS),
  );
}

/** One period's snapshot key: `[root, from, to]`. */
export function historyKeyOf(period: HistoryPeriod): readonly [typeof HISTORY_KEY_ROOT, string, string] {
  return [HISTORY_KEY_ROOT, period.from, period.to];
}

/**
 * The one query definition of a period's history. Rejects with
 * {@link HISTORY_UNAVAILABLE} on any failure, so TanStack retries once and
 * the screen draws its unavailable notice. Never fresh for long: each load
 * reads the period afresh.
 */
export function historyQueryOptions(table: () => HistoryTable, period: HistoryPeriod) {
  return queryOptions({
    queryKey: historyKeyOf(period),
    queryFn: async (): Promise<HistoryRead> => {
      const source = table();
      const [events, markers] = await Promise.all([readHistoryEvents(source, period), readHistoryMarkers(source)]);

      return { events, markers };
    },
    staleTime: 0,
    retry: 1,
    retryDelay: 1000,
  });
}
