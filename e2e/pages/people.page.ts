import { expect, type Locator } from '@playwright/test';

import { dayMonth, fullDate, weekdayShort } from '../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';
import { ErasureDialogParts } from './erasure-dialog.ts';
import { FilterBarParts } from './filter-bar.ts';
import { sortControlIn, sortOptionIn, sortPickerIn } from './sort-control.ts';

const membership = hr.smjene.membership;
const leave = hr.ljudi.leaveRecord;
/** *Godišnji odmor*, or *Godišnji odmor 2026.* once the leave year is read — never the records' own heading. */
const LEAVE_HEADING = new RegExp(`^${escapeRegExp(leave.heading)}( \\d{4}\\.(/\\d{4}\\.)?)?$`);
/**
 * Either leave dialog (story 7.12), by its title: `Upiši godišnji odmor`, or
 * `Izmijeni godišnji odmor {od}–{do}` whatever the range.
 */
const LEAVE_DIALOG = new RegExp(
  `^(${escapeRegExp(leave.recordDialogHeading)}|${escapeRegExp(leave.amendDialogHeading.split('{')[0] ?? '')}.+)$`,
);

/** `/ljudi` and `/ljudi/:id`: the member list with its add dialog (story
 *  7.13b, `?dodaj=1`) and a member's page — facts, each change in its own
 *  dialog (story 7.11) — with its team membership. */
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

  /** *Dodaj osobu* in the list's header: a button that opens the add dialog (story 7.13b). */
  get addButton(): Locator {
    return this.page.getByRole('main').getByRole('button', { name: hr.ljudi.form.add, exact: true }).first();
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

  // ---------------------------------------------- the list's filters (7.13)

  /** The shared filter bar's parts: the chips' group, the summary, `Poništi filtre`, `Filtri` and its sheet. */
  get filters(): FilterBarParts {
    return new FilterBarParts(this.page);
  }

  /** The list's search, beside the chips. */
  get searchInput(): Locator {
    return this.page.getByRole('searchbox', { name: hr.ljudi.search, exact: true });
  }

  /** The Razina chip, whatever it reads. */
  get levelChip(): Locator {
    return this.filters.bar.getByRole('button', { name: new RegExp(`^${escapeRegExp(hr.ljudi.chip.levelAll.replace(/\S+$/, ''))}`) });
  }

  /** The Status chip, whatever it reads. */
  get statusChip(): Locator {
    return this.filters.bar.getByRole('button', { name: new RegExp(`^${escapeRegExp(hr.ljudi.chip.status.replace('{value}', ''))}`) });
  }

  /** The Status chip's text for a value: `Status: aktivni`. */
  statusChipText(value: keyof typeof hr.ljudi.statusValue): string {
    return fill(hr.ljudi.chip.status, { value: hr.ljudi.statusValue[value] });
  }

  /** The Status chip's ✕ while `value` is set. */
  removeStatus(value: keyof typeof hr.ljudi.statusValue): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.chip.removeStatus, { value: hr.ljudi.statusValue[value] }), exact: true });
  }

  /** A status option in the Status chip's picker (from 640 px). */
  statusOption(value: keyof typeof hr.ljudi.statusFilter): Locator {
    return this.page
      .getByRole('dialog', { name: hr.ljudi.chip.statusPicker, exact: true })
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(hr.ljudi.statusFilter[value])}\\s*\\d`) });
  }

  /** A status radio in the phone's filter sheet. */
  sheetStatus(value: keyof typeof hr.ljudi.statusFilter): Locator {
    return this.filters.sheet.getByRole('radio', { name: new RegExp(`^${escapeRegExp(hr.ljudi.statusFilter[value])}\\s*\\d`) });
  }

  /** The status column's words for a scheduled change from `date` (ISO): `Od 05.10.: neaktivno`. */
  scheduledStatusText(date: string, active: boolean): string {
    return fill(active ? hr.ljudi.status.cellFromActive : hr.ljudi.status.cellFromInactive, { date: dayMonth(date) });
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

  // ------------------------------------------- the add dialog (story 7.13b)

  /** Opens the add dialog by its URL, `/ljudi?dodaj=1`, and waits for it. */
  async gotoNew(): Promise<void> {
    await this.page.goto('/ljudi?dodaj=1');
    await expect(this.addDialog).toBeVisible();
  }

  /** *Nova osoba*, the add dialog. */
  get addDialog(): Locator {
    return this.dialog(hr.ljudi.form.newHeading);
  }

  /** The person's name, on the add dialog and the basics dialog alike. */
  get nameInput(): Locator {
    return this.page.getByLabel(hr.ljudi.name, { exact: true });
  }

  /** The username, on the add dialog and the basics dialog alike. */
  get usernameInput(): Locator {
    return this.page.getByLabel(hr.ljudi.form.username, { exact: true });
  }

  /** The e-mail field, on the add dialog and the basics dialog alike. */
  get emailInput(): Locator {
    return this.page.getByLabel(hr.ljudi.email, { exact: true });
  }

  /** The role control, on the add dialog and the basics dialog alike. */
  get roleSelect(): Locator {
    return this.page.getByLabel(hr.ljudi.role, { exact: true });
  }

  /** The fire-rank control, on the add dialog and the basics dialog alike. */
  get rankSelect(): Locator {
    return this.page.getByLabel(hr.ljudi.rank.label, { exact: true });
  }

  /** The rank the control has selected. */
  get selectedRank(): Locator {
    return this.rankSelect.locator('option:checked');
  }

  /** The add dialog's name field. */
  get addNameInput(): Locator {
    return this.addDialog.getByLabel(hr.ljudi.name, { exact: true });
  }

  /** The add dialog's username field, suggested from the name. */
  get addUsernameInput(): Locator {
    return this.addDialog.getByLabel(hr.ljudi.form.username, { exact: true });
  }

  /** The add dialog's leave days. */
  get addLeaveInput(): Locator {
    return this.addDialog.getByLabel(hr.ljudi.leave, { exact: true });
  }

  /** The add dialog's rank control, offered while the organization uses ranks. */
  get addRankSelect(): Locator {
    return this.addDialog.getByLabel(hr.ljudi.rank.label, { exact: true });
  }

  /** The add dialog's final button, `Dodaj osobu`. */
  get addSubmitButton(): Locator {
    return this.addDialog.getByRole('button', { name: hr.ljudi.form.add, exact: true });
  }

  /** The add dialog's Odustani. */
  get addCancelButton(): Locator {
    return this.addDialog.getByRole('button', { name: hr.ljudi.form.cancel, exact: true });
  }

  /** The add dialog's close control. */
  get addCloseButton(): Locator {
    return this.addDialog.getByRole('button', { name: hr.ljudi.page.close, exact: true });
  }

  /** The second step's *Dodaj još jednu*. */
  get againButton(): Locator {
    return this.addDialog.getByRole('button', { name: hr.ljudi.form.again, exact: true });
  }

  /** The second step's *Otvori stranicu osobe*. */
  get openPageLink(): Locator {
    return this.addDialog.getByRole('link', { name: hr.ljudi.form.openPage, exact: true });
  }

  /** The second step's confirmation: `Račun je izrađen: {name} · {username}`. */
  createdStatus(name: string, username: string): Locator {
    return this.addDialog.getByRole('status').filter({ hasText: fill(hr.ljudi.form.createdFor, { name, username }) });
  }

  /** Fills the open add dialog's name and username. */
  async fillNewMember(name: string, username: string): Promise<void> {
    await this.addNameInput.fill(name);
    await this.addUsernameInput.fill(username);
  }

  /**
   * Fills and submits the open add dialog — the admin-auth Edge Function's
   * `createUser` — and waits for its second step. The address it builds is
   * under this run's domain, so teardown reaches it.
   */
  async submitNewMember(name: string, username: string): Promise<void> {
    await this.fillNewMember(name, username);
    await this.addSubmitButton.click();

    await expect(this.createdStatus(name, username)).toBeVisible();
  }

  /** Closes the add dialog from its close control, onto the list. */
  async closeAddDialog(): Promise<void> {
    await this.addCloseButton.click();
    await expect(this.addDialog).toBeHidden();
  }

  // ------------------------------------------- the member page (story 7.11)

  /** The page's title: the person's name. */
  memberHeading(name: string): Locator {
    return this.heading(name);
  }

  /** A fact card, a region named by its heading. */
  card(heading: string): Locator {
    return this.page.getByRole('region', { name: heading, exact: true });
  }

  /** *Osnovni podaci*. */
  get basicsCard(): Locator {
    return this.card(hr.ljudi.basics.heading);
  }

  /** *Smjena*. */
  get teamCard(): Locator {
    return this.card(membership.column);
  }

  /** *Status*. */
  get statusCard(): Locator {
    return this.card(hr.ljudi.status.heading);
  }

  /** *Prijava*. */
  get signInCard(): Locator {
    return this.card(hr.ljudi.form.signInHeading);
  }

  /** `Uredi` on *Osnovni podaci*, named for the member. */
  editBasicsButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.basics.editName, { name }), exact: true });
  }

  /** The basics dialog. */
  get basicsDialog(): Locator {
    return this.dialog(hr.ljudi.basics.dialogHeading);
  }

  /** The basics dialog's Spremi. */
  get basicsSaveButton(): Locator {
    return this.basicsDialog.getByRole('button', { name: hr.ljudi.form.save, exact: true });
  }

  /** `Promijeni pravo` on the leave card, named for the member. */
  changeAllowanceButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.allowance.changeName, { name }), exact: true });
  }

  /** The allowance dialog. */
  get allowanceDialog(): Locator {
    return this.dialog(hr.ljudi.allowance.dialogHeading);
  }

  /** The allowance dialog's one field. */
  get allowanceInput(): Locator {
    return this.allowanceDialog.getByLabel(hr.ljudi.leave, { exact: true });
  }

  /** The allowance dialog's Spremi. */
  get allowanceSaveButton(): Locator {
    return this.allowanceDialog.getByRole('button', { name: hr.ljudi.form.save, exact: true });
  }

  /** Changes the open member's allowance to `days` through its dialog, and waits for it to close. */
  async changeAllowance(name: string, days: number): Promise<void> {
    await this.changeAllowanceButton(name).click();
    await this.allowanceInput.fill(String(days));
    await this.allowanceSaveButton.click();
    await expect(this.allowanceDialog).toHaveCount(0);
  }

  /** The member page's reset offer, naming the member. */
  resetButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.form.reset, { name }) });
  }

  /** The reset's confirm, in its confirmation. */
  resetConfirmButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.form.resetConfirm, { name }) });
  }

  /** `Kopiraj` beside the one-time password (story 7.8). */
  get copyButton(): Locator {
    return this.page.getByRole('button', { name: hr.ljudi.form.copy, exact: true });
  }

  /** The one-time password itself: four hyphen-joined words. */
  get issuedPassword(): Locator {
    return this.page.getByText(/^[a-z]{3,6}(-[a-z]{3,6}){3}$/);
  }

  /** Opens the add dialog by its URL and issues the account; the dialog stays on its second step. */
  async createMember(name: string, username: string): Promise<void> {
    await this.gotoNew();
    await this.submitNewMember(name, username);
  }

  // ------------------------------------------------------- the status

  /** The status dialog (story 7.11), deactivating or reactivating. */
  get statusDialog(): Locator {
    return this.page.getByRole('dialog', {
      name: new RegExp(`^(${escapeRegExp(hr.ljudi.status.deactivateHeading)}|${escapeRegExp(hr.ljudi.status.reactivateHeading)})$`),
    });
  }

  /** *Vrijedi od* in the status dialog. */
  get statusDateInput(): Locator {
    return this.statusDialog.getByLabel(hr.ljudi.status.date, { exact: true });
  }

  /** `Deaktiviraj` in the status card's header, named for the member: it opens the dialog. */
  deactivateButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.deactivate, { name }), exact: true });
  }

  /** The status dialog's final button: `Deaktiviraj`, the action itself. */
  get deactivateSaveButton(): Locator {
    return this.statusDialog.getByRole('button', { name: hr.ljudi.status.deactivateAction, exact: true });
  }

  /** The status card's offer to withdraw its scheduled change. */
  statusWithdrawButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.withdraw, { name }) });
  }

  /** That withdrawal's confirm, in the status card's confirmation. */
  statusWithdrawConfirmButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(hr.ljudi.status.withdrawConfirm, { name }) });
  }

  /** Deactivates the open member from the dialog's default date: the header button, then the action. */
  async deactivate(name: string): Promise<void> {
    await this.deactivateButton(name).click();
    await this.deactivateSaveButton.click();
  }

  // ------------------------------------------------- the erasure guard (5.5e)

  /**
   * The team or status card's erasure dialog (story 5.5e), its save named
   * `save` — the card's own confirm, as its confirmation words it.
   */
  memberErasures(save: string): ErasureDialogParts {
    return new ErasureDialogParts(this.page, { ...hr.ljudi.erasures, save });
  }

  /** The refusal, inside a card's dialog or confirmation, when what its change would erase cannot be checked. */
  get memberUnchecked(): Locator {
    return this.alertWith(hr.ljudi.erasures.unavailable);
  }

  /** That refusal's retry. */
  get memberUncheckedRetry(): Locator {
    return this.memberUnchecked.getByRole('button', { name: hr.ljudi.erasures.retry, exact: true });
  }

  // ------------------------------------------------ the team membership

  /** The team dialog (story 7.11): *Nova smjena*, *Položaj* and *Vrijedi od*. */
  get teamDialog(): Locator {
    return this.dialog(membership.dialogHeading);
  }

  /** *Nova smjena*, which opens on `Odaberi smjenu`. */
  get teamSelect(): Locator {
    return this.teamDialog.getByLabel(membership.team, { exact: true });
  }

  /** The team the picker has selected. */
  get selectedTeam(): Locator {
    return this.teamSelect.locator('option:checked');
  }

  get positionSelect(): Locator {
    return this.teamDialog.getByLabel(hr.smjene.position.label, { exact: true });
  }

  /** The team dialog's Spremi. */
  get teamSaveButton(): Locator {
    return this.teamDialog.getByRole('button', { name: membership.save, exact: true });
  }

  /** The position the control has selected. */
  get selectedPosition(): Locator {
    return this.positionSelect.locator('option:checked');
  }

  /** *Vrijedi od* in the team dialog. */
  get dateInput(): Locator {
    return this.teamDialog.getByLabel(membership.date, { exact: true });
  }

  /** `Promijeni` in the team card's header, named for the member: it opens the dialog. */
  moveButton(name: string): Locator {
    return this.page.getByRole('button', { name: fill(membership.move, { name }), exact: true });
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

  /** The leave card's heading: *Godišnji odmor*, with its leave year once read (story 7.11). */
  get leaveHeading(): Locator {
    return this.page.getByRole('heading', { level: 2, name: LEAVE_HEADING });
  }

  /** The leave card, a region named by its heading. */
  get leaveCard(): Locator {
    return this.page.getByRole('region', { name: LEAVE_HEADING });
  }

  /**
   * The figure under `label` in the leave card or its open dialog — the
   * allowance, used, the balance; the cost, *Bilo*, *Sada* or the balance
   * after. A `<dt>`/`<dd>` pair in its own `<div>`, which no role or label
   * reaches as a pair.
   */
  leaveFigure(label: string): Locator {
    return this.leaveCard
      .or(this.leaveDialog)
      .locator('dl > div')
      .filter({ has: this.page.getByRole('term').getByText(label, { exact: true }) })
      .getByRole('definition');
  }

  /** *Upiši godišnji* in the leave card's header (story 7.12): it opens the record dialog. */
  get recordLeaveButton(): Locator {
    return this.leaveCard.getByRole('button', { name: leave.record });
  }

  /** Whichever leave dialog is open — a new record's or an amend's (story 7.12). */
  get leaveDialog(): Locator {
    return this.dialog().filter({ has: this.page.getByRole('heading', { name: LEAVE_DIALOG }) });
  }

  /** The new record's dialog, `Upiši godišnji odmor`. */
  get leaveRecordDialog(): Locator {
    return this.dialog(leave.recordDialogHeading);
  }

  /** The amend dialog of the record `from`–`to`, both `YYYY-MM-DD`. */
  leaveAmendDialog(from: string, to: string): Locator {
    return this.dialog(fill(leave.amendDialogHeading, { from: fullDate(from), to: fullDate(to) }));
  }

  get leaveFromInput(): Locator {
    return this.leaveDialog.getByLabel(leave.from, { exact: true });
  }

  get leaveToInput(): Locator {
    return this.leaveDialog.getByLabel(leave.to, { exact: true });
  }

  get saveLeaveButton(): Locator {
    return this.leaveDialog.getByRole('button', { name: leave.save, exact: true });
  }

  /** The record dialog's Odustani. */
  get cancelLeaveButton(): Locator {
    return this.leaveDialog.getByRole('button', { name: leave.cancel, exact: true });
  }

  get amendSaveButton(): Locator {
    return this.leaveDialog.getByRole('button', { name: leave.amendSave, exact: true });
  }

  get amendCancelButton(): Locator {
    return this.leaveDialog.getByRole('button', { name: leave.amendCancel, exact: true });
  }

  /** A conflict as the leave dialog names it (story 7.12): `pon 21.12. Dan`, `date` `YYYY-MM-DD`. */
  leaveConflictLine(date: string, type: string): string {
    return fill(leave.conflictLine, { weekday: weekdayShort(date), date: dayMonth(date), type });
  }

  /**
   * One group of an amend's conflicts as its line reads (story 7.12):
   * `summary` — `conflictsCleared`, `conflictsKept` or `conflictsNew` — counted
   * by `lines`, then the lines joined as the app's `formatList` joins them.
   */
  leaveConflictGroup(summary: string, lines: readonly string[]): string {
    return fill(leave.conflictsGroup, {
      summary: plural(summary, lines.length),
      lines: new Intl.ListFormat('hr', { style: 'long', type: 'conjunction' }).format(lines),
    });
  }

  /** The records list's heading, where focus lands when a closed dialog has no opener (story 7.12). */
  get leaveRecordsHeading(): Locator {
    return this.leaveCard.getByRole('heading', { level: 3, name: leave.recordsHeading, exact: true });
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
    return this.leaveDialog.locator('#member-leave-preview');
  }

  /** The retry the leave card's unavailable line offers. */
  get retryLeaveButton(): Locator {
    return this.leaveCard.getByRole('button', { name: leave.retry });
  }

  /**
   * Enters an od–do range, both `YYYY-MM-DD`, in the open leave dialog —
   * opening the record dialog first when none is open (story 7.12).
   */
  async enterLeave(from: string, to: string): Promise<void> {
    if (!(await this.leaveDialog.isVisible())) {
      await this.recordLeaveButton.click();
      await expect(this.leaveRecordDialog).toBeVisible();
    }
    await this.leaveFromInput.fill(from);
    await this.leaveToInput.fill(to);
  }

  /** Puts the open member on a team from the dialog's default date: open, pick, Spremi, closed. */
  async moveToTeam(teamName: string, name: string): Promise<void> {
    await this.moveButton(name).click();
    await this.teamSelect.selectOption({ label: teamName });
    await this.teamSaveButton.click();
    await expect(this.teamDialog).toHaveCount(0);
  }
}
