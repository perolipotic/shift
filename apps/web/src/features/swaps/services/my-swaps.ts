import { queryOptions } from '@tanstack/react-query';
import { monthOf, type CollisionResolution } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberMonthDeltasOf, type MemberMonthDelta } from '@/features/calendar/utils/change-preview';
import type { OpenSwapProposal } from '@/features/calendar/utils/day-detail';
import {
  SWAP_REQUESTS_TABLE,
  swapAppliedOf,
  swapDayOf,
  swapShiftWorkedBy,
  type SwapShiftKey,
} from '@/features/swaps/services/swap-proposal';
import {
  DECISIONS_EMBED,
  SWAP_ACCEPTED,
  SWAP_APPROVED,
  SWAP_DEACTIVATED,
  SWAP_DECLINED,
  SWAP_PROPOSED,
  SWAP_REJECTED,
  SWAP_WITHDRAWN,
  swapOpen,
  swapStatusOf,
  type SwapStatus,
} from '@/features/swaps/services/organization-swaps';
import { formatIsoDate, isIsoDate } from '@/lib/i18n/format';

/**
 * THE VIEWER'S OWN SWAPS (story 12.3; FR-67, FR-69): the one member read of
 * `swap_requests`, its derived status, the *Zamjene* card's rows — their
 * order, past and stale, the addressee's consequence and which buttons each
 * offers — and the two definer calls that answer and withdraw, their
 * refusals mapped by SQLSTATE. A pure `.ts` the node suite executes (AD-15):
 * codes and operands only; the card words them.
 *
 * THE READ is a select on `swap_requests` with `swap_request_decisions`
 * embedded, under 0049's RLS, filtered to the rows where the viewer is the
 * proposer or the addressee — an active admin reads every row of the
 * organization, so the filter applies to an admin too, and the parse still
 * refuses any row of anybody else. The card keeps every OPEN row, and a
 * CLOSED one while its given date is the organization's today or later.
 *
 * THE STATUS IS 0049's, DERIVED, NEVER STORED: open with no answer is
 * proposed; open and accepted waits for an admin; closed and declined is
 * declined; closed with a decision is its outcome; closed otherwise was
 * withdrawn. Each is one word, and a proposed swap reads by side: *Čeka tvoj
 * odgovor* to the addressee, *Čeka odgovor kolege* to the proposer.
 *
 * NOTHING DERIVES FROM A SWAP (R9.1): no schedule, hours or collision figure
 * reads this. The addressee's consequence is a PREVIEW, over the 12.2
 * proposal's own two-change "after" (`swapAppliedOf`) and the calendar's one
 * hour delta, and it never blocks.
 */

// ------------------------------------------------------------------- the read

/** The one query key the viewer's own swaps are read under. */
export const MY_SWAP_REQUESTS_KEY = ['my-swap-requests'] as const;

/** The columns read: the swap's own facts, its answer and close, and its decision's outcome. */
export const MY_SWAP_REQUESTS_COLUMNS = `id,proposer_id,addressee_id,team_id,date,return_team_id,return_date,answer,closed_at,${DECISIONS_EMBED}(outcome)`;

/** The read could not be answered, or answered something that is not rows. */
export const MY_SWAPS_UNAVAILABLE = 'MY_SWAPS_UNAVAILABLE';

/** The stale time of the read, as the viewer's own leave requests' (five minutes). */
export const MY_SWAPS_READ_STALE_MS = 300000;

export interface MySwapsReadError {
  readonly code?: string | undefined;
}

export interface MySwapsAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: MySwapsReadError | null;
}

/** The read's one filter — the viewer on either side — answering the rows, as supabase-js's builder does. */
export interface MySwapsQuery {
  or(filters: string): PromiseLike<MySwapsAnswer>;
}

/** The select on `swap_requests` the viewer's read makes, named structurally so it can be stubbed. */
export interface MySwapsTable {
  select(columns: string): MySwapsQuery;
}

export type MySwapRowsOutcome =
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly code: typeof MY_SWAPS_UNAVAILABLE };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a uuid as PostgREST takes one: the filter interpolates it, so nothing else is ever sent. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The filter: the viewer is the proposer or the addressee. */
export function mySwapsFilterOf(memberId: string): string {
  return `proposer_id.eq.${memberId},addressee_id.eq.${memberId}`;
}

/** The viewer's own swap rows — `memberId` the proposer or the addressee — as the select answered them, unparsed, or unavailable. */
export async function readMySwapRows(table: MySwapsTable, memberId: string): Promise<MySwapRowsOutcome> {
  if (!UUID.test(memberId)) {
    console.error(MY_SWAPS_UNAVAILABLE, 'member');

    return { ok: false, code: MY_SWAPS_UNAVAILABLE };
  }

  let answered: unknown;

  try {
    answered = await table.select(MY_SWAP_REQUESTS_COLUMNS).or(mySwapsFilterOf(memberId));
  } catch (cause) {
    console.error(MY_SWAPS_UNAVAILABLE, cause);

    return { ok: false, code: MY_SWAPS_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(MY_SWAPS_UNAVAILABLE, typeof answered);

    return { ok: false, code: MY_SWAPS_UNAVAILABLE };
  }

  if (answered['error'] !== null) {
    console.error(MY_SWAPS_UNAVAILABLE, isRecord(answered['error']) ? answered['error']['code'] : 'error');

    return { ok: false, code: MY_SWAPS_UNAVAILABLE };
  }

  const data = answered['data'];

  if (!Array.isArray(data)) {
    console.error(MY_SWAPS_UNAVAILABLE, 'shape');

    return { ok: false, code: MY_SWAPS_UNAVAILABLE };
  }

  return { ok: true, rows: data as readonly unknown[] };
}

/** The table the read names: 0049's, through the writer's one constant. */
export const MY_SWAPS_TABLE = SWAP_REQUESTS_TABLE;

/**
 * The query options the viewer's own swaps are read with, under
 * {@link MY_SWAP_REQUESTS_KEY}: `memberId` is the calendar snapshot's viewer,
 * and the read waits for it (null while the snapshot is unread). The rows are
 * kept unparsed, and parsed by each surface.
 */
export function mySwapRequestsQueryOptions(table: () => MySwapsTable, memberId: string | null) {
  return queryOptions({
    queryKey: MY_SWAP_REQUESTS_KEY,
    enabled: memberId !== null,
    queryFn: async (): Promise<readonly unknown[]> => {
      if (memberId === null) throw new Error(MY_SWAPS_UNAVAILABLE);

      const outcome = await readMySwapRows(table(), memberId);

      if (!outcome.ok) throw new Error(outcome.code);

      return outcome.rows;
    },
    // A colleague answers and withdraws in another session, which no write of
    // the viewer's names; the viewer's own writes name this key.
    staleTime: MY_SWAPS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 1000,
  });
}

// ----------------------------------------------------------------- the status

// THE STATUS lives in the organization's read (`./organization-swaps`), a low
// module the queue imports without reaching the proposal's rules (story
// 12.4); the viewer's own read derives it the same way, and re-exports it.
export {
  DECISIONS_EMBED,
  SWAP_ACCEPTED,
  SWAP_APPROVED,
  SWAP_DEACTIVATED,
  SWAP_DECLINED,
  SWAP_PROPOSED,
  SWAP_REJECTED,
  SWAP_WITHDRAWN,
  swapOpen,
  swapStatusOf,
  type SwapStatus,
} from '@/features/swaps/services/organization-swaps';

/** One swap as 0049 stores it, its status derived. */
export interface MySwap {
  readonly id: string;
  readonly proposerId: string;
  readonly addresseeId: string;
  readonly given: SwapShiftKey;
  readonly returnShift: SwapShiftKey | null;
  readonly status: SwapStatus;
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** One row as a swap, or `null` when it cannot be trusted. */
function swapOf(row: unknown): MySwap | null {
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

    returnShift = { teamId: backTeam, date: returnDate };
  }

  return { id, proposerId, addresseeId, given: { teamId, date }, returnShift, status };
}

/**
 * The rows as the viewer's own swaps, open and closed. A row that cannot be
 * trusted — no id or one an earlier row carries, neither side the viewer, a
 * date or a return shift that does not parse, or a status 0049 cannot derive
 * — is dropped and logged, and the others stand. `null` only when the answer
 * is not a list of rows at all.
 */
export function mySwapsOf(rows: unknown, viewerId: string): readonly MySwap[] | null {
  if (!Array.isArray(rows)) {
    console.error(MY_SWAPS_UNAVAILABLE, 'shape');

    return null;
  }

  const swaps: MySwap[] = [];
  const ids = new Set<string>();

  for (const row of rows as readonly unknown[]) {
    const swap = swapOf(row);

    if (swap === null || ids.has(swap.id) || (swap.proposerId !== viewerId && swap.addresseeId !== viewerId)) {
      console.error(MY_SWAPS_UNAVAILABLE, 'row');
      continue;
    }

    ids.add(swap.id);
    swaps.push(swap);
  }

  return swaps;
}

/**
 * The viewer's open proposals, the proposer's side alone (story 12.3), for
 * the day detail's mark and the proposal surface: `null` while the read is
 * unknown (`undefined`), or when its rows cannot be trusted (logged) — the
 * link is then offered as before, and 0049's 23505 stays the backstop.
 */
export function openSwapProposalsOf(rows: readonly unknown[] | undefined, viewerId: string): readonly OpenSwapProposal[] | null {
  if (rows === undefined) return null;

  const swaps = mySwapsOf(rows, viewerId);

  if (swaps === null) return null;

  return swaps
    .filter((swap) => swap.proposerId === viewerId && swapOpen(swap.status))
    .map((swap) => ({ teamId: swap.given.teamId, date: swap.given.date, addresseeId: swap.addresseeId }));
}

// ------------------------------------------------------------------ the rows

/** What a row's badge says, one word per state. */
export const SWAP_WORD_WAITING_YOU = 'waitingYou';
export const SWAP_WORD_WAITING_COLLEAGUE = 'waitingColleague';
export const SWAP_WORD_WAITING_DECISION = 'waitingDecision';

export type SwapWord =
  | typeof SWAP_WORD_WAITING_YOU
  | typeof SWAP_WORD_WAITING_COLLEAGUE
  | typeof SWAP_WORD_WAITING_DECISION
  | typeof SWAP_DECLINED
  | typeof SWAP_WITHDRAWN
  | typeof SWAP_APPROVED
  | typeof SWAP_REJECTED
  | typeof SWAP_DEACTIVATED;

/** The badge's word for `status`, seen by the proposer or by the addressee. */
export function swapWordOf(status: SwapStatus, viewerIsAddressee: boolean): SwapWord {
  if (status === SWAP_PROPOSED) return viewerIsAddressee ? SWAP_WORD_WAITING_YOU : SWAP_WORD_WAITING_COLLEAGUE;
  if (status === SWAP_ACCEPTED) return SWAP_WORD_WAITING_DECISION;

  return status;
}

/** A shift as a row names it: `subota 26.09.2026` and the team's name. */
export interface SwapShiftShown {
  readonly day: string;
  /** The team's name; `null` for a team the snapshot does not hold, which the card words as unknown. */
  readonly team: string | null;
}

/** One date of the consequence: on `shift`, the viewer works instead of the proposer, or the proposer instead of the viewer. */
export interface SwapConsequenceLine {
  readonly shift: SwapShiftShown;
  /** True when the viewer (the addressee) takes this shift; false when the proposer takes it back from them. */
  readonly viewerWorks: boolean;
}

/** What the swap does to the addressee once approved: who works which date, and their own hours per month. */
export interface SwapConsequence {
  readonly lines: readonly SwapConsequenceLine[];
  /** The addressee's months, in month order; `0` included. */
  readonly hours: readonly MemberMonthDelta[];
}

/** One row of the card. */
export interface MySwapRow {
  readonly swap: MySwap;
  readonly viewerIsAddressee: boolean;
  /** The other member's name; `null` when the snapshot does not hold them. */
  readonly colleagueName: string | null;
  readonly given: SwapShiftShown;
  readonly returnShift: SwapShiftShown | null;
  readonly word: SwapWord;
  /** A proposed swap addressed to the viewer: it waits for them, and is listed first. */
  readonly waitsForViewer: boolean;
  /** Open, and either date before the organization's today: *Datum je prošao*. Nothing closes it. */
  readonly past: boolean;
  /** Open, and no longer applies: the given shift is not the proposer's working shift, the return shift not the addressee's, or the roster change is refused. */
  readonly stale: boolean;
  /** The addressee's own consequence, for an open swap that still applies; `null` otherwise, and always for the proposer. */
  readonly consequence: SwapConsequence | null;
  readonly canAccept: boolean;
  readonly canDecline: boolean;
  readonly canWithdraw: boolean;
}

/** The shift as a row names it: the day detail's own day and team, or the bare date and the snapshot's team name. */
function shiftShownOf(snapshot: CalendarSnapshot, shift: SwapShiftKey): SwapShiftShown {
  const day = swapDayOf(snapshot, shift);

  if (day !== null) return { day: day.date, team: day.teamName };

  return {
    day: formatIsoDate(shift.date) ?? shift.date,
    team: snapshot.teams.find((team) => team.id === shift.teamId)?.name ?? null,
  };
}

/**
 * Whether an open swap no longer applies: the given shift is no longer the
 * proposer's working shift, the return shift no longer the addressee's, or
 * the roster change itself is refused (`ROSTER_TAKEN`). Never throws: a check
 * that cannot be run is stale (the cause logged), so *Prihvati* is withheld
 * rather than offered on a guess.
 */
export function swapStaleOf(snapshot: CalendarSnapshot, swap: MySwap): boolean {
  try {
    if (!swapShiftWorkedBy(snapshot, swap.given, swap.proposerId)) return true;
    if (swap.returnShift !== null && !swapShiftWorkedBy(snapshot, swap.returnShift, swap.addresseeId)) return true;

    return !swapAppliedOf(snapshot, swap).ok;
  } catch (cause) {
    console.error(cause);

    return true;
  }
}

/**
 * The addressee's consequence (story 12.3, never a gate): the 12.2 preview's
 * two changes over the stored swap, and the addressee's signed hour delta for
 * each month a date falls in, with `leaveKeys` — the viewer's own, as their
 * *Sati* counts them. `null` when the change is refused, or cannot be derived
 * (the cause logged).
 */
export function swapConsequenceOf(
  snapshot: CalendarSnapshot,
  swap: MySwap,
  leaveKeys: readonly CollisionResolution[],
): SwapConsequence | null {
  try {
    const applied = swapAppliedOf(snapshot, swap);

    if (!applied.ok) return null;

    const lines: SwapConsequenceLine[] = [{ shift: shiftShownOf(snapshot, swap.given), viewerWorks: true }];

    if (swap.returnShift !== null) lines.push({ shift: shiftShownOf(snapshot, swap.returnShift), viewerWorks: false });

    const months = [...new Set([swap.given.date, ...(swap.returnShift === null ? [] : [swap.returnShift.date])].map(monthOf))].sort();
    const hours = memberMonthDeltasOf(snapshot, applied.after, [swap.addresseeId], months, () => leaveKeys);

    return { lines, hours };
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

/** The earlier of a swap's dates is what "soonest" orders by; then the given date, the return date and the id. */
function compareRows(left: MySwapRow, right: MySwapRow): number {
  if (left.waitsForViewer !== right.waitsForViewer) return left.waitsForViewer ? -1 : 1;

  const first = (row: MySwapRow) =>
    row.swap.returnShift !== null && row.swap.returnShift.date < row.swap.given.date ? row.swap.returnShift.date : row.swap.given.date;
  const keys = (row: MySwapRow) => [first(row), row.swap.given.date, row.swap.returnShift?.date ?? '', row.swap.id];
  const [a, b] = [keys(left), keys(right)];

  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? '';
    const y = b[index] ?? '';

    if (x !== y) return x < y ? -1 : 1;
  }

  return 0;
}

/**
 * The card's rows (story 12.3): every OPEN swap of the viewer's, and a CLOSED
 * one while its given date is `today` or later; those that wait for the
 * viewer first, then the rest, soonest first.
 *
 *   - *Prihvati* and *Odbij* on a proposed swap, for the addressee — but
 *     *Prihvati* never on a stale or past one.
 *   - *Povuci* for the proposer while it is proposed or accepted, and for the
 *     addressee once it is accepted.
 *   - The consequence for the addressee alone, on an open swap that still
 *     applies.
 */
export function mySwapRowsOf(
  snapshot: CalendarSnapshot,
  swaps: readonly MySwap[],
  today: string,
  leaveKeys: readonly CollisionResolution[],
): readonly MySwapRow[] {
  const viewerId = snapshot.viewer.memberId;
  const rows: MySwapRow[] = [];

  for (const swap of swaps) {
    const open = swapOpen(swap.status);

    if (!open && swap.given.date < today) continue;

    const viewerIsAddressee = swap.addresseeId === viewerId;
    const colleagueId = viewerIsAddressee ? swap.proposerId : swap.addresseeId;
    const past = open && (swap.given.date < today || (swap.returnShift !== null && swap.returnShift.date < today));
    const stale = open && swapStaleOf(snapshot, swap);
    const proposed = swap.status === SWAP_PROPOSED;

    rows.push({
      swap,
      viewerIsAddressee,
      colleagueName: snapshot.members.find((member) => member.id === colleagueId)?.name ?? null,
      given: shiftShownOf(snapshot, swap.given),
      returnShift: swap.returnShift === null ? null : shiftShownOf(snapshot, swap.returnShift),
      word: swapWordOf(swap.status, viewerIsAddressee),
      waitsForViewer: proposed && viewerIsAddressee,
      past,
      stale,
      consequence: open && viewerIsAddressee && !stale ? swapConsequenceOf(snapshot, swap, leaveKeys) : null,
      canAccept: proposed && viewerIsAddressee && !stale && !past,
      canDecline: proposed && viewerIsAddressee,
      canWithdraw: viewerIsAddressee ? swap.status === SWAP_ACCEPTED : open,
    });
  }

  return rows.sort(compareRows);
}

// ----------------------------------------------------------------- the writes

/** The addressee's answer (0049). */
export const ANSWER_SWAP_REQUEST_FUNCTION = 'answer_swap_request';
/** Either member's withdrawal (0049, FR-69). */
export const WITHDRAW_SWAP_REQUEST_FUNCTION = 'withdraw_swap_request';

/** *Prihvati*. */
export const SWAP_ACCEPT = 'accept';
/** *Odbij*. */
export const SWAP_DECLINE = 'decline';
/** *Povuci*. */
export const SWAP_WITHDRAW = 'withdraw';

export type SwapAction = typeof SWAP_ACCEPT | typeof SWAP_DECLINE | typeof SWAP_WITHDRAW;

const NO_DATA_FOUND = 'P0002';
const INSUFFICIENT_PRIVILEGE = '42501';

/** No longer open for this (P0002): answered, withdrawn or decided in the meantime. */
export const SWAP_NOT_OPEN = 'notOpen';
/** Not allowed (42501): the session or an inactive account. */
export const SWAP_ACT_DENIED = 'denied';
/** Anything else — the network, a malformed answer: try again. */
export const SWAP_ACT_FAILED = 'failed';

export type SwapActFailure = typeof SWAP_NOT_OPEN | typeof SWAP_ACT_DENIED | typeof SWAP_ACT_FAILED;

export type SwapActOutcome = { readonly ok: true } | { readonly ok: false; readonly code: SwapActFailure };

export interface SwapActError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The two definer calls, named structurally so they can be stubbed. */
export interface SwapRequestRpc {
  rpc(fn: string, args: Readonly<Record<string, unknown>>): PromiseLike<{ readonly error: SwapActError | null }>;
}

/** A refused call by SQLSTATE: P0002 no longer open, 42501 not allowed, anything else failed. */
export function swapActFailureOf(error: SwapActError): SwapActFailure {
  if (error.code === NO_DATA_FOUND) return SWAP_NOT_OPEN;
  if (error.code === INSUFFICIENT_PRIVILEGE) return SWAP_ACT_DENIED;

  return SWAP_ACT_FAILED;
}

/** The call 0049 answers for `action`: the answer for *Prihvati* and *Odbij*, the withdrawal for *Povuci*. */
async function callFor(client: SwapRequestRpc, requestId: string, action: SwapAction): Promise<unknown> {
  if (action === SWAP_WITHDRAW) return client.rpc(WITHDRAW_SWAP_REQUEST_FUNCTION, { p_request_id: requestId });

  return client.rpc(ANSWER_SWAP_REQUEST_FUNCTION, {
    p_request_id: requestId,
    p_answer: action === SWAP_ACCEPT ? SWAP_ACCEPTED : SWAP_DECLINED,
  });
}

/**
 * *Prihvati*, *Odbij* or *Povuci* on `requestId`: 0049's definers, which
 * decide who may do what. NOTHING IS CHECKED HERE FIRST and nothing is
 * optimistic; the caller re-reads after any outcome.
 */
export async function actOnSwapRequest(client: SwapRequestRpc, requestId: string, action: SwapAction): Promise<SwapActOutcome> {
  let answered: unknown;

  try {
    answered = await callFor(client, requestId, action);
  } catch (cause) {
    console.error(SWAP_ACT_FAILED, cause);

    return { ok: false, code: SWAP_ACT_FAILED };
  }

  if (!isRecord(answered)) {
    console.error(SWAP_ACT_FAILED, typeof answered);

    return { ok: false, code: SWAP_ACT_FAILED };
  }

  const error: unknown = answered['error'];

  if (error === null) return { ok: true };
  if (!isRecord(error)) {
    console.error(SWAP_ACT_FAILED, typeof error);

    return { ok: false, code: SWAP_ACT_FAILED };
  }

  const code = swapActFailureOf(error as SwapActError);

  if (code === SWAP_ACT_FAILED) console.error(code, (error as SwapActError).code);

  return { ok: false, code };
}

// ------------------------------------------------------------------ the words

/** The badge's message, one word per state. */
export function swapWordMessageKey(
  word: SwapWord,
):
  | 'danas.swaps.status.waitingYou'
  | 'danas.swaps.status.waitingColleague'
  | 'danas.swaps.status.waitingDecision'
  | 'danas.swaps.status.declined'
  | 'danas.swaps.status.withdrawn'
  | 'danas.swaps.status.approved'
  | 'danas.swaps.status.rejected'
  | 'danas.swaps.status.deactivated' {
  switch (word) {
    case SWAP_WORD_WAITING_YOU:
      return 'danas.swaps.status.waitingYou';
    case SWAP_WORD_WAITING_COLLEAGUE:
      return 'danas.swaps.status.waitingColleague';
    case SWAP_WORD_WAITING_DECISION:
      return 'danas.swaps.status.waitingDecision';
    case SWAP_DECLINED:
      return 'danas.swaps.status.declined';
    case SWAP_WITHDRAWN:
      return 'danas.swaps.status.withdrawn';
    case SWAP_APPROVED:
      return 'danas.swaps.status.approved';
    case SWAP_REJECTED:
      return 'danas.swaps.status.rejected';
    case SWAP_DEACTIVATED:
      return 'danas.swaps.status.deactivated';
    default: {
      const unhandled: never = word;

      return unhandled;
    }
  }
}

/** The status line a landed action says. */
export function swapActedMessageKey(
  action: SwapAction,
): 'danas.swaps.accepted' | 'danas.swaps.declined' | 'danas.swaps.withdrawn' {
  switch (action) {
    case SWAP_ACCEPT:
      return 'danas.swaps.accepted';
    case SWAP_DECLINE:
      return 'danas.swaps.declined';
    case SWAP_WITHDRAW:
      return 'danas.swaps.withdrawn';
    default: {
      const unhandled: never = action;

      return unhandled;
    }
  }
}

/** The alert a refused action says. */
export function swapActFailureMessageKey(
  code: SwapActFailure,
): 'danas.swaps.notOpen' | 'danas.swaps.denied' | 'danas.swaps.failed' {
  switch (code) {
    case SWAP_NOT_OPEN:
      return 'danas.swaps.notOpen';
    case SWAP_ACT_DENIED:
      return 'danas.swaps.denied';
    case SWAP_ACT_FAILED:
      return 'danas.swaps.failed';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}
