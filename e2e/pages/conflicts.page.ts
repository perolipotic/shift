import type { Locator } from '@playwright/test';

import { hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const raspored = hr.raspored;

/**
 * `/raspored`: the conflicts queue (story 5.3b) — its count, always shown,
 * a row per unresolved conflict (upcoming soonest first, then past most
 * recent first), the empty sentence, or, in their place, the failure with its
 * retry.
 */
export class ConflictsPage extends BasePage {
  protected readonly path = '/raspored';

  /** The count's heading (h2), for `count` conflicts. */
  countHeading(count: number): Locator {
    return this.page.getByRole('heading', { level: 2, name: plural(raspored.count, count), exact: true });
  }

  /** The count's heading, whatever it counts. */
  get anyCountHeading(): Locator {
    return this.page.getByRole('heading', { level: 2 });
  }

  /** The queue's list: the one list inside the section its count names. */
  get list(): Locator {
    return this.page.getByRole('main').getByRole('region').getByRole('list');
  }

  /** Every row of the queue, in the order it is shown. */
  get rows(): Locator {
    return this.list.getByRole('listitem');
  }

  /** The rows of one member, by name, in the order they are shown. */
  rowsOf(memberName: string): Locator {
    return this.rows.filter({ hasText: memberName });
  }

  /** The sentence an organization with no conflicts reads. */
  get emptySentence(): Locator {
    return this.page.getByText(raspored.empty, { exact: true });
  }

  /** The retry the unavailable alert offers. */
  get retryButton(): Locator {
    return this.page.getByRole('button', { name: raspored.retry, exact: true });
  }
}
