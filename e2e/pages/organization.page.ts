import { expect, type Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
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
