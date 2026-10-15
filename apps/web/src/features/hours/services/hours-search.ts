import { isCalendarMonth } from '@/features/calendar/utils/month';
import {
  MONTH_SEARCH_PARAM,
  PERSON_SEARCH_PARAM,
  TEAM_SEARCH_PARAM,
  isSearchText,
  searchChangedTo,
  searchEntryOf,
} from '@/utils/search-params';

/**
 * *Sati*'s URL (stories 4.1b and 4.2): the month, and for an admin's table
 * the team, the person, the sorted column and its direction — the table's
 * vocabulary, as `sort` and `smjer` name it, and the search's parser and
 * change. A pure module (AD-15), executed by `hours-search.test.ts`.
 *
 * The month, the team and the person are named as on the calendar, and read
 * and changed by the rules both screens share (`@/utils/search-params`).
 * Whether a team, a person or a band's column names something the snapshot
 * holds is `./organization-hours`'s decision: the parser cannot see the
 * snapshot.
 */

/**
 * The search parameter naming the one team the organization's table is
 * narrowed to (story 4.2): `smjena`, as on the calendar, since story 7.5.
 */
export const HOURS_TEAM_PARAM = TEAM_SEARCH_PARAM;

/** The parameter *Sati* named the team with before story 7.5: an old URL carrying it is redirected. */
export const LEGACY_HOURS_TEAM_PARAM = 'tim';

/** The search parameter naming the one person the organization's table is narrowed to (story 4.2). */
export const HOURS_PERSON_PARAM = PERSON_SEARCH_PARAM;

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
/** The shifts in unresolved conflict (story 5.3d), sortable since the Epic 5–7 cleanup (E909). */
export const SORT_CONFLICTS = 'konflikti';

const FIXED_SORT_KEYS = [SORT_NAME, SORT_TEAM, SORT_SHIFTS, SORT_TOTAL, SORT_LEAVE, SORT_CONFLICTS] as const;

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

/** The order *Sati* writes its parameters in. */
const HOURS_SEARCH_ORDER = [
  MONTH_SEARCH_PARAM,
  HOURS_TEAM_PARAM,
  HOURS_PERSON_PARAM,
  HOURS_SORT_PARAM,
  HOURS_DIRECTION_PARAM,
] as const;

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

/**
 * The raw search as *Sati* reads it: `?mjesec=YYYY-MM`, the calendar's own
 * rule, and for an admin's table (story 4.2) `smjena`, `osoba`, `sort` and
 * `smjer`. Each invalid or missing parameter is dropped on its own — a month
 * falls back to the organization's current one, a sort to the name,
 * ascending — and every other parameter is dropped too.
 */
export function hoursSearchOf(search: Record<string, unknown>): HoursSearch {
  return {
    ...searchEntryOf(MONTH_SEARCH_PARAM, search[MONTH_SEARCH_PARAM], isCalendarMonth),
    ...searchEntryOf(HOURS_TEAM_PARAM, search[HOURS_TEAM_PARAM], isSearchText),
    ...searchEntryOf(HOURS_PERSON_PARAM, search[HOURS_PERSON_PARAM], isSearchText),
    ...searchEntryOf(HOURS_SORT_PARAM, search[HOURS_SORT_PARAM], isHoursSortKey),
    ...searchEntryOf(HOURS_DIRECTION_PARAM, search[HOURS_DIRECTION_PARAM], isHoursSortDirection),
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
  return searchChangedTo(HOURS_SEARCH_ORDER, search, change);
}
