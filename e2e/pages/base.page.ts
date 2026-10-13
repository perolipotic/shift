import type { Locator, Page } from '@playwright/test';

import { fill, hr } from '../utils/i18n.ts';

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

  /** The page's h1; `exact` matches the whole name, not a part of it. */
  heading(name: string | RegExp, { exact = false }: { readonly exact?: boolean } = {}): Locator {
    return this.page.getByRole('heading', { level: 1, name, exact });
  }

  /** The page's h1, whatever it says. */
  get anyHeading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  /** The sidebar's *Sakrij izbornik*, which collapses it to the rail. */
  get menuHideButton(): Locator {
    return this.page.getByRole('button', { name: hr.shell.menuHide, exact: true });
  }

  /** The rail's *Prikaži izbornik*, which expands the sidebar again. */
  get menuShowButton(): Locator {
    return this.page.getByRole('button', { name: hr.shell.menuShow, exact: true });
  }

  /** The main landmark: the screen below the chrome. */
  get main(): Locator {
    return this.page.getByRole('main');
  }

  /** The main landmark while its read is in flight (`aria-busy`). */
  get busyMain(): Locator {
    return this.page.locator('main[aria-busy="true"]');
  }

  /** Every form mounted in the main landmark, open dialogs' included. */
  get mainForms(): Locator {
    return this.page.locator('main form');
  }

  /** The shell's own *Pokušaj ponovno*, on a read that failed. */
  get shellRetryButton(): Locator {
    return this.page.getByRole('button', { name: hr.shell.retry, exact: true });
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
  dialog(name?: string | RegExp): Locator {
    return name === undefined ? this.page.getByRole('dialog') : this.page.getByRole('dialog', { name });
  }

  /** An element the spec marked with the attribute `name` itself, to tell a
   *  remounted node from the one it marked. */
  markedWith(name: string): Locator {
    return this.page.locator(`[${name}]`);
  }

  /** A list's edit link, named by `message` (`Uredi … {name}`) for `name`.
   *  Each list screen names its own: `editLink` on people, teams and bands. */
  protected editLinkNamed(message: string, name: string): Locator {
    return this.page.getByRole('link', { name: fill(message, { name }) });
  }

  /** A message on the screen, matched whole unless it is a pattern. */
  text(message: string | RegExp, options: { readonly exact?: boolean } = { exact: true }): Locator {
    return this.page.getByText(message, options);
  }
}
