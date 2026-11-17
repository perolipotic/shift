import { queryOptions } from '@tanstack/react-query';
import {
  historyReadWindowOf,
  historyUnmatchedRequestIdsOf,
  historyUnnamedMembersOf,
  type AuditOperation,
  type AuditOrigin,
  type AuditRow,
  type HistoryPeriod,
  type HistoryRequestRow,
  type HistoryRequestTableName,
  type HistoryUnnamedMembers,
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
 *
 * THE CURRENT REQUESTS (epic 14 retro A3): a decision whose request has no
 * event in the read names its subject through the request as it stands. Inside
 * the same query, and only when such a decision exists, the request rows are
 * read by primary key under their own `*_select_own_organization` policies, in
 * chunks of {@link HISTORY_REQUEST_CHUNK} ids issued in parallel, with the few columns that name
 * a subject. A refusal or a malformed row makes the whole read unavailable.
 *
 * THE DEPARTED MEMBERS (epic 14 retro A9; AD-11 "Attribution"): the member ids
 * and actors the events name but no `members` row of the read carries are looked up among the organization's `members` DELETE events — by
 * `row_id`, and by the old row's `auth_user_id` for an actor — in chunks of
 * {@link HISTORY_REQUEST_CHUNK}, inside the same query and beside the request
 * read. The calls go out on most loads (a current member with no `members`
 * event in the period is asked for too); the answers hold only the deleted. A member still in the
 * organization is in the current list, so one with neither is deleted, and its
 * DELETE row is its last. These rows name; they are never entries.
 */

/** The table read (0061). */
export const HISTORY_TABLE = 'audit_events';

/** The request tables a decision's subject is read from when its request has no event in the read. */
export const HISTORY_REQUEST_TABLES: readonly HistoryRequestTableName[] = ['leave_requests', 'swap_requests'];

/** The domain's request table name, as this module reads it. */
export type HistoryRequestTable = HistoryRequestTableName;

/** Every table the history query reads. */
export type HistoryTableName = typeof HISTORY_TABLE | HistoryRequestTable;

/**
 * The columns of a request that name its subject: a new, deliberately
 * minimal reader, so no request feature's mapper changes.
 */
export const HISTORY_REQUEST_COLUMNS: Readonly<Record<HistoryRequestTable, string>> = {
  leave_requests: 'id,member_id',
  swap_requests: 'id,proposer_id,addressee_id,team_id,return_team_id',
};

/** How many request ids one call names, keeping the URL short. */
export const HISTORY_REQUEST_CHUNK = 100;

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
  /** The current rows of the requests whose decisions have no request event read (retro A3). */
  readonly requests: readonly HistoryRequestRow[];
  /** The `members` DELETE events of the members the read names but holds no row for (retro A9), by `id`. */
  readonly departed: readonly ReadAuditEvent[];
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
 * A page that repeats an event already read means the cursor did not move
 * (a filter the server ignored): the read is unavailable, never a loop. An
 * aborted `signal` (the period changed, the page left) asks for no further page.
 *
 * @throws Error(HISTORY_UNAVAILABLE) on a refusal, a row that is not an event or a cursor that did not move.
 */
export async function readHistoryEvents(
  table: HistoryTable,
  period: HistoryPeriod,
  signal?: AbortSignal,
): Promise<readonly ReadAuditEvent[]> {
  const window = historyReadWindowOf(period);
  const events: ReadAuditEvent[] = [];
  const seen = new Set<number>();
  let cursor: ReadAuditEvent | null = null;

  for (;;) {
    signal?.throwIfAborted();

    let query = table.select(HISTORY_COLUMNS).gte(OCCURRED_AT, window.from).lt(OCCURRED_AT, window.to);

    if (cursor !== null) query = query.or(historyCursorFilterOf(cursor));

    const page = eventsOf(await query.order(OCCURRED_AT, DESCENDING).order(ID, DESCENDING).limit(HISTORY_PAGE_ROWS));

    for (const event of page) {
      if (seen.has(event.id)) throw new Error(HISTORY_UNAVAILABLE);
      seen.add(event.id);
    }

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

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** The subject columns each request table must hold: required, or `null` allowed. */
const REQUEST_SHAPES: Readonly<Record<HistoryRequestTable, { readonly required: readonly string[]; readonly nullable: readonly string[] }>> = {
  leave_requests: { required: ['member_id'], nullable: [] },
  swap_requests: { required: ['proposer_id', 'addressee_id', 'team_id'], nullable: ['return_team_id'] },
};

/**
 * One request row as read, or `null` when it is not one of the ids asked for
 * with its subject columns: the whole read is then unavailable.
 */
export function readHistoryRequestOf(
  table: HistoryRequestTable,
  row: unknown,
  asked: ReadonlySet<string>,
): HistoryRequestRow | null {
  if (!isRecord(row)) return null;

  const { id } = row;
  const shape = REQUEST_SHAPES[table];

  if (!isText(id) || !asked.has(id)) return null;
  if (!shape.required.every((column) => isText(row[column]))) return null;
  if (!shape.nullable.every((column) => row[column] === null || isText(row[column]))) return null;

  const kept: Record<string, unknown> = { id };

  for (const column of [...shape.required, ...shape.nullable]) kept[column] = row[column];

  return { tableName: table, id, row: kept };
}

/** `all` in runs of {@link HISTORY_REQUEST_CHUNK}, one call each. */
function chunksOf(all: readonly string[]): (readonly string[])[] {
  const chunks: (readonly string[])[] = [];

  for (let start = 0; start < all.length; start += HISTORY_REQUEST_CHUNK) {
    chunks.push(all.slice(start, start + HISTORY_REQUEST_CHUNK));
  }

  return chunks;
}

async function readRequestChunk(
  table: HistoryTable,
  name: HistoryRequestTable,
  chunk: readonly string[],
): Promise<readonly HistoryRequestRow[]> {
  const asked = new Set(chunk);
  const answer = await table.select(HISTORY_REQUEST_COLUMNS[name]).in(ID, chunk).limit(chunk.length);

  if (answer.error !== null || !Array.isArray(answer.data)) throw new Error(HISTORY_UNAVAILABLE);

  return (answer.data as readonly unknown[]).map((raw) => {
    const row = readHistoryRequestOf(name, raw, asked);

    if (row === null) throw new Error(HISTORY_UNAVAILABLE);

    return row;
  });
}

/**
 * The current rows of `ids` in each request table, by primary key,
 * {@link HISTORY_REQUEST_CHUNK} ids a call, every call issued at once. A
 * request no longer there is simply absent. Nothing is asked once `signal`
 * is aborted, and no table with no id is read.
 *
 * @throws Error(HISTORY_UNAVAILABLE) on a refusal or a row that is not one asked for.
 */
export async function readHistoryRequests(
  source: (table: HistoryRequestTable) => HistoryTable,
  ids: Readonly<Record<HistoryRequestTable, readonly string[]>>,
  signal?: AbortSignal,
): Promise<readonly HistoryRequestRow[]> {
  signal?.throwIfAborted();

  const reads = HISTORY_REQUEST_TABLES.flatMap((name) =>
    chunksOf(ids[name]).map((chunk) => readRequestChunk(source(name), name, chunk)),
  );

  return (await Promise.all(reads)).flat();
}

/** The `members` table, whose DELETE events name a departed member. */
const MEMBERS_TABLE_NAME = 'members';
const DELETE: AuditOperation = 'DELETE';
const ROW_ID = 'row_id';
/** A PostgREST JSON path: the deleted row's auth user. */
const OLD_AUTH_USER = 'old_row->>auth_user_id';

async function readDepartedChunk(
  audit: HistoryTable,
  column: typeof ROW_ID | typeof OLD_AUTH_USER,
  chunk: readonly string[],
): Promise<readonly ReadAuditEvent[]> {
  const asked = new Set(chunk);
  const events = eventsOf(
    await audit
      .select(HISTORY_COLUMNS)
      .eq('table_name', MEMBERS_TABLE_NAME)
      .eq('operation', DELETE)
      .in(column, chunk)
      // Newest first, so the latest DELETE of an id comes first. A member row
      // is deleted once, but an auth user could in principle lose a second
      // membership (an operator's delete and re-insert): a page, not
      // `chunk.length`, so no extra row pushes another id's out unseen.
      .order(ID, DESCENDING)
      .limit(HISTORY_PAGE_ROWS),
  );

  if (events.length >= HISTORY_PAGE_ROWS) throw new Error(HISTORY_UNAVAILABLE);

  for (const event of events) {
    const key = column === ROW_ID ? event.rowId : event.oldRow?.['auth_user_id'];

    if (event.tableName !== MEMBERS_TABLE_NAME || event.operation !== DELETE || typeof key !== 'string' || !asked.has(key)) {
      throw new Error(HISTORY_UNAVAILABLE);
    }
  }

  return events;
}

/**
 * The organization's `members` DELETE events of `unnamed`'s member ids (by
 * `row_id`) and actors (by the old row's `auth_user_id`),
 * {@link HISTORY_REQUEST_CHUNK} a call, every call issued at once, each event
 * once, oldest first by `id`. No call when nobody is unnamed, nor when `signal`
 * is already aborted; calls already issued are not cancelled (they are few and small).
 *
 * @throws Error(HISTORY_UNAVAILABLE) on a refusal or a row that is not a DELETE asked for.
 */
export async function readHistoryDeparted(
  audit: HistoryTable,
  unnamed: HistoryUnnamedMembers,
  signal?: AbortSignal,
): Promise<readonly ReadAuditEvent[]> {
  signal?.throwIfAborted();

  const reads = [
    ...chunksOf(unnamed.memberIds).map((chunk) => readDepartedChunk(audit, ROW_ID, chunk)),
    ...chunksOf(unnamed.authUserIds).map((chunk) => readDepartedChunk(audit, OLD_AUTH_USER, chunk)),
  ];
  const byId = new Map<number, ReadAuditEvent>();

  for (const event of (await Promise.all(reads)).flat()) byId.set(event.id, event);

  // Oldest first by `id`: `memberIdentitiesOf` reads them in this order, later winning; the hook
  // reverses them for `namesFrom`, which reads newest first. Both end on the newest DELETE.
  return [...byId.values()].sort((first, second) => first.id - second.id);
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
export function historyQueryOptions(source: (table: HistoryTableName) => HistoryTable, period: HistoryPeriod) {
  return queryOptions({
    queryKey: historyKeyOf(period),
    queryFn: async ({ signal }): Promise<HistoryRead> => {
      const audit = source(HISTORY_TABLE);
      const [events, markers] = await Promise.all([
        readHistoryEvents(audit, period, signal),
        readHistoryMarkers(audit),
      ]);
      // Only the decisions whose request has no event read, and the members
      // the events name but cannot: none, no read. Both at once.
      const [requests, departed] = await Promise.all([
        readHistoryRequests(source, historyUnmatchedRequestIdsOf(events), signal),
        readHistoryDeparted(audit, historyUnnamedMembersOf(events), signal),
      ]);

      return { events, markers, requests, departed };
    },
    staleTime: 0,
    retry: 1,
    retryDelay: 1000,
  });
}
