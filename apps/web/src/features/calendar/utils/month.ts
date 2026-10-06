import {
  activeOn,
  adjacentMonth,
  datesOfMonth,
  memberScheduleOfMonth,
  monthOf,
  overrideStandingOf,
  overridesByTeamAndDate,
  rosterOn,
  scheduleOfMonth,
  shiftTypeVersionOn,
  type Collision,
  type CollisionResolution,
  type LeaveRange,
  type MemberScheduleInput,
  type MembershipVersion,
  type OverrideStanding,
  type StatusVersion,
} from '@shift/domain';

import {
  MODIFIER_CONFLICT,
  MODIFIER_LEAVE,
  MODIFIER_OVERRIDDEN,
  MODIFIER_UNCOVERED,
  type CalendarModifier,
} from '@/features/calendar/utils/modifiers';
import {
  CALENDAR_UNAVAILABLE,
  type CalendarOverride,
  type CalendarReadFailure,
  type CalendarRosterOverride,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import {
  formatIsoDayMonth,
  formatIsoMonthName,
  formatIsoWeekdayName,
  organizationIsoDate,
} from '@/lib/i18n/format';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import {
  NONWORKING_CHIP_CLASS,
  NO_TIMES_SHOWN,
  rampSlotsOf,
  shiftTimesShownOf,
  slotColourClassOf,
  type ShiftTypeRow,
} from '@/features/shift-types/services/list';
import { splitTeams, type TeamRow } from '@/features/teams/services/list';
import { instantMicrosOf } from '@/features/rotation/services/list';

/**
 * The month heading's id, re-exported for the page, which hands it to the
 * shared `@/components/month-nav` (story 4.1b): the rule is `grid-keys`'s.
 */
export { MONTH_HEADING_ID } from '@/features/calendar/utils/grid-keys';

/**
 * One month of the calendar as the screen draws it (story 3.1): the heading,
 * the navigation, a row per date and a cell per active team, ready to render.
 *
 * PURE, and executed by the node suite (AD-15): `pages/kalendar.tsx` holds
 * markup and nothing else.
 *
 * NOTHING IS PROJECTED HERE (AD-7). Which type a team works on a date is
 * `scheduleOfMonth`'s answer from `@shift/domain` — the projection with the
 * shift-type overrides IN FORCE applied over it (stories 3.5a, 3.5c), and
 * whether one was; an override a rotation change left pending is not applied;
 * which times that type has on that date is `shiftTypeVersionOn`'s. Whether a
 * roster override changed who works a cell, and which shifts a member holds
 * through one (story 3.6a), is the same answer's too. This module names,
 * colours, marks and formats.
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

/** One live override of the calendar with the instant it was written or last confirmed. */
export type StampedCalendarOverride = CalendarOverride & { readonly writtenAt: number };

const STANDINGS = new WeakMap<CalendarSnapshot, OverrideStanding<StampedCalendarOverride>>();

/**
 * The snapshot's live overrides IN FORCE and those PENDING the admin's review
 * (story 3.5c): `overrideStandingOf`'s answer from `@shift/domain`, over the
 * versions' save times and each override's `confirmedAt ?? createdAt`, as
 * epoch microseconds parsed at the edge by `instantMicrosOf`. Only `inForce` reaches a cell,
 * a day or a roster. Worked out once per snapshot.
 *
 * @throws RangeError on any precondition of `overrideStandingOf`, or on two
 *   shift-type overrides of one team and date (`overridesByTeamAndDate`).
 */
export function overrideStandingOfCalendar(snapshot: CalendarSnapshot): OverrideStanding<StampedCalendarOverride> {
  const known = STANDINGS.get(snapshot);

  if (known !== undefined) return known;

  // One live shift-type override per team and date is that layer's own
  // precondition, which the shared pending rule no longer checks (story
  // 3.6a): the day detail's pending lookup must never pick one of two.
  overridesByTeamAndDate(snapshot.overrides);

  const standing = overrideStandingOf(
    snapshot.assignmentStamps,
    snapshot.overrides.map((override) => ({
      ...override,
      writtenAt: instantMicrosOf(override.confirmedAt ?? override.createdAt) ?? Number.NaN,
    })),
  );

  STANDINGS.set(snapshot, standing);

  return standing;
}

/** One live roster override of the calendar with the instant it was written (story 3.6a). */
export type StampedCalendarRosterOverride = CalendarRosterOverride & { readonly writtenAt: number };

const ROSTER_STANDINGS = new WeakMap<CalendarSnapshot, OverrideStanding<StampedCalendarRosterOverride>>();

/**
 * The snapshot's live roster overrides IN FORCE and those PENDING review
 * (story 3.6a): the twin of {@link overrideStandingOfCalendar}, over each
 * roster override's `createdAt` — it has no confirmation. Only `inForce`
 * reaches a cell, a day or a roster. Worked out once per snapshot.
 *
 * @throws RangeError on any precondition of `overrideStandingOf`.
 */
export function rosterStandingOfCalendar(snapshot: CalendarSnapshot): OverrideStanding<StampedCalendarRosterOverride> {
  const known = ROSTER_STANDINGS.get(snapshot);

  if (known !== undefined) return known;

  const standing = overrideStandingOf(
    snapshot.assignmentStamps,
    snapshot.rosterOverrides.map((override) => ({
      ...override,
      writtenAt: instantMicrosOf(override.createdAt) ?? Number.NaN,
    })),
  );

  ROSTER_STANDINGS.set(snapshot, standing);

  return standing;
}

/** The ids of the snapshot's working shift types: a roster override applies on a working shift alone. */
export function workingShiftTypeIdsOf(snapshot: CalendarSnapshot): readonly string[] {
  return snapshot.types.filter((type) => type.isWorking).map((type) => type.id);
}

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
 * The search parameter that names the one person *Sve smjene* shows:
 * `?osoba=<member id>` (story 3.3b). A person chosen wins over `smjena`.
 */
export const PERSON_SEARCH_PARAM = 'osoba';

/**
 * The team filter's all-teams option value. It cannot collide with a chosen
 * team because {@link calendarSearchOf} drops an empty `smjena`: no search the
 * calendar reads ever names `''`. {@link calendarFilterChangeOf} is the one
 * place that turns it into `{ smjena: null, osoba: null }`.
 */
export const ALL_TEAMS_FILTER = '';

/**
 * What a person's option value starts with in the one filter Select (story
 * 3.3b): `osoba:<member id>`, so a person's value never reads as a team id. A
 * team's value stays its bare id.
 */
export const PERSON_FILTER_PREFIX = 'osoba:';

/** A person's option value in the filter Select. */
export function personFilterValueOf(id: string): string {
  return `${PERSON_FILTER_PREFIX}${id}`;
}

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
  readonly osoba?: string | undefined;
}

/**
 * The filter's change: the team and the person, BOTH ALWAYS PRESENT (story
 * 3.3b), so choosing one drops the other. `null` drops either.
 */
export interface CalendarFilterChange {
  readonly smjena: string | null;
  readonly osoba: string | null;
}

/** A change of the search: the month (`null`: the current one), the mode, or the filter. */
export type CalendarSearchChange =
  | { readonly mjesec: string | null }
  | { readonly prikaz: CalendarMode }
  | CalendarFilterChange;

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
 * search already names kept — so the month buttons keep the mode, the team
 * and the person, the mode switch keeps the month, the team (story 3.3a) and
 * the person (story 3.3b), and the filter keeps the month and the mode. `null`
 * drops a month (the current one), a team or a person. A mode, team or person
 * the viewer never chose is never written in.
 */
export function calendarSearchTo(search: CalendarSearch, change: CalendarSearchChange): CalendarSearch {
  const mjesec = 'mjesec' in change ? change.mjesec : (search.mjesec ?? null);
  const prikaz = 'prikaz' in change ? change.prikaz : search.prikaz;
  const smjena = 'smjena' in change ? change.smjena : (search.smjena ?? null);
  const osoba = 'osoba' in change ? change.osoba : (search.osoba ?? null);

  return {
    ...(mjesec === null ? {} : { mjesec }),
    ...(prikaz === undefined ? {} : { prikaz }),
    ...(smjena === null ? {} : { smjena }),
    ...(osoba === null ? {} : { osoba }),
  };
}

/**
 * The filter `<select>`'s value as a search change, both keys always present:
 * the all-teams option ({@link ALL_TEAMS_FILTER}) drops both, a person's
 * `osoba:<id>` ({@link PERSON_FILTER_PREFIX}) chooses that person and drops
 * the team, and anything else chooses that team and drops the person. The ONE
 * place the values are mapped; pass its answer straight to
 * {@link calendarSearchTo}.
 */
export function calendarFilterChangeOf(value: string): CalendarFilterChange {
  if (value === ALL_TEAMS_FILTER) return { smjena: null, osoba: null };

  if (value.startsWith(PERSON_FILTER_PREFIX)) {
    const osoba = value.slice(PERSON_FILTER_PREFIX.length);

    return { smjena: null, osoba: osoba === '' ? null : osoba };
  }

  return { smjena: value, osoba: null };
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
 * {@link defaultModeOf}; a `smjena` or `osoba` that is not a non-empty string
 * is dropped, so every team shows. A non-empty `smjena` or `osoba` is KEPT
 * whatever it names — an unknown or archived team, or an unknown or inactive
 * person, is ignored by {@link calendarMonthOf}, and stays in the URL until
 * the viewer chooses again.
 */
export function calendarSearchOf(search: Record<string, unknown>): CalendarSearch {
  const month = search[MONTH_SEARCH_PARAM];
  const mode = search[MODE_SEARCH_PARAM];
  const team = search[TEAM_SEARCH_PARAM];
  const person = search[PERSON_SEARCH_PARAM];

  return {
    ...(isCalendarMonth(month) ? { mjesec: month } : {}),
    ...(isCalendarMode(mode) ? { prikaz: mode } : {}),
    ...(typeof team === 'string' && team !== '' ? { smjena: team } : {}),
    ...(typeof person === 'string' && person !== '' ? { osoba: person } : {}),
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

/**
 * `month`'s heading and navigation, `today` the organization's
 * ({@link calendarTodayOf}): the one rule both the calendar and *Sati* draw
 * their month navigation from (story 4.1b).
 *
 * @throws RangeError when `month` is not a `YYYY-MM` or cannot be formatted.
 */
export function monthHeaderOf(month: string, today: string): MonthHeader {
  return {
    month,
    monthName: capitalized(formatted(formatIsoMonthName(`${month}-01`), `the month ${month}`)),
    year: month.slice(0, 4),
    previous: adjacentMonth(month, -1),
    next: adjacentMonth(month, 1),
    isCurrent: month === monthOf(today),
    current: monthOf(today),
  };
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
   * The marks the cell carries (`@/features/calendar/utils/modifiers`), in
   * canonical order — conflict, overridden, leave, uncovered: `conflict`
   * where a collision falls on it (story 5.3c, {@link CalendarMarks}),
   * `overridden` where a shift-type override replaced the projected type
   * (story 3.5a) or a roster override changed who works it (story 3.6a),
   * `leave` where leave covers it (story 5.3c), and `uncovered` on an
   * admin's grid cell whose shift a member's conflict was accepted as
   * uncovered on (story 5.4b). A cell with no rotation in effect carries none.
   */
  readonly modifiers: readonly CalendarModifier[];
}

/**
 * What the conflict and leave marks are set from (story 5.3c), DERIVED on
 * every read and never stored: `collisionsOf`'s collisions over the calendar
 * snapshot and the live leave the viewer may see, and those records' ranges
 * by member. Built by `@/features/calendar/services/marks`; read here alone.
 *
 * WHO SEES WHAT is the builder's: an admin's marks carry every collision and
 * every member's leave; a member's carry no collision and their own leave
 * alone, so no other member's leave and no conflict can ever reach a cell.
 */
export interface CalendarMarks {
  /** Every collision shown: none for a member. */
  readonly collisions: readonly Collision[];
  /**
   * The keys of the conflicts accepted as uncovered (story 5.4b): the
   * admin's, from the organization's live resolutions; none for a member,
   * who reads no organization resolution and is shown no uncovered mark.
   */
  readonly uncovered: readonly CollisionResolution[];
  /** Each member's live leave ranges, by member id: only the viewer's own for a member. */
  readonly leave: ReadonlyMap<string, readonly LeaveRange[]>;
}

/** No modifiers: a cell with no rotation in effect, which has no schedule to mark. */
const NO_MODIFIERS: readonly CalendarModifier[] = [];

/** No collision and no leave: a calendar with nothing to mark. */
export const NO_MARKS: CalendarMarks = { collisions: [], uncovered: [], leave: new Map() };

/** The key a grid cell's collisions are found under: its team and date. */
function teamDateKeyOf(teamId: string, date: string): string {
  return `${teamId}|${date}`;
}

/** The key a member's cell's collision is found under: member, team and date. */
function memberTeamDateKeyOf(memberId: string, teamId: string, date: string): string {
  return `${memberId}|${teamId}|${date}`;
}

/** {@link CalendarMarks} indexed once per month, for the cells to look up. */
interface MarksLookup {
  readonly teamDates: ReadonlySet<string>;
  /** The team and date of every accepted-uncovered key. */
  readonly uncoveredTeamDates: ReadonlySet<string>;
  readonly memberTeamDates: ReadonlySet<string>;
  readonly leave: ReadonlyMap<string, readonly LeaveRange[]>;
}

function marksLookupOf(marks: CalendarMarks): MarksLookup {
  return {
    teamDates: new Set(marks.collisions.map((collision) => teamDateKeyOf(collision.teamId, collision.date))),
    uncoveredTeamDates: new Set(marks.uncovered.map((key) => teamDateKeyOf(key.teamId, key.date))),
    memberTeamDates: new Set(
      marks.collisions.map((collision) => memberTeamDateKeyOf(collision.memberId, collision.teamId, collision.date)),
    ),
    leave: marks.leave,
  };
}

/** Whether `memberId`'s leave covers `date`, every date of a range inclusive — a non-working one too. */
function onLeave(lookup: MarksLookup, memberId: string, date: string): boolean {
  return (lookup.leave.get(memberId) ?? []).some((range) => range.from <= date && date <= range.to);
}

/** What one cell is marked for. */
interface CellMarks {
  readonly conflict: boolean;
  readonly leave: boolean;
  readonly overridden: boolean;
  readonly uncovered: boolean;
}

/**
 * THE ONE PLACE A CELL'S MARKS ARE SET, in canonical order: conflict, then
 * overridden, then leave, then uncovered.
 */
function cellModifiersOf({ conflict, leave, overridden, uncovered }: CellMarks): readonly CalendarModifier[] {
  const modifiers: CalendarModifier[] = [];

  if (conflict) modifiers.push(MODIFIER_CONFLICT);
  if (overridden) modifiers.push(MODIFIER_OVERRIDDEN);
  if (leave) modifiers.push(MODIFIER_LEAVE);
  if (uncovered) modifiers.push(MODIFIER_UNCOVERED);

  return modifiers;
}

/**
 * A grid cell's marks: conflict AND leave where any collision falls on its
 * team and date — the grid names the shift, not the person on leave — and
 * uncovered where a conflict on it was accepted as uncovered (story 5.4b).
 */
function gridCellMarksOf(lookup: MarksLookup, teamId: string, date: string, overridden: boolean): CellMarks {
  const key = teamDateKeyOf(teamId, date);
  const collided = lookup.teamDates.has(key);

  return { conflict: collided, leave: collided, overridden, uncovered: lookup.uncoveredTeamDates.has(key) };
}

/**
 * A member's own cell's marks (*Moj raspored*, the person shown): leave on
 * every date their leave covers, and conflict where their own collision falls
 * on that team and date.
 */
function memberCellMarksOf(
  lookup: MarksLookup,
  memberId: string,
  teamId: string,
  date: string,
  overridden: boolean,
): CellMarks {
  return {
    conflict: lookup.memberTeamDates.has(memberTeamDateKeyOf(memberId, teamId, date)),
    leave: onLeave(lookup, memberId, date),
    overridden,
    uncovered: false,
  };
}

/**
 * The accepted-uncovered keys that still name a shift (story 5.4b): those
 * whose team works a WORKING shift that date in `schedule`, with the key's
 * member on its roster (`rosterOn`, the overrides in force applied). A key
 * over a non-working day, a day with no rotation, or a shift the member is no
 * longer rostered on marks nothing.
 */
function uncoveredOnRosterOf(
  snapshot: CalendarSnapshot,
  schedule: readonly { readonly date: string; readonly cells: readonly { readonly teamId: string; readonly shiftTypeId: string | null }[] }[],
  uncovered: readonly CollisionResolution[],
): readonly CollisionResolution[] {
  if (uncovered.length === 0) return uncovered;

  const working = new Set(workingShiftTypeIdsOf(snapshot));
  const typeOn = new Map<string, string | null>();

  for (const row of schedule) {
    for (const cell of row.cells) typeOn.set(teamDateKeyOf(cell.teamId, row.date), cell.shiftTypeId);
  }

  const inForce = rosterStandingOfCalendar(snapshot).inForce;

  return uncovered.filter((key) => {
    const type = typeOn.get(teamDateKeyOf(key.teamId, key.date)) ?? null;

    return (
      type !== null &&
      working.has(type) &&
      rosterOn(snapshot.members, inForce, key.teamId, key.date).roster.some((entry) => entry.memberId === key.memberId)
    );
  });
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

/** An active team as a grid column: its row, and its letter in the compressed grid. */
export type CalendarColumn = TeamRow & {
  /**
   * {@link teamLettersOf} over EVERY active team, filtered or not (story
   * 3.3a), so a column keeps its letter when the grid is narrowed to it.
   */
  readonly letter: string;
};

/**
 * One member's two version histories, which their day list is derived from
 * (story 3.4a), and their id, which a roster override names (story 3.6a).
 */
export interface CalendarMemberHistory {
  readonly memberId: string;
  readonly memberships: readonly MembershipVersion[];
  readonly statuses: readonly StatusVersion[];
}

/** A person the filter offers: id and name only (story 3.3b). */
export interface CalendarFilterPerson {
  readonly id: string;
  readonly name: string;
}

/** The filter of *Sve smjene*: one team (story 3.3a) or one person (story 3.3b). */
export interface CalendarFilter {
  /** Its team options: every active team, in column order. */
  readonly teams: readonly CalendarColumn[];
  /**
   * The team the grid IS narrowed to, one of `teams`; `null` for every team,
   * and `null` whenever a person is chosen.
   */
  readonly chosen: string | null;
  /**
   * Its person options: every member active on at least one date of the
   * month shown (`activeOn`) — the same rule as a Sati row — in the
   * snapshot's name order.
   */
  readonly people: readonly CalendarFilterPerson[];
  /** The person shown, one of `people`; `null` for none. */
  readonly person: string | null;
}

/** The person *Sve smjene* shows in place of the grid (story 3.3b). */
export interface CalendarPersonMonth {
  readonly id: string;
  readonly name: string;
  /** Their day list, as *Moj raspored* draws the viewer's; its failure is theirs alone. */
  readonly days: CalendarDayListOutcome;
}

/** One shift of a day in the day list (story 3.6a): a team the member works with that day. */
export interface CalendarDayShift {
  /** The team, archived or not. */
  readonly teamId: string;
  /** That team's cell, as the grid draws it. */
  readonly cell: CalendarCell;
  /** Held only through a roster override: another team's shift the member was put on. */
  readonly viaOverride: boolean;
}

/** One date of the viewer's own day list (*Moj raspored*). */
export interface CalendarDay {
  readonly date: string;
  /** `26.09.` */
  readonly dayMonth: string;
  /** `subota` */
  readonly weekday: string;
  readonly isToday: boolean;
  /**
   * The member's shifts that day, a row each: their own team's first, then
   * each one a roster override put them on (story 3.6a). Empty when they are
   * on no team, or were taken off their team's shift (`kalendar.day.noTeam`).
   */
  readonly shifts: readonly CalendarDayShift[];
}

/**
 * A month's heading and its way to the adjacent months, as the shared month
 * navigation draws it — the calendar's and *Sati*'s alike (story 4.1b).
 */
export interface MonthHeader {
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
  /** The month today falls in, `2026-09` — the month picker marks it (story 7.4). */
  readonly current: string;
}

/** One month, ready to render. */
export interface CalendarMonth extends MonthHeader {
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
  /**
   * The person chosen in the filter, with their day list, or `null` for none.
   * `columns` and `rows` are NOT narrowed by it: the screen draws the person
   * instead of the grid.
   */
  readonly person: CalendarPersonMonth | null;
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
  marks: CellMarks,
): CalendarCell {
  // NO ROTATION, NO MARK: there is no schedule to mark, so the cell carries
  // none — no overridden, no conflict and no leave — whatever the marks say.
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

  const modifiers = cellModifiersOf(marks);

  const type = types.get(shiftTypeId);

  // Never a raw id as a label: a type the snapshot lacks is a defect, and
  // `calendarMonthOutcomeOf` turns it into the read failure.
  if (type === undefined) {
    throw new RangeError(`shift type ${shiftTypeId} is projected on ${date} but is not in the snapshot`);
  }

  return {
    teamId,
    shiftTypeId,
    name: type.name,
    letter: letters.get(shiftTypeId) ?? null,
    className: `${CALENDAR_CELL_CLASS} ${fills.get(shiftTypeId) ?? NONWORKING_CHIP_CLASS}`,
    range: typeRangeOn(type, date),
    modifiers,
  };
}

/**
 * THE ONE RANGE DERIVATION, shared by a cell and the day detail (story 3.4b):
 * `19:00–07:00` from the type's version on `date`; `null` for a non-working
 * type, or a working one with no version in effect on it.
 *
 * @throws RangeError on any precondition of `shiftTypeVersionOn`.
 */
export function typeRangeOn(type: ShiftTypeRow, date: string): string | null {
  const version = type.isWorking ? shiftTypeVersionOn(type.versions, date) : null;

  return version === null ? null : shiftTimesShownOf(version).range;
}

/** `26.09.`, as every row and day of the calendar reads it. */
export function dayMonthOf(date: string): string {
  return formatted(formatIsoDayMonth(date), `the date ${date}`);
}

/** `subota`, as every row and day of the calendar reads it. */
export function weekdayOf(date: string): string {
  return formatted(formatIsoWeekdayName(date), `the weekday of ${date}`);
}

/**
 * What `memberScheduleOfMonth` walks for one member, from the one snapshot:
 * their histories, every rotation, and the shift-type and roster overrides IN
 * FORCE. THE ONE RECIPE: the day list below and *Sati*'s hours (story 4.1b)
 * both start from it, so the shifts counted in hours are exactly the working
 * shifts of the day list.
 */
export function memberScheduleInputOf(
  snapshot: CalendarSnapshot,
  { memberId, memberships, statuses }: CalendarMemberHistory,
): MemberScheduleInput {
  return {
    memberId,
    memberships,
    statuses,
    assignments: snapshot.assignments,
    steps: snapshot.steps,
    overrides: overrideStandingOfCalendar(snapshot).inForce,
    members: snapshot.members,
    rosterOverrides: rosterStandingOfCalendar(snapshot).inForce,
    workingShiftTypeIds: workingShiftTypeIdsOf(snapshot),
  };
}

/**
 * One member's day list of `month` — the viewer's in *Moj raspored*, or the
 * person chosen in the filter (story 3.3b) — from their membership and status
 * histories: a day per date, each the type the member's team that day works —
 * through `memberScheduleOfMonth`, so a move between teams in the middle of
 * the month changes rotation on the day it takes effect — or no team, which a
 * day the member is inactive on is too (story 3.4a). The roster overrides IN
 * FORCE drop a working shift the member was taken off, and add each one they
 * were put on (story 3.6a). `null` when there is no shift on any date: the
 * screen explains, never draws an empty list.
 *
 * @throws RangeError on any precondition of `memberScheduleOfMonth`, a type
 *   the snapshot lacks, or a date that cannot be formatted.
 */
export function calendarDayListOf(
  snapshot: CalendarSnapshot,
  { memberId, memberships, statuses }: CalendarMemberHistory,
  month: string,
  today: string,
  marks: CalendarMarks = NO_MARKS,
): readonly CalendarDay[] | null {
  const schedule = memberScheduleOfMonth(memberScheduleInputOf(snapshot, { memberId, memberships, statuses }), month);
  const marked = marksLookupOf(marks);

  if (schedule.every((day) => day.shifts.length === 0)) return null;

  const lookup = cellLookupOf(
    snapshot,
    schedule.flatMap((day) => day.shifts.map((shift) => shift.shiftTypeId)),
  );

  return schedule.map((day) => ({
    date: day.date,
    dayMonth: dayMonthOf(day.date),
    weekday: weekdayOf(day.date),
    isToday: day.date === today,
    shifts: day.shifts.map((shift) => ({
      teamId: shift.teamId,
      cell: cellOf(
        lookup,
        shift.teamId,
        shift.shiftTypeId,
        day.date,
        memberCellMarksOf(marked, memberId, shift.teamId, day.date, shift.overridden || shift.rosterChanged),
      ),
      viaOverride: shift.viaOverride,
    })),
  }));
}

/**
 * {@link calendarDayListOf}, GUARDED and LOCAL: a `RangeError` from the day
 * list — a member's history reaching a team whose rotation the grid never
 * projects — is that day list's failure alone, logged, and never takes the
 * *Sve smjene* grid down with it.
 */
function dayListOutcomeOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory,
  month: string,
  today: string,
  marks: CalendarMarks,
): CalendarDayListOutcome {
  try {
    return { ok: true, days: calendarDayListOf(snapshot, history, month, today, marks) };
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
 * The person shown: `osoba` when it names one of `people` — the members active
 * on at least one date of the month shown, as a Sati row — and `null`
 * otherwise. An unknown id, or one inactive all month, is no person, the
 * harmless direction, as {@link chosenTeamOf}; the URL keeps it.
 */
export function chosenPersonOf(search: CalendarSearch, people: readonly { readonly id: string }[]): string | null {
  const wanted = search.osoba;

  return wanted === undefined ? null : (people.find((person) => person.id === wanted)?.id ?? null);
}

/**
 * The month `search` names — or today's — as the screen draws it, from the
 * one snapshot. `today` is the organization's ({@link calendarTodayOf}).
 *
 * A PERSON WINS OVER A TEAM (story 3.3b): the Select only ever produces one,
 * and a hand-edited URL carrying both resolves to the narrower. With a person
 * chosen, the team filter reads `chosen: null` and the grid is not narrowed.
 *
 * THE TEAM FILTER NARROWS LAST (story 3.3a): the letters, team and type alike,
 * are computed over every active team first, so a column and its cells draw
 * the same with the filter as without it.
 */
export function calendarMonthOf(
  snapshot: CalendarSnapshot,
  search: CalendarSearch,
  today: string,
  marks: CalendarMarks = NO_MARKS,
): CalendarMonth {
  const month = monthShownOf(search, today);
  const active = splitTeams(snapshot.teams).active;
  const teamLetters = teamLettersOf(active.map((team) => team.name));
  const teams = active.map((team, index) => ({ ...team, letter: teamLetters[index] ?? '' }));
  const schedule = scheduleOfMonth(
    {
      teamIds: teams.map((team) => team.id),
      assignments: snapshot.assignments,
      steps: snapshot.steps,
      overrides: overrideStandingOfCalendar(snapshot).inForce,
      members: snapshot.members,
      rosterOverrides: rosterStandingOfCalendar(snapshot).inForce,
      workingShiftTypeIds: workingShiftTypeIdsOf(snapshot),
    },
    month,
  );
  const lookup = cellLookupOf(
    snapshot,
    schedule.flatMap((row) => row.cells.map((cell) => cell.shiftTypeId)),
  );
  const marked = marksLookupOf({ ...marks, uncovered: uncoveredOnRosterOf(snapshot, schedule, marks.uncovered) });
  // ACTIVE IN THE MONTH SHOWN: a member active on at least one of its dates,
  // by the domain's rule over their status versions (story 3.4a) — the same
  // membership rule as a Sati row, so a Sati name always opens that member.
  // One list feeds both the Select and `chosenPersonOf`.
  const dates = datesOfMonth(month);
  const people = snapshot.members.filter((member) => dates.some((date) => activeOn(member.statuses, date)));
  const person = chosenPersonOf(search, people);
  const chosen = person === null ? chosenTeamOf(search, teams) : null;
  const personShown = people.find((one) => one.id === person) ?? null;
  const shown = (teamId: string): boolean => chosen === null || teamId === chosen;
  const columns = teams.filter((team) => shown(team.id));

  return {
    ...monthHeaderOf(month, today),
    columns,
    filter: {
      teams,
      chosen,
      people: people.map(({ id, name }) => ({ id, name })),
      person,
    },
    rows: schedule.map((row) => ({
      date: row.date,
      dayMonth: dayMonthOf(row.date),
      weekday: weekdayOf(row.date),
      isToday: row.date === today,
      cells: row.cells
        .filter((cell) => shown(cell.teamId))
        .map((cell) =>
          cellOf(
            lookup,
            cell.teamId,
            cell.shiftTypeId,
            row.date,
            gridCellMarksOf(marked, cell.teamId, row.date, cell.overridden || cell.rosterChanged),
          ),
        ),
    })),
    days: dayListOutcomeOf(snapshot, snapshot.viewer, month, today, marks),
    person:
      personShown === null
        ? null
        : {
            id: personShown.id,
            name: personShown.name,
            days: dayListOutcomeOf(snapshot, { ...personShown, memberId: personShown.id }, month, today, marks),
          },
  };
}

/** A month to draw, or the calendar's one read failure. */
export type CalendarMonthOutcome =
  | { readonly ok: true; readonly month: CalendarMonth }
  | { readonly ok: false; readonly code: CalendarReadFailure };

/**
 * {@link calendarMonthOf}, GUARDED: a `RangeError` from the domain
 * (`scheduleOfMonth`, `projectedShiftTypeOn`, `shiftTypeVersionOn`, an
 * override's precondition) or from
 * formatting — data `readCalendar` did not fully re-check — becomes
 * `CALENDAR_UNAVAILABLE`, so the screen shows the alert and no grid instead of
 * crashing the route. The cause is logged.
 */
export function calendarMonthOutcomeOf(
  snapshot: CalendarSnapshot,
  search: CalendarSearch,
  today: string,
  marks: CalendarMarks = NO_MARKS,
): CalendarMonthOutcome {
  try {
    return { ok: true, month: calendarMonthOf(snapshot, search, today, marks) };
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
