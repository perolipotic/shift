import { memberHoursOfMonth, type MemberHours, type MemberHoursInput } from '@shift/domain';

import {
  type CalendarSnapshot,
  type CalendarSurfaceState,
} from '@/features/calendar/services/snapshot';
import {
  MONTH_SEARCH_PARAM,
  isCalendarMonth,
  memberScheduleInputOf,
  monthHeaderOf,
  monthShownOf,
  type MonthHeader,
} from '@/features/calendar/utils/month';
import { durationMessageKey, durationValuesOf, type DurationValues } from '@/features/hour-bands/services/list';

/**
 * *Sati*: the viewer's own month of hours (story 4.1b). Member and admin
 * alike see their own figures only; the organization's view is story 4.2's.
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

/** *Sati*'s search, as `validateSearch` returns it: a valid month, or nothing. */
export interface HoursSearch {
  readonly mjesec?: string | undefined;
}

/**
 * The raw search as *Sati* reads it: `?mjesec=YYYY-MM`, the calendar's own
 * rule. An invalid or missing month is dropped, so the screen falls back to
 * the organization's current month; every other parameter is dropped too.
 */
export function hoursSearchOf(search: Record<string, unknown>): HoursSearch {
  const month = search[MONTH_SEARCH_PARAM];

  return isCalendarMonth(month) ? { mjesec: month } : {};
}

/** The search to navigate to: `null` is the current month, and drops the parameter. */
export function hoursSearchTo(mjesec: string | null): HoursSearch {
  return mjesec === null ? {} : { mjesec };
}

/**
 * The viewer's month as the domain's input: the calendar's schedule recipe
 * for the viewer, plus every hour band and every shift type with its
 * versions — archived ones included, as the schedule may still name them.
 */
export function memberHoursInputOf(snapshot: CalendarSnapshot): MemberHoursInput {
  return {
    ...memberScheduleInputOf(snapshot, snapshot.viewer),
    bands: snapshot.bands,
    shiftTypes: snapshot.types.map((type) => ({ type, versions: type.versions })),
  };
}

/** A duration as `t()` renders it: `12 h`, `12 h 30 min`, `45 min`. */
export interface HoursFigure {
  readonly key: ReturnType<typeof durationMessageKey>;
  readonly values: DurationValues;
}

function figureOf(minutes: number): HoursFigure {
  return { key: durationMessageKey(minutes), values: durationValuesOf(minutes) };
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
  /** Always `0 h` until leave records exist (Epic 5); never in a band or the total. */
  readonly leave: HoursFigure;
  /**
   * Working shifts with no times on their date — counted as shifts, never in
   * hours — or `null` when there are none, so the note is not shown.
   */
  readonly untimedShiftCount: number | null;
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
export function myHoursViewOf(snapshot: CalendarSnapshot, header: MonthHeader, hours: MemberHours): MyHoursView {
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
    leave: figureOf(hours.leaveMinutes),
    untimedShiftCount: hours.untimedShiftCount > 0 ? hours.untimedShiftCount : null,
  };
}

/**
 * The viewer's hours of the month `search` names — or today's, `today` being
 * the organization's (`calendarTodayOf`) — GUARDED: a `RangeError` from the
 * domain is logged and is the one failure, never a crashed route and never a
 * figure.
 */
export function myHoursOf(snapshot: CalendarSnapshot, search: HoursSearch, today: string): MyHoursOutcome {
  try {
    const month = monthShownOf(search, today);
    const hours = memberHoursOfMonth(memberHoursInputOf(snapshot), month);

    return { ok: true, view: myHoursViewOf(snapshot, monthHeaderOf(month, today), hours) };
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
  /** Never true beside a message or a figure. */
  readonly loading: boolean;
}

/** The heading of the month `search` names, or `null` when even that is refused. */
function monthShownHeaderOf(search: HoursSearch, today: string): MonthHeader | null {
  try {
    return monthHeaderOf(monthShownOf(search, today), today);
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return null;
  }
}

/**
 * The calendar read's surface state (`calendarSurfaceStateOf`) as *Sati*. ANY
 * read refusal is the message alone, with no navigation and no figure, so a
 * refusal code added later can never fall through to an endless skeleton. A
 * pending read is the skeleton under the navigation's placeholder. An answer
 * is the viewer's month, or — when the domain refuses its hours — the message
 * in place of the figures, the month navigation kept. No figure is ever
 * optimistic.
 */
export function myHoursSurfaceOf(state: CalendarSurfaceState, search: HoursSearch, today: string | null): MyHoursSurface {
  if (state.refusal !== null) {
    return { view: null, month: null, navShown: false, refusal: HOURS_UNAVAILABLE, loading: false };
  }
  if (state.snapshot === null || today === null) {
    return { view: null, month: null, navShown: true, refusal: null, loading: true };
  }

  const outcome = myHoursOf(state.snapshot, search, today);

  if (outcome.ok) {
    return { view: outcome.view, month: outcome.view.header, navShown: true, refusal: null, loading: false };
  }

  // A month the navigation cannot even head is the message alone, never a
  // placeholder bar beside it.
  const month = monthShownHeaderOf(search, today);

  return { view: null, month, navShown: month !== null, refusal: outcome.code, loading: false };
}

/** The message a failure renders as. Exhaustive. */
export function hoursMessageKey(failure: HoursFailure): 'sati.error.unavailable' {
  if (failure === HOURS_UNAVAILABLE) return 'sati.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}
