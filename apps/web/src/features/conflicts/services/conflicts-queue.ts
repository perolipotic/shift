import { collisionKeyOf, collisionsOf, type Collision, type CollisionInput } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import { calendarTodayOf, memberScheduleInputOf, typeRangeOn } from '@/features/calendar/utils/month';
import { organizationLeaveRecordsOf, type OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import { leaveRangeValuesOf } from '@/features/leave/services/leave-section';
import { formatIsoDate } from '@/lib/i18n/format';

/**
 * *Raspored* for an admin: the conflicts queue (story 5.3b; CAP-16, R6.8,
 * UX-DR20, UX-DR25), as a pure view model in a `.ts` that renders nothing
 * (AD-15). The hook only wires it; the node suite executes it.
 *
 * DERIVED, NEVER STORED (AD-4). Every row is one of `collisionsOf`'s
 * collisions, from the calendar's one snapshot and the organization's live
 * leave records, on every read: nothing here is written or cached apart from
 * the two reads themselves. The schedule fields are the one recipe
 * (`memberScheduleInputOf`) every other leave and hours figure stands on, so
 * a conflict listed here is exactly a leave day charged on the member's card.
 *
 * EVERY COLLISION IS UNRESOLVED until story 5.4 records resolutions: it will
 * filter by `collisionKeyOf`, which already keys each row.
 *
 * THE ORDER (human, 2026-10-01): upcoming conflicts first — dated today or
 * later in the organization's zone — soonest first; then past ones, most
 * recent first. Within one date, `collisionsOf`'s own order (team, member).
 *
 * NEVER A PARTIAL LIST. A read that failed or is paused offline, a record
 * row that does not parse, belongs to nobody in the snapshot or shares a date
 * with another of the same member, and any `RangeError` of the derivation
 * refuse the whole queue, logged; no row is drawn from data that cannot be
 * trusted.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** The id the count's heading carries, which names the queue's section. */
export const CONFLICTS_COUNT_HEADING_ID = 'raspored-count';

/** Still waiting on a read: the skeleton, never a count. */
export const CONFLICTS_LOADING = 'loading';
/** A read failed, or what it answered breaches a rule: one alert with a retry, no list. */
export const CONFLICTS_UNAVAILABLE = 'unavailable';
/** Everything read: the count and the rows, none included. */
export const CONFLICTS_READY = 'ready';

/** One conflict as the queue shows it. */
export interface ConflictRow {
  /** `collisionKeyOf`'s key: unique per row, and what story 5.4 matches a resolution on. */
  readonly key: string;
  /** `YYYY-MM-DD`, as the domain answered it. */
  readonly date: string;
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

/** The queue, ready to render. */
export interface ConflictsQueueView {
  /** How many unresolved conflicts there are: every row, shown at zero too. */
  readonly count: number;
  /** Upcoming soonest first, then past most recent first. */
  readonly rows: readonly ConflictRow[];
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

/**
 * What `collisionsOf` derives from: the snapshot's schedule fields through
 * the one recipe — they do not depend on whose input it is, so the viewer's
 * stands for all — and every live record.
 */
export function collisionInputOf(
  snapshot: CalendarSnapshot,
  records: readonly OrganizationLeaveRecord[],
): CollisionInput {
  const { assignments, steps, overrides, members, rosterOverrides, workingShiftTypeIds } = memberScheduleInputOf(
    snapshot,
    snapshot.viewer,
  );

  return {
    assignments,
    steps,
    overrides,
    members,
    rosterOverrides,
    workingShiftTypeIds,
    leaveRecords: records.map(({ id, memberId, from, to }) => ({ id, memberId, from, to })),
  };
}

/**
 * The queue from the snapshot, the organization's record rows as read, and
 * `today` in the organization's zone.
 *
 * @throws RangeError when a row cannot be trusted ({@link organizationLeaveRecordsOf}),
 *   on any precondition of `collisionsOf`, or when a collision names a
 *   member, team, shift type or record the inputs lack, or a date that cannot
 *   be formatted.
 */
export function conflictsQueueViewOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  today: string,
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

  const shown = queueOrderOf(collisionsOf(collisionInputOf(snapshot, records)), today).map((collision) => {
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

    return {
      key: collisionKeyOf(collision),
      date: collision.date,
      dateShown,
      past: collision.date < today,
      memberName,
      teamName,
      shiftTypeName: type.name,
      times: typeRangeOn(type, collision.date),
      leaveFrom: range.from,
      leaveTo: range.to,
    };
  });

  return { count: shown.length, rows: shown };
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
  today: string,
): ConflictsQueueOutcome {
  try {
    return { ok: true, view: conflictsQueueViewOf(snapshot, rows, today) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(CONFLICTS_UNAVAILABLE, cause);

    return { ok: false, code: CONFLICTS_UNAVAILABLE };
  }
}

/** The query result the record rows' state is derived from. */
export interface LeaveRowsAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly unknown[] | undefined;
}

/** The two reads the queue stands on, each as far as it is read here. */
export interface ConflictsQueueSources {
  readonly calendar: CalendarSurfaceState;
  readonly records: LeaveRowsAnswer;
}

/**
 * What *Raspored* shows from its two reads at `now`: unavailable when either
 * read failed or is paused offline — first, so a failure is never hidden
 * behind the other's skeleton — a failed refetch over cached data included;
 * loading while either is pending; otherwise the guarded queue.
 */
export function conflictsQueueOf(sources: ConflictsQueueSources, now: Date): ConflictsQueue {
  const { calendar, records } = sources;
  const failed =
    calendar.refusal !== null ||
    (!calendar.loading && calendar.snapshot === null) ||
    records.isError ||
    records.fetchStatus === FETCH_PAUSED ||
    (!records.isPending && records.data === undefined);

  if (failed) return { kind: CONFLICTS_UNAVAILABLE };

  const snapshot = calendar.snapshot;
  const rows = records.data;

  if (snapshot === null || rows === undefined) return { kind: CONFLICTS_LOADING };

  const outcome = conflictsQueueOutcomeOf(snapshot, rows, calendarTodayOf(snapshot, now));

  return outcome.ok ? { kind: CONFLICTS_READY, view: outcome.view } : { kind: CONFLICTS_UNAVAILABLE };
}

