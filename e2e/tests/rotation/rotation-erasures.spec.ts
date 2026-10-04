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
  seedRosterOverride,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, weekdayOf } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.5a: a rotation save cannot quietly erase a pending conflict.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
 * on it; the fixture team keeps no rotation, so the builder opens on an empty
 * draft. Leave over today + 4 and + 5 — Dan and Noć — is two conflicts. The
 * builder's change is the seed's own `Slobodno` alone, from tomorrow: every
 * team free every day, so both conflicts would go. Everything written —
 * the builder's change, the seed, the member with their leave, and the team —
 * is removed in the `afterEach` whatever happens.
 */

test.use({ storageState: ADMIN_STATE });

const builder = hr.rotation.builder;
const erasures = builder.erasures;

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

  if (seeded !== null && since !== null) await attempt(() => removeRotationChangesOver(seeded, since));
  // The seed first: it deletes every roster override, which names the member.
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
}

/**
 * The hold, a team of the test's own with the seeded rotation, and a fresh
 * member on leave `from`–`to` (days from today) — on that team, or on
 * `memberTeam` when given.
 */
async function setUp(slug: string, from: number, to: number, memberTeam: string | null = null): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  seededSince = await databaseNow();
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(slug, memberTeam ?? team.id, rotation.today, 20);
  own.members.push(person.id);
  await seedLeaveRecord(slug, person.id, addDays(rotation.today, from), addDays(rotation.today, to));

  return { rotation, team, person };
}

/** The draft: the seed's types at `steps`, in order, every team on the first today, from tomorrow. */
async function draftOf(rotationPage: RotationPage, rotation: SeededRotation, steps: readonly (0 | 1 | 2)[]): Promise<void> {
  await rotationPage.goto();
  await expect(rotationPage.effectiveFromInput).toBeVisible();
  await expect(rotationPage.steps, 'the builder did not open on an empty draft').toHaveCount(0);
  for (const step of steps) await rotationPage.addStep(rotation.steps[step]);
  await expect(rotationPage.steps).toHaveCount(steps.length);
  await rotationPage.effectiveFromInput.fill(addDays(rotation.today, 1));
}

/** The draft: the seed's type at `step` alone, from tomorrow — every team on it every day. */
async function draftOnly(rotationPage: RotationPage, rotation: SeededRotation, step: 0 | 2): Promise<void> {
  await draftOf(rotationPage, rotation, [step]);
}

/** The draft: the seed's `Slobodno` alone, from tomorrow — every team free every day. */
async function draftAllFree(rotationPage: RotationPage, rotation: SeededRotation): Promise<void> {
  await draftOnly(rotationPage, rotation, 2);
}

/** The text after an ICU plural block: `za sljedeći ciklus:`. */
function tailOf(message: string): string {
  return message.slice(message.lastIndexOf('}') + 1).trim();
}

/** The `few` form of an ICU plural, filled — `2 neriješena konflikta` — without an ICU parser. */
function fewForm(message: string, count: number): string {
  const form = /few \{([^}]*)\}/.exec(message)?.[1];
  if (form === undefined) throw new Error(`E2E: ${message} has no few form`);

  return form.replace('#', String(count));
}

test('a save that erases two conflicts waits until both are confirmed, by keyboard, and the queue loses both', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, team, person } = await setUp(fixture.slug, 4, 5);
  const [dan, noc] = [addDays(rotation.today, 4), addDays(rotation.today, 5)];

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(2);

  // Dan, Noć, then four Slobodno: today + 4 and + 5 fall free, and Dan
  // straight into Noć is the rest-gap warning the rules flag.
  await draftOf(rotationPage, rotation, [0, 1, 2, 2, 2, 2]);
  await rotationPage.saveButton.click();

  const dialog = rotationPage.erasureDialog(2);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(fewForm(erasures.lede, 2));
  const rows = rotationPage.erasureRowsIn(dialog);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(
    fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(dan), date: dayMonth(dan), type: rotation.steps[0] }),
  );
  await expect(rows.nth(1)).toContainText(
    fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(noc), date: dayMonth(noc), type: rotation.steps[1] }),
  );
  await expect(rows.nth(0)).toContainText(fill(erasures.rowFree, { member: person.name, team: team.name }));
  // THE WARNINGS SHOW, AND NEVER BLOCK: the rest gap, in the dialog.
  await expect(dialog).toContainText(tailOf(builder.warnings.summary));
  // `rada bez slobodnog dana između`: the rest gap's words between its two arguments.
  const restGap = builder.warnings.restGap.split('{types}')[0]?.replace('{duration}', '').replace('(', '').trim() ?? '';
  await expect(dialog).toContainText(restGap);
  // NOTHING PRESELECTED, and the save waits.
  for (const index of [0, 1]) {
    await expect(rotationPage.erasureConfirmIn(rows.nth(index))).toHaveAttribute('aria-pressed', 'false');
    await expect(rotationPage.erasureKeepIn(rows.nth(index))).toHaveAttribute('aria-pressed', 'false');
  }
  const save = rotationPage.erasureSaveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');

  // THE KEYBOARD ALONE: focus starts on the first row's confirm.
  await expect(rotationPage.erasureConfirmIn(rows.nth(0))).toBeFocused();
  await page.keyboard.press('Space');
  await expect(rotationPage.erasureConfirmIn(rows.nth(0))).toHaveAttribute('aria-pressed', 'true');
  await expect(save, 'one of two confirmed').toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Tab');
  await expect(rotationPage.erasureKeepIn(rows.nth(0))).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(rotationPage.erasureConfirmIn(rows.nth(1))).toBeFocused();
  await page.keyboard.press('Space');
  await expect(rotationPage.erasureConfirmIn(rows.nth(1))).toHaveAttribute('aria-pressed', 'true');
  await expect(save).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Tab');
  await expect(rotationPage.erasureKeepIn(rows.nth(1))).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(rotationPage.erasureBackIn(dialog)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(rotationPage.savedConfirmation).toBeVisible();
  await expect(rotationPage.savedConfirmation).toContainText(fewForm(erasures.removed, 2));
  await expect(dialog).toHaveCount(0);
  await expect(rotationPage.saveButton, 'focus is not back on the save').toBeFocused();

  // THE QUEUE −2: the cause is gone, so both conflicts are.
  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('a kept conflict holds the save, and going back keeps the draft and saves nothing', async ({
  page,
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, person } = await setUp(fixture.slug, 4, 5);

  await draftAllFree(rotationPage, rotation);
  await rotationPage.saveButton.click();
  const dialog = rotationPage.erasureDialog(2);
  const rows = rotationPage.erasureRowsIn(dialog);
  await expect(rows).toHaveCount(2);

  await rotationPage.erasureConfirmIn(rows.nth(0)).click();
  await rotationPage.erasureKeepIn(rows.nth(1)).click();
  await expect(rotationPage.erasureKeepIn(rows.nth(1))).toHaveAttribute('aria-pressed', 'true');
  await expect(rotationPage.erasureKeptIn(dialog)).toBeVisible();
  const save = rotationPage.erasureSaveIn(dialog);
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  // A press while held does nothing (`aria-disabled` keeps it focusable).
  await save.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();

  // At 390 px the rows wrap, and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);

  await rotationPage.erasureBackIn(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(rotationPage.saveButton, 'focus is not back on the save').toBeFocused();
  await expect(rotationPage.savedConfirmation).toHaveCount(0);
  // The draft is as it was.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(rotationPage.effectiveFromInput).toHaveValue(addDays(rotation.today, 1));
  await expect(rotationPage.steps).toHaveCount(1);
  await expect(rotationPage.steps.nth(0)).toContainText(rotation.steps[2]);

  // Nothing was saved: both conflicts are still on the queue.
  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(2);
});

test('a conflict added while the confirmation is open shows the list again, undecided, and nothing is saved until it is confirmed', async ({
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  const { rotation, person } = await setUp(fixture.slug, 4, 5);

  await draftAllFree(rotationPage, rotation);
  await rotationPage.saveButton.click();
  const first = rotationPage.erasureDialog(2);
  const firstRows = rotationPage.erasureRowsIn(first);
  await expect(firstRows).toHaveCount(2);

  // MEANWHILE: leave over today + 8, a Dan the draft also frees.
  const later = addDays(rotation.today, 8);
  await seedLeaveRecord(fixture.slug, person.id, later, later);

  for (const index of [0, 1]) await rotationPage.erasureConfirmIn(firstRows.nth(index)).click();
  await rotationPage.erasureSaveIn(first).click();

  // Derived again before the write: the list is shown again with the new row, all undecided.
  const again = rotationPage.erasureDialog(3);
  await expect(again).toBeVisible();
  await expect(again.getByRole('status')).toHaveText(erasures.changed);
  const rows = rotationPage.erasureRowsIn(again);
  await expect(rows).toHaveCount(3);
  for (const index of [0, 1, 2]) {
    await expect(rotationPage.erasureConfirmIn(rows.nth(index))).toHaveAttribute('aria-pressed', 'false');
    await expect(rotationPage.erasureKeepIn(rows.nth(index))).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(rotationPage.erasureSaveIn(again)).toHaveAttribute('aria-disabled', 'true');
  await expect(rotationPage.erasureConfirmIn(rows.nth(0))).toBeFocused();
  // Nothing was saved.
  await expect(rotationPage.savedConfirmation).toHaveCount(0);

  for (const index of [0, 1, 2]) await rotationPage.erasureConfirmIn(rows.nth(index)).click();
  await rotationPage.erasureSaveIn(again).click();
  await expect(rotationPage.savedConfirmation).toBeVisible();
  await expect(rotationPage.dialog()).toHaveCount(0);

  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(0);
});

test('a save that keeps an existing conflict working erases nothing, and saves at once', async ({
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  // Leave over today + 4, a Dan: one conflict, which the change keeps — every team on Dan every day.
  const { rotation, person } = await setUp(fixture.slug, 4, 4);

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  await draftOnly(rotationPage, rotation, 0);
  await rotationPage.saveButton.click();

  await expect(rotationPage.savedConfirmation).toBeVisible();
  // No count of removed conflicts: every form starts with the one form's first word.
  await expect(rotationPage.savedConfirmation).not.toContainText(plural(erasures.removed, 1).split(' ')[0] ?? '');
  await expect(rotationPage.dialog()).toHaveCount(0);
  // The check ran and passed: the conflict still stands.
  await conflictsPage.goto();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);
});

test('a roster override the change leaves pending is listed, its team still working without the member', async ({
  fixture,
  rotationPage,
  conflictsPage,
}) => {
  test.slow();
  // The member is on the fixture team, which has no rotation; an override puts
  // them on the seeded team's Dan on today + 4, the date they are on leave.
  const { rotation, team, person } = await setUp(fixture.slug, 4, 4, fixture.team.id);
  const date = addDays(rotation.today, 4);
  await seedRosterOverride(rotation, team.id, date, null, person.name, 'Zamjena zbog vježbe (E2E).');

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(person.name)).toHaveCount(1);

  // Every team on Dan from tomorrow: the seeded team still works that day,
  // but the change leaves the override pending, so the member is off its roster.
  await draftOnly(rotationPage, rotation, 0);
  await rotationPage.saveButton.click();
  const dialog = rotationPage.erasureDialog(1);
  const rows = rotationPage.erasureRowsIn(dialog);
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(
    fill(erasures.rowTitle, { team: team.name, weekday: weekdayOf(date), date: dayMonth(date), type: rotation.steps[0] }),
  );
  await expect(rows.nth(0)).toContainText(fill(erasures.rowWithout, { member: person.name, team: team.name }));

  await rotationPage.erasureConfirmIn(rows.nth(0)).click();
  await rotationPage.erasureSaveIn(dialog).click();
  await expect(rotationPage.savedConfirmation).toContainText(plural(erasures.removed, 1));
});

test('a save whose erasures cannot be checked is refused, saves nothing, and the retry checks again', async ({
  page,
  fixture,
  rotationPage,
}) => {
  test.slow();
  const { rotation } = await setUp(fixture.slug, 4, 5);
  const records = '**/rest/v1/leave_records*';

  await draftAllFree(rotationPage, rotation);
  await page.route(records, (route) => route.fulfill({ status: 500, body: '{}' }));
  await rotationPage.saveButton.click();

  await expect(rotationPage.erasuresUnavailable).toBeVisible();
  await expect(rotationPage.erasuresRetry, 'the retry is not in reach').toBeFocused();
  await expect(rotationPage.savedConfirmation).toHaveCount(0);
  await expect(rotationPage.dialog()).toHaveCount(0);

  // The read answers again: the retry checks afresh and asks about both.
  await page.unroute(records);
  await rotationPage.erasuresRetry.click();
  const dialog = rotationPage.erasureDialog(2);
  await expect(dialog).toBeVisible();
  await expect(rotationPage.erasuresUnavailable).toHaveCount(0);
  await rotationPage.erasureBackIn(dialog).click();
  await expect(rotationPage.savedConfirmation).toHaveCount(0);
});
