import { collisionKeyOf, collisionsOf, unresolvedCollisionsOf, type Collision, type CollisionInput, type LeaveHalf } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { unknownSnapshotIdsOf } from '@/features/calendar/services/snapshot-skew';
import { calendarTodayOf, snapshotScheduleInputOf, typeRangeOn } from '@/features/calendar/utils/month';
import { organizationLeaveRecordsOf, type OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import {
  REQUEST_PENDING,
  organizationLeaveRequestsOf,
  type ReviewedLeaveRequest,
} from '@/features/leave/services/leave-request-list';
import { leaveRangeValuesOf } from '@/features/leave/services/leave-section';
import { effectiveResolutionsOf } from '@/features/conflicts/services/replacement-effect';
import { conflictResolutionsOf, type ConflictResolution } from '@/features/conflicts/services/resolutions';
import { formatIsoDate } from '@/lib/i18n/format';
import { waitingSwapsOf, type SwapShiftNamed } from '@/features/swaps/services/organization-swaps';

/**
 * *Za odluku* for an admin: the conflicts queue (story 5.3b; CAP-16, R6.8,
 * UX-DR20, UX-DR25), as a pure view model in a `.ts` that renders nothing
 * (AD-15). The hook only wires it; the node suite executes it.
 *
 * DERIVED, NEVER STORED (AD-4). Every row is one of `collisionsOf`'s
 * collisions, from the calendar's one snapshot and the organization's live
 * leave records, on every read: nothing here is written or cached apart from
 * the reads themselves. The schedule fields are the one recipe
 * (`memberScheduleInputOf`) every other leave and hours figure stands on, so
 * a conflict listed here is exactly a leave day charged on the member's card.
 *
 * ONLY THE UNRESOLVED (story 5.4a). The organization's live resolutions
 * (`./resolutions`) drop each collision they match by `collisionKeyOf`,
 * through the domain's one filter, `unresolvedCollisionsOf`, which the
 * calendar's marks and *Sati*'s count apply too ({@link unresolvedOf}).
 *
 * THE ORDER (human, 2026-10-01): upcoming conflicts first — dated today or
 * later in the organization's zone — soonest first; then past ones, most
 * recent first. Within one date, `collisionsOf`'s own order (team, member).
 *
 * REQUESTS BESIDE COLLISIONS (story 9.5; AD-4's union). The organization's
 * pending leave requests (`organizationLeaveRequestsOf`, 0040's read) join
 * the unresolved collisions as items of their own kind, under ONE COUNT that
 * *Danas* and the resolution screen's back link read too. A request is dated
 * by its range's start and takes the same upcoming-then-past order; on one
 * date, collisions come before requests, then their own order, then the
 * request's id. A PENDING REQUEST DERIVES NOTHING: it is listed, never fed
 * to `collisionsOf`.
 *
 * SWAPS BESIDE THEM (story 12.4; AD-4's third set). Every open swap a
 * colleague has accepted waits for an admin (0049), and joins the same count
 * as an item of its own kind. It is dated by the EARLIER of its dates and
 * takes the same order; on one date, collisions, then leave requests, then
 * swaps, each by when it was sent, then by id. AN ACCEPTED SWAP DERIVES
 * NOTHING (R9.1): it is listed, never fed to `collisionsOf` or a schedule.
 *
 * NEVER A PARTIAL LIST. A read that failed or is paused offline, a record
 * row that does not parse, belongs to nobody in the snapshot or shares a date
 * with another of the same member, a resolution row that cannot be trusted,
 * and any `RangeError` of the derivation refuse the whole queue, logged; no
 * row is drawn from data that cannot be trusted, and no count from
 * collisions not yet filtered by their resolutions. A row naming a member or
 * team newer than the cached snapshot is a skew, not a break (story 5.5d, as
 * the calendar's marks): the snapshot is read again, once, and the queue
 * waits for it.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** The id the count's heading carries, which names the queue's section. */
export const CONFLICTS_COUNT_HEADING_ID = 'za-odluku-count';

/** Still waiting on a read: the skeleton, never a count. */
export const CONFLICTS_LOADING = 'loading';
/** A read failed, or what it answered breaches a rule: one alert with a retry, no list. */
export const CONFLICTS_UNAVAILABLE = 'unavailable';
/** Everything read: the count and the rows, none included. */
export const CONFLICTS_READY = 'ready';

/** A queue item that is a collision: *Odsutnost u smjeni* (story 9.5). */
export const ITEM_COLLISION = 'collision';
/** A queue item that is a pending leave request: *Zahtjev za odsutnost* (story 9.5). */
export const ITEM_REQUEST = 'request';
/** A queue item that is an accepted swap waiting for an admin: *Zamjena smjene* (story 12.4). */
export const ITEM_SWAP = 'swap';

export type QueueItemKind = typeof ITEM_COLLISION | typeof ITEM_REQUEST | typeof ITEM_SWAP;

/** One conflict as the queue shows it. */
export interface ConflictRow {
  readonly kind: typeof ITEM_COLLISION;
  /** `collisionKeyOf`'s key: unique per row, and what story 5.4 matches a resolution on. */
  readonly key: string;
  /** The member on leave: with `date` and `teamId`, what the row's resolution screen is opened by (story 5.4b). */
  readonly memberId: string;
  /** `YYYY-MM-DD`, as the domain answered it. */
  readonly date: string;
  /** The team whose working shift collides. */
  readonly teamId: string;
  /** The shift type that shift works. */
  readonly shiftTypeId: string;
  /** The leave record that covers the date. */
  readonly leaveRecordId: string;
  /** `12.09.2026`. */
  readonly dateShown: string;
  /** Before the organization's today: drawn dashed and muted, with its own words. */
  readonly past: boolean;
  readonly memberName: string;
  readonly teamName: string;
  readonly shiftTypeName: string;
  /** `19:00–07:00`, or `null` for a working type with no times in effect on the date. */
  readonly times: string | null;
  /** The causing record's range, as the member's leave card writes it. */
  readonly leaveFrom: string;
  readonly leaveTo: string;
}

/** One pending leave request as the queue shows it (story 9.5). */
export interface RequestRow {
  readonly kind: typeof ITEM_REQUEST;
  /** `request:` and the request's id: unique per row, and never a collision's key. */
  readonly key: string;
  /** What the row's decision screen is opened by. */
  readonly requestId: string;
  readonly memberId: string;
  /** The range's first date, `YYYY-MM-DD`: what the row is ordered by. */
  readonly date: string;
  /** `12.09.2026`. */
  readonly dateShown: string;
  /** Starts before the organization's today: drawn as a past row. */
  readonly past: boolean;
  /**
   * The member's name; null (`memberGone`) only for a row parsed without the
   * skew check. A member the snapshot does not hold yet is a skew between the
   * reads (`unknownSnapshotIdsOf`), loading or unavailable, never drawn as gone.
   */
  readonly memberName: string | null;
  /** The requested range, as the member's leave card writes it. */
  readonly from: string;
  readonly to: string;
  /** STORY 13.5b: the requested half of a one-date request, or null for a whole day. */
  readonly half: LeaveHalf | null;
  /** When it was sent: requests starting on one date are ordered by it, oldest first, then by id. */
  readonly createdAt: string | null;
}

/** One accepted swap waiting for an admin, as the queue shows it (story 12.4). */
export interface SwapRow {
  readonly kind: typeof ITEM_SWAP;
  /** `swap:` and the swap's id: unique per row, and never another kind's key. */
  readonly key: string;
  /** What the row's decision screen is opened by. */
  readonly requestId: string;
  /** The earlier of its dates, `YYYY-MM-DD`: what the row is ordered by. */
  readonly date: string;
  /** `12.09.2026`. */
  readonly dateShown: string;
  /** Either date before the organization's today: drawn as a past row. */
  readonly past: boolean;
  readonly proposerName: string;
  readonly addresseeName: string;
  /** The shift the proposer gives. */
  readonly given: SwapShiftNamed;
  /** The addressee's shift the proposer takes in return, or `null` for a one-way cover. */
  readonly returnShift: SwapShiftNamed | null;
  /** When it was sent: swaps on one date are ordered by it, oldest first, then by id. */
  readonly createdAt: string | null;
}

/** One item of *Čeka odluku*: a collision, a pending request (story 9.5) or a waiting swap (story 12.4). */
export type QueueRow = ConflictRow | RequestRow | SwapRow;

/** The queue, ready to render. */
export interface ConflictsQueueView {
  /** How many items wait for a decision: unresolved collisions, pending requests and waiting swaps, shown at zero too. */
  readonly count: number;
  /** Upcoming soonest first, then past most recent first; on one date, collisions, then requests, then swaps. */
  readonly rows: readonly QueueRow[];
}

/** The rows that are collisions, in the queue's order: what the resolution screen and *Danas*' coverage read. */
export function collisionRowsOf(rows: readonly QueueRow[]): readonly ConflictRow[] {
  return rows.filter((row): row is ConflictRow => row.kind === ITEM_COLLISION);
}

export type ConflictsQueue =
  | { readonly kind: typeof CONFLICTS_LOADING }
  | { readonly kind: typeof CONFLICTS_UNAVAILABLE }
  | { readonly kind: typeof CONFLICTS_READY; readonly view: ConflictsQueueView };

/** Two collisions by date alone, ascending; 0 within one date. */
function byDate(first: Collision, second: Collision): number {
  return first.date < second.date ? -1 : first.date > second.date ? 1 : 0;
}

/**
 * `collisions` in the queue's order: those dated `today` or later, soonest
 * date first, then the earlier ones, most recent date first. Both groups are
 * sorted here rather than trusted to arrive in order, and within one date the
 * order they came in is kept — `Array.prototype.sort` is stable — which is
 * `collisionsOf`'s (team, then member).
 */
export function queueOrderOf(collisions: readonly Collision[], today: string): readonly Collision[] {
  const upcoming = collisions.filter((collision) => collision.date >= today).sort(byDate);
  const past = collisions
    .filter((collision) => collision.date < today)
    .sort((first, second) => byDate(second, first));

  return [...upcoming, ...past];
}

/** The instant a request or swap was sent, in ms; one with none sorts after every other. */
function sentAt(row: RequestRow | SwapRow): number {
  return row.createdAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.createdAt);
}

/** Two requests, or two swaps, by when they were sent, oldest first, then by id. */
function bySentThenId(first: RequestRow | SwapRow, second: RequestRow | SwapRow): number {
  const [a, b] = [sentAt(first), sentAt(second)];

  if (a !== b) return a < b ? -1 : 1;

  return first.requestId < second.requestId ? -1 : first.requestId > second.requestId ? 1 : 0;
}

/**
 * The merged order of story 9.5: `collisions`, already in
 * {@link queueOrderOf}'s order, and `requests`, each dated by its range's
 * start. Upcoming items (dated `today` or later) soonest first, then past
 * items most recent first; on one date, collisions before requests, the
 * collisions in the order they came in and the requests by when they were
 * sent (oldest first; one with no instant last), then by id. Since story
 * 12.4 `swaps` too, each dated by the earlier of its dates: on one date after
 * the requests, by when they were sent, then by id.
 */
export function mergedQueueOrderOf(
  collisions: readonly ConflictRow[],
  requests: readonly RequestRow[],
  today: string,
  swaps: readonly SwapRow[] = [],
): readonly QueueRow[] {
  const ranked: { readonly row: QueueRow; readonly rank: number }[] = [
    ...collisions.map((row, index) => ({ row, rank: index })),
    ...[...requests]
      .sort(bySentThenId)
      .map((row, index) => ({ row, rank: collisions.length + index })),
    ...[...swaps]
      .sort(bySentThenId)
      .map((row, index) => ({ row, rank: collisions.length + requests.length + index })),
  ];
  const ascending = (first: (typeof ranked)[number], second: (typeof ranked)[number]): number =>
    first.row.date < second.row.date ? -1 : first.row.date > second.row.date ? 1 : first.rank - second.rank;
  const upcoming = ranked.filter((item) => item.row.date >= today).sort(ascending);
  const past = ranked
    .filter((item) => item.row.date < today)
    .sort((first, second) =>
      first.row.date === second.row.date ? first.rank - second.rank : ascending(second, first),
    );

  return [...upcoming, ...past].map((item) => item.row);
}

/**
 * The organization's pending requests from the rows as read (story 9.5).
 *
 * @throws RangeError when a request row cannot be trusted.
 */
export function pendingRequestsOf(requestRows: readonly unknown[]): readonly ReviewedLeaveRequest[] {
  const requests = organizationLeaveRequestsOf(requestRows);

  if (requests === null) throw new RangeError('a leave request row cannot be trusted');

  return requests.filter((request) => request.status === REQUEST_PENDING);
}

/**
 * The pending requests as the queue's rows, against `today` and the
 * snapshot's names.
 *
 * @throws RangeError when a request row cannot be trusted, or a date cannot be formatted.
 */
export function requestRowsOf(
  snapshot: CalendarSnapshot,
  requestRows: readonly unknown[],
  today: string,
): readonly RequestRow[] {
  const members = new Map(snapshot.members.map((member) => [member.id, member.name]));

  return pendingRequestsOf(requestRows).map((request) => {
    const dateShown = formatIsoDate(request.from);

    if (dateShown === null) throw new RangeError(`the date ${request.from} cannot be formatted`);

    const range = leaveRangeValuesOf(request);

    return {
      kind: ITEM_REQUEST,
      key: `request:${request.id}`,
      requestId: request.id,
      memberId: request.memberId,
      date: request.from,
      dateShown,
      past: request.from < today,
      memberName: members.get(request.memberId) ?? null,
      from: range.from,
      to: range.to,
      half: request.half ?? null,
      createdAt: request.createdAt,
    };
  });
}

/**
 * The accepted swaps waiting for an admin as the queue's rows (story 12.4),
 * against `today` and the snapshot's names.
 *
 * @throws RangeError when a swap row cannot be trusted, names a member or
 *   team the snapshot lacks, or a date cannot be formatted.
 */
export function swapRowsOf(snapshot: CalendarSnapshot, swapRows: readonly unknown[], today: string): readonly SwapRow[] {
  return waitingSwapsOf(snapshot, swapRows, today).map((swap) => ({
    kind: ITEM_SWAP,
    key: `swap:${swap.requestId}`,
    requestId: swap.requestId,
    date: swap.date,
    dateShown: swap.dateShown,
    past: swap.past,
    proposerName: swap.proposerName,
    addresseeName: swap.addresseeName,
    given: swap.given,
    returnShift: swap.returnShift,
    createdAt: swap.createdAt,
  }));
}

/**
 * What `collisionsOf` derives from: the snapshot's schedule fields through
 * the one recipe (`snapshotScheduleInputOf`, which the staffing rule's
 * `staffingInputOf` spreads too) — they do not depend on whose input it is —
 * and every live record.
 */
export function collisionInputOf(
  snapshot: CalendarSnapshot,
  // Every record collides whatever its absence type (story 13.2): only the range, the id and the member are read.
  records: readonly Pick<OrganizationLeaveRecord, 'id' | 'memberId' | 'from' | 'to'>[],
): CollisionInput {
  return {
    ...snapshotScheduleInputOf(snapshot),
    leaveRecords: records.map(({ id, memberId, from, to }) => ({ id, memberId, from, to })),
  };
}

/**
 * The resolution rows as read, parsed against the snapshot's members and
 * teams: EVERY live row, a replacement that no longer applies included. Only
 * the resolution screen reads these, to say why a key is still held
 * (story 5.5d); everything that matches keys reads {@link resolutionsOf}.
 *
 * @throws RangeError when a row cannot be trusted (`conflictResolutionsOf`).
 */
export function liveResolutionsOf(snapshot: CalendarSnapshot, rows: readonly unknown[]): readonly ConflictResolution[] {
  const resolutions = conflictResolutionsOf(
    rows,
    snapshot.members.map((member) => member.id),
    snapshot.teams.map((team) => team.id),
  );

  if (resolutions === null) throw new RangeError('a conflict resolution row cannot be trusted');

  return resolutions;
}

/**
 * THE ONE FUNNEL resolutions become keys through (story 5.5d): the live rows
 * ({@link liveResolutionsOf}) less every `replace_member` whose linked
 * override no longer applies (`effectiveResolutionsOf`) — removed, pending
 * after a rotation save, or inert — and every decision made on another shift
 * type than its key has today (0038). The queue, the resolution screen, the
 * calendar's marks, the admin's *Sati* and the erasure guard's "before" all
 * read this, so a replacement that does not apply hides its conflict nowhere.
 *
 * @throws RangeError when a row cannot be trusted, or a link disagrees with
 *   its override, or on any precondition of the domain's derivation.
 */
export function resolutionsOf(snapshot: CalendarSnapshot, rows: readonly unknown[]): readonly ConflictResolution[] {
  return effectiveResolutionsOf(snapshot, liveResolutionsOf(snapshot, rows));
}

/**
 * THE ONE DERIVATION every unresolved surface stands on (story 5.4a): the
 * collisions of `records`, without those the resolution rows resolve.
 *
 * @throws RangeError when a resolution row cannot be trusted, or on any
 *   precondition of `collisionsOf`.
 */
export function unresolvedOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
  resolutionRows: readonly unknown[],
): readonly Collision[] {
  return unresolvedCollisionsOf(collisionsOf(collisionInputOf(snapshot, records)), resolutionsOf(snapshot, resolutionRows));
}

/**
 * The queue from the snapshot, the organization's record, resolution,
 * request and (story 12.4) swap rows as read, and `today` in the
 * organization's zone.
 *
 * @throws RangeError when a row cannot be trusted ({@link organizationLeaveRecordsOf}, {@link resolutionsOf}),
 *   on any precondition of `collisionsOf`, or when a collision names a
 *   member, team, shift type or record the inputs lack, or a date that cannot
 *   be formatted.
 */
export function conflictsQueueViewOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  today: string,
  requestRows: readonly unknown[],
  swapRows: readonly unknown[],
): ConflictsQueueView {
  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const members = new Map(snapshot.members.map((member) => [member.id, member.name]));
  const teams = new Map(snapshot.teams.map((team) => [team.id, team.name]));
  const types = new Map(snapshot.types.map((type) => [type.id, type]));
  const byId = new Map(records.map((record) => [record.id, record]));

  const shown = queueOrderOf(unresolvedOf(snapshot, records, resolutionRows), today).map((collision) => {
    const memberName = members.get(collision.memberId);
    const teamName = teams.get(collision.teamId);
    const type = types.get(collision.shiftTypeId);
    const record = byId.get(collision.leaveRecordId);
    const dateShown = formatIsoDate(collision.date);

    if (memberName === undefined) throw new RangeError(`member ${collision.memberId} is not in the snapshot`);
    if (teamName === undefined) throw new RangeError(`team ${collision.teamId} is not in the snapshot`);
    if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);
    if (record === undefined) throw new RangeError(`leave record ${collision.leaveRecordId} was not read`);
    if (dateShown === null) throw new RangeError(`the date ${collision.date} cannot be formatted`);

    const range = leaveRangeValuesOf(record);

    const row: ConflictRow = {
      kind: ITEM_COLLISION,
      key: collisionKeyOf(collision),
      memberId: collision.memberId,
      date: collision.date,
      teamId: collision.teamId,
      shiftTypeId: collision.shiftTypeId,
      leaveRecordId: collision.leaveRecordId,
      dateShown,
      past: collision.date < today,
      memberName,
      teamName,
      shiftTypeName: type.name,
      times: typeRangeOn(type, collision.date),
      leaveFrom: range.from,
      leaveTo: range.to,
    };

    return row;
  });
  const merged = mergedQueueOrderOf(
    shown,
    requestRowsOf(snapshot, requestRows, today),
    today,
    swapRowsOf(snapshot, swapRows, today),
  );

  return { count: merged.length, rows: merged };
}

export type ConflictsQueueOutcome =
  | { readonly ok: true; readonly view: ConflictsQueueView }
  | { readonly ok: false; readonly code: typeof CONFLICTS_UNAVAILABLE };

/**
 * {@link conflictsQueueViewOf}, GUARDED as *Sati*'s table is: a `RangeError`
 * refuses the whole queue — never a partial one — and is logged.
 */
export function conflictsQueueOutcomeOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  today: string,
  requestRows: readonly unknown[],
  swapRows: readonly unknown[],
): ConflictsQueueOutcome {
  try {
    return { ok: true, view: conflictsQueueViewOf(snapshot, rows, resolutionRows, today, requestRows, swapRows) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(CONFLICTS_UNAVAILABLE, cause);

    return { ok: false, code: CONFLICTS_UNAVAILABLE };
  }
}

/**
 * THE QUEUE'S COUNT from the four reads' rows (story 9.5), for a surface that
 * names it beside its own content — the resolution screen's way back: the
 * very `count` {@link conflictsQueueOutcomeOf} derives, so the two cannot
 * drift; null while a row names a member or team the snapshot does not hold
 * yet (a skew, as {@link conflictsQueueOf} waits on) or when the queue is
 * refused — never a number the queue would not state. Null too when
 * `requestRows` is null: the request read is not usable (failed, paused
 * offline, uncached or still pending), and the count cannot be stated
 * without it (retro 8–9 item 18). Null too when `swapRows` is null (story
 * 12.4): the swap read is not usable, and the count is refused, never a
 * partial one.
 */
export function queueCountOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  requestRows: readonly unknown[] | null,
  today: string,
  swapRows: readonly unknown[] | null,
): number | null {
  if (requestRows === null || swapRows === null) return null;

  if (unknownSnapshotIdsOf(snapshot, rows, resolutionRows, requestRows, swapRows).length > 0) return null;

  const outcome = conflictsQueueOutcomeOf(snapshot, rows, resolutionRows, today, requestRows, swapRows);

  return outcome.ok ? outcome.view.count : null;
}

/** The query result the record rows' state is derived from. */
export interface LeaveRowsAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly unknown[] | undefined;
}

/** Whether a read failed, is paused offline, or settled with nothing: the queue's unavailable. */
function readFailed(answer: LeaveRowsAnswer): boolean {
  return answer.isError || answer.fetchStatus === FETCH_PAUSED || (!answer.isPending && answer.data === undefined);
}

/** Whether a read failed, is paused offline, or settled with nothing (story 5.4b's screen reads the same). */
export function queueReadFailed(answer: LeaveRowsAnswer): boolean {
  return readFailed(answer);
}

/** The five reads the queue stands on, each as far as it is read here. */
export interface ConflictsQueueSources {
  readonly calendar: CalendarSurfaceState;
  readonly records: LeaveRowsAnswer;
  /** The organization's live resolution rows (story 5.4a). */
  readonly resolutions: LeaveRowsAnswer;
  /** The organization's leave request rows, every status (story 9.5): the pending ones are items. */
  readonly requests: LeaveRowsAnswer;
  /** The organization's swap rows, every status (story 12.4): the accepted, open ones are items. */
  readonly swaps: LeaveRowsAnswer;
  /** Whether the calendar snapshot is being read again: a skew then waits for it ({@link conflictsQueueOf}). */
  readonly snapshotFetching?: boolean;
}

/**
 * What *Za odluku* shows from its five reads at `now`: unavailable when any
 * read failed or is paused offline — first, so a failure is never hidden
 * behind another's skeleton — a failed refetch over cached data included;
 * loading while any is pending; otherwise the guarded queue. Rows naming a
 * member or team the snapshot does not hold yet (`unknownSnapshotIdsOf`) are
 * a skew between the reads, not rows that cannot be trusted: loading while
 * the snapshot is read again, otherwise unavailable — whose retry re-reads
 * it — and never logged.
 */
export function conflictsQueueOf(sources: ConflictsQueueSources, now: Date): ConflictsQueue {
  const { calendar, records, resolutions, requests, swaps } = sources;
  const failed =
    calendar.refusal !== null ||
    (!calendar.loading && calendar.snapshot === null) ||
    readFailed(records) ||
    readFailed(resolutions) ||
    readFailed(requests) ||
    readFailed(swaps);

  if (failed) return { kind: CONFLICTS_UNAVAILABLE };

  const snapshot = calendar.snapshot;
  const rows = records.data;
  const resolutionRows = resolutions.data;
  const requestRows = requests.data;
  const swapRows = swaps.data;

  if (
    snapshot === null ||
    rows === undefined ||
    resolutionRows === undefined ||
    requestRows === undefined ||
    swapRows === undefined
  ) {
    return { kind: CONFLICTS_LOADING };
  }

  // STORY 9.5: a request naming a member the snapshot lacks is a skew too —
  // `calendar_members` answers inactive members, so the snapshot is older
  // than the member — never a member drawn as gone. STORY 12.4: so is a swap
  // naming a member or team the snapshot lacks.
  if (unknownSnapshotIdsOf(snapshot, rows, resolutionRows, requestRows, swapRows).length > 0) {
    return sources.snapshotFetching === true ? { kind: CONFLICTS_LOADING } : { kind: CONFLICTS_UNAVAILABLE };
  }

  const outcome = conflictsQueueOutcomeOf(
    snapshot,
    rows,
    resolutionRows,
    calendarTodayOf(snapshot, now),
    requestRows,
    swapRows,
  );

  return outcome.ok ? { kind: CONFLICTS_READY, view: outcome.view } : { kind: CONFLICTS_UNAVAILABLE };
}

