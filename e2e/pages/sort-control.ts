import type { Locator, Page } from '@playwright/test';

import { escapeRegExp, hr } from '../utils/i18n.ts';

const sort = hr.sort;

/**
 * The phone's sort control (story 7.6), shared by *Sati* and *Ljudi*: one
 * `Poredano: {column}` button, named `Poredano: {column}, {direction}`, that
 * opens a list of the sortable columns.
 */
export function sortControlIn(page: Page): Locator {
  const prefix = sort.label.slice(0, sort.label.indexOf('{'));

  return page.getByRole('button', { name: new RegExp(`^${escapeRegExp(prefix)}`) });
}

/** The control's accessible name for a column and a direction (`uzlazno`, `silazno`). */
export function sortControlName(column: string, ascending: boolean): string {
  return sort.name
    .replace('{column}', column)
    .replace('{direction}', ascending ? sort.ascending : sort.descending);
}

/** The control's list, open. */
export function sortPickerIn(page: Page): Locator {
  return page.getByRole('dialog', { name: sort.picker, exact: true });
}

/**
 * A column in the control's list, pressed or not: the sorted one is named
 * with its direction too (`Ime, uzlazno`), its arrow being hidden.
 */
export function sortOptionIn(page: Page, label: string): Locator {
  const pressed = escapeRegExp(sort.option)
    .replace('\\{column\\}', escapeRegExp(label))
    .replace('\\{direction\\}', `(?:${escapeRegExp(sort.ascending)}|${escapeRegExp(sort.descending)})`);

  return sortPickerIn(page).getByRole('button', { name: new RegExp(`^(?:${escapeRegExp(label)}|${pressed})$`) });
}
