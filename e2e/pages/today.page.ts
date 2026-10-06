import type { Locator } from '@playwright/test';

import { escapeRegExp, hr } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const danas = hr.danas;

/** A message's text before its first placeholder: `Sati · ` of `Sati · {month} {year}`. */
function leadOf(message: string): string {
  return message.split('{')[0] ?? message;
}

/**
 * `/danas` for the viewer (story 6.1a): the heading's date subline, today's
 * card (one case as its heading), the next shift's card, the next seven days
 * and the unavailable alert's retry. Below the week, the hours and leave
 * tiles (story 6.1b), each a link to its detail view. The team line below
 * them is the roster's (`teams.page.ts`).
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

  /** The hours tile with its figures: the link to *Sati* its kicker opens (`Sati · Listopad 2026`). */
  get hoursTile(): Locator {
    return this.page.getByRole('link', { name: new RegExp(`^${escapeRegExp(leadOf(danas.tiles.hoursKicker))}`) });
  }

  /** The hours tile's total, its second paragraph (after the kicker). */
  get hoursTileTotal(): Locator {
    return this.hoursTile.locator('p').nth(1);
  }

  /** The hours tile's bands, `Dan 84 h · Noć 96 h`, its third paragraph. */
  get hoursTileBands(): Locator {
    return this.hoursTile.locator('p').nth(2);
  }

  /** The hours tile in *Sati*'s unavailable state: still the link to *Sati*. */
  get hoursTileUnavailable(): Locator {
    return this.page.getByRole('link', { name: hr.sati.error.unavailable, exact: true });
  }

  /** The leave tile with its figures: the link to *Godišnji* its kicker opens. */
  get leaveTile(): Locator {
    return this.page.getByRole('link', { name: new RegExp(`^${escapeRegExp(danas.tiles.leaveKicker)} `) });
  }

  /** The leave tile in *Godišnji*'s unavailable state: still the link to *Godišnji*. */
  get leaveTileUnavailable(): Locator {
    return this.page.getByRole('link', { name: hr.godisnji.unavailable, exact: true });
  }

  /** The leave tile's balance, its second paragraph. */
  get leaveTileBalance(): Locator {
    return this.leaveTile.locator('p').nth(1);
  }

  /** The leave tile's hint, `preostalo · iskorišteno 3 od 20`, its third paragraph. */
  get leaveTileHint(): Locator {
    return this.leaveTile.locator('p').nth(2);
  }
}
