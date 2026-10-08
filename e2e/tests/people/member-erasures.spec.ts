import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedMemberStatusVersions,
  seedShiftTypeOverride,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, weekdayOf } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.5e: a member team or status change cannot quietly erase a pending
 * conflict.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
 * on it from today, on leave over working days ahead: one conflict per
 * working day. Moving them to the fixture's team (which has no rotation) or
 * deactivating them would take those conflicts out of the queue, so the
 * card's own confirmation is followed by the shared erasure dialog. The
 * member's membership is dated today, so a move's earliest day — the date
 * field's default — is tomorrow. Everything written — the seed, the member
 * with their leave, and the team — is removed in the `afterEach` whatever
 * happens.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const erasures = hr.ljudi.erasures;
const membership = hr.smjene.membership;

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

  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  // The member, with their leave and resolutions, and only then the team their versions name.
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

/** Every count of the dialog's title: its words before the ICU count. */
const anyErasureTitle = new RegExp(`^${escapeRegExp(/one \{([^#]*)#/.exec(erasures.title)?.[1] ?? 'E2E: no title')}`);

interface Setup {
  readonly rotation: SeededRotation;
  readonly team: { readonly id: string; readonly name: string };
  readonly person: SeededLeaveMember;
}

/**
 * The hold, a team of the test's own with the seeded rotation, and a fresh
 * member on it from today, on leave over `leave` (`[from, to]` day offsets
 * from today, both included), or on no leave at all.
 */
async function setUp(slug: string, leave: readonly [number, number] | null): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(slug, team.id, rotation.today, 40);
  own.members.push(person.id);
  if (leave !== null) {
    await seedLeaveRecord(slug, person.id, addDays(rotation.today, leave[0]), addDays(rotation.today, leave[1]));
  }

  return { rotation, team, person };
}

test('moving a member on leave to another team waits for the erasure dialog, by keyboard, and the queue loses the conflict', async ({
  page,
  fixture,
  peoplePage,
  conflictsPage,
}) => {
  test.slow();
  // Leave on today + 4, a Dan.
  const { rotation, team, person } = await setUp(fixture.slug, [4, 4]);
  const date = addDays(rotation.today, 4);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  await peoplePage.gotoMember(person.id);
  // THE KEYBOARD ALONE, from the card's Promijeni through the team dialog's
  // one Spremi (story 7.11): no second confirm.
  await peoplePage.moveButton(person.name).focus();
  await page.keyboard.press('Enter');
  await expect(peoplePage.teamDialog).toBeVisible();
  await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
  await peoplePage.teamSaveButton.focus();
  await page.keyboard.press('Enter');

  const parts = peoplePage.memberErasures(fill(membership.moveConfirm, { name: person.name }));
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  // The erasure dialog opens OVER the team dialog, which keeps what was
  // entered; only one erasure dialog is open (its save carries the change's
  // own words).
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(1);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(
    fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(date), date: dayMonth(date), type: rotation.steps[0] }),
  );
  await expect(rows.nth(0)).toContainText(fill(erasures.rowWithout, { member: person.name, team: team.name }));
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  const save = parts.saveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');

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
  // A LANDED MOVE closes the team dialog too, and says so on the card.
  await expect(peoplePage.teamDialog).toHaveCount(0);
  const saved = peoplePage.statusWith(membership.saved);
  await expect(saved).toBeVisible();
  await expect(saved).toContainText(plural(erasures.removed, 1));

  // THE QUEUE −1: the cause is gone, so the conflict is.
  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('deactivating a member on leave lists every conflict it erases, by keyboard, and writes once all are confirmed', async ({
  page,
  fixture,
  peoplePage,
  conflictsPage,
}) => {
  test.slow();
  // Leave over today + 4 and + 5: a Dan and a Noć, two conflicts.
  const { rotation, team, person } = await setUp(fixture.slug, [4, 5]);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(2);

  await peoplePage.gotoMember(person.id);
  await peoplePage.deactivateButton(person.name).focus();
  await page.keyboard.press('Enter');
  const confirm = peoplePage.deactivateSaveButton;
  await expect(confirm).toBeVisible();
  await confirm.focus();
  await page.keyboard.press('Enter');

  const parts = peoplePage.memberErasures(fill(hr.ljudi.status.deactivateConfirm, { name: person.name }));
  const dialog = parts.dialog(2);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(2);
  // By date: the Dan, then the Noć.
  await expect(rows.nth(0)).toContainText(rotation.steps[0]);
  await expect(rows.nth(1)).toContainText(rotation.steps[1]);
  await expect(rows.nth(1)).toContainText(fill(erasures.rowWithout, { member: person.name, team: team.name }));
  const save = parts.saveIn(dialog);

  // Focus starts on the first row's "Potvrdi brisanje"; one confirmed is not enough.
  await expect(parts.confirmIn(rows.nth(0))).toBeFocused();
  await page.keyboard.press('Space');
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(parts.confirmIn(rows.nth(1))).toBeFocused();
  await page.keyboard.press('Space');
  await expect(save).toHaveAttribute('aria-disabled', 'false');
  await save.focus();
  await page.keyboard.press('Enter');

  await expect(dialog).toHaveCount(0);
  await expect(peoplePage.statusDialog).toHaveCount(0);
  const saved = peoplePage.statusWith(hr.ljudi.status.saved);
  await expect(saved).toBeVisible();
  // The `few` form: "Uklonjena 2 konflikta."
  await expect(saved).toContainText(plural(erasures.removed, 2));

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('a status change that erases nothing writes as it always did', async ({ page, fixture, peoplePage }) => {
  test.slow();
  const { person } = await setUp(fixture.slug, null);

  await peoplePage.gotoMember(person.id);
  await peoplePage.deactivate(person.name);

  await expect(peoplePage.statusWith(hr.ljudi.status.saved)).toBeVisible();
  // No erasure dialog of ANY count was shown.
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
});

test('a kept conflict holds the move, and going back keeps the team dialog as entered and writes nothing', async ({
  page,
  fixture,
  peoplePage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, person } = await setUp(fixture.slug, [4, 4]);
  const day = addDays(rotation.today, 2);

  await peoplePage.gotoMember(person.id);
  await peoplePage.moveButton(person.name).click();
  await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
  await peoplePage.dateInput.fill(day);
  await peoplePage.teamSaveButton.click();

  const parts = peoplePage.memberErasures(fill(membership.moveConfirm, { name: person.name }));
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
  await expect(peoplePage.teamSaveButton, 'focus is not back on the team dialog\'s Spremi').toBeFocused();
  // The team dialog is as it was entered, and nothing was saved.
  await expect(peoplePage.selectedTeam).toHaveText(fixture.team.name);
  await expect(peoplePage.dateInput).toHaveValue(day);
  await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(peoplePage.teamDialog).toHaveCount(0);
  await expect(peoplePage.moveButton(person.name), 'focus is not back on the card\'s Promijeni').toBeFocused();

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a move whose erasures cannot be checked is refused inside its dialog, writes nothing, and the retry checks again', async ({
  page,
  fixture,
  peoplePage,
}) => {
  test.slow();
  const { person } = await setUp(fixture.slug, [4, 4]);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  await peoplePage.gotoMember(person.id);
  await peoplePage.moveButton(person.name).click();
  await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await peoplePage.teamSaveButton.click();

  await expect(peoplePage.teamDialog.getByRole('alert').filter({ hasText: hr.ljudi.erasures.unavailable })).toBeVisible();
  await expect(peoplePage.memberUncheckedRetry, 'the retry is not in reach').toBeFocused();
  // Nothing written, and no erasure dialog.
  await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);

  // The read answers again: the retry checks afresh and asks about the conflict.
  await page.unroute(resolutions);
  await peoplePage.memberUncheckedRetry.click();
  const parts = peoplePage.memberErasures(fill(membership.moveConfirm, { name: person.name }));
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(1);
  await expect(peoplePage.memberUnchecked).toHaveCount(0);
  await parts.backIn(dialog).click();
  await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);
});

test('a deactivation erasing many conflicts scrolls its rows inside the dialog at 390 px', async ({ page, fixture, peoplePage }) => {
  test.slow();
  // Today + 4 to + 25: twelve working days — every Dan and Noć of six cycles.
  const { person } = await setUp(fixture.slug, [4, 25]);

  await page.setViewportSize({ width: 390, height: 844 });
  await peoplePage.gotoMember(person.id);
  await peoplePage.deactivate(person.name);

  const parts = peoplePage.memberErasures(fill(hr.ljudi.status.deactivateConfirm, { name: person.name }));
  const dialog = parts.dialog(12);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(12);

  // THE LIST SCROLLS, not the page nor the dialog sideways: its way back and
  // its save stay in view.
  const list = dialog.getByRole('list');
  const scrolls = await list.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(scrolls, 'the rows do not scroll inside the dialog').toBe(true);
  await expect(parts.backIn(dialog)).toBeInViewport();
  await expect(parts.saveIn(dialog)).toBeInViewport();
  await expectNoHorizontalScroll(page);
  const sideways = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(sideways, 'the dialog scrolls sideways').toBeLessThanOrEqual(0);

  // The last row is reachable, and focus brings it into view.
  await parts.confirmIn(rows.nth(11)).focus();
  await expect(parts.confirmIn(rows.nth(11))).toBeInViewport();

  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
});

test('withdrawing a scheduled reactivation of a member on leave waits for the erasure dialog', async ({
  fixture,
  peoplePage,
  conflictsPage,
}) => {
  test.slow();
  // Inactive from today, active again from today + 3; on leave over today + 4, a Dan.
  const { rotation, team, person } = await setUp(fixture.slug, [4, 4]);
  await seedMemberStatusVersions(fixture.slug, person.id, [
    { active: false, effectiveFrom: rotation.today },
    { active: true, effectiveFrom: addDays(rotation.today, 3) },
  ]);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  await peoplePage.gotoMember(person.id);
  await peoplePage.statusWithdrawButton(person.name).click();
  await peoplePage.statusWithdrawConfirmButton(person.name).click();

  const parts = peoplePage.memberErasures(fill(hr.ljudi.status.withdrawConfirm, { name: person.name }));
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(fill(erasures.rowWithout, { member: person.name, team: team.name }));

  await parts.confirmIn(rows.nth(0)).click();
  await parts.saveIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(peoplePage.statusWith(hr.ljudi.status.saved)).toContainText(plural(erasures.removed, 1));

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('a list that changed by the dialog\'s save is shown again, undecided, and nothing is written', async ({
  fixture,
  peoplePage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person } = await setUp(fixture.slug, [4, 4]);

  await peoplePage.gotoMember(person.id);
  await peoplePage.moveButton(person.name).click();
  await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
  await peoplePage.teamSaveButton.click();
  const parts = peoplePage.memberErasures(fill(membership.moveConfirm, { name: person.name }));
  const first = parts.dialog(1);
  await expect(parts.rowsIn(first)).toHaveCount(1);

  // MEANWHILE another admin makes today + 4 a Noć: the conflict stands, but the row decided read Dan.
  await seedShiftTypeOverride(rotation, team.id, addDays(rotation.today, 4), 1, 'Zamjena smjene (E2E).');

  await parts.confirmIn(parts.rowsIn(first).nth(0)).click();
  await parts.saveIn(first).click();

  const again = parts.dialog(1);
  await expect(again.getByRole('status')).toHaveText(erasures.changed);
  const rows = parts.rowsIn(again);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(rotation.steps[1]);
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.saveIn(again)).toHaveAttribute('aria-disabled', 'true');
  await expect(parts.confirmIn(rows.nth(0))).toBeFocused();

  // Nothing was written.
  await parts.backIn(again).click();
  await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a dialog save whose re-check cannot be derived returns to the team dialog with the retry', async ({
  page,
  fixture,
  peoplePage,
}) => {
  test.slow();
  const { person } = await setUp(fixture.slug, [4, 4]);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  await peoplePage.gotoMember(person.id);
  await peoplePage.moveButton(person.name).click();
  await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
  await peoplePage.teamSaveButton.click();
  const parts = peoplePage.memberErasures(fill(membership.moveConfirm, { name: person.name }));
  const dialog = parts.dialog(1);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await parts.confirmIn(rows.nth(0)).click();

  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await parts.saveIn(dialog).click();

  // The erasure dialog closes; the team dialog beneath refuses with the retry.
  await expect(dialog).toHaveCount(0);
  await expect(peoplePage.teamDialog.getByRole('alert').filter({ hasText: hr.ljudi.erasures.unavailable })).toBeVisible();
  await expect(peoplePage.memberUncheckedRetry, 'the retry is not in reach').toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);

  await page.unroute(resolutions);
  await peoplePage.memberUncheckedRetry.click();
  await expect(parts.dialog(1)).toBeVisible();
  await parts.backIn(parts.dialog(1)).click();
  await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);
});

test('a deactivation whose erasures cannot be checked is refused inside the status dialog, with focus on the retry', async ({
  page,
  fixture,
  peoplePage,
}) => {
  test.slow();
  const { person } = await setUp(fixture.slug, [4, 4]);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  await peoplePage.gotoMember(person.id);
  await peoplePage.deactivateButton(person.name).click();
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await peoplePage.deactivateSaveButton.click();

  await expect(peoplePage.memberUnchecked).toBeVisible();
  await expect(peoplePage.memberUncheckedRetry, 'the retry is not in reach').toBeFocused();
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  await expect(peoplePage.statusWith(hr.ljudi.status.saved)).toHaveCount(0);

  await page.unroute(resolutions);
  await peoplePage.memberUncheckedRetry.click();
  const parts = peoplePage.memberErasures(fill(hr.ljudi.status.deactivateConfirm, { name: person.name }));
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(peoplePage.memberUnchecked).toHaveCount(0);
  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(peoplePage.deactivateSaveButton, 'focus is not back on the status dialog\'s action').toBeFocused();
  await expect(peoplePage.statusWith(hr.ljudi.status.saved)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(peoplePage.statusDialog).toHaveCount(0);
  await expect(peoplePage.deactivateButton(person.name), 'focus is not back on the card\'s Deaktiviraj').toBeFocused();
});
