import type { Locator, Page } from '@playwright/test';

import { hr } from '../utils/i18n.ts';

/**
 * The chrome every screen shares: the navigation, the page's h1, the page-wide
 * status, alert and dialog, and a screen's text by its `hr.json` message.
 *
 * A page object holds locators and actions, never assertions. It `expect`s
 * only to wait for a screen to be ready inside an action; every claim a test
 * makes stays in its spec (`e2e/README.md`).
 */
export abstract class BasePage {
  /** The screen's route, opened by `goto`. */
  protected abstract readonly path: string;

  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Opens the screen, with an optional `?…` search. */
  async goto(search = ''): Promise<void> {
    await this.page.goto(`${this.path}${search}`);
  }

  /** The navigation landmark. Only one of the two (sidebar, phone bar) is ever
   *  rendered visible, so the name resolves to exactly one. */
  get navigation(): Locator {
    return this.page.getByRole('navigation', { name: hr.shell.navigation });
  }

  /** A destination in the navigation. */
  navigationLink(name: string, options: { readonly exact?: boolean } = {}): Locator {
    return this.navigation.getByRole('link', { name, ...options });
  }

  /** The page's h1. */
  heading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', { level: 1, name });
  }

  /** The sidebar's profile card, named by the person's own name; it discloses the exit. */
  profileButton(name: string): Locator {
    return this.page.getByRole('button', { name });
  }

  /** Odjava, inside the profile menu (sidebar) or the *Više* sheet (phone). */
  get signOutButton(): Locator {
    return this.page.getByRole('button', { name: hr.shell.signOut });
  }

  /** The phone bar's *Više*, the fifth cell; it opens the sheet. */
  get moreButton(): Locator {
    return this.navigation.getByRole('button', { name: hr.shell.more, exact: true });
  }

  /** The *Više* sheet: the role's other destinations, the theme and Odjava. */
  get moreSheet(): Locator {
    return this.page.getByRole('dialog', { name: hr.shell.more, exact: true });
  }

  /** The theme group (Tema), wherever it is open: the profile menu or the sheet. */
  get themeGroup(): Locator {
    return this.page.getByRole('group', { name: hr.shell.theme.label, exact: true });
  }

  /** The page's status line (a confirmation). */
  get status(): Locator {
    return this.page.getByRole('status');
  }

  /** The status line that holds `text`. */
  statusWith(text: string): Locator {
    return this.status.filter({ hasText: text });
  }

  /** The page's alert (a refusal or a failure). */
  get alert(): Locator {
    return this.page.getByRole('alert');
  }

  /** The alert that holds `text`. */
  alertWith(text: string): Locator {
    return this.alert.filter({ hasText: text });
  }

  /** Any dialog, or the one named `name`. */
  dialog(name?: string): Locator {
    return name === undefined ? this.page.getByRole('dialog') : this.page.getByRole('dialog', { name });
  }

  /** A message on the screen, matched whole unless it is a pattern. */
  text(message: string | RegExp, options: { readonly exact?: boolean } = { exact: true }): Locator {
    return this.page.getByText(message, options);
  }
}
