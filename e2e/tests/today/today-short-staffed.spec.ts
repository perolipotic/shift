import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  setMinimumMembersInSql,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, weekdayOf } from '../../utils/dates.ts';
import { fill, hr, icu } from '../../utils/i18n.ts';
import { onlyRowsOf } from '../../utils/routes.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 11.4 on admin *Danas*: while *Najmanje ljudi u smjeni* is set, a
 * *Premalo ljudi* card after *Treba tebe* counts the short-staffed shifts of
 * the week *Ovaj tjedan* draws, and each row opens that day's detail on
 * *Kalendar*. With the setting empty there is no card.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and four fresh
 * members, two of them on leave over today + 4 (a Dan). The hold leaves this
 * team the only one with a rotation in force this week, so with the minimum
 * at 3 exactly that one shift is short: the count is 1. The organization's
 * leave reads are narrowed to these four (other specs write leave to the same
 * organization). With nobody away the card shows 0 and its calm line. The setting is set in SQL for the case and restored after
 * it; everything written is removed in `afterEach`.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });
test.describe.configure({ mode: 'serial' });

const admin = hr.danas.admin;
const staffing = hr.popunjenost;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; members: string[]; teams: string[] } | null = null;

test.afterEach(async () => {
  // EVERY STEP RUNS, whichever fails; the first failure is reported once all have run.
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (cause) {
      failures.push(cause);
    }
  };
  const seeded = seed;
  const own = written;

  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  seed = null;
  written = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

/**
 * The hold, a team of the test's own on the seeded rotation from today, four
 * members, `away` of them (two by default) on leave over today + 4 (a Dan).
 */
async function teamOfFourTwoOnLeave(slug: string, away = 2): Promise<{
  readonly team: { readonly id: string; readonly name: string };
  readonly rotation: SeededRotation;
  readonly date: string;
  readonly members: readonly string[];
}> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const date = addDays(rotation.today, 4);
  for (let index = 0; index < 4; index += 1) {
    const person = await seedLeaveMember(slug, team.id, rotation.today, 20);
    own.members.push(person.id);
    if (index < away) await seedLeaveRecord(slug, person.id, date, date);
  }

  return { team, rotation, date, members: own.members };
}

test('the minimum at 3, two of four away on a Dan: Premalo ljudi counts 1, and its row opens that day', async ({
  fixture,
  page,
  todayPage,
  calendarPage,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, rotation, date, members } = await teamOfFourTwoOnLeave(fixture.slug);
  await onlyRowsOf(page, members);
  const was = await setMinimumMembersInSql(fixture.slug, 3);
  try {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.shortStaffedCard).toBeVisible();
    await expect(todayPage.shortStaffedCount(1)).toBeVisible();
    await expect(todayPage.shortStaffedCalm(3)).toHaveCount(0);
    await expect(todayPage.shortStaffedCard.getByRole('alert')).toHaveCount(0);

    // ONE ROW: the date, the team, the type, people at work against the minimum.
    await expect(todayPage.shortStaffedRowLinks).toHaveCount(1);
    const row = todayPage.shortStaffedRowLinks.first();
    await expect(row).toHaveText(
      fill(admin.shortStaffed.row, {
        weekday: weekdayOf(date),
        date: dayMonth(date),
        team: team.name,
        type: rotation.steps[0],
        atWork: icu(staffing.atWork, { atWork: 2, minimum: 3 }),
      }),
    );
    await expect(todayPage.shortStaffedCard.getByRole('link', { name: admin.shortStaffed.open, exact: true })).toBeVisible();

    // THE ROW OPENS THAT DAY'S DETAIL on Kalendar, which states it in numbers.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/kalendar\\?.*dan=${date}.*danSmjena=${team.id}`));
    const detail = calendarPage.detailOf(team.name, date);
    await expect(detail).toBeVisible();
    await expect(detail.locator('[data-day-staffing="true"]')).toHaveText(
      fill(staffing.dayShort, { atWork: icu(staffing.atWork, { atWork: 2, minimum: 3 }) }),
    );
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

test('the minimum at 3 and nobody away: Premalo ljudi shows 0, no row, and the calm line', async ({
  fixture,
  page,
  todayPage,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { members } = await teamOfFourTwoOnLeave(fixture.slug, 0);
  await onlyRowsOf(page, members);
  const was = await setMinimumMembersInSql(fixture.slug, 3);
  try {
    await todayPage.goto();
    await expect(todayPage.shortStaffedCard).toBeVisible();
    await expect(todayPage.shortStaffedCount(0)).toBeVisible();
    await expect(todayPage.shortStaffedCount(0)).toHaveText('0 smjena ovaj tjedan');
    await expect(todayPage.shortStaffedCalm(3)).toBeVisible();
    await expect(todayPage.shortStaffedCalm(3)).toHaveText('Svaka smjena ovaj tjedan ima najmanje 3 čovjeka.');
    await expect(todayPage.shortStaffedRowLinks).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

test('with the setting empty, the same week has no Premalo ljudi card', async ({ fixture, page, todayPage }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { members } = await teamOfFourTwoOnLeave(fixture.slug);
  await onlyRowsOf(page, members);
  const was = await setMinimumMembersInSql(fixture.slug, null);
  try {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.coverageCard).toBeVisible();
    await expect(todayPage.shortStaffedCard).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});
