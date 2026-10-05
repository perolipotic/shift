import { randomBytes } from 'node:crypto';

import type { Locator } from '@playwright/test';

import type { CalendarPage } from '../../pages/calendar.page.ts';
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
import { addDays, dayMonth, weekdayOf } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.5f: a calendar shift-type override cannot quietly erase a pending
 * conflict.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
 * on leave — over today + 4, a Dan, unless a case says otherwise: one
 * conflict. Setting a non-working type on that day in the day detail — or
 * removing an override that made a free day working — would take it out of
 * the queue, so the erasure confirmation opens beside the day detail first.
 * Everything written — the overrides, the seed, the members with their leave,
 * and the team — is removed in the `afterEach` whatever happens.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const override = hr.kalendar.detail.override;
const erasures = override.erasures;
const REASON = 'Vježba (E2E).';

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
/** The run's slug, the members and the team this file's test wrote, deleted afterwards. */
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

  // The seed first: it deletes the overrides with the types they name.
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  // Then the members, with their leave and resolutions, and only then the team their versions name.
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

/** `/kalendar`'s search for the grid on the month `date` falls in. */
function gridMonthOf(date: string): string {
  return `?prikaz=sve&mjesec=${date.slice(0, 7)}`;
}

/** Every count of the confirmation's title: its words before the ICU count. */
const anyErasureTitle = new RegExp(`^${escapeRegExp(/one \{([^#]*)#/.exec(erasures.title)?.[1] ?? 'E2E: no title')}`);

interface Setup {
  readonly rotation: SeededRotation;
  readonly team: { readonly id: string; readonly name: string };
  readonly person: SeededLeaveMember;
  /** The date the member is on leave: today + `offset`. */
  readonly date: string;
}

/**
 * The hold, a team of the test's own with the seeded rotation, and a fresh
 * member of it on leave over today + `offset` (4, a Dan, by default).
 */
async function setUp(slug: string, offset = 4): Promise<Setup> {
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
  const date = addDays(rotation.today, offset);
  await seedLeaveRecord(slug, person.id, date, date);

  return { rotation, team, person, date };
}

/** Opens the day detail of `team` on `date`. */
async function openDay(calendarPage: CalendarPage, teamName: string, date: string): Promise<Locator> {
  await calendarPage.goto(gridMonthOf(date));
  await (await calendarPage.cellOf(teamName, date)).click();
  const detail = calendarPage.detailOf(teamName, date);
  await expect(detail).toBeVisible();

  return detail;
}

test('setting a non-working type on a member\'s leave day waits for the confirmation, by keyboard, and the queue loses the conflict', async ({
  page,
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  const detail = await openDay(calendarPage, team.name, date);
  // THE KEYBOARD ALONE: the type chosen by typing its name into the focused
  // select (its typeahead), Tab to the reason, the reason typed, Enter saves.
  const type = calendarPage.overrideTypeIn(detail);
  await type.focus();
  await page.keyboard.type(rotation.steps[2]);
  const chosen = await calendarPage.optionIn(type, rotation.steps[2]).first().getAttribute('value');
  await expect(type).toHaveValue(chosen ?? 'E2E: no option');
  await page.keyboard.press('Tab');
  await expect(calendarPage.overrideReasonIn(detail)).toBeFocused();
  await page.keyboard.type(REASON);
  await page.keyboard.press('Enter');

  const parts = calendarPage.overrideErasures('save');
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
  await expect(calendarPage.statusIn(detail)).toContainText(override.saved);
  await expect(calendarPage.statusIn(detail)).toContainText(plural(erasures.removed, 1));
  await expect(calendarPage.overrideRemoveIn(detail)).toBeVisible();

  // THE QUEUE −1: the cause is gone, so the conflict is.
  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('two members on leave that day are two rows, by member name, and going back keeps both conflicts', async ({
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);
  const second = await seedLeaveMember(fixture.slug, team.id, rotation.today, 20);
  written?.members.push(second.id);
  await seedLeaveRecord(fixture.slug, second.id, date, date);

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.setOverrideIn(detail, rotation.steps[2], REASON);

  const parts = calendarPage.overrideErasures('save');
  const dialog = parts.dialog(2);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(2);
  // One date and one team: ordered by member name, under the Croatian collation.
  const names = [person.name, second.name].sort((first, other) => first.localeCompare(other, 'hr'));
  for (const [index, name] of names.entries()) {
    await expect(rows.nth(index)).toContainText(
      fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(date), date: dayMonth(date), type: rotation.steps[0] }),
    );
    await expect(rows.nth(index)).toContainText(fill(erasures.rowFree, { member: name, team: team.name }));
  }
  await parts.backIn(dialog).click();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
  await expect(conflictsPage.rowsOf(second.name)).toHaveCount(1);
});

test('removing an override that made a free day working goes through its confirmation, then the erasure confirmation', async ({
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  // Today + 2 is free by the rotation; the override makes it a Dan, and the member is on leave then.
  const { rotation, team, person, date } = await setUp(fixture.slug, 2);
  await seedShiftTypeOverride(rotation, team.id, date, 0, REASON);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  const detail = await openDay(calendarPage, team.name, date);
  const remove = calendarPage.overrideRemoveIn(detail);
  await remove.click();
  const confirm = calendarPage.removeConfirmOf(team.name, date, rotation.steps[2]);
  await calendarPage.confirmRemoveIn(confirm).click();

  // The removal's own confirmation closes, and the erasure confirmation follows.
  const parts = calendarPage.overrideErasures('removal');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(confirm).toHaveCount(0);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(fill(erasures.rowFree, { member: person.name, team: team.name }));

  // A kept row says the removal's own hint.
  await parts.keepIn(rows.nth(0)).click();
  await expect(parts.keptIn(dialog)).toBeVisible();

  // "Natrag na uređivanje" returns to the day detail, focus on the removal, nothing removed.
  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();

  await remove.click();
  await calendarPage.confirmRemoveIn(confirm).click();
  await expect(dialog).toBeVisible();
  await parts.confirmIn(rows.nth(0)).click();
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(calendarPage.statusIn(detail)).toContainText(fill(override.removed, { type: rotation.steps[2] }));
  await expect(calendarPage.statusIn(detail)).toContainText(plural(erasures.removed, 1));
  await expect(remove).toHaveCount(0);

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('an override from one working type to another erases nothing and saves in one click', async ({
  page,
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.setOverrideIn(detail, rotation.steps[1], REASON);

  await expect(calendarPage.statusIn(detail)).toHaveText(override.saved);
  // No erasure confirmation of ANY count was shown.
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);

  // The member still works that day, on leave: the conflict stands.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a kept conflict holds the override, and going back keeps the form as entered and writes nothing', async ({
  page,
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.setOverrideIn(detail, rotation.steps[2], REASON);
  const parts = calendarPage.overrideErasures('save');
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

  // At 390 px the rows wrap, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);

  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(calendarPage.overrideSaveIn(detail), 'focus is not back on the form\'s save').toBeFocused();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  // The form is as it was entered.
  const type = calendarPage.overrideTypeIn(detail);
  const chosen = await calendarPage.optionIn(type, rotation.steps[2]).getAttribute('value');
  await expect(type).toHaveValue(chosen ?? 'E2E: no option');
  await expect(calendarPage.overrideReasonIn(detail)).toHaveValue(REASON);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Nothing was written: the conflict is still on the queue.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('an override whose erasures cannot be checked is refused, writes nothing, leaves the calendar intact, and the retry checks again', async ({
  page,
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  const detail = await openDay(calendarPage, team.name, date);
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await calendarPage.setOverrideIn(detail, rotation.steps[2], REASON);

  await expect(calendarPage.overrideUnchecked).toBeVisible();
  await expect(calendarPage.overrideUncheckedRetry, 'the retry is not in reach').toBeFocused();
  // THE CALENDAR IS LEFT ALONE: no unavailable alert of its own, and the day stays open.
  await expect(calendarPage.unavailableAlert).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(calendarPage.overrideErasures('save').dialog(1)).toHaveCount(0);
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);

  // The read answers again: the retry checks afresh and asks about the conflict.
  await page.unroute(resolutions);
  await calendarPage.overrideUncheckedRetry.click();
  const parts = calendarPage.overrideErasures('save');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(calendarPage.overrideUnchecked).toHaveCount(0);
  await parts.backIn(dialog).click();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);

  // Nothing was written: the conflict is still on the queue.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a list that changed by the time the override is confirmed is shown again, undecided, and nothing is written', async ({
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.setOverrideIn(detail, rotation.steps[2], REASON);
  const parts = calendarPage.overrideErasures('save');
  const first = parts.dialog(1);
  const firstRows = parts.rowsIn(first);
  await expect(firstRows).toHaveCount(1);

  // MEANWHILE another member of the team goes on leave that day: the override would erase two.
  const second = await seedLeaveMember(fixture.slug, team.id, rotation.today, 20);
  written?.members.push(second.id);
  await seedLeaveRecord(fixture.slug, second.id, date, date);

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
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('an override another admin wrote meanwhile is refused as taken, with no erasure confirmation', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const { rotation, team, date } = await setUp(fixture.slug);

  const detail = await openDay(calendarPage, team.name, date);
  // EVERY INSERT the page sends from here on: a refusal judged on the fresh read sends none.
  const inserts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/rest\/v1\/shift_type_overrides(?:\?|$)/.test(request.url())) {
      inserts.push(request.url());
    }
  });
  await seedShiftTypeOverride(rotation, team.id, date, 1, 'Zamjena smjene (E2E).');
  await calendarPage.setOverrideIn(detail, rotation.steps[2], REASON);

  // The form's own `taken` refusal, said in the day detail once the form gives way.
  await expect(calendarPage.alertIn(detail).filter({ hasText: override.refused.taken })).toBeVisible();

  // The write's own `taken` path, without a request: the day is read again and
  // the form gives way to the override that landed first; nothing is saved.
  await expect(calendarPage.overrideRemoveIn(detail)).toBeVisible();
  await expect(detail).toContainText(fill(override.projected, { type: rotation.steps[0] }));
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  expect(inserts, 'an insert was sent for a write refused anyway').toEqual([]);
});

/**
 * An override that made today + 2 (free by the rotation) a Dan, and the
 * member on leave then, opened on its day: one conflict, and the removal
 * that would erase it armed in its confirmation.
 */
async function armRemoval(
  slug: string,
  calendarPage: CalendarPage,
): Promise<Setup & { readonly detail: Locator; readonly remove: Locator; readonly confirm: Locator }> {
  const setup = await setUp(slug, 2);
  await seedShiftTypeOverride(setup.rotation, setup.team.id, setup.date, 0, REASON);
  const detail = await openDay(calendarPage, setup.team.name, setup.date);
  const remove = calendarPage.overrideRemoveIn(detail);
  await remove.click();
  const confirm = calendarPage.removeConfirmOf(setup.team.name, setup.date, setup.rotation.steps[2]);
  await expect(confirm).toBeVisible();

  return { ...setup, detail, remove, confirm };
}

test('removing an override a rotation change left pending is checked against the fresh read, lists nothing, and removes at once', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  // Today + 2 is free; the override makes it a Dan, and then a rotation change
  // from today + 1 (anchored on a free step, so today + 2 stays free) is saved
  // after it: the override is pending, applied nowhere, and raises nothing.
  const { rotation, team, date } = await setUp(fixture.slug, 2);
  await seedShiftTypeOverride(rotation, team.id, date, 0, REASON);
  await seedRotationChange(rotation, team.id, addDays(rotation.today, 1), 2);

  const detail = await openDay(calendarPage, team.name, date);
  await expect(calendarPage.pendingOverrideIn(detail)).toBeVisible();
  await calendarPage.overrideRemoveIn(detail).click();
  const confirm = calendarPage.pendingRemoveConfirmOf(team.name, date);
  await calendarPage.confirmRemoveIn(confirm).click();

  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  await expect(calendarPage.statusIn(detail)).toHaveText(override.pending.removed);
  await expect(calendarPage.pendingOverrideIn(detail)).toHaveCount(0);
});

test('a removal whose erasures cannot be checked is refused inside its own confirmation, and the retry checks again', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const resolutions = '**/rest/v1/conflict_resolutions*';
  const { detail, remove, confirm } = await armRemoval(fixture.slug, calendarPage);

  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await calendarPage.confirmRemoveIn(confirm).click();

  const refusal = confirm.getByRole('alert').filter({ hasText: erasures.unavailable });
  await expect(refusal).toBeVisible();
  const retry = refusal.getByRole('button', { name: erasures.retry, exact: true });
  await expect(retry, 'the retry is not in reach').toBeFocused();
  await expect(calendarPage.unavailableAlert).toHaveCount(0);
  // Nothing was removed.
  await expect(remove).toBeVisible();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);

  await page.unroute(resolutions);
  await retry.click();
  const parts = calendarPage.overrideErasures('removal');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await parts.keepIn(parts.rowsIn(dialog).nth(0)).click();
  await expect(parts.keptIn(dialog)).toBeVisible();
  await parts.backIn(dialog).click();
  await expect(remove).toBeVisible();
});

test('a set whose erasures cannot be checked again at the dialog\'s save is refused in the form, with the retry, and writes nothing', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const { rotation, team, date } = await setUp(fixture.slug);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.setOverrideIn(detail, rotation.steps[2], REASON);
  const parts = calendarPage.overrideErasures('save');
  const dialog = parts.dialog(1);
  await parts.confirmIn(parts.rowsIn(dialog).nth(0)).click();

  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(calendarPage.overrideUnchecked).toBeVisible();
  await expect(calendarPage.overrideUncheckedRetry, 'the retry is not in reach').toBeFocused();
  await expect(calendarPage.overrideReasonIn(detail)).toHaveValue(REASON);
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);
  await page.unroute(resolutions);
});

test('a removal whose erasures cannot be checked again at the dialog\'s save re-arms its confirmation, with the retry', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const resolutions = '**/rest/v1/conflict_resolutions*';
  const { detail, remove, confirm } = await armRemoval(fixture.slug, calendarPage);
  await calendarPage.confirmRemoveIn(confirm).click();
  const parts = calendarPage.overrideErasures('removal');
  const dialog = parts.dialog(1);
  await parts.confirmIn(parts.rowsIn(dialog).nth(0)).click();

  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  const refusal = confirm.getByRole('alert').filter({ hasText: erasures.unavailable });
  await expect(refusal).toBeVisible();
  await expect(refusal.getByRole('button', { name: erasures.retry, exact: true })).toBeFocused();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await page.unroute(resolutions);
  await calendarPage.cancelRemoveIn(confirm).click();
  await expect(remove).toBeVisible();
});

test('a removal whose override was removed meanwhile is refused as gone at the dialog\'s save, after a re-read', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const { rotation, team, date, detail, confirm } = await armRemoval(fixture.slug, calendarPage);
  await calendarPage.confirmRemoveIn(confirm).click();
  const parts = calendarPage.overrideErasures('removal');
  const dialog = parts.dialog(1);
  await parts.confirmIn(parts.rowsIn(dialog).nth(0)).click();

  // MEANWHILE another admin removes it.
  await removeOverrideInSql(rotation, team.id, date);
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);
  await expect(calendarPage.alertIn(detail).filter({ hasText: override.refused.gone })).toBeVisible();
  await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
});

test('a removal written from the erasure dialog that fails says so in the day detail, focus on the removal', async ({
  page,
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const removal = '**/rest/v1/rpc/remove_shift_type_override*';
  const { person, detail, remove, confirm } = await armRemoval(fixture.slug, calendarPage);
  await calendarPage.confirmRemoveIn(confirm).click();
  const parts = calendarPage.overrideErasures('removal');
  const dialog = parts.dialog(1);
  await parts.confirmIn(parts.rowsIn(dialog).nth(0)).click();

  await page.route(removal, (route) => route.fulfill({ status: 500, body: '{}' }));
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  await expect(calendarPage.alertIn(detail).filter({ hasText: override.refused.failed })).toBeVisible();
  await expect(remove, 'focus is not on the removal').toBeFocused();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await page.unroute(removal);

  // Nothing was removed: the conflict stands.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});
