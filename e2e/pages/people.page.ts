import { expect, type Locator } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

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
    return this.page.getByLabel(leave.from, { exact: true });
  }

  get leaveToInput(): Locator {
    return this.page.getByLabel(leave.to, { exact: true });
  }

  get saveLeaveButton(): Locator {
    return this.page.getByRole('button', { name: leave.save });
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
