import type { Locator } from '@playwright/test';

import { hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const setPassword = hr.auth.setPassword;

/** `/postavi-lozinku`: the first sign-in's set-password step (story 7.8). */
export class SetPasswordPage extends BasePage {
  protected readonly path = '/postavi-lozinku';

  /** Postavi svoju lozinku, the step's h1. */
  get stepHeading(): Locator {
    return this.heading(setPassword.heading);
  }

  get passwordInput(): Locator {
    return this.page.getByLabel(setPassword.password, { exact: true });
  }

  get repeatInput(): Locator {
    return this.page.getByLabel(setPassword.repeat, { exact: true });
  }

  get submitButton(): Locator {
    return this.page.locator('form button[type="submit"]');
  }

  // `Odjava` is `BasePage.signOutButton`: the step's own button carries the
  // chrome's word.

  /** Types both fields and presses `Spremi i nastavi`. */
  async save(password: string, repeat = password): Promise<void> {
    await this.passwordInput.fill(password);
    await this.repeatInput.fill(repeat);
    await this.submitButton.click();
  }
}
