import {
  leaveDaysOfMonth,
  memberHoursOfMonth,
  type Collision,
  type CollisionResolution,
  type MemberHours,
  type MemberHoursInput,
} from '@shift/domain';

import {
  calendarSurfaceStateOf,
  type CalendarQueryAnswer,
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import {
  MONTH_SEARCH_PARAM,
  isCalendarMonth,
  memberScheduleInputOf,
  type CalendarMemberHistory,
  monthHeaderOf,
  monthShownOf,
  type MonthHeader,
} from '@/features/calendar/utils/month';
import { durationMessageKey, durationValuesOf, type DurationValues } from '@/features/hour-bands/services/list';
import {
  FETCH_FETCHING,
  HOURS_CONFLICTS_LOADING,
  HOURS_CONFLICTS_UNAVAILABLE,
  conflictCountOf,
  leaveRecordsIn,
  leaveShiftsOf,
  type HoursConflictsState,
  type LeaveRecordsByMember,
} from '@/features/hours/services/hours-conflicts';

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
 * The search parameter naming the one team the organization's table is
 * narrowed to (story 4.2): `smjena`, as on the calendar, since story 7.5.
 */
export const HOURS_TEAM_PARAM = 'smjena';

/** The parameter *Sati* named the team with before story 7.5: an old URL carrying it is redirected. */
export const LEGACY_HOURS_TEAM_PARAM = 'tim';

/** The search parameter naming the one person the organization's table is narrowed to (story 4.2). */
export const HOURS_PERSON_PARAM = 'osoba';

/** The search parameter naming the column the organization's table is sorted by (story 4.2). */
export const HOURS_SORT_PARAM = 'sort';

/** The search parameter naming the sort's direction (story 4.2). */
export const HOURS_DIRECTION_PARAM = 'smjer';

/** The fixed sortable columns, as `sort` names them. */
export const SORT_NAME = 'ime';
export const SORT_TEAM = 'tim';
export const SORT_SHIFTS = 'smjene';
export const SORT_TOTAL = 'ukupno';
export const SORT_LEAVE = 'dopust';

const FIXED_SORT_KEYS = [SORT_NAME, SORT_TEAM, SORT_SHIFTS, SORT_TOTAL, SORT_LEAVE] as const;

/** A band's column, as `sort` names it: `pojas-<band id>`. */
export const BAND_SORT_PREFIX = 'pojas-';

export type HoursSortKey = (typeof FIXED_SORT_KEYS)[number] | `${typeof BAND_SORT_PREFIX}${string}`;

/** The two directions, as `smjer` names them. */
export const SORT_UP = 'uzlazno';
export const SORT_DOWN = 'silazno';

export type HoursSortDirection = typeof SORT_UP | typeof SORT_DOWN;

/**
 * *Sati*'s search, as `validateSearch` returns it: each parameter valid in
 * its own shape, or absent. Whether `smjena`, `osoba` or a band's `sort` names
 * something the snapshot holds is the organization view's decision, not the
 * parser's: the parser cannot see the snapshot.
 */
export interface HoursSearch {
  readonly mjesec?: string | undefined;
  readonly smjena?: string | undefined;
  readonly osoba?: string | undefined;
  readonly sort?: HoursSortKey | undefined;
  readonly smjer?: HoursSortDirection | undefined;
}

/** Whether a value is a column `sort` can name: a fixed one, or `pojas-<id>` with an id. */
export function isHoursSortKey(value: unknown): value is HoursSortKey {
  if (typeof value !== 'string') return false;
  if (FIXED_SORT_KEYS.some((key) => key === value)) return true;

  return value.startsWith(BAND_SORT_PREFIX) && value.length > BAND_SORT_PREFIX.length;
}

/** Whether a value is one of the two directions. */
export function isHoursSortDirection(value: unknown): value is HoursSortDirection {
  return value === SORT_UP || value === SORT_DOWN;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * The raw search as *Sati* reads it: `?mjesec=YYYY-MM`, the calendar's own
 * rule, and for an admin's table (story 4.2) `smjena`, `osoba`, `sort` and
 * `smjer`. Each invalid or missing parameter is dropped on its own — a month
 * falls back to the organization's current one, a sort to the name,
 * ascending — and every other parameter is dropped too.
 */
export function hoursSearchOf(search: Record<string, unknown>): HoursSearch {
  const month = search[MONTH_SEARCH_PARAM];
  const team = search[HOURS_TEAM_PARAM];
  const person = search[HOURS_PERSON_PARAM];
  const sort = search[HOURS_SORT_PARAM];
  const direction = search[HOURS_DIRECTION_PARAM];

  return {
    ...(isCalendarMonth(month) ? { mjesec: month } : {}),
    ...(nonEmptyText(team) ? { smjena: team } : {}),
    ...(nonEmptyText(person) ? { osoba: person } : {}),
    ...(isHoursSortKey(sort) ? { sort } : {}),
    ...(isHoursSortDirection(direction) ? { smjer: direction } : {}),
  };
}

/**
 * The search an old *Sati* URL (before story 7.5) is redirected to, or
 * `null` when it names no `tim`: `tim` becomes `smjena`, appended last, and
 * every other parameter is kept as it was, in order. A `smjena` already there
 * wins, and `tim` is dropped.
 */
export function legacyHoursSearchOf(search: Record<string, unknown>): Record<string, unknown> | null {
  if (!(LEGACY_HOURS_TEAM_PARAM in search)) return null;

  const { [LEGACY_HOURS_TEAM_PARAM]: team, ...rest } = search;

  return HOURS_TEAM_PARAM in rest ? rest : { ...rest, [HOURS_TEAM_PARAM]: team };
}

/**
 * A change of the search: the month (`null`: the current one), the filters —
 * the team and the person, both keys, as the filter bar writes them (story
 * 7.5; `null`: all) — or the sort (both keys; `null` drops either, the
 * default).
 */
export type HoursSearchChange =
  | { readonly mjesec: string | null }
  | { readonly smjena: string | null; readonly osoba: string | null }
  | { readonly sort: HoursSortKey | null; readonly smjer: HoursSortDirection | null };

/**
 * The search to navigate to: the one `change` applied, everything else the
 * search names kept, so the month keeps the filters and the sort, and a
 * filter or a sort keeps the month. `null` drops a parameter.
 */
export function hoursSearchTo(search: HoursSearch, change: HoursSearchChange): HoursSearch {
  const mjesec = 'mjesec' in change ? change.mjesec : (search.mjesec ?? null);
  const smjena = 'smjena' in change ? change.smjena : (search.smjena ?? null);
  const osoba = 'osoba' in change ? change.osoba : (search.osoba ?? null);
  const sort = 'sort' in change ? change.sort : (search.sort ?? null);
  const smjer = 'smjer' in change ? change.smjer : (search.smjer ?? null);

  return {
    ...(mjesec === null ? {} : { mjesec }),
    ...(smjena === null ? {} : { smjena }),
    ...(osoba === null ? {} : { osoba }),
    ...(sort === null ? {} : { sort }),
    ...(smjer === null ? {} : { smjer }),
  };
}

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
 */
export function memberHoursInputOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory = snapshot.viewer,
  leaveKeys: readonly CollisionResolution[] = [],
): MemberHoursInput {
  return {
    ...memberScheduleInputOf(snapshot, history),
    bands: snapshot.bands,
    shiftTypes: snapshot.types.map((type) => ({ type, versions: type.versions })),
    leaveShifts: leaveShiftsOf(leaveKeys, history.memberId),
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
 * builds on. Their count is the leave figure.
 *
 * @throws RangeError on any precondition of `leaveDaysOfMonth`.
 */
export function memberLeaveDatesOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory,
  leaveRecords: LeaveRecordsByMember,
  month: string,
): readonly string[] {
  const records = leaveRecordsIn(leaveRecords, history.memberId);

  return records.length === 0 ? [] : leaveDaysOfMonth(memberScheduleInputOf(snapshot, history), records, month);
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

export type MyHoursOutcome =
  | { readonly ok: true; readonly view: MyHoursView }
  | { readonly ok: false; readonly code: HoursFailure };

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
 * counted over `leaveRecords`, GUARDED: a `RangeError` from the
 * domain is logged and is the one failure, never a crashed route and never a
 * figure.
 */
export function myHoursOf(
  snapshot: CalendarSnapshot,
  search: HoursSearch,
  today: string,
  collisions: readonly Collision[],
  leaveKeys: readonly CollisionResolution[],
  leaveRecords: LeaveRecordsByMember,
): MyHoursOutcome {
  try {
    const month = monthShownOf(search, today);
    const hours = memberHoursOfMonth(memberHoursInputOf(snapshot, snapshot.viewer, leaveKeys), month);
    const conflictCount = conflictCountOf(collisions, snapshot.viewer.memberId, month);
    const leaveDays = memberLeaveDatesOf(snapshot, snapshot.viewer, leaveRecords, month).length;

    return { ok: true, view: myHoursViewOf(snapshot, monthHeaderOf(month, today), hours, conflictCount, leaveDays) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(HOURS_UNAVAILABLE, cause);

    return { ok: false, code: HOURS_UNAVAILABLE };
  }
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
 * The calendar read as *Sati* stands on it: `calendarSurfaceStateOf`, except
 * that a failed read being read again is loading, not the refusal —
 * TanStack Query keeps `isError` while the retry is in flight, so the message
 * and its retry would otherwise stand unchanged under the press. Never the
 * cached snapshot: the skeleton, until the new answer is in.
 */
export function hoursSnapshotStateOf(answer: CalendarQueryAnswer): CalendarSurfaceState {
  if (answer.isError && answer.fetchStatus === FETCH_FETCHING) return { snapshot: null, refusal: null, loading: true };

  return calendarSurfaceStateOf(answer);
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
