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
import { fill, hr, plural } from '../../utils/i18n.ts';
import { fullDate } from '../../utils/dates.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';
import { LeavePage } from '../../pages/leave.page.ts';
import { LoginPage } from '../../pages/login.page.ts';

/**
 * Story 5.2c: a member opens *Godišnji* and sees their own allowance, the
 * days used in the current leave year and the balance, and nobody else's.
 *
 * A team of the test's own gets a rotation from today in SQL
 * (`seedTeamRotation`: `[Dan, Noć, Slobodno, Slobodno]`) under the run's
 * rotation hold, and a fresh member on it (`seedLeaveMember`), signed in to a
 * context of its own with the credentials the seed returns — so the shared
 * fixture member never holds leave. A record from today to today + 4, cut at
 * the end of the current leave year, costs its seeded working days N.
 *
 * The member reads 20 / N / 20 − N; a colleague's record over the same dates
 * changes nothing; after the admin amends the record on the member's page the
 * member's reload reads exactly the admin card's figures; after the admin
 * removes it the reload reads 20 / 0 / 20; and the screen does not scroll
 * sideways at 390 px. A failed read of the member's own records shows the
 * unavailable alert and its retry, and the retry brings the figures back.
 */

test.use({ storageState: ADMIN_STATE });

const godisnji = hr.godisnji;
const leave = hr.ljudi.leaveRecord;
const days = hr.count.days;

/** The run organization's rotation, while this file's test holds it. */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;

/**
 * The members and teams this file's test seeded, deleted after the seed and
 * before the hold is released (story 5.5g): the run's organization is
 * shared, and a member left on an active team with live leave collides with
 * the next spec's rotation save, which another spec's cancel would then
 * erase.
 */
let written: { slug: string; members: string[]; teams: string[] } = { slug: '', members: [], teams: [] };

test.afterEach(async () => {
  try {
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
    const own = written;
    written = { slug: '', members: [], teams: [] };
    try {
      // The members first, with their leave and resolutions, then the teams their versions name.
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

/** The last day of the leave year beginning on `start` that holds `today`. */
function leaveYearEndOf(today: string, start: { readonly month: number; readonly day: number }): string {
  const startIn = (year: number) =>
    `${String(year)}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  const year = Number(today.slice(0, 4));
  const next = today >= startIn(year) ? startIn(year + 1) : startIn(year);

  return isoDaysAfter(next, -1);
}

/** The seeded pattern's working days (`Dan`, `Noć`) from `today` to `last`, the pattern starting on `today`. */
function workingDaysOf(today: string, last: string): number {
  let count = 0;
  for (let offset = 0; isoDaysAfter(today, offset) <= last; offset += 1) {
    if (offset % 4 < 2) count += 1;
  }

  return count;
}

interface Seeded {
  readonly member: SeededLeaveMember;
  readonly colleague: SeededLeaveMember;
  readonly today: string;
  /** Today + 4, or the leave year's last day when that comes first. */
  readonly last: string;
  /** What today–`last` costs: its working days. */
  readonly cost: number;
}

/** A team with the seeded rotation from today, two fresh members on it, and a range inside the leave year. */
async function seeded(slug: string): Promise<Seeded> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  written = { slug, members: [], teams: [team.id] };
  seed = await seedTeamRotation(slug, team.id, suffix);
  const today = seed.today;
  const yearEnd = leaveYearEndOf(today, await leaveYearStartOf(slug));
  const plusFour = isoDaysAfter(today, 4);
  const last = plusFour <= yearEnd ? plusFour : yearEnd;
  const member = await seedLeaveMember(slug, team.id, today, 20);
  const colleague = await seedLeaveMember(slug, team.id, today, 20);
  written.members.push(member.id, colleague.id);

  return { member, colleague, today, last, cost: workingDaysOf(today, last) };
}

/** *Godišnji* as `member`, in a fresh context of its own. */
async function signedInAs(browser: Browser, slug: string, member: SeededLeaveMember): Promise<{ page: Page; mine: LeavePage }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await new LoginPage(page).signIn(slug, member.username, member.password);

    return { page, mine: new LeavePage(page) };
  } catch (cause) {
    // The caller's `finally` has not started yet: close the context here.
    await context.close();
    throw cause;
  }
}

test("a member reads their own figures, a colleague's leave changes nothing, and the admin's amend and removal follow on reload", async ({
  browser,
  peoplePage,
  fixture,
}) => {
  const { member, colleague, today, last, cost } = await seeded(fixture.slug);
  expect(cost, 'the range holds a working day').toBeGreaterThan(0);

  await seedLeaveRecord(fixture.slug, member.id, today, last);
  // A COLLEAGUE'S LEAVE, over the same dates: never the viewer's figure.
  await seedLeaveRecord(fixture.slug, colleague.id, today, isoDaysAfter(today, 1));

  const { page, mine } = await signedInAs(browser, fixture.slug, member);
  try {
    await mine.goto();
    await expect(mine.heading(hr.nav.godisnji)).toBeVisible();
    await expect(mine.allowanceFigure).toHaveText(plural(days, 20));
    await expect(mine.usedFigure).toHaveText(plural(days, cost));
    await expect(mine.balanceFigure).toHaveText(plural(days, 20 - cost));
    // Nothing a member does here writes, and nothing else is pressable but a retry nobody needs.
    await expect(mine.retryButton).toHaveCount(0);

    // THE PHONE: three tiles stacked, no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(mine.balanceFigure).toBeVisible();
    await expectNoHorizontalScroll(page);

    // THE ADMIN AMENDS the record on the member's page to today alone — a Dan.
    await peoplePage.gotoMember(member.id);
    await peoplePage.amendLeaveButton(today, last).click();
    await peoplePage.enterLeave(today, today);
    await peoplePage.amendSaveButton.click();
    await expect(peoplePage.statusWith(plural(leave.amended, 1))).toBeVisible();
    await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, 1));
    const cardFigures = await Promise.all(
      [hr.ljudi.leave, leave.used, leave.balance].map(async (label) =>
        ((await peoplePage.leaveFigure(label).textContent()) ?? '').trim(),
      ),
    );

    // The member's reload reads exactly the admin card's three figures.
    await page.reload();
    await expect(mine.usedFigure).toHaveText(plural(days, 1));
    expect([
      ((await mine.allowanceFigure.textContent()) ?? '').trim(),
      ((await mine.usedFigure.textContent()) ?? '').trim(),
      ((await mine.balanceFigure.textContent()) ?? '').trim(),
    ]).toEqual(cardFigures);

    // THE ADMIN REMOVES it, with its one confirmation.
    await peoplePage.removeLeaveButton(today, today).click();
    await peoplePage.confirmRemoveLeaveIn(peoplePage.removeLeaveConfirmOf(today, today, 1)).click();
    await expect(peoplePage.statusWith(fill(leave.removed, { from: fullDate(today), to: fullDate(today) }))).toBeVisible();

    // The balance is whole again on the member's reload.
    await page.reload();
    await expect(mine.allowanceFigure).toHaveText(plural(days, 20));
    await expect(mine.usedFigure).toHaveText(plural(days, 0));
    await expect(mine.balanceFigure).toHaveText(plural(days, 20));
    await expect(mine.text(godisnji.unavailable)).toHaveCount(0);
  } finally {
    await page.context().close();
  }
});

test.describe('signed in as the seeded member', () => {
  // The test's own page starts signed out, and signs in as a member of its own.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a failed read shows the unavailable alert and its retry, and the retry brings the figures back', async ({
    page,
    loginPage,
    leavePage,
    fixture,
  }) => {
    const { member, today, last, cost } = await seeded(fixture.slug);
    await seedLeaveRecord(fixture.slug, member.id, today, last);

    // THE OWN-RECORDS READ FAILS: its first attempt and the query's one
    // automatic retry answer 500, and every later request goes through.
    let failures = 2;
    await page.route('**/rest/v1/rpc/my_leave_records', async (route) => {
      if (failures > 0) {
        failures -= 1;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"e2e"}' });
        return;
      }
      await route.continue();
    });

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await leavePage.goto();
    await expect(leavePage.alertWith(godisnji.unavailable)).toBeVisible();
    await expect(leavePage.retryButton).toBeVisible();
    await expect(leavePage.usedFigure).toHaveCount(0);

    await leavePage.retryButton.click();
    await expect(leavePage.allowanceFigure).toHaveText(plural(days, 20));
    await expect(leavePage.usedFigure).toHaveText(plural(days, cost));
    await expect(leavePage.balanceFigure).toHaveText(plural(days, 20 - cost));
    await expect(leavePage.alertWith(godisnji.unavailable)).toHaveCount(0);
    await expect(leavePage.retryButton).toHaveCount(0);
  });
});
