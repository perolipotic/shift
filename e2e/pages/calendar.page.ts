import { expect, type Locator } from '@playwright/test';

import { dayMonth, weekdayOf } from '../utils/dates.ts';
import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const kalendar = hr.kalendar;

/** `subota 05.10.2026` — a date as the day detail's title names it, year included. */
function detailDate(date: string): string {
  return `${weekdayOf(date)} ${dayMonth(date)}${date.slice(0, 4)}`;
}

/** A cell's position among the grid's data cells. */
export interface GridPosition {
  readonly row: number;
  readonly column: number;
}

/**
 * `/kalendar`: the month's grid (*Sve smjene*) or day list (*Moj raspored*),
 * the mode switch, month navigation, the team and person filter, the legend
 * and the day detail.
 */
export class CalendarPage extends BasePage {
  protected readonly path = '/kalendar';

  /** The month's heading (h2), or any h2 without a name. */
  monthHeading(name?: string | RegExp): Locator {
    return name === undefined
      ? this.page.getByRole('heading', { level: 2 })
      : this.page.getByRole('heading', { level: 2, name });
  }

  get nextButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.next });
  }

  get previousButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.previous });
  }

  /** `Ovaj mjesec`. */
  get currentButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.current, exact: true });
  }

  /** The mode switch's two buttons. */
  modes(): { readonly moj: Locator; readonly sve: Locator } {
    const group = this.page.getByRole('group', { name: kalendar.mode.label });

    return {
      moj: group.getByRole('button', { name: kalendar.mode.moj, exact: true }),
      sve: group.getByRole('button', { name: kalendar.mode.sve, exact: true }),
    };
  }

  /** The alert a failed read shows. */
  get unavailableAlert(): Locator {
    return this.alertWith(kalendar.error.unavailable);
  }

  /** The notice the member on no team reads. */
  get noTeamNotice(): Locator {
    return this.text(kalendar.noTeam);
  }

  /** A text drawn inside a header, a cell or a day. */
  drawnText(scope: Locator, text: string, options: { readonly exact?: boolean } = { exact: true }): Locator {
    return scope.getByText(text, options);
  }

  /** The drawn, `aria-hidden` letter of a compressed header or cell. */
  letterOf(locator: Locator): Locator {
    return locator.locator('[aria-hidden="true"]').first();
  }

  // --------------------------------------------------------------- grid

  /** The calendar grid, named by the month heading. */
  get grid(): Locator {
    return this.page.getByRole('grid', { name: /\d{4}$/ });
  }

  /** Any grid at all, named or not. */
  get anyGrid(): Locator {
    return this.page.getByRole('grid');
  }

  /** A team's column header. */
  columnHeader(teamName: string): Locator {
    return this.grid.getByRole('columnheader', { name: teamName, exact: true });
  }

  /** The grid's header cells: the date's, then one per team. */
  get headerCells(): Locator {
    return this.grid.locator('thead th');
  }

  /** The grid's team columns: its column headers but the date's. */
  async columnCount(): Promise<number> {
    return (await this.headerCells.count()) - 1;
  }

  /** The grid's body rows, one per date. */
  async rowCount(): Promise<number> {
    return this.grid.locator('tbody tr').count();
  }

  get cells(): Locator {
    return this.grid.getByRole('gridcell');
  }

  /** Today's row anywhere on the page, the grid or not. */
  get todayRowAnywhere(): Locator {
    return this.page.locator('tr[aria-current="date"]');
  }

  /** Today's row in the grid. */
  get todayRow(): Locator {
    return this.grid.locator('tr[aria-current="date"]');
  }

  /** Today's first team's cell. */
  get todayFirstCell(): Locator {
    return this.todayRow.getByRole('gridcell').first();
  }

  /** A row's header, its date. */
  rowHeaderIn(row: Locator): Locator {
    return row.getByRole('rowheader');
  }

  /** The grid's tab stops; the roving tab stop keeps exactly one. */
  get tabStops(): Locator {
    return this.grid.locator('[role="gridcell"][tabindex="0"]');
  }

  /** A data cell by its position. */
  cellAt(position: GridPosition): Locator {
    return this.grid.locator(
      `[role="gridcell"][data-row="${String(position.row)}"][data-column="${String(position.column)}"]`,
    );
  }

  /** A compressed cell's drawn box, the target a finger meets. */
  targetOf(cell: Locator): Locator {
    return cell.locator('div').first();
  }

  /** The grid's cell for `teamName` on `date`. */
  async cellOf(teamName: string, date: string): Promise<Locator> {
    const grid = this.grid;
    // The grid renders once the snapshot has landed; the skeleton has no headers.
    await expect(this.columnHeader(teamName)).toBeVisible();
    // The header's text without its compressed letter, which is `aria-hidden`.
    const heads = await grid.getByRole('columnheader').evaluateAll((elements) =>
      elements.map((element) => {
        const copy = element.cloneNode(true) as Element;
        for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();

        return copy.textContent ?? '';
      }),
    );
    const column = heads.indexOf(teamName);
    if (column <= 0) throw new Error(`E2E: the grid has no column for ${teamName}: ${heads.join(', ')}`);
    const escaped = dayMonth(date).replace(/\./g, '\\.');
    const row = grid
      .getByRole('row')
      .filter({ has: this.page.getByRole('rowheader', { name: new RegExp(`^${escaped}`) }) });
    await expect(row, `the grid has no row for ${date}`).toHaveCount(1);

    // The first column is the row header; the cells follow it.
    return row.getByRole('gridcell').nth(column - 1);
  }

  /** The focused gridcell's position among the data cells, or `null` when focus is not on one. */
  async focusedCell(): Promise<GridPosition | null> {
    return this.page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLTableCellElement) || active.getAttribute('role') !== 'gridcell') return null;
      const row = active.parentElement;
      if (!(row instanceof HTMLTableRowElement)) return null;

      // Past the header row and the date column.
      return { row: row.rowIndex - 1, column: active.cellIndex - 1 };
    });
  }

  /** Whether the focused element shows its focus (`:focus-visible`). */
  async focusIsVisible(): Promise<boolean> {
    return this.page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false);
  }

  /**
   * Moves the grid's tab stop off today's first cell, so a later reset of it is
   * observable: focus that cell, then Ctrl+Home — or Ctrl+End when today is the
   * first row — and wait for the one tab stop to leave it.
   */
  async moveTabStopOffToday(): Promise<void> {
    const todayFirst = this.todayFirstCell;
    await todayFirst.focus();
    await this.page.keyboard.press('Control+Home');
    if ((await todayFirst.getAttribute('tabindex')) === '0') await this.page.keyboard.press('Control+End');
    await expect(todayFirst).toHaveAttribute('tabindex', '-1');
    await expect(this.tabStops).toHaveCount(1);
  }

  // ------------------------------------------------------------ day list

  /** *Moj raspored*: the day list, named by the month heading. */
  get dayList(): Locator {
    return this.page.getByRole('list', { name: /\d{4}$/ });
  }

  get dayListItems(): Locator {
    return this.dayList.getByRole('listitem');
  }

  /** The day list's day that holds `text`. */
  dayListItem(text: string): Locator {
    return this.dayListItems.filter({ hasText: text });
  }

  /** Today's day in the day list. */
  get today(): Locator {
    return this.dayList.locator('li[aria-current="date"]');
  }

  /** A day's button, which opens its detail. */
  openerIn(day: Locator): Locator {
    return day.getByRole('button');
  }

  // ------------------------------------------------------------- legend

  /** The legend's heading, its list and the list's entries. */
  legendOf(): { readonly heading: Locator; readonly list: Locator; readonly items: Locator } {
    const list = this.page.getByRole('list', { name: kalendar.legend, exact: true });

    return {
      heading: this.text(kalendar.legend),
      list,
      items: list.getByRole('listitem'),
    };
  }

  // --------------------------------------------------------- day detail

  /**
   * The day detail's Dialog, named by its title: the team and the date. Exact,
   * because the removal's confirmation (story 3.5b) names the same team and
   * date inside its prompt.
   */
  detailOf(teamName: string, date: string): Locator {
    return this.page.getByRole('dialog', {
      name: fill(kalendar.detail.title, { team: teamName, date: detailDate(date) }),
      exact: true,
    });
  }

  /** The detail's roster heading. */
  rosterHeadingIn(detail: Locator): Locator {
    return detail.getByRole('heading', { name: kalendar.detail.roster, exact: true });
  }

  /** The detail's roster list. */
  rosterIn(detail: Locator): Locator {
    return detail.getByRole('list', { name: kalendar.detail.roster, exact: true });
  }

  /** The roster's lines. */
  rosterLinesIn(detail: Locator): Locator {
    return this.rosterIn(detail).getByRole('listitem');
  }

  /** Every list in the detail. */
  listsIn(detail: Locator): Locator {
    return detail.getByRole('list');
  }

  /** Every list entry in the detail. */
  itemsIn(detail: Locator): Locator {
    return detail.getByRole('listitem');
  }

  /** The override's block: the projected type, the author, the time and the reason. */
  overrideIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.override.heading });
  }

  closeIn(detail: Locator): Locator {
    return detail.getByRole('button', { name: kalendar.detail.close, exact: true });
  }

  // ------------------------------------------------ the override form (3.5b)

  /** The admin's override form in the detail, named by its heading. */
  overrideFormIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.override.set.heading, exact: true });
  }

  /** The form's type `Select`. */
  overrideTypeIn(detail: Locator): Locator {
    return detail.getByLabel(kalendar.detail.override.set.type, { exact: true });
  }

  /** The form's reason field. */
  overrideReasonIn(detail: Locator): Locator {
    return detail.getByLabel(kalendar.detail.override.set.reason, { exact: true });
  }

  /** The form's save. */
  overrideSaveIn(detail: Locator): Locator {
    return detail.getByRole('button', { name: kalendar.detail.override.set.save, exact: true });
  }

  /** The removal's action, beside the override block. */
  overrideRemoveIn(detail: Locator): Locator {
    return detail.getByRole('button', { name: kalendar.detail.override.remove.action, exact: true });
  }

  /** A refusal inside a Dialog. */
  alertIn(dialog: Locator): Locator {
    return dialog.getByRole('alert');
  }

  /** What a landed override write says inside the day detail. */
  statusIn(dialog: Locator): Locator {
    return dialog.getByRole('status');
  }

  /** The removal's confirmation, named by its prompt: the team, the date and the projected type restored. */
  removeConfirmOf(teamName: string, date: string, projectedType: string): Locator {
    return this.dialog(
      fill(kalendar.detail.override.remove.prompt, { team: teamName, date: detailDate(date), type: projectedType }),
    );
  }

  /** The confirmation's confirm. */
  confirmRemoveIn(confirm: Locator): Locator {
    return confirm.getByRole('button', { name: kalendar.detail.override.remove.confirm, exact: true });
  }

  /** The confirmation's cancel. */
  cancelRemoveIn(confirm: Locator): Locator {
    return confirm.getByRole('button', { name: kalendar.detail.override.remove.cancel, exact: true });
  }

  /** Chooses `typeName`, types `reason` and saves the override form in `detail`. */
  async setOverrideIn(detail: Locator, typeName: string, reason: string): Promise<void> {
    await this.overrideTypeIn(detail).selectOption({ label: typeName });
    await this.overrideReasonIn(detail).fill(reason);
    await this.overrideSaveIn(detail).click();
  }

  /** A grid cell's position among the data cells, from its `data-row` and `data-column`. */
  async positionOf(cell: Locator): Promise<GridPosition> {
    const [row, column] = await Promise.all([cell.getAttribute('data-row'), cell.getAttribute('data-column')]);
    if (row === null || column === null) throw new Error('E2E: the cell carries no grid position');

    return { row: Number(row), column: Number(column) };
  }

  /**
   * Arms a one-shot listener: when the next dialog `close` event is
   * dispatched, the grid cell at `position` is clicked BEFORE the app hears
   * that event — as a click the browser runs ahead of the queued event would
   * be. `clickedOnDialogClose` reports whether it ran.
   */
  async clickOnDialogClose(position: GridPosition): Promise<void> {
    const selector = `[role="gridcell"][data-row="${String(position.row)}"][data-column="${String(position.column)}"]`;

    await this.page.evaluate((cellSelector) => {
      const flags = window as unknown as { e2eClickedOnDialogClose?: boolean };
      flags.e2eClickedOnDialogClose = false;
      window.addEventListener(
        'close',
        (event) => {
          if (!(event.target instanceof HTMLDialogElement)) return;
          const cell = document.querySelector<HTMLElement>(cellSelector);
          if (cell === null) throw new Error(`E2E: no cell ${cellSelector} when the dialog closed`);
          cell.click();
          flags.e2eClickedOnDialogClose = true;
        },
        { capture: true, once: true },
      );
    }, selector);
  }

  /** Whether the listener `clickOnDialogClose` armed has run. */
  async clickedOnDialogClose(): Promise<boolean> {
    return this.page.evaluate(
      () => (window as unknown as { e2eClickedOnDialogClose?: boolean }).e2eClickedOnDialogClose === true,
    );
  }

  // ------------------------------------------------------------- filter

  /** The team and person filter's native select. */
  get teamFilter(): Locator {
    return this.page.getByRole('combobox', { name: kalendar.filter.label, exact: true });
  }

  /** The filter's first option, all teams. */
  get allTeamsOption(): Locator {
    return this.teamFilter.locator('option').first();
  }

  /** The filter's option groups: the teams, then the people. */
  get filterGroups(): Locator {
    return this.teamFilter.locator('optgroup');
  }

  /** The teams under the filter's teams heading. */
  get teamOptions(): Locator {
    return this.teamFilter.locator(`optgroup[label="${kalendar.filter.group}"] > option`);
  }

  /** The people under the filter's *Osobe* heading. */
  get peopleOptions(): Locator {
    return this.teamFilter.locator(`optgroup[label="${kalendar.filter.people}"] > option`);
  }

  get resetButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.filter.reset, exact: true });
  }

  /** A chosen person's heading (h3). */
  personHeading(name: string, options: { readonly exact?: boolean } = { exact: true }): Locator {
    return this.page.getByRole('heading', { level: 3, name, ...options });
  }

  /**
   * A person's day list, named by their heading and then the month's
   * (`Lana Članica Rujan 2026`), so the month is never lost.
   */
  personListOf(name: string): Locator {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return this.page.getByRole('list', { name: new RegExp(`^${escaped} \\S+ \\d{4}$`) });
  }

  /** The explanation for a person on no team all month. */
  personNoTeam(name: string): Locator {
    return this.text(fill(kalendar.person.noTeam, { name }));
  }
}
