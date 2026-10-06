import type { Locator } from '@playwright/test';

import { escapeRegExp, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const danas = hr.danas;

/**
 * `/danas` for the viewer (story 6.1a): the heading's date subline, today's
 * card (one case as its heading), the next shift's card, the next seven days
 * and the unavailable alert's retry. The team line below them is the roster's
 * (`teams.page.ts`).
 */
export class TodayPage extends BasePage {
  protected readonly path = '/danas';

  /** A card, by the region its h2 names: today's case, the next shift, or the week. */
  card(heading: string | RegExp): Locator {
    return this.page.getByRole('region', typeof heading === 'string' ? { name: heading, exact: true } : { name: heading });
  }

  /** Today's card, by its case: `Danas radiš`, `Danas ne radiš` or `Danas si na godišnjem odmoru`. */
  todayCard(caseText: string): Locator {
    return this.card(caseText);
  }

  /** The next shift's card, headed `Sljedeća smjena · za …` or `Vraćaš se · za …`. */
  get nextShiftCard(): Locator {
    const heading = (message: string) => escapeRegExp(message).replace(/\\\{\w+\\\}/g, '.+');

    return this.card(new RegExp(`^(?:${heading(danas.next.heading)}|${heading(danas.next.returnHeading)}|${escapeRegExp(danas.next.title)})$`));
  }

  /** The next shift card's heading (h2). */
  get nextShiftHeading(): Locator {
    return this.nextShiftCard.getByRole('heading', { level: 2 });
  }

  /** The week's list, inside the region its heading names. */
  get weekList(): Locator {
    return this.card(danas.week.heading).getByRole('list');
  }

  /** Each of the seven days, in order. */
  get weekDays(): Locator {
    return this.weekList.getByRole('listitem');
  }

  /** The week's way to the calendar. */
  get calendarLink(): Locator {
    return this.page.getByRole('link', { name: danas.week.link, exact: true });
  }

  /** The unavailable alert. */
  get unavailableAlert(): Locator {
    return this.page.getByRole('alert').filter({ hasText: danas.unavailable });
  }

  get retryButton(): Locator {
    return this.page.getByRole('button', { name: danas.retry, exact: true });
  }
}
