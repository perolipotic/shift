import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  leaveYearStartOf,
  removeSeededRotation,
  seedExtraTeam,
  seedLeaveMember,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { fullDate } from '../../utils/dates.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.1c: an admin records a member's leave on the member's page and sees
 * what it costs first. A team of the test's own gets a rotation from today in
 * SQL (`seedTeamRotation`: `[Dan, Noć, Slobodno, Slobodno]`) under the run's
 * rotation hold, and a fresh member on it (`seedLeaveMember`) — fresh per
 * test, because leave records persist for the run.
 *
 * The range is today to today + 4 — Dan, Noć, Slobodno, Slobodno, Dan, which
 * costs 3 — cut at the end of the current leave year (read from the
 * organization), so every day of it is charged to this year whatever the
 * date; the expected cost is counted off the seeded pattern for the same
 * days.
 *
 * The preview's cost equals the seeded working days before any save; a save
 * updates the figures; an overlapping range is refused naming the existing
 * record's dates, with both fields still holding what was typed; an
 * over-balance range saves with the warning and its number; a failed records
 * read replaces the figures, disables the form and recovers through its
 * retry; and the card does not scroll the page sideways at 390 px.
 */

test.use({ storageState: ADMIN_STATE });

const leave = hr.ljudi.leaveRecord;
const days = hr.count.days;

/** The run organization's rotation, while this file's test holds it. */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;

test.afterEach(async () => {
  try {
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
    await hold?.release();
    hold = null;
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

/** The seeded pattern's working days (`Dan`, `Noć`) from `today` to `last`. */
function workingDaysOf(today: string, last: string): number {
  let count = 0;
  for (let offset = 0; isoDaysAfter(today, offset) <= last; offset += 1) {
    if (offset % 4 < 2) count += 1;
  }

  return count;
}

interface Seeded {
  readonly member: SeededLeaveMember;
  readonly today: string;
  /** Today + 4, or the leave year's last day when that comes first. */
  readonly last: string;
  /** What today–`last` costs: its working days. */
  readonly cost: number;
}

/**
 * A team of this test's own with the seeded rotation from today, a range
 * inside the current leave year and what it costs, and a fresh member on the
 * team whose allowance `allowanceOf` picks from that cost.
 */
async function seeded(slug: string, allowanceOf: (cost: number) => number): Promise<Seeded> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const today = seed.today;
  const yearEnd = leaveYearEndOf(today, await leaveYearStartOf(slug));
  const plusFour = isoDaysAfter(today, 4);
  const last = plusFour <= yearEnd ? plusFour : yearEnd;
  const cost = workingDaysOf(today, last);
  const member = await seedLeaveMember(slug, team.id, today, allowanceOf(cost));

  return { member, today, last, cost };
}

test('the cost shows before saving, a save updates the figures, and an overlap is refused with every value kept', async ({
  peoplePage,
  fixture,
}) => {
  const { member, today, last, cost } = await seeded(fixture.slug, () => 20);
  expect(cost, 'the range holds a working day').toBeGreaterThan(0);

  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.leaveHeading).toBeVisible();
  await expect(peoplePage.leaveFigure(hr.ljudi.leave)).toHaveText(plural(days, 20));
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, 0));
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, 20));
  // No preview until both dates are in: the reason stands in its place.
  await expect(peoplePage.text(leave.incomplete)).toBeVisible();

  // THE PREVIEW, before any save: the seeded working days of the range.
  await peoplePage.enterLeave(today, last);
  await expect(peoplePage.leaveFigure(leave.cost)).toHaveText(plural(days, cost));
  await expect(peoplePage.leaveFigure(leave.balanceAfter)).toHaveText(plural(days, 20 - cost));
  await expect(peoplePage.text(leave.overlap)).toHaveCount(0);

  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.statusWith(plural(leave.saved, cost))).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue('');
  await expect(peoplePage.leaveToInput).toHaveValue('');
  // The figures are the re-read's, never optimistic.
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, cost));
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, 20 - cost));

  // AN OVERLAP: noted in the preview, refused by the database on save, named
  // by the existing record's dates, and every entered value kept. The note
  // gives way to the alert, so the overlap is said once.
  const from = last;
  const to = isoDaysAfter(last, 2);
  await peoplePage.enterLeave(from, to);
  await expect(peoplePage.text(leave.overlap)).toBeVisible();
  await peoplePage.saveLeaveButton.click();
  await expect(
    peoplePage.alertWith(fill(leave.overlapConflict, { from: fullDate(today), to: fullDate(last) })),
  ).toBeVisible();
  await expect(peoplePage.text(leave.overlap)).toHaveCount(0);
  await expect(peoplePage.leaveFromInput).toHaveValue(from);
  await expect(peoplePage.leaveToInput).toHaveValue(to);
  await expect(peoplePage.leaveFromInput).toBeFocused();
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, cost));

  // An edit clears what the refusal raised.
  await peoplePage.leaveToInput.fill(isoDaysAfter(last, 3));
  await expect(peoplePage.alertWith(fill(leave.overlapConflict, { from: fullDate(today), to: fullDate(last) }))).toHaveCount(0);
});

test('an over-balance range saves with the warning and its number, and the phone does not scroll sideways', async ({
  page,
  peoplePage,
  fixture,
}) => {
  // Two short of the cost wherever the cost allows it (`−2` for the usual 3).
  const { member, today, last, cost } = await seeded(fixture.slug, (range) => Math.max(range - 2, 0));
  const allowance = Math.max(cost - 2, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, allowance));

  // A reversed range has no preview, and its save is refused before any request.
  await peoplePage.enterLeave(isoDaysAfter(today, 1), today);
  await expect(peoplePage.text(leave.reversed)).toBeVisible();
  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.leaveToInput).toBeFocused();
  await expect(peoplePage.leaveToInput).toHaveAttribute('aria-invalid', 'true');
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, 0));

  // Over the balance: a note with the number, never a refusal.
  await peoplePage.enterLeave(today, last);
  await expect(peoplePage.leaveFigure(leave.cost)).toHaveText(plural(days, cost));
  await expect(peoplePage.text(plural(leave.exceeds, allowance - cost))).toBeVisible();
  await expectNoHorizontalScroll(page);

  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.statusWith(plural(leave.saved, cost))).toBeVisible();
  await expect(peoplePage.statusWith(plural(leave.savedExceeds, allowance - cost))).toBeVisible();
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, allowance - cost));
  await expectNoHorizontalScroll(page);
});

test('a failed records read replaces the figures and disables the form, and the retry recovers', async ({
  page,
  peoplePage,
  fixture,
}) => {
  const { member } = await seeded(fixture.slug, () => 20);
  const records = '**/rest/v1/leave_records*';

  await page.route(records, (route) => route.fulfill({ status: 500, body: '{}' }));
  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.alertWith(leave.unavailable)).toBeVisible();
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveCount(0);
  await expect(peoplePage.leaveFromInput).toBeDisabled();
  await expect(peoplePage.leaveToInput).toBeDisabled();
  await expect(peoplePage.saveLeaveButton).toBeDisabled();

  await page.unroute(records);
  await peoplePage.retryLeaveButton.click();
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, 20));
  await expect(peoplePage.alertWith(leave.unavailable)).toHaveCount(0);
  await expect(peoplePage.leaveFromInput).toBeEnabled();
  await expect(peoplePage.saveLeaveButton).toBeEnabled();
});
