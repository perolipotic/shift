import { randomBytes } from 'node:crypto';

import type { Locator } from '@playwright/test';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedRosterOverride,
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
 * Story 5.5b: a calendar roster change cannot quietly erase a pending conflict.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
 * on leave over today + 4, a Dan: one conflict. Taking them off that day's
 * roster in the day detail — or removing the override that put them on —
 * would take it out of the queue, so the erasure confirmation opens beside
 * the day detail first. Everything written — the roster changes, the seed, the
 * member with their leave, and the team — is removed in the `afterEach`
 * whatever happens.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const rosterChange = hr.kalendar.detail.rosterChange;
const erasures = rosterChange.erasures;
const REASON = 'Godišnji odmor (E2E).';

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

  // The seed first: it deletes every roster override, which names the member.
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
  /** Today + 4, a Dan, the date the member is on leave. */
  readonly date: string;
}

/**
 * The hold, a team of the test's own with the seeded rotation, and a fresh
 * member on leave over today + 4 — on that team, or on `memberTeam` when given.
 */
async function setUp(slug: string, memberTeam: string | null = null): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(slug, memberTeam ?? team.id, rotation.today, 20);
  own.members.push(person.id);
  const date = addDays(rotation.today, 4);
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

test('taking a member on leave off the roster waits for the confirmation, by keyboard, and the queue loses the conflict', async ({
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
  await calendarPage.changeRosterIn(detail, person.name, null, REASON);

  const parts = calendarPage.rosterErasures('save');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(
    fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(date), date: dayMonth(date), type: rotation.steps[0] }),
  );
  await expect(rows.nth(0)).toContainText(fill(erasures.rowWithout, { member: person.name, team: team.name }));
  // NOTHING PRESELECTED, and the save waits.
  await expect(parts.confirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  await expect(parts.keepIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'false');
  const save = parts.saveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');

  // THE KEYBOARD ALONE: focus starts on the first row's confirm.
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
  await expect(calendarPage.statusIn(detail)).toContainText(rosterChange.saved);
  await expect(calendarPage.statusIn(detail)).toContainText(plural(erasures.removed, 1));
  await expect(calendarPage.rosterChangesIn(detail)).toContainText(fill(rosterChange.removed, { name: person.name }));

  // THE QUEUE −1: the cause is gone, so the conflict is.
  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('removing an override that put a member on leave on the roster goes through its confirmation, then the erasure confirmation', async ({
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  // The member is on the fixture team, which has no rotation; an override puts
  // them on the seeded team's Dan on today + 4, the date they are on leave.
  const { rotation, team, person, date } = await setUp(fixture.slug, fixture.team.id);
  await seedRosterOverride(rotation, team.id, date, null, person.name, REASON);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  const detail = await openDay(calendarPage, team.name, date);
  const block = calendarPage.rosterChangesIn(detail);
  const added = fill(rosterChange.added, { name: person.name });
  await expect(block).toContainText(added);
  const remove = calendarPage.rosterRemoveIn(block);
  await remove.click();
  const confirm = calendarPage.rosterRemoveConfirmOf(added, team.name, date);
  await calendarPage.confirmRosterRemoveIn(confirm).click();

  // The removal's own confirmation closes, and the erasure confirmation follows.
  const parts = calendarPage.rosterErasures('removal');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(confirm).toHaveCount(0);
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(fill(erasures.rowWithout, { member: person.name, team: team.name }));

  // "Natrag na uređivanje" returns to the day detail, focus on the removal, nothing removed.
  await parts.backIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await expect(block).toContainText(added);

  await remove.click();
  await calendarPage.confirmRosterRemoveIn(confirm).click();
  await expect(dialog).toBeVisible();
  await parts.confirmIn(rows.nth(0)).click();
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(calendarPage.statusIn(detail)).toContainText(rosterChange.removedDone);
  await expect(calendarPage.statusIn(detail)).toContainText(plural(erasures.removed, 1));
  await expect(block).toHaveCount(0);

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('a roster change that erases nothing saves in one click', async ({ page, fixture, calendarPage, conflictsPage }) => {
  test.slow();
  // Today is a Dan too, and the member is not on leave then.
  const { team, person } = await setUp(fixture.slug);
  const today = seed?.today ?? '';

  const detail = await openDay(calendarPage, team.name, today);
  await calendarPage.changeRosterIn(detail, person.name, null, REASON);

  await expect(calendarPage.statusIn(detail)).toHaveText(rosterChange.saved);
  // No erasure confirmation of ANY count was shown.
  await expect(page.getByRole('dialog', { name: anyErasureTitle })).toHaveCount(0);

  // The conflict on today + 4 stands.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a kept conflict holds the change, and going back keeps the form as entered and writes nothing', async ({
  page,
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { team, person, date } = await setUp(fixture.slug);

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.changeRosterIn(detail, person.name, null, REASON);
  const parts = calendarPage.rosterErasures('save');
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
  await expect(calendarPage.rosterSaveIn(detail), 'focus is not back on the form\'s save').toBeFocused();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  // The form is as it was entered.
  await expect(calendarPage.rosterReasonIn(detail)).toHaveValue(REASON);
  await expect(calendarPage.rosterOutIn(detail)).toHaveValue(person.id);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Nothing was written: the conflict is still on the queue.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a roster change whose erasures cannot be checked is refused, writes nothing, and the retry checks again', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const { team, person, date } = await setUp(fixture.slug);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  const detail = await openDay(calendarPage, team.name, date);
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await calendarPage.changeRosterIn(detail, person.name, null, REASON);

  await expect(calendarPage.rosterUnchecked).toBeVisible();
  await expect(calendarPage.rosterUncheckedRetry, 'the retry is not in reach').toBeFocused();
  // THE CALENDAR IS LEFT ALONE: no unavailable alert of its own, and the day stays open.
  await expect(calendarPage.unavailableAlert).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(calendarPage.rosterErasures('save').dialog(1)).toHaveCount(0);
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);

  // The read answers again: the retry checks afresh and asks about the conflict.
  await page.unroute(resolutions);
  await calendarPage.rosterUncheckedRetry.click();
  const parts = calendarPage.rosterErasures('save');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(calendarPage.rosterUnchecked).toHaveCount(0);
  await parts.backIn(dialog).click();
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);
});

test('a conflict that reads differently by the time the save is confirmed shows the list again, undecided, and nothing is written', async ({
  fixture,
  calendarPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug);

  const detail = await openDay(calendarPage, team.name, date);
  await calendarPage.changeRosterIn(detail, person.name, null, REASON);
  const parts = calendarPage.rosterErasures('save');
  const first = parts.dialog(1);
  const firstRows = parts.rowsIn(first);
  await expect(firstRows).toHaveCount(1);
  await expect(firstRows.nth(0)).toContainText(rotation.steps[0]);

  // MEANWHILE another admin makes the day a Noć: the conflict stands, but the row decided read Dan.
  await seedShiftTypeOverride(rotation, team.id, date, 1, 'Zamjena smjene (E2E).');

  await parts.confirmIn(firstRows.nth(0)).click();
  await parts.saveIn(first).click();

  // Derived again before the write: shown again, undecided, with the changed line.
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
  await expect(calendarPage.statusIn(detail)).toHaveCount(0);
  await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a removal whose erasures cannot be checked is refused inside its own confirmation, and the retry checks again', async ({
  page,
  fixture,
  calendarPage,
}) => {
  test.slow();
  const { rotation, team, person, date } = await setUp(fixture.slug, fixture.team.id);
  await seedRosterOverride(rotation, team.id, date, null, person.name, REASON);
  const resolutions = '**/rest/v1/conflict_resolutions*';

  const detail = await openDay(calendarPage, team.name, date);
  const block = calendarPage.rosterChangesIn(detail);
  const added = fill(rosterChange.added, { name: person.name });
  await calendarPage.rosterRemoveIn(block).click();
  const confirm = calendarPage.rosterRemoveConfirmOf(added, team.name, date);
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));
  await calendarPage.confirmRosterRemoveIn(confirm).click();

  const refusal = confirm.getByRole('alert').filter({ hasText: erasures.unavailable });
  await expect(refusal).toBeVisible();
  const retry = refusal.getByRole('button', { name: erasures.retry, exact: true });
  await expect(retry, 'the retry is not in reach').toBeFocused();
  await expect(calendarPage.unavailableAlert).toHaveCount(0);
  // Nothing was removed.
  await expect(block).toContainText(added);

  await page.unroute(resolutions);
  await retry.click();
  const parts = calendarPage.rosterErasures('removal');
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  await expect(confirm).toHaveCount(0);
  await parts.backIn(dialog).click();
  await expect(block).toContainText(added);
});
