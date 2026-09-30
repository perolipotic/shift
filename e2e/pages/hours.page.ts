import type { Locator } from '@playwright/test';

import { escapeRegExp, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const kalendar = hr.kalendar;
const sati = hr.sati;
const organization = hr.sati.organization;

/**
 * `/sati`: the viewer's own month of hours (story 4.1b) — the month
 * navigation it shares with the calendar, the total and the shift count, a
 * row per band, the leave row and the failure — and for an admin, every
 * member's month in one table (story 4.2), its filters and sortable headings.
 */
export class HoursPage extends BasePage {
  protected readonly path = '/sati';

  /** The month's heading (h2). */
  monthHeading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', { level: 2, name });
  }

  get nextButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.next });
  }

  /** `Ovaj mjesec`. */
  get currentButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.current, exact: true });
  }

  /** The tile a summary label heads: its label and its figure. */
  private tile(label: string): Locator {
    return this.page.getByText(label, { exact: true }).locator('xpath=..');
  }

  /** The month's total hours, with its label. */
  get totalTile(): Locator {
    return this.tile(sati.total);
  }

  /** The month's shift count, with its label. */
  get shiftsTile(): Locator {
    return this.tile(sati.shifts);
  }

  /** The list of band rows, named by its heading. */
  get bandsList(): Locator {
    return this.page.getByRole('list', { name: sati.bands, exact: true });
  }

  /** Every band's row, in band order. */
  get bandRows(): Locator {
    return this.bandsList.getByRole('listitem');
  }

  /** One band's row, its name matched whole: `Dan` never matches `Danas`. */
  bandRow(name: string): Locator {
    return this.bandRows.filter({ has: this.page.getByText(name, { exact: true }) });
  }

  /** Every band row's hours as it reads (`12 h`), in band order. */
  async bandHours(): Promise<string[]> {
    // The hours are each row's first figure, drawn semibold beside the name.
    return this.bandRows.locator('span.font-semibold').allTextContents();
  }

  /** The note on the shifts with no times, whatever its count: any of its plural forms. */
  get untimedNote(): Locator {
    const forms = [...sati.untimed.matchAll(/\{# ([^{}]+)\}/g)].map((found) => escapeRegExp(found[1] ?? ''));

    return this.page.getByText(new RegExp(`^\\d+ (?:${forms.join('|')})$`));
  }

  /** The leave row, apart from the bands. */
  get leaveRow(): Locator {
    return this.tile(sati.leave);
  }

  /** A figure inside a tile or a row, matched whole. */
  figureIn(scope: Locator, text: string): Locator {
    return scope.getByText(text, { exact: true });
  }

  // ------------------------------------------------ the organization table

  /** The admin's table, named by its caption (`Sati svih osoba: Rujan 2026`), whatever the month. */
  get organizationTable(): Locator {
    const prefix = organization.caption.slice(0, organization.caption.indexOf('{'));

    return this.page.getByRole('table', { name: new RegExp(`^${escapeRegExp(prefix)}`) });
  }

  /** Every body row of the table (the heading row excluded). */
  get organizationRows(): Locator {
    return this.organizationTable.locator('tbody').getByRole('row');
  }

  /** A member's row, found by the link their name is. */
  organizationRow(name: string): Locator {
    return this.organizationRows.filter({ has: this.page.getByRole('link', { name, exact: true }) });
  }

  /** A tile's figure, the text shown under its label. */
  tileValue(label: string): Locator {
    return this.tile(label).locator('p').nth(1);
  }

  /** Every band row's name, as the member's screen shows it, in band order. */
  get bandNames(): Locator {
    return this.bandRows.locator('span.font-medium');
  }

  /** Every band row's hours (`12 h`), in band order. */
  get bandHourFigures(): Locator {
    return this.bandRows.locator('span.font-semibold');
  }

  /** Every band row's shift count (`7 smjena`), in band order. */
  get bandShiftFigures(): Locator {
    return this.bandRows.locator('span.text-xs');
  }

  /** Every heading cell of the table, in column order. */
  get columnHeaders(): Locator {
    return this.organizationTable.getByRole('columnheader');
  }

  /** A band cell's hours. */
  bandCellHours(cell: Locator): Locator {
    return cell.locator('span.font-semibold');
  }

  /** A band cell's shift count. */
  bandCellShifts(cell: Locator): Locator {
    return cell.locator('span.text-xs');
  }

  /** The option a filter shows as chosen. */
  chosenOption(filter: Locator): Locator {
    return filter.locator('option:checked');
  }

  /** The link a member's name is, in the table. */
  memberLink(name: string): Locator {
    return this.organizationTable.getByRole('link', { name, exact: true });
  }

  /** A heading cell, by its label: `aria-sort` is on it. */
  columnHeader(label: string): Locator {
    return this.organizationTable.getByRole('columnheader', { name: label, exact: true });
  }

  /** The button that sorts by a heading. */
  sortButton(label: string): Locator {
    return this.columnHeader(label).getByRole('button');
  }

  /** The team filter's native select. */
  get teamFilter(): Locator {
    return this.page.getByRole('combobox', { name: organization.teamFilter, exact: true });
  }

  /** The person filter's native select. */
  get personFilter(): Locator {
    return this.page.getByRole('combobox', { name: organization.personFilter, exact: true });
  }

  /** The index of a heading among the table's headings, for reading its column. */
  async columnIndex(label: string): Promise<number> {
    const labels = (await this.organizationTable.getByRole('columnheader').allTextContents()).map((text) =>
      text.trim(),
    );
    const index = labels.indexOf(label);

    if (index === -1) throw new Error(`E2E: no column ${label} in ${labels.join(', ')}`);

    return index;
  }

  /** One cell of a row, by its heading. */
  async cellIn(row: Locator, label: string): Promise<Locator> {
    return row.getByRole('cell').nth(await this.columnIndex(label));
  }

  /** A column's text, row by row, as shown. */
  async columnTexts(label: string): Promise<string[]> {
    const index = await this.columnIndex(label);
    const rows = await this.organizationRows.all();

    return Promise.all(rows.map(async (row) => ((await row.getByRole('cell').nth(index).textContent()) ?? '').trim()));
  }
}
