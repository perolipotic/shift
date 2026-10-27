import { queryOptions } from '@tanstack/react-query';
import type { LeaveRange } from '@shift/domain';

import { leaveRangeOf } from '@/features/leave/services/leave-write';
import { isIsoDate } from '@/lib/i18n/format';

/**
 * A member's own leave requests (story 9.3): the one module that stands on
 * 0040's boundary, in a `.ts` that renders nothing (AD-15). The read of the
 * member's own rows with their decisions embedded, the row parse, the status
 * derivation and the sort; the insert *Pošalji* sends and the withdrawal
 * *Povuci zahtjev* calls, each with its refusals mapped to codes.
 *
 * THE READ is a select on `leave_requests` with `leave_request_decisions`
 * embedded through its composite key, filtered to the viewer's own member row
 * (the calendar snapshot's). The select policy (0040) shows a member-role
 * session its own rows alone, and the filter keeps the read the viewer's own
 * where a session may read more (an admin, from story 9.4); the parse below
 * still refuses any row of anybody else, so the answer is unavailable rather
 * than a colleague's request drawn as the viewer's.
 *
 * STATUS IS DERIVED, as 0040 stores it: pending while `closed_at` is null;
 * once closed, the decision's `outcome` (`approved` or `rejected`), or
 * withdrawn when no decision exists. A PENDING REQUEST DERIVES NOTHING: no
 * balance, no conflict and no schedule reads it.
 *
 * THE DATABASE DECIDES. Only the shape of each date is checked before the
 * insert, so no malformed literal is sent; an overlap with the member's live
 * leave is 0040's trigger's 23P01 (`LEAVE_REQUEST_OVERLAPS_LEAVE`), an overlap
 * with another pending request its exclusion constraint's 23P01, and a refusal
 * its policy's 42501. The domain's `overlapsRecord` is a warning, never a gate.
 *
 * Codes, never messages: the components map them to Croatian at their edge.
 */

/** The table a request is inserted into and read from (0040). */
export const LEAVE_REQUESTS_TABLE = 'leave_requests';

/** The function a member withdraws their own pending request through (0040). */
export const WITHDRAW_LEAVE_REQUEST_FUNCTION = 'withdraw_leave_request';

/** The one query key the viewer's own requests are read under. */
export const MY_LEAVE_REQUESTS_KEY = ['my-leave-requests'] as const;

/** The columns read: the request's own, and its decision's outcome through the embed. */
export const LEAVE_REQUESTS_COLUMNS = 'id,member_id,during,closed_at,leave_request_decisions(outcome)';

/** The read could not be answered, or answered something that is not rows. */
export const LEAVE_REQUESTS_UNAVAILABLE = 'LEAVE_REQUESTS_UNAVAILABLE';

/** The stale time of the read, as the leave records' (five minutes). */
export const LEAVE_REQUESTS_READ_STALE_MS = 300000;

/** Waits on an admin's decision: `closed_at` is null. */
export const REQUEST_PENDING = 'pending';
/** Closed by an approval: a leave record stands for it. */
export const REQUEST_APPROVED = 'approved';
/** Closed by a rejection. */
export const REQUEST_REJECTED = 'rejected';
/** Closed by the member, with no decision. */
export const REQUEST_WITHDRAWN = 'withdrawn';

export type LeaveRequestStatus =
  | typeof REQUEST_PENDING
  | typeof REQUEST_APPROVED
  | typeof REQUEST_REJECTED
  | typeof REQUEST_WITHDRAWN;

/** One of the viewer's own requests: its id, its inclusive range, its status and when it was closed. */
export interface LeaveRequest extends LeaveRange {
  readonly id: string;
  readonly status: LeaveRequestStatus;
  /** The instant the request was closed (`closed_at`), or null while it is pending. */
  readonly closedAt: string | null;
}

const ID_COLUMN = 'id';
const MEMBER_COLUMN = 'member_id';
const DURING_COLUMN = 'during';
const CLOSED_COLUMN = 'closed_at';
const DECISIONS_EMBED = 'leave_request_decisions';
const OUTCOME_COLUMN = 'outcome';

const INSUFFICIENT_PRIVILEGE = '42501';
const EXCLUSION_VIOLATION = '23P01';
const NO_DATA_FOUND = 'P0002';

/** 0040's trigger's message for a request that shares a date with the member's live leave, under 23P01. */
export const LEAVE_REQUEST_OVERLAPS_LEAVE_MESSAGE = 'LEAVE_REQUEST_OVERLAPS_LEAVE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A closed request's status from its embedded decisions: the one decision's
 * outcome, or withdrawn when there is none; null when the embed is not a
 * decision PostgREST could answer (more than one, or an unknown outcome).
 * PostgREST answers the embed as a list, or as one object or null when it
 * reads the key as one-to-one; all three are taken.
 */
function closedStatusOf(embedded: unknown): LeaveRequestStatus | null {
  const decisions: readonly unknown[] = Array.isArray(embedded)
    ? embedded
    : embedded === null || embedded === undefined
      ? []
      : [embedded];

  if (decisions.length === 0) return REQUEST_WITHDRAWN;
  if (decisions.length > 1) return null;

  const [decision] = decisions;
  const outcome = isRecord(decision) ? decision[OUTCOME_COLUMN] : undefined;

  if (outcome === REQUEST_APPROVED) return REQUEST_APPROVED;
  if (outcome === REQUEST_REJECTED) return REQUEST_REJECTED;

  return null;
}

/**
 * A request's status, derived as 0040 defines it: pending while `closedAt` is
 * null, otherwise its decision's outcome, or withdrawn when it has none; null
 * when the row cannot say.
 */
export function leaveRequestStatusOf(closedAt: unknown, decisions: unknown): LeaveRequestStatus | null {
  if (closedAt === null || closedAt === undefined) {
    // A pending request has no decision: one beside it is a row that cannot be trusted.
    return closedStatusOf(decisions) === REQUEST_WITHDRAWN ? REQUEST_PENDING : null;
  }

  if (typeof closedAt !== 'string' || closedAt === '') return null;

  return closedStatusOf(decisions);
}

/** Two requests in the list's order: by the range's start, soonest first, then by the end and the id. */
function compareRequests(first: LeaveRequest, second: LeaveRequest): number {
  if (first.from !== second.from) return first.from < second.from ? -1 : 1;
  if (first.to !== second.to) return first.to < second.to ? -1 : 1;

  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

/**
 * The rows as the viewer's own requests, sorted by the range's start, soonest
 * first; null when any row is another member's, carries no id or one another
 * row carries, has a range that does not parse, or a status that cannot be
 * derived.
 */
export function leaveRequestsOf(rows: readonly unknown[], memberId: string): readonly LeaveRequest[] | null {
  const requests: LeaveRequest[] = [];
  const ids = new Set<string>();

  for (const row of rows) {
    if (!isRecord(row) || row[MEMBER_COLUMN] !== memberId) return null;

    const id = row[ID_COLUMN];

    if (typeof id !== 'string' || id === '' || ids.has(id)) return null;

    ids.add(id);

    const range = leaveRangeOf(row[DURING_COLUMN]);
    const status = leaveRequestStatusOf(row[CLOSED_COLUMN], row[DECISIONS_EMBED]);

    if (range === null || status === null) return null;

    const closed = row[CLOSED_COLUMN];

    requests.push({ id, from: range.from, to: range.to, status, closedAt: typeof closed === 'string' ? closed : null });
  }

  return requests.sort(compareRequests);
}

// ------------------------------------------------------------------ the read

export interface LeaveRequestsReadError {
  readonly code?: string | undefined;
}

export interface LeaveRequestsAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: LeaveRequestsReadError | null;
}

/** The member filter on the read, answering the rows, as supabase-js's builder does. */
export interface LeaveRequestsQuery {
  eq(column: string, value: string): PromiseLike<LeaveRequestsAnswer>;
}

/** The one read made on `leave_requests`, named structurally so it can be stubbed. */
export interface LeaveRequestsTable {
  select(columns: string): LeaveRequestsQuery;
}

export type LeaveRequestRowsOutcome =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: typeof LEAVE_REQUESTS_UNAVAILABLE };

/** The viewer's own request rows — `memberId`'s — as the select answered them, unparsed, or unavailable. */
export async function readMyLeaveRequestRows(
  table: LeaveRequestsTable,
  memberId: string,
): Promise<LeaveRequestRowsOutcome> {
  let answered: unknown;

  try {
    answered = await table.select(LEAVE_REQUESTS_COLUMNS).eq(MEMBER_COLUMN, memberId);
  } catch (cause) {
    console.error(LEAVE_REQUESTS_UNAVAILABLE, cause);

    return { ok: false, code: LEAVE_REQUESTS_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(LEAVE_REQUESTS_UNAVAILABLE, typeof answered);

    return { ok: false, code: LEAVE_REQUESTS_UNAVAILABLE };
  }

  if (answered['error'] !== null) {
    console.error(LEAVE_REQUESTS_UNAVAILABLE, isRecord(answered['error']) ? answered['error']['code'] : 'error');

    return { ok: false, code: LEAVE_REQUESTS_UNAVAILABLE };
  }

  const data = answered['data'];

  if (!Array.isArray(data)) {
    console.error(LEAVE_REQUESTS_UNAVAILABLE, 'shape');

    return { ok: false, code: LEAVE_REQUESTS_UNAVAILABLE };
  }

  return { ok: true, rows: data as readonly unknown[] };
}

/**
 * The query options the viewer's own requests are read with, under
 * {@link MY_LEAVE_REQUESTS_KEY}: `memberId` is the calendar snapshot's
 * viewer, and the read waits for it (null while the snapshot is unread).
 */
export function myLeaveRequestsQueryOptions(table: () => LeaveRequestsTable, memberId: string | null) {
  return queryOptions({
    queryKey: MY_LEAVE_REQUESTS_KEY,
    enabled: memberId !== null,
    queryFn: async (): Promise<readonly unknown[]> => {
      if (memberId === null) throw new Error(LEAVE_REQUESTS_UNAVAILABLE);

      const outcome = await readMyLeaveRequestRows(table(), memberId);

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: LEAVE_REQUESTS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

// ----------------------------------------------------------------- the writes

/** The range shares a date with the member's live leave (23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE`). */
export const REQUEST_OVERLAPS_LEAVE = 'overlapsLeave';
/** The range shares a date with another pending request of the member's (any other 23P01). */
export const REQUEST_OVERLAPS_REQUEST = 'overlapsRequest';
/** The caller may not send or withdraw this request (42501). */
export const REQUEST_DENIED = 'denied';
/** The request is no longer pending: decided, withdrawn already, or never there (P0002). */
export const REQUEST_NOT_PENDING = 'notPending';
/** Anything else — a refused range, the network, a malformed answer: try again. */
export const REQUEST_FAILED = 'failed';

export type LeaveRequestSendFailure =
  | typeof REQUEST_OVERLAPS_LEAVE
  | typeof REQUEST_OVERLAPS_REQUEST
  | typeof REQUEST_DENIED
  | typeof REQUEST_FAILED;

export type LeaveRequestWithdrawFailure = typeof REQUEST_NOT_PENDING | typeof REQUEST_DENIED | typeof REQUEST_FAILED;

export type LeaveRequestSendOutcome = { readonly ok: true } | { readonly ok: false; readonly code: LeaveRequestSendFailure };

export type LeaveRequestWithdrawOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: LeaveRequestWithdrawFailure };

export interface LeaveRequestWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface LeaveRequestWriteAnswer {
  readonly error: LeaveRequestWriteError | null;
}

/** The one write made on `leave_requests`, named structurally so it can be stubbed: the insert. */
export interface LeaveRequestInsertTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<LeaveRequestWriteAnswer>;
}

/** The one function a withdrawal calls, named structurally so it can be stubbed. */
export interface WithdrawLeaveRequestRpc {
  rpc(
    fn: typeof WITHDRAW_LEAVE_REQUEST_FUNCTION,
    args: { readonly p_request_id: string },
  ): PromiseLike<LeaveRequestWriteAnswer>;
}

/**
 * A refused insert as this application's own failure, by SQLSTATE and
 * message: 23P01 with `LEAVE_REQUEST_OVERLAPS_LEAVE` overlaps the member's
 * leave, any other 23P01 overlaps a pending request, 42501 is not allowed,
 * and anything else — 23514, 22000, 23503, the unforeseen — failed.
 */
export function leaveRequestSendFailureOf(error: LeaveRequestWriteError): LeaveRequestSendFailure {
  if (error.code === EXCLUSION_VIOLATION) {
    return error.message === LEAVE_REQUEST_OVERLAPS_LEAVE_MESSAGE ? REQUEST_OVERLAPS_LEAVE : REQUEST_OVERLAPS_REQUEST;
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) return REQUEST_DENIED;

  return REQUEST_FAILED;
}

/** A refused withdrawal as this application's own failure: P0002 no longer pending, 42501 not allowed, else failed. */
export function leaveRequestWithdrawFailureOf(error: LeaveRequestWriteError): LeaveRequestWithdrawFailure {
  if (error.code === NO_DATA_FOUND) return REQUEST_NOT_PENDING;
  if (error.code === INSUFFICIENT_PRIVILEGE) return REQUEST_DENIED;

  return REQUEST_FAILED;
}

/** A call's answer as its error: `null` alone is success; anything malformed is logged and `undefined`. */
function answeredErrorOf(answered: unknown): LeaveRequestWriteError | null | undefined {
  if (!isRecord(answered)) {
    console.error(REQUEST_FAILED, typeof answered);

    return undefined;
  }

  const error: unknown = answered['error'];

  if (error === null) return null;

  if (!isRecord(error)) {
    console.error(REQUEST_FAILED, typeof error);

    return undefined;
  }

  return error as LeaveRequestWriteError;
}

/**
 * Send a request for `memberId` from `from` to `to`, both `YYYY-MM-DD` and
 * both included: 0040's plain insert of the three facts, the range as the
 * `daterange` literal `[from,to]`. `created_by` and `created_at` come from
 * their defaults. A date that is not a calendar date, or a reversed range, is
 * {@link REQUEST_FAILED} without a request.
 */
export async function sendLeaveRequest(
  table: LeaveRequestInsertTable,
  organizationId: string,
  memberId: string,
  from: string,
  to: string,
): Promise<LeaveRequestSendOutcome> {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) {
    console.error(REQUEST_FAILED, 'not a range of calendar dates');

    return { ok: false, code: REQUEST_FAILED };
  }

  let answered: unknown;

  try {
    answered = await table.insert({ organization_id: organizationId, member_id: memberId, during: `[${from},${to}]` });
  } catch (cause) {
    console.error(REQUEST_FAILED, cause);

    return { ok: false, code: REQUEST_FAILED };
  }

  const error = answeredErrorOf(answered);

  if (error === null) return { ok: true };
  if (error === undefined) return { ok: false, code: REQUEST_FAILED };

  const code = leaveRequestSendFailureOf(error);

  if (code === REQUEST_FAILED) console.error(code, error.code);

  return { ok: false, code };
}

/** Withdraw the viewer's own pending request `requestId`: 0040's definer, which closes it with no decision. */
export async function withdrawLeaveRequest(
  client: WithdrawLeaveRequestRpc,
  requestId: string,
): Promise<LeaveRequestWithdrawOutcome> {
  let answered: unknown;

  try {
    answered = await client.rpc(WITHDRAW_LEAVE_REQUEST_FUNCTION, { p_request_id: requestId });
  } catch (cause) {
    console.error(REQUEST_FAILED, cause);

    return { ok: false, code: REQUEST_FAILED };
  }

  const error = answeredErrorOf(answered);

  if (error === null) return { ok: true };
  if (error === undefined) return { ok: false, code: REQUEST_FAILED };

  const code = leaveRequestWithdrawFailureOf(error);

  if (code === REQUEST_FAILED) console.error(code, error.code);

  return { ok: false, code };
}
