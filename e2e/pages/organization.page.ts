import { expect, type Locator } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const organization = hr.organization;

/**
 * `/organizacija`: the organization's settings as facts (story 7.18), each
 * change behind its own dialog with one Spremi — the fire-rank setting among
 * them.
 */
export class OrganizationPage extends BasePage {
  readonly path = '/organizacija';

  /** *Profil*'s `Promijeni` for the name, which opens the name's dialog. */
  get nameOpener(): Locator {
    return this.page.getByRole('button', { name: organization.changeName, exact: true });
  }

  /** The name's dialog. */
  get nameDialog(): Locator {
    return this.dialog(organization.changeName);
  }

  /** The name field, inside its dialog. */
  get nameInput(): Locator {
    return this.nameDialog.getByLabel(organization.name, { exact: true });
  }

  /** *Profil*'s `Promijeni` for the accent. */
  get accentOpener(): Locator {
    return this.page.getByRole('button', { name: organization.changeAccent, exact: true });
  }

  /** The accent's dialog, with its named radio cards. */
  get accentDialog(): Locator {
    return this.dialog(organization.changeAccent);
  }

  /** *Vrijeme i godina*'s `Uredi`, which opens the leave year's dialog. */
  get leaveYearOpener(): Locator {
    return this.page.getByRole('button', { name: organization.editLeaveYear, exact: true });
  }

  /** The fire-rank card's `Uredi`. */
  get fireRanksOpener(): Locator {
    return this.page.getByRole('button', { name: organization.editFireRanks, exact: true });
  }

  /** The fire-rank setting's dialog. */
  get fireRanksDialog(): Locator {
    return this.dialog(organization.fireRanks);
  }

  /** The email-notifications card's `Uredi` (story 10.3). */
  get emailNotificationsOpener(): Locator {
    return this.page.getByRole('button', { name: organization.editEmailNotifications, exact: true });
  }

  /** The email-notifications switch's dialog (story 10.3). */
  get emailNotificationsDialog(): Locator {
    return this.dialog(organization.emailNotifications);
  }

  /** The minimum-members card's `Uredi` (story 11.1). */
  get minimumMembersOpener(): Locator {
    return this.page.getByRole('button', { name: organization.editMinimumMembers, exact: true });
  }

  /** The minimum-members dialog (story 11.1). */
  get minimumMembersDialog(): Locator {
    return this.dialog(organization.minimumMembers);
  }

  /** The minimum-members card (story 11.1). */
  get minimumMembersRegion(): Locator {
    return this.page.getByRole('region', { name: organization.minimumMembers, exact: true });
  }

  /** The carry-over card's `Uredi` (story 13.4). */
  get carryOverOpener(): Locator {
    return this.page.getByRole('button', { name: organization.editCarryOver, exact: true });
  }

  /** The carry-over dialog (story 13.4). */
  get carryOverDialog(): Locator {
    return this.dialog(organization.carryOver);
  }

  /** The carry-over card (story 13.4). */
  get carryOverRegion(): Locator {
    return this.page.getByRole('region', { name: organization.carryOver, exact: true });
  }

  /** The cap, inside the carry-over dialog. */
  get carryOverMaxDays(): Locator {
    return this.carryOverDialog.getByLabel(organization.carryOverMaxDays, { exact: true });
  }

  /** The expiry's day, inside the carry-over dialog. */
  get carryOverExpiryDay(): Locator {
    return this.carryOverDialog.getByLabel(organization.carryOverExpiryDay, { exact: true });
  }

  /** The expiry's month, inside the carry-over dialog. */
  get carryOverExpiryMonth(): Locator {
    return this.carryOverDialog.getByLabel(organization.carryOverExpiryMonth, { exact: true });
  }

  /** The first leave year carried into, inside the carry-over dialog. */
  get carryOverFirstYear(): Locator {
    return this.carryOverDialog.getByLabel(organization.carryOverFirstYear, { exact: true });
  }

  /**
   * Clears the carry-over setting through its dialog (an empty cap) and waits
   * for the card to say so: the run's organization starts with none.
   */
  async clearCarryOver(): Promise<void> {
    await this.carryOverOpener.click();
    await this.carryOverMaxDays.fill('');
    await this.saveIn(this.carryOverDialog).click();
    await expect(this.carryOverDialog).toHaveCount(0);
    await expect(this.carryOverRegion.getByText(organization.carryOverNone, { exact: true })).toBeVisible();
  }

  /** *Vrijeme i godina*: the zone, locked, and the leave year. */
  get timeRegion(): Locator {
    return this.page.getByRole('region', { name: organization.timeHeading });
  }

  /** *Satni pojasi*: the card of facts about the hour bands. */
  get hourBandsRegion(): Locator {
    return this.page.getByRole('region', { name: organization.hourBands.heading, exact: true });
  }

  /** *Satni pojasi*'s fact of how much of the day the bands cover: the card drawn, not its skeleton. */
  get hourBandsCovered(): Locator {
    return this.hourBandsRegion.getByText(organization.hourBands.covered, { exact: true });
  }

  /** The header's way to the hour band editor, a client-side link (story 2.1b). */
  get hourBandsLink(): Locator {
    return this.main.getByRole('link', { name: organization.hourBands.heading, exact: true });
  }

  /** *Vrste odsutnosti* (story 13.1b): the absence types card. */
  get absenceTypesRegion(): Locator {
    return this.page.getByRole('region', { name: organization.absenceTypes.heading, exact: true });
  }

  /** The card's `Dodaj`, which opens the add dialog. */
  get absenceTypeAdd(): Locator {
    return this.absenceTypesRegion.getByRole('button', { name: organization.absenceTypes.addLabel, exact: true });
  }

  /** A row's `Uredi`, named by its type. */
  absenceTypeEdit(name: string): Locator {
    return this.absenceTypesRegion.getByRole('button', {
      name: fill(organization.absenceTypes.editLabel, { name }),
      exact: true,
    });
  }

  /** The row of the type named `name`. */
  absenceTypeRow(name: string): Locator {
    return this.absenceTypesRegion
      .getByRole('listitem')
      .filter({ has: this.page.getByText(name, { exact: true }) });
  }

  /** The add dialog. */
  get absenceTypeAddDialog(): Locator {
    return this.dialog(organization.absenceTypes.addHeading);
  }

  /** The edit dialog. */
  get absenceTypeEditDialog(): Locator {
    return this.dialog(organization.absenceTypes.editHeading);
  }

  /** The name field inside an absence type dialog. */
  absenceTypeName(dialog: Locator): Locator {
    return dialog.getByLabel(organization.absenceTypes.name, { exact: true });
  }

  /** One of the two drawing choices inside an absence type dialog. */
  absenceTypeDraws(dialog: Locator, draws: boolean): Locator {
    return dialog.getByRole('radio', {
      name: draws ? organization.absenceTypes.draws : organization.absenceTypes.doesNotDraw,
      exact: true,
    });
  }

  /** The Spremi of an absence type dialog. */
  absenceTypeSave(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: organization.absenceTypes.save, exact: true });
  }

  /** Every field mounted on the page outside a dialog's portal. */
  get mainFields(): Locator {
    return this.page.locator('main input, main select');
  }

  /** The Spremi of the dialog `within`. */
  saveIn(within: Locator): Locator {
    return within.getByRole('button', { name: organization.save, exact: true });
  }

  /** Switches the fire-rank setting on, in its dialog, and waits for the dialog to close. */
  async switchFireRanksOn(): Promise<void> {
    await this.fireRanksOpener.click();
    await this.fireRanksDialog.getByRole('radio', { name: organization.fireRanksOn, exact: true }).check();
    await this.saveIn(this.fireRanksDialog).click();
    await expect(this.fireRanksDialog).toHaveCount(0);
  }
}
