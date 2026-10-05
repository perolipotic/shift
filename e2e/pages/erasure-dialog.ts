import type { Locator, Page } from '@playwright/test';

import { escapeRegExp, plural } from '../utils/i18n.ts';

/**
 * The words one surface's erasure confirmation says (stories 5.5a, 5.5b): the
 * ICU title, the two toggles, the way back, the kept hint and its own save.
 */
export interface ErasureWords {
  readonly title: string;
  readonly confirm: string;
  readonly keep: string;
  readonly back: string;
  readonly kept: string;
  readonly save: string;
}

/**
 * THE SHARED ERASURE CONFIRMATION'S LOCATORS (story 5.5b): the one
 * `ErasureDialog` the rotation builder and the calendar's roster changes both
 * render, each in its own words. Locators only, never an assertion
 * (`e2e/README.md`).
 */
export class ErasureDialogParts {
  private readonly page: Page;
  private readonly words: ErasureWords;

  constructor(page: Page, words: ErasureWords) {
    this.page = page;
    this.words = words;
  }

  /** The confirmation, named by its title for `count` conflicts. */
  dialog(count: number): Locator {
    return this.page.getByRole('dialog', { name: plural(this.words.title, count) });
  }

  /**
   * The confirmation whatever it counts: named by its title's words before
   * the count (`Poništavanje briše`), for a test that cannot know how many
   * conflicts a shared organization holds.
   */
  get anyDialog(): Locator {
    const head = plural(this.words.title, 1).split(' 1')[0] ?? '';

    return this.page.getByRole('dialog', { name: new RegExp(`^${escapeRegExp(head)} \\d+ `) });
  }

  /** The confirmation's conflict rows, in order: each holds its own "Potvrdi brisanje". */
  rowsIn(dialog: Locator): Locator {
    return dialog
      .getByRole('listitem')
      .filter({ has: this.page.getByRole('button', { name: this.words.confirm, exact: true }) });
  }

  /** A row's "Potvrdi brisanje" toggle. */
  confirmIn(row: Locator): Locator {
    return row.getByRole('button', { name: this.words.confirm, exact: true });
  }

  /** A row's "Zadrži" toggle. */
  keepIn(row: Locator): Locator {
    return row.getByRole('button', { name: this.words.keep, exact: true });
  }

  /** The confirmation's "Natrag na uređivanje". */
  backIn(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: this.words.back, exact: true });
  }

  /** The confirmation's own save. */
  saveIn(dialog: Locator): Locator {
    return dialog.getByRole('button', { name: this.words.save, exact: true });
  }

  /** The hint while a row is kept. */
  keptIn(dialog: Locator): Locator {
    return dialog.getByText(this.words.kept, { exact: true });
  }
}
