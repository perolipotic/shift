import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveRecordsInSql,
  removeSeededRotation,
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
  // No `Riješi` and no link: resolving is story 5.4's.
  await expect(conflictsPage.rows.getByRole('button')).toHaveCount(0);
  await expect(conflictsPage.rows.getByRole('link')).toHaveCount(0);

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

test.describe('a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('opening Raspored is sent to Danas', async ({ page }) => {
    await page.goto('/raspored');
    await expect(page).toHaveURL('/danas');
  });
});
