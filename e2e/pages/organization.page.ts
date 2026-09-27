import type { Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

/** `/organizacija`: the organization's settings, the fire-rank setting among them. */
export class OrganizationPage extends BasePage {
  protected readonly path = '/organizacija';

  get nameInput(): Locator {
    return this.page.getByLabel(hr.organization.name, { exact: true });
  }

  get fireRanksSelect(): Locator {
    return this.page.getByLabel(hr.organization.fireRanks, { exact: true });
  }

  /** Switches the fire-rank setting on. */
  async switchFireRanksOn(): Promise<void> {
    await this.fireRanksSelect.selectOption({ label: hr.organization.fireRanksOn });
  }
}
