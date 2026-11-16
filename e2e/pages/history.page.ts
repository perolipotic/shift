import type { Locator } from '@playwright/test';

import { escapeRegExp, fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const history = hr.history;

/**
 * `/povijest-promjena` (story 14.2): the admin's change history — a table of
 * *Vrijeme*, *Autor*, *Vrsta*, *Predmet* and *Bilo → sada* from 640 px,
 * stacked rows below it, the Razdoblje, Osoba, Smjena and Vrsta chips, and
 * the statement of where history begins.
 */
export class HistoryPage extends BasePage {
  readonly path = '/povijest-promjena';

  /** The table from 640 px, named by its caption. */
  get table(): Locator {
    return this.page.getByRole('table', { name: history.caption });
  }

  /** The stacked rows below 640 px, named by the same caption. */
  get stackedList(): Locator {
    return this.page.getByRole('list', { name: history.caption });
  }

  /** The table row that names `text` anywhere in it. */
  rowNaming(text: string): Locator {
    return this.table.getByRole('row').filter({ hasText: text });
  }

  /** The stacked row that names `text` anywhere in it. */
  stackedRowNaming(text: string): Locator {
    return this.stackedList.getByRole('listitem').filter({ hasText: text });
  }

  /** `record · action`, as a row's *Vrsta* says it. */
  kindText(record: string, action: string): string {
    return fill(history.kindLine, { record, action });
  }

  /** `field: before → after`, as a row's *Bilo → sada* says a change. */
  changeText(field: string, before: string, after: string): string {
    return fill(history.change, { field, before, after });
  }

  /** The statement of where history begins, whatever its date. */
  get beginsStatement(): Locator {
    const head = history.begins.slice(0, history.begins.indexOf('{'));

    return this.page.getByRole('main').getByText(new RegExp(`^${escapeRegExp(head)}`));
  }

  /** The chip bar's active chip whose text starts with `prefix` (`Smjena: `, `Vrsta: `). */
  chip(text: string): Locator {
    return this.page.getByRole('group', { name: hr.filter.label, exact: true }).getByRole('button', { name: text });
  }

  /** The offline notice that stands in place of the rows. */
  get offlineNotice(): Locator {
    return this.page.getByRole('status').filter({ hasText: history.offline });
  }

  /** The line the chips leave when they show nothing. */
  get filteredLine(): Locator {
    return this.page.getByText(history.filtered, { exact: true });
  }
}
