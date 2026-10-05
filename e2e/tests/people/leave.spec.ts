import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  leaveYearStartOf,
  removeLeaveRecordsInSql,
  removeRosterOverridesInSql,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedConflictResolution,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
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
 *
 * Story 5.2b: the card lists the member's live records, soonest first, each
 * with its cost. An amend previews without the record it amends, refuses its
 * own unchanged range before any request, refuses an overlap naming the other
 * record with amend mode and every value kept, and its save updates the
 * figures; a removal takes exactly one confirmation and restores the balance,
 * while a cancel or Escape sends nothing and returns focus to Ukloni; a record
 * removed from under the screen closes amend mode or the confirmation, says
 * so and refreshes the list. A refused removal keeps its confirmation open
 * with the alert inside; a failed amend keeps amend mode and re-reads the
 * records; an amend over the balance warns with its number; removing the
 * record in amend mode, or cancelling the amend, returns the form to a new
 * record. Records are seeded in SQL (`seedLeaveRecord`)
 * and removed from under the screen the same way (`removeLeaveRecordsInSql`).
 *
 * Story 5.4e: an amend or a removal that uncovers a date someone replaced the
 * member on names that replacement, who stays rostered, in the amend preview
 * (inside its polite live region) or the removal confirmation, and again in
 * the notice after the write lands; an amend that keeps the date says
 * nothing, and neither does a replacement whose override was removed. A
 * failed resolutions read says the replacements cannot be checked and blocks
 * nothing, and opening a removal re-reads them, so a replacement written
 * since the page loaded is named. Each replacement is seeded with its
 * override in SQL (`seedConflictResolution`).
 */

test.use({ storageState: ADMIN_STATE });

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

/** The seeded pattern's working days (`Dan`, `Noć`) from `today` to `last`. */
function workingDaysOf(today: string, last: string): number {
  return workingDaysIn(today, today, last);
}

/** The seeded pattern's working days from `from` to `to`, the pattern starting on `today`. */
function workingDaysIn(today: string, from: string, to: string): number {
  let count = 0;
  for (let offset = 0; isoDaysAfter(today, offset) <= to; offset += 1) {
    if (isoDaysAfter(today, offset) >= from && offset % 4 < 2) count += 1;
  }

  return count;
}

/** A record's inclusive dates, both `YYYY-MM-DD`. */
interface Range {
  readonly from: string;
  readonly to: string;
}

/** What a record charges this leave year when that is not its whole cost, as its removal prompt says; else undefined. */
function inYearOf(seed: Seeded, range: Range): number | undefined {
  const charge = chargeOf(seed, range);

  return charge === workingDaysIn(seed.today, range.from, range.to) ? undefined : charge;
}

/** The range `from`–`to` as the card writes it. */
function labelOf(range: Range): string {
  return `${fullDate(range.from)}–${fullDate(range.to)}`;
}

interface Seeded {
  readonly member: SeededLeaveMember;
  /** The test's own team, which the seeded rotation runs on. */
  readonly team: { readonly id: string; readonly name: string };
  readonly today: string;
  /** Today + 4, or the leave year's last day when that comes first. */
  readonly last: string;
  /** What today–`last` costs: its working days. */
  readonly cost: number;
  /** The current leave year's last day. */
  readonly yearEnd: string;
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
  written = { slug, members: [], teams: [team.id] };
  seed = await seedTeamRotation(slug, team.id, suffix);
  const today = seed.today;
  const yearEnd = leaveYearEndOf(today, await leaveYearStartOf(slug));
  const plusFour = isoDaysAfter(today, 4);
  const last = plusFour <= yearEnd ? plusFour : yearEnd;
  const cost = workingDaysOf(today, last);
  const member = await seedLeaveMember(slug, team.id, today, allowanceOf(cost));
  written.members.push(member.id);

  return { member, team, today, last, cost, yearEnd };
}

/** What a record charges the current leave year: its working days up to the year's last day. */
function chargeOf(seed: Seeded, range: Range): number {
  if (range.from > seed.yearEnd) return 0;

  return workingDaysIn(seed.today, range.from, range.to < seed.yearEnd ? range.to : seed.yearEnd);
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

test('an amend previews without its record, refuses an overlap naming the other, and its save updates the figures', async ({
  peoplePage,
  fixture,
}) => {
  const seed = await seeded(fixture.slug, () => 20);
  const { member, today } = seed;
  const first = { from: today, to: isoDaysAfter(today, 4) };
  const second = { from: isoDaysAfter(today, 8), to: isoDaysAfter(today, 12) };
  await seedLeaveRecord(fixture.slug, member.id, second.from, second.to);
  await seedLeaveRecord(fixture.slug, member.id, first.from, first.to);

  // THE LIST: soonest first, each with its range and what it costs.
  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.leaveRecordRows).toHaveCount(2);
  await expect(peoplePage.leaveRecordRows.nth(0)).toContainText(labelOf(first));
  await expect(peoplePage.leaveRecordRows.nth(0)).toContainText(plural(days, workingDaysIn(today, first.from, first.to)));
  await expect(peoplePage.leaveRecordRows.nth(1)).toContainText(labelOf(second));
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, chargeOf(seed, first) + chargeOf(seed, second)));

  // AMEND MODE: the legend names the record, its range fills the one form.
  await peoplePage.amendLeaveButton(first.from, first.to).click();
  await expect(peoplePage.leaveAmendGroup(first.from, first.to)).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue(first.from);
  await expect(peoplePage.leaveToInput).toHaveValue(first.to);
  await expect(peoplePage.leaveFromInput).toBeFocused();

  // Its own range unchanged: a reason, no preview, and nothing sent.
  await expect(peoplePage.text(leave.unchanged)).toBeVisible();
  await peoplePage.amendSaveButton.click();
  await expect(peoplePage.leaveFromInput).toBeFocused();
  await expect(peoplePage.leaveFromInput).toHaveAttribute('aria-invalid', 'true');

  // THE PREVIEW leaves the amended record out: no overlap with its own dates,
  // and the balance after it charges the new range alone.
  const amended = { from: today, to: isoDaysAfter(today, 6) };
  await peoplePage.leaveToInput.fill(amended.to);
  await expect(peoplePage.leaveFigure(leave.cost)).toHaveText(plural(days, workingDaysIn(today, amended.from, amended.to)));
  await expect(peoplePage.leaveFigure(leave.balanceAfter)).toHaveText(
    plural(days, 20 - chargeOf(seed, second) - chargeOf(seed, amended)),
  );
  await expect(peoplePage.text(leave.overlap)).toHaveCount(0);

  // AN OVERLAP onto the other record: named by its dates, amend mode and every value kept.
  const overlapping = isoDaysAfter(today, 9);
  await peoplePage.leaveToInput.fill(overlapping);
  await expect(peoplePage.text(leave.overlap)).toBeVisible();
  await peoplePage.amendSaveButton.click();
  await expect(
    peoplePage.alertWith(fill(leave.overlapConflict, { from: fullDate(second.from), to: fullDate(second.to) })),
  ).toBeVisible();
  await expect(peoplePage.leaveAmendGroup(first.from, first.to)).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue(first.from);
  await expect(peoplePage.leaveToInput).toHaveValue(overlapping);
  await expect(peoplePage.leaveFromInput).toBeFocused();

  // THE SAVE: what the new range cost, the form back to a new record, and the re-read figures.
  await peoplePage.leaveToInput.fill(amended.to);
  await peoplePage.amendSaveButton.click();
  await expect(peoplePage.statusWith(plural(leave.amended, workingDaysIn(today, amended.from, amended.to)))).toBeVisible();
  await expect(peoplePage.leaveNewGroup).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue('');
  await expect(peoplePage.leaveToInput).toHaveValue('');
  const used = chargeOf(seed, amended) + chargeOf(seed, second);
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, used));
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, 20 - used));
  await expect(peoplePage.leaveRecordRows).toHaveCount(2);
  await expect(peoplePage.leaveRecordRows.nth(0)).toContainText(labelOf(amended));
});

test('a removal takes one confirmation and restores the balance, a cancel sends nothing, and the phone does not scroll sideways', async ({
  page,
  peoplePage,
  fixture,
}) => {
  const seed = await seeded(fixture.slug, () => 20);
  const { member, today } = seed;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);

  await page.setViewportSize({ width: 390, height: 844 });
  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, chargeOf(seed, record)));
  await expectNoHorizontalScroll(page);

  // The confirmation names the range and what it costs.
  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(seed, record));

  // CANCEL sends nothing, and focus is back on Ukloni.
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await expectNoHorizontalScroll(page);
  await peoplePage.cancelRemoveLeaveIn(confirm).click();
  await expect(confirm).toBeHidden();
  await expect(peoplePage.removeLeaveButton(record.from, record.to)).toBeFocused();
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);

  // So does Escape.
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(peoplePage.removeLeaveButton(record.from, record.to)).toBeFocused();
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, chargeOf(seed, record)));

  // CONFIRMED: the record leaves the list and the balance is whole again.
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(peoplePage.statusWith(fill(leave.removed, { from: fullDate(record.from), to: fullDate(record.to) }))).toBeVisible();
  await expect(confirm).toBeHidden();
  await expect(peoplePage.leaveRecordRows).toHaveCount(0);
  await expect(peoplePage.text(leave.recordsEmpty)).toBeVisible();
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, 0));
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, 20));
  await expectNoHorizontalScroll(page);
});

test('a record removed from under the screen closes amend mode or the confirmation, says so, and refreshes the list', async ({
  peoplePage,
  fixture,
}) => {
  const seed = await seeded(fixture.slug, () => 20);
  const { member, today } = seed;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);

  // AN AMEND of a record already gone.
  await peoplePage.gotoMember(member.id);
  await peoplePage.amendLeaveButton(record.from, record.to).click();
  await expect(peoplePage.leaveAmendGroup(record.from, record.to)).toBeVisible();
  await removeLeaveRecordsInSql(fixture.slug, member.id);
  await peoplePage.leaveToInput.fill(isoDaysAfter(today, 6));
  await peoplePage.amendSaveButton.click();
  await expect(peoplePage.alertWith(leave.gone)).toBeVisible();
  await expect(peoplePage.alertWith(leave.gone)).toBeFocused();
  await expect(peoplePage.leaveNewGroup).toBeVisible();
  await expect(peoplePage.leaveRecordRows).toHaveCount(0);
  await expect(peoplePage.leaveFigure(leave.used)).toHaveText(plural(days, 0));

  // A REMOVAL of a record already gone.
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  await peoplePage.gotoMember(member.id);
  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(seed, record));
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await removeLeaveRecordsInSql(fixture.slug, member.id);
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(peoplePage.alertWith(leave.gone)).toBeVisible();
  await expect(peoplePage.alertWith(leave.gone)).toBeFocused();
  await expect(confirm).toBeHidden();
  await expect(peoplePage.leaveRecordRows).toHaveCount(0);
});

/** A PostgREST error body, as the database's refusal comes back. */
function postgrestError(code: string): string {
  return JSON.stringify({ code, message: code, details: null, hint: null });
}

test('a refused removal keeps its one confirmation open with the alert inside, and the record listed', async ({
  page,
  peoplePage,
  fixture,
}) => {
  const seed = await seeded(fixture.slug, () => 20);
  const { member, today } = seed;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  await peoplePage.gotoMember(member.id);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const removal = '**/rest/v1/rpc/remove_leave_record*';
  await page.route(removal, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();

      return;
    }
    await held;
    await route.fulfill({ status: 500, contentType: 'application/json', body: postgrestError('XX000') });
  });

  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(seed, record));
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  // While held, Escape leaves it open.
  await page.keyboard.press('Escape');
  await expect(confirm).toBeVisible();
  release();

  await expect(peoplePage.alertIn(confirm, leave.removeFailed)).toBeVisible();
  await expect(confirm).toBeVisible();
  await expect(peoplePage.cancelRemoveLeaveIn(confirm)).toBeFocused();
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);

  // DENIED has its own words, in the same place.
  await page.unroute(removal);
  await page.route(removal, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: postgrestError('42501') })
      : route.continue(),
  );
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(peoplePage.alertIn(confirm, leave.removeDenied)).toBeVisible();
  await expect(confirm).toBeVisible();
  await expect(peoplePage.cancelRemoveLeaveIn(confirm)).toBeFocused();
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);
  await peoplePage.cancelRemoveLeaveIn(confirm).click();
  await expect(confirm).toBeHidden();
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);
});

test('a failed amend keeps amend mode and every value and re-reads the records, and an amend over the balance warns', async ({
  page,
  peoplePage,
  fixture,
}) => {
  // No allowance: whatever the amend charges goes over it.
  const seed = await seeded(fixture.slug, () => 0);
  const { member, today } = seed;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const amended = { from: today, to: isoDaysAfter(today, 6) };
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  await peoplePage.gotoMember(member.id);
  await peoplePage.amendLeaveButton(record.from, record.to).click();
  await peoplePage.leaveToInput.fill(amended.to);

  // A FAILED AMEND, and the records read again after it.
  let answered = false;
  let readsAfter = 0;
  page.on('request', (request) => {
    if (answered && request.method() === 'GET' && request.url().includes('/rest/v1/leave_records')) readsAfter += 1;
  });
  const amend = '**/rest/v1/rpc/amend_leave_record*';
  await page.route(amend, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();

      return;
    }
    answered = true;
    await route.fulfill({ status: 500, contentType: 'application/json', body: postgrestError('XX000') });
  });
  await peoplePage.amendSaveButton.click();
  await expect(peoplePage.alertWith(leave.amendFailed)).toBeVisible();
  await expect(peoplePage.leaveAmendGroup(record.from, record.to)).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue(amended.from);
  await expect(peoplePage.leaveToInput).toHaveValue(amended.to);
  await expect.poll(() => readsAfter, { message: 'the records were not re-read after the amend' }).toBeGreaterThan(0);

  // OVER THE BALANCE: saved, with the warning and its number.
  await page.unroute(amend);
  await peoplePage.amendSaveButton.click();
  const charge = chargeOf(seed, amended);
  await expect(peoplePage.statusWith(plural(leave.amended, workingDaysIn(today, amended.from, amended.to)))).toBeVisible();
  await expect(peoplePage.statusWith(plural(leave.savedExceeds, 0 - charge))).toBeVisible();
  await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(days, 0 - charge));
});

test('cancelling an amend, or removing the record it amends, returns the form to a new record', async ({
  peoplePage,
  fixture,
}) => {
  const seed = await seeded(fixture.slug, () => 20);
  const { member, today } = seed;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  await peoplePage.gotoMember(member.id);

  // CANCEL: a new record, empty, and focus back on that row's Izmijeni.
  await peoplePage.amendLeaveButton(record.from, record.to).click();
  await expect(peoplePage.leaveAmendGroup(record.from, record.to)).toBeVisible();
  await expect(peoplePage.leaveRecordRow(record.from, record.to)).toContainText(leave.amending);
  await expect(peoplePage.amendLeaveButton(record.from, record.to)).toBeDisabled();
  await peoplePage.amendCancelButton.click();
  await expect(peoplePage.leaveNewGroup).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue('');
  await expect(peoplePage.leaveToInput).toHaveValue('');
  await expect(peoplePage.amendLeaveButton(record.from, record.to)).toBeFocused();

  // REMOVING THE RECORD IN AMEND MODE ends amend mode with it.
  await peoplePage.amendLeaveButton(record.from, record.to).click();
  await expect(peoplePage.leaveAmendGroup(record.from, record.to)).toBeVisible();
  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(seed, record));
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(peoplePage.statusWith(fill(leave.removed, { from: fullDate(record.from), to: fullDate(record.to) }))).toBeVisible();
  await expect(peoplePage.leaveNewGroup).toBeVisible();
  await expect(peoplePage.leaveFromInput).toHaveValue('');
  await expect(peoplePage.leaveToInput).toHaveValue('');
  await expect(peoplePage.leaveRecordRows).toHaveCount(0);
});

/**
 * Story 5.4e: a second fresh member on a team of their own, put on the test
 * team's shift on each of `dates` in place of the seeded member — the
 * override and its `replace_member` resolution, as 0032 writes them. The
 * leave covering those dates must already be seeded.
 */
async function replacedOn(slug: string, setup: Seeded, dates: readonly string[]): Promise<SeededLeaveMember> {
  const own = await seedExtraTeam(slug, `Zamjene ${randomBytes(3).toString('hex')}`);
  written.teams.push(own.id);
  const replacement = await seedLeaveMember(slug, own.id, setup.today, 20);
  written.members.unshift(replacement.id);
  for (const date of dates) {
    await seedConflictResolution(slug, setup.member.id, date, setup.team.id, 'replace_member', replacement.id);
  }

  return replacement;
}

test('an amend that uncovers a replaced date names the replacement in the preview and the notice; one that keeps it says nothing', async ({
  peoplePage,
  fixture,
}) => {
  const setup = await seeded(fixture.slug, () => 20);
  const { member, team, today } = setup;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  // Today is the seeded pattern's Dan: the member works it, and someone else is put on it.
  const replacement = await replacedOn(fixture.slug, setup, [today]);
  const line = peoplePage.replacementStaysLine(replacement.name, team.name, today);

  await peoplePage.gotoMember(member.id);
  await peoplePage.amendLeaveButton(record.from, record.to).click();

  // UNCOVERS: the amend starts the day after, so today is the member's again
  // — and the replacement stays. A note in the polite live region, never a gate.
  const later = isoDaysAfter(today, 1);
  await peoplePage.leaveFromInput.fill(later);
  await expect(peoplePage.leavePreviewRegion).toHaveAttribute('aria-live', 'polite');
  await expect(peoplePage.leavePreviewRegion.getByText(line, { exact: true })).toBeVisible();
  await expect(peoplePage.amendSaveButton).toBeEnabled();

  // KEEPS: today is still covered, so nothing is said.
  await peoplePage.leaveFromInput.fill(today);
  await peoplePage.leaveToInput.fill(isoDaysAfter(today, 3));
  await expect(peoplePage.leaveFigure(leave.cost)).toHaveText(plural(days, workingDaysIn(today, today, isoDaysAfter(today, 3))));
  await expect(peoplePage.text(line)).toHaveCount(0);
  await expect(peoplePage.text(leave.replacementsUnknown)).toHaveCount(0);

  // THE SAVE of the uncovering amend: the notice repeats the line captured before it.
  await peoplePage.leaveFromInput.fill(later);
  await peoplePage.leaveToInput.fill(record.to);
  await expect(peoplePage.leavePreviewRegion.getByText(line, { exact: true })).toBeVisible();
  await peoplePage.amendSaveButton.click();
  const notice = peoplePage.statusWith(plural(leave.amended, workingDaysIn(today, later, record.to)));
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(line);
  await expect(peoplePage.leaveNewGroup).toBeVisible();
});

test('a removal names every replacement left rostered, by date, and none whose override was removed; the phone does not scroll sideways', async ({
  page,
  peoplePage,
  fixture,
}) => {
  const setup = await seeded(fixture.slug, () => 20);
  const { member, team, today } = setup;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  // Dan and Noć, the two working days at the record's start.
  const tomorrow = isoDaysAfter(today, 1);
  const replacement = await replacedOn(fixture.slug, setup, [tomorrow, today]);
  const first = peoplePage.replacementStaysLine(replacement.name, team.name, today);
  const second = peoplePage.replacementStaysLine(replacement.name, team.name, tomorrow);

  await page.setViewportSize({ width: 390, height: 844 });
  await peoplePage.gotoMember(member.id);
  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(setup, record));

  // SEVERAL: two lines, by date, beside an enabled confirm.
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('listitem')).toHaveText([first, second]);
  await expect(peoplePage.confirmRemoveLeaveIn(confirm)).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await peoplePage.cancelRemoveLeaveIn(confirm).click();
  await expect(confirm).toBeHidden();

  // OVERRIDE REMOVED: tomorrow's replacement is taken off the roster, so it no longer stays.
  if (seed === null) throw new Error('E2E: the rotation was not seeded');
  await removeRosterOverridesInSql(seed, team.id, tomorrow);
  await peoplePage.gotoMember(member.id);
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('listitem')).toHaveText([first]);

  // THE REMOVAL lands, and its notice repeats the line captured before it.
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  const notice = peoplePage.statusWith(fill(leave.removed, { from: fullDate(record.from), to: fullDate(record.to) }));
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(first);
  await expect(notice).not.toContainText(second);
  await expectNoHorizontalScroll(page);
});

test('a failed resolutions read says the replacements cannot be checked, in the preview and the confirmation, and blocks nothing', async ({
  page,
  peoplePage,
  fixture,
}) => {
  const setup = await seeded(fixture.slug, () => 20);
  const { member, today } = setup;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);
  const resolutions = '**/rest/v1/conflict_resolutions*';
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));

  await peoplePage.gotoMember(member.id);

  // AN AMEND that uncovers today: the line in the preview's live region, the save still enabled.
  await peoplePage.amendLeaveButton(record.from, record.to).click();
  await peoplePage.leaveFromInput.fill(isoDaysAfter(today, 1));
  await expect(peoplePage.leavePreviewRegion.getByText(leave.replacementsUnknown, { exact: true })).toBeVisible();
  await expect(peoplePage.amendSaveButton).toBeEnabled();
  await peoplePage.amendCancelButton.click();

  // A REMOVAL: the line in the confirmation, the confirm still enabled.
  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(setup, record));
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(leave.replacementsUnknown, { exact: true })).toBeVisible();
  await expect(peoplePage.confirmRemoveLeaveIn(confirm)).toBeEnabled();
  await peoplePage.cancelRemoveLeaveIn(confirm).click();
  await page.unroute(resolutions);
});

test('opening a removal re-reads the replacements, so one written since the page loaded is named', async ({
  peoplePage,
  fixture,
}) => {
  const setup = await seeded(fixture.slug, () => 20);
  const { member, team, today } = setup;
  const record = { from: today, to: isoDaysAfter(today, 4) };
  const cost = workingDaysIn(today, record.from, record.to);
  await seedLeaveRecord(fixture.slug, member.id, record.from, record.to);

  await peoplePage.gotoMember(member.id);
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);

  // Written in SQL with the page open: neither the resolutions nor the override was ever read.
  const replacement = await replacedOn(fixture.slug, setup, [today]);
  const confirm = peoplePage.removeLeaveConfirmOf(record.from, record.to, cost, inYearOf(setup, record));
  await peoplePage.removeLeaveButton(record.from, record.to).click();
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('listitem')).toHaveText([peoplePage.replacementStaysLine(replacement.name, team.name, today)]);
});
