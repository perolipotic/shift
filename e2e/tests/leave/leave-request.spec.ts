import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';

import {
  API_URL,
  holdRotation,
  leaveYearStartOf,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedLeaveRequest,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { offlineWriteNoteIn } from '../../utils/offline.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 9.3: a member requests leave and sees what it costs.
 *
 * A team of the test's own gets the seeded rotation from today
 * (`[Dan, Noć, Slobodno, Slobodno]`) under the run's rotation hold, and a
 * fresh member on it with 20 days, signed in to a context of its own.
 *
 * CALENDAR-ROBUST. No range crosses the leave-year start except the one case
 * about crossing it: each range is taken a week or more after a BASE, which
 * is today while forty days still fit in the current leave year, and
 * otherwise the first day of the next one on the pattern's Dan. Every figure
 * the current leave year charges is then counted from the pattern, never
 * assumed.
 *
 * Covered: the action opens the form, the preview shows the cost and the
 * balance after it, *Pošalji* sends, *Godišnji* names the sent range and lists
 * the pending row while the balance stays whole; a range over the member's
 * leave and one over their pending request are refused by the database and
 * named, the form keeping its values; *Povuci zahtjev* withdraws a pending
 * request with no confirmation; a seeded approved, rejected and withdrawn
 * request each read their own word with no withdrawal; offline *Pošalji* and
 * *Povuci zahtjev* state the connection need and send nothing; and an admin
 * opening the form is sent to the overview.
 */

const request = hr.godisnji.request;
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

/** Whole days from `from` to `to`, by UTC calendar arithmetic. */
function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The first day of the leave year after the one holding `today`. */
function nextYearStartOf(today: string, start: { readonly month: number; readonly day: number }): string {
  const startIn = (year: number) =>
    `${String(year)}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  const year = Number(today.slice(0, 4));

  return today >= startIn(year) ? startIn(year + 1) : startIn(year);
}

/** What a test's dates stand on. */
interface Seeded {
  readonly member: SeededLeaveMember;
  readonly today: string;
  /** The first day of the next leave year. */
  readonly nextYearStart: string;
  /** `n` days after the base: on the pattern's step `n % 4`, and inside one leave year for `n` up to 40. */
  readonly at: (n: number) => string;
  /** The pattern's working days (`Dan`, `Noć`) of `from`–`to` the CURRENT leave year is charged. */
  readonly inYear: (from: string, to: string) => number;
  /** The pattern's working days of `from`–`to`, whichever year. */
  readonly working: (from: string, to: string) => number;
}

/** A team with the seeded rotation from today and a fresh member on it with `allowance` days. */
async function seeded(slug: string, allowance = 20): Promise<Seeded> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  written = { slug, members: [], teams: [team.id] };
  seed = await seedTeamRotation(slug, team.id, suffix);
  const member = await seedLeaveMember(slug, team.id, seed.today, allowance);
  written.members.push(member.id);
  const today = seed.today;
  const nextYearStart = nextYearStartOf(today, await leaveYearStartOf(slug));
  const lastInYear = addDays(nextYearStart, -1);
  // Today while forty days fit in this leave year; else the next year's first Dan of the pattern.
  const base =
    addDays(today, 40) <= lastInYear ? today : addDays(today, Math.ceil(daysFrom(today, nextYearStart) / 4) * 4);
  const workingOn = (date: string) => date >= today && daysFrom(today, date) % 4 < 2;
  const count = (from: string, to: string, last: string) => {
    let total = 0;
    for (let date = from; date <= to && date <= last; date = addDays(date, 1)) if (workingOn(date)) total += 1;

    return total;
  };

  return {
    member,
    today,
    nextYearStart,
    at: (n) => addDays(base, n),
    inYear: (from, to) => count(from, to, lastInYear),
    working: (from, to) => count(from, to, '9999-12-31'),
  };
}

/** `05.10.2026–07.10.2026`, a range as the list and the lines write it. */
function rangeLabel(from: string, to: string): string {
  return `${fullDate(from)}–${fullDate(to)}`;
}

/** Every write the page sends to the API: a non-GET to a table, or the withdrawal. */
function spyOnWrites(page: Page): () => readonly string[] {
  const writes: string[] = [];

  page.on('request', (sent) => {
    const url = sent.url();
    if (!url.startsWith(`${API_URL}/rest/v1/`)) return;
    if (url.includes('/rest/v1/rpc/') ? /\/rpc\/withdraw_/.test(url) : sent.method() !== 'GET' && sent.method() !== 'HEAD') {
      writes.push(`${sent.method()} ${url}`);
    }
  });

  return () => writes;
}

test.describe('a member requests leave', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sends a range from the form, sees its cost first, and finds it pending on Godišnji with the balance whole', async ({
    page,
    loginPage,
    leavePage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { member, at, inYear } = await seeded(fixture.slug);
    // Base + 8 is the pattern's Dan, + 9 its Noć: two working days.
    const from = at(8);
    const to = at(9);

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await leavePage.goto();
    await expect(leavePage.text(request.empty)).toBeVisible();
    await leavePage.requestAction.click();
    await expect(page).toHaveURL(/\/godisnji\/zatrazi$/);
    await expect(leavePage.heading(request.heading)).toBeVisible();

    // ONE DATE: a reason, no preview.
    await leavePage.requestFrom.fill(from);
    await expect(leavePage.text(request.incomplete)).toBeVisible();
    await leavePage.requestTo.fill(to);
    await expect(leavePage.requestFigure(request.cost)).toHaveText(plural(days, 2));
    // In this leave year: 18 left; in the next (a base past the year's end): this year charged nothing.
    await expect(leavePage.requestFigure(request.balanceAfter)).toHaveText(plural(days, 20 - inYear(from, to)));

    // A REVERSED RANGE: a reason, and the send is refused before any request.
    await leavePage.requestTo.fill(addDays(from, -1));
    await expect(leavePage.text(request.reversed)).toBeVisible();
    await leavePage.requestTo.fill(to);

    await leavePage.sendButton.click();
    await expect(page).toHaveURL(/\/godisnji$/);
    await expect(leavePage.statusWith(fill(request.sent, { from: fullDate(from), to: fullDate(to) }))).toBeVisible();
    const row = leavePage.requestRow(rangeLabel(from, to));
    await expect(row).toContainText(plural(days, 2));
    await expect(row).toContainText(request.status.pending);
    await expect(leavePage.withdrawButton(fullDate(from), fullDate(to))).toBeVisible();
    // A PENDING REQUEST CHARGES NOTHING.
    await expect(leavePage.balanceFigure).toHaveText(plural(days, 20));

    // A reload finds the row and no sent line.
    await page.reload();
    await expect(leavePage.requestRow(rangeLabel(from, to))).toBeVisible();
    await expect(leavePage.text(fill(request.sent, { from: fullDate(from), to: fullDate(to) }))).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(leavePage.requestRow(rangeLabel(from, to))).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('goes over the balance with a warning, and still sends', async ({ page, loginPage, leavePage, fixture }) => {
    test.slow();
    // NO DAY LEFT, and today is the pattern's Dan, always in this leave year: one over.
    const { member, today } = await seeded(fixture.slug, 0);
    const from = today;
    const to = today;

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await page.goto('/godisnji/zatrazi');
    await leavePage.enterRequest(from, to);
    await expect(leavePage.text(plural(request.exceeds, -1))).toBeVisible();
    await expect(leavePage.requestFigure(request.balanceAfter)).toHaveText(plural(days, -1));
    await expect(leavePage.sendButton).toBeEnabled();
    await leavePage.sendButton.click();
    await expect(page).toHaveURL(/\/godisnji$/);
    await expect(leavePage.requestRow(rangeLabel(from, to))).toContainText(request.status.pending);
  });

  test("is refused over the member's own leave and over their pending request, each named, the values kept", async ({
    page,
    loginPage,
    leavePage,
    fixture,
  }) => {
    test.slow();
    const { member, at } = await seeded(fixture.slug);
    await seedLeaveRecord(fixture.slug, member.id, at(8), at(9));
    const pendingFrom = at(20);
    const pendingTo = at(22);
    await seedLeaveRequest(fixture.slug, member.id, pendingFrom, pendingTo);

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await page.goto('/godisnji/zatrazi');

    // OVER THE OWN LEAVE: the preview warns and never blocks, and the database refuses.
    await leavePage.enterRequest(at(9), at(10));
    await expect(leavePage.text(request.overlapNote)).toBeVisible();
    await leavePage.sendButton.click();
    await expect(leavePage.alertWith(request.overlapsLeave)).toBeVisible();
    await expect(page).toHaveURL(/\/godisnji\/zatrazi$/);
    await expect(leavePage.requestFrom).toHaveValue(at(9));
    await expect(leavePage.requestTo).toHaveValue(at(10));

    // OVER THE PENDING REQUEST: refused by the exclusion, named apart.
    // Changing a date takes the last refusal down before the next send.
    await leavePage.requestFrom.fill(at(21));
    await expect(leavePage.alertWith(request.overlapsLeave)).toHaveCount(0);
    await leavePage.requestTo.fill(at(23));
    await leavePage.sendButton.click();
    await expect(leavePage.alertWith(request.overlapsRequest)).toBeVisible();
    await expect(page).toHaveURL(/\/godisnji\/zatrazi$/);
  });

  test('withdraws a pending request with no question, and the row reads Povučen', async ({
    page,
    loginPage,
    leavePage,
    fixture,
  }) => {
    test.slow();
    const { member, at } = await seeded(fixture.slug);
    const from = at(12);
    const to = at(13);
    await seedLeaveRequest(fixture.slug, member.id, from, to);

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await leavePage.goto();
    await expect(leavePage.requestRow(rangeLabel(from, to))).toContainText(request.status.pending);
    await leavePage.withdrawButton(fullDate(from), fullDate(to)).click();
    await expect(leavePage.dialogs).toHaveCount(0);
    await expect(leavePage.statusWith(fill(request.withdrawn, { from: fullDate(from), to: fullDate(to) }))).toBeVisible();
    await expect(leavePage.requestRow(rangeLabel(from, to))).toContainText(request.status.withdrawn);
    await expect(leavePage.withdrawButton(fullDate(from), fullDate(to))).toHaveCount(0);

    // A withdrawn range can be sent again, and its sent line replaces the withdrawn one.
    await leavePage.requestAction.click();
    await leavePage.enterRequest(from, to);
    await leavePage.sendButton.click();
    await expect(page).toHaveURL(/\/godisnji$/);
    await expect(leavePage.statusWith(fill(request.sent, { from: fullDate(from), to: fullDate(to) }))).toBeVisible();
    await expect(leavePage.text(fill(request.withdrawn, { from: fullDate(from), to: fullDate(to) }))).toHaveCount(0);
    await expect(leavePage.requestRow(rangeLabel(from, to)).filter({ hasText: request.status.pending })).toHaveCount(1);
  });

  test('reads a decided and a withdrawn request each by its own word, soonest first, with no withdrawal', async ({
    loginPage,
    leavePage,
    fixture,
  }) => {
    test.slow();
    const { member, at, inYear } = await seeded(fixture.slug);
    const approved = [at(8), at(9)] as const;
    const rejected = [at(16), at(17)] as const;
    const withdrawn = [at(24), at(25)] as const;
    // Seeded out of order: the list sorts by the range's start.
    await seedLeaveRequest(fixture.slug, member.id, ...withdrawn, 'withdrawn');
    await seedLeaveRequest(fixture.slug, member.id, ...approved, 'approved');
    await seedLeaveRequest(fixture.slug, member.id, ...rejected, 'rejected');

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await leavePage.goto();
    const rows = leavePage.requestsList.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(rangeLabel(...approved));
    await expect(rows.nth(0)).toContainText(request.status.approved);
    await expect(rows.nth(1)).toContainText(request.status.rejected);
    await expect(rows.nth(2)).toContainText(request.status.withdrawn);
    // The closing date, worded by status; 0040 closes it now, today in the organization's zone.
    const word = (message: string) => message.replace('{date}', '').trim();
    await expect(rows.nth(0)).toContainText(word(request.decidedOn));
    await expect(rows.nth(1)).toContainText(word(request.decidedOn));
    await expect(rows.nth(2)).toContainText(word(request.withdrawnOn));
    await expect(leavePage.requestsList.getByRole('button', { name: request.withdraw })).toHaveCount(0);
    // The approval's leave record is live leave: its Dan and Noć are charged to their leave year.
    await expect(leavePage.usedFigure).toHaveText(plural(days, inYear(...approved)));
  });

  test('across the leave-year start: the cost, and the part this year is charged beside it', async ({
    page,
    loginPage,
    leavePage,
    fixture,
  }) => {
    test.slow();
    const { member, today, nextYearStart, inYear, working } = await seeded(fixture.slug);
    // Four days before the next leave year (or from today, when fewer are left) to its fifth day.
    const fourBefore = addDays(nextYearStart, -4);
    const from = fourBefore >= today ? fourBefore : today;
    const to = addDays(nextYearStart, 4);
    const charged = inYear(from, to);
    expect(working(from, to), 'the range is charged in full this year').toBeGreaterThan(charged);

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await page.goto('/godisnji/zatrazi');
    await leavePage.enterRequest(from, to);
    await expect(leavePage.requestFigure(request.cost)).toHaveText(plural(days, working(from, to)));
    await expect(leavePage.text(plural(request.costInYear, charged))).toBeVisible();
    await expect(leavePage.requestFigure(request.balanceAfter)).toHaveText(plural(days, 20 - charged));
  });

  test('offline, Pošalji and Povuci zahtjev state the connection need and send nothing', async ({
    page,
    loginPage,
    leavePage,
    fixture,
  }) => {
    test.slow();
    const { member, at } = await seeded(fixture.slug);
    const from = at(12);
    const to = at(13);
    await seedLeaveRequest(fixture.slug, member.id, from, to);

    await loginPage.signIn(fixture.slug, member.username, member.password);
    await leavePage.goto();
    const withdraw = leavePage.withdrawButton(fullDate(from), fullDate(to));
    await expect(withdraw).toBeVisible();
    // The form read online once, so its snapshot is on the device.
    await leavePage.requestAction.click();
    await leavePage.enterRequest(at(30), at(31));
    await expect(leavePage.requestFigure(request.cost)).toBeVisible();

    const writes = spyOnWrites(page);
    await page.context().setOffline(true);
    try {
      await expect(offlineWriteNoteIn(page)).toBeVisible();
      await expect(leavePage.sendButton).toHaveAttribute('aria-disabled', 'true');
      await leavePage.sendButton.click({ force: true });
      await expect(page).toHaveURL(/\/godisnji\/zatrazi$/);
      await expect(leavePage.requestFrom).toHaveValue(at(30));

      // Back on Godišnji, still offline: the list under the as-of note, the withdrawal gated.
      await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
      await expect(leavePage.offlineNote).toBeVisible();
      await expect(withdraw).toHaveAttribute('aria-disabled', 'true');
      await withdraw.click({ force: true });
      await expect(leavePage.requestRow(rangeLabel(from, to))).toContainText(request.status.pending);
      expect(writes(), 'a write left the page offline').toEqual([]);
    } finally {
      await page.context().setOffline(false);
    }
    await expect(withdraw).not.toHaveAttribute('aria-disabled', 'true');
    expect(writes(), 'the reconnect sent a write').toEqual([]);
  });
});

test.describe("an admin's request form", () => {
  test.use({ storageState: ADMIN_STATE });

  test('is not theirs: opening it lands on the overview, which offers no request', async ({ page, leavePage }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/godisnji/zatrazi');
    await expect(page).toHaveURL(/\/godisnji$/);
    await expect(leavePage.overviewTable).toBeVisible();
    await expect(leavePage.requestAction).toHaveCount(0);
    await expect(leavePage.text(godisnji.request.listHeading)).toHaveCount(0);
  });
});
