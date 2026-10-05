import { randomBytes } from 'node:crypto';

import type { Locator } from '@playwright/test';

import type { RotationPage } from '../../pages/rotation.page.ts';
import {
  holdRotation,
  removeLeaveMemberInSql,
  removeOverrideInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedRotationChange,
  seedShiftTypeOverride,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, fullDate, weekdayOf } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.5h: confirming or amending a pending override in the rotation
 * builder's review cannot quietly erase a pending conflict.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`), so today + 4 is a
 * Dan, and a fresh member of it is on leave then: one conflict. An override
 * on today + 4 is written, and then a rotation change from today + 1,
 * anchored on Noć so today + 4 stays a Dan, is saved after it: the override
 * is pending review, applied nowhere. Confirming a Slobodno one — or amending
 * one to Slobodno — would put it in force and take the conflict out of the
 * queue, so the erasure confirmation opens first. Discarding one never asks.
 * Everything written — the overrides, the seed with its change, the member
 * with their leave, and the team — is removed in the `afterEach` whatever
 * happens.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const overrides = hr.rotation.builder.overrides;
const erasures = overrides.erasures;
const REASON = 'Vježba (E2E).';
const AMENDED_REASON = 'Izmjena nakon promjene (E2E).';

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
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
  const own = written;

  // The seed first: it deletes the overrides and the change with the types and the pattern.
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  // Then the member, with their leave and resolutions, and only then the team their versions name.
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

/** Every count of the confirmation's title: its words before the ICU count. */
const anyErasureTitle = new RegExp(`^${escapeRegExp(/one \{([^#]*)#/.exec(erasures.title)?.[1] ?? 'E2E: no title')}`);

interface Setup {
  readonly rotation: SeededRotation;
  readonly team: { readonly id: string; readonly name: string };
  readonly person: SeededLeaveMember;
  /** Today + 4, a Dan: the member's leave day and the override's. */
  readonly date: string;
}

/**
 * The hold, a team of the test's own with the seeded rotation, a fresh member
 * of it on leave over today + 4, and an override there of the seeded step
 * `step`'s type, left pending review by a change saved after it.
 */
async function setUp(slug: string, step: 1 | 2): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(slug, team.id, rotation.today, 20);
  own.members.push(person.id);
  const date = addDays(rotation.today, 4);
  await seedLeaveRecord(slug, person.id, date, date);
  await seedShiftTypeOverride(rotation, team.id, date, step, REASON);
  // Anchored on Noć from today + 1: + 2 and + 3 free, + 4 a Dan again.
  await seedRotationChange(rotation, team.id, addDays(rotation.today, 1), 1);

  return { rotation, team, person, date };
}

/** The review's row of `team` on `date`, once the builder shows it. */
async function rowOf(rotationPage: RotationPage, teamName: string, date: string): Promise<Locator> {
  const row = rotationPage.overrideReviewRow(teamName, fullDate(date));
  await expect(row).toHaveCount(1);

  return row;
}

/** The builder, and the review's row of `team` on `date`. */
async function openRow(rotationPage: RotationPage, teamName: string, date: string): Promise<Locator> {
  await rotationPage.goto();

  return rowOf(rotationPage, teamName, date);
}

/** `count` more members of the team, each on leave over `date`: as many more rows. */
async function moreOnLeave(slug: string, setup: Setup, count: number): Promise<SeededLeaveMember[]> {
  const added: SeededLeaveMember[] = [];
  for (let index = 0; index < count; index += 1) {
    const member = await seedLeaveMember(slug, setup.team.id, setup.rotation.today, 20);
    written?.members.push(member.id);
    await seedLeaveRecord(slug, member.id, setup.date, setup.date);
    added.push(member);
  }

  return added;
}

test('confirming a pending Slobodno override over a member\'s leave waits for the confirmation, by keyboard, and the queue loses the conflict', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug, 2);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
  // A marker on the window: if any step below reloads the page, it is gone.
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });
  await conflictsPage.navigationLink(hr.nav.postavkeRotacije, { exact: true }).click();

  const row = await rowOf(rotationPage, team.name, date);
  // THE KEYBOARD ALONE: the row's confirm focused, Enter presses it.
  const confirm = rotationPage.confirmOverrideIn(row);
  await confirm.focus();
  await page.keyboard.press('Enter');

  const parts = rotationPage.reviewErasures('confirm');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(
    fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(date), date: dayMonth(date), type: rotation.steps[0] }),
  );
  await expect(rows.nth(0)).toContainText(fill(erasures.rowFree, { member: person.name, team: team.name }));
  // NOTHING PRESELECTED, and the save waits.
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  const save = parts.saveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');

  // Focus starts on the first row's confirm.
  await expect(parts.confirmIn(rows.nth(0))).toBeFocused();
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

  await expect(dialog).toHaveCount(0);
  const done = rotationPage.statusWith(overrides.done.confirmed);
  await expect(done).toBeVisible();
  await expect(done).toContainText(plural(erasures.removed, 1));
  await expect(rotationPage.overrideReviewRow(team.name, fullDate(date))).toHaveCount(0);

  // THE QUEUE −1, IN-APP: the landed confirm re-read the calendar, the leave and the resolutions.
  await rotationPage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(conflictsPage.heading(hr.nav.raspored)).toBeVisible();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload), 'the page reloaded').toBe(true);
});

test('amending a pending override to Slobodno waits for the confirmation; going back restores what was entered', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug, 1);

  const row = await openRow(rotationPage, team.name, date);
  await rotationPage.amendOverrideIn(row).click();
  const amend = rotationPage.amendDialogOf(team.name, fullDate(date));
  await expect(amend).toBeVisible();
  await rotationPage.amendOverride(amend, rotation.steps[2], AMENDED_REASON);

  // The amend's own dialog closes, and the erasure confirmation follows.
  const parts = rotationPage.reviewErasures('amend');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(amend).toHaveCount(0);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(fill(erasures.rowFree, { member: person.name, team: team.name }));

  // "Natrag na uređivanje" reopens the amend with what was entered, focus on the type.
  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(amend).toBeVisible();
  const type = rotationPage.amendTypeIn(amend);
  await expect(type).toBeFocused();
  await expect(type.locator('option:checked')).toHaveText(rotation.steps[2]);
  await expect(rotationPage.amendReasonIn(amend)).toHaveValue(AMENDED_REASON);

  // Saved again as it stands, confirmed, and amended.
  await amend.getByRole('button', { name: overrides.amendDialog.save, exact: true }).click();
  await expect(dialog).toBeVisible();
  await parts.confirmIn(rows.nth(0)).click();
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  const done = rotationPage.statusWith(overrides.done.amended);
  await expect(done).toBeVisible();
  await expect(done).toContainText(plural(erasures.removed, 1));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rotationPage.overrideReviewRow(team.name, fullDate(date))).toHaveCount(0);

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('confirming a pending working override erases nothing and confirms in one click', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { team, person, date } = await setUp(fixture.slug, 1);

  const row = await openRow(rotationPage, team.name, date);
  await rotationPage.confirmOverrideIn(row).click();

  const done = rotationPage.statusWith(overrides.done.confirmed);
  await expect(done).toBeVisible();
  await expect(done).not.toContainText(plural(erasures.removed, 1));
  // No erasure confirmation of ANY count was shown.
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  await expect(rotationPage.overrideReviewRow(team.name, fullDate(date))).toHaveCount(0);

  // The member still works that day, on leave: the conflict stands.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a kept conflict holds the confirm, many rows scroll inside the dialog, and going back returns focus to the row\'s confirm and writes nothing', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const setup = await setUp(fixture.slug, 2);
  const { team, person, date } = setup;
  // FIVE ON LEAVE THAT DAY: five rows, more than the dialog shows at once on a phone.
  await moreOnLeave(fixture.slug, setup, 4);

  const row = await openRow(rotationPage, team.name, date);
  const confirm = rotationPage.confirmOverrideIn(row);
  await confirm.click();
  const parts = rotationPage.reviewErasures('confirm');
  const dialog = parts.dialog(5);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(5);

  await parts.keepIn(rows.nth(0)).click();
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'true');
  await expect(parts.keptIn(dialog)).toBeVisible();
  const save = parts.saveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  // A press while held does nothing (`aria-disabled` keeps it focusable).
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();

  // At 390 px the rows wrap, scroll inside the dialog, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  const list = dialog.getByRole('list');
  const scrolls = await list.evaluate((element) => ({
    inside: element.scrollHeight > element.clientHeight,
    overflow: getComputedStyle(element).overflowY,
  }));
  expect(scrolls, 'the rows do not scroll inside the dialog').toEqual({ inside: true, overflow: 'auto' });
  await expect(parts.backIn(dialog)).toBeInViewport();
  await expect(parts.saveIn(dialog)).toBeInViewport();

  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(confirm, 'focus is not back on the row\'s confirm').toBeFocused();
  await expect(rotationPage.statusWith(overrides.done.confirmed)).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Nothing was written: the conflict is still on the queue.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a confirm or an amend whose erasures cannot be checked is refused where it was asked, writes nothing, and the retry checks again', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug, 2);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  const row = await openRow(rotationPage, team.name, date);
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));

  // THE CONFIRM: refused in the review itself, with the retry focused.
  await rotationPage.confirmOverrideIn(row).click();
  await expect(rotationPage.reviewUnchecked).toBeVisible();
  await expect(rotationPage.reviewUncheckedRetry, 'the retry is not in reach').toBeFocused();
  await expect(rotationPage.reviewErasures('confirm').dialog(1)).toHaveCount(0);
  await expect(rotationPage.statusWith(overrides.done.confirmed)).toHaveCount(0);
  await expect(row).toHaveCount(1);

  // The read answers again: the confirm's retry checks afresh and asks about the conflict.
  await page.unroute(resolutions);
  await rotationPage.reviewUncheckedRetry.click();
  const confirmParts = rotationPage.reviewErasures('confirm');
  const confirmDialog = confirmParts.dialog(1);
  await expect(confirmDialog).toBeVisible();
  await expect(rotationPage.reviewUnchecked).toHaveCount(0);
  await confirmParts.backIn(confirmDialog).click();
  await expect(confirmDialog).toHaveCount(0);

  // THE AMEND: refused inside its own dialog, with what was entered kept.
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await rotationPage.amendOverrideIn(row).click();
  const amend = rotationPage.amendDialogOf(team.name, fullDate(date));
  await rotationPage.amendOverride(amend, rotation.steps[2], AMENDED_REASON);
  const inDialog = amend.getByRole('alert').filter({ hasText: erasures.unavailable });
  await expect(inDialog).toBeVisible();
  const retry = inDialog.getByRole('button', { name: erasures.retry, exact: true });
  await expect(retry).toBeFocused();
  await expect(rotationPage.amendReasonIn(amend)).toHaveValue(AMENDED_REASON);
  await expect(rotationPage.statusWith(overrides.done.amended)).toHaveCount(0);

  // The read answers again: the retry checks afresh and asks about the conflict.
  await page.unroute(resolutions);
  await retry.click();
  const parts = rotationPage.reviewErasures('amend');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await parts.backIn(dialog).click();
  await expect(amend).toBeVisible();
  await expect(inDialog).toHaveCount(0);
  await amend.getByRole('button', { name: overrides.amendDialog.cancel, exact: true }).click();
  await expect(row).toHaveCount(1);

  // Nothing was written: the conflict is still on the queue.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a list that changed by the dialog\'s save is shown again, undecided, and nothing is written', async ({
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const setup = await setUp(fixture.slug, 2);
  const { team, person, date } = setup;

  const row = await openRow(rotationPage, team.name, date);
  await rotationPage.confirmOverrideIn(row).click();
  const parts = rotationPage.reviewErasures('confirm');
  const first = parts.dialog(1);
  const firstRows = parts.rowsIn(first);
  await expect(firstRows).toHaveCount(1);

  // MEANWHILE another member of the team goes on leave that day: the confirm would erase two.
  const [second] = await moreOnLeave(fixture.slug, setup, 1);

  await parts.confirmIn(firstRows.nth(0)).click();
  await parts.saveIn(first).click();

  // Derived again before the write: shown again, undecided, with the changed line.
  const again = parts.dialog(2);
  await expect(again.getByRole('status')).toHaveText(erasures.changed);
  const rows = parts.rowsIn(again);
  await expect(rows).toHaveCount(2);
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.confirmIn(rows.nth(1))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.saveIn(again)).toHaveAttribute('aria-disabled', 'true');
  await expect(parts.confirmIn(rows.nth(0))).toBeFocused();

  // Nothing was written.
  await parts.backIn(again).click();
  await expect(rotationPage.statusWith(overrides.done.confirmed)).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
  await expect(conflictsPage.rowsOf(second?.name ?? 'E2E: no second member')).toHaveCount(1);
});

test('an amend whose erasures cannot be checked again at the dialog\'s save reopens the amend with what was entered, and its retry', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug, 1);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  const row = await openRow(rotationPage, team.name, date);
  await rotationPage.amendOverrideIn(row).click();
  const amend = rotationPage.amendDialogOf(team.name, fullDate(date));
  await rotationPage.amendOverride(amend, rotation.steps[2], AMENDED_REASON);
  const parts = rotationPage.reviewErasures('amend');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await parts.confirmIn(parts.rowsIn(dialog).nth(0)).click();

  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await parts.saveIn(dialog).click();

  // The erasure dialog closes and the amend is back, as entered, with the refusal and its retry.
  await expect(dialog).toHaveCount(0);
  await expect(amend).toBeVisible();
  await expect(rotationPage.amendTypeIn(amend).locator('option:checked')).toHaveText(rotation.steps[2]);
  await expect(rotationPage.amendReasonIn(amend)).toHaveValue(AMENDED_REASON);
  const inDialog = amend.getByRole('alert').filter({ hasText: erasures.unavailable });
  await expect(inDialog).toBeVisible();
  await expect(inDialog.getByRole('button', { name: erasures.retry, exact: true })).toBeFocused();
  await expect(rotationPage.statusWith(overrides.done.amended)).toHaveCount(0);

  await page.unroute(resolutions);
  await amend.getByRole('button', { name: overrides.amendDialog.cancel, exact: true }).click();
  await expect(row).toHaveCount(1);
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('an amend of an override removed meanwhile closes, says so in the review, and the row is gone', async ({
  page,
  fixture,
  rotationPage,
}) => {
  test.slow();
  const { rotation, team, date } = await setUp(fixture.slug, 1);

  const row = await openRow(rotationPage, team.name, date);
  await rotationPage.amendOverrideIn(row).click();
  const amend = rotationPage.amendDialogOf(team.name, fullDate(date));
  await expect(amend).toBeVisible();
  // ANOTHER ADMIN removes it while the amend is open.
  await removeOverrideInSql(rotation, team.id, date);
  await rotationPage.amendOverride(amend, rotation.steps[2], AMENDED_REASON);

  await expect(amend).toHaveCount(0);
  await expect(rotationPage.alertWith(overrides.refused.gone)).toBeVisible();
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  await expect(rotationPage.overrideReviewRow(team.name, fullDate(date))).toHaveCount(0);
});

test('discarding a pending override asks nothing about conflicts, as before', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug, 2);

  // EVERY READ of the resolutions from here on: a discard checks nothing.
  const reads: string[] = [];
  page.on('request', (request) => {
    if (/\/rest\/v1\/conflict_resolutions(?:\?|$)/.test(request.url())) reads.push(request.url());
  });
  const row = await openRow(rotationPage, team.name, date);
  reads.length = 0;
  await rotationPage.discardOverrideIn(row).click();
  const confirm = rotationPage.discardConfirmOf(team.name, fullDate(date), rotation.steps[0]);
  await rotationPage.confirmDiscardIn(confirm).click();

  await expect(rotationPage.statusWith(overrides.done.discarded)).toBeVisible();
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  await expect(rotationPage.overrideReviewRow(team.name, fullDate(date))).toHaveCount(0);
  expect(reads, 'the discard read the resolutions for a check').toEqual([]);

  // A pending override was applied nowhere: the conflict stands.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});
