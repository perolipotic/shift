import type { Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';
import { sortControlIn, sortOptionIn, sortPickerIn } from './sort-control.ts';

const godisnji = hr.godisnji;
const overview = hr.godisnji.overview;

/**
 * `/godisnji`: the viewer's own leave (story 5.2c) — three tiles, the
 * allowance, the days used in the current leave year and the balance — or,
 * in their place, the failure with its retry, or the viewer's own line when
 * they have never been on a team.
 *
 * Since story 7.15 an admin's `/godisnji` is the overview instead: every
 * member active today as a table row from 640 px, a stacked row below it.
 */
export class LeavePage extends BasePage {
  protected readonly path = '/godisnji';

  /** The tile a label heads: its label and its figure. */
  private tile(label: string): Locator {
    return this.page.getByText(label, { exact: true }).locator('xpath=..');
  }

  /** The figure of the tile a label heads, its second paragraph. */
  private tileValue(label: string): Locator {
    return this.tile(label).locator('p').nth(1);
  }

  /** The allowance's figure. */
  get allowanceFigure(): Locator {
    return this.tileValue(godisnji.allowance);
  }

  /** The figure of the days used in the current leave year. */
  get usedFigure(): Locator {
    return this.tileValue(godisnji.used);
  }

  /** The balance's figure. */
  get balanceFigure(): Locator {
    return this.tileValue(godisnji.balance);
  }

  /** The retry the unavailable alert offers. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: godisnji.retry, exact: true });
  }

  // ------------------------------------------------- the admin's overview (7.15)

  /** The overview's table from 640 px, named by its caption. */
  get overviewTable(): Locator {
    return this.page.getByRole('table', { name: overview.caption, exact: true });
  }

  /** The overview's stacked rows below 640 px, named by the same caption. */
  get overviewList(): Locator {
    return this.page.getByRole('list', { name: overview.caption, exact: true });
  }

  /** *Traži osobu*. */
  get overviewSearch(): Locator {
    return this.page.getByRole('searchbox', { name: overview.search, exact: true });
  }

  /** *Poništi pretragu*, in place of the rows when the search matches nobody. */
  get clearSearchButton(): Locator {
    return this.page.getByRole('button', { name: overview.clear, exact: true });
  }

  /** The table row of the member named `name`. */
  tableRow(name: string): Locator {
    return this.overviewTable
      .getByRole('row')
      .filter({ has: this.page.getByRole('link', { name, exact: true }) });
  }

  /** The table row's cells, in column order: Osoba, Smjena, Pravo, Iskorišteno, Preostalo. */
  tableCells(name: string): Locator {
    return this.tableRow(name).getByRole('cell');
  }

  /** The stacked row of the member named `name`. */
  stackedRow(name: string): Locator {
    return this.overviewList
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('link', { name, exact: true }) });
  }

  /** A labelled figure of a stacked row: the definition its term names. */
  stackedFigure(name: string, label: string): Locator {
    return this.stackedRow(name)
      .locator('dl > div')
      .filter({ has: this.page.getByRole('term').getByText(label, { exact: true }) })
      .getByRole('definition');
  }

  /** A sortable heading's button. */
  sortHeading(label: string): Locator {
    return this.columnHeader(label).getByRole('button');
  }

  /** The phone's one `Poredano` control. */
  get sortControl(): Locator {
    return sortControlIn(this.page);
  }

  /** A sortable column header cell, which carries `aria-sort`. */
  columnHeader(label: string): Locator {
    return this.overviewTable.getByRole('columnheader', { name: label });
  }

  /** The phone sort control's list, open. */
  get sortPicker(): Locator {
    return sortPickerIn(this.page);
  }

  /** A column in the phone sort control's list. */
  sortOption(label: string): Locator {
    return sortOptionIn(this.page, label);
  }

  /** The overview's unavailable alert. */
  get overviewUnavailable(): Locator {
    return this.alertWith(godisnji.unavailable);
  }
}
