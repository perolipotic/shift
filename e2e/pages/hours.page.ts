import type { Download, Locator } from '@playwright/test';

import { MONTH_TRIGGER_NAME, escapeRegExp, fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';
import { FilterBarParts } from './filter-bar.ts';
import { sortControlIn, sortOptionIn, sortPickerIn } from './sort-control.ts';

const kalendar = hr.kalendar;
const sati = hr.sati;
const organization = hr.sati.organization;

/**
 * `/sati`: the viewer's own month of hours (story 4.1b) — the month
 * navigation it shares with the calendar, the total and the shift count, a
 * row per band, the leave row and the failure — and for an admin, every
 * member's month in one table (story 4.2), its filters and sortable headings,
 * and its export (story 4.3). Since story 5.3d, the shifts in unresolved
 * conflict: the viewer's own line, the table's column, and the unavailable
 * message's retry.
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

  /** `Ovaj mjesec`, drawn only off the current month (story 7.4). */
  get currentButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.current, exact: true });
  }

  /** The shared month toolbar's trigger (story 7.4). */
  get monthTrigger(): Locator {
    return this.page.getByRole('group', { name: kalendar.month, exact: true }).getByRole('button', { name: MONTH_TRIGGER_NAME });
  }

  /** The "ovaj mjesec" label inside the trigger on the current month. */
  get thisMonthLabel(): Locator {
    return this.monthTrigger.getByText(kalendar.thisMonthLabel, { exact: true });
  }

  /** The month picker, open (story 7.4). */
  get monthPicker(): Locator {
    return this.page.getByRole('dialog', { name: kalendar.monthPicker, exact: true });
  }

  /** A month button in the picker, by its accessible name, `Ožujak 2025`. */
  pickerMonth(heading: string): Locator {
    return this.monthPicker.getByRole('button', { name: new RegExp(`^${escapeRegExp(heading)}(?:, |$)`) });
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

  /** The line of the viewer's shifts in unresolved conflict, whatever its count: any of its plural forms. */
  get conflictsLine(): Locator {
    const forms = [...sati.conflicts.matchAll(/\{# ([^{}]+)\}/g)].map((found) => escapeRegExp(found[1] ?? ''));

    return this.page.getByText(new RegExp(`^\\d+ (?:${forms.join('|')})$`));
  }

  /** The one message a refused read shows (`Sate trenutačno nije moguće učitati…`). */
  get unavailableAlert(): Locator {
    return this.alertWith(sati.error.unavailable);
  }

  /** The unavailable message's retry (story 5.3d), which reads the snapshot and the leave again. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: sati.retry, exact: true });
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

  // ------------------------------------- the stacked rows below 640 px (7.6)

  /** The admin's month as stacked rows on a phone: the list named by the table's caption. */
  get organizationList(): Locator {
    const prefix = organization.caption.slice(0, organization.caption.indexOf('{'));

    return this.page.getByRole('list', { name: new RegExp(`^${escapeRegExp(prefix)}`) });
  }

  /** Every stacked row, in list order. */
  get organizationListRows(): Locator {
    return this.organizationList.getByRole('listitem');
  }

  /** A member's stacked row, found by the link their name is. */
  organizationListRow(name: string): Locator {
    return this.organizationListRows.filter({ has: this.page.getByRole('link', { name, exact: true }) });
  }

  /** The link a member's name is, in the stacked rows. */
  listMemberLink(name: string): Locator {
    return this.organizationList.getByRole('link', { name, exact: true });
  }

  /** Every stacked row's name, in list order. */
  get listedNames(): Locator {
    return this.organizationListRows.getByRole('link');
  }

  /** A stacked row's label (`dt`), matched whole: `Ukupno`, a band's name. */
  listLabel(row: Locator, label: string): Locator {
    return row.locator('dt', { hasText: new RegExp(`^${escapeRegExp(label)}$`) });
  }

  /** A value of a stacked row, by its label (`Ukupno`, a band's name): the `dd` beside that `dt`. */
  listValue(row: Locator, label: string): Locator {
    return this.listLabel(row, label).locator('xpath=following-sibling::dd[1]');
  }

  /** A band cell's hours in a stacked row. */
  listBandHours(row: Locator, band: string): Locator {
    return this.listValue(row, band).locator('span.font-semibold');
  }

  /** A band cell's shift count in a stacked row. */
  listBandShifts(row: Locator, band: string): Locator {
    return this.listValue(row, band).locator('span.text-xs');
  }

  /** The phone's sort control, `Poredano: Osoba, uzlazno`, whatever the column and direction. */
  get sortControl(): Locator {
    return sortControlIn(this.page);
  }

  /** The sort control's list, open. */
  get sortPicker(): Locator {
    return sortPickerIn(this.page);
  }

  /** A column in the sort control's list. */
  sortOption(label: string): Locator {
    return sortOptionIn(this.page, label);
  }

  /** The filter bar (story 7.5): Smjena and Osoba chips, the summary and the phone sheet. */
  get filters(): FilterBarParts {
    return new FilterBarParts(this.page);
  }

  /** The empty table's `Ukloni filtar: Smjena B` (story 7.5). */
  emptyRemoveTeam(team: string): Locator {
    return this.organizationTable.getByRole('button', { name: fill(hr.filter.empty.removeTeam, { team }), exact: true });
  }

  /** The empty table's `Poništi filtre`. */
  get emptyClear(): Locator {
    return this.organizationTable.getByRole('button', { name: hr.filter.clear, exact: true });
  }

  // ------------------------------------------------ the export (story 4.3)

  /** `Izvezi u Excel`, beside the filters; while building, it wears the pending label. */
  get exportButton(): Locator {
    return this.page.getByRole('button', { name: organization.export.action, exact: true });
  }

  /** The line a failed build shows. */
  get exportFailed(): Locator {
    return this.page.getByRole('alert').filter({ hasText: organization.export.failed });
  }

  /** Chooses the export and answers the download it starts. */
  async exportDownload(): Promise<Download> {
    const [download] = await Promise.all([this.page.waitForEvent('download'), this.exportButton.click()]);

    return download;
  }

  /** Every body row's cells as shown, a band cell by its hours alone, in table order. */
  async organizationMatrix(): Promise<string[][]> {
    const labels = (await this.columnHeaders.allTextContents()).map((text) => text.trim());
    const fixed = [
      organization.member,
      organization.team,
      organization.shifts,
      organization.total,
      organization.leave,
      organization.conflicts,
    ];
    const bandLabels = new Set(labels.filter((label) => !fixed.includes(label)));
    const rows = await this.organizationRows.all();

    return Promise.all(
      rows.map(async (row) =>
        Promise.all(
          labels.map(async (label, index) => {
            const cell = row.getByRole('cell').nth(index);
            const shown = bandLabels.has(label) ? this.bandCellHours(cell) : cell;

            return ((await shown.textContent()) ?? '').trim();
          }),
        ),
      ),
    );
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
