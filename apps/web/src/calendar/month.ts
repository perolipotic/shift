import {
  adjacentMonth,
  datesOfMonth,
  memberScheduleOfMonth,
  monthOf,
  scheduleOfMonth,
  shiftTypeVersionOn,
} from '@shift/domain';

import type { CalendarModifier } from '@/calendar/modifiers';
import { CALENDAR_UNAVAILABLE, type CalendarReadFailure, type CalendarSnapshot } from '@/calendar/snapshot';
import {
  formatIsoDayMonth,
  formatIsoMonthName,
  formatIsoWeekdayName,
  organizationIsoDate,
} from '@/i18n/format';
import type { MemberRole } from '@/navigation/destinations';
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
 *
 * TWO MODES OF ONE MONTH (story 3.2a): *Sve smjene*, the grid, and *Moj
 * raspored*, the viewer's own day list. Both are this module's answer over the
 * same snapshot; the compressed phone grid is the same grid, its letters
 * switched in by CSS.
 */

/** The search parameter that names the month shown: `?mjesec=2026-09`. */
export const MONTH_SEARCH_PARAM = 'mjesec';

/** The search parameter that names the mode shown: `?prikaz=moj`. */
export const MODE_SEARCH_PARAM = 'prikaz';

/**
 * The search parameter that names the one team *Sve smjene* is narrowed to:
 * `?smjena=<team id>` (story 3.3a). `smjena` is the Team, never a shift type.
 */
export const TEAM_SEARCH_PARAM = 'smjena';

/**
 * The team filter's all-teams option value. It cannot collide with a chosen
 * team because {@link calendarSearchOf} drops an empty `smjena`: no search the
 * calendar reads ever names `''`. {@link calendarFilterChangeOf} is the one
 * place that turns it into `{ smjena: null }`.
 */
export const ALL_TEAMS_FILTER = '';

/** *Moj raspored*: the viewer's own day list. */
export const MODE_MOJ = 'moj';

/** *Sve smjene*: every active team's grid. */
export const MODE_SVE = 'sve';

/** The two modes, in the order the switch offers them. */
export const CALENDAR_MODES = [MODE_MOJ, MODE_SVE] as const;

export type CalendarMode = (typeof CALENDAR_MODES)[number];

/** Below Tailwind's `sm:` (640 px) — the width the navigation's bottom tabs show at. */
export const PHONE_MEDIA_QUERY = '(max-width: 639px)';

/** As much of a `MediaQueryList` as the phone store reads. */
export interface PhoneMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** A `useSyncExternalStore` source for "is this a phone", read live. */
export interface PhoneStore {
  subscribe(onChange: () => void): () => void;
  get(): boolean;
}

/**
 * Whether the viewport is below 640 px ({@link PHONE_MEDIA_QUERY}), as a store
 * that follows the width live: crossing 640 px changes the default mode while
 * the viewer has chosen none. `media` is `window.matchMedia`, asked lazily.
 */
export function phoneStoreOf(media: (query: string) => PhoneMediaQuery): PhoneStore {
  // ONE list, asked for on first use and shared: what `get` reads is what
  // `subscribe` listens to.
  let list: PhoneMediaQuery | null = null;
  const query = (): PhoneMediaQuery => (list ??= media(PHONE_MEDIA_QUERY));

  return {
    subscribe(onChange) {
      const shared = query();

      shared.addEventListener('change', onChange);

      return () => {
        shared.removeEventListener('change', onChange);
      };
    },
    get: () => query().matches,
  };
}

/**
 * The calendar's search, as `validateSearch` returns it: a valid month and
 * mode, a non-empty team id, or nothing. Whether `smjena` names a team shown
 * is {@link calendarMonthOf}'s decision, not the parser's: the parser cannot
 * see the snapshot.
 */
export interface CalendarSearch {
  readonly mjesec?: string | undefined;
  readonly prikaz?: CalendarMode | undefined;
  readonly smjena?: string | undefined;
}

/** A change of the search: the month (`null`: the current one), the mode, or the team (`null`: every team). */
export type CalendarSearchChange =
  | { readonly mjesec: string | null }
  | { readonly prikaz: CalendarMode }
  | { readonly smjena: string | null };

/** Whether a value is one of the two modes. */
export function isCalendarMode(value: unknown): value is CalendarMode {
  return CALENDAR_MODES.some((mode) => mode === value);
}

/**
 * The mode shown when the search names none: the day list for a member-role
 * account on a phone, and the grid in every other case.
 */
export function defaultModeOf(role: MemberRole, isPhone: boolean): CalendarMode {
  return role === 'member_role' && isPhone ? MODE_MOJ : MODE_SVE;
}

/** The mode shown: the search's, or {@link defaultModeOf}. */
export function calendarModeOf(search: CalendarSearch, role: MemberRole, isPhone: boolean): CalendarMode {
  return isCalendarMode(search.prikaz) ? search.prikaz : defaultModeOf(role, isPhone);
}

/**
 * The search to navigate to: the one `change` applied, and everything else the
 * search already names kept — so the month buttons keep the mode and the team,
 * the mode switch keeps the month and the team (story 3.3a), and the team
 * filter keeps the month and the mode. `null` drops a month (the current one)
 * or a team (every team). A mode or team the viewer never chose is never
 * written in.
 */
export function calendarSearchTo(search: CalendarSearch, change: CalendarSearchChange): CalendarSearch {
  const mjesec = 'mjesec' in change ? change.mjesec : (search.mjesec ?? null);
  const prikaz = 'prikaz' in change ? change.prikaz : search.prikaz;
  const smjena = 'smjena' in change ? change.smjena : (search.smjena ?? null);

  return {
    ...(mjesec === null ? {} : { mjesec }),
    ...(prikaz === undefined ? {} : { prikaz }),
    ...(smjena === null ? {} : { smjena }),
  };
}

/**
 * The team filter's `<select>` value as a search change: the all-teams option
 * ({@link ALL_TEAMS_FILTER}) drops `smjena`. The ONE place the empty value is
 * mapped; pass its answer straight to {@link calendarSearchTo}.
 */
export function calendarFilterChangeOf(value: string): { readonly smjena: string | null } {
  return { smjena: value === ALL_TEAMS_FILTER ? null : value };
}

/** A cell's shape: at least 30 px high, the small radius, the label never truncated. */
export const CALENDAR_CELL_CLASS =
  'flex min-h-[30px] flex-col items-start justify-center gap-0.5 whitespace-nowrap rounded-sm px-2 py-1 text-xs font-semibold';

/**
 * A grid cell below 640 px, on top of {@link CALENDAR_CELL_CLASS}: a 44 × 44 px
 * touch target around its centred letter. `max-sm:` only, so the grid from
 * 640 px up is story 3.1's, class for class.
 */
export const COMPRESSED_CELL_CLASS = 'max-sm:min-h-11 max-sm:min-w-11 max-sm:items-center max-sm:px-1';

/** A cell in the day list, on top of {@link CALENDAR_CELL_CLASS}: it takes the row's remaining width. */
export const DAY_CELL_CLASS = 'min-w-0 flex-1';

/** A range in the grid: dropped below 1024 px, never abbreviated. */
export const GRID_RANGE_CLASS = 'hidden font-normal tabular-nums lg:inline';

/** A range in the day list: always shown. */
export const DAY_RANGE_CLASS = 'font-normal tabular-nums';

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
 * dropped, so the screen falls back to the organization's current month; a
 * missing or invalid `prikaz` is dropped, so the mode falls back to
 * {@link defaultModeOf}; a `smjena` that is not a non-empty string is dropped,
 * so every team shows. A non-empty `smjena` is KEPT whatever it names — an
 * unknown or archived team is ignored by {@link calendarMonthOf}, and stays in
 * the URL until the viewer chooses again.
 */
export function calendarSearchOf(search: Record<string, unknown>): CalendarSearch {
  const month = search[MONTH_SEARCH_PARAM];
  const mode = search[MODE_SEARCH_PARAM];
  const team = search[TEAM_SEARCH_PARAM];

  return {
    ...(isCalendarMonth(month) ? { mjesec: month } : {}),
    ...(isCalendarMode(mode) ? { prikaz: mode } : {}),
    ...(typeof team === 'string' && team !== '' ? { smjena: team } : {}),
  };
}

// ---------------------------------------------------------------- letters

/** The letters of a word, by code point of its NFC form, so a decomposed `Č` is one letter. */
function lettersIn(word: string): readonly string[] {
  return Array.from(word.normalize('NFC'));
}

/** What a label is widened from: the word the letters come from, and the full name last. */
interface LabelSource {
  readonly word: string;
  readonly name: string;
}

/** 1: one letter, 2: two letters, 3: the whole word, 4: the full name. */
const WIDEST_LEVEL = 4;

function labelOf({ word, name }: LabelSource, level: number): string {
  if (level >= WIDEST_LEVEL) return name;
  if (level === WIDEST_LEVEL - 1) return word.toLocaleUpperCase('hr');

  return lettersIn(word).slice(0, level).join('').toLocaleUpperCase('hr');
}

/**
 * Short labels, index for index: each word's first letter, uppercased;
 * sources whose labels collide all take their first two letters, then the
 * whole word, and sources STILL colliding (`Smjena A`, `Tim A`: one word) take
 * their full name — so two labels are only ever identical for two identical
 * names.
 */
function widenedLetters(sources: readonly LabelSource[]): readonly string[] {
  const levels = sources.map(() => 1);

  for (;;) {
    const labels = sources.map((source, index) => labelOf(source, levels[index] ?? 1));
    const counts = new Map<string, number>();

    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

    let widened = false;

    for (const [index, label] of labels.entries()) {
      const level = levels[index] ?? 1;

      if ((counts.get(label) ?? 0) > 1 && level < WIDEST_LEVEL) {
        levels[index] = level + 1;
        widened = true;
      }
    }

    if (!widened) return labels;
  }
}

/** A name in NFC, trimmed. */
function normalized(name: string): string {
  return name.normalize('NFC').trim();
}

/** The words of a name, split on white space. */
function wordsOf(name: string): readonly string[] {
  return name.split(/\s+/u).filter((word) => word !== '');
}

/**
 * The team headers of the compressed grid, index for index with `names`: the
 * first letter of each name's LAST word (`Smjena A` → `A`), uppercased, with
 * the collision widening of {@link widenedLetters} (`Alfa`, `Ante` → `AL`,
 * `AN`), and the full name where even the last words collide.
 */
export function teamLettersOf(names: readonly string[]): readonly string[] {
  return widenedLetters(
    names.map((raw) => {
      const name = normalized(raw);

      return { word: wordsOf(name).at(-1) ?? '', name };
    }),
  );
}

/**
 * The cells of the compressed grid, index for index with the type `names`:
 * the first letter of each name (`Dan`, `Noć`, `Slobodno` → `D`, `N`, `S`),
 * with the same collision widening (`Dan`, `Dežurstvo` → `DA`, `DE`).
 */
export function typeLettersOf(names: readonly string[]): readonly string[] {
  return widenedLetters(
    names.map((raw) => {
      const name = normalized(raw);

      return { word: name, name };
    }),
  );
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
  /** The type's letter in the compressed grid ({@link typeLettersOf}); `null` with the name. */
  readonly letter: string | null;
  /** The cell's shape and fill: the type's ramp slot, the non-working fill, or none. */
  readonly className: string;
  /** `19:00–07:00` from the type's version on that date; `null` for a non-working type or no times. */
  readonly range: string | null;
  /**
   * The marks the cell carries (`@/calendar/modifiers`), in any order. ALWAYS
   * EMPTY in story 3.2b: no data source derives a modifier yet.
   */
  readonly modifiers: readonly CalendarModifier[];
}

/** No modifiers: what every cell carries until a later story derives one. */
const NO_MODIFIERS: readonly CalendarModifier[] = [];

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

/** An active team as a grid column: its row, and its letter in the compressed grid. */
export type CalendarColumn = TeamRow & {
  /**
   * {@link teamLettersOf} over EVERY active team, filtered or not (story
   * 3.3a), so a column keeps its letter when the grid is narrowed to it.
   */
  readonly letter: string;
};

/** The team filter of *Sve smjene* (story 3.3a). */
export interface CalendarFilter {
  /** Its options: every active team, in column order. */
  readonly teams: readonly CalendarColumn[];
  /** The team the grid IS narrowed to, one of `teams`; `null` for every team. */
  readonly chosen: string | null;
}

/** One date of the viewer's own day list (*Moj raspored*). */
export interface CalendarDay {
  readonly date: string;
  /** `26.09.` */
  readonly dayMonth: string;
  /** `subota` */
  readonly weekday: string;
  readonly isToday: boolean;
  /** The viewer's team that day, archived or not; `null` when they are on none (`kalendar.day.noTeam`). */
  readonly teamId: string | null;
  /** That team's cell, as the grid draws it; `null` with the team. */
  readonly cell: CalendarCell | null;
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
  /**
   * The active teams, in the order the team list shows them — narrowed to
   * `filter.chosen` when a team is chosen, and every row's `cells` with them.
   */
  readonly columns: readonly CalendarColumn[];
  /**
   * The team filter. Its `teams` are the UNFILTERED active set — every active
   * team, whatever is chosen — so the Select always offers them all; only
   * `columns` and `rows` are narrowed.
   */
  readonly filter: CalendarFilter;
  readonly rows: readonly CalendarRow[];
  /**
   * The viewer's own day list, a day per date; `null` when they are on no
   * team on any date of the month, so the screen shows `kalendar.noTeam` and
   * never an empty list. A failure of the day list alone is
   * `CALENDAR_UNAVAILABLE` here, and the grid still draws.
   */
  readonly days: CalendarDayListOutcome;
}

/** The day list, or its own read failure — which the grid does not share. */
export type CalendarDayListOutcome =
  | { readonly ok: true; readonly days: readonly CalendarDay[] | null }
  | { readonly ok: false; readonly code: CalendarReadFailure };

/** A formatter's answer, or a `RangeError` naming what it refused — never a silent blank. */
function formatted(value: string | null, what: string): string {
  if (value === null) throw new RangeError(`${what} could not be formatted`);

  return value;
}

function capitalized(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLocaleUpperCase('hr')}${text.slice(1)}`;
}

/** What a cell is drawn from: the types by id, their fills and their letters. */
interface CellLookup {
  readonly types: ReadonlyMap<string, ShiftTypeRow>;
  readonly fills: ReadonlyMap<string, string>;
  readonly letters: ReadonlyMap<string, string>;
}

/**
 * The lookup for cells that show the types `shown` (ids, any order, repeats
 * allowed). The letters are {@link typeLettersOf} over THOSE types alone, in
 * creation order — the displayed list — so a type the month never shows, an
 * archived one included, never widens a letter that is shown.
 */
function cellLookupOf(snapshot: CalendarSnapshot, shown: Iterable<string | null>): CellLookup {
  const slots = rampSlotsOf(snapshot.types);
  const ids = new Set(shown);
  const displayed = snapshot.types.filter((type) => ids.has(type.id));
  const letters = typeLettersOf(displayed.map((type) => type.name));

  return {
    types: new Map(snapshot.types.map((type) => [type.id, type])),
    fills: new Map(
      snapshot.types.map((type) => [type.id, slotColourClassOf(type.isWorking ? (slots.get(type.id) ?? null) : null)]),
    ),
    letters: new Map(displayed.map((type, index) => [type.id, letters[index] ?? ''])),
  };
}

function cellOf(
  { types, fills, letters }: CellLookup,
  teamId: string,
  shiftTypeId: string | null,
  date: string,
): CalendarCell {
  if (shiftTypeId === null) {
    return {
      teamId,
      shiftTypeId,
      name: null,
      letter: null,
      className: `${CALENDAR_CELL_CLASS} ${NO_ROTATION_CELL_CLASS}`,
      range: null,
      modifiers: NO_MODIFIERS,
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
    letter: letters.get(shiftTypeId) ?? null,
    className: `${CALENDAR_CELL_CLASS} ${fills.get(shiftTypeId) ?? NONWORKING_CHIP_CLASS}`,
    range: version === null ? null : shiftTimesShownOf(version).range,
    modifiers: NO_MODIFIERS,
  };
}

function dayMonthOf(date: string): string {
  return formatted(formatIsoDayMonth(date), `the date ${date}`);
}

function weekdayOf(date: string): string {
  return formatted(formatIsoWeekdayName(date), `the weekday of ${date}`);
}

/**
 * The viewer's own day list of `month` (*Moj raspored*): a day per date, each
 * the type the viewer's team that day works — through `memberScheduleOfMonth`,
 * so a move between teams in the middle of the month changes rotation on the
 * day it takes effect — or no team. `null` when there is no team on any date:
 * the screen explains, never draws an empty list.
 *
 * @throws RangeError on any precondition of `memberScheduleOfMonth`, a type
 *   the snapshot lacks, or a date that cannot be formatted.
 */
export function calendarDayListOf(
  snapshot: CalendarSnapshot,
  month: string,
  today: string,
): readonly CalendarDay[] | null {
  const schedule = memberScheduleOfMonth(
    { memberships: snapshot.viewer.memberships, assignments: snapshot.assignments, steps: snapshot.steps },
    month,
  );

  if (schedule.every((day) => day.teamId === null)) return null;

  const lookup = cellLookupOf(
    snapshot,
    schedule.map((day) => day.shiftTypeId),
  );

  return schedule.map((day) => ({
    date: day.date,
    dayMonth: dayMonthOf(day.date),
    weekday: weekdayOf(day.date),
    isToday: day.date === today,
    teamId: day.teamId,
    cell: day.teamId === null ? null : cellOf(lookup, day.teamId, day.shiftTypeId, day.date),
  }));
}

/**
 * {@link calendarDayListOf}, GUARDED and LOCAL: a `RangeError` from the day
 * list — the viewer's history reaching a team whose rotation the grid never
 * projects — is *Moj raspored*'s failure alone, logged, and never takes the
 * *Sve smjene* grid down with it.
 */
function dayListOutcomeOf(snapshot: CalendarSnapshot, month: string, today: string): CalendarDayListOutcome {
  try {
    return { ok: true, days: calendarDayListOf(snapshot, month, today) };
  } catch (cause) {
    console.error(CALENDAR_UNAVAILABLE, cause);

    return { ok: false, code: CALENDAR_UNAVAILABLE };
  }
}

/**
 * The team the grid is narrowed to: `smjena` when it names one of the active
 * `teams`, and `null` otherwise. An unknown or archived id — a bookmark that
 * outlived its team — is every team, the harmless direction (`chooseTeam`).
 */
export function chosenTeamOf(search: CalendarSearch, teams: readonly { readonly id: string }[]): string | null {
  const wanted = search.smjena;

  return wanted === undefined ? null : (teams.find((team) => team.id === wanted)?.id ?? null);
}

/**
 * The month `search` names — or today's — as the screen draws it, from the
 * one snapshot. `today` is the organization's ({@link calendarTodayOf}).
 *
 * THE TEAM FILTER NARROWS LAST (story 3.3a): the letters, team and type alike,
 * are computed over every active team first, so a column and its cells draw
 * the same with the filter as without it.
 */
export function calendarMonthOf(snapshot: CalendarSnapshot, search: CalendarSearch, today: string): CalendarMonth {
  const month = monthShownOf(search, today);
  const active = splitTeams(snapshot.teams).active;
  const teamLetters = teamLettersOf(active.map((team) => team.name));
  const teams = active.map((team, index) => ({ ...team, letter: teamLetters[index] ?? '' }));
  const schedule = scheduleOfMonth(
    { teamIds: teams.map((team) => team.id), assignments: snapshot.assignments, steps: snapshot.steps },
    month,
  );
  const lookup = cellLookupOf(
    snapshot,
    schedule.flatMap((row) => row.cells.map((cell) => cell.shiftTypeId)),
  );
  const chosen = chosenTeamOf(search, teams);
  const shown = (teamId: string): boolean => chosen === null || teamId === chosen;
  const columns = teams.filter((team) => shown(team.id));

  return {
    month,
    monthName: capitalized(formatted(formatIsoMonthName(`${month}-01`), `the month ${month}`)),
    year: month.slice(0, 4),
    previous: adjacentMonth(month, -1),
    next: adjacentMonth(month, 1),
    isCurrent: month === monthOf(today),
    columns,
    filter: { teams, chosen },
    rows: schedule.map((row) => ({
      date: row.date,
      dayMonth: dayMonthOf(row.date),
      weekday: weekdayOf(row.date),
      isToday: row.date === today,
      cells: row.cells
        .filter((cell) => shown(cell.teamId))
        .map((cell) => cellOf(lookup, cell.teamId, cell.shiftTypeId, row.date)),
    })),
    days: dayListOutcomeOf(snapshot, month, today),
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
