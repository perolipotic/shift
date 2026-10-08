import { expect, type Locator } from '@playwright/test';

import { dayMonth, fullDate } from '../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';
import { ErasureDialogParts } from './erasure-dialog.ts';
import { sortControlIn, sortOptionIn, sortPickerIn } from './sort-control.ts';

const membership = hr.smjene.membership;
const leave = hr.ljudi.leaveRecord;

/** `/ljudi`, `/ljudi/novi` and `/ljudi/:id`: the member list, the new-member
 *  form and a member's edit screen with its team membership. */
export class PeoplePage extends BasePage {
  protected readonly path = '/ljudi';

  // ----------------------------------------------------------- the list

  /** The member list's table. */
  get table(): Locator {
    return this.page.getByRole('table', { name: hr.ljudi.caption });
  }

  /** A member's edit link in the list's table. */
  listedMember(name: string): Locator {
    return this.table.getByRole('link', { name: fill(hr.ljudi.form.edit, { name }) });
  }

  /** A member's edit link anywhere on the screen. */
  editLink(name: string): Locator {
    return this.page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name }) });
  }

  get addLink(): Locator {
    return this.page.getByRole('link', { name: hr.ljudi.form.add });
  }

  /** A member's row in the list's table: the one holding their edit link. */
  memberRow(name: string): Locator {
    return this.table
      .getByRole('row')
      .filter({ has: this.page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name }) }) });
  }

  /** The member list as stacked rows below 640 px (story 7.6), named by the table's caption. */
  get list(): Locator {
    return this.page.getByRole('list', { name: hr.ljudi.caption, exact: true });
  }

  /** Every stacked row, in list order. */
  get listRows(): Locator {
    return this.list.getByRole('listitem');
  }

  /** A member's stacked row: the one holding their link, named as the table's edit link. */
  listRow(name: string): Locator {
    return this.listRows.filter({ has: this.page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name }) }) });
  }

  /** A stacked row's label (`dt`), matched whole. */
  listLabel(row: Locator, label: string): Locator {
    return row.locator('dt', { hasText: new RegExp(`^${escapeRegExp(label)}$`) });
  }

  /** Every stacked row's link, in list order: each named `Uredi osobu {name}`. */
  get listLinks(): Locator {
    return this.list.getByRole('link');
  }

  /** The phone's sort control (story 7.6), whatever the column and direction. */
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

  /** A sortable heading of the table from 640 px, by its label: `aria-sort` is on it. */
  columnHeader(label: string): Locator {
    return this.table.getByRole('columnheader', { name: label, exact: true });
  }

  /** The way from the list to the teams screen, a client-side link. */
  get teamsLink(): Locator {
    return this.page.getByRole('link', { name: hr.smjene.heading, exact: true });
  }

  /** Opens `/ljudi` and a member's edit screen from it. */
  async openMember(name: string): Promise<void> {
    await this.goto();
    await this.editLink(name).click();
  }

  // ------------------------------------------------------ the new member

  async gotoNew(): Promise<void> {
    await this.page.goto('/ljudi/novi');
  }

  get nameInput(): Locator {
    return this.page.getByLabel(hr.ljudi.name, { exact: true });
  }

  get usernameInput(): Locator {
    return this.page.getByLabel(hr.ljudi.form.username, { exact: true });
  }

  /** The fire-rank control, on the new-member form and the edit form alike. */
  get rankSelect(): Locator {
    return this.page.getByLabel(hr.ljudi.rank.label, { exact: true });
  }

  /** The rank the control has selected. */
  get selectedRank(): Locator {
    return this.rankSelect.locator('option:checked');
  }

  get saveButton(): Locator {
    return this.page.getByRole('button', { name: hr.ljudi.form.save });
  }

  get backLink(): Locator {
    return this.page.getByRole('link', { name: hr.ljudi.form.back });
  }

  /** Fills the already open `/ljudi/novi` form's name and username. */
  async fillNewMember(name: string, username: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.usernameInput.fill(username);
  }

  /**
   * Fills and submits the already open `/ljudi/novi` form — the admin-auth Edge
   * Function's `createUser` — and waits for the one-time password screen. The
   * address it builds is under this run's domain, so teardown reaches it.
   */
  async submitNewMember(name: string, username: string): Promise<void> {
    await this.fillNewMember(name, username);
    await this.saveButton.click();

    await expect(this.status).toHaveText(hr.ljudi.form.created);
  }

  /** Opens `/ljudi/novi` and issues the account. */
  async createMember(name: string, username: string): Promise<void> {
    await this.gotoNew();
    await this.submitNewMember(name, username);
  }

  // ------------------------------------------------------- the status

  get statusDateInput(): Locator {
    return this.page.getByLabel(hr.ljudi.status.date, { exact: true });
  }

  deactivateButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.deactivate, { name }) });
  }

  /** The deactivation's confirm, in the status card's confirmation. */
  deactivateConfirmButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.deactivateConfirm, { name }) });
  }

  /** The status card's offer to withdraw its scheduled change. */
  statusWithdrawButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.withdraw, { name }) });
  }

  /** That withdrawal's confirm, in the status card's confirmation. */
  statusWithdrawConfirmButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.withdrawConfirm, { name }) });
  }

  /** The status card's change confirmed from the date field's value: the offer, then its confirm. */
  async deactivate(name: string): Promise<void> {
    await this.deactivateButton(name).click();
    await this.deactivateConfirmButton(name).click();
  }

  // ------------------------------------------------- the erasure guard (5.5e)

  /**
   * The team or status card's erasure dialog (story 5.5e), its save named
   * `save` — the card's own confirm, as its confirmation words it.
   */
  memberErasures(save: string): ErasureDialogParts {
    return new ErasureDialogParts(this.page, { ...hr.ljudi.erasures, save });
  }

  /** The refusal, inside a card's confirmation, when what its change would erase cannot be checked. */
  get memberUnchecked(): Locator {
    return this.alertWith(hr.ljudi.erasures.unavailable);
  }

  /** That refusal's retry. */
  get memberUncheckedRetry(): Locator {
    return this.memberUnchecked.getByRole('button', { name: hr.ljudi.erasures.retry, exact: true });
  }

  // ------------------------------------------------ the team membership

  get teamSelect(): Locator {
    return this.page.getByLabel(membership.team, { exact: true });
  }

  get positionSelect(): Locator {
    return this.page.getByLabel(hr.smjene.position.label, { exact: true });
  }

  /** The position the control has selected. */
  get selectedPosition(): Locator {
    return this.positionSelect.locator('option:checked');
  }

  get dateInput(): Locator {
    return this.page.getByLabel(membership.date, { exact: true });
  }

  moveButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(membership.move, { name }) });
  }

  moveConfirmButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(membership.moveConfirm, { name }) });
  }

  withdrawButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(membership.withdraw, { name }) });
  }

  withdrawConfirmButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(membership.withdrawConfirm, { name }) });
  }

  // ------------------------------------------------------------ the leave

  /** Opens a member's edit screen by id. */
  async gotoMember(id: string): Promise<void> {
    await this.page.goto(`/ljudi/${id}`);
  }

  /** "Natrag na konflikte", shown while the member page was reached from a conflict (story 5.4d). */
  get backToConflictsLink(): Locator {
    return this.page.getByRole('main').getByRole('link', { name: hr.ljudi.form.backToConflicts, exact: true });
  }

  /** The leave card's heading. */
  get leaveHeading(): Locator {
    return this.page.getByRole('heading', { level: 2, name: leave.heading });
  }

  /** The leave card, a region named by its heading. */
  get leaveCard(): Locator {
    return this.page.getByRole('region', { name: leave.heading });
  }

  /**
   * The figure under `label` in the leave card — the allowance, used, the
   * balance, the cost or the balance after. A `<dt>`/`<dd>` pair in its own
   * `<div>`, which no role or label reaches as a pair.
   */
  leaveFigure(label: string): Locator {
    return this.leaveCard
      .locator('dl > div')
      .filter({ has: this.page.getByRole('term').getByText(label, { exact: true }) })
      .getByRole('definition');
  }

  get leaveFromInput(): Locator {
    return this.leaveCard.getByLabel(leave.from, { exact: true });
  }

  get leaveToInput(): Locator {
    return this.leaveCard.getByLabel(leave.to, { exact: true });
  }

  get saveLeaveButton(): Locator {
    return this.leaveCard.getByRole('button', { name: leave.save, exact: true });
  }

  /** The amend-mode legend naming the record `from`–`to`, both `YYYY-MM-DD`. */
  leaveAmendGroup(from: string, to: string): Locator {
    return this.leaveCard.getByRole('group', { name: fill(leave.amendHeading, { from: fullDate(from), to: fullDate(to) }) });
  }

  /** The form in new-record mode. */
  get leaveNewGroup(): Locator {
    return this.leaveCard.getByRole('group', { name: leave.newHeading, exact: true });
  }

  get amendSaveButton(): Locator {
    return this.leaveCard.getByRole('button', { name: leave.amendSave, exact: true });
  }

  get amendCancelButton(): Locator {
    return this.leaveCard.getByRole('button', { name: leave.amendCancel, exact: true });
  }

  /** The card's list of live records, a section named by its heading. */
  get leaveRecordsList(): Locator {
    return this.leaveCard.getByRole('region', { name: leave.recordsHeading });
  }

  /** Each live record's row, in the order shown. */
  get leaveRecordRows(): Locator {
    return this.leaveRecordsList.getByRole('listitem');
  }

  /** The row of the record `from`–`to`, both `YYYY-MM-DD`. */
  leaveRecordRow(from: string, to: string): Locator {
    return this.leaveRecordRows.filter({ hasText: `${fullDate(from)}–${fullDate(to)}` });
  }

  /** The record's Izmijeni, named by its range. */
  amendLeaveButton(from: string, to: string): Locator {
    return this.leaveRecordsList.getByRole('button', {
      name: fill(leave.amendName, { from: fullDate(from), to: fullDate(to) }),
      exact: true,
    });
  }

  /** The record's Ukloni, named by its range. */
  removeLeaveButton(from: string, to: string): Locator {
    return this.leaveRecordsList.getByRole('button', {
      name: fill(leave.removeName, { from: fullDate(from), to: fullDate(to) }),
      exact: true,
    });
  }

  /**
   * The removal's confirmation, named by its prompt: the range and what it
   * costs, and the part charged to this leave year when that differs.
   */
  removeLeaveConfirmOf(from: string, to: string, cost: number, inYear?: number): Locator {
    const values = { from: fullDate(from), to: fullDate(to), cost: plural(hr.count.days, cost) };

    return this.dialog(
      inYear === undefined
        ? fill(leave.removePrompt, values)
        : fill(leave.removePromptInYear, { ...values, inYear: plural(hr.count.days, inYear) }),
    );
  }

  /** The confirmation's confirm. */
  confirmRemoveLeaveIn(confirm: Locator): Locator {
    return confirm.getByRole('button', { name: leave.removeConfirm, exact: true });
  }

  /** The confirmation's cancel. */
  cancelRemoveLeaveIn(confirm: Locator): Locator {
    return confirm.getByRole('button', { name: leave.removeCancel, exact: true });
  }

  /** The alert inside the confirmation that holds `text`: a refused removal. */
  alertIn(confirm: Locator, text: string): Locator {
    return confirm.getByRole('alert').filter({ hasText: text });
  }

  /**
   * The replacement guard's line (story 5.4e): `name` stays on `team`'s shift
   * on `date` (`YYYY-MM-DD`) as a replacement — the exact sentence.
   */
  replacementStaysLine(name: string, team: string, date: string): string {
    return fill(leave.replacementStays, { name, team, date: dayMonth(date) });
  }

  /**
   * The amend preview's polite live region, by its own id (story 5.4e reads
   * its replacement lines there); a spec asserts its `aria-live` too.
   */
  get leavePreviewRegion(): Locator {
    return this.leaveCard.locator('#member-leave-preview');
  }

  /** The retry the leave card's unavailable line offers. */
  get retryLeaveButton(): Locator {
    return this.leaveCard.getByRole('button', { name: leave.retry });
  }

  /** Enters an od–do range, both `YYYY-MM-DD`. */
  async enterLeave(from: string, to: string): Promise<void> {
    await this.leaveFromInput.fill(from);
    await this.leaveToInput.fill(to);
  }

  /** Puts the open member on a team from the date field's value, confirmed. */
  async moveToTeam(teamName: string, name: string): Promise<void> {
    await this.teamSelect.selectOption({ label: teamName });
    await this.moveButton(name).click();
    await this.moveConfirmButton(name).click();
  }
}
