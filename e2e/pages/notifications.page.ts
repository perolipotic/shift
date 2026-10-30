import type { Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const copy = hr.postavkeObavijesti;

/**
 * `/obavijesti` (story 10.3): the person's own notification settings, and the
 * fixed *Obavijesti* row that opens it from the *Više* sheet or the profile
 * menu.
 */
export class NotificationsPage extends BasePage {
  readonly path = '/obavijesti';

  /** The *Obavijesti* row inside the *Više* sheet. */
  get moreRow(): Locator {
    return this.moreSheet.getByRole('link', { name: hr.shell.notifications, exact: true });
  }

  /** The *Obavijesti* row inside the open profile menu. */
  get profileRow(): Locator {
    return this.profileMenu.getByRole('link', { name: hr.shell.notifications, exact: true });
  }

  /** `Nemaš upisan e-mail`. */
  get noAddress(): Locator {
    return this.page.getByText(copy.noAddress, { exact: true });
  }

  /** That the organization sends no email. */
  get organizationOff(): Locator {
    return this.page.getByText(copy.organizationOff, { exact: true });
  }

  /** An admin's way to *Organizacija* from the organization-off line. */
  get organizationOffLink(): Locator {
    return this.page.getByRole('link', { name: copy.organizationOffAdmin, exact: true });
  }

  /** The email section's failed save. */
  get saveFailed(): Locator {
    return this.emailSection.getByRole('alert').filter({ hasText: copy.saveFailed });
  }

  /** The *E-pošta* section. */
  get emailSection(): Locator {
    return this.page.getByRole('region', { name: copy.email, exact: true });
  }

  /** Every radio in the email section: the email on/off, when it is offered. */
  get radios(): Locator {
    return this.emailSection.getByRole('radio');
  }

  get emailOn(): Locator {
    return this.emailSection.getByRole('radio', { name: copy.on, exact: true });
  }

  get emailOff(): Locator {
    return this.emailSection.getByRole('radio', { name: copy.off, exact: true });
  }

  /** Story 10.4: the *Obavijesti na uređaju* section. */
  get pushSection(): Locator {
    return this.page.getByRole('region', { name: copy.pushHeading, exact: true });
  }

  get pushRadios(): Locator {
    return this.pushSection.getByRole('radio');
  }

  get pushOn(): Locator {
    return this.pushSection.getByRole('radio', { name: copy.on, exact: true });
  }

  get pushOff(): Locator {
    return this.pushSection.getByRole('radio', { name: copy.off, exact: true });
  }

  /** A line of the push section, by its exact text. */
  pushLine(text: string): Locator {
    return this.pushSection.getByText(text, { exact: true });
  }

  /** The push section's failed choice. */
  get pushFailed(): Locator {
    return this.pushSection.getByRole('alert').filter({ hasText: copy.saveFailed });
  }

  /** The address, shown read-only. */
  address(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  /** A landed save's line. */
  savedLine(text: string): Locator {
    return this.page.getByRole('status').filter({ hasText: text });
  }
}
