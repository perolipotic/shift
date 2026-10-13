import {
  leaveDaysOfMonth,
  memberHoursOfMonth,
  type Collision,
  type CollisionResolution,
  type MemberHours,
  type MemberHoursInput,
} from '@shift/domain';

import {
  calendarRetryStateOf,
  type CalendarQueryAnswer,
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import {
  memberScheduleInputOf,
  snapshotScheduleInputOf,
  type CalendarMemberHistory,
  monthHeaderOf,
  monthShownOf,
  type MonthHeader,
  type SnapshotScheduleInput,
} from '@/features/calendar/utils/month';
import { durationMessageKey, durationValuesOf, type DurationValues } from '@/features/hour-bands/services/list';
import {
  HOURS_CONFLICTS_LOADING,
  HOURS_CONFLICTS_UNAVAILABLE,
  conflictCountOf,
  leaveRecordsIn,
  leaveShiftsOf,
  type HoursConflictsState,
  type LeaveRecordsByMember,
} from '@/features/hours/services/hours-conflicts';
import type { HoursSearch } from '@/features/hours/services/hours-search';

/**
 * *Sati*: the viewer's own month of hours (story 4.1b). A member sees their
 * own figures; an admin sees every member's (story 4.2,
 * `@/features/hours/services/organization-hours`), each row this module's
 * recipe for that member.
 *
 * EVERY RULE OF THE SCREEN IS HERE (AD-15), and the node suite executes it:
 * the search, the month heading, the snapshot as the domain's input, the
 * guarded outcome and the display rows. The hook and the components wire and
 * draw, and nothing else.
 *
 * NO HOUR IS COMPUTED HERE (AD-3, AD-7). Every figure is
 * `memberHoursOfMonth`'s from `@shift/domain`, over the calendar's ONE
 * snapshot (AD-13) — its hour bands included — and the input is the calendar's
 * own recipe (`memberScheduleInputOf`), so the shifts counted are exactly the
 * working shifts of the viewer's day list. Minutes are only split for reading
 * (`durationValuesOf`), never summed, rounded or recomputed.
 *
 * Nothing reads a band's name for meaning: it is shown as stored.
 *
 * LEAVE IS COUNTED IN DAYS, AND ONLY IN DAYS (human, 2026-10-10). The leave
 * figure is the member's charged leave days in the month — the domain's
 * `leaveDaysOfMonth` over the leave records *Sati* already read, the count
 * *Godišnji* charges: `3 dana`. An accepted-uncovered or replaced shift is
 * out of every band, the total and the shift count, and appears only as its
 * leave day, never as hours. The domain's `leaveMinutes` is shown nowhere.
 *
 * THE CONFLICT COUNT STANDS BESIDE THE FIGURES (story 5.3d): the viewer's
 * shifts in unresolved conflict in the month, `./hours-conflicts`'s count,
 * which changes no figure. *Sati* waits for the leave read it stands on.
 */

/** The month heading's id on *Sati*: the calendar's is its own. */
export const HOURS_MONTH_HEADING_ID = 'sati-month-heading';

/** The bands' heading id on *Sati*: it names the list of band rows. */
export const HOURS_BANDS_HEADING_ID = 'sati-bands-heading';

/**
 * The hours could not be shown: the snapshot could not be read, or the
 * domain refused what it holds (a `RangeError`). THE ONLY FAILURE: zero
 * shifts and zero bands are honest answers.
 */
export const HOURS_UNAVAILABLE = 'HOURS_UNAVAILABLE';

export type HoursFailure = typeof HOURS_UNAVAILABLE;

/**
 * One member's month as the domain's input — the viewer's unless `history`
 * names another (story 4.2): the calendar's schedule recipe for that member,
 * plus every hour band and every shift type with its versions — archived ones
 * included, as the schedule may still name them — and, since story 5.4b, the
 * member's shifts accepted as uncovered or, since story 5.4c, replaced (`leaveKeys`, every member's keys or
 * only theirs), which the domain counts as leave rather than work: out of the
 * bands, the total and the shift count, into its `leaveMinutes` — kept only
 * for that removal and deliberately shown nowhere, since leave is counted in
 * days (human decision 2026-10-10).
 *
 * The organization's table works the snapshot-wide part out once
 * ({@link hoursSnapshotInputOf}) and passes it as `shared` for every member
 * (Epic 4 retro, C8); it is the same value either way.
 */
export function memberHoursInputOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory = snapshot.viewer,
  leaveKeys: readonly CollisionResolution[] = [],
  shared: HoursSnapshotInput = hoursSnapshotInputOf(snapshot),
): MemberHoursInput {
  const { bands, shiftTypes, ...schedule } = shared;

  return {
    ...memberScheduleInputOf(snapshot, history, schedule),
    bands,
    shiftTypes,
    leaveShifts: leaveShiftsOf(leaveKeys, history.memberId),
  };
}

/** The part of {@link memberHoursInputOf} that is the same for every member. */
export interface HoursSnapshotInput extends SnapshotScheduleInput {
  readonly bands: MemberHoursInput['bands'];
  readonly shiftTypes: MemberHoursInput['shiftTypes'];
}

/**
 * The snapshot-wide part of every member's hours input: the calendar's
 * ({@link snapshotScheduleInputOf}), every hour band, and every shift type
 * with its versions. `schedule`, when the caller already holds it.
 */
export function hoursSnapshotInputOf(
  snapshot: CalendarSnapshot,
  schedule: SnapshotScheduleInput = snapshotScheduleInputOf(snapshot),
): HoursSnapshotInput {
  return {
    ...schedule,
    bands: snapshot.bands,
    shiftTypes: snapshot.types.map((type) => ({ type, versions: type.versions })),
  };
}

/** A duration as `t()` renders it: `12 h`, `12 h 30 min`, `45 min`. */
export interface HoursFigure {
  readonly key: ReturnType<typeof durationMessageKey>;
  readonly values: DurationValues;
}

/** Minutes as a figure `t()` renders; never summed, rounded or recomputed. */
export function figureOf(minutes: number): HoursFigure {
  return { key: durationMessageKey(minutes), values: durationValuesOf(minutes) };
}

/** Whether a figure is 0: nothing composes it, so it offers no explanation (story 7.14). */
export function figureIsEmpty(figure: HoursFigure): boolean {
  return figure.values.hours === 0 && figure.values.minutes === 0;
}

/** A count of leave days as `t()` renders it: `1 dan`, `3 dana`. */
// A type alias, not an interface: its values go to `t()`.
export type LeaveDaysValues = { readonly count: number };

/** A count of leave days as a figure, `t('count.days')`: `3 dana`, and one line's `1 dan` in the leave's ⓘ. */
export interface LeaveDaysFigure {
  readonly key: 'count.days';
  readonly values: LeaveDaysValues;
}

/** A count of leave days as a figure; never summed or recomputed here. */
export function leaveDaysFigureOf(days: number): LeaveDaysFigure {
  return { key: 'count.days', values: { count: days } };
}

/**
 * THE ONE RULE OF AN EMPTY LEAVE: no charged day means empty — an absence,
 * never a claimed `0 dana`. The screen (`leaveFigureOf`) and the file
 * (`./hours-export`) both decide by it, from the domain's day count.
 */
export function leaveIsEmpty(days: number): boolean {
  return days === 0;
}

/** Leave as a figure of days, or `null` when it is empty ({@link leaveIsEmpty}). */
export function leaveFigureOf(days: number): LeaveDaysFigure | null {
  return leaveIsEmpty(days) ? null : leaveDaysFigureOf(days);
}

/** The key a leave reads through: its days, `3 dana`, or the empty mark `—` for none. */
export function leaveMessageKey(leave: LeaveDaysFigure | null): 'sati.noFigure' | 'count.days' {
  return leave === null ? 'sati.noFigure' : leave.key;
}

/** A leave as `t()` renders it: the empty mark takes no values. */
export interface LeaveShown {
  readonly key: ReturnType<typeof leaveMessageKey>;
  readonly values: Partial<LeaveDaysValues>;
}

/** The leave as *Sati* and the table render it: `—` for none, else its days. */
export function leaveShownOf(leave: LeaveDaysFigure | null): LeaveShown {
  return { key: leaveMessageKey(leave), values: leave?.values ?? {} };
}

/**
 * The member's charged leave dates of `month` (`YYYY-MM`), in order: the
 * domain's `leaveDaysOfMonth` over their records and the calendar's schedule
 * recipe (`memberScheduleInputOf`), which the hours' `memberHoursInputOf`
 * builds on. Their count is the leave figure. `shared` as there.
 *
 * @throws RangeError on any precondition of `leaveDaysOfMonth`.
 */
export function memberLeaveDatesOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory,
  leaveRecords: LeaveRecordsByMember,
  month: string,
  shared?: SnapshotScheduleInput,
): readonly string[] {
  const records = leaveRecordsIn(leaveRecords, history.memberId);

  if (records.length === 0) return [];

  return leaveDaysOfMonth(memberScheduleInputOf(snapshot, history, shared), records, month);
}

/** One band's row: its name as stored, its hours, and the shifts overlapping it. */
export interface HoursBandRow {
  readonly bandId: string;
  readonly name: string;
  readonly hours: HoursFigure;
  readonly shiftCount: number;
}

/** The viewer's month, ready to render. */
export interface MyHoursView {
  readonly header: MonthHeader;
  readonly total: HoursFigure;
  /** Every working shift of the month, each once, timed or not. */
  readonly shiftCount: number;
  /** Every band, in start order, those with 0 h included; none with no bands. */
  readonly bands: readonly HoursBandRow[];
  /**
   * The month's leave, or `null` when it is empty — drawn `—`, an absence
   * rather than a claimed `0 dana`: the days *Godišnji* charges (R4.2:
   * active, with a working shift, inside a leave record). A shift accepted as
   * uncovered or replaced is out of the bands, the total and the shift count
   * (5.4b, 5.4c), and counts only as its leave day.
   */
  readonly leave: LeaveDaysFigure | null;
  /**
   * Working shifts with no times on their date — counted as shifts, never in
   * hours — or `null` when there are none, so the note is not shown.
   */
  readonly untimedShiftCount: number | null;
  /**
   * The month's working shifts in unresolved conflict (story 5.3d) — still
   * counted in every figure above — or `null` when there are none, so the
   * line is not shown.
   */
  readonly conflictCount: number | null;
}

/** A view *Sati* built, or the one failure. */
export type HoursOutcome<View> =
  | { readonly ok: true; readonly view: View }
  | { readonly ok: false; readonly code: HoursFailure };

export type MyHoursOutcome = HoursOutcome<MyHoursView>;

/**
 * THE ONE GUARD of *Sati*'s views — the viewer's own and the organization's
 * table (Epic 4 retro, D3): `build` answered, or a `RangeError` from it (the
 * domain's, or a row that cannot be trusted) logged and answered as the one
 * failure — never a crashed route, never a partial view and never a figure.
 * Any other error is a bug, and is thrown.
 */
export function hoursGuarded<View>(build: () => View): HoursOutcome<View> {
  try {
    return { ok: true, view: build() };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(HOURS_UNAVAILABLE, cause);

    return { ok: false, code: HOURS_UNAVAILABLE };
  }
}

/**
 * The domain's hours as display rows, the bands named from the snapshot in
 * the domain's order.
 *
 * @throws RangeError when the domain names a band the snapshot lacks.
 */
export function myHoursViewOf(
  snapshot: CalendarSnapshot,
  header: MonthHeader,
  hours: MemberHours,
  conflictCount: number,
  leaveDays: number,
): MyHoursView {
  const names = new Map(snapshot.bands.map((band) => [band.id, band.name]));

  return {
    header,
    total: figureOf(hours.totalMinutes),
    shiftCount: hours.shiftCount,
    bands: hours.bands.map((band) => {
      const name = names.get(band.bandId);

      if (name === undefined) throw new RangeError(`hour band ${band.bandId} is not in the snapshot`);

      return { bandId: band.bandId, name, hours: figureOf(band.minutes), shiftCount: band.shiftCount };
    }),
    leave: leaveFigureOf(leaveDays),
    untimedShiftCount: hours.untimedShiftCount > 0 ? hours.untimedShiftCount : null,
    conflictCount: conflictCount > 0 ? conflictCount : null,
  };
}

/**
 * The viewer's hours of the month `search` names — or today's, `today` being
 * the organization's (`calendarTodayOf`) — with their own conflicts of that
 * month counted from `collisions` and their accepted-uncovered shifts in
 * `leaveKeys` counted as leave (story 5.4b) and their charged leave days
 * counted over `leaveRecords`, GUARDED ({@link hoursGuarded}).
 */
export function myHoursOf(
  snapshot: CalendarSnapshot,
  search: HoursSearch,
  today: string,
  collisions: readonly Collision[],
  leaveKeys: readonly CollisionResolution[],
  leaveRecords: LeaveRecordsByMember,
): MyHoursOutcome {
  return hoursGuarded(() => {
    const month = monthShownOf(search, today);
    const hours = memberHoursOfMonth(memberHoursInputOf(snapshot, snapshot.viewer, leaveKeys), month);
    const conflictCount = conflictCountOf(collisions, snapshot.viewer.memberId, month);
    const leaveDays = memberLeaveDatesOf(snapshot, snapshot.viewer, leaveRecords, month).length;

    return myHoursViewOf(snapshot, monthHeaderOf(month, today), hours, conflictCount, leaveDays);
  });
}

/**
 * What *Sati* shows: the figures, the skeleton, or the one message — never a
 * figure beside the message — and whether the month navigation is drawn.
 */
export interface MyHoursSurface {
  readonly view: MyHoursView | null;
  /**
   * The month the navigation draws: the view's while there is one, and the
   * month shown still when the domain refused its hours, so the viewer can
   * leave it. `null` while loading (the navigation's placeholder) and on a
   * failed read.
   */
  readonly month: MonthHeader | null;
  /**
   * Whether the month navigation is drawn at all: always, except on a failed
   * read (or a month that cannot be headed), where the message stands alone.
   */
  readonly navShown: boolean;
  readonly refusal: HoursFailure | null;
  /**
   * Whether the message offers a retry: only for a read that failed or is
   * paused offline — the snapshot's or the leave's — never for rows that
   * cannot be trusted or hours the domain refused, which reading again
   * leaves as they are.
   */
  readonly retryable: boolean;
  /** Never true beside a message or a figure. */
  readonly loading: boolean;
}

/** The heading of the month `search` names, or `null` when even that is refused. */
export function monthShownHeaderOf(search: HoursSearch, today: string): MonthHeader | null {
  try {
    return monthHeaderOf(monthShownOf(search, today), today);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return null;
  }
}

/**
 * The calendar read as *Sati* stands on it: the calendar's own
 * `calendarRetryStateOf` — a failed read being read again is loading, not
 * the refusal, so the retry's press shows. Never the cached snapshot: the
 * skeleton, until the new answer is in.
 */
export function hoursSnapshotStateOf(answer: CalendarQueryAnswer): CalendarSurfaceState {
  return calendarRetryStateOf(answer);
}

/** The message alone, no navigation and no figure: a read refused. */
export function hoursReadRefusedOf(retryable: boolean): MyHoursSurface {
  return { view: null, month: null, navShown: false, refusal: HOURS_UNAVAILABLE, retryable, loading: false };
}

/** The skeleton under the navigation's placeholder: a read still pending. */
export const HOURS_LOADING: MyHoursSurface = {
  view: null,
  month: null,
  navShown: true,
  refusal: null,
  retryable: false,
  loading: true,
};

/**
 * The two reads *Sati* stands on, before any figure: the message alone for a
 * refused read — the snapshot's (ANY refusal code, so one added later can
 * never fall through to an endless skeleton) or the leave's — and the
 * skeleton while either is pending; otherwise the collisions to count.
 */
export function hoursReadsOf(
  state: CalendarSurfaceState,
  conflicts: HoursConflictsState | null,
  today: string | null,
):
  | { readonly ready: false; readonly surface: MyHoursSurface }
  | {
      readonly ready: true;
      readonly snapshot: CalendarSnapshot;
      readonly today: string;
      readonly collisions: readonly Collision[];
      readonly leaveKeys: readonly CollisionResolution[];
      readonly leaveRecords: LeaveRecordsByMember;
    } {
  if (state.refusal !== null) return { ready: false, surface: hoursReadRefusedOf(true) };
  if (conflicts?.kind === HOURS_CONFLICTS_UNAVAILABLE) {
    return { ready: false, surface: hoursReadRefusedOf(conflicts.retryable) };
  }
  if (state.snapshot === null || today === null || conflicts === null || conflicts.kind === HOURS_CONFLICTS_LOADING) {
    return { ready: false, surface: HOURS_LOADING };
  }

  return {
    ready: true,
    snapshot: state.snapshot,
    today,
    collisions: conflicts.collisions,
    leaveKeys: conflicts.leaveKeys,
    leaveRecords: conflicts.leaveRecords,
  };
}

/**
 * The calendar read's surface state (`calendarSurfaceStateOf`) and the leave
 * read's (`hoursConflictsStateOf`, `null` before the snapshot names the
 * viewer) as *Sati* ({@link hoursReadsOf}). An answer to both is the viewer's
 * month with its conflict count, or — when the domain refuses its hours — the
 * message in place of the figures, the month navigation kept. No figure is
 * ever optimistic, and none is ever shown without the count.
 */
export function myHoursSurfaceOf(
  state: CalendarSurfaceState,
  conflicts: HoursConflictsState | null,
  search: HoursSearch,
  today: string | null,
): MyHoursSurface {
  const reads = hoursReadsOf(state, conflicts, today);

  if (!reads.ready) return reads.surface;

  const outcome = myHoursOf(reads.snapshot, search, reads.today, reads.collisions, reads.leaveKeys, reads.leaveRecords);

  if (outcome.ok) {
    return {
      view: outcome.view,
      month: outcome.view.header,
      navShown: true,
      refusal: null,
      retryable: false,
      loading: false,
    };
  }

  // A month the navigation cannot even head is the message alone, never a
  // placeholder bar beside it.
  const month = monthShownHeaderOf(search, reads.today);

  return { view: null, month, navShown: month !== null, refusal: outcome.code, retryable: false, loading: false };
}

/** The message a failure renders as. Exhaustive. */
export function hoursMessageKey(failure: HoursFailure): 'sati.error.unavailable' {
  if (failure === HOURS_UNAVAILABLE) return 'sati.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}
