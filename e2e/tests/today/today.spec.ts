import { randomBytes } from 'node:crypto';

import type { Browser, BrowserContext } from '@playwright/test';

import { CalendarPage } from '../../pages/calendar.page.ts';
import { HoursPage } from '../../pages/hours.page.ts';
import { LeavePage } from '../../pages/leave.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { TodayPage } from '../../pages/today.page.ts';
import {
  holdRotation,
  organizationInstant,
  promoteToAdminInSql,
  removeLeaveMemberInSql,
  removeLeaveRecordsInSql,
  removeRosterOverridesInSql,
  removeSeededRotation,
  removeTeamInSql,
  removeTeamMembershipsInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedRosterOverride,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, fullDate, weekdayOf } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
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
 *
 * Story 6.2: the member's own Dan today and another team's Noć they take
 * over from one of its members read as ONE duty-block at 21:10 in the
 * organization's zone (`page.clock`) — "do 07:00", the Dan done, the Noć
 * under way naming the member replaced, the progress in words — and it moves
 * as minutes pass without a reload. *Kalendar* still lists two shifts that
 * date. At 06:00 the same duty is still to come: "počinje u 07:00" on
 * today's date, both legs "Slijedi". Nothing scrolls sideways at 390 px.
 *
 * Story 6.3: an admin's own Danas at 14:20 in the organization's zone
 * (`page.clock`). With no live leave, *Treba tebe* says `0 neriješenih
 * konflikata`, neutral, with "Otvori konflikte (0)", and the admin on no
 * team reads "Nisi raspoređen ni u jednu smjenu." in the subtitle. With a
 * team of the test's own working Noć today, four members on it and one on
 * leave today — the organization's leave read narrowed to those four, since
 * other specs write leave to the same organization — the count is 1 and
 * equals *Raspored*'s, the row opens its conflict's resolution screen,
 * coverage reads `3 od 4 člana` with the member's name and why, the member is
 * absent today, and the week's cell for that team today is named with the
 * conflict. The keyboard reaches the row, "Otvori konflikte", the coverage,
 * the absences and the week in that order, and nothing scrolls sideways at
 * 390 px. A failed leave read is one alert whose retry brings it back. The
 * member's Danas has no admin block. The keyboard starts from the top of the
 * page and arrows inside the week grid to the team's cell. Accepting the
 * conflict as uncovered on its screen takes the count to 0 on Raspored and,
 * after the save, on Danas. An admin of the test's own on the team reads
 * "Danas radiš ‹tip› ‹raspon›" and their team's link in the subtitle.
 */

const danas = hr.danas;
const admin = danas.admin;

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** A member whose live records are soft-removed afterwards. */
let withLeave: { readonly slug: string; readonly id: string } | null = null;
/** A context of the test's own, closed afterwards. */
let context: BrowserContext | null = null;
/** Fresh members a story 6.3 test seeded, deleted afterwards. */
let crew: { readonly slug: string; readonly ids: readonly string[] } | null = null;
/**
 * A second team, its rotation, the roster override on it and the member it
 * replaces, removed afterwards (story 6.2).
 */
let extra: {
  readonly slug: string;
  readonly teamId: string;
  readonly seed: SeededRotation | null;
  readonly override: { readonly rotation: SeededRotation; readonly date: string } | null;
  readonly memberId: string | null;
} | null = null;

test.afterEach(async () => {
  try {
    await context?.close();
    if (withLeave !== null) await removeLeaveRecordsInSql(withLeave.slug, withLeave.id).catch(() => undefined);
    if (extra !== null && extra.override !== null) {
      const { rotation, date } = extra.override;
      await removeRosterOverridesInSql(rotation, extra.teamId, date).catch(() => undefined);
    }
    if (seed !== null) await removeSeededRotation(seed);
    if (extra !== null && extra.seed !== null) await removeSeededRotation(extra.seed).catch(() => undefined);
    if (crew !== null) {
      for (const id of crew.ids) {
        // Their memberships, leave and resolutions go with them (checked:
        // the delete succeeds while they are still on the team).
        await removeLeaveMemberInSql(crew.slug, id).catch(() => undefined);
      }
    }
    if (extra !== null) {
      // Each step on its own: one that fails leaves the rest to run.
      const { slug, teamId, memberId } = extra;
      if (extra.seed !== null) await removeSeededRotation(extra.seed).catch(() => undefined);
      if (memberId !== null) await removeLeaveMemberInSql(slug, memberId).catch(() => undefined);
      await removeTeamMembershipsInSql(slug, teamId).catch(() => undefined);
      await removeTeamInSql(slug, teamId).catch(() => undefined);
    }
  } finally {
    context = null;
    crew = null;
    withLeave = null;
    seed = null;
    extra = null;
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
    // STORY 6.3: the member's Danas is unchanged — no admin block.
    await expect(todayPage.needsYouCard).toHaveCount(0);
    await expect(todayPage.weekCard).toHaveCount(0);

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

/** What {@link seedDuty} wrote: her own rotation, the second team's, and the member she replaces on it. */
interface SeededDuty {
  readonly rotation: SeededRotation;
  readonly other: SeededRotation;
  readonly beta: { readonly id: string; readonly name: string };
  readonly replaced: SeededLeaveMember;
}

/**
 * Story 6.2's duty: the fixture team works Dan today; a second team, a day
 * into the same pattern, works Noć today, and the fixture member replaces a
 * fresh member of it on that Noć.
 */
async function seedDuty(slug: string, teamId: string, memberName: string): Promise<SeededDuty> {
  const rotation = await seeded(slug, teamId, 0);
  const today = rotation.today;
  const beta = await seedExtraTeam(slug, `Smjena Beta ${randomBytes(3).toString('hex')}`);
  extra = { slug, teamId: beta.id, seed: null, override: null, memberId: null };
  const other = await seedTeamRotation(slug, beta.id, randomBytes(3).toString('hex'), 1);
  extra = { ...extra, seed: other };
  expect(stepOn(rotation, today)).toBe(0);
  expect(stepOn(other, today)).toBe(1);
  const replaced = await seedLeaveMember(slug, beta.id, today, 20);
  extra = { ...extra, memberId: replaced.id };
  await seedRosterOverride(rotation, beta.id, today, replaced.name, memberName, 'Zamjena zbog bolovanja.');
  extra = { ...extra, override: { rotation, date: today } };

  return { rotation, other, beta, replaced };
}

const duration = hr.organization.hourBands.duration;

/** `14 h 10 min od 24 h`: the progress bar's valuetext. */
function progressOf(hours: number, minutes: number): string {
  const done =
    minutes === 0
      ? fill(duration.hours, { hours: String(hours) })
      : fill(duration.hoursMinutes, { hours: String(hours), minutes: String(minutes) });

  return fill(danas.duty.progress, { done, total: fill(duration.hours, { hours: '24' }) });
}

test.describe('a 24 h duty at 390 px, as the member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('her own Dan and the Noć she takes over read as one duty-block, and Kalendar still lists two shifts', async ({
    page,
    todayPage,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { rotation, other, beta, replaced } = await seedDuty(fixture.slug, fixture.team.id, fixture.member.name);
    const today = rotation.today;
    const tomorrow = addDays(today, 1);

    // 21:10 today on the organization's wall clock.
    await page.clock.install({ time: await organizationInstant(fixture.slug, today, '21:10') });
    await todayPage.goto();

    const block = todayPage.dutyBlock;
    await expect(block).toBeVisible();
    await expect(block.getByRole('heading', { level: 2 })).toHaveText(
      fill(danas.duty.kicker, { total: fill(duration.hours, { hours: '24' }) }),
    );
    await expect(block).toContainText(fill(danas.duty.until, { time: '07:00' }));
    await expect(block).toContainText(
      fill(danas.duty.remaining, {
        weekday: weekdayOf(tomorrow),
        date: dayMonth(tomorrow),
        duration: fill(duration.hoursMinutes, { hours: '9', minutes: '50' }),
      }),
    );
    await expect(todayPage.dutyProgress).toHaveAttribute('aria-valuetext', progressOf(14, 10));
    await expect(todayPage.dutyLegs).toHaveCount(2);
    const [dan] = rotation.steps;
    const noc = other.steps[1];
    await expect(todayPage.dutyLegs.nth(0)).toContainText(danas.duty.legDone);
    await expect(todayPage.dutyLegs.nth(0)).toContainText(dan);
    await expect(todayPage.dutyLegs.nth(0)).toContainText(fill(danas.duty.noteOwn, { team: fixture.team.name }));
    await expect(todayPage.dutyLegs.nth(1)).toContainText(danas.duty.legRunning);
    await expect(todayPage.dutyLegs.nth(1)).toContainText(noc);
    await expect(todayPage.dutyLegs.nth(1)).toContainText(
      fill(danas.duty.noteReplacing, { name: replaced.name, team: beta.name }),
    );
    // One duty, never the two rows of the working case.
    await expect(todayPage.todayCard(danas.today.working)).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Ten minutes later, without a reload: every tick on the way runs.
    await page.clock.runFor(10 * 60_000);
    await expect(todayPage.dutyProgress).toHaveAttribute('aria-valuetext', progressOf(14, 20));
    await expect(block).toContainText(fill(danas.duty.until, { time: '07:00' }));

    // The data stays two scheduled shifts on their own dates.
    await calendarPage.goto();
    await expect(calendarPage.openerIn(calendarPage.today)).toHaveCount(2);
    await expectNoHorizontalScroll(page);
  });

  test('before 07:00 the same duty is still to come: do 07:00, počinje u 07:00 today, both legs Slijedi', async ({
    page,
    todayPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { rotation } = await seedDuty(fixture.slug, fixture.team.id, fixture.member.name);
    const today = rotation.today;

    // 06:00 today on the organization's wall clock.
    await page.clock.install({ time: await organizationInstant(fixture.slug, today, '06:00') });
    await todayPage.goto();

    const block = todayPage.dutyBlock;
    await expect(block).toBeVisible();
    await expect(block).toContainText(fill(danas.duty.until, { time: '07:00' }));
    await expect(block).toContainText(
      fill(danas.duty.startsAt, { weekday: weekdayOf(today), date: dayMonth(today), time: '07:00' }),
    );
    await expect(todayPage.dutyProgress).toHaveAttribute('aria-valuetext', progressOf(0, 0));
    await expect(todayPage.dutyLegs).toHaveCount(2);
    await expect(todayPage.dutyLegs.nth(0)).toContainText(danas.duty.legUpcoming);
    await expect(todayPage.dutyLegs.nth(1)).toContainText(danas.duty.legUpcoming);
    await expectNoHorizontalScroll(page);
  });
});

/** The organization's leave read, as PostgREST answers it: `rows`, with their exact count. */
function leaveAnswer(rows: readonly unknown[]): { status: number; contentType: string; headers: Record<string, string>; body: string } {
  return {
    status: 200,
    contentType: 'application/json',
    // Exposed across origins, as the API exposes it, or the page cannot read it.
    headers: {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'Content-Range',
      'content-range': rows.length === 0 ? '*/0' : `0-${String(rows.length - 1)}/${String(rows.length)}`,
    },
    body: JSON.stringify(rows),
  };
}

/** The organization's leave read (`leave_records`), never the member's own (`my_leave_records`). */
const ORGANIZATION_LEAVE = '**/rest/v1/leave_records*';

/** `3 od 4 člana`: the present count, then the roster through the plural. */
function membersText(present: number, total: number): string {
  const message = admin.coverage.members;
  const at = message.indexOf('{total');

  return `${fill(message.slice(0, at), { present: String(present) })}${plural(message.slice(at).replace('{total,', '{count,'), total)}`;
}

/** What {@link seedShortTeam} wrote: the team, its rotation, its four members and the one on leave. */
interface ShortTeam {
  readonly team: { readonly id: string; readonly name: string };
  readonly rotation: SeededRotation;
  readonly members: readonly SeededLeaveMember[];
  readonly absent: SeededLeaveMember;
}

/**
 * A team of the test's own working Noć today (a day into the pattern), four
 * fresh members on it from today, and the first of them on leave today.
 */
async function seedShortTeam(slug: string): Promise<ShortTeam> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena Gama ${suffix}`);
  extra = { slug, teamId: team.id, seed: null, override: null, memberId: null };
  const rotation = await seedTeamRotation(slug, team.id, suffix, 1);
  extra = { ...extra, seed: rotation };
  expect(stepOn(rotation, rotation.today)).toBe(1);
  const members: SeededLeaveMember[] = [];
  for (let index = 0; index < 4; index += 1) {
    members.push(await seedLeaveMember(slug, team.id, rotation.today, 20));
    crew = { slug, ids: members.map((member) => member.id) };
  }
  const [absent] = members;
  if (absent === undefined) throw new Error('E2E: no member seeded');
  await seedLeaveRecord(slug, absent.id, rotation.today, rotation.today);

  return { team, rotation, members, absent };
}

test.describe('as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Zero: 0 neriješenih konflikata, neutral, Otvori konflikte (0), and the subtitle for an admin on no team', async ({
    page,
    todayPage,
    conflictsPage,
  }) => {
    await page.route(ORGANIZATION_LEAVE, (route) => route.fulfill(leaveAnswer([])));
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.needsYouCount(0)).toBeVisible();
    await expect(todayPage.needsYouCount(0)).toHaveText('0 neriješenih konflikata');
    await expect(todayPage.needsYouCard).toContainText(admin.needsYou.calm);
    await expect(todayPage.needsYouRowLinks).toHaveCount(0);
    await expect(todayPage.openConflictsLink(0)).toBeVisible();
    await expect(todayPage.absentCard).toContainText(admin.absent.none);
    await expect(todayPage.page.getByText(new RegExp(`${escapeRegExp(admin.status.unscheduled)}$`))).toBeVisible();
    // No "Tvoja smjena" card for an admin.
    await expect(todayPage.page.getByText(hr.smjene.membership.none, { exact: true })).toHaveCount(0);

    await todayPage.openConflictsLink(0).click();
    await expect(page).toHaveURL(/\/raspored$/);
    await expect(conflictsPage.countHeading(0)).toBeVisible();
  });

  test('a seeded leave conflict: the count equals Raspored, 3 od 4 člana, the absence, ⚠ in the week, and a decision saved takes it to 0', async ({
    page,
    todayPage,
    conflictsPage,
    resolutionPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { team, rotation, members, absent } = await seedShortTeam(fixture.slug);
    const today = rotation.today;
    const ours = new Set(members.map((member) => member.id));
    // Only this test's members' leave: other specs write leave to the same organization.
    await page.route(ORGANIZATION_LEAVE, async (route) => {
      const answered = await route.fetch();
      const rows = ((await answered.json()) as readonly { readonly member_id?: string }[]).filter(
        (row) => row.member_id !== undefined && ours.has(row.member_id),
      );
      await route.fulfill(leaveAnswer(rows));
    });
    await page.clock.install({ time: await organizationInstant(fixture.slug, today, '14:20') });
    await page.setViewportSize({ width: 390, height: 844 });

    await todayPage.goto();
    await expect(todayPage.needsYouCount(1)).toBeVisible();
    await expect(todayPage.openConflictsLink(1)).toBeVisible();
    await expect(todayPage.needsYouRowLinks).toHaveCount(1);
    const row = todayPage.needsYouRowLinks.first();
    await expect(row).toContainText(absent.name);
    await expect(row).toContainText(fill(admin.needsYou.shiftTimed, { type: rotation.steps[1], times: rotation.ranges[1] ?? '', team: team.name }));
    await expect(row).toContainText(admin.needsYou.today);

    // POKRIVENOST: today's Noć, 3 of its 4, the absent member and why.
    const coverage = todayPage.coverageCard;
    await expect(coverage).toContainText(fill(admin.coverage.shiftTimed, { type: rotation.steps[1], range: rotation.ranges[1] ?? '', team: team.name }));
    await expect(coverage).toContainText(fill(admin.coverage.starts, { time: '19:00' }));
    await expect(coverage).toContainText(membersText(3, 4));
    await expect(coverage).toContainText(fill(admin.coverage.absentUnresolved, { name: absent.name }));

    // ODSUTNI DANAS: the member, their team and the day.
    await expect(todayPage.absentCard).toContainText(absent.name);
    // One day of leave: its one date, never `07.10.–07.10.`.
    await expect(todayPage.absentCard).toContainText(fill(admin.absent.lineDay, { team: team.name, date: dayMonth(today) }));

    // OVAJ TJEDAN: the team's cell today, named with the conflict.
    const ourCell = todayPage.weekCell(
      fill(admin.week.cellTimedConflict, {
        weekday: weekdayOf(today),
        date: dayMonth(today),
        team: team.name,
        type: rotation.steps[1],
        range: rotation.ranges[1] ?? '',
      }),
    );
    await expect(ourCell).toHaveCount(1);
    await expectNoHorizontalScroll(page);

    // THE KEYBOARD, from the top of the page: the row, Otvori konflikte, the
    // coverage, the absences, then the week grid's one tab stop — today's
    // first team — and the arrows down to this team's row; then the week's link.
    await todayPage.heading(hr.nav.danas).click();
    for (const next of [row, todayPage.openConflictsLink(1), todayPage.coverageLink, todayPage.absentLink, todayPage.weekTabStop]) {
      await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
    }
    const teams = (await todayPage.weekTeamHeaders.allInnerTexts()).map(normalized);
    const ourRow = teams.indexOf(team.name);
    expect(ourRow, 'the seeded team has a week row').toBeGreaterThanOrEqual(0);
    for (let step = 0; step < ourRow; step += 1) await page.keyboard.press('ArrowDown');
    await expect(ourCell).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(ourCell).not.toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(ourCell).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(todayPage.weekLink).toBeFocused();

    // EQUALITY: the same count on Raspored.
    await todayPage.openConflictsLink(1).click();
    await expect(page).toHaveURL(/\/raspored$/);
    await expect(conflictsPage.countHeading(1)).toBeVisible();

    // The row opens its own conflict's resolution screen; Danas still
    // counts 1 until the decision is saved, never ahead of it.
    await todayPage.goto();
    await todayPage.needsYouRowLinks.first().click();
    await expect(page).toHaveURL(new RegExp(`/raspored/${absent.id}/${today}/${team.id}$`));
    await resolutionPage.acceptOption.click();
    await page.goBack();
    await expect(todayPage.needsYouCount(1)).toBeVisible();
    await todayPage.needsYouRowLinks.first().click();
    await resolutionPage.acceptOption.click();
    await resolutionPage.saveButton.click();
    await expect(page).toHaveURL(/\/raspored$/);
    await expect(conflictsPage.countHeading(0)).toBeVisible();

    // Back on Danas, after the save: 0 there too.
    await todayPage.navigationLink(hr.nav.danas, { exact: true }).click();
    await expect(todayPage.needsYouCount(0)).toBeVisible();
    await expect(todayPage.openConflictsLink(0)).toBeVisible();
  });

  test('an admin on a team: the subtitle says the shift worked today and links to the team', async ({ browser, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // An admin of the test's own, so the shared admin is never put on a team.
    hold = holdRotation(fixture.slug);
    await hold.ready;
    const suffix = randomBytes(3).toString('hex');
    const team = await seedExtraTeam(fixture.slug, `Smjena Delta ${suffix}`);
    extra = { slug: fixture.slug, teamId: team.id, seed: null, override: null, memberId: null };
    const rotation = await seedTeamRotation(fixture.slug, team.id, suffix, 1);
    extra = { ...extra, seed: rotation };
    const today = rotation.today;
    expect(stepOn(rotation, today)).toBe(1);
    const ownAdmin = await seedLeaveMember(fixture.slug, team.id, today, 20);
    crew = { slug: fixture.slug, ids: [ownAdmin.id] };
    await promoteToAdminInSql(fixture.slug, ownAdmin.id);

    const { today: todayPage } = await signedInAs(browser, fixture.slug, ownAdmin);
    await todayPage.page.clock.install({ time: await organizationInstant(fixture.slug, today, '14:20') });
    await todayPage.goto();

    await expect(todayPage.needsYouCard).toBeVisible();
    const status = fill(admin.status.working, { type: rotation.steps[1], range: rotation.ranges[1] ?? '' });
    await expect(
      todayPage.text(fill(admin.subtitle, { weekday: weekdayOf(today), date: fullDate(today), status })),
    ).toBeVisible();
    await expect(todayPage.teamLink(team.name)).toHaveAttribute('href', `/smjene/${team.id}`);
    // No "Tvoja smjena" card: the subtitle's link is the only one to the team.
    await expect(todayPage.teamLink(team.name)).toHaveCount(1);
    await expect(todayPage.page.getByText(hr.smjene.today.label, { exact: true })).toHaveCount(0);
  });

  test('a failed leave read is one alert with no figure, and the retry brings Treba tebe back', async ({ page, todayPage }) => {
    await page.route(ORGANIZATION_LEAVE, (route) => route.fulfill({ status: 500, body: '{}' }));

    await todayPage.goto();
    await expect(todayPage.adminUnavailableAlert).toBeVisible();
    await expect(todayPage.needsYouCard).toHaveCount(0);
    await expect(todayPage.openConflictsLink()).toHaveCount(0);

    await page.unroute(ORGANIZATION_LEAVE);
    await todayPage.retryButton.click();
    await expect(todayPage.adminUnavailableAlert).toHaveCount(0);
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.openConflictsLink()).toBeVisible();
  });
});
