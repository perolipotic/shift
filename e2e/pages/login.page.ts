import { expect, type Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

/** `/prijava` and `/prijava/:slug`: the organization prompt, then the sign-in form. */
export class LoginPage extends BasePage {
  protected readonly path = '/prijava';

  /** The organization prompt's h1. */
  get organizationHeading(): Locator {
    return this.heading(hr.auth.organization.heading);
  }

  get organizationInput(): Locator {
    return this.page.getByLabel(hr.auth.organization.label, { exact: true });
  }

  get usernameInput(): Locator {
    return this.page.getByLabel(hr.auth.username, { exact: true });
  }

  get passwordInput(): Locator {
    return this.page.getByLabel(hr.auth.password, { exact: true });
  }

  /** The real two-step sign-in: organization, then username and password,
   *  through GoTrue. Leaves the page wherever the attempt lands. */
  async submitSignIn(slug: string, username: string, password: string): Promise<void> {
    await this.goto();
    await this.organizationInput.fill(slug);
    await this.page.getByRole('button', { name: hr.auth.organization.submit }).click();
    await expect(this.page).toHaveURL(`/prijava/${slug}`);

    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.page.getByRole('button', { name: hr.auth.submit }).click();
  }

  /** Signs in and waits for the landing destination. */
  async signIn(slug: string, username: string, password: string): Promise<void> {
    await this.submitSignIn(slug, username, password);
    await expect(this.page).toHaveURL('/danas');
    await expect(this.heading(hr.nav.danas)).toBeVisible();
  }
}
