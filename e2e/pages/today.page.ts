import type { Locator } from '@playwright/test';

import { escapeRegExp, fill, hr, plural } from '../utils/i18n.ts';
import { BasePage } from './base.page.ts';

const danas = hr.danas;
const admin = danas.admin;

/** A message's text before its first placeholder: `Sati · ` of `Sati · {month} {year}`. */
function leadOf(message: string): string {
  return message.split('{')[0] ?? message;
}

/**
 * `/danas` for the viewer (story 6.1a): the heading's date subline, today's
 * card (one case as its heading), the next shift's card, the next seven days
 * and the unavailable alert's retry. Below the week, the hours and leave
 * tiles (story 6.1b), each a link to its detail view. On a 24 h duty, the
 * duty-block in today's card's place (story 6.2). The team line below them
 * is the roster's (`teams.page.ts`).
 *
 * For an admin (story 6.3): *Treba tebe* with its count, its rows (each a
 * link to its conflict) and "Otvori konflikte (n)"; *Pokrivenost danas*;
 * *Odsutni danas*; and *Ovaj tjedan*, a grid in a scrolling region whose
 * cells are named in words — each block with its way to its list view.
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

  /** Today's duty-block (story 6.2), by the region its kicker names: `Na dužnosti · 24 h bez pauze`. */
  get dutyBlock(): Locator {
    return this.card(new RegExp(`^${escapeRegExp(leadOf(danas.duty.kicker))}`));
  }

  /** The duty-block's progress bar; its valuetext says how much is done in words. */
  get dutyProgress(): Locator {
    return this.dutyBlock.getByRole('progressbar');
  }

  /** The duty-block's legs, one per scheduled shift, in order. */
  get dutyLegs(): Locator {
    return this.dutyBlock.getByRole('listitem');
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

  /** *Treba tebe* (story 6.3), by the region its heading names. */
  get needsYouCard(): Locator {
    return this.card(admin.needsYou.heading);
  }

  /** *Treba tebe*'s count, `7 neriješenih konflikata`, for `count`. */
  needsYouCount(count: number): Locator {
    return this.needsYouCard.getByText(plural(hr.raspored.count, count), { exact: true });
  }

  /** *Treba tebe*'s rows, each the link to its conflict's resolution screen, in order. */
  get needsYouRowLinks(): Locator {
    return this.needsYouCard.getByRole('list').getByRole('link');
  }

  /** "Otvori konflikte (n)" for `count`, or whatever it counts. */
  openConflictsLink(count?: number): Locator {
    const name =
      count === undefined
        ? new RegExp(`^${escapeRegExp(admin.needsYou.open).replace('\\{count\\}', '\\d+')}$`)
        : fill(admin.needsYou.open, { count: String(count) });

    return this.page.getByRole('link', typeof name === 'string' ? { name, exact: true } : { name });
  }

  /** *Pokrivenost danas*. */
  get coverageCard(): Locator {
    return this.card(admin.coverage.heading);
  }

  /** The coverage's way to the calendar. */
  get coverageLink(): Locator {
    return this.coverageCard.getByRole('link', { name: admin.coverage.link, exact: true });
  }

  /** *Odsutni danas*. */
  get absentCard(): Locator {
    return this.card(admin.absent.heading);
  }

  /** The absences' way to *Godišnji*. */
  get absentLink(): Locator {
    return this.absentCard.getByRole('link', { name: admin.absent.link, exact: true });
  }

  /** *Ovaj tjedan*. */
  get weekCard(): Locator {
    return this.card(admin.week.heading);
  }

  /** The week's grid region, which scrolls on its own and takes focus. */
  get weekRegion(): Locator {
    return this.card(admin.week.region);
  }

  /** The week's grid (Kalendar's model: one tab stop, the arrow keys). */
  get weekGridTable(): Locator {
    return this.weekRegion.getByRole('grid');
  }

  /** A week cell, by its full name in words. */
  weekCell(name: string): Locator {
    return this.weekGridTable.getByRole('gridcell', { name, exact: true });
  }

  /** The week grid's one tab stop: the cell with `tabindex="0"`, which no role or label reaches. */
  get weekTabStop(): Locator {
    return this.weekGridTable.locator('[role="gridcell"][tabindex="0"]');
  }

  /** The week's team names, one row header per team, in row order. */
  get weekTeamHeaders(): Locator {
    return this.weekGridTable.getByRole('rowheader');
  }

  /** A team's name in the page, the link to its roster (the admin's subtitle). */
  teamLink(name: string): Locator {
    return this.page.getByRole('main').getByRole('link', { name, exact: true });
  }

  /** The week's way to the calendar. */
  get weekLink(): Locator {
    return this.weekCard.getByRole('link', { name: admin.week.link, exact: true });
  }

  /** The admin body's unavailable alert. */
  get adminUnavailableAlert(): Locator {
    return this.page.getByRole('alert').filter({ hasText: admin.unavailable });
  }
}
