import type { Locator, Page } from '@playwright/test';

import { escapeRegExp, fill, hr, plural } from '../utils/i18n.ts';

const filter = hr.filter;

/** `Smjena: ` — what every Smjena chip's name starts with, chosen or `sve`. */
const TEAM_CHIP = new RegExp(`^${escapeRegExp(filter.chip.teamAll.replace(/\S+$/, ''))}`);

/** `Osoba: ` — what every Osoba chip's name starts with. */
const PERSON_CHIP = new RegExp(`^${escapeRegExp(filter.chip.personAll.replace(/\S+$/, ''))}`);

/** `Prikazano:` — what every summary starts with. */
const SUMMARY = new RegExp(`^${escapeRegExp(filter.summary.all.split(' ')[0] ?? '')}`);

/** `Sve smjene` — the Smjena picker's first option, whatever it counts. */
const ALL_TEAMS = new RegExp(`^${escapeRegExp(filter.allTeams.replace(/ \(\{count\}\)$/, ''))}`);

/** `Filtri` or `Filtri · 2`. */
const FILTRI = new RegExp(`^${escapeRegExp(filter.open)}(?: · \\d+)?$`);

/**
 * An ICU message with simple `{name}` placeholders and at most one plural
 * argument named `countName`, filled the way the app fills it: the
 * placeholders by `fill`, the plural through `plural` for `count`.
 */
export function filterText(
  message: string,
  values: Readonly<Record<string, string>>,
  plural_?: { readonly name: string; readonly count: number },
): string {
  const filled = fill(message, values);

  return plural_ === undefined ? filled : plural(filled.replace(`{${plural_.name}, plural,`, '{count, plural,'), plural_.count);
}

/**
 * A pattern for an ICU message whatever its number(s): every form the app can
 * render (Croatian one, few and other), each number read as any number.
 */
function anyCountOf(message: string, values: Readonly<Record<string, string>> = {}): RegExp {
  const forms = [1, 2, 5].map((count) =>
    escapeRegExp(filterText(message, values, { name: 'count', count })).replace(/\d+/g, '\\d+'),
  );

  return new RegExp(`^(?:${forms.join('|')})$`);
}

/**
 * THE SHARED FILTER BAR'S LOCATORS (story 7.5): the one bar *Kalendar*'s
 * *Sve smjene* and *Sati*'s organization table both render — two chips, their
 * ✕, the pickers, the summary line, `Poništi filtre`, and below 640 px
 * `Filtri` and its sheet. Locators and actions only, never an assertion
 * (`e2e/README.md`).
 */
export class FilterBarParts {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** The chips' group, named `Filtri`. */
  get bar(): Locator {
    return this.page.getByRole('group', { name: filter.label, exact: true });
  }

  /**
   * The bar's last control drawn — the Osoba chip from 640 px, `Filtri` on a
   * phone with no filter on: the one before the grid in tab order.
   */
  get lastControl(): Locator {
    return this.bar.getByRole('button').filter({ visible: true }).last();
  }

  /** The Smjena chip, whatever it reads. */
  get teamChip(): Locator {
    return this.bar.getByRole('button', { name: TEAM_CHIP });
  }

  /** The Osoba chip, whatever it reads. */
  get personChip(): Locator {
    return this.bar.getByRole('button', { name: PERSON_CHIP });
  }

  /** The Smjena chip's text for `team`, or `Smjena: sve`. */
  teamChipText(team: string | null): string {
    return team === null ? filter.chip.teamAll : fill(filter.chip.team, { value: team });
  }

  /** The Osoba chip's text for `person`, or `Osoba: sve`. */
  personChipText(person: string | null): string {
    return person === null ? filter.chip.personAll : fill(filter.chip.person, { value: person });
  }

  /** The Smjena chip's ✕ while `team` is chosen. */
  removeTeam(team: string): Locator {
    return this.page.getByRole('button', { name: fill(filter.remove.team, { value: team }), exact: true });
  }

  /** The Osoba chip's ✕ while `person` is chosen. */
  removePerson(person: string): Locator {
    return this.page.getByRole('button', { name: fill(filter.remove.person, { value: person }), exact: true });
  }

  /** The summary line: `Prikazano: …`. */
  get summary(): Locator {
    return this.page.getByRole('status').filter({ hasText: SUMMARY });
  }

  /** The summary's `Poništi filtre`, the first one on the page (the bar precedes the content). */
  get clearButton(): Locator {
    return this.page.getByRole('button', { name: filter.clear, exact: true }).first();
  }

  /** The Smjena picker, open. */
  get teamPicker(): Locator {
    return this.page.getByRole('dialog', { name: filter.teamPicker, exact: true });
  }

  /** The Osoba picker, open. */
  get personPicker(): Locator {
    return this.page.getByRole('dialog', { name: filter.personPicker, exact: true });
  }

  /** `Sve smjene (4)` in the Smjena picker. */
  allTeamsOption(count: number): Locator {
    return this.teamPicker.getByRole('button', { name: fill(filter.allTeams, { count: String(count) }), exact: true });
  }

  /** A team in the Smjena picker: its name, then its person count. */
  teamOption(team: string): Locator {
    return this.teamPicker.getByRole('button', { name: new RegExp(`^${escapeRegExp(team)}\\s*\\d`) });
  }

  /** Every team in the Smjena picker. */
  get teamOptions(): Locator {
    return this.teamPicker.getByRole('button').filter({ hasNotText: ALL_TEAMS });
  }

  /** The Osoba picker's search, `Traži osobu (17)`, wherever it is drawn (picker or sheet). */
  get personSearch(): Locator {
    return this.page.getByRole('searchbox', { name: new RegExp(`^${escapeRegExp(filter.search.replace(/ \(\{count\}\)$/, ''))}`) });
  }

  /** `1 od 17`, under the search. */
  matches(shown: number, total: number): Locator {
    return this.page.getByText(fill(filter.matches, { shown: String(shown), total: String(total) }), { exact: true });
  }

  /** `{shown} od {any}`, under the search, whatever the total. */
  matchesOf(shown: number): Locator {
    const pattern = escapeRegExp(fill(filter.matches, { shown: String(shown), total: '\u0000' })).replace('\u0000', '\\d+');

    return this.page.getByText(new RegExp(`^${pattern}$`));
  }

  /** The summary line's text for `message`, filled. */
  summaryText(
    message: string,
    values: Readonly<Record<string, string>>,
    count?: { readonly name: string; readonly count: number },
  ): string {
    return filterText(message, values, count);
  }

  /** A person in the Osoba picker. */
  personOption(person: string): Locator {
    return this.personPicker.getByRole('button', { name: person, exact: true });
  }

  /** A group heading in the Osoba picker: a team's name, or `Bez smjene`. */
  personGroup(name: string): Locator {
    return this.personPicker.getByText(name, { exact: true });
  }

  /** Opens the Smjena picker and chooses `team`. */
  async chooseTeam(team: string): Promise<void> {
    await this.teamChip.click();
    await this.teamOption(team).click();
  }

  /** Opens the Osoba picker and chooses `person`. */
  async choosePerson(person: string): Promise<void> {
    await this.personChip.click();
    await this.personOption(person).click();
  }

  // ---------------------------------------------------------- phone sheet

  /** `Filtri` or `Filtri · N`, below 640 px. */
  get filtriButton(): Locator {
    return this.bar.getByRole('button', { name: FILTRI });
  }

  /** The phone's filter sheet. */
  get sheet(): Locator {
    return this.page.getByRole('dialog', { name: filter.sheetTitle, exact: true });
  }

  /** A team's radio in the sheet. */
  sheetTeam(team: string): Locator {
    return this.sheet.getByRole('radio', { name: new RegExp(`^${escapeRegExp(team)}\\s*\\d`) });
  }

  /** A person in the sheet's Osoba list. */
  sheetPerson(person: string): Locator {
    return this.sheet.getByRole('button', { name: person, exact: true });
  }

  /** `Prikaži {n} osoba`, whatever it counts. */
  get sheetShowAny(): Locator {
    return this.sheet.getByRole('button', { name: anyCountOf(filter.sheetShow) });
  }

  /** `Prikaži {n} osoba`, live. */
  sheetShow(count: number): Locator {
    return this.sheet.getByRole('button', { name: plural(filter.sheetShow, count), exact: true });
  }

  /** The sheet's `Poništi`. */
  get sheetReset(): Locator {
    return this.sheet.getByRole('button', { name: filter.sheetReset, exact: true });
  }

  /** The sheet's note that a person replaces the team (Kalendar). */
  get replaceNote(): Locator {
    return this.sheet.getByText(filter.replaceNote, { exact: true });
  }
}
