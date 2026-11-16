import { DEFAULT_HISTORY_PERIOD, HISTORY_PERIOD_CHOICES, historyKindOfCode } from '@shift/domain';

import { NO_TEXT } from '@/utils/text';

/**
 * *Povijest promjena*'s URL (story 14.2), as a pure module the node suite
 * executes, in `leave-overview.ts`'s style: `?razdoblje=&osoba=&smjena=&vrsta=`,
 * each absent at its default. The parameter names are Croatian because they
 * are the URL's, which a person reads.
 *
 * WHAT THE PARSER CAN SEE is a value's shape. Whether a month is one of the
 * last twelve, or an id one the period's entries name, is the screen's to say
 * once it has today and the entries; a value that is not is replaced out of
 * the URL then ({@link historySearchRewriteOf} here, the hook there).
 */

/** `/povijest-promjena`'s search. */
export type HistorySearch = {
  readonly razdoblje?: string | undefined;
  readonly osoba?: string | undefined;
  readonly smjena?: string | undefined;
  readonly vrsta?: string | undefined;
};

/** What the URL chooses: the period choice and the three chips, `null` for every. */
export interface HistorySearchFilters {
  /** One of `HISTORY_PERIOD_CHOICES` or a `YYYY-MM`. */
  readonly period: string;
  readonly member: string | null;
  readonly team: string | null;
  /** A kind code, `record:action`. */
  readonly kind: string | null;
}

const MONTH_CHOICE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whether a period value has a shape the chip can offer: a day count, or a month. */
export function isHistoryPeriodShape(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (HISTORY_PERIOD_CHOICES.some((choice) => choice === value) || MONTH_CHOICE.test(value))
  );
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value !== NO_TEXT ? value : null;
}

/** What the URL says, as filters: every value outside its shape falls back to its default. */
export function historyFiltersOf(search: Readonly<Record<string, unknown>>): HistorySearchFilters {
  // The day choices are codes (`30-dana`), never bare numbers, which the
  // router would read as JSON and write back quoted.
  const period = search['razdoblje'];
  const kind = search['vrsta'];

  return {
    period: isHistoryPeriodShape(period) ? period : DEFAULT_HISTORY_PERIOD,
    member: idOf(search['osoba']),
    team: idOf(search['smjena']),
    kind: typeof kind === 'string' && historyKindOfCode(kind) !== null ? kind : null,
  };
}

/** The URL's search for `filters`: each value at its default left out, so the defaults are `/povijest-promjena`. */
export function historySearchFor(filters: HistorySearchFilters): HistorySearch {
  return {
    ...(filters.period === DEFAULT_HISTORY_PERIOD ? {} : { razdoblje: filters.period }),
    ...(filters.member === null ? {} : { osoba: filters.member }),
    ...(filters.team === null ? {} : { smjena: filters.team }),
    ...(filters.kind === null ? {} : { vrsta: filters.kind }),
  };
}

/** The route's `validateSearch`: parsed and written back, so the route only holds what it shows. */
export function historySearchOf(search: Readonly<Record<string, unknown>>): HistorySearch {
  return historySearchFor(historyFiltersOf(search));
}

/**
 * The search a URL must be REPLACED with, or `null` when it already holds
 * only what it shows: `?razdoblje=abc`, `?vrsta=x`, a default written out or
 * a key the page does not read is rewritten out.
 */
export function historySearchRewriteOf(raw: Readonly<Record<string, unknown>>): HistorySearch | null {
  const clean = historySearchOf(raw);
  const keys = Object.keys(raw);
  const same =
    keys.length === Object.keys(clean).length &&
    keys.every((key) => (clean as Record<string, unknown>)[key] === raw[key]);

  return same ? null : clean;
}

/** The state the URL holds, as one key: the filter bar waits for it to move focus. */
export function historySearchKeyOf(search: HistorySearch): string {
  return JSON.stringify([search.razdoblje, search.osoba, search.smjena, search.vrsta].map((value) => value ?? null));
}

// ---------------------------------------------------------------- the chips

/** The four chips, in the order they are drawn. */
export const HISTORY_CHIP_PERIOD = 'period';
export const HISTORY_CHIP_MEMBER = 'member';
export const HISTORY_CHIP_TEAM = 'team';
export const HISTORY_CHIP_KIND = 'kind';

export type HistoryChipKey =
  | typeof HISTORY_CHIP_PERIOD
  | typeof HISTORY_CHIP_MEMBER
  | typeof HISTORY_CHIP_TEAM
  | typeof HISTORY_CHIP_KIND;

const HISTORY_CHIPS: readonly HistoryChipKey[] = [
  HISTORY_CHIP_PERIOD,
  HISTORY_CHIP_MEMBER,
  HISTORY_CHIP_TEAM,
  HISTORY_CHIP_KIND,
];

/** The option of the three narrowing chips that is no filter. */
export const HISTORY_ALL = 'sve';

/** The chip a key names, or `null` for none — never a cast. */
export function chooseHistoryChip(value: string): HistoryChipKey | null {
  return HISTORY_CHIPS.find((key) => key === value) ?? null;
}

/** What the pickers may choose from: the period choices and the ids the entries name. */
export interface HistoryChipOptions {
  readonly periods: readonly string[];
  readonly members: readonly string[];
  readonly teams: readonly string[];
  readonly kinds: readonly string[];
}

function chosen(value: string, options: readonly string[]): string | null {
  return value !== HISTORY_ALL && options.includes(value) ? value : null;
}

/**
 * The filters once `key`'s picker chose `value`: only from the options on
 * screen — a stale one is the default.
 */
export function historyChipChoiceOf(
  filters: HistorySearchFilters,
  key: HistoryChipKey,
  value: string,
  options: HistoryChipOptions,
): HistorySearchFilters {
  switch (key) {
    case HISTORY_CHIP_PERIOD:
      return { ...filters, period: options.periods.includes(value) ? value : DEFAULT_HISTORY_PERIOD };
    case HISTORY_CHIP_MEMBER:
      return { ...filters, member: chosen(value, options.members) };
    case HISTORY_CHIP_TEAM:
      return { ...filters, team: chosen(value, options.teams) };
    case HISTORY_CHIP_KIND:
      return { ...filters, kind: chosen(value, options.kinds) };
  }
}

/** The filters once `key`'s ✕ was pressed: that chip back to its default. */
export function historyChipRemovalOf(filters: HistorySearchFilters, key: HistoryChipKey): HistorySearchFilters {
  switch (key) {
    case HISTORY_CHIP_PERIOD:
      return { ...filters, period: DEFAULT_HISTORY_PERIOD };
    case HISTORY_CHIP_MEMBER:
      return { ...filters, member: null };
    case HISTORY_CHIP_TEAM:
      return { ...filters, team: null };
    case HISTORY_CHIP_KIND:
      return { ...filters, kind: null };
  }
}

/** Every chip back to its default: `Poništi filtre`. */
export function clearedHistoryFilters(): HistorySearchFilters {
  return { period: DEFAULT_HISTORY_PERIOD, member: null, team: null, kind: null };
}

/** Whether a chip narrows the history: `Očisti sve` is offered. */
export function historyNarrowed(filters: HistorySearchFilters): boolean {
  return (
    filters.period !== DEFAULT_HISTORY_PERIOD || filters.member !== null || filters.team !== null || filters.kind !== null
  );
}

/**
 * The filters with every value the screen cannot offer dropped to its
 * default: a period outside today's choices, an id or kind the period's
 * entries do not name. `options` `null` for a chip whose options are not
 * known yet (the entries still loading): its value is kept.
 */
export function historyFiltersOffered(
  filters: HistorySearchFilters,
  periods: readonly string[] | null,
  options: Omit<HistoryChipOptions, 'periods'> | null,
): HistorySearchFilters {
  return {
    period: periods === null || periods.includes(filters.period) ? filters.period : DEFAULT_HISTORY_PERIOD,
    member: options === null || filters.member === null ? filters.member : chosen(filters.member, options.members),
    team: options === null || filters.team === null ? filters.team : chosen(filters.team, options.teams),
    kind: options === null || filters.kind === null ? filters.kind : chosen(filters.kind, options.kinds),
  };
}

/** {@link historySearchRewriteOf} over a router location's search, whatever it holds. */
export function historyLocationRewriteOf(search: unknown): HistorySearch | null {
  return typeof search === 'object' && search !== null && !Array.isArray(search)
    ? historySearchRewriteOf(search as Record<string, unknown>)
    : null;
}
