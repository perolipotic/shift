import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveRecordsInSql,
  removeSeededRotation,
  seedConflictResolution,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { fullDate } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.3b: an admin opens *Raspored* and sees every unresolved conflict,
 * upcoming soonest first and past ones still listed.
 *
 * A team of the test's own gets a rotation in SQL (`seedTeamRotation`:
 * `[Dan, Noć, Slobodno, Slobodno]`) under the run's rotation hold, started
 * EIGHT days before today so past dates are scheduled too, and a fresh member
 * on it from the same day. A record over the first two days (Dan, Noć) is
 * seeded in SQL: two past conflicts. The admin then records today to today +
 * 4 — Dan, Noć, Slobodno, Slobodno, Dan, the worked example — on the member's
 * page, and opens *Raspored* without a reload: three new conflicts, ahead of
 * the two past ones, most recent of those first. Removing the record on the
 * member's page clears its three rows, again without a reload.
 *
 * The queue is the whole organization's, and other specs' members may hold
 * leave, so the member's own rows are read by name; the count is checked
 * against every row shown. The zero state is read with the records answered
 * empty, and a failed read shows the alert whose retry brings the queue back.
 *
 * Story 5.4a: a resolution seeded in SQL on one of three conflicts takes it
 * off the queue and its count. Removing the record and recording it again in
 * the app — never a reload — brings it back unresolved: the removal ended the
 * resolution with the leave that covered it (0031). Amending the record in
 * the app so one resolved date falls out of the range ends that resolution
 * alone: leave recorded over the date again shows it unresolved on the queue,
 * the calendar and *Sati*, while the resolved date that stayed covered stays
 * resolved — again without a reload. A failed resolutions read
 * shows the same alert, and its retry brings the queue back.
 */

test.use({ storageState: ADMIN_STATE });

const raspored = hr.raspored;

/** The run organization's rotation, while this file's test holds it. */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** The member whose records the test wrote, soft-removed afterwards. */
let member: { readonly slug: string; readonly id: string } | null = null;

test.afterEach(async () => {
  try {
    if (member !== null) await removeLeaveRecordsInSql(member.slug, member.id).catch(() => undefined);
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    member = null;
    seed = null;
    await hold?.release();
    hold = null;
  }
});

/** An ISO date `count` days after another (negative for before), by calendar arithmetic in UTC. */
function isoDaysAfter(iso: string, count: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);

  return day.toISOString().slice(0, 10);
}

/** A row that is dated `iso`: its text starts with the date, ahead of the range it names. */
function datedOn(iso: string): RegExp {
  return new RegExp(`^${fullDate(iso).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** How many days before today the seeded rotation and membership start. */
const DAYS_BEFORE = 8;

test('lists the new conflicts without a reload, upcoming first and past ones after, and a removal clears them', async ({
  page,
  conflictsPage,
  peoplePage,
  fixture,
}) => {
  hold = holdRotation(fixture.slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(fixture.slug, team.id, suffix, DAYS_BEFORE);
  const { today, start, steps, ranges } = seed;
  const seeded = await seedLeaveMember(fixture.slug, team.id, start, 20);
  member = { slug: fixture.slug, id: seeded.id };
  // Offsets 0 and 1 of the pattern: Dan, Noć — both already past.
  const past = { from: start, to: isoDaysAfter(start, 1) };
  await seedLeaveRecord(fixture.slug, seeded.id, past.from, past.to);
  // The worked example: today is offset 8 (Dan), so Dan, Noć, Slobodno, Slobodno, Dan.
  const worked = { from: today, to: isoDaysAfter(today, 4) };

  await peoplePage.gotoMember(seeded.id);
  await expect(peoplePage.leaveHeading).toBeVisible();
  // A marker on the window: if any step below reloads the page, it is gone.
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });

  // THE PAST ROWS FIRST: most recent first, each with its own words.
  await peoplePage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(conflictsPage.heading(hr.nav.raspored)).toBeVisible();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(fullDate(isoDaysAfter(start, 1)));
  await expect(rows.nth(1)).toContainText(fullDate(start));
  for (const index of [0, 1]) await expect(rows.nth(index)).toContainText(raspored.past);
  await expect(rows.nth(0)).toContainText(
    fill(raspored.detailTimed, { type: steps[1], times: ranges[1] ?? '', from: fullDate(past.from), to: fullDate(past.to) }),
  );

  // RECORD THE WORKED EXAMPLE on the member's page, back without a reload.
  await page.goBack();
  await expect(peoplePage.leaveHeading).toBeVisible();
  await peoplePage.enterLeave(worked.from, worked.to);
  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.status).toBeVisible();

  await peoplePage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(rows).toHaveCount(5);
  const expected = [
    { date: today, step: 0, past: false },
    { date: isoDaysAfter(today, 1), step: 1, past: false },
    { date: isoDaysAfter(today, 4), step: 0, past: false },
    { date: isoDaysAfter(start, 1), step: 1, past: true },
    { date: start, step: 0, past: true },
  ] as const;
  for (const [index, row] of expected.entries()) {
    const shown = rows.nth(index);
    const range = row.past ? past : worked;
    await expect(shown).toContainText(fullDate(row.date));
    await expect(shown).toContainText(fill(raspored.who, { member: seeded.name, team: team.name }));
    await expect(shown).toContainText(
      fill(raspored.detailTimed, {
        type: steps[row.step],
        times: ranges[row.step] ?? '',
        from: fullDate(range.from),
        to: fullDate(range.to),
      }),
    );
    if (row.past) await expect(shown).toContainText(raspored.past);
    else await expect(shown).not.toContainText(raspored.past);
  }
  // The count is every row shown, whoever's — read together and retried,
  // because other specs write leave to the same organization meanwhile.
  await expect
    .poll(async () => {
      const shown = await conflictsPage.rows.count();
      const heading = await conflictsPage.anyCountHeading.textContent();

      return heading === plural(raspored.count, shown);
    })
    .toBe(true);
  // No `Riješi`, no checkbox and no bulk action: since story 5.4b each row is
  // one link to its resolution screen, and nothing else.
  await expect(conflictsPage.rows.getByRole('button')).toHaveCount(0);
  await expect(conflictsPage.rows.getByRole('checkbox')).toHaveCount(0);
  await expect
    .poll(async () => (await conflictsPage.rows.getByRole('link').count()) === (await conflictsPage.rows.count()))
    .toBe(true);

  // REMOVE THE RECORD on the member's page: its three rows clear.
  await page.goBack();
  await expect(peoplePage.leaveHeading).toBeVisible();
  await peoplePage.removeLeaveButton(worked.from, worked.to).click();
  const confirm = peoplePage.dialog();
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(confirm).toHaveCount(0);
  await expect(peoplePage.removeLeaveButton(worked.from, worked.to)).toHaveCount(0);

  await peoplePage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(rows).toHaveCount(2);
  for (const index of [0, 1]) await expect(rows.nth(index)).toContainText(raspored.past);
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);

  // The phone does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
});

test('a resolved conflict leaves the queue and its count, and comes back unresolved once its leave is removed and recorded again', async ({
  page,
  conflictsPage,
  peoplePage,
  fixture,
}) => {
  hold = holdRotation(fixture.slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(fixture.slug, team.id, suffix);
  const { today } = seed;
  const seeded = await seedLeaveMember(fixture.slug, team.id, today, 20);
  member = { slug: fixture.slug, id: seeded.id };
  // The worked example from today: Dan, Noć, Slobodno, Slobodno, Dan — three conflicts, today's resolved.
  const worked = { from: today, to: isoDaysAfter(today, 4) };
  await seedLeaveRecord(fixture.slug, seeded.id, worked.from, worked.to);
  await seedConflictResolution(fixture.slug, seeded.id, today, team.id);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(2);
  // Today's is resolved: the two left are 1 and 4 days on.
  await expect(rows.nth(0)).toHaveText(datedOn(isoDaysAfter(today, 1)));
  await expect(rows.nth(1)).toHaveText(datedOn(isoDaysAfter(today, 4)));
  // The count is every row shown, whoever's, read together and retried.
  await expect
    .poll(async () => {
      const shown = await conflictsPage.rows.count();
      const heading = await conflictsPage.anyCountHeading.textContent();

      return heading === plural(raspored.count, shown);
    })
    .toBe(true);
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });

  // REMOVE THEN RE-RECORD in the app: the removal ended the resolution with its leave.
  await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
  await peoplePage.listedMember(seeded.name).click();
  await expect(peoplePage.leaveHeading).toBeVisible();
  await peoplePage.removeLeaveButton(worked.from, worked.to).click();
  const confirm = peoplePage.dialog();
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(confirm).toHaveCount(0);
  await expect(peoplePage.removeLeaveButton(worked.from, worked.to)).toHaveCount(0);
  await peoplePage.enterLeave(worked.from, worked.to);
  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.status).toBeVisible();

  await peoplePage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveText(datedOn(today));
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);
});

test('an amend that takes a resolved date out of the range ends that resolution alone, on every surface, without a reload', async ({
  page,
  conflictsPage,
  peoplePage,
  calendarPage,
  hoursPage,
  fixture,
}) => {
  hold = holdRotation(fixture.slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(fixture.slug, team.id, suffix);
  const { today } = seed;
  const seeded = await seedLeaveMember(fixture.slug, team.id, today, 20);
  member = { slug: fixture.slug, id: seeded.id };
  // The worked example: conflicts on today (Dan), +1 (Noć) and +4 (Dan); today and +4 resolved.
  const worked = { from: today, to: isoDaysAfter(today, 4) };
  const dropped = isoDaysAfter(today, 4);
  await seedLeaveRecord(fixture.slug, seeded.id, worked.from, worked.to);
  await seedConflictResolution(fixture.slug, seeded.id, today, team.id);
  await seedConflictResolution(fixture.slug, seeded.id, dropped, team.id);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveText(datedOn(isoDaysAfter(today, 1)));
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });

  // AMEND SHRINK in the app: today–+1. Today stays covered, +4 leaves the range.
  const amended = { from: today, to: isoDaysAfter(today, 1) };
  await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
  await peoplePage.listedMember(seeded.name).click();
  await expect(peoplePage.leaveHeading).toBeVisible();
  await peoplePage.amendLeaveButton(worked.from, worked.to).click();
  await expect(peoplePage.leaveAmendGroup(worked.from, worked.to)).toBeVisible();
  await peoplePage.leaveToInput.fill(amended.to);
  await peoplePage.amendSaveButton.click();
  await expect(peoplePage.leaveNewGroup).toBeVisible();
  await expect(peoplePage.leaveRecordRows).toHaveCount(1);

  await peoplePage.navigationLink(hr.nav.raspored, { exact: true }).click();
  // Today is still resolved; +1 stands; +4 is no longer on leave.
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toHaveText(datedOn(isoDaysAfter(today, 1)));

  // LEAVE OVER +4 AGAIN: the amend ended its resolution, so it comes back unresolved.
  await page.goBack();
  await expect(peoplePage.leaveHeading).toBeVisible();
  await peoplePage.enterLeave(dropped, dropped);
  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.status).toBeVisible();

  await peoplePage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText(datedOn(isoDaysAfter(today, 1)));
  await expect(rows.nth(1)).toHaveText(datedOn(dropped));

  // THE CALENDAR agrees: +4 marked, today not.
  const conflict = new RegExp(`, ${hr.kalendar.modifier.conflict}(,|$)`);
  await peoplePage.navigationLink(hr.nav.kalendar, { exact: true }).click();
  await expect(calendarPage.columnHeader(team.name)).toBeVisible();
  for (const [date, marked] of [
    [today, false],
    [isoDaysAfter(today, 1), true],
    [dropped, true],
  ] as const) {
    await calendarPage.showMonthOf(date, today);
    const cell = await calendarPage.cellOf(team.name, date);
    if (marked) await expect(cell, date).toHaveAccessibleName(conflict);
    else await expect(cell, date).not.toHaveAccessibleName(conflict);
  }

  // SATI agrees: this month's unresolved of +1 and +4.
  const month = today.slice(0, 7);
  const expected = [isoDaysAfter(today, 1), dropped].filter((date) => date.startsWith(`${month}-`)).length;
  await peoplePage.navigationLink(hr.nav.sati, { exact: true }).click();
  const row = hoursPage.organizationRow(seeded.name);
  await expect(row).toHaveCount(1);
  // On the month's last day both fall in the next month, and this month's cell reads 0.
  await expect(await hoursPage.cellIn(row, hr.sati.organization.conflicts)).toHaveText(
    expected === 0 ? '0' : `⚠${String(expected)}`,
  );
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);
});

test('shows the zero count and the true sentence when there is no live leave', async ({ page, conflictsPage }) => {
  // Answered as PostgREST answers an exact count of none: the read checks the
  // count against the rows, so the header is part of the answer.
  await page.route('**/rest/v1/leave_records*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      // Exposed across origins, as the API exposes it, or the page cannot read it.
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Content-Range',
        'content-range': '*/0',
      },
      body: '[]',
    }),
  );

  await conflictsPage.goto();
  await expect(conflictsPage.countHeading(0)).toBeVisible();
  await expect(conflictsPage.countHeading(0)).toHaveText('0 neriješenih konflikata');
  await expect(conflictsPage.emptySentence).toBeVisible();
  await expect(conflictsPage.rows).toHaveCount(0);
});

test('a failed read refuses the whole list, and the retry brings it back', async ({ page, conflictsPage }) => {
  const records = '**/rest/v1/leave_records*';
  await page.route(records, (route) => route.fulfill({ status: 500, body: '{}' }));

  await conflictsPage.goto();
  await expect(conflictsPage.alertWith(raspored.unavailable)).toBeVisible();
  await expect(conflictsPage.anyCountHeading).toHaveCount(0);
  await expect(conflictsPage.rows).toHaveCount(0);

  await page.unroute(records);
  await conflictsPage.retryButton.click();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.alertWith(raspored.unavailable)).toHaveCount(0);
});

test('a failed resolutions read refuses the whole list, and the retry brings it back', async ({ page, conflictsPage }) => {
  const resolutions = '**/rest/v1/conflict_resolutions*';
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));

  await conflictsPage.goto();
  await expect(conflictsPage.alertWith(raspored.unavailable)).toBeVisible();
  await expect(conflictsPage.anyCountHeading).toHaveCount(0);
  await expect(conflictsPage.rows).toHaveCount(0);

  await page.unroute(resolutions);
  await conflictsPage.retryButton.click();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.alertWith(raspored.unavailable)).toHaveCount(0);
});

test.describe('a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('opening Raspored is sent to Danas', async ({ page }) => {
    await page.goto('/raspored');
    await expect(page).toHaveURL('/danas');
  });
});
