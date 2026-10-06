import { expect, type Locator } from '@playwright/test';

import { dayMonth, weekdayOf } from '../utils/dates.ts';
import { MONTH_TRIGGER_NAME, escapeRegExp, fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';
import { ErasureDialogParts } from './erasure-dialog.ts';

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

  /** `Ovaj mjesec`, drawn only off the current month (story 7.4). */
  get currentButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.current, exact: true });
  }

  /** The month toolbar (story 7.4): ‹ month ▾ › in one group named "Mjesec". */
  get monthToolbar(): Locator {
    return this.page.getByRole('group', { name: kalendar.month, exact: true });
  }

  /** The month toolbar's trigger, which opens the month picker. */
  get monthTrigger(): Locator {
    return this.monthToolbar.getByRole('button', { name: MONTH_TRIGGER_NAME });
  }

  /** The "ovaj mjesec" label inside the trigger on the current month. */
  get thisMonthLabel(): Locator {
    return this.monthTrigger.getByText(kalendar.thisMonthLabel, { exact: true });
  }

  /** The month picker, open. */
  get monthPicker(): Locator {
    return this.page.getByRole('dialog', { name: kalendar.monthPicker, exact: true });
  }

  /** The picker's year ‹ and ›. */
  pickerYears(): { readonly previous: Locator; readonly next: Locator } {
    return {
      previous: this.monthPicker.getByRole('button', { name: kalendar.previousYear, exact: true }),
      next: this.monthPicker.getByRole('button', { name: kalendar.nextYear, exact: true }),
    };
  }

  /**
   * A month button in the picker, by its accessible name — the month's
   * heading, `Ožujak 2025`, followed by ", ovaj mjesec" on the current month.
   */
  pickerMonth(heading: string): Locator {
    return this.monthPicker.getByRole('button', { name: new RegExp(`^${escapeRegExp(heading)}(?:, |$)`) });
  }

  /** The picker's year, a live region announcing each change. */
  get pickerYear(): Locator {
    return this.monthPicker.locator('[aria-live="polite"]');
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

  /** The unavailable alert's retry (story 5.3c), which reads the schedule and the leave again. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: kalendar.retry, exact: true });
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

  /** Today's day in a given day list — a chosen person's (story 3.6a). */
  todayIn(list: Locator): Locator {
    return list.locator('li[aria-current="date"]');
  }

  /** A day's button anywhere on the page, by its full label (story 3.6a). */
  dayOpenerNamed(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** A day's button, which opens its detail — one per shift, in order (story 3.6a). */
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

  /** The legend's entries' names, in the order shown, each without its `aria-hidden` swatch (story 5.3c). */
  async legendNames(): Promise<string[]> {
    return (await this.legendOf().items.locator(':scope > span:not([aria-hidden])').allInnerTexts()).map((text) =>
      text.trim(),
    );
  }

  // ---------------------------------------------------------------- marks

  /**
   * Shows the month `date` falls in by the month buttons alone — never a
   * reload — from the month the URL names, or today's when it names none.
   */
  async showMonthOf(date: string, today: string): Promise<void> {
    const wanted = date.slice(0, 7);
    const heading = this.monthHeading();

    for (;;) {
      const shown = new URL(this.page.url()).searchParams.get('mjesec') ?? today.slice(0, 7);
      if (shown === wanted) return;
      const before = (await heading.innerText()).trim();
      await (shown < wanted ? this.nextButton : this.previousButton).click();
      await expect(heading).not.toHaveText(before);
    }
  }

  /**
   * A day-list button of `teamName` on `date` in `list`, by the start of its
   * full label: the date and the team. Its name carries the marks after the
   * type and range.
   */
  dayButtonIn(list: Locator, teamName: string, date: string): Locator {
    return list.getByRole('button', {
      name: new RegExp(`^${escapeRegExp(`${weekdayOf(date)} ${dayMonth(date)}, ${teamName}, `)}`),
    });
  }

  /** Every gridcell whose label names a conflict or leave mark (story 5.3c). */
  get cellsMarkedConflictOrLeave(): Locator {
    return this.grid.getByRole('gridcell', {
      name: new RegExp(`, (${escapeRegExp(kalendar.modifier.conflict)}|${escapeRegExp(kalendar.modifier.leave)})(,|$)`),
    });
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
    // Exact, so the pending block's `Izmjena čeka pregled` (story 3.5c) is not it.
    return detail.getByRole('region', { name: kalendar.detail.override.heading, exact: true });
  }

  /** The roster changes block (story 3.6a): each change, its author, time and reason. */
  rosterChangesIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.rosterChange.heading, exact: true });
  }

  /** The roster changes block's entries. */
  rosterChangeItemsIn(detail: Locator): Locator {
    return this.rosterChangesIn(detail).getByRole('listitem');
  }

  /** The block of roster changes a rotation change left pending (story 3.6a). */
  rosterPendingIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.rosterChange.pendingHeading, exact: true });
  }

  /** The block of an override a rotation change left pending (story 3.5c). */
  pendingOverrideIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.override.pending.heading, exact: true });
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

  /** The form's reason field, inside the form: the roster form (story 3.6b) has a `Razlog` too. */
  overrideReasonIn(detail: Locator): Locator {
    return this.overrideFormIn(detail).getByLabel(kalendar.detail.override.set.reason, { exact: true });
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

  /**
   * What a landed write says inside the day detail: a `status` that says
   * something. The roster form's overlap hint is a `status` too, always
   * attached and empty while silent (Epic 4 retro C2), so an empty one is not it.
   */
  statusIn(dialog: Locator): Locator {
    return dialog.getByRole('status').filter({ hasText: /\S/ });
  }

  /** The removal's confirmation, named by its prompt: the team, the date and the projected type restored. */
  removeConfirmOf(teamName: string, date: string, projectedType: string): Locator {
    return this.dialog(
      fill(kalendar.detail.override.remove.prompt, { team: teamName, date: detailDate(date), type: projectedType }),
    );
  }

  /** The removal's confirmation of an override pending review (story 3.5c), named by its prompt. */
  pendingRemoveConfirmOf(teamName: string, date: string): Locator {
    return this.dialog(fill(kalendar.detail.override.pending.removePrompt, { team: teamName, date: detailDate(date) }));
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

  // -------------------------------------------------- the roster form (3.6b)

  /** The admin's roster form in the detail, named by its heading. */
  rosterFormIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.rosterChange.set.heading, exact: true });
  }

  /** The form's "Skida se" `Select`. */
  rosterOutIn(detail: Locator): Locator {
    return this.rosterFormIn(detail).getByLabel(kalendar.detail.rosterChange.set.out, { exact: true });
  }

  /** The form's "Dolazi" `Select`. */
  rosterInIn(detail: Locator): Locator {
    return this.rosterFormIn(detail).getByLabel(kalendar.detail.rosterChange.set.in, { exact: true });
  }

  /** One `Select`'s option, by the whole line it reads. */
  optionIn(select: Locator, label: string): Locator {
    return select.locator('option').filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) });
  }

  /** A member's option in one `Select`: their name, alone or followed by ` · ` and what the line adds. */
  memberOptionIn(select: Locator, name: string): Locator {
    return select.locator('option').filter({ hasText: new RegExp(`^${escapeRegExp(name)}(?: · .*)?$`) });
  }

  /**
   * The form's overlap hint (Epic 4 retro C2): the polite live region right after
   * the "Dolazi" `Select`'s wrapper, which it describes while it says anything.
   * Always attached — empty while there is nothing to say — so an empty hint
   * is asserted on the one node, never on a locator that matches nothing.
   */
  rosterOverlapIn(detail: Locator): Locator {
    return this.rosterInIn(detail).locator('xpath=../following-sibling::*[@role="status"][1]');
  }

  /** The form's reason field. */
  rosterReasonIn(detail: Locator): Locator {
    return this.rosterFormIn(detail).getByLabel(kalendar.detail.rosterChange.set.reason, { exact: true });
  }

  /** The form's save. */
  rosterSaveIn(detail: Locator): Locator {
    return this.rosterFormIn(detail).getByRole('button', { name: kalendar.detail.rosterChange.set.save, exact: true });
  }

  /** The block of in-force roster changes that apply to nothing (story 3.6b), an admin's alone. */
  rosterInertIn(detail: Locator): Locator {
    return detail.getByRole('region', { name: kalendar.detail.rosterChange.inertHeading, exact: true });
  }

  /** Every roster change's removal inside `scope` — a block, or the whole detail. */
  rosterRemoveIn(scope: Locator): Locator {
    return scope.getByRole('button', { name: kalendar.detail.rosterChange.remove.action, exact: true });
  }

  /** A roster change's removal confirmation, named by its prompt: the change's line, the team and the date. */
  rosterRemoveConfirmOf(change: string, teamName: string, date: string): Locator {
    return this.dialog(
      fill(kalendar.detail.rosterChange.remove.prompt, { change, team: teamName, date: detailDate(date) }),
    );
  }

  /** The roster confirmation's confirm. */
  confirmRosterRemoveIn(confirm: Locator): Locator {
    return confirm.getByRole('button', { name: kalendar.detail.rosterChange.remove.confirm, exact: true });
  }

  /** The roster confirmation's cancel. */
  cancelRosterRemoveIn(confirm: Locator): Locator {
    return confirm.getByRole('button', { name: kalendar.detail.rosterChange.remove.cancel, exact: true });
  }

  /** Chooses the one option of `select` that names the member `name`. */
  async chooseIn(select: Locator, name: string): Promise<void> {
    const value = await this.memberOptionIn(select, name).getAttribute('value');
    if (value === null) throw new Error(`E2E: no option names ${name}`);
    await select.selectOption(value);
  }

  /**
   * Fills the roster form in `detail` — the member taken off and the one put
   * on by their names, `null` leaving "— nitko —" — types `reason` and saves.
   */
  async changeRosterIn(detail: Locator, out: string | null, put: string | null, reason: string): Promise<void> {
    if (out !== null) await this.chooseIn(this.rosterOutIn(detail), out);
    if (put !== null) await this.chooseIn(this.rosterInIn(detail), put);
    await this.rosterReasonIn(detail).fill(reason);
    await this.rosterSaveIn(detail).click();
  }

  // ------------------------------- the roster change's erasure guard (5.5b)

  /**
   * The roster change's erasure confirmation, in the calendar's words: its
   * own save says "Spremi promjenu" after the form's save and "Ukloni" after
   * a removal's confirmation.
   */
  rosterErasures(after: 'save' | 'removal'): ErasureDialogParts {
    const change = kalendar.detail.rosterChange;

    return new ErasureDialogParts(this.page, {
      ...change.erasures,
      save: after === 'save' ? change.set.save : change.remove.confirm,
    });
  }

  /** The refusal when what a roster change would erase cannot be checked. */
  get rosterUnchecked(): Locator {
    return this.alertWith(kalendar.detail.rosterChange.erasures.unavailable);
  }

  /** The refusal's retry. */
  get rosterUncheckedRetry(): Locator {
    return this.rosterUnchecked.getByRole('button', { name: kalendar.detail.rosterChange.erasures.retry, exact: true });
  }

  // --------------------------- the shift-type override's erasure guard (5.5f)

  /**
   * The shift-type override's erasure confirmation, in the calendar's words:
   * its own save says "Spremi izmjenu" after the form's save and "Ukloni"
   * after a removal's confirmation.
   */
  overrideErasures(after: 'save' | 'removal'): ErasureDialogParts {
    const override = kalendar.detail.override;

    return new ErasureDialogParts(this.page, {
      ...override.erasures,
      // A removal's kept hint is its own; the lede is not a locator's.
      kept: after === 'save' ? override.erasures.kept : override.erasures.keptRemoval,
      save: after === 'save' ? override.set.save : override.remove.confirm,
    });
  }

  /** The refusal when what a shift-type override would erase cannot be checked. */
  get overrideUnchecked(): Locator {
    return this.alertWith(kalendar.detail.override.erasures.unavailable);
  }

  /** The refusal's retry. */
  get overrideUncheckedRetry(): Locator {
    return this.overrideUnchecked.getByRole('button', { name: kalendar.detail.override.erasures.retry, exact: true });
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

  /**
   * A person's days on `teamName`: the day buttons in their day list whose
   * name — the cell's full label — carries the team.
   */
  personDaysOnTeam(name: string, teamName: string): Locator {
    return this.personListOf(name).getByRole('button', { name: new RegExp(escapeRegExp(teamName)) });
  }

  /** The explanation for a person on no team all month. */
  personNoTeam(name: string): Locator {
    return this.text(fill(kalendar.person.noTeam, { name }));
  }
}
