/**
 * THE URL SEARCH RULES *Kalendar* AND *Sati* SHARE (Epic 4 retro, D1), as a
 * pure module (AD-15) the node suite executes: the parameters both screens
 * name alike, how a parameter is read — kept when valid, dropped on its own
 * when not — and how a change is applied to a search.
 *
 * Each screen keeps its own vocabulary — the calendar's `prikaz`, the hours
 * table's `sort` and `smjer` — and its own parser built from these parts:
 * `calendarSearchOf` and `hoursSearchOf`. The parameter names are Croatian
 * because they are the URL's, which a person reads.
 */

/** The month shown, `?mjesec=YYYY-MM`. */
export const MONTH_SEARCH_PARAM = 'mjesec';

/** The team a screen is narrowed to, `?smjena=<team id>` (the calendar's name, *Sati*'s since story 7.5). */
export const TEAM_SEARCH_PARAM = 'smjena';

/** The person a screen is narrowed to, `?osoba=<member id>`. */
export const PERSON_SEARCH_PARAM = 'osoba';

/**
 * Whether a parameter is a non-empty text: the shape of an id the snapshot
 * may or may not name. WHETHER it names something is the screen's decision,
 * never the parser's: the parser cannot see the snapshot.
 */
export function isSearchText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * One parameter as a search entry: `{ [key]: value }` when `valid` accepts
 * it, and nothing otherwise — so each invalid or missing parameter is
 * dropped on its own, and spreading the entries builds the search.
 */
export function searchEntryOf<K extends string, V>(
  key: K,
  value: unknown,
  valid: (value: unknown) => value is V,
): { readonly [P in K]?: V } {
  return valid(value) ? ({ [key]: value } as { readonly [P in K]?: V }) : {};
}

/** A change of some parameters of a search: a value replaces, `null` drops. */
export type SearchChange<S> = { readonly [K in keyof S]?: Exclude<S[K], undefined> | null };

/**
 * The search to navigate to: every parameter `change` names applied — `null`
 * dropping it — and every other one `search` names kept, written in `order`
 * so the URL reads the same however it was reached. A parameter the viewer
 * never chose is never written in.
 */
export function searchChangedTo<S extends object>(
  order: readonly (keyof S & string)[],
  search: S,
  change: SearchChange<S>,
): S {
  const next: Record<string, unknown> = {};

  for (const key of order) {
    const value: unknown = key in change ? change[key] : search[key];

    if (value !== null && value !== undefined) next[key] = value;
  }

  return next as S;
}
