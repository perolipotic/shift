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
  protected readonly path = '/organizacija';

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
