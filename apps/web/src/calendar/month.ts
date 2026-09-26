import { adjacentMonth, datesOfMonth, monthOf, scheduleOfMonth, shiftTypeVersionOn } from '@shift/domain';

import { CALENDAR_UNAVAILABLE, type CalendarReadFailure, type CalendarSnapshot } from '@/calendar/snapshot';
import {
  formatIsoDayMonth,
  formatIsoMonthName,
  formatIsoWeekdayName,
  organizationIsoDate,
} from '@/i18n/format';
import {
  NONWORKING_CHIP_CLASS,
  NO_TIMES_SHOWN,
  rampSlotsOf,
  shiftTimesShownOf,
  slotColourClassOf,
  type ShiftTypeRow,
} from '@/shift-types/list';
import { splitTeams, type TeamRow } from '@/teams/list';

/**
 * One month of the calendar as the screen draws it (story 3.1): the heading,
 * the navigation, a row per date and a cell per active team, ready to render.
 *
 * PURE, and executed by the node suite (AD-15): `routes/kalendar.tsx` holds
 * markup and nothing else.
 *
 * NOTHING IS PROJECTED HERE (AD-7). Which type a team works on a date is
 * `scheduleOfMonth`'s answer from `@shift/domain`, which asks
 * `projectedShiftTypeOn` and nothing else; which times that type has on that
 * date is `shiftTypeVersionOn`'s. This module names, colours and formats.
 *
 * A SHIFT CROSSING MIDNIGHT belongs to its start date, as the domain has it:
 * `19:00–07:00` appears once, on the row of the date it starts, and the next
 * row shows whatever that team works then.
 */

/** The search parameter that names the month shown: `?mjesec=2026-09`. */
export const MONTH_SEARCH_PARAM = 'mjesec';

/** The calendar's search, as `validateSearch` returns it: a valid month or nothing. */
export interface CalendarSearch {
  readonly mjesec?: string | undefined;
}

/** A cell's shape: at least 30 px high, the small radius, the label never truncated. */
export const CALENDAR_CELL_CLASS =
  'flex min-h-[30px] flex-col items-start justify-center gap-0.5 whitespace-nowrap rounded-sm px-2 py-1 text-xs font-semibold';

/** A cell with no rotation in effect yet: no fill, only the mark. */
export const NO_ROTATION_CELL_CLASS = 'text-muted-foreground';

/** Whether a value is a `YYYY-MM` month the calendar can show (0001-01…9999-12). */
export function isCalendarMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    datesOfMonth(value);

    return true;
  } catch {
    return false;
  }
}

/**
 * The raw search as the calendar reads it. A missing or invalid `mjesec` is
 * dropped, so the screen falls back to the organization's current month.
 */
export function calendarSearchOf(search: Record<string, unknown>): CalendarSearch {
  const month = search[MONTH_SEARCH_PARAM];

  return isCalendarMonth(month) ? { mjesec: month } : {};
}

/** The organization's today, in its own zone (L8) — never the device's date. */
export function calendarTodayOf(snapshot: CalendarSnapshot, now: Date): string {
  return organizationIsoDate(now, snapshot.timeZone);
}

/** The month shown: the search's, or the one today falls in. */
export function monthShownOf(search: CalendarSearch, today: string): string {
  return search.mjesec !== undefined && isCalendarMonth(search.mjesec) ? search.mjesec : monthOf(today);
}

/** One team on one date, as the grid draws it. */
export interface CalendarCell {
  readonly teamId: string;
  readonly shiftTypeId: string | null;
  /** The type's name, always visible; `null` where no rotation is in effect yet. */
  readonly name: string | null;
  /** The cell's shape and fill: the type's ramp slot, the non-working fill, or none. */
  readonly className: string;
  /** `19:00–07:00` from the type's version on that date; `null` for a non-working type or no times. */
  readonly range: string | null;
}

/** One date of the month. */
export interface CalendarRow {
  readonly date: string;
  /** `26.09.` */
  readonly dayMonth: string;
  /** `subota` */
  readonly weekday: string;
  /** Today in the organization's zone. */
  readonly isToday: boolean;
  readonly cells: readonly CalendarCell[];
}

/** One month, ready to render. */
export interface CalendarMonth {
  /** `2026-09` */
  readonly month: string;
  /** `Rujan`, capitalized: it starts the heading. */
  readonly monthName: string;
  /** `2026` */
  readonly year: string;
  /** The month before, or `null` at 0001-01. */
  readonly previous: string | null;
  /** The month after, or `null` at 9999-12. */
  readonly next: string | null;
  /** Whether the month shown is the one today falls in. */
  readonly isCurrent: boolean;
  /** The active teams, in the order the team list shows them. */
  readonly columns: readonly TeamRow[];
  readonly rows: readonly CalendarRow[];
}

/** A formatter's answer, or a `RangeError` naming what it refused — never a silent blank. */
function formatted(value: string | null, what: string): string {
  if (value === null) throw new RangeError(`${what} could not be formatted`);

  return value;
}

function capitalized(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLocaleUpperCase('hr')}${text.slice(1)}`;
}

function cellOf(
  types: ReadonlyMap<string, ShiftTypeRow>,
  fills: ReadonlyMap<string, string>,
  teamId: string,
  shiftTypeId: string | null,
  date: string,
): CalendarCell {
  if (shiftTypeId === null) {
    return {
      teamId,
      shiftTypeId,
      name: null,
      className: `${CALENDAR_CELL_CLASS} ${NO_ROTATION_CELL_CLASS}`,
      range: null,
    };
  }

  const type = types.get(shiftTypeId);

  // Never a raw id as a label: a type the snapshot lacks is a defect, and
  // `calendarMonthOutcomeOf` turns it into the read failure.
  if (type === undefined) {
    throw new RangeError(`shift type ${shiftTypeId} is projected on ${date} but is not in the snapshot`);
  }

  const version = type.isWorking ? shiftTypeVersionOn(type.versions, date) : null;

  return {
    teamId,
    shiftTypeId,
    name: type.name,
    className: `${CALENDAR_CELL_CLASS} ${fills.get(shiftTypeId) ?? NONWORKING_CHIP_CLASS}`,
    range: version === null ? null : shiftTimesShownOf(version).range,
  };
}

/**
 * The month `search` names — or today's — as the screen draws it, from the
 * one snapshot. `today` is the organization's ({@link calendarTodayOf}).
 */
export function calendarMonthOf(snapshot: CalendarSnapshot, search: CalendarSearch, today: string): CalendarMonth {
  const month = monthShownOf(search, today);
  const columns = splitTeams(snapshot.teams).active;
  const types = new Map(snapshot.types.map((type) => [type.id, type]));
  const slots = rampSlotsOf(snapshot.types);
  const fills = new Map(
    snapshot.types.map((type) => [type.id, slotColourClassOf(type.isWorking ? (slots.get(type.id) ?? null) : null)]),
  );
  const schedule = scheduleOfMonth(
    { teamIds: columns.map((team) => team.id), assignments: snapshot.assignments, steps: snapshot.steps },
    month,
  );

  return {
    month,
    monthName: capitalized(formatted(formatIsoMonthName(`${month}-01`), `the month ${month}`)),
    year: month.slice(0, 4),
    previous: adjacentMonth(month, -1),
    next: adjacentMonth(month, 1),
    isCurrent: month === monthOf(today),
    columns,
    rows: schedule.map((row) => ({
      date: row.date,
      dayMonth: formatted(formatIsoDayMonth(row.date), `the date ${row.date}`),
      weekday: formatted(formatIsoWeekdayName(row.date), `the weekday of ${row.date}`),
      isToday: row.date === today,
      cells: row.cells.map((cell) => cellOf(types, fills, cell.teamId, cell.shiftTypeId, row.date)),
    })),
  };
}

/** A month to draw, or the calendar's one read failure. */
export type CalendarMonthOutcome =
  | { readonly ok: true; readonly month: CalendarMonth }
  | { readonly ok: false; readonly code: CalendarReadFailure };

/**
 * {@link calendarMonthOf}, GUARDED: a `RangeError` from the domain
 * (`scheduleOfMonth`, `projectedShiftTypeOn`, `shiftTypeVersionOn`) or from
 * formatting — data `readCalendar` did not fully re-check — becomes
 * `CALENDAR_UNAVAILABLE`, so the screen shows the alert and no grid instead of
 * crashing the route. The cause is logged.
 */
export function calendarMonthOutcomeOf(
  snapshot: CalendarSnapshot,
  search: CalendarSearch,
  today: string,
): CalendarMonthOutcome {
  try {
    return { ok: true, month: calendarMonthOf(snapshot, search, today) };
  } catch (cause) {
    console.error(CALENDAR_UNAVAILABLE, cause);

    return { ok: false, code: CALENDAR_UNAVAILABLE };
  }
}

/** What a cell with no rotation shows: a mark, with `kalendar.noRotation` for screen readers. */
export const NO_ROTATION_SHOWN = NO_TIMES_SHOWN;

/** How many skeleton rows stand in for the grid while it loads: a month's worth, so nothing jumps. */
export const SKELETON_ROW_COUNT = 30;

/** The skeleton's columns while the teams are unknown. */
export const SKELETON_COLUMN_COUNT = 4;

/** The skeleton row's grid: the date column and {@link SKELETON_COLUMN_COUNT} team columns. */
export const SKELETON_GRID_STYLE = {
  gridTemplateColumns: `repeat(${String(SKELETON_COLUMN_COUNT + 1)}, minmax(0, 1fr))`,
} as const;
