import type { REQUEST_APPROVED, REQUEST_REJECTED } from '@/features/leave/services/leave-request-list';
import { isIsoDate } from '@/lib/i18n/format';

/**
 * LEAVE REQUESTS, WRITTEN (0040, stories 9.3 and 9.4): the write side of the
 * one boundary `leave_requests` stands on, in a `.ts` that renders nothing
 * (AD-15). The insert *Pošalji* sends, the withdrawal *Povuci zahtjev* calls
 * and an admin's decision, each with its refusals mapped to codes. The table,
 * the statuses and the reads are `leave-request-list.ts`; this module imports
 * from it, never the reverse.
 *
 * THE DATABASE DECIDES. Only the shape of each date is checked before the
 * insert, so no malformed literal is sent; an overlap with the member's live
 * leave is 0040's trigger's 23P01 (`LEAVE_REQUEST_OVERLAPS_LEAVE`), an overlap
 * with another pending request its exclusion constraint's 23P01, and a refusal
 * its policy's 42501. The domain's `overlapsRecord` is a warning, never a gate.
 *
 * THE DECISION (story 9.4) is 0040's definer, `decideLeaveRequest`, whose
 * stale approval is its 23P01 and never refused here first.
 *
 * Codes, never messages: the components map them to Croatian at their edge.
 */

/** The function a member withdraws their own pending request through (0040). */
export const WITHDRAW_LEAVE_REQUEST_FUNCTION = 'withdraw_leave_request';

/** The function an active admin approves or rejects a pending request through (0040, story 9.4). */
export const DECIDE_LEAVE_REQUEST_FUNCTION = 'decide_leave_request';

const INSUFFICIENT_PRIVILEGE = '42501';
const EXCLUSION_VIOLATION = '23P01';
const NO_DATA_FOUND = 'P0002';
const OBJECT_NOT_IN_PREREQUISITE_STATE = '55000';

/** 0040's trigger's message for a request that shares a date with the member's live leave, under 23P01. */
export const LEAVE_REQUEST_OVERLAPS_LEAVE_MESSAGE = 'LEAVE_REQUEST_OVERLAPS_LEAVE';

/**
 * 0041's message, under 55000, for an insert or an approval reaching a date on
 * which the member is inactive (a scheduled deactivation included).
 */
export const LEAVE_REQUEST_MEMBER_INACTIVE_MESSAGE = 'LEAVE_REQUEST_MEMBER_INACTIVE';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The range shares a date with the member's live leave (23P01 `LEAVE_REQUEST_OVERLAPS_LEAVE`). */
export const REQUEST_OVERLAPS_LEAVE = 'overlapsLeave';
/** The range shares a date with another pending request of the member's (any other 23P01). */
export const REQUEST_OVERLAPS_REQUEST = 'overlapsRequest';
/** The caller may not send, withdraw or decide this request (42501). */
export const REQUEST_DENIED = 'denied';
/** The request is no longer pending: decided, withdrawn already, or never there (P0002). */
export const REQUEST_NOT_PENDING = 'notPending';
/**
 * The range reaches a date on which the member is inactive (55000
 * `LEAVE_REQUEST_MEMBER_INACTIVE`, 0041): a send refused, or an approval —
 * then only a rejection is possible.
 */
export const REQUEST_MEMBER_INACTIVE = 'memberInactive';
/** Anything else — a refused range, the network, a malformed answer: try again. */
export const REQUEST_FAILED = 'failed';

export type LeaveRequestSendFailure =
  | typeof REQUEST_OVERLAPS_LEAVE
  | typeof REQUEST_OVERLAPS_REQUEST
  | typeof REQUEST_MEMBER_INACTIVE
  | typeof REQUEST_DENIED
  | typeof REQUEST_FAILED;

export type LeaveRequestWithdrawFailure = typeof REQUEST_NOT_PENDING | typeof REQUEST_DENIED | typeof REQUEST_FAILED;

/**
 * An approval refused as stale (story 9.4): live leave sharing a date with the
 * request was recorded since it was sent (23P01
 * `LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE`). The request stays pending, to be
 * rejected.
 */
export const REQUEST_APPROVAL_STALE = 'approvalStale';

export type LeaveRequestDecideFailure =
  | typeof REQUEST_NOT_PENDING
  | typeof REQUEST_APPROVAL_STALE
  | typeof REQUEST_MEMBER_INACTIVE
  | typeof REQUEST_DENIED
  | typeof REQUEST_FAILED;

export type LeaveRequestDecideOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: LeaveRequestDecideFailure };

/** The two outcomes an admin decides a request with, as 0040's `p_outcome` takes them. */
export type LeaveRequestOutcome = typeof REQUEST_APPROVED | typeof REQUEST_REJECTED;

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

/** The one function a decision calls, named structurally so it can be stubbed (story 9.4). */
export interface DecideLeaveRequestRpc {
  rpc(
    fn: typeof DECIDE_LEAVE_REQUEST_FUNCTION,
    args: { readonly p_request_id: string; readonly p_outcome: LeaveRequestOutcome },
  ): PromiseLike<LeaveRequestWriteAnswer>;
}

/**
 * A refused insert as this application's own failure, by SQLSTATE and
 * message: 23P01 with `LEAVE_REQUEST_OVERLAPS_LEAVE` overlaps the member's
 * leave, any other 23P01 overlaps a pending request, 55000 with
 * `LEAVE_REQUEST_MEMBER_INACTIVE` reaches an inactive date (0041), 42501 is
 * not allowed, and anything else — 23514, 22000, 23503, the unforeseen —
 * failed.
 */
export function leaveRequestSendFailureOf(error: LeaveRequestWriteError): LeaveRequestSendFailure {
  if (memberInactive(error)) return REQUEST_MEMBER_INACTIVE;
  if (error.code === EXCLUSION_VIOLATION) {
    return error.message === LEAVE_REQUEST_OVERLAPS_LEAVE_MESSAGE ? REQUEST_OVERLAPS_LEAVE : REQUEST_OVERLAPS_REQUEST;
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) return REQUEST_DENIED;

  return REQUEST_FAILED;
}

/** 0041's refusal, by SQLSTATE and message together. */
function memberInactive(error: LeaveRequestWriteError): boolean {
  return error.code === OBJECT_NOT_IN_PREREQUISITE_STATE && error.message === LEAVE_REQUEST_MEMBER_INACTIVE_MESSAGE;
}

/** A refused withdrawal as this application's own failure: P0002 no longer pending, 42501 not allowed, else failed. */
export function leaveRequestWithdrawFailureOf(error: LeaveRequestWriteError): LeaveRequestWithdrawFailure {
  if (error.code === NO_DATA_FOUND) return REQUEST_NOT_PENDING;
  if (error.code === INSUFFICIENT_PRIVILEGE) return REQUEST_DENIED;

  return REQUEST_FAILED;
}

/**
 * A refused decision as this application's own failure, by SQLSTATE (story
 * 9.4): P0002 no longer pending, 23P01 an approval gone stale, 42501 not
 * allowed, 55000 with `LEAVE_REQUEST_MEMBER_INACTIVE` an approval reaching a
 * date the member is inactive (0041), and anything else — 22023, the network,
 * the unforeseen — failed.
 */
export function leaveRequestDecideFailureOf(error: LeaveRequestWriteError): LeaveRequestDecideFailure {
  if (memberInactive(error)) return REQUEST_MEMBER_INACTIVE;
  if (error.code === NO_DATA_FOUND) return REQUEST_NOT_PENDING;
  if (error.code === EXCLUSION_VIOLATION) return REQUEST_APPROVAL_STALE;
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

/**
 * Decide the pending request `requestId` (story 9.4): 0040's definer, which
 * on an approval inserts the leave record, records the decision and closes
 * the request in one transaction, and on a rejection records the decision
 * and closes it. The acting admin and the instant come from its defaults.
 * NOTHING IS CHECKED HERE FIRST: the database decides overlap, and a stale
 * approval is its refusal. The caller re-reads after any outcome.
 */
export async function decideLeaveRequest(
  client: DecideLeaveRequestRpc,
  requestId: string,
  outcome: LeaveRequestOutcome,
): Promise<LeaveRequestDecideOutcome> {
  let answered: unknown;

  try {
    answered = await client.rpc(DECIDE_LEAVE_REQUEST_FUNCTION, { p_request_id: requestId, p_outcome: outcome });
  } catch (cause) {
    console.error(REQUEST_FAILED, cause);

    return { ok: false, code: REQUEST_FAILED };
  }

  const error = answeredErrorOf(answered);

  if (error === null) return { ok: true };
  if (error === undefined) return { ok: false, code: REQUEST_FAILED };

  const code = leaveRequestDecideFailureOf(error);

  if (code === REQUEST_FAILED) console.error(code, error.code);

  return { ok: false, code };
}
