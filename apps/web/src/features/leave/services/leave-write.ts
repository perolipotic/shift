import type { LeaveRange } from '@shift/domain';

/**
 * Recording a member's leave (story 5.1b), and amending or removing a record
 * (story 5.2a) — the leave feature's write module, in a `.ts` that renders
 * nothing (AD-15).
 *
 * WRITING IS 0028's PLAIN INSERT of the three facts: the organization, the
 * member and the inclusive range, sent as a `daterange` literal `[from,to]`.
 * `created_by` and `created_at` come from their defaults, and the insert
 * policy admits an active admin of the claimed organization alone.
 *
 * THE DATABASE DECIDES. Only the shape of each date is checked here, so no
 * malformed literal is sent: an empty, reversed or overlong range is 0028's
 * to refuse, and an overlap is its exclusion constraint's (R4.4, AD-3). Nor is the balance checked: an over-balance
 * record saves (R4.7), and what it costs is `packages/domain`'s question.
 *
 * REMOVING AND AMENDING ARE 0029's DEFINER FUNCTIONS. `remove_leave_record`
 * soft-removes a live record, and `amend_leave_record` soft-removes it and
 * inserts the replacement range for the same member in one transaction,
 * answering the new record's id; both attribute on the server. A soft-remove,
 * never a delete, and never a change in place. The balance follows on its
 * own: the live read drops a removed record, and `packages/domain` computes
 * from what it reads.
 *
 * AN OVERLAP NAMES ITS CONFLICT. On 23P01 one follow-up read finds the
 * member's earliest live record in the organization that overlaps the entered
 * range and returns its inclusive dates; if that read fails or finds nothing,
 * the code alone. On an amend the read leaves out the record being amended,
 * so the conflict it names is never that record itself.
 *
 * LOGGED: a failure and a failed read-back. An overlap or a refusal is an
 * ordinary outcome and is not logged.
 *
 * Codes, never messages: story 5.1c maps them to Croatian at its edge.
 */

/** The table a leave record is inserted into (0028). */
export const LEAVE_RECORDS_TABLE = 'leave_records';

/** The function a leave record is removed through (0029). */
export const REMOVE_LEAVE_RECORD_FUNCTION = 'remove_leave_record';

/** The function a leave record is amended through (0029): remove and insert, in one transaction. */
export const AMEND_LEAVE_RECORD_FUNCTION = 'amend_leave_record';

/** A live record of the same member already covers one of the dates (23P01). */
export const LEAVE_OVERLAP = 'overlap';
/** The caller may not record, amend or remove leave (42501). */
export const LEAVE_DENIED = 'denied';
/** The record is no longer live: removed already, never there, or gone from reach (P0002). */
export const LEAVE_GONE = 'gone';
/** Anything else — a refused range, another tenant's member, the network: try again. */
export const LEAVE_FAILED = 'failed';

export type LeaveWriteFailure = typeof LEAVE_OVERLAP | typeof LEAVE_DENIED | typeof LEAVE_FAILED;

/** Why an amend or a removal did not land: a record's failures, and that the record is gone. */
export type LeaveChangeFailure = LeaveWriteFailure | typeof LEAVE_GONE;

export type LeaveWriteOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof LEAVE_OVERLAP;
      /** The conflicting live record's inclusive dates, or null when they could not be read. */
      readonly conflict: LeaveRange | null;
    }
  | { readonly ok: false; readonly code: typeof LEAVE_DENIED | typeof LEAVE_FAILED };

/** What a removal answers: it landed, or why not. An overlap is never one. */
export type LeaveRemovalOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: typeof LEAVE_GONE | typeof LEAVE_DENIED | typeof LEAVE_FAILED };

/** What an amend answers: the replacement's id, or why not, an overlap naming its conflict as a record does. */
export type LeaveAmendOutcome =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly code: typeof LEAVE_OVERLAP;
      /** The conflicting live record's inclusive dates — never the amended record's — or null when they could not be read. */
      readonly conflict: LeaveRange | null;
    }
  | { readonly ok: false; readonly code: typeof LEAVE_GONE | typeof LEAVE_DENIED | typeof LEAVE_FAILED };

// ----------------------------------------------------------------- the seams

export interface LeaveWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | null | undefined;
}

export interface LeaveWriteAnswer {
  readonly error: LeaveWriteError | null;
}

export interface LeaveReadAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: LeaveWriteError | null;
}

/** The overlap read's filters, each answering the same builder, as supabase-js's do. */
export interface LeaveQuery {
  eq(column: string, value: string): LeaveQuery;
  neq(column: string, value: string): LeaveQuery;
  is(column: string, value: null): LeaveQuery;
  overlaps(column: string, range: string): LeaveQuery;
  order(column: string, options: { readonly ascending: boolean }): LeaveQuery;
  limit(count: number): PromiseLike<LeaveReadAnswer>;
}

/**
 * The calls made on `leave_records`, named structurally so they can be
 * stubbed: `insert` and the one overlap read. No update, no delete, no upsert.
 */
export interface LeaveTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<LeaveWriteAnswer>;
  select(columns: string): LeaveQuery;
}

/** An amend's answer: the replacement's id on success. */
export interface LeaveAmendAnswer {
  readonly data: unknown;
  readonly error: LeaveWriteError | null;
}

/** The two functions an amend or a removal calls, named structurally so they can be stubbed. */
export interface LeaveRecordRpc {
  rpc(
    fn: typeof REMOVE_LEAVE_RECORD_FUNCTION,
    args: { readonly p_record_id: string },
  ): PromiseLike<LeaveWriteAnswer>;
  rpc(
    fn: typeof AMEND_LEAVE_RECORD_FUNCTION,
    args: { readonly p_record_id: string; readonly p_from: string; readonly p_to: string },
  ): PromiseLike<LeaveAmendAnswer>;
}

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const EXCLUSION_VIOLATION = '23P01';
const NO_DATA_FOUND = 'P0002';

const ID_COLUMN = 'id';
const DURING_COLUMN = 'during';
const ORGANIZATION_COLUMN = 'organization_id';
const MEMBER_COLUMN = 'member_id';
const REMOVED_COLUMN = 'removed_at';

/** The inclusive `daterange` literal 0028 stores a range as. */
function rangeLiteralOf(from: string, to: string): string {
  return `[${from},${to}]`;
}

/** A `YYYY-MM-DD` date (a five-digit year where `years` allows it) as a UTC instant, or null. */
function instantOf(value: string, years: RegExp): Date | null {
  const parts = new RegExp(`^(${years.source})-(\\d{2})-(\\d{2})$`).exec(value);

  if (parts === null) return null;

  const [, year, month, day] = parts;
  // `setUTCFullYear`, never `Date.UTC`: the latter reads years 0–99 as 1900–1999.
  const instant = new Date(0);

  instant.setUTCFullYear(Number(year), Number(month) - 1, Number(day));

  return Number.isNaN(instant.valueOf()) ? null : instant;
}

/** An instant's UTC calendar date as `YYYY-MM-DD`, the year padded to four digits. */
function isoDateOf(instant: Date): string {
  return [
    String(instant.getUTCFullYear()).padStart(4, '0'),
    String(instant.getUTCMonth() + 1).padStart(2, '0'),
    String(instant.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

const FOUR_DIGIT_YEAR = /\d{4}/;
const FOUR_OR_FIVE_DIGIT_YEAR = /\d{4,5}/;

/** Whether `value` is a real calendar date written `YYYY-MM-DD`: `2026-13-45` round-trips to another date and is not. */
export function isCalendarDate(value: string): boolean {
  const instant = instantOf(value, FOUR_DIGIT_YEAR);

  return instant !== null && isoDateOf(instant) === value;
}

/**
 * A refused INSERT, as this application's own failure: `23P01` is 0028's
 * exclusion constraint — a live record of the same member shares a date —
 * `42501` the policy's refusal, and everything else (a range check's `23514`,
 * a reversed range's `22000`, another tenant's member's `23503`, the
 * unforeseen) {@link LEAVE_FAILED}.
 */
export function leaveInsertFailureOf(error: LeaveWriteError): LeaveWriteFailure {
  if (error.code === EXCLUSION_VIOLATION) return LEAVE_OVERLAP;
  if (error.code === INSUFFICIENT_PRIVILEGE) return LEAVE_DENIED;

  return LEAVE_FAILED;
}

/**
 * A refused AMEND or REMOVAL (0029), as this application's own failure:
 * `42501` the caller is no active admin, `P0002` the record is no longer live,
 * `23P01` the replacement range shares a date with another live record of the
 * member (an amend's alone), and everything else — a range 0028 refuses
 * (`22000`, `22008`, `23514`), an id that is not a uuid (`22P02`), the
 * unforeseen — {@link LEAVE_FAILED}.
 */
export function leaveChangeFailureOf(error: LeaveWriteError): LeaveChangeFailure {
  if (error.code === NO_DATA_FOUND) return LEAVE_GONE;

  return leaveInsertFailureOf(error);
}

/** A canonical stored range, `[from,upper)`, with the exclusive upper bound. */
const CANONICAL_RANGE = /^\[([^,]+),([^)]+)\)$/;

/**
 * A stored `daterange` as the inclusive {@link LeaveRange} it records, or null
 * when it is not the canonical `[from,upper)` text Postgres answers over two
 * real calendar dates. The upper bound is exclusive, so the last date is the
 * day before it; it may be `10000-01-01`, the bound after 9999-12-31.
 */
export function leaveRangeOf(during: unknown): LeaveRange | null {
  if (typeof during !== 'string') return null;

  const parts = CANONICAL_RANGE.exec(during);

  if (parts === null) return null;

  const [, from = '', upperText = ''] = parts;
  const upper = instantOf(upperText, FOUR_OR_FIVE_DIGIT_YEAR);

  if (!isCalendarDate(from) || upper === null || isoDateOf(upper) !== upperText) return null;

  upper.setUTCDate(upper.getUTCDate() - 1);

  const to = isoDateOf(upper);

  return to < from ? null : { from, to };
}

/**
 * The EARLIEST live record of the member, in the organization, that overlaps
 * `[from, to]` — other than `excludedId`, the record being amended, when one
 * is named — or null when it cannot be read. Live records of one member never
 * overlap one another, so ordering by the range is ordering by its lower
 * bound.
 */
async function conflictOf(
  table: LeaveTable,
  organizationId: string,
  memberId: string,
  from: string,
  to: string,
  excludedId?: string,
): Promise<LeaveRange | null> {
  let answered: LeaveReadAnswer;

  try {
    const live = table
      .select(DURING_COLUMN)
      .eq(ORGANIZATION_COLUMN, organizationId)
      .eq(MEMBER_COLUMN, memberId)
      .is(REMOVED_COLUMN, null);

    answered = await (excludedId === undefined ? live : live.neq(ID_COLUMN, excludedId))
      .overlaps(DURING_COLUMN, rangeLiteralOf(from, to))
      .order(DURING_COLUMN, { ascending: true })
      .limit(1);
  } catch (cause) {
    console.error(LEAVE_OVERLAP, cause);

    return null;
  }

  if (typeof answered !== 'object' || answered === null || answered.error !== null || !Array.isArray(answered.data)) {
    console.error(LEAVE_OVERLAP, typeof answered === 'object' && answered !== null ? answered.error?.code : typeof answered);

    return null;
  }

  const [row] = answered.data as readonly unknown[];
  const conflict =
    typeof row === 'object' && row !== null ? leaveRangeOf((row as Record<string, unknown>)[DURING_COLUMN]) : null;

  if (conflict === null) console.error(LEAVE_OVERLAP, 'no conflicting record was read');

  return conflict;
}

/**
 * Record leave for `memberId` from `from` to `to`, both `YYYY-MM-DD` and both
 * included. A date that is not a real calendar date is {@link LEAVE_FAILED}
 * without a request, so no malformed literal reaches the insert or the read.
 * A refused overlap answers {@link LEAVE_OVERLAP} with the earliest
 * conflicting record's dates when they can be read.
 */
export async function recordLeave(
  table: LeaveTable,
  organizationId: string,
  memberId: string,
  from: string,
  to: string,
): Promise<LeaveWriteOutcome> {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    console.error(LEAVE_FAILED, 'not a calendar date');

    return { ok: false, code: LEAVE_FAILED };
  }

  let answered: LeaveWriteAnswer;

  try {
    answered = await table.insert({
      organization_id: organizationId,
      member_id: memberId,
      during: rangeLiteralOf(from, to),
    });
  } catch (cause) {
    console.error(LEAVE_FAILED, cause);

    return { ok: false, code: LEAVE_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(LEAVE_FAILED, typeof answered);

    return { ok: false, code: LEAVE_FAILED };
  }

  // `null` alone is success; an absent or non-object error is a malformed answer.
  const error: unknown = answered.error;

  if (error === null) return { ok: true };

  if (typeof error !== 'object') {
    console.error(LEAVE_FAILED, typeof error);

    return { ok: false, code: LEAVE_FAILED };
  }

  const code = leaveInsertFailureOf(error as LeaveWriteError);

  if (code === LEAVE_OVERLAP) {
    return { ok: false, code, conflict: await conflictOf(table, organizationId, memberId, from, to) };
  }

  if (code === LEAVE_FAILED) console.error(code, (error as LeaveWriteError).code);

  return { ok: false, code };
}

/** A call's answer as its error: `null` alone is success; anything malformed is logged and `undefined`. */
function answeredErrorOf(answered: unknown): LeaveWriteError | null | undefined {
  if (typeof answered !== 'object' || answered === null) {
    console.error(LEAVE_FAILED, typeof answered);

    return undefined;
  }

  const error: unknown = (answered as Record<string, unknown>)['error'];

  if (error === null) return null;

  if (typeof error !== 'object') {
    console.error(LEAVE_FAILED, typeof error);

    return undefined;
  }

  return error as LeaveWriteError;
}

/**
 * Remove the leave record `recordId`: 0029's soft-remove, attributed by the
 * database. The balance follows once the records are read again.
 */
export async function removeLeave(client: LeaveRecordRpc, recordId: string): Promise<LeaveRemovalOutcome> {
  let answered: LeaveWriteAnswer;

  try {
    answered = await client.rpc(REMOVE_LEAVE_RECORD_FUNCTION, { p_record_id: recordId });
  } catch (cause) {
    console.error(LEAVE_FAILED, cause);

    return { ok: false, code: LEAVE_FAILED };
  }

  const error = answeredErrorOf(answered);

  if (error === null) return { ok: true };
  if (error === undefined) return { ok: false, code: LEAVE_FAILED };

  const code = leaveChangeFailureOf(error);

  // A removal raises no exclusion; a 23P01 here is no answer of 0029's.
  if (code === LEAVE_OVERLAP || code === LEAVE_FAILED) {
    console.error(LEAVE_FAILED, error.code);

    return { ok: false, code: LEAVE_FAILED };
  }

  return { ok: false, code };
}

/**
 * Amend the leave record `recordId` of `memberId` to `from`–`to`, both
 * `YYYY-MM-DD` and both included: 0029's remove-and-insert in one
 * transaction, answering the replacement's id. A date that is not a real
 * calendar date is {@link LEAVE_FAILED} without a request. A refused overlap
 * answers {@link LEAVE_OVERLAP} with the earliest conflicting record's dates
 * when they can be read, never the amended record's; any refusal leaves the
 * amended record live and unchanged.
 *
 * PRECONDITION: `organizationId` and `memberId` must be those of `recordId`'s
 * record. They are used only for the 23P01 conflict read-back; the server
 * takes the member from the stored row.
 *
 * A {@link LEAVE_FAILED} from a malformed success answer (no replacement id)
 * may mean the amend landed. The caller must re-read the member's records
 * after any outcome, as 5.1c's card already does after a save.
 */
export async function amendLeave(
  client: LeaveRecordRpc,
  table: LeaveTable,
  organizationId: string,
  memberId: string,
  recordId: string,
  from: string,
  to: string,
): Promise<LeaveAmendOutcome> {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    console.error(LEAVE_FAILED, 'not a calendar date');

    return { ok: false, code: LEAVE_FAILED };
  }

  let answered: LeaveAmendAnswer;

  try {
    answered = await client.rpc(AMEND_LEAVE_RECORD_FUNCTION, { p_record_id: recordId, p_from: from, p_to: to });
  } catch (cause) {
    console.error(LEAVE_FAILED, cause);

    return { ok: false, code: LEAVE_FAILED };
  }

  const error = answeredErrorOf(answered);

  if (error === undefined) return { ok: false, code: LEAVE_FAILED };

  if (error === null) {
    const id: unknown = answered.data;

    if (typeof id === 'string' && id !== '') return { ok: true, id };

    // The amend landed, but its answer names no replacement.
    console.error(LEAVE_FAILED, 'no replacement id');

    return { ok: false, code: LEAVE_FAILED };
  }

  const code = leaveChangeFailureOf(error);

  if (code === LEAVE_OVERLAP) {
    return { ok: false, code, conflict: await conflictOf(table, organizationId, memberId, from, to, recordId) };
  }

  if (code === LEAVE_FAILED) console.error(code, error.code);

  return { ok: false, code };
}
