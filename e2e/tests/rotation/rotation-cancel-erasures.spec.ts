import { randomBytes } from 'node:crypto';

import type { RotationPage } from '../../pages/rotation.page.ts';
import {
  databaseNow,
  holdRotation,
  removeLeaveMemberInSql,
  removeRotationChangesOver,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedRotationChange,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, fullDate, weekdayOf } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.5g: cancelling a scheduled rotation change cannot quietly erase a
 * pending conflict.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation (`[Dan, Noć, Slobodno, Slobodno]`) from two days ago, so today is
 * a Slobodno and today + 4 is one too; a change scheduled from tomorrow at
 * the pattern's second step makes today + 4 a Dan. A fresh member on that
 * team is on leave that day: one conflict, which only the scheduled change
 * raises, so cancelling it would erase it. Everything written — the scheduled
 * change, the seed, the member with their leave, and the team — is removed
 * in the `afterEach` whatever happens.
 */

test.use({ storageState: ADMIN_STATE });

const builder = hr.rotation.builder;
const cancelErasures = builder.cancelScheduled.erasures;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let seededSince: string | null = null;
/** The run's slug, the member and the team this file's test wrote, deleted afterwards. */
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
  const since = seededSince;
  const own = written;

  // The scheduled change first, if the test left it standing.
  if (seeded !== null && since !== null) await attempt(() => removeRotationChangesOver(seeded, since));
  // The seed next: it deletes every roster override, which names the member.
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  // Then the member, with their leave and resolutions, and only then the team their versions name.
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  seed = null;
  seededSince = null;
  written = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

interface Setup {
  readonly rotation: SeededRotation;
  readonly team: { readonly id: string; readonly name: string };
  readonly person: SeededLeaveMember;
  /** The scheduled change's date, tomorrow. */
  readonly scheduled: string;
}

/** Days before today the seeded version starts: today is its third step, a Slobodno. */
const DAYS_BEFORE = 2;

/**
 * The hold, a team of the test's own with the seeded rotation from
 * {@link DAYS_BEFORE} days ago, a change scheduled from tomorrow at
 * `scheduledStep`, and a fresh member on that team on leave `day` days from
 * today.
 */
async function setUp(slug: string, day: number, scheduledStep: 0 | 1 | 2 | 3): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  seededSince = await databaseNow();
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix, DAYS_BEFORE);
  const rotation = seed;
  const scheduled = addDays(rotation.today, 1);
  await seedRotationChange(rotation, team.id, scheduled, scheduledStep);
  const person = await seedLeaveMember(slug, team.id, rotation.today, 20);
  own.members.push(person.id);
  const leave = addDays(rotation.today, day);
  await seedLeaveRecord(slug, person.id, leave, leave);

  return { rotation, team, person, scheduled };
}

/**
 * Opens the builder (already open when `inApp`), presses Spremi for the
 * scheduled refusal, and arms the cancel offered beside it: the cancel's
 * confirmation is then open.
 */
async function armCancel(rotationPage: RotationPage, scheduled: string, inApp = false): Promise<void> {
  if (!inApp) await rotationPage.goto();
  await expect(rotationPage.effectiveFromInput).toBeVisible();
  await rotationPage.saveButton.click();
  await expect(rotationPage.scheduledRefusal).toBeVisible();
  await rotationPage.cancelScheduledOffer(fullDate(scheduled)).click();
  await expect(rotationPage.dialog()).toContainText(fill(builder.cancelScheduled.prompt, { date: fullDate(scheduled) }));
}

test('a cancel that erases a conflict asks first, by keyboard, and the queue loses it without a reload', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, scheduled } = await setUp(fixture.slug, 4, 1);
  const date = addDays(rotation.today, 4);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
  // A marker on the window: if any step below reloads the page, it is gone.
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });
  await conflictsPage.navigationLink(hr.nav.postavkeRotacije, { exact: true }).click();
  await armCancel(rotationPage, scheduled, true);

  // THE KEYBOARD ALONE, from the cancel's own confirm.
  await rotationPage.cancelScheduledConfirm.focus();
  await page.keyboard.press('Enter');

  const parts = rotationPage.cancelErasures;
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(cancelErasures.lede.slice(cancelErasures.lede.lastIndexOf('}') + 1).trim());
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(
    fill(cancelErasures.rowTitle, { team: team.name, weekday: weekdayOf(date), date: dayMonth(date), type: rotation.steps[0] }),
  );
  await expect(rows.nth(0)).toContainText(fill(cancelErasures.rowFree, { member: person.name, team: team.name }));
  // NOTHING PRESELECTED, and the cancel waits.
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  const save = parts.saveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');

  await expect(parts.confirmIn(rows.nth(0)), 'focus did not start on the first row').toBeFocused();
  await page.keyboard.press('Space');
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'true');
  await expect(save).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Tab');
  await expect(parts.keepIn(rows.nth(0))).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(parts.backIn(dialog)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(rotationPage.cancelledConfirmation).toBeVisible();
  await expect(rotationPage.cancelledConfirmation).toContainText(plural(cancelErasures.removed, 1));
  await expect(rotationPage.dialog()).toHaveCount(0);
  await expect(rotationPage.cancelledConfirmation, 'focus did not follow the landed cancel').toBeFocused();
  await rotationPage.openHistory();
  await expect(rotationPage.historyRow(fullDate(scheduled))).toHaveCount(0);
  await rotationPage.closeHistory();

  // THE QUEUE −1, IN-APP: the landed cancel re-read the calendar, the leave and the resolutions.
  await rotationPage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(conflictsPage.heading(hr.nav.raspored)).toBeVisible();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload), 'the page reloaded').toBe(true);
});

test('a kept conflict holds the cancel, and going back keeps the scheduled change', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { person, scheduled } = await setUp(fixture.slug, 4, 1);

  await armCancel(rotationPage, scheduled);
  await rotationPage.cancelScheduledConfirm.click();
  const parts = rotationPage.cancelErasures;
  const dialog = parts.dialog(1);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);

  await parts.keepIn(rows.nth(0)).click();
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'true');
  await expect(parts.keptIn(dialog)).toBeVisible();
  const save = parts.saveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  // A press while held does nothing (`aria-disabled` keeps it focusable).
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();

  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(rotationPage.cancelScheduledOffer(fullDate(scheduled)), 'focus is not back on the offer').toBeFocused();
  await expect(rotationPage.cancelledConfirmation).toHaveCount(0);
  // The scheduled change stands, and so does the conflict.
  await rotationPage.openHistory();
  await expect(rotationPage.historyRow(fullDate(scheduled))).toContainText(builder.history.status.scheduled);
  await rotationPage.closeHistory();
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a cancel whose erasures cannot be checked is refused inside its confirmation, deletes nothing, and the retry checks again', async ({
  page,
  fixture,
  rotationPage,
}) => {
  test.slow();
  const { scheduled } = await setUp(fixture.slug, 4, 1);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  await armCancel(rotationPage, scheduled);
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await rotationPage.cancelScheduledConfirm.click();

  await expect(rotationPage.cancelErasuresUnavailable).toBeVisible();
  await expect(rotationPage.cancelErasuresRetry, 'the retry is not in reach').toBeFocused();
  await expect(rotationPage.cancelledConfirmation).toHaveCount(0);
  // The history is read once the confirmation has closed, below: while it is
  // open the page behind it, the history's header button included, is inert.

  // The read answers again: the retry checks afresh and asks about the one conflict.
  await page.unroute(resolutions);
  await rotationPage.cancelErasuresRetry.click();
  const dialog = rotationPage.cancelErasures.dialog(1);
  await expect(dialog).toBeVisible();
  await rotationPage.cancelErasures.backIn(dialog).click();
  await expect(rotationPage.cancelledConfirmation).toHaveCount(0);
  await rotationPage.openHistory();
  await expect(rotationPage.historyRow(fullDate(scheduled))).toContainText(builder.history.status.scheduled);
  await rotationPage.closeHistory();
});

test('a cancel that erases nothing cancels at once after its confirmation, as before', async ({
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  // Today + 2 is a Dan under both versions: the conflict stands either way.
  const { person, scheduled } = await setUp(fixture.slug, 2, 3);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  await armCancel(rotationPage, scheduled);
  await rotationPage.cancelScheduledConfirm.click();

  await expect(rotationPage.cancelledConfirmation).toBeVisible();
  // No count of removed conflicts: the notice is the one line, and nothing more.
  await expect(rotationPage.cancelledConfirmation).toHaveText(builder.cancelScheduled.done);
  await expect(rotationPage.dialog()).toHaveCount(0);
  await rotationPage.openHistory();
  await expect(rotationPage.historyRow(fullDate(scheduled))).toHaveCount(0);
  await rotationPage.closeHistory();

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a conflict added while the cancel\'s dialog is open shows the list again, undecided, and nothing is deleted', async ({
  fixture,
  rotationPage,
}) => {
  test.slow();
  const { rotation, person, scheduled } = await setUp(fixture.slug, 4, 1);

  await armCancel(rotationPage, scheduled);
  await rotationPage.cancelScheduledConfirm.click();
  const parts = rotationPage.cancelErasures;
  const first = parts.dialog(1);
  const firstRows = parts.rowsIn(first);
  await expect(firstRows).toHaveCount(1);

  // MEANWHILE: leave over today + 5, a Noć the cancel also frees.
  const later = addDays(rotation.today, 5);
  await seedLeaveRecord(fixture.slug, person.id, later, later);

  await parts.confirmIn(firstRows.nth(0)).click();
  await parts.saveIn(first).click();

  // Derived again before the delete: the list is shown again with the new row, all undecided.
  const again = parts.dialog(2);
  await expect(again).toBeVisible();
  await expect(again.getByRole('status')).toHaveText(cancelErasures.changed);
  const rows = parts.rowsIn(again);
  await expect(rows).toHaveCount(2);
  for (const index of [0, 1]) {
    await expect(parts.confirmIn(rows.nth(index))).toHaveAttribute('aria-pressed', 'false');
    await expect(parts.keepIn(rows.nth(index))).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(parts.saveIn(again)).toHaveAttribute('aria-disabled', 'true');
  await expect(parts.confirmIn(rows.nth(0))).toBeFocused();
  // Nothing was deleted.
  await expect(rotationPage.cancelledConfirmation).toHaveCount(0);
  await parts.backIn(again).click();
  await rotationPage.openHistory();
  await expect(rotationPage.historyRow(fullDate(scheduled))).toContainText(builder.history.status.scheduled);
  await rotationPage.closeHistory();
});

test('a read that fails at the dialog\'s save brings the cancel\'s confirmation back with its refusal, and deletes nothing', async ({
  page,
  fixture,
  rotationPage,
}) => {
  test.slow();
  const { scheduled } = await setUp(fixture.slug, 4, 1);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  await armCancel(rotationPage, scheduled);
  await rotationPage.cancelScheduledConfirm.click();
  const parts = rotationPage.cancelErasures;
  const dialog = parts.dialog(1);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await parts.confirmIn(rows.nth(0)).click();

  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(rotationPage.dialog()).toContainText(fill(builder.cancelScheduled.prompt, { date: fullDate(scheduled) }));
  await expect(rotationPage.cancelErasuresUnavailable).toBeVisible();
  await expect(rotationPage.cancelErasuresRetry, 'the retry is not in reach').toBeFocused();
  await expect(rotationPage.cancelledConfirmation).toHaveCount(0);
  await page.unroute(resolutions);
  // The confirmation is dismissed first: the history sits behind a header
  // button, which is inert while a dialog is open.
  await page.keyboard.press('Escape');
  await expect(rotationPage.dialog()).toHaveCount(0);
  await rotationPage.openHistory();
  await expect(rotationPage.historyRow(fullDate(scheduled))).toContainText(builder.history.status.scheduled);
  await rotationPage.closeHistory();
});

test('a change gone before the confirm is the cancel\'s own stale refusal, with no erasure dialog and no "cannot check"', async ({
  fixture,
  rotationPage,
}) => {
  test.slow();
  const { rotation, scheduled } = await setUp(fixture.slug, 4, 1);
  const since = seededSince;
  if (since === null) throw new Error('E2E: no seed time');

  await armCancel(rotationPage, scheduled);
  // MEANWHILE: the scheduled change is gone.
  await removeRotationChangesOver(rotation, since);
  await rotationPage.cancelScheduledConfirm.click();

  await expect(rotationPage.alertWith(builder.cancelScheduled.stale)).toBeVisible();
  await expect(rotationPage.cancelErasures.dialog(1)).toHaveCount(0);
  await expect(rotationPage.alertWith(cancelErasures.unavailable)).toHaveCount(0);
  await expect(rotationPage.cancelledConfirmation).toHaveCount(0);
  await expect(rotationPage.dialog()).toHaveCount(0);
});
