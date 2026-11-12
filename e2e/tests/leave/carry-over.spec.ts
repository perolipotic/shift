import { randomBytes } from 'node:crypto';

import type { Browser, Page } from '@playwright/test';

import {
  holdRotation,
  leaveYearStartOf,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { escapeRegExp, hr, icu, plural } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';
import { LeavePage } from '../../pages/leave.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { TodayPage } from '../../pages/today.page.ts';

/**
 * Story 13.4b: carried days are derived and shown on every balance surface.
 *
 * THE SHARED ORGANIZATION NEVER HOLDS A SETTING HERE. Every organization read
 * this test's pages make is answered with a carry-over set through
 * `page.route` — cap 5, the expiry on the current leave year's last day, the
 * current leave year the first carried into — so no other spec ever sees it.
 *
 * A fresh member on a team of the test's own (the rotation seeded from today,
 * `[Dan, Noć, Slobodno, Slobodno]`, under the run's rotation hold) has no
 * record in the previous leave year, so it ends at its allowance of 20 and 5
 * days carry in. A record from today costs its working days N. The member's
 * *Danas* tile and *Godišnji* read the line *Preneseno 5 dana (istječu …)* and
 * a balance of 20 + 5 − N; the admin's member card has the same *Preneseno*
 * row, and the overview's *Preneseno* column reads `5 (istječu …)` with
 * *Preostalo* 25 − N, so allowance + carried − used = balance on each.
 */

test.use({ storageState: ADMIN_STATE });

const godisnji = hr.godisnji;
const days = hr.count.days;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { slug: string; members: string[]; teams: string[] } = { slug: '', members: [], teams: [] };

test.afterEach(async () => {
  try {
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
    const own = written;
    written = { slug: '', members: [], teams: [] };
    try {
      for (const id of own.members) await removeLeaveMemberInSql(own.slug, id);
      for (const id of own.teams) await removeTeamInSql(own.slug, id);
    } finally {
      await hold?.release();
      hold = null;
    }
  }
});

/** An ISO date `count` days after another, by calendar arithmetic in UTC. */
function isoDaysAfter(iso: string, count: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);

  return day.toISOString().slice(0, 10);
}

/** The current leave year's number (the calendar year it begins in) and its last day. */
function leaveYearOf(today: string, start: { readonly month: number; readonly day: number }): { number: number; last: string } {
  const startIn = (year: number) =>
    `${String(year)}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  const year = Number(today.slice(0, 4));
  const number = today >= startIn(year) ? year : year - 1;

  return { number, last: isoDaysAfter(startIn(number + 1), -1) };
}

/** The seeded pattern's working days (`Dan`, `Noć`) from `today` to `last`, the pattern starting on `today`. */
function workingDaysOf(today: string, last: string): number {
  let count = 0;
  for (let offset = 0; isoDaysAfter(today, offset) <= last; offset += 1) {
    if (offset % 4 < 2) count += 1;
  }

  return count;
}

/** The carry-over every organization read is answered with, as `0057`'s columns. */
interface Columns {
  readonly carry_over_max_days: number;
  readonly carry_over_expiry_month: number;
  readonly carry_over_expiry_day: number;
  readonly carry_over_first_leave_year: number;
}

/**
 * Answers every organization read that selects the carry-over columns with
 * `columns` in place of the stored ones — an object or an array of rows,
 * whichever PostgREST answered. Nothing is written.
 */
async function answerWithCarryOver(page: Page, columns: Columns): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/organizations') && url.search.includes('carry_over_max_days'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body: unknown = await response.json();
      const json = Array.isArray(body)
        ? body.map((row: Record<string, unknown>) => ({ ...row, ...columns }))
        : { ...(body as Record<string, unknown>), ...columns };
      await route.fulfill({ response, json });
    },
  );
}

/** A fresh context signed in as `member`, its organization reads answered with `columns`. */
async function signedInAs(browser: Browser, slug: string, member: SeededLeaveMember, columns: Columns): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await answerWithCarryOver(page, columns);
    await new LoginPage(page).signIn(slug, member.username, member.password);

    return page;
  } catch (cause) {
    await context.close();
    throw cause;
  }
}

test('carried days show on Danas, Godišnji, the member card and the overview, each adding up to the balance', async ({
  browser,
  page,
  peoplePage,
  leavePage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  hold = holdRotation(fixture.slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
  written = { slug: fixture.slug, members: [], teams: [team.id] };
  seed = await seedTeamRotation(fixture.slug, team.id, suffix);
  const today = seed.today;
  // On 29.02. a leave year ending that day could only expire on 28.02., already past.
  test.skip(today.slice(5) === '02-29', 'the expiry cannot be 29.02., so today would already be past it');
  const year = leaveYearOf(today, await leaveYearStartOf(fixture.slug));
  const plusFour = isoDaysAfter(today, 4);
  const last = plusFour <= year.last ? plusFour : year.last;
  const cost = workingDaysOf(today, last);
  expect(cost, 'the range holds a working day').toBeGreaterThan(0);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  written.members.push(member.id);
  await seedLeaveRecord(fixture.slug, member.id, today, last);

  // THE EXPIRY on the leave year's last day, so the days are never past it
  // today; 28.02. for a last day of 29.02., which the setting cannot hold
  // (today is not 29.02.: skipped above).
  const expiryMonth = Number(year.last.slice(5, 7));
  const expiryDay = year.last.endsWith('-02-29') ? 28 : Number(year.last.slice(8, 10));
  const columns: Columns = {
    carry_over_max_days: 5,
    carry_over_expiry_month: expiryMonth,
    carry_over_expiry_day: expiryDay,
    carry_over_first_leave_year: year.number,
  };
  const date = `${String(expiryDay).padStart(2, '0')}.${String(expiryMonth).padStart(2, '0')}.`;
  const line = icu(godisnji.carried.pending, { count: 5, date });
  expect(line).toBe(`Preneseno 5 dana (istječu ${date})`);
  const balance = 20 + 5 - cost;

  // THE MEMBER: Danas, then Godišnji.
  const memberPage = await signedInAs(browser, fixture.slug, member, columns);
  try {
    const danas = new TodayPage(memberPage);
    await danas.goto();
    await expect(danas.leaveTileBalance).toHaveText(plural(days, balance));
    await expect(danas.leaveTileCarried).toHaveText(line);

    const mine = new LeavePage(memberPage);
    await mine.goto();
    await expect(mine.allowanceFigure).toHaveText(plural(days, 20));
    await expect(mine.usedFigure).toHaveText(plural(days, cost));
    await expect(mine.balanceFigure).toHaveText(plural(days, balance));
    await expect(mine.carriedLine).toHaveText(line);
  } finally {
    await memberPage.context().close();
  }

  // THE ADMIN: the member card's *Preneseno* row, then the overview's column.
  await answerWithCarryOver(page, columns);
  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.leaveFigure(hr.ljudi.leaveRecord.balance)).toHaveText(plural(days, balance));
  await expect(peoplePage.leaveFigure(hr.ljudi.leaveRecord.carried)).toHaveText(
    icu(godisnji.carriedDays.pending, { count: 5, date }),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await leavePage.goto(`?trazi=${encodeURIComponent(member.name)}`);
  await expect(leavePage.overviewTable.getByRole('columnheader', { name: godisnji.overview.carried, exact: true })).toBeVisible();
  const cells = leavePage.tableCells(member.name);
  await expect(cells.nth(2)).toHaveText('20');
  await expect(cells.nth(3)).toHaveText(icu(godisnji.overview.carriedCell.pending, { count: 5, date }));
  await expect(cells.nth(4)).toHaveText(String(cost));
  await expect(cells.nth(5)).toHaveText(String(balance));
  // The summary ends with the carried sum: this one row's 5 days.
  const carriedPart = godisnji.overview.summaryCarried.slice(godisnji.overview.summaryCarried.lastIndexOf(' · '));
  expect(icu(carriedPart, { carried: 5 })).toBe(' · preneseno ukupno 5 dana');
  await expect(leavePage.filters.summary).toHaveText(new RegExp(`${escapeRegExp(icu(carriedPart, { carried: 5 }))}$`));

  // THE PHONE: the stacked row's *Preneseno* field.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(leavePage.stackedFigure(member.name, godisnji.overview.carried)).toHaveText(
    icu(godisnji.overview.carriedCell.pending, { count: 5, date }),
  );
});
