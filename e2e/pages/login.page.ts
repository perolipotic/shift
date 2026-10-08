import { expect, type Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

/**
 * `/prijava` and `/prijava/:slug`: one sign-in form (story 7.7). With a slug in
 * the URL the organization is a read-only row with `Promijeni`; without one it
 * is a field, prefilled from the last organization signed into on this device.
 */
export class LoginPage extends BasePage {
  protected readonly path = '/prijava';

  /** The sign-in form's h1. */
  get signInHeading(): Locator {
    return this.heading(hr.auth.heading);
  }

  /** The organization field, on bare `/prijava` or after `Promijeni`. */
  get organizationInput(): Locator {
    return this.page.getByRole('textbox', { name: hr.auth.organization.label, exact: true });
  }

  /** The URL slug's read-only row, on `/prijava/:slug`. */
  get organizationRow(): Locator {
    return this.page.getByRole('group', { name: hr.auth.organization.label, exact: true });
  }

  /** Promijeni, on the URL slug's row. */
  get changeOrganizationButton(): Locator {
    return this.page.getByRole('button', { name: hr.auth.organization.changeLabel, exact: true });
  }

  get usernameInput(): Locator {
    return this.page.getByLabel(hr.auth.username, { exact: true });
  }

  get passwordInput(): Locator {
    return this.page.getByLabel(hr.auth.password, { exact: true });
  }

  /** Prikaži lozinku, the toggle inside the password field. */
  get passwordToggle(): Locator {
    return this.page.getByRole('button', { name: hr.auth.passwordShow, exact: true });
  }

  /** Prijava, or Prijava… while signing in: the one submit button, by type,
   *  since its name changes while the exchange is in flight. */
  get submitButton(): Locator {
    return this.page.locator('form button[type="submit"]');
  }

  /** Zaboravljena lozinka?, the disclosure under the button. */
  get forgotButton(): Locator {
    return this.page.getByRole('button', { name: hr.auth.forgot.trigger, exact: true });
  }

  /** The panel the disclosure opens. */
  get forgotPanel(): Locator {
    return this.page.locator('#forgot-password');
  }

  /** The real sign-in from bare `/prijava`, through GoTrue. Leaves the page
   *  wherever the attempt lands. */
  async submitSignIn(slug: string, username: string, password: string): Promise<void> {
    await this.goto();
    await this.continueSignIn(slug, username, password);
  }

  /** The same from wherever the form already is — after a signed-out
   *  redirect, whose return target rides the URL as `povratak`. */
  async continueSignIn(slug: string, username: string, password: string): Promise<void> {
    await this.fillCredentialsFor(slug, username, password);
    await this.submitButton.click();
  }

  /** Organization, username and password, without submitting. On a slug URL
   *  the row already names the organization, so only the two credentials are
   *  typed; otherwise the field is filled, replacing any prefill. */
  async fillCredentialsFor(slug: string, username: string, password: string): Promise<void> {
    await expect(this.usernameInput).toBeVisible();

    if (await this.organizationInput.isVisible()) {
      await this.organizationInput.fill(slug);
    } else {
      await expect(this.organizationRow).toContainText(slug);
    }

    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }

  /** Signs in and waits for the landing destination. */
  async signIn(slug: string, username: string, password: string): Promise<void> {
    await this.submitSignIn(slug, username, password);
    await expect(this.page).toHaveURL('/danas');
    await expect(this.heading(hr.nav.danas)).toBeVisible();
  }
}
