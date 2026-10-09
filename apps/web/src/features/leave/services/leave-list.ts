import { queryOptions } from '@tanstack/react-query';
import type { LeaveRange } from '@shift/domain';

import { leaveRangeOf } from '@/features/leave/services/leave-write';

/**
 * The table the records are read from, named where they are read, so a
 * feature that reads them needs no import from the write module.
 */
export { LEAVE_RECORDS_TABLE } from '@/features/leave/services/leave-write';

/**
 * One member's live leave records (story 5.1c) — the read beside
 * `leave-write.ts`, in a `.ts` that renders nothing (AD-15).
 *
 * READ, NEVER COMPUTED: each row's `during` is parsed by `leaveRangeOf` into
 * the inclusive range it records, and what the records cost is
 * `packages/domain`'s question alone. A removed record (`removed_at` set) is
 * not read.
 *
 * NEVER A GUESS. A row of another member, a range that does not parse, or two
 * records sharing a date — which 0028 refuses — make the whole answer
 * unavailable, so no balance is ever drawn from rows that cannot be trusted.
 */

/** The prefix every member's leave key starts with. */
const LEAVE_RECORDS_KEY_PREFIX = 'leave-records';

/** The one query key a member's live leave records are read under. */
export function LEAVE_RECORDS_KEY(memberId: string): readonly ['leave-records', string] {
  return [LEAVE_RECORDS_KEY_PREFIX, memberId] as const;
}

/** Five minutes, the bound the other lists set; every leave write re-reads it. */
export const LEAVE_RECORDS_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const LEAVE_RECORDS_FETCH_PAUSED = 'paused';

/** The records could not be read, or what came back cannot be trusted. */
export const LEAVE_RECORDS_UNAVAILABLE = 'LEAVE_RECORDS_UNAVAILABLE';

/** The columns read: the id an amend or a removal names, the member, as a tripwire, and the range. */
export const LEAVE_RECORDS_COLUMNS = 'id,member_id,during';

const ID_COLUMN = 'id';
const MEMBER_COLUMN = 'member_id';
const REMOVED_COLUMN = 'removed_at';
const DURING_COLUMN = 'during';

/**
 * One live record: the inclusive range it records and its id, which an amend
 * or a removal names (story 5.2b). Still a `LeaveRange`, so the records go to
 * `packages/domain` as they are.
 */
export interface LeaveRecord extends LeaveRange {
  readonly id: string;
}

export type LeaveRecordsOutcome =
  | { readonly ok: true; readonly records: readonly LeaveRecord[] }
  | { readonly ok: false; readonly code: typeof LEAVE_RECORDS_UNAVAILABLE };

export interface LeaveRecordsReadError {
  readonly code?: string | undefined;
}

export interface LeaveRecordsAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: LeaveRecordsReadError | null;
}

/** The read's filters, each answering the same builder, as supabase-js's do. */
export interface LeaveRecordsQuery {
  eq(column: string, value: string): LeaveRecordsQuery;
  is(column: string, value: null): LeaveRecordsQuery;
  order(column: string, options: { readonly ascending: boolean }): PromiseLike<LeaveRecordsAnswer>;
}

/** The one call made on `leave_records` here, named structurally so it can be stubbed. */
export interface LeaveRecordsTable {
  select(columns: string): LeaveRecordsQuery;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The rows as the member's records, in start order, or null when any row is
 * another member's, carries no id or one another row carries, does not
 * parse, or shares a date with the one before it.
 */
export function leaveRecordsOf(rows: readonly unknown[], memberId: string): readonly LeaveRecord[] | null {
  const records: LeaveRecord[] = [];
  const ids = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row) || row[MEMBER_COLUMN] !== memberId) return null;

    const id = row[ID_COLUMN];

    if (typeof id !== 'string' || id === '' || ids.has(id)) return null;

    ids.add(id);

    const range = leaveRangeOf(row[DURING_COLUMN]);

    if (range === null) return null;

    records.push({ id, from: range.from, to: range.to });
  }

  records.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

  for (let index = 1; index < records.length; index += 1) {
    const before = records[index - 1];
    const after = records[index];

    if (before !== undefined && after !== undefined && after.from <= before.to) return null;
  }

  return records;
}

/**
 * The live leave records of `memberId`, or unavailable. The policy (0028)
 * shows an admin every record of the organization; the member filter is this
 * read's, and the tripwire in {@link leaveRecordsOf} refuses any other row.
 */
export async function readLeaveRecords(table: LeaveRecordsTable, memberId: string): Promise<LeaveRecordsOutcome> {
  let answered: LeaveRecordsAnswer;

  try {
    answered = await table
      .select(LEAVE_RECORDS_COLUMNS)
      .eq(MEMBER_COLUMN, memberId)
      .is(REMOVED_COLUMN, null)
      .order(DURING_COLUMN, { ascending: true });
  } catch (cause) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, cause);

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, typeof answered);

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, answered.error?.code);

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  if (!Array.isArray(answered.data)) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, 'shape');

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  const records = leaveRecordsOf(answered.data as readonly unknown[], memberId);

  if (records === null) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, 'row');

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  return { ok: true, records };
}

/** The query options a member's leave records are read with, under {@link LEAVE_RECORDS_KEY}. */
export function leaveRecordsQueryOptions(table: () => LeaveRecordsTable, memberId: string) {
  return queryOptions({
    queryKey: LEAVE_RECORDS_KEY(memberId),
    queryFn: async (): Promise<readonly LeaveRecord[]> => {
      const outcome = await readLeaveRecords(table(), memberId);

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.records;
    },
    staleTime: LEAVE_RECORDS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** The query result the records' state is derived from. */
export interface LeaveRecordsQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly LeaveRecord[] | undefined;
}

/** TanStack Query's name for a fetch under way. */
export const LEAVE_RECORDS_FETCHING = 'fetching';

/** What the records read gives the card: the records, or still loading, or neither (failed). */
export interface LeaveRecordsState {
  readonly records: readonly LeaveRecord[] | null;
  readonly loading: boolean;
  /**
   * A re-read is under way over records already held — after a write, most
   * of all — so what they cost may be about to change: no preview is drawn
   * from them until it settles.
   */
  readonly refreshing: boolean;
}

/**
 * One query result as the records to compute from. A FAILURE, a failed
 * refetch over cached records, or a fetch paused offline gives none, so no
 * balance is drawn from records the database may no longer hold.
 */
export function leaveRecordsStateOf(answer: LeaveRecordsQueryAnswer): LeaveRecordsState {
  if (answer.isError || answer.fetchStatus === LEAVE_RECORDS_FETCH_PAUSED) {
    return { records: null, loading: false, refreshing: false };
  }

  return {
    records: answer.data ?? null,
    loading: answer.isPending,
    refreshing: !answer.isPending && answer.fetchStatus === LEAVE_RECORDS_FETCHING,
  };
}

/** The cache entry's state once a write's re-read has settled, as far as it is read here. */
export interface LeaveRecordsCacheState {
  readonly status: string;
  readonly fetchStatus: string;
  readonly data: readonly LeaveRecord[] | undefined;
}

/**
 * The records the re-read after a landed write answered, or null when it did
 * not answer them — it failed, it is paused offline or still under way, or
 * there is no entry — so the saved line is never computed from the records
 * held before the write.
 */
export function leaveRecordsAfterWriteOf(state: LeaveRecordsCacheState | undefined): readonly LeaveRecord[] | null {
  if (state === undefined || state.status !== 'success' || state.fetchStatus !== 'idle') return null;

  return state.data ?? null;
}

// ------------------------------------------- the viewer's own records (5.2c)

/**
 * THE VIEWER'S OWN LIVE RECORDS (story 5.2c), the read *Godišnji* stands on.
 * Never a select on `leave_records`, which would carry the admins' auth ids
 * (`created_by`, `removed_by`): `my_leave_records()` (0030) answers the
 * caller's own live rows alone, shaped as {@link LEAVE_RECORDS_COLUMNS}.
 *
 * THE ROWS COME BACK UNPARSED. The function takes no argument, so this read
 * does not know whose rows to expect; the member is the calendar snapshot's
 * viewer, and `myLeaveOf` parses the rows with {@link leaveRecordsOf} against
 * that id, so a row of anybody else makes the whole answer unavailable.
 */

/** The one query key the viewer's own live leave records are read under. */
export const MY_LEAVE_RECORDS_KEY = ['my-leave-records'] as const;

/** The definer function the viewer's own records are read through (0030). */
export const MY_LEAVE_RECORDS_FUNCTION = 'my_leave_records';

/** The one call made here, named structurally so it can be stubbed, as the calendar's `rpc` is. */
export interface MyLeaveRecordsRpc {
  rpc(fn: string): PromiseLike<LeaveRecordsAnswer>;
}

export type LeaveRowsOutcome =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: typeof LEAVE_RECORDS_UNAVAILABLE };

/** The viewer's own live rows as the function answered them, or unavailable. */
export async function readMyLeaveRows(client: MyLeaveRecordsRpc): Promise<LeaveRowsOutcome> {
  let answered: LeaveRecordsAnswer;

  try {
    answered = await client.rpc(MY_LEAVE_RECORDS_FUNCTION);
  } catch (cause) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, cause);

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  return rowsOfAnswer(answered);
}

/** An answer's rows, unparsed, or unavailable when it is not an answer, an error, or not a list. */
function rowsOfAnswer(answered: LeaveRecordsAnswer): LeaveRowsOutcome {
  if (!isRecord(answered)) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, typeof answered);

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, answered.error?.code);

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  if (!Array.isArray(answered.data)) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, 'shape');

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  return { ok: true, rows: answered.data as readonly unknown[] };
}

/** The query options the viewer's own records are read with, under {@link MY_LEAVE_RECORDS_KEY}. */
export function myLeaveRecordsQueryOptions(client: () => MyLeaveRecordsRpc) {
  return queryOptions({
    queryKey: MY_LEAVE_RECORDS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readMyLeaveRows(client());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: LEAVE_RECORDS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

// ------------------------------------- the organization's records (5.3b)

/**
 * EVERY LIVE RECORD OF THE ORGANIZATION (story 5.3b), the read the conflicts
 * queue stands on. A select on `leave_records` with no member filter: the
 * policy (0028) shows an admin every record of their organization, and the
 * route that reads it is admin-only. The columns are
 * {@link LEAVE_RECORDS_COLUMNS}; a removed record (`removed_at` set) is not
 * read.
 *
 * THE ROWS COME BACK UNPARSED, as the viewer's own do: whose rows are
 * trustworthy is the calendar snapshot's question — every row's member must
 * be one of its members — so {@link organizationLeaveRecordsOf} parses them
 * against those ids where both reads meet.
 */

/** The one query key the organization's live leave records are read under. */
export const ORGANIZATION_LEAVE_RECORDS_KEY = ['organization-leave-records'] as const;

/**
 * Rows per page of the organization's read: PostgREST's `max_rows`
 * (`supabase/config.toml`), so no page is ever cut short by the server and
 * a short page means the last.
 */
export const ORGANIZATION_LEAVE_PAGE_ROWS = 1000;

/** The organization's read: the live filter, a stable order, and one page of it. */
export interface OrganizationLeaveRecordsQuery {
  is(column: string, value: null): OrganizationLeaveRecordsQuery;
  order(column: string, options: { readonly ascending: boolean }): OrganizationLeaveRecordsQuery;
  range(from: number, to: number): PromiseLike<OrganizationLeaveRecordsAnswer>;
}

/** One page's answer, with the exact count of every row the filter matches. */
export interface OrganizationLeaveRecordsAnswer extends LeaveRecordsAnswer {
  readonly count?: number | null;
}

/** The one call made on `leave_records` for the organization, named structurally so it can be stubbed. */
export interface OrganizationLeaveRecordsTable {
  select(columns: string, options: { readonly count: 'exact' }): OrganizationLeaveRecordsQuery;
}

/**
 * The organization's live rows as the table answered them, EVERY ONE, or
 * unavailable. Read in pages of {@link ORGANIZATION_LEAVE_PAGE_ROWS} ordered
 * by id — unique, so the pages neither overlap nor skip — until every
 * counted row is in or a page comes back short, because a single select is capped at `max_rows` and would end in a partial
 * list without a word. Each page carries the exact count of the filter's rows:
 * a count that is missing, changes between pages, or disagrees with the rows
 * assembled — a write landing mid-read — is unavailable, never a guess.
 */
export async function readOrganizationLeaveRows(table: OrganizationLeaveRecordsTable): Promise<LeaveRowsOutcome> {
  return readLeaveRowPages((from, to) =>
    table
      .select(LEAVE_RECORDS_COLUMNS, { count: 'exact' })
      .is(REMOVED_COLUMN, null)
      .order(ID_COLUMN, { ascending: true })
      .range(from, to),
  );
}

/** One page of a paged read, rows `from` to `to` inclusive, with the exact count of every row. */
export type LeaveRowsPage = (from: number, to: number) => PromiseLike<OrganizationLeaveRecordsAnswer>;

/**
 * THE ONE PAGING LOOP the organization's records are read with — the select
 * of story 5.3b and the overview's definer read of story 7.15 alike: pages of
 * {@link ORGANIZATION_LEAVE_PAGE_ROWS}, ordered by id by the caller, until
 * every counted row is in or a page comes back short. A count that is
 * missing, changes between pages, or disagrees with the rows assembled is
 * unavailable, never a guess.
 */
export async function readLeaveRowPages(page: LeaveRowsPage): Promise<LeaveRowsOutcome> {
  const rows: unknown[] = [];
  let expected: number | null = null;

  for (let from = 0; ; from += ORGANIZATION_LEAVE_PAGE_ROWS) {
    let answered: OrganizationLeaveRecordsAnswer;

    try {
      answered = await page(from, from + ORGANIZATION_LEAVE_PAGE_ROWS - 1);
    } catch (cause) {
      console.error(LEAVE_RECORDS_UNAVAILABLE, cause);

      return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
    }

    const answer = rowsOfAnswer(answered);

    if (!answer.ok) return answer;

    const count = answered.count;

    if (typeof count !== 'number' || (expected !== null && count !== expected)) {
      console.error(LEAVE_RECORDS_UNAVAILABLE, 'count');

      return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
    }

    expected = count;
    rows.push(...answer.rows);

    // Every row counted is in, or the page was short: no page after it. Never
    // asked past the count, which PostgREST answers 416 rather than empty.
    if (rows.length >= count || answer.rows.length < ORGANIZATION_LEAVE_PAGE_ROWS) break;
  }

  if (rows.length !== expected) {
    console.error(LEAVE_RECORDS_UNAVAILABLE, 'count');

    return { ok: false, code: LEAVE_RECORDS_UNAVAILABLE };
  }

  return { ok: true, rows };
}

/** The query options the organization's records are read with, under {@link ORGANIZATION_LEAVE_RECORDS_KEY}. */
export function organizationLeaveRecordsQueryOptions(table: () => OrganizationLeaveRecordsTable) {
  return queryOptions({
    queryKey: ORGANIZATION_LEAVE_RECORDS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readOrganizationLeaveRows(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: LEAVE_RECORDS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

// ------------------------------------------- the admin's overview (7.15)

/**
 * EVERY LIVE RECORD OF THE ORGANIZATION FOR THE ADMIN'S OVERVIEW (story
 * 7.15), read through `leave_overview_records()` (0034) rather than a select:
 * the select policy (0028) would quietly show a member-role session its own
 * rows, where the function REFUSES anybody but an active admin with 42501. It
 * answers the rows shaped as {@link LEAVE_RECORDS_COLUMNS}, paged by
 * {@link readLeaveRowPages} under `max_rows` with an exact count.
 *
 * THE ROWS COME BACK UNPARSED, as the organization's select's do: whose rows
 * are trustworthy is the members read's question, and the overview parses
 * them with {@link organizationLeaveRecordsOf} against those ids.
 */

/** The one query key the overview's records are read under. */
export const LEAVE_OVERVIEW_RECORDS_KEY = ['leave-overview-records'] as const;

/** The definer function the overview's records are read through (0034). */
export const LEAVE_OVERVIEW_RECORDS_FUNCTION = 'leave_overview_records';

/** The function's call as a query: a stable order, and one page of it. */
export interface LeaveOverviewRecordsQuery {
  order(column: string, options: { readonly ascending: boolean }): LeaveOverviewRecordsQuery;
  range(from: number, to: number): PromiseLike<OrganizationLeaveRecordsAnswer>;
}

/** The one call made here, named structurally so it can be stubbed, as the viewer's own read is. */
export interface LeaveOverviewRecordsRpc {
  rpc(fn: string, args: Record<string, never>, options: { readonly count: 'exact' }): LeaveOverviewRecordsQuery;
}

/** The organization's live rows as the function answered them, EVERY ONE, or unavailable. */
export async function readLeaveOverviewRows(client: LeaveOverviewRecordsRpc): Promise<LeaveRowsOutcome> {
  return readLeaveRowPages((from, to) =>
    client
      .rpc(LEAVE_OVERVIEW_RECORDS_FUNCTION, {}, { count: 'exact' })
      .order(ID_COLUMN, { ascending: true })
      .range(from, to),
  );
}

/** The query options the overview's records are read with, under {@link LEAVE_OVERVIEW_RECORDS_KEY}. */
export function leaveOverviewRecordsQueryOptions(client: () => LeaveOverviewRecordsRpc) {
  return queryOptions({
    queryKey: LEAVE_OVERVIEW_RECORDS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readLeaveOverviewRows(client());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: LEAVE_RECORDS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/** One live record of the organization: a {@link LeaveRecord} and the member it is of. */
export interface OrganizationLeaveRecord extends LeaveRecord {
  readonly memberId: string;
}

/**
 * The organization's rows as records, by member and then start order, or
 * null when any row's member is not one of `memberIds`, or any one member's
 * rows fail {@link leaveRecordsOf} — no id, a bad range, two sharing a date —
 * or two rows of any members share an id.
 */
export function organizationLeaveRecordsOf(
  rows: readonly unknown[],
  memberIds: readonly string[],
): readonly OrganizationLeaveRecord[] | null {
  const known = new Set(memberIds);
  const byMember = new Map<string, unknown[]>();

  for (const row of rows) {
    if (!isRecord(row)) return null;

    const memberId = row[MEMBER_COLUMN];

    if (typeof memberId !== 'string' || !known.has(memberId)) return null;

    const own = byMember.get(memberId);

    if (own === undefined) byMember.set(memberId, [row]);
    else own.push(row);
  }

  const records: OrganizationLeaveRecord[] = [];
  const ids = new Set<string>();

  for (const [memberId, own] of byMember) {
    const parsed = leaveRecordsOf(own, memberId);

    if (parsed === null) return null;

    for (const record of parsed) {
      if (ids.has(record.id)) return null;

      ids.add(record.id);
      records.push({ ...record, memberId });
    }
  }

  return records;
}
