/**
 * THE FILTER BAR'S MODEL (story 7.5), shared by *Kalendar* and *Sati*: the
 * two chips, the summary line, the pickers' options and what each press
 * changes, as a pure module (AD-15) the node suite executes.
 *
 * Each screen builds its model from its own month — `calendarFilterBarOf`
 * and `hoursFilterBarOf` — and the one component, `@/components/filter-bar`,
 * draws it. THE TWO SCREENS DIFFER IN ONE RULE, which lives here and never in
 * the component: in *Kalendar* a person REPLACES the team (story 3.3b), and
 * in *Sati* the two filters COMBINE (story 4.2). `combine` names which.
 *
 * Every name here is data (a team, a person) and is never declined. The copy
 * is the component's, through `t()`.
 */

/**
 * The team filter's chip, written to the URL as `?smjena=<team id>`. Named in
 * English, as code: the built chunk carries it, and a Croatian word there
 * would read as hard-coded copy.
 */
export const FILTER_TEAM = 'team';

/** The person filter's chip, written to the URL as `?osoba=<member id>`. */
export const FILTER_PERSON = 'person';

export type FilterKey = typeof FILTER_TEAM | typeof FILTER_PERSON;

/** A team the Smjena picker offers, with how many people it holds for the month. */
export interface FilterTeamOption {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

/** A person the Osoba picker offers, with their team for the month (`null`: none). */
export interface FilterPersonOption {
  readonly id: string;
  readonly name: string;
  readonly teamId: string | null;
  /** That team's name as stored, archived or not; `null` with no team. */
  readonly teamName: string | null;
}

/** One chip: its key, and the chosen option's name, or `null` for `sve`. */
export interface FilterChip {
  readonly key: FilterKey;
  readonly value: string | null;
}

/** What the summary line says is shown: the operands of `filter.summary.*`. */
export type FilterSummary =
  | { readonly kind: 'all'; readonly teams: number; readonly people: number }
  | { readonly kind: 'team'; readonly team: string; readonly shown: number; readonly total: number }
  | { readonly kind: 'person'; readonly person: string; readonly team: string | null }
  | { readonly kind: 'both'; readonly team: string; readonly person: string; readonly shown: number };

/** The bar, ready to draw. */
export interface FilterBarModel {
  /** `true` in *Sati*: the team and the person combine. `false` in *Kalendar*: a person replaces the team. */
  readonly combine: boolean;
  /** The chips drawn, in order: Smjena, then Osoba — in *Kalendar*, Osoba alone while a person is chosen. */
  readonly chips: readonly FilterChip[];
  /** The Smjena picker's options, in the screen's team order. */
  readonly teams: readonly FilterTeamOption[];
  /** The team chosen, one of `teams`; `null` for every team. */
  readonly team: string | null;
  /** The Osoba picker's options, in name order. */
  readonly people: readonly FilterPersonOption[];
  /** The person chosen, one of `people`; `null` for everybody. */
  readonly person: string | null;
  readonly summary: FilterSummary;
  /** How many filters are on: 0, 1 or 2. */
  readonly activeCount: number;
  /** How many people the screen shows under the filters: the sheet's `Prikaži {n} osoba`. */
  readonly shownCount: number;
}

/** The search change a press makes: the team and the person, BOTH ALWAYS PRESENT; `null` drops either. */
export interface FilterChange {
  readonly smjena: string | null;
  readonly osoba: string | null;
}

/** What a screen hands the builder: its rule, its options, what is chosen and what is shown. */
export interface FilterBarInput {
  readonly combine: boolean;
  readonly teams: readonly FilterTeamOption[];
  readonly team: string | null;
  readonly people: readonly FilterPersonOption[];
  readonly person: string | null;
  readonly shownCount: number;
}

/**
 * The bar for what a screen shows. `team` and `person` must be ids of
 * `teams` and `people` — the screens resolve a stale id to `null` first — and
 * in *Kalendar* (`combine: false`) at most one is set.
 */
export function filterBarOf({ combine, teams, team, people, person, shownCount }: FilterBarInput): FilterBarModel {
  const chosenTeam = teams.find((one) => one.id === team) ?? null;
  const chosenPerson = people.find((one) => one.id === person) ?? null;
  const teamChip: FilterChip = { key: FILTER_TEAM, value: chosenTeam?.name ?? null };
  const personChip: FilterChip = { key: FILTER_PERSON, value: chosenPerson?.name ?? null };
  const chips = !combine && chosenPerson !== null ? [personChip] : [teamChip, personChip];

  return {
    combine,
    chips,
    teams,
    team: chosenTeam?.id ?? null,
    people,
    person: chosenPerson?.id ?? null,
    summary: summaryOf(chosenTeam, chosenPerson, teams.length, people.length, shownCount),
    activeCount: (chosenTeam === null ? 0 : 1) + (chosenPerson === null ? 0 : 1),
    shownCount,
  };
}

function summaryOf(
  team: FilterTeamOption | null,
  person: FilterPersonOption | null,
  teamTotal: number,
  peopleTotal: number,
  shown: number,
): FilterSummary {
  if (team !== null && person !== null) return { kind: 'both', team: team.name, person: person.name, shown };
  if (person !== null) return { kind: 'person', person: person.name, team: person.teamName };
  if (team !== null) return { kind: 'team', team: team.name, shown, total: peopleTotal };

  return { kind: 'all', teams: teamTotal, people: peopleTotal };
}

/** The summary line's message. */
export function filterSummaryMessageKey(
  summary: FilterSummary,
):
  | 'filter.summary.all'
  | 'filter.summary.team'
  | 'filter.summary.person'
  | 'filter.summary.personNoTeam'
  | 'filter.summary.both' {
  switch (summary.kind) {
    case 'all':
      return 'filter.summary.all';
    case 'team':
      return 'filter.summary.team';
    case 'person':
      return summary.team === null ? 'filter.summary.personNoTeam' : 'filter.summary.person';
    case 'both':
      return 'filter.summary.both';
  }
}

/** The summary line's operands: the summary itself, less its kind. */
export function filterSummaryValuesOf(summary: FilterSummary): Readonly<Record<string, string | number | null>> {
  const { kind: _kind, ...values } = summary;

  return values;
}

/** A chip's text: `Smjena: Smjena B`, or `Smjena: sve` with nothing chosen. */
export function filterChipMessageKey(
  chip: FilterChip,
): 'filter.chip.team' | 'filter.chip.teamAll' | 'filter.chip.person' | 'filter.chip.personAll' {
  if (chip.key === FILTER_TEAM) return chip.value === null ? 'filter.chip.teamAll' : 'filter.chip.team';

  return chip.value === null ? 'filter.chip.personAll' : 'filter.chip.person';
}

/** A chip's ✕, named for what it removes: `Ukloni filtar smjena: Smjena B`. */
export function filterRemoveMessageKey(chip: FilterChip): 'filter.remove.team' | 'filter.remove.person' {
  return chip.key === FILTER_TEAM ? 'filter.remove.team' : 'filter.remove.person';
}

/** Whether any filter is on: the summary's `Poništi filtre` shows only then. */
export function hasActiveFilter(model: FilterBarModel): boolean {
  return model.activeCount > 0;
}

/**
 * What choosing `id` in `key`'s picker changes (`null`: `sve`). In *Sati* the
 * other filter is kept. In *Kalendar* a team — `sve` included — drops the
 * person, and a person drops the team (story 3.3b).
 */
export function filterChoiceOf(model: FilterBarModel, key: FilterKey, id: string | null): FilterChange {
  if (key === FILTER_TEAM) return { smjena: id, osoba: model.combine ? model.person : null };

  return { smjena: model.combine || id === null ? model.team : null, osoba: id };
}

/** What a chip's ✕ changes: that filter dropped, the other kept. */
export function filterRemovalOf(model: FilterBarModel, key: FilterKey): FilterChange {
  return key === FILTER_TEAM ? { smjena: null, osoba: model.person } : { smjena: model.team, osoba: null };
}

/** The Smjena radio group's value for every team: no team id is ever `*`. */
export const ALL_TEAMS_OPTION = '*';

/** The Smjena radio group's value while *Kalendar* shows a person: no option at all reads chosen. */
export const NO_TEAM_OPTION = '';

/** The radio value the phone sheet's Smjena choice reads: the team, every team, or — a person replacing the team — none. */
export function teamOptionOf(model: FilterBarModel): string {
  if (model.team !== null) return model.team;

  return !model.combine && model.person !== null ? NO_TEAM_OPTION : ALL_TEAMS_OPTION;
}

/** What choosing a radio value of the phone sheet's Smjena choice changes. */
export function teamOptionChoiceOf(model: FilterBarModel, value: string): FilterChange {
  return filterChoiceOf(model, FILTER_TEAM, value === ALL_TEAMS_OPTION || value === NO_TEAM_OPTION ? null : value);
}

/** The Osoba search as it opens: empty, so every person is listed. */
export const NO_SEARCH = '';

/** Whether a key in the Osoba search enters the list below it: ↓. */
export function entersPickerList(key: string): boolean {
  return key === 'ArrowDown';
}

/**
 * What a change leaves chosen, as one key: the bar waits for the model to
 * read it before it moves focus (story 7.5), so focus lands on what the
 * re-render draws, never on a chip it is about to hide or bring back.
 */
export function filterStateKeyOf(change: FilterChange): string {
  return `${change.smjena ?? NO_SEARCH}|${change.osoba ?? NO_SEARCH}`;
}

/** What the model shows chosen, as {@link filterStateKeyOf} reads a change. */
export function modelStateKeyOf(model: FilterBarModel): string {
  return filterStateKeyOf({ smjena: model.team, osoba: model.person });
}

/** `Poništi filtre`: both dropped. */
export const FILTERS_CLEARED: FilterChange = { smjena: null, osoba: null };

/**
 * Where focus goes after a chip's ✕: the chip after it, or else the first
 * chip — Smjena, which is drawn again whenever the person is gone. The
 * component falls back to `Filtri` where that chip is not drawn (a phone shows
 * only active chips).
 */
export function focusAfterRemovalOf(model: FilterBarModel, key: FilterKey): FilterKey {
  const index = model.chips.findIndex((chip) => chip.key === key);

  return model.chips[index + 1]?.key ?? FILTER_TEAM;
}

/**
 * Lower case, with the diacritics folded: `Knežević` is found by `knezevic`,
 * and `đ` and `dj` read alike, so `Đuro` is found by `djuro` and by `duro`.
 */
function folded(text: string): string {
  return text
    .toLocaleLowerCase('hr')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/dj/g, 'd');
}

/** The people whose name holds `query`, trimmed, case and diacritics ignored; all of them for none. */
export function peopleMatching(people: readonly FilterPersonOption[], query: string): readonly FilterPersonOption[] {
  const wanted = folded(query.trim());

  return wanted === '' ? people : people.filter((person) => folded(person.name).includes(wanted));
}

/** One group of the Osoba picker: a team's people, or the people on none (`teamName: null`, `Bez smjene`). */
export interface FilterPersonGroup {
  readonly teamId: string | null;
  readonly teamName: string | null;
  readonly people: readonly FilterPersonOption[];
}

/**
 * `people` grouped by their team for the month: the teams in the Smjena
 * picker's order, then any other team (an archived one) by first appearance,
 * then `Bez smjene`. A group with nobody in it is not drawn; within a group
 * the people keep their order.
 */
export function peopleGroupsOf(
  people: readonly FilterPersonOption[],
  teams: readonly FilterTeamOption[],
): readonly FilterPersonGroup[] {
  const order = new Map(teams.map((team, index) => [team.id, index]));
  const groups = new Map<string | null, { teamName: string | null; people: FilterPersonOption[] }>();

  for (const person of people) {
    const group = groups.get(person.teamId);

    if (group === undefined) groups.set(person.teamId, { teamName: person.teamName, people: [person] });
    else group.people.push(person);
  }

  const rank = (teamId: string | null, appearance: number): number =>
    teamId === null ? Number.MAX_SAFE_INTEGER : (order.get(teamId) ?? teams.length + appearance);

  return [...groups.entries()]
    .map(([teamId, group], appearance) => ({ teamId, ...group, rank: rank(teamId, appearance) }))
    .sort((first, second) => first.rank - second.rank)
    .map(({ teamId, teamName, people: members }) => ({ teamId, teamName, people: members }));
}

/**
 * The option a key moves to in a picker's list of `count` options, from
 * `index`: ↓ and ↑ by one, stopping at the ends, Home and End to them;
 * `null` for any other key, which the list leaves alone.
 */
export function pickerIndexAfter(key: string, index: number, count: number): number | null {
  if (count === 0) return null;

  switch (key) {
    case 'ArrowDown':
      return Math.min(index + 1, count - 1);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * `u listopadu` for `2026-10`: the month in the locative, which a sentence
 * about a month reads (`… nije u smjeni Smjena B u listopadu 2026.`).
 *
 * @throws RangeError for a value that is not `YYYY-MM`.
 */
export function monthInMessageKey(
  month: string,
):
  | 'filter.monthIn.1'
  | 'filter.monthIn.2'
  | 'filter.monthIn.3'
  | 'filter.monthIn.4'
  | 'filter.monthIn.5'
  | 'filter.monthIn.6'
  | 'filter.monthIn.7'
  | 'filter.monthIn.8'
  | 'filter.monthIn.9'
  | 'filter.monthIn.10'
  | 'filter.monthIn.11'
  | 'filter.monthIn.12' {
  const keys = [
    'filter.monthIn.1',
    'filter.monthIn.2',
    'filter.monthIn.3',
    'filter.monthIn.4',
    'filter.monthIn.5',
    'filter.monthIn.6',
    'filter.monthIn.7',
    'filter.monthIn.8',
    'filter.monthIn.9',
    'filter.monthIn.10',
    'filter.monthIn.11',
    'filter.monthIn.12',
  ] as const;
  const key = /^\d{4}-(\d{2})$/.test(month) ? keys[Number(month.slice(5, 7)) - 1] : undefined;

  if (key === undefined) throw new RangeError(`${month} is not a month`);

  return key;
}

/** `2026` for `2026-10`: the year a month sentence reads. */
export function yearOfMonthText(month: string): string {
  return month.slice(0, 4);
}
