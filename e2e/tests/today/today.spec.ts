import { randomBytes } from 'node:crypto';

import type { Browser, BrowserContext } from '@playwright/test';

import { CalendarPage } from '../../pages/calendar.page.ts';
import { HoursPage } from '../../pages/hours.page.ts';
import { LeavePage } from '../../pages/leave.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { TodayPage } from '../../pages/today.page.ts';
import {
  holdRotation,
  removeLeaveRecordsInSql,
  removeSeededRotation,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, fullDate, weekdayOf } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 6.1a: *Danas* for the viewer. The fixture team gets a rotation in SQL
 * (`seedTeamRotation`: `[Dan, Noć, Slobodno, Slobodno]`) started some days
 * before today, under the run's rotation hold, so today falls on the step a
 * test wants. The member reads today in words — free on Slobodno, working on
 * Noć with its range and team — and the next working shift's date, type and
 * range, equal to the seeded rotation's; the seven days equal *Kalendar*'s
 * *Moj raspored* for the same dates. A fresh member with leave today reads
 * the leave case with its range, and their return as the next shift. Nothing
 * scrolls sideways at 390 px.
 *
 * Story 6.1b: below the week, the hours tile equals *Sati*'s month — its
 * total and every band's hours — and the leave tile equals *Godišnji*'s
 * balance and used days; the leave case states what the leave costs. A
 * failed resolutions read leaves the hours tile in *Sati*'s unavailable
 * sentence, still a link to *Sati*, and the leave tile unaffected.
 */

const danas = hr.danas;

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** A member whose live records are soft-removed afterwards. */
let withLeave: { readonly slug: string; readonly id: string } | null = null;
/** A context of the test's own, closed afterwards. */
let context: BrowserContext | null = null;

test.afterEach(async () => {
  try {
    await context?.close();
    if (withLeave !== null) await removeLeaveRecordsInSql(withLeave.slug, withLeave.id).catch(() => undefined);
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    context = null;
    withLeave = null;
    seed = null;
    await hold?.release();
    hold = null;
  }
});

/** The fixture team's rotation, started `daysBefore` days before today. */
async function seeded(slug: string, teamId: string, daysBefore: number): Promise<SeededRotation> {
  hold = holdRotation(slug);
  await hold.ready;
  seed = await seedTeamRotation(slug, teamId, randomBytes(3).toString('hex'), daysBefore);

  return seed;
}

/** The step `date` falls on, for a rotation started on `start`. */
function stepOn(rotation: SeededRotation, date: string): number {
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${rotation.start}T12:00:00Z`)) / 86_400_000);

  const length = rotation.steps.length;

  return ((days % length) + length) % length;
}

/** `Sljedeća smjena · za 2 dana`. */
function nextHeading(message: string, days: number): string {
  return fill(message, { days: plural(hr.count.days, days) });
}

/** A day row's text with its whitespace collapsed. */
function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The seven days *Danas* lists, each row's text, against *Kalendar*'s *Moj
 * raspored* row for the same date — month by month, as the week crosses
 * one — plus the leave word on the days `onLeave` names.
 */
async function expectWeekEqualsCalendar(
  todayPage: TodayPage,
  calendarPage: CalendarPage,
  today: string,
  onLeave: ReadonlySet<string> = new Set(),
): Promise<void> {
  await expect(todayPage.weekDays).toHaveCount(7);
  const shown = (await todayPage.weekDays.allInnerTexts()).map(normalized);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(today, index + 1));

  for (const [index, date] of dates.entries()) {
    expect(shown[index], `the week's day ${String(index + 1)}`).toContain(dayMonth(date));
  }

  for (const month of [...new Set(dates.map((date) => date.slice(0, 7)))]) {
    await calendarPage.goto(`?prikaz=moj&mjesec=${month}`);
    await expect(calendarPage.dayList).toBeVisible();
    for (const [index, date] of dates.entries()) {
      if (date.slice(0, 7) !== month) continue;
      const row = calendarPage.dayListItem(dayMonth(date));
      await expect(row).toHaveCount(1);
      const calendar = normalized(await row.innerText());
      const expected = onLeave.has(date) ? `${calendar} ${hr.kalendar.modifier.leave}` : calendar;
      expect(shown[index], `${date} on Danas and in Kalendar`).toBe(expected);
    }
  }
}

/** Every duration in a text, in order: `96 h`, `12 h 30 min`, `45 min`. */
function durationsIn(text: string): string[] {
  return [...text.matchAll(/\d+ h(?: \d+ min)?|\d+ min/g)].map((found) => found[0]);
}

/**
 * The two tiles against their detail views, read on the same page: the hours
 * tile's total and every band's hours equal *Sati*'s for the month, and the
 * leave tile's balance and used days equal *Godišnji*'s. Leaves the page on
 * *Godišnji*.
 */
async function expectTilesEqualDetailViews(todayPage: TodayPage, hoursPage: HoursPage, leavePage: LeavePage): Promise<void> {
  await todayPage.goto();
  await expect(todayPage.hoursTile).toBeVisible();
  await expect(todayPage.leaveTile).toBeVisible();
  const total = normalized(await todayPage.hoursTileTotal.innerText());
  const bands = durationsIn(normalized(await todayPage.hoursTileBands.innerText()));
  const balance = normalized(await todayPage.leaveTileBalance.innerText());
  const hint = normalized(await todayPage.leaveTileHint.innerText());

  await hoursPage.goto();
  await expect(hoursPage.totalTile).toBeVisible();
  // Exact: the figure itself, never a substring of it (`80 h` in `180 h`).
  await expect(hoursPage.figureIn(hoursPage.totalTile, total)).toBeVisible();
  expect((await hoursPage.bandHours()).map(normalized), 'every band, in Sati’s order').toEqual(bands);

  await leavePage.goto();
  await expect(leavePage.balanceFigure).toHaveText(balance);
  const used = /-?\d+/.exec(await leavePage.usedFigure.innerText())?.[0] ?? '';
  const allowance = /-?\d+/.exec(await leavePage.allowanceFigure.innerText())?.[0] ?? '';
  expect(hint).toBe(fill(danas.tiles.leaveHint, { used, allowance }));
}

/** *Danas* as `member`, in a fresh context of its own. */
async function signedInAs(
  browser: Browser,
  slug: string,
  member: SeededLeaveMember,
): Promise<{ today: TodayPage; calendar: CalendarPage; hours: HoursPage; leave: LeavePage }> {
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await new LoginPage(page).signIn(slug, member.username, member.password);

  return { today: new TodayPage(page), calendar: new CalendarPage(page), hours: new HoursPage(page), leave: new LeavePage(page) };
}

test.describe('as a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('a free day names the seeded type and team, the next shift is the seeded Dan, and the week equals Kalendar', async ({
    page,
    todayPage,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // Two days into the pattern: today is a Slobodno, and the Dan is in 2 days.
    const rotation = await seeded(fixture.slug, fixture.team.id, 2);
    const today = rotation.today;
    expect(stepOn(rotation, today)).toBe(2);
    const [dan] = rotation.steps;

    await page.setViewportSize({ width: 390, height: 844 });
    await todayPage.goto();
    await expect(todayPage.heading(hr.nav.danas)).toBeVisible();
    await expect(todayPage.text(fill(danas.dateLine, { weekday: weekdayOf(today), date: fullDate(today) }))).toBeVisible();

    const card = todayPage.todayCard(danas.today.free);
    await expect(card).toBeVisible();
    await expect(card).toContainText(rotation.steps[2]);
    await expect(card).toContainText(fixture.team.name);
    await expect(todayPage.todayCard(danas.today.working)).toHaveCount(0);

    const next = addDays(today, 2);
    await expect(todayPage.nextShiftHeading).toHaveText(nextHeading(danas.next.heading, 2));
    await expect(todayPage.nextShiftCard).toContainText(fill(danas.dateLine, { weekday: weekdayOf(next), date: fullDate(next) }));
    await expect(todayPage.nextShiftCard).toContainText(dan);
    await expect(todayPage.nextShiftCard).toContainText(rotation.ranges[0] ?? '');

    await expectNoHorizontalScroll(page);
    await expect(todayPage.calendarLink).toBeVisible();
    // STORY 6.1b: both tiles, side by side at 390 px, still no sideways scroll.
    await expect(todayPage.hoursTile).toBeVisible();
    await expect(todayPage.leaveTile).toBeVisible();
    await expectNoHorizontalScroll(page);

    await expectWeekEqualsCalendar(todayPage, calendarPage, today);
  });

  test('the hours tile equals Sati and the leave tile equals Godišnji', async ({ todayPage, hoursPage, leavePage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    await seeded(fixture.slug, fixture.team.id, 2);

    await expectTilesEqualDetailViews(todayPage, hoursPage, leavePage);
  });

  test("a failed resolutions read leaves the hours tile in Sati's sentence, still a link, and the rest as it was", async ({
    page,
    todayPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id, 2);
    const failed = (url: URL) => url.pathname.endsWith('/rest/v1/rpc/my_conflict_resolutions');
    await page.route(failed, (route) => route.fulfill({ status: 500, body: '{}' }));

    await todayPage.goto();
    await expect(todayPage.hoursTileUnavailable).toBeVisible();
    await expect(todayPage.hoursTile).toHaveCount(0);
    await expect(todayPage.leaveTile).toBeVisible();
    await expect(todayPage.todayCard(danas.today.free)).toContainText(rotation.steps[2]);
    await expect(todayPage.unavailableAlert).toHaveCount(0);

    await page.unroute(failed);
    await todayPage.hoursTileUnavailable.click();
    await expect(page).toHaveURL(/\/sati$/);
  });

  test('a working day says so, with the type, its range and the team', async ({ todayPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // One day into the pattern: today is the Noć, and the next Dan is in 3 days.
    const rotation = await seeded(fixture.slug, fixture.team.id, 1);
    expect(stepOn(rotation, rotation.today)).toBe(1);

    await todayPage.goto();
    const card = todayPage.todayCard(danas.today.working);
    await expect(card).toBeVisible();
    await expect(card).toContainText(rotation.steps[1]);
    await expect(card).toContainText(rotation.ranges[1] ?? '');
    await expect(card).toContainText(fixture.team.name);
    await expect(todayPage.nextShiftHeading).toHaveText(nextHeading(danas.next.heading, 3));
    await expect(todayPage.nextShiftCard).toContainText(rotation.steps[0]);
  });

  for (const failed of [
    { name: 'their own leave', route: (url: URL) => url.pathname.endsWith('/rest/v1/rpc/my_leave_records') },
    {
      // `readCalendar`'s one select on `organizations`, told from the chrome's
      // own organization read by the rotation embed only it selects.
      name: 'the calendar snapshot',
      route: (url: URL) =>
        url.pathname.endsWith('/rest/v1/organizations') && (url.searchParams.get('select') ?? '').includes('rotation_steps'),
    },
  ]) {
    test(`a failed read of ${failed.name} shows the unavailable alert and no case, and the retry brings it back`, async ({
      page,
      todayPage,
      fixture,
    }) => {
      test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
      // Today is a Slobodno, so the case after the retry is the seeded one.
      const rotation = await seeded(fixture.slug, fixture.team.id, 2);
      expect(stepOn(rotation, rotation.today)).toBe(2);
      await page.route(failed.route, (route) => route.fulfill({ status: 500, body: '{}' }));

      await todayPage.goto();
      await expect(todayPage.unavailableAlert).toBeVisible();
      await expect(todayPage.retryButton).toBeVisible();
      await expect(todayPage.weekList).toHaveCount(0);
      await expect(todayPage.card(new RegExp(`^${escapeRegExp(danas.today.free)}$`))).toHaveCount(0);
      // STORY 6.1b: the page-unavailable screen shows no tile, in any state.
      await expect(todayPage.hoursTile).toHaveCount(0);
      await expect(todayPage.hoursTileUnavailable).toHaveCount(0);
      await expect(todayPage.leaveTile).toHaveCount(0);
      await expect(todayPage.leaveTileUnavailable).toHaveCount(0);

      await page.unroute(failed.route);
      await todayPage.retryButton.click();
      await expect(todayPage.unavailableAlert).toHaveCount(0);
      await expect(todayPage.todayCard(danas.today.free)).toBeVisible();
      await expect(todayPage.todayCard(danas.today.free)).toContainText(rotation.steps[2]);
    });
  }
});

test('a member on leave today reads the leave case with its range, and the next shift is their return', async ({
  browser,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  // Today is a Dan: leave today and tomorrow (Dan, Noć) ends before the
  // Slobodno pair, so the return is the Dan in 4 days.
  const rotation = await seeded(fixture.slug, fixture.team.id, 0);
  const today = rotation.today;
  const member = await seedLeaveMember(fixture.slug, fixture.team.id, today, 20);
  const until = addDays(today, 1);
  await seedLeaveRecord(fixture.slug, member.id, today, until);
  withLeave = { slug: fixture.slug, id: member.id };

  const { today: todayPage, calendar, hours, leave } = await signedInAs(browser, fixture.slug, member);
  await todayPage.page.setViewportSize({ width: 390, height: 844 });
  await todayPage.goto();

  const card = todayPage.todayCard(danas.today.leave);
  await expect(card).toBeVisible();
  await expect(card).toContainText(fill(danas.today.leaveRange, { from: fullDate(today), to: fullDate(until) }));
  // STORY 6.1b: today's Dan and tomorrow's Noć, the days the member would work.
  await expect(card).toContainText(fill(danas.today.leaveCost, { days: plural(hr.count.days, 2) }));

  const back = addDays(today, 4);
  await expect(todayPage.nextShiftHeading).toHaveText(nextHeading(danas.next.returnHeading, 4));
  await expect(todayPage.nextShiftCard).toContainText(fill(danas.dateLine, { weekday: weekdayOf(back), date: fullDate(back) }));
  await expect(todayPage.nextShiftCard).toContainText(rotation.steps[0]);
  await expect(todayPage.weekDays.first()).toContainText(hr.kalendar.modifier.leave);
  await expectNoHorizontalScroll(todayPage.page);

  await expectWeekEqualsCalendar(todayPage, calendar, today, new Set([until]));
  await expectTilesEqualDetailViews(todayPage, hours, leave);
});
