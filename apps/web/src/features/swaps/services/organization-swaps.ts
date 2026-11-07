import { queryOptions } from '@tanstack/react-query';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { readLeaveRowPages, type OrganizationLeaveRecordsAnswer } from '@/features/leave/services/leave-list';
import type { SwapShiftKey } from '@/features/swaps/services/swap-proposal';
import { formatDate, formatIsoDate, formatTime, isIsoDate } from '@/lib/i18n/format';

/**
 * THE ORGANIZATION'S SWAPS (story 12.4; AD-4's third set, UX-DR52): the one
 * admin read of `swap_requests` with its decision, under 0049's admin RLS;
 * the status 0049 derives (shared with the viewer's own read, `./my-swaps`);
 * the *Za odluku* facts of an accepted swap waiting for an admin; the
 * *Odlučeno* facts of a decided one, and whether an approved one was changed
 * in the calendar since. A pure `.ts` the node suite executes (AD-15): codes,
 * names and operands only; the components word them.
 *
 * A LOW MODULE ON PURPOSE. The queue (`conflicts/services/conflicts-queue`)
 * imports it, and the proposal's rules (`./swap-proposal`) reach the queue
 * through the roster change's erasure guard; so this module imports nothing
 * of `./my-swaps` or `./swap-proposal` at runtime, and they import the status
 * from here instead. No import cycle, no top-level value in TDZ reach.
 *
 * THE STATUS IS 0049's, DERIVED, NEVER STORED: open with no answer is
 * proposed; open and accepted waits for an admin; closed and declined is
 * declined; closed with a decision is its outcome; closed otherwise was
 * withdrawn.
 *
 * NOTHING DERIVES FROM AN OPEN SWAP (R9.1): the queue LISTS an accepted swap,
 * never feeds it to a schedule, hours or collision figure. Only the
 * decision's own overrides, which the calendar reads as any other, change a
 * figure.
 *
 * NEVER A PARTIAL LIST, as the queue's: a row that cannot be trusted refuses
 * the whole read ({@link organizationSwapsOf} answers `null`), and the queue,
 * its count and *Odlučeno* are then unavailable.
 */

// ----------------------------------------------------------------- the status

/** Open, no answer yet. */
export const SWAP_PROPOSED = 'proposed';
/** Open and accepted: waits for an admin. */
export const SWAP_ACCEPTED = 'accepted';
/** Declined by the addressee (closed in the same call). */
export const SWAP_DECLINED = 'declined';
/** Closed by either member with no decision. */
export const SWAP_WITHDRAWN = 'withdrawn';
/** Approved by an admin. */
export const SWAP_APPROVED = 'approved';
/** Rejected by an admin. */
export const SWAP_REJECTED = 'rejected';
/** Closed on a member's deactivation (0049's `deactivated` decision). */
export const SWAP_DEACTIVATED = 'deactivated';

export type SwapStatus =
  | typeof SWAP_PROPOSED
  | typeof SWAP_ACCEPTED
  | typeof SWAP_DECLINED
  | typeof SWAP_WITHDRAWN
  | typeof SWAP_APPROVED
  | typeof SWAP_REJECTED
  | typeof SWAP_DEACTIVATED;

/** A decision's outcome: approved, rejected, or the deactivation close. */
export type SwapOutcome = typeof SWAP_APPROVED | typeof SWAP_REJECTED | typeof SWAP_DEACTIVATED;

/** The decisions embedded through their composite key (0049). */
export const DECISIONS_EMBED = 'swap_request_decisions';

/** Whether the swap is still open: proposed, or accepted and waiting for an admin. */
export function swapOpen(status: SwapStatus): boolean {
  return status === SWAP_PROPOSED || status === SWAP_ACCEPTED;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A decision embed as a list: PostgREST answers it as a list, one object or null; all three are taken. */
function decisionsOf(embedded: unknown): readonly unknown[] {
  if (Array.isArray(embedded)) return embedded;

  return embedded === null || embedded === undefined ? [] : [embedded];
}

/**
 * The status 0049 derives, or `null` when the row cannot say: open with a
 * decision, open and declined, an unknown answer or outcome, more than one
 * decision, an approval or rejection of a swap that was never accepted, or a
 * deactivation close of a declined one.
 */
export function swapStatusOf(closedAt: unknown, answer: unknown, decisions: unknown): SwapStatus | null {
  const decided = decisionsOf(decisions);

  if (answer !== null && answer !== undefined && answer !== SWAP_ACCEPTED && answer !== SWAP_DECLINED) return null;
  if (decided.length > 1) return null;

  if (closedAt === null || closedAt === undefined) {
    if (decided.length > 0) return null;
    if (answer === SWAP_ACCEPTED) return SWAP_ACCEPTED;

    return answer === SWAP_DECLINED ? null : SWAP_PROPOSED;
  }

  if (typeof closedAt !== 'string' || closedAt === '') return null;

  const [decision] = decided;

  if (decision !== undefined) {
    const outcome = isRecord(decision) ? decision['outcome'] : undefined;

    // An admin decides an accepted swap alone (0049's decision definer); the
    // deactivation close (`close_swap_requests_on_deactivation`) closes any
    // open swap, proposed or accepted, but never a declined one, which is
    // already closed. Any other pairing is a row 0049 cannot write.
    if (outcome === SWAP_APPROVED || outcome === SWAP_REJECTED) return answer === SWAP_ACCEPTED ? outcome : null;
    if (outcome === SWAP_DEACTIVATED) return answer === SWAP_DECLINED ? null : outcome;

    return null;
  }

  return answer === SWAP_DECLINED ? SWAP_DECLINED : SWAP_WITHDRAWN;
}

// ------------------------------------------------------------------- the read

/** The one query key the organization's swaps are read under: *Za odluku*, *Odlučeno*, admin *Danas* and the decision screen. */
export const ORGANIZATION_SWAP_REQUESTS_KEY = ['organization-swap-requests'] as const;

/**
 * THE ONE NAME of 0049's table, which the proposal's writer, the viewer's
 * read and this read all use. Defined here, in the low module, so the
 * proposal's rules import it without a cycle.
 */
export const SWAP_REQUESTS_TABLE = 'swap_requests';

/** The table the organization's read names: the one constant. */
export const ORGANIZATION_SWAPS_TABLE = SWAP_REQUESTS_TABLE;

/**
 * The columns read: the swap's own facts, when it was sent, its answer and
 * close, and its decision — the outcome, the overrides an approval wrote,
 * and who decided and when (AD-11).
 */
export const ORGANIZATION_SWAP_REQUESTS_COLUMNS = `id,proposer_id,addressee_id,team_id,date,return_team_id,return_date,answer,closed_at,created_at,${DECISIONS_EMBED}(outcome,roster_override_id,return_roster_override_id,decided_by,decided_at)`;

/** The read could not be answered, or answered something that is not every row. */
export const ORGANIZATION_SWAPS_UNAVAILABLE = 'ORGANIZATION_SWAPS_UNAVAILABLE';

/** The organization's read: a stable order, and one page of it, with the exact count. */
export interface OrganizationSwapsQuery {
  order(column: string, options: { readonly ascending: boolean }): OrganizationSwapsQuery;
  range(from: number, to: number): PromiseLike<OrganizationLeaveRecordsAnswer>;
}

/** The one call made on `swap_requests` for the organization, named structurally so it can be stubbed. */
export interface OrganizationSwapsTable {
  select(columns: string, options: { readonly count: 'exact' }): OrganizationSwapsQuery;
}

export type OrganizationSwapRowsOutcome =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: typeof ORGANIZATION_SWAPS_UNAVAILABLE };

const ID_COLUMN = 'id';

/**
 * EVERY SWAP OF THE ORGANIZATION, open and closed, with its decision
 * embedded, as the select answered them, unparsed, or unavailable. No filter:
 * 0049's select policy shows an active admin every swap of the organization,
 * and only the admin's surfaces make this read. Paged by the leave records'
 * own loop (`readLeaveRowPages`) under `max_rows`, ordered by id, with an
 * exact count, as the organization's leave requests are.
 */
export async function readOrganizationSwapRows(table: OrganizationSwapsTable): Promise<OrganizationSwapRowsOutcome> {
  const outcome = await readLeaveRowPages((from, to) =>
    table.select(ORGANIZATION_SWAP_REQUESTS_COLUMNS, { count: 'exact' }).order(ID_COLUMN, { ascending: true }).range(from, to),
  );

  if (outcome.ok) return outcome;

  console.error(ORGANIZATION_SWAPS_UNAVAILABLE, outcome.code);

  return { ok: false, code: ORGANIZATION_SWAPS_UNAVAILABLE };
}

/**
 * The query options the organization's swaps are read with, under
 * {@link ORGANIZATION_SWAP_REQUESTS_KEY}. The rows are kept unparsed, as the
 * organization's leave requests are, and parsed by each surface.
 */
export function organizationSwapRequestsQueryOptions(table: () => OrganizationSwapsTable) {
  return queryOptions({
    queryKey: ORGANIZATION_SWAP_REQUESTS_KEY,
    queryFn: async (): Promise<readonly unknown[]> => {
      const outcome = await readOrganizationSwapRows(table());

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    // NEVER FRESH: a swap is proposed, accepted and withdrawn by members in
    // other sessions, which no write of the admin's names; so every opening of
    // the queue, *Danas* or a decision screen reads them again. The admin's own
    // decisions name this key among their dependents.
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

// ------------------------------------------------------------------ the parse

/** A swap's decision as 0049 stores it (AD-11): the outcome, an approval's overrides, and who decided and when. */
export interface SwapDecision {
  readonly outcome: SwapOutcome;
  /** The override an approval wrote on the given shift; `null` unless approved. */
  readonly rosterOverrideId: string | null;
  /** The override an approval wrote on the return shift; `null` unless approved with a return shift. */
  readonly returnRosterOverrideId: string | null;
  /** The deciding admin's auth user (`decided_by`); for a deactivation close, the deactivating admin. */
  readonly decidedBy: string;
  /** The instant, as the database answered it. */
  readonly decidedAt: string;
}

/** One swap of the organization, its status derived, with when it was sent and its decision. */
export interface OrganizationSwap {
  readonly id: string;
  readonly proposerId: string;
  readonly addresseeId: string;
  readonly given: SwapShiftKey;
  readonly returnShift: SwapShiftKey | null;
  readonly status: SwapStatus;
  /** When it was sent; `null` when the row has none, which sorts it after every other (one that is not an instant refuses the row). */
  readonly createdAt: string | null;
  /** The decision, for an approved, rejected or deactivation-closed swap; `null` otherwise. */
  readonly decision: SwapDecision | null;
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** An optional id: a text, or `null` for none; `undefined` for anything else, which cannot be trusted. */
function optionalIdOf(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;

  return idOf(value) ?? undefined;
}

/** Whether `value` is an instant `Date` reads. */
function instantOf(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

/**
 * The decision of a closed swap with status `status`, or `undefined` when it
 * cannot be trusted: an approval names the given shift's override, and the
 * return shift's exactly when there is one; a rejection or deactivation close
 * names neither; every decision names its author and instant.
 */
function decisionOf(embedded: unknown, status: SwapStatus, hasReturn: boolean): SwapDecision | null | undefined {
  const [decision] = decisionsOf(embedded);

  if (status !== SWAP_APPROVED && status !== SWAP_REJECTED && status !== SWAP_DEACTIVATED) {
    return decision === undefined ? null : undefined;
  }

  if (!isRecord(decision)) return undefined;

  const rosterOverrideId = optionalIdOf(decision['roster_override_id']);
  const returnRosterOverrideId = optionalIdOf(decision['return_roster_override_id']);
  const decidedBy = idOf(decision['decided_by']);
  const decidedAt = instantOf(decision['decided_at']);

  if (rosterOverrideId === undefined || returnRosterOverrideId === undefined) return undefined;
  if (decidedBy === null || decidedAt === null) return undefined;

  if (status === SWAP_APPROVED) {
    if (rosterOverrideId === null || (returnRosterOverrideId !== null) !== hasReturn) return undefined;
  } else if (rosterOverrideId !== null || returnRosterOverrideId !== null) {
    return undefined;
  }

  return { outcome: status, rosterOverrideId, returnRosterOverrideId, decidedBy, decidedAt };
}

/** One row as a swap of the organization, or `null` when it cannot be trusted. */
export function organizationSwapOf(row: unknown): OrganizationSwap | null {
  if (!isRecord(row)) return null;

  const id = idOf(row['id']);
  const proposerId = idOf(row['proposer_id']);
  const addresseeId = idOf(row['addressee_id']);
  const teamId = idOf(row['team_id']);
  const date = row['date'];
  const returnTeamId = row['return_team_id'];
  const returnDate = row['return_date'];
  const status = swapStatusOf(row['closed_at'], row['answer'], row[DECISIONS_EMBED]);

  if (id === null || proposerId === null || addresseeId === null || teamId === null || status === null) return null;
  if (proposerId === addresseeId) return null;
  if (typeof date !== 'string' || !isIsoDate(date)) return null;

  let returnShift: SwapShiftKey | null = null;

  if (returnTeamId !== null || returnDate !== null) {
    const backTeam = idOf(returnTeamId);

    if (backTeam === null || typeof returnDate !== 'string' || !isIsoDate(returnDate)) return null;
    if (backTeam === teamId && returnDate === date) return null;

    returnShift = { teamId: backTeam, date: returnDate };
  }

  const decision = decisionOf(row[DECISIONS_EMBED], status, returnShift !== null);

  if (decision === undefined) return null;

  // WHEN IT WAS SENT orders the queue: present, it must be an instant, as a leave request's is.
  const sent = row['created_at'];
  const createdAt = sent === null || sent === undefined ? null : instantOf(sent);

  if (sent !== null && sent !== undefined && createdAt === null) return null;

  return {
    id,
    proposerId,
    addresseeId,
    given: { teamId, date },
    returnShift,
    status,
    createdAt,
    decision,
  };
}

/**
 * EVERY SWAP OF THE ORGANIZATION, each row through {@link organizationSwapOf},
 * in the order read. Null when any row cannot be trusted or two carry one id —
 * never a partial list.
 */
export function organizationSwapsOf(rows: readonly unknown[]): readonly OrganizationSwap[] | null {
  const swaps: OrganizationSwap[] = [];
  const ids = new Set<string>();

  for (const row of rows) {
    const swap = organizationSwapOf(row);

    if (swap === null || ids.has(swap.id)) {
      console.error(ORGANIZATION_SWAPS_UNAVAILABLE, 'row');

      return null;
    }

    ids.add(swap.id);
    swaps.push(swap);
  }

  return swaps;
}

/** One swap found by id: `swap` null for none (or one the session may not read). */
export interface OrganizationSwapFound {
  readonly swap: OrganizationSwap | null;
}

/** The swap `requestId` among the rows read, or `null` when the rows cannot be trusted. */
export function organizationSwapFoundOf(rows: readonly unknown[], requestId: string): OrganizationSwapFound | null {
  const swaps = organizationSwapsOf(rows);

  if (swaps === null) return null;

  return { swap: swaps.find((swap) => swap.id === requestId) ?? null };
}

// ------------------------------------------------------------------ the names

/** A shift as a *Za odluku* row names it: `12.09.2026 · Smjena B`. */
export interface SwapShiftNamed {
  readonly date: string;
  /** `12.09.2026`. */
  readonly dateShown: string;
  readonly teamName: string;
}

/** What every listed swap names: whose it is, the shifts, and the date it is dated by. */
export interface SwapNamed {
  readonly requestId: string;
  /** The earlier of its dates, `YYYY-MM-DD`: what the row is dated and ordered by. */
  readonly date: string;
  /** That date, `12.09.2026`. */
  readonly dateShown: string;
  readonly proposerName: string;
  readonly addresseeName: string;
  readonly given: SwapShiftNamed;
  readonly returnShift: SwapShiftNamed | null;
}

/** The earlier of a swap's dates: the given date, or the return date when it comes first. */
export function swapFirstDateOf(swap: { readonly given: SwapShiftKey; readonly returnShift: SwapShiftKey | null }): string {
  return swap.returnShift !== null && swap.returnShift.date < swap.given.date ? swap.returnShift.date : swap.given.date;
}

/** The later of a swap's dates. */
export function swapLastDateOf(swap: { readonly given: SwapShiftKey; readonly returnShift: SwapShiftKey | null }): string {
  return swap.returnShift !== null && swap.returnShift.date > swap.given.date ? swap.returnShift.date : swap.given.date;
}

/**
 * A shift named from the snapshot.
 *
 * @throws RangeError when the snapshot lacks its team, or the date cannot be formatted.
 */
function shiftNamedOf(snapshot: CalendarSnapshot, shift: SwapShiftKey): SwapShiftNamed {
  const teamName = snapshot.teams.find((team) => team.id === shift.teamId)?.name;
  const dateShown = formatIsoDate(shift.date);

  if (teamName === undefined) throw new RangeError(`team ${shift.teamId} is not in the snapshot`);
  if (dateShown === null) throw new RangeError(`the date ${shift.date} cannot be formatted`);

  return { date: shift.date, dateShown, teamName };
}

/**
 * A swap named from the snapshot. A member or team the snapshot does not hold
 * is a skew between the reads, which every caller asks first
 * (`unknownSnapshotIdsOf`); here it is a row that cannot be drawn.
 *
 * @throws RangeError when the snapshot lacks a member or a team, or a date cannot be formatted.
 */
export function swapNamedOf(snapshot: CalendarSnapshot, swap: OrganizationSwap): SwapNamed {
  const names = new Map(snapshot.members.map((member) => [member.id, member.name]));
  const proposerName = names.get(swap.proposerId);
  const addresseeName = names.get(swap.addresseeId);
  const date = swapFirstDateOf(swap);
  const dateShown = formatIsoDate(date);

  if (proposerName === undefined) throw new RangeError(`member ${swap.proposerId} is not in the snapshot`);
  if (addresseeName === undefined) throw new RangeError(`member ${swap.addresseeId} is not in the snapshot`);
  if (dateShown === null) throw new RangeError(`the date ${date} cannot be formatted`);

  return {
    requestId: swap.id,
    date,
    dateShown,
    proposerName,
    addresseeName,
    given: shiftNamedOf(snapshot, swap.given),
    returnShift: swap.returnShift === null ? null : shiftNamedOf(snapshot, swap.returnShift),
  };
}

/**
 * The organization's swaps from the rows as read.
 *
 * @throws RangeError when a swap row cannot be trusted.
 */
function trustedSwapsOf(swapRows: readonly unknown[]): readonly OrganizationSwap[] {
  const swaps = organizationSwapsOf(swapRows);

  if (swaps === null) throw new RangeError('a swap request row cannot be trusted');

  return swaps;
}

// ------------------------------------------------------------------ the queue

/** One accepted swap waiting for an admin, as *Za odluku* lists it. */
export interface WaitingSwap extends SwapNamed {
  /** Either date before the organization's today: drawn as a past row. */
  readonly past: boolean;
  /** When it was sent: swaps on one date are ordered by it, oldest first, then by id. */
  readonly createdAt: string | null;
}

/**
 * Every OPEN, ACCEPTED swap of the organization — the ones waiting for an
 * admin (0049) — named from the snapshot, against `today`. A proposed swap
 * waits for its colleague, not for an admin, and is not listed.
 *
 * @throws RangeError when a swap row cannot be trusted, or names a member or
 *   team the snapshot lacks, or a date that cannot be formatted.
 */
export function waitingSwapsOf(snapshot: CalendarSnapshot, swapRows: readonly unknown[], today: string): readonly WaitingSwap[] {
  return trustedSwapsOf(swapRows)
    .filter((swap) => swap.status === SWAP_ACCEPTED)
    .map((swap) => ({
      ...swapNamedOf(snapshot, swap),
      past: swap.given.date < today || (swap.returnShift !== null && swap.returnShift.date < today),
      createdAt: swap.createdAt,
    }));
}

// --------------------------------------------------------------- *Odlučeno*

/** One decided swap, as *Odlučeno* lists it. */
export interface DecidedSwap extends SwapNamed {
  readonly outcome: SwapOutcome;
  /**
   * An approved swap whose override — on the given or the return shift — is
   * no longer live in the snapshot: amended (0039 replaces the id) or removed
   * since. Derived on read; false for every other outcome.
   */
  readonly changedLater: boolean;
  /** The deciding admin's name, or `null` when they are no longer a member. */
  readonly actorName: string | null;
  /** `12.09.2026`, in the organization's zone. */
  readonly decidedOn: string;
  /** `19:00`, in the organization's zone. */
  readonly decidedAt: string;
  /** The decision's instant in ms: what the tab orders by, newest first. */
  readonly at: number;
}

/**
 * Whether an approved swap was changed in the calendar since (story 12.4):
 * an override it wrote is no longer among the snapshot's live ones.
 * `calendar_roster_overrides()` answers every live override, and an amend
 * replaces the id (0039), so no migration is needed to tell.
 */
export function swapChangedLaterOf(snapshot: CalendarSnapshot, decision: SwapDecision): boolean {
  if (decision.outcome !== SWAP_APPROVED) return false;

  const live = new Set(snapshot.rosterOverrides.map((override) => override.id));

  return [decision.rosterOverrideId, decision.returnRosterOverrideId].some((id) => id !== null && !live.has(id));
}

/**
 * Every DECIDED swap of the organization — approved, rejected, or closed on a
 * member's deactivation — named from the snapshot and `actors` (auth user id
 * → name). A withdrawn or declined swap was never decided and is not listed;
 * an open one waits.
 *
 * @throws RangeError when a swap row cannot be trusted, or names a member or
 *   team the snapshot lacks, or a date that cannot be formatted.
 */
export function decidedSwapsOf(
  snapshot: CalendarSnapshot,
  swapRows: readonly unknown[],
  actors: ReadonlyMap<string, string>,
): readonly DecidedSwap[] {
  return trustedSwapsOf(swapRows).flatMap((swap) => {
    const decision = swap.decision;

    if (decision === null) return [];

    const instant = new Date(decision.decidedAt);

    return [
      {
        ...swapNamedOf(snapshot, swap),
        outcome: decision.outcome,
        changedLater: swapChangedLaterOf(snapshot, decision),
        actorName: actors.get(decision.decidedBy) ?? null,
        decidedOn: formatDate(instant, snapshot.timeZone),
        decidedAt: formatTime(instant, snapshot.timeZone),
        at: instant.getTime(),
      },
    ];
  });
}
