import { queryOptions } from '@tanstack/react-query';
import type { LeaveRange } from '@shift/domain';

import { readLeaveRowPages, type OrganizationLeaveRecordsAnswer } from '@/features/leave/services/leave-list';
import { leaveRangeOf } from '@/features/leave/services/leave-write';

/**
 * LEAVE REQUESTS, READ (0040, stories 9.3–9.5): the read side of the one
 * boundary `leave_requests` stands on, in a `.ts` that renders nothing
 * (AD-15). Its keys and columns, the statuses and their types, the row parse,
 * and three reads with their query options. The writes — the insert, the
 * withdrawal and the decision — are `leave-request-write.ts`, which imports
 * from here and never the reverse.
 *
 * THREE READS, each a select on `leave_requests` with
 * `leave_request_decisions` embedded through its composite key:
 *   - the viewer's own requests (9.3), filtered to the viewer's own member
 *     row (the calendar snapshot's). The select policy (0040) shows a
 *     member-role session its own rows alone, and the filter keeps the read
 *     the viewer's own where a session may read more (an admin); the parse
 *     still refuses any row of anybody else, so the answer is unavailable
 *     rather than a colleague's request drawn as the viewer's;
 *   - one request by its id (9.4), on its decision screen, with its
 *     decision's author and instant and no member filter — 0040 shows an
 *     active admin every request;
 *   - every request of the organization (9.5), parsed row by row as the
 *     decision screen's one request is, for *Za odluku* and *Danas*.
 *
 * ONE ROW PARSE: every read parses a row's id, member, range, status and
 * `closed_at` the same way, and the embedded decisions through one
 * normaliser, whether PostgREST answers the embed as a list, one object or
 * null.
 *
 * STATUS IS DERIVED, as 0040 stores it: pending while `closed_at` is null;
 * once closed, the decision's `outcome` (`approved` or `rejected`, or since
 * 0041 `deactivated`: closed on the member's deactivation), or withdrawn when
 * no decision exists. A PENDING REQUEST DERIVES NOTHING: no
 * balance, no conflict and no schedule reads it.
 *
 * Codes, never messages: the components map them to Croatian at their edge.
 */

/** The table a request is inserted into and read from (0040). */
export const LEAVE_REQUESTS_TABLE = 'leave_requests';

/** The one query key the viewer's own requests are read under. */
export const MY_LEAVE_REQUESTS_KEY = ['my-leave-requests'] as const;

/**
 * The columns read: the request's own, and its decision's outcome through the
 * embed. Since 0047 also what became of an approval's leave record
 * (`leave_record_change`, a computed field on the decision).
 */
export const LEAVE_REQUESTS_COLUMNS = 'id,member_id,during,closed_at,leave_request_decisions(outcome,leave_record_change)';

/**
 * The prefix every one request's key starts with (story 9.4): a request
 * decided or withdrawn re-reads each one held, whatever its id.
 */
export const LEAVE_REQUEST_ROOT_KEY = ['leave-request'] as const;

/** The key one request is read under by its id, on its decision screen (story 9.4). */
export function LEAVE_REQUEST_KEY(requestId: string) {
  return [...LEAVE_REQUEST_ROOT_KEY, requestId] as const;
}

/**
 * The columns one request is read with on its decision screen (story 9.4):
 * the request's own, and its decision's outcome, who decided and when. Since
 * story 9.5 also when it was sent (`created_at`), which orders requests that
 * start on one date in *Za odluku*.
 */
export const LEAVE_REQUEST_COLUMNS =
  'id,member_id,during,closed_at,created_at,leave_request_decisions(outcome,decided_by,decided_at,leave_record_change)';

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
/**
 * Closed because its member was deactivated from a date it reaches (0041):
 * a decision whose outcome is `deactivated`, by the deactivating admin.
 */
export const REQUEST_CLOSED_ON_DEACTIVATION = 'closedOnDeactivation';

/** The outcome 0041's trigger stores for a request its member's deactivation closed. */
export const DEACTIVATED_OUTCOME = 'deactivated';

export type LeaveRequestStatus =
  | typeof REQUEST_PENDING
  | typeof REQUEST_APPROVED
  | typeof REQUEST_REJECTED
  | typeof REQUEST_WITHDRAWN
  | typeof REQUEST_CLOSED_ON_DEACTIVATION;

/** The statuses a decision row stands for: an admin's approval or rejection, or a deactivation's close. */
export type DecidedLeaveRequestStatus =
  | typeof REQUEST_APPROVED
  | typeof REQUEST_REJECTED
  | typeof REQUEST_CLOSED_ON_DEACTIVATION;

/**
 * What became of an approved request's leave record since (0047): an admin
 * amended it (`amend_leave_record` replaced it, and the last replacement is
 * live) or removed it (the last record of its chain is removed). Derived on
 * read by the database; the request's status stays *Odobren*.
 */
export const LEAVE_RECORD_AMENDED = 'amended';
export const LEAVE_RECORD_REMOVED = 'removed';

export type LeaveRecordChange = typeof LEAVE_RECORD_AMENDED | typeof LEAVE_RECORD_REMOVED;

/**
 * The line under an approved request's *Odobren* (0047), alike on the
 * member's *Godišnji* and on *Odlučeno* (UX-DR52). Exhaustive.
 */
export function leaveRecordChangeMessageKey(
  change: LeaveRecordChange,
): 'godisnji.request.recordAmended' | 'godisnji.request.recordRemoved' {
  switch (change) {
    case LEAVE_RECORD_AMENDED:
      return 'godisnji.request.recordAmended';
    case LEAVE_RECORD_REMOVED:
      return 'godisnji.request.recordRemoved';
    default: {
      const unhandled: never = change;

      return unhandled;
    }
  }
}

/** One of the viewer's own requests: its id, its inclusive range, its status and when it was closed. */
export interface LeaveRequest extends LeaveRange {
  readonly id: string;
  readonly status: LeaveRequestStatus;
  /** The instant the request was closed (`closed_at`), or null while it is pending. */
  readonly closedAt: string | null;
  /**
   * An approved request's leave record, amended or removed since (0047); null
   * while it is live, for every other status, and for a row read before 0047
   * (an older copy kept on the device).
   */
  readonly recordChange: LeaveRecordChange | null;
}

const ID_COLUMN = 'id';
const MEMBER_COLUMN = 'member_id';
const DURING_COLUMN = 'during';
const CLOSED_COLUMN = 'closed_at';
const DECISIONS_EMBED = 'leave_request_decisions';
const OUTCOME_COLUMN = 'outcome';
const RECORD_CHANGE_COLUMN = 'leave_record_change';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A request's embedded decisions as a list: PostgREST answers the embed as a
 * list, or as one object or null when it reads the key as one-to-one; all
 * three are taken.
 */
function decisionsOf(embedded: unknown): readonly unknown[] {
  if (Array.isArray(embedded)) return embedded;

  return embedded === null || embedded === undefined ? [] : [embedded];
}

/**
 * A closed request's status from its embedded decisions: the one decision's
 * outcome, or withdrawn when there is none; null when the embed is not a
 * decision PostgREST could answer (more than one, or an unknown outcome).
 */
function closedStatusOf(embedded: unknown): LeaveRequestStatus | null {
  const decisions = decisionsOf(embedded);

  if (decisions.length === 0) return REQUEST_WITHDRAWN;
  if (decisions.length > 1) return null;

  const [decision] = decisions;
  const outcome = isRecord(decision) ? decision[OUTCOME_COLUMN] : undefined;

  if (outcome === REQUEST_APPROVED) return REQUEST_APPROVED;
  if (outcome === REQUEST_REJECTED) return REQUEST_REJECTED;
  if (outcome === DEACTIVATED_OUTCOME) return REQUEST_CLOSED_ON_DEACTIVATION;

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
 * An approved request's record change from its one decision (0047): null when
 * the field is null or absent (a row read before 0047); undefined when it is
 * anything but `amended` or `removed`, which no row can be trusted with.
 * Every other status reads null: the database answers null for a decision
 * with no leave record.
 */
function recordChangeOf(status: LeaveRequestStatus, embedded: unknown): LeaveRecordChange | null | undefined {
  if (status !== REQUEST_APPROVED) return null;

  const [decision] = decisionsOf(embedded);
  const change = isRecord(decision) ? decision[RECORD_CHANGE_COLUMN] : undefined;

  if (change === null || change === undefined) return null;
  if (change === LEAVE_RECORD_AMENDED || change === LEAVE_RECORD_REMOVED) return change;

  console.error(LEAVE_REQUESTS_UNAVAILABLE, RECORD_CHANGE_COLUMN, typeof change);

  return undefined;
}

/**
 * One row's own facts, read the same way by every read: its id, its member,
 * its inclusive range, its status, when it was closed and, approved, what
 * became of its leave record. Null when the row is no object, carries no id
 * or no member, or has a range, a status or a record change that does not
 * parse.
 */
function requestRowOf(row: unknown): (LeaveRequest & { readonly memberId: string }) | null {
  if (!isRecord(row)) return null;

  const id = row[ID_COLUMN];
  const memberId = row[MEMBER_COLUMN];
  const range = leaveRangeOf(row[DURING_COLUMN]);
  const status = leaveRequestStatusOf(row[CLOSED_COLUMN], row[DECISIONS_EMBED]);
  const closed = row[CLOSED_COLUMN];

  if (typeof id !== 'string' || id === '') return null;
  if (typeof memberId !== 'string' || memberId === '' || range === null || status === null) return null;

  const recordChange = recordChangeOf(status, row[DECISIONS_EMBED]);

  if (recordChange === undefined) return null;

  return {
    id,
    memberId,
    from: range.from,
    to: range.to,
    status,
    closedAt: typeof closed === 'string' ? closed : null,
    recordChange,
  };
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
    const request = requestRowOf(row);

    if (request === null || request.memberId !== memberId || ids.has(request.id)) return null;

    ids.add(request.id);

    const { id, from, to, status, closedAt, recordChange } = request;

    requests.push({ id, from, to, status, closedAt, recordChange });
  }

  return requests.sort(compareRequests);
}

// ------------------------------------------------------- one request (9.4)

/**
 * A decided request's decision: its outcome, who decided (an auth user id) and
 * when. A close on deactivation (0041) is a decision too, by the deactivating
 * admin.
 */
export interface LeaveRequestDecision {
  readonly outcome: DecidedLeaveRequestStatus;
  /** `decided_by`: the deciding admin's auth user id. */
  readonly decidedBy: string;
  /** `decided_at`: the instant it was decided. */
  readonly decidedAt: string;
}

/** One request as its decision screen reads it: whose it is, and its decision once decided. */
export interface ReviewedLeaveRequest extends LeaveRequest {
  readonly memberId: string;
  /** The decision, for an approved, rejected or deactivation-closed request; null while pending or once withdrawn. */
  readonly decision: LeaveRequestDecision | null;
  /** When it was sent (`created_at`, story 9.5), or null when the read did not answer it. */
  readonly createdAt: string | null;
}

/** The read answered one request, or none with that id. */
export interface LeaveRequestFound {
  /** The request, or null when no row has that id: it does not exist, or the session may not read it. */
  readonly request: ReviewedLeaveRequest | null;
}

const DECIDED_BY_COLUMN = 'decided_by';
const CREATED_COLUMN = 'created_at';
const DECIDED_AT_COLUMN = 'decided_at';

/**
 * One row read with {@link LEAVE_REQUEST_COLUMNS} as a request with no member
 * filter (stories 9.4, 9.5): its member, range, status and, for an approved,
 * rejected or deactivation-closed one, who decided and when. Null when the row cannot be trusted:
 * no id, no member, a range or a status that does not parse, a sending
 * instant that is not one, or a decision without its author or its instant.
 */
function reviewedLeaveRequestOf(row: unknown): ReviewedLeaveRequest | null {
  const request = requestRowOf(row);

  // `requestRowOf` refuses a row that is no object; this narrows `row` for the reads below.
  if (request === null || !isRecord(row)) return null;

  const created = row[CREATED_COLUMN];

  if (created !== undefined && (typeof created !== 'string' || Number.isNaN(Date.parse(created)))) return null;

  const { status } = request;
  let decision: LeaveRequestDecision | null = null;

  if (status === REQUEST_APPROVED || status === REQUEST_REJECTED || status === REQUEST_CLOSED_ON_DEACTIVATION) {
    const decisions = decisionsOf(row[DECISIONS_EMBED]);
    const [decided] = decisions;

    if (decisions.length !== 1 || !isRecord(decided)) return null;

    const decidedBy = decided[DECIDED_BY_COLUMN];
    const decidedAt = decided[DECIDED_AT_COLUMN];

    if (typeof decidedBy !== 'string' || decidedBy === '' || typeof decidedAt !== 'string' || decidedAt === '') {
      return null;
    }

    decision = { outcome: status, decidedBy, decidedAt };
  }

  return { ...request, decision, createdAt: typeof created === 'string' ? created : null };
}

/**
 * The rows a by-id read answered as one request (story 9.4), with no member
 * filter: none is the request missing, one is it — its member, range, status
 * and, for an approved, rejected or deactivation-closed one, who decided and
 * when. Null when the
 * answer cannot be trusted: more than one row, a row of another id, a range
 * or a status that does not parse, or a decision without its author or its
 * instant.
 */
export function leaveRequestFoundOf(rows: readonly unknown[], requestId: string): LeaveRequestFound | null {
  if (rows.length === 0) return { request: null };
  if (rows.length > 1) return null;

  const [row] = rows;

  if (!isRecord(row) || row[ID_COLUMN] !== requestId) return null;

  const request = reviewedLeaveRequestOf(row);

  return request === null ? null : { request };
}

/**
 * EVERY REQUEST OF THE ORGANIZATION (story 9.5), as *Za odluku* reads them:
 * each row through the decision screen's own parse, in the list's order (by
 * the range's start, then its end and the id). Null when any row cannot be
 * trusted, or two rows carry one id — never a partial list.
 */
export function organizationLeaveRequestsOf(rows: readonly unknown[]): readonly ReviewedLeaveRequest[] | null {
  const requests: ReviewedLeaveRequest[] = [];
  const ids = new Set<string>();

  for (const row of rows) {
    const request = reviewedLeaveRequestOf(row);

    if (request === null || ids.has(request.id)) return null;

    ids.add(request.id);
    requests.push(request);
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

/** The read's one filter — by member, or by id — answering the rows, as supabase-js's builder does. */
export interface LeaveRequestsQuery {
  eq(column: string, value: string): PromiseLike<LeaveRequestsAnswer>;
}

/**
 * The select on `leave_requests` the viewer's own read and the by-id read
 * make, named structurally so it can be stubbed.
 */
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

  return rowsOutcomeOf(answered);
}

/** A select's answer as its rows, or unavailable when it failed or answered something that is not rows. */
function rowsOutcomeOf(answered: unknown): LeaveRequestRowsOutcome {
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

/** Whether `value` is a uuid as PostgREST takes one: any other id names no request, so nothing is asked. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One request's rows by its id (story 9.4), as the select answered them,
 * unparsed, or unavailable. The select policy (0040) shows an active admin
 * every request of the organization, so no member filter is applied; an id
 * that is not a uuid is answered with no rows and no request, since none can
 * carry it.
 */
export async function readLeaveRequestRows(
  table: LeaveRequestsTable,
  requestId: string,
): Promise<LeaveRequestRowsOutcome> {
  if (!UUID.test(requestId)) return { ok: true, rows: [] };

  let answered: unknown;

  try {
    answered = await table.select(LEAVE_REQUEST_COLUMNS).eq(ID_COLUMN, requestId);
  } catch (cause) {
    console.error(LEAVE_REQUESTS_UNAVAILABLE, cause);

    return { ok: false, code: LEAVE_REQUESTS_UNAVAILABLE };
  }

  return rowsOutcomeOf(answered);
}

/**
 * The one query key the organization's requests are read under (story 9.5):
 * *Za odluku*'s pending requests and *Odlučeno*'s decided ones, one read for
 * both tabs and *Danas*.
 */
export const ORGANIZATION_LEAVE_REQUESTS_KEY = ['organization-leave-requests'] as const;

/** The organization's read: a stable order, and one page of it, with the exact count. */
export interface OrganizationLeaveRequestsQuery {
  order(column: string, options: { readonly ascending: boolean }): OrganizationLeaveRequestsQuery;
  range(from: number, to: number): PromiseLike<OrganizationLeaveRecordsAnswer>;
}

/** The one call made on `leave_requests` for the organization, named structurally so it can be stubbed. */
export interface OrganizationLeaveRequestsTable {
  select(columns: string, options: { readonly count: 'exact' }): OrganizationLeaveRequestsQuery;
}

/**
 * EVERY REQUEST OF THE ORGANIZATION (story 9.5), pending and closed, with its
 * decision's outcome, author and instant embedded, as the select answered
 * them, unparsed, or unavailable. No filter: the select policy (0040) shows
 * an active admin every request of the organization, and only the admin's
 * surfaces make this read. NO WINDOW, as *Odlučeno*'s resolutions: paged by
 * the leave records' own loop (`readLeaveRowPages`) under `max_rows`,
 * ordered by id, with an exact count.
 */
export async function readOrganizationLeaveRequestRows(
  table: OrganizationLeaveRequestsTable,
): Promise<LeaveRequestRowsOutcome> {
  const outcome = await readLeaveRowPages((from, to) =>
    table.select(LEAVE_REQUEST_COLUMNS, { count: 'exact' }).order(ID_COLUMN, { ascending: true }).range(from, to),
  );

  return outcome.ok ? outcome : { ok: false, code: LEAVE_REQUESTS_UNAVAILABLE };
}

/**
 * The query options the organization's requests are read with, under
 * {@link ORGANIZATION_LEAVE_REQUESTS_KEY} (story 9.5). The rows are kept
 * unparsed, as the organization's leave records are, and parsed by the queue.
 */
export function organizationLeaveRequestsQueryOptions(table: () => OrganizationLeaveRequestsTable) {
  return queryOptions({
    queryKey: ORGANIZATION_LEAVE_REQUESTS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readOrganizationLeaveRequestRows(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    // NEVER FRESH: a request is sent and withdrawn by a member, in another
    // session, which no write of the admin's names; so every opening of the
    // queue, its resolution page or *Danas* reads them again. The admin's own
    // decisions name this key among their dependents.
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

/**
 * The query options one request is read with on its decision screen, under
 * {@link LEAVE_REQUEST_KEY} (story 9.4). The rows are kept unparsed, as the
 * viewer's own are, and parsed by the screen.
 */
export function leaveRequestQueryOptions(table: () => LeaveRequestsTable, requestId: string) {
  return queryOptions({
    queryKey: LEAVE_REQUEST_KEY(requestId),
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readLeaveRequestRows(table(), requestId);

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    staleTime: LEAVE_REQUESTS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
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
