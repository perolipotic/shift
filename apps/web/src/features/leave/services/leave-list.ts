import { queryOptions } from '@tanstack/react-query';
import type { LeaveRange } from '@shift/domain';

import { leaveRangeOf } from '@/features/leave/services/leave-write';

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
