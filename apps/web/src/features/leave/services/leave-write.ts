import type { LeaveRange } from '@shift/domain';

/**
 * Recording a member's leave (story 5.1b) — the leave feature's write module,
 * in a `.ts` that renders nothing (AD-15).
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
 * AN OVERLAP NAMES ITS CONFLICT. On 23P01 one follow-up read finds the
 * member's earliest live record in the organization that overlaps the entered
 * range and returns its inclusive dates; if that read fails or finds nothing,
 * the code alone.
 *
 * LOGGED: a failure and a failed read-back. An overlap or a refusal is an
 * ordinary outcome and is not logged.
 *
 * Codes, never messages: story 5.1c maps them to Croatian at its edge.
 */

/** The table a leave record is inserted into (0028). */
export const LEAVE_RECORDS_TABLE = 'leave_records';

/** A live record of the same member already covers one of the dates (23P01). */
export const LEAVE_OVERLAP = 'overlap';
/** The caller may not record leave (42501). */
export const LEAVE_DENIED = 'denied';
/** Anything else — a refused range, another tenant's member, the network: try again. */
export const LEAVE_FAILED = 'failed';

export type LeaveWriteFailure = typeof LEAVE_OVERLAP | typeof LEAVE_DENIED | typeof LEAVE_FAILED;

export type LeaveWriteOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof LEAVE_OVERLAP;
      /** The conflicting live record's inclusive dates, or null when they could not be read. */
      readonly conflict: LeaveRange | null;
    }
  | { readonly ok: false; readonly code: typeof LEAVE_DENIED | typeof LEAVE_FAILED };

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

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const EXCLUSION_VIOLATION = '23P01';

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
 * `[from, to]`, or null when it cannot be read. Live records of one member
 * never overlap one another, so ordering by the range is ordering by its
 * lower bound.
 */
async function conflictOf(
  table: LeaveTable,
  organizationId: string,
  memberId: string,
  from: string,
  to: string,
): Promise<LeaveRange | null> {
  let answered: LeaveReadAnswer;

  try {
    answered = await table
      .select(DURING_COLUMN)
      .eq(ORGANIZATION_COLUMN, organizationId)
      .eq(MEMBER_COLUMN, memberId)
      .is(REMOVED_COLUMN, null)
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
