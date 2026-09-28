import { randomBytes } from 'node:crypto';

import type { Locator } from '@playwright/test';

import type { RotationPage } from '../../pages/rotation.page.ts';
import {
  databaseNow,
  holdRotation,
  removeRotationChangesOver,
  removeSeededRotation,
  seedShiftTypeOverride,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What the override review's test seeded (story 3.5c), removed before the hold is released. */
let seed: SeededRotation | null = null;
/** The database instant that test started at: its cleanup reaches nothing written before it. */
let seededSince: string | null = null;

test.afterEach(async () => {
  // EVERY STEP RUNS, whichever fails: a failed undo of the builder's change
  // must not leave the seed, nor the hold, behind. The first failure is
  // reported once all have run.
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

  if (seeded !== null && since !== null) await attempt(() => removeRotationChangesOver(seeded, since));
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  seed = null;
  seededSince = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

const builder = hr.rotation.builder;
const shiftTypes = hr.rotation.shiftTypes;

/** The `few` form of an ICU plural, filled — `3 dana` — without an ICU parser. */
function fewForm(message: string, count: number): string {
  const form = /few \{([^}]*)\}/.exec(message)?.[1];
  if (form === undefined) throw new Error(`E2E: ${message} has no few form`);

  return form.replace('#', String(count));
}

/**
 * The keyboard path: focus the handle, space lifts (announced), one arrow
 * moves (announced), space drops (announced) — each awaited, since dnd-kit
 * starts listening for the arrows only once the lift has rendered.
 */
async function keyboardMove(
  rotationPage: RotationPage,
  handle: Locator,
  from: number,
  arrow: 'ArrowUp' | 'ArrowDown',
  to: number,
): Promise<void> {
  const positions = { from: String(from), to: String(to) };

  const { keyboard } = rotationPage.page;

  await handle.focus();
  await keyboard.press('Space');
  await expect(rotationPage.announced(fill(builder.drag.lifted, { position: String(from) }))).toBeAttached();
  await rotationPage.afterPendingTimers();
  await keyboard.press(arrow);
  await expect(rotationPage.announced(fill(builder.drag.over, positions))).toBeAttached();
  await keyboard.press('Space');
  await expect(rotationPage.announced(fill(builder.drag.dropped, positions))).toBeAttached();
}

test('an admin builds a rotation, sees its figures and cycle, saves it, and it opens as the rotation in force', async ({
  page,
  fixture,
  rotationPage,
  teamsPage,
}) => {
  // EVERYTHING THIS TEST WRITES IS ITS OWN, per attempt: a team made for it
  // and three types with fresh names. A team's rotation changes at most once
  // per date, and the save binds every active team of the run's organization,
  // so the rotation is held for this test alone (the phone spec saves one
  // too) and the versions an earlier attempt dated today are removed first.
  // Waiting for the other holder may take a while, hence the longer timeout.
  test.slow();
  hold = holdRotation(fixture.slug);
  await hold.ready;

  const suffix = randomBytes(3).toString('hex');
  const teamName = `Smjena ${suffix}`;
  const a = `Dnevna ${suffix}`;
  const b = `Noćna ${suffix}`;
  const off = `Slobodno ${suffix}`;

  await teamsPage.goto();
  await teamsPage.addTeam(teamName);
  await expect(teamsPage.status).toHaveText(hr.smjene.created);

  await rotationPage.goto();
  await rotationPage.addShiftType(a, ['07:00', '19:00']);
  await rotationPage.addShiftType(b, ['19:00', '07:00']);
  await rotationPage.addShiftType(off, null);

  // Build [A, B, Slob].
  const newStep = rotationPage.newStepSelect;
  for (const name of [a, b, off]) {
    await newStep.selectOption({ label: name });
    await rotationPage.addStepButton.click();
  }
  const steps = rotationPage.steps;
  await expect(steps).toHaveCount(3);
  for (const [index, name] of [a, b, off].entries()) await expect(steps.nth(index)).toContainText(name);

  // THE STEP CONTROLS, by drag. The team — on step 1, A, like every team of
  // an empty draft — follows its step wherever it goes.
  const teamStep = rotationPage.offsetOf(teamName);
  const handle = (position: number) => rotationPage.dragHandle(position);
  await expect(teamStep).toHaveValue('0');

  // By MOUSE: step 1's handle dragged onto step 2 → [B, A, Slob].
  await rotationPage.dragOnto(handle(1), steps.nth(1));
  for (const [index, name] of [b, a, off].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(teamStep).toHaveValue('1');
  await expect(await rotationPage.previewCell(teamName, 0)).toContainText(a);

  // By KEYBOARD: step 3's handle, space, up, space → [B, Slob, A], and focus
  // stays on the moved step's handle, now step 2.
  await keyboardMove(rotationPage, handle(3), 3, 'ArrowUp', 2);
  for (const [index, name] of [b, off, a].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(handle(2)).toBeFocused();
  await expect(teamStep).toHaveValue('2');
  await expect(await rotationPage.previewCell(teamName, 0)).toContainText(a);
  await expect(await rotationPage.previewCell(teamName, 1)).toContainText(b);

  // Escape cancels a lifted step: nothing moves.
  await handle(1).focus();
  await page.keyboard.press('Space');
  await expect(rotationPage.announced(fill(builder.drag.lifted, { position: '1' }))).toBeAttached();
  await rotationPage.afterPendingTimers();
  await page.keyboard.press('ArrowDown');
  await expect(rotationPage.announced(fill(builder.drag.over, { from: '1', to: '2' }))).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(rotationPage.announced(fill(builder.drag.cancelled, { position: '1' }))).toBeAttached();
  for (const [index, name] of [b, off, a].entries()) await expect(steps.nth(index)).toContainText(name);

  // Step 2 removed → [B, A]. Anchored today, the team works A today, B tomorrow.
  await rotationPage.removeStepButton(2).click();
  await expect(steps).toHaveCount(2);
  for (const [index, name] of [b, a].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(teamStep).toHaveValue('1');
  await expect(await rotationPage.previewCell(teamName, 0)).toContainText(a);
  await expect(await rotationPage.previewCell(teamName, 1)).toContainText(b);

  // THE ANCHOR. One day later, the team stands on A tomorrow, so on B today.
  const anchor = rotationPage.anchorInput;
  const today = await anchor.inputValue();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await anchor.fill(tomorrow.toISOString().slice(0, 10));
  await expect(await rotationPage.previewCell(teamName, 0)).toContainText(b);
  await anchor.fill(today);
  await expect(await rotationPage.previewCell(teamName, 0)).toContainText(a);

  // Back to [A, B, Slob]: step 2 lifted up by keyboard, then Slob added again.
  await keyboardMove(rotationPage, handle(2), 2, 'ArrowUp', 1);
  for (const [index, name] of [a, b].entries()) await expect(steps.nth(index)).toContainText(name);
  await newStep.selectOption({ label: off });
  await rotationPage.addStepButton.click();
  await expect(steps).toHaveCount(3);
  for (const [index, name] of [a, b, off].entries()) await expect(steps.nth(index)).toContainText(name);

  // The figures: 3 dana · 2 · 24 h.
  await expect(rotationPage.text(fewForm(builder.cycleLength, 3))).toBeVisible();
  await expect(rotationPage.figure(builder.workingStepsLabel)).toContainText('2');
  await expect(rotationPage.figure(builder.cycleHoursLabel)).toContainText(
    fill(shiftTypes.duration.hours, { hours: '24' }),
  );

  // RASPOREDI RAVNOMJERNO. The run's own teams — the fixture's and this
  // attempt's — both put on step 2, then spread: team i of n on 3 steps lands
  // on floor(i * 3 / n) while n <= 3, else on i wrapped by 3, in the order the
  // offsets list them.
  const bothOnStep2 = fill(builder.stepOption, { position: '2', name: b });
  for (const name of [fixture.team.name, teamName]) {
    await rotationPage.offsetOf(name).selectOption({ label: bothOnStep2 });
  }
  await expect(rotationPage.offsetOf(fixture.team.name)).toHaveValue('1');
  await expect(teamStep).toHaveValue('1');
  await rotationPage.spreadButton.click();
  // Every body row's first cell is its team's name, in the list's order.
  const teamNames = await rotationPage.offsetTeamNames();
  const listed = teamNames.length;
  for (const [index, name] of teamNames.entries()) {
    const expected = listed <= 3 ? Math.floor((index * 3) / listed) : index - Math.floor(index / 3) * 3;
    await expect(rotationPage.offsetOf(name)).toHaveValue(String(expected));
  }
  expect(teamNames).toEqual(expect.arrayContaining([fixture.team.name, teamName]));

  // The team made for this attempt on step 2, anchored today: B, Slob, A.
  await rotationPage.offsetOf(teamName).selectOption({ label: fill(builder.stepOption, { position: '2', name: b }) });
  for (const [row, name] of [b, off, a].entries()) {
    await expect(await rotationPage.previewCell(teamName, row)).toContainText(name);
  }

  // A RENAME in the type's edit dialog, BEFORE saving: the dialog's route
  // remounts the builder, and the unsaved draft — kept outside it — is
  // intact when the dialog closes, with the new name and no reload.
  const renamed = `Odmor ${suffix}`;
  await rotationPage.shiftTypeEditLink(off).click();
  // By role, so the closed add dialog's hidden field of the same label is not matched.
  await rotationPage.shiftTypeNameTextbox.fill(renamed);
  await rotationPage.shiftTypeSaveButton.click();
  await expect(rotationPage.text(shiftTypes.renamed)).toBeVisible();
  await rotationPage.shiftTypeCloseButton.click();
  await expect(page).toHaveURL('/postavke-rotacije');
  await expect(steps).toHaveCount(3);
  for (const [index, name] of [a, b, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(teamStep).toHaveValue('1');
  for (const [row, name] of [b, renamed, a].entries()) {
    await expect(await rotationPage.previewCell(teamName, row)).toContainText(name);
  }

  await rotationPage.saveButton.click();
  await expect(rotationPage.text(builder.saved)).toBeVisible();

  // Reloaded, the builder opens as the rotation now in force, anchored on
  // the organization's today (the prefill's anchor is always today).
  await page.reload();
  await expect(steps).toHaveCount(3);
  await expect(anchor).toHaveValue(today);
  for (const [index, name] of [a, b, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(rotationPage.offsetOf(teamName)).toHaveValue('1');
  for (const [row, name] of [b, renamed, a].entries()) {
    await expect(await rotationPage.previewCell(teamName, row)).toContainText(name);
  }

  // And saving it again unchanged is refused before anything is sent.
  await rotationPage.saveButton.click();
  await expect(rotationPage.text(builder.error.unchanged)).toBeVisible();

  // TWO CYCLES in the preview: twice the cycle's dates, `Dan N` restarting,
  // the second cycle named over its first day. A view choice only.
  await rotationPage.previewCyclesSelect.selectOption({ label: fewForm(builder.cycleCount, 2) });
  // The team column, then 2 × 3 dates.
  await expect(rotationPage.previewHeaders).toHaveCount(1 + 2 * 3);
  await expect(rotationPage.previewCycleHeader(2)).toHaveCount(1);
  await expect(await rotationPage.previewCell(teamName, 3)).toContainText(b);
});

/** An ICU message with its `{count, plural, …}` block replaced by the filled `few` form — `3 dana …`. */
function withFewCount(message: string, count: number): string {
  return message.replace(/\{count, plural, [\s\S]*?other \{[^}]*\}\}/, fewForm(message, count));
}

test('a saved rotation reports its coverage gap, duplicate and rest gap, and an edit clears them', async ({
  page,
  fixture,
  rotationPage,
  teamsPage,
}) => {
  // Its own team and types, per attempt, and the run's rotation held, as the
  // test above (a save binds every active team of the run's organization).
  test.slow();
  hold = holdRotation(fixture.slug);
  await hold.ready;

  const suffix = randomBytes(3).toString('hex');
  const teamName = `Smjena ${suffix}`;
  const a = `Dnevna ${suffix}`;
  const b = `Noćna ${suffix}`;
  const off = `Slobodno ${suffix}`;

  await teamsPage.goto();
  await teamsPage.addTeam(teamName);
  await expect(teamsPage.status).toHaveText(hr.smjene.created);

  await rotationPage.goto();
  await rotationPage.addShiftType(a, ['07:00', '19:00']);
  await rotationPage.addShiftType(b, ['19:00', '07:00']);
  await rotationPage.addShiftType(off, null);

  // [A, B, Slob], and every team — the fixture's and this attempt's, at least
  // two — on step 1, as an empty draft starts them.
  const newStep = rotationPage.newStepSelect;
  for (const name of [a, b, off]) {
    await newStep.selectOption({ label: name });
    await rotationPage.addStepButton.click();
  }
  const steps = rotationPage.steps;
  await expect(steps).toHaveCount(3);
  for (const name of [fixture.team.name, teamName]) {
    await expect(rotationPage.offsetOf(name)).toHaveValue('0');
  }

  // Saved, never blocked: the confirmation carries the warnings. Over the
  // next cycle every team works A, then B, then is free — so B is uncovered
  // on day 1, A on day 2, both on day 3; A is doubled on day 1 and B on day
  // 2; and A → B is 24 h of work with no free day between.
  await rotationPage.saveButton.click();
  const confirmation = rotationPage.savedConfirmation;
  await expect(confirmation).toBeVisible();
  const warnings = builder.warnings;
  await expect(confirmation).toContainText(withFewCount(warnings.summary, 3));
  await expect(confirmation).toContainText(withFewCount(warnings.coverageGap, 3));
  await expect(confirmation).toContainText(withFewCount(warnings.duplicateCoverage, 2));
  await expect(confirmation).toContainText(
    fill(warnings.restGap, {
      duration: fill(shiftTypes.duration.hours, { hours: '24' }),
      types: `${a}${warnings.typeSeparator}${b}`,
    }),
  );
  // Three warnings, then a line per date: three gap dates, two duplicate dates.
  await expect(rotationPage.savedConfirmationLines).toHaveCount(3 + 3 + 2);

  // The next edit clears them with the confirmation: the builder re-opened
  // as the rotation now in force, and a step removed from it.
  await expect(steps).toHaveCount(3);
  await rotationPage.removeStepButton(3).click();
  await expect(steps).toHaveCount(2);
  await expect(confirmation).toHaveCount(0);
  await expect(rotationPage.text(withFewCount(warnings.coverageGap, 3), { exact: false })).toHaveCount(0);

  // And a reload shows none: warnings are never standing.
  await page.reload();
  await expect(steps).toHaveCount(3);
  await expect(rotationPage.text(builder.saved)).toHaveCount(0);
  await expect(rotationPage.text(withFewCount(warnings.summary, 3), { exact: false })).toHaveCount(0);
});

/** An ISO date `days` after the organization's today (the run's organization is in Europe/Zagreb). */
function organizationDate(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zagreb',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];

  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** `03.10.2026`, the binding shape, from an ISO date. */
function shownDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');

  return `${String(day)}.${String(month)}.${String(year)}`;
}

test('an admin schedules a change from tomorrow, sees it in the history, is refused a second, and cancels it', async ({
  fixture,
  rotationPage,
}) => {
  // Its own types, per attempt, and the run's rotation held (a save binds
  // every active team of the run's organization, and the hold removes every
  // version dated today or later, a scheduled one included).
  test.slow();
  hold = holdRotation(fixture.slug);
  await hold.ready;

  const suffix = randomBytes(3).toString('hex');
  const a = `Dnevna ${suffix}`;
  const off = `Slobodno ${suffix}`;
  const tomorrow = organizationDate(1);
  const history = builder.history;

  await rotationPage.goto();
  await rotationPage.addShiftType(a, ['07:00', '19:00']);
  await rotationPage.addShiftType(off, null);

  const newStep = rotationPage.newStepSelect;
  const steps = rotationPage.steps;
  const before = await steps.count();
  for (const name of [a, off]) {
    await newStep.selectOption({ label: name });
    await rotationPage.addStepButton.click();
  }
  await expect(steps).toHaveCount(before + 2);

  // `Vrijedi od` opens on today; the anchor stays where it was when it moves.
  const effective = rotationPage.effectiveFromInput;
  const anchor = rotationPage.anchorInput;
  await expect(effective).toHaveValue(organizationDate(0));
  const anchored = await anchor.inputValue();
  await effective.fill(tomorrow);
  await expect(anchor).toHaveValue(anchored);
  // The preview starts on the effective date: its first date column is tomorrow.
  await expect(rotationPage.previewHeaders.nth(1)).toContainText(shownDate(tomorrow).slice(0, 6));

  await rotationPage.saveButton.click();
  await expect(rotationPage.savedConfirmation).toBeVisible();

  // The history names the change: from tomorrow, scheduled, by the admin.
  const scheduledRow = rotationPage.historyRow(shownDate(tomorrow));
  await expect(scheduledRow).toHaveCount(1);
  await expect(scheduledRow).toContainText(history.status.scheduled);
  await expect(scheduledRow).toContainText(fixture.admin.name);

  // A second change is refused while that one is scheduled; the cancel is
  // offered beside the refusal.
  await newStep.selectOption({ label: a });
  await rotationPage.addStepButton.click();
  await rotationPage.saveButton.click();
  const refusal = rotationPage.scheduledRefusal;
  await expect(refusal).toBeVisible();
  await rotationPage.cancelScheduledOffer(shownDate(tomorrow)).click();

  // Confirmed in a dialog, then gone: the history no longer lists it.
  const dialog = rotationPage.dialog();
  await expect(dialog).toContainText(fill(builder.cancelScheduled.prompt, { date: shownDate(tomorrow) }));
  await rotationPage.cancelScheduledConfirm.click();
  await expect(rotationPage.statusWith(builder.cancelScheduled.done)).toBeVisible();
  await expect(rotationPage.historyRow(shownDate(tomorrow))).toHaveCount(0);
  await expect(refusal).toHaveCount(0);
});

test('a shift type gets a correction from tomorrow, the correction is cancelled, and the type is archived', async ({
  page,
  rotationPage,
}) => {
  // ITS OWN TYPE, per attempt; nothing here saves a rotation, so the
  // rotation is not held.
  const name = `Korekcija ${randomBytes(3).toString('hex')}`;
  const corrected = '08:00–20:00';

  await rotationPage.goto();
  await rotationPage.addShiftType(name, ['07:00', '19:00']);
  await rotationPage.shiftTypeEditLink(name).click();
  await expect(rotationPage.shiftTypeEditDialog).toBeVisible();

  // CORRECT THE TIMES from the date field's minimum: a type added today has
  // today's version, so the earliest correction is tomorrow, the default.
  const tomorrow = organizationDate(1);
  await expect(rotationPage.timesFromInput).toHaveValue(tomorrow);
  await rotationPage.timesStartInput.fill('08:00');
  await rotationPage.timesEndInput.fill('20:00');
  await rotationPage.timesCorrectButton.click();
  await expect(rotationPage.statusWith(shiftTypes.timesSaved)).toBeVisible();
  await expect(rotationPage.scheduledTimesLine(shownDate(tomorrow), corrected)).toBeVisible();

  // While it is scheduled the archive is not offered; the note says why.
  await expect(rotationPage.archiveShiftTypeButton(name)).toHaveCount(0);
  await expect(rotationPage.changeScheduledNote).toBeVisible();

  // CANCEL IT: the cancel unmounts with the correction, so focus follows the
  // confirmation, and the correction is offered again.
  await rotationPage.cancelScheduledTimesButton.click();
  await expect(rotationPage.statusWith(shiftTypes.timesCancelled)).toBeFocused();
  await expect(rotationPage.scheduledTimesLine(shownDate(tomorrow), corrected)).toHaveCount(0);
  await expect(rotationPage.timesCorrectButton).toBeVisible();

  // ARCHIVE IT: armed, then confirmed. The confirm unmounts with the active
  // type, so focus follows the confirmation, and the dialog now views it.
  await rotationPage.archiveShiftTypeButton(name).click();
  await rotationPage.archiveShiftTypeConfirmButton(name).click();
  await expect(rotationPage.statusWith(shiftTypes.archivedDone)).toBeFocused();
  await expect(rotationPage.shiftTypeViewDialog).toBeVisible();
  await expect(rotationPage.text(shiftTypes.archivedNote)).toBeVisible();

  // Closed, the type is listed under the archived heading, with no edit link.
  await rotationPage.shiftTypeCloseButton.click();
  await expect(page).toHaveURL('/postavke-rotacije');
  await expect(rotationPage.archivedShiftTypeRow(name)).toBeVisible();
  await expect(rotationPage.shiftTypeEditLink(name)).toHaveCount(0);
});

/** A `YYYY-MM-DD` date `days` days from `date`, by UTC arithmetic. */
function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);

  return instant.toISOString().slice(0, 10);
}

test('a change saved over three overrides lists them for review; one is confirmed, one amended, one discarded', async ({
  fixture,
  rotationPage,
  calendarPage,
}) => {
  // STORY 3.5c. The fixture team gets a rotation from today in SQL, and three
  // overrides on D+3..D+5 written after it; the builder then saves a change
  // from D+1, which leaves all three pending. Everything seeded names the
  // seed's own types, so the `afterEach` removes it whatever happens.
  test.slow();
  hold = holdRotation(fixture.slug);
  await hold.ready;
  seededSince = await databaseNow();
  seed = await seedTeamRotation(fixture.slug, fixture.team.id, randomBytes(3).toString('hex'));
  const rotation = seed;
  const team = fixture.team.name;
  const [confirmed, amended, discarded] = [3, 4, 5].map((days) => addDays(rotation.today, days)) as [
    string,
    string,
    string,
  ];
  const reason = 'Zamjena zbog vježbe (E2E).';
  for (const date of [confirmed, amended, discarded]) {
    await seedShiftTypeOverride(rotation, fixture.team.id, date, 1, reason);
  }
  const overrides = builder.overrides;

  // Nothing waits before the change: the review is absent.
  await rotationPage.goto();
  await expect(rotationPage.effectiveFromInput).toBeVisible();
  await expect(rotationPage.overrideReview).toHaveCount(0);

  // A CHANGE FROM D+1: one more step, from tomorrow. The save writes no
  // override; its confirmation counts the three left pending.
  await rotationPage.newStepSelect.selectOption({ label: rotation.steps[0] });
  await rotationPage.addStepButton.click();
  await rotationPage.effectiveFromInput.fill(addDays(rotation.today, 1));
  await rotationPage.saveButton.click();
  await expect(rotationPage.savedConfirmation).toContainText(fewForm(overrides.count, 3));
  await expect(rotationPage.overrideReviewRows).toHaveCount(3);
  for (const date of [confirmed, amended, discarded]) {
    const row = rotationPage.overrideReviewRow(team, shownDate(date));
    await expect(row, date).toHaveCount(1);
    await expect(row).toContainText(fill(overrides.type, { type: rotation.steps[1] }));
    await expect(row).toContainText(fill(overrides.reason, { reason }));
    await expect(row).toContainText(fill(overrides.author, { name: fixture.admin.name }));
  }

  // CONFIRM: the row leaves the review.
  await rotationPage.confirmOverrideIn(rotationPage.overrideReviewRow(team, shownDate(confirmed))).click();
  await expect(rotationPage.statusWith(overrides.done.confirmed)).toBeVisible();
  await expect(rotationPage.overrideReviewRows).toHaveCount(2);

  // AMEND: a new type and reason, in a dialog; the old row is replaced.
  await rotationPage.amendOverrideIn(rotationPage.overrideReviewRow(team, shownDate(amended))).click();
  const amend = rotationPage.amendDialogOf(team, shownDate(amended));
  await expect(amend).toBeVisible();
  const offered = await rotationPage.amendTypeNamesIn(amend);
  // It opens on the override's own reason, and its own type where it may be chosen.
  await expect(rotationPage.amendReasonIn(amend)).toHaveValue(reason);
  if (offered.includes(rotation.steps[1])) {
    await expect(rotationPage.amendTypeIn(amend).locator('option:checked')).toHaveText(rotation.steps[1]);
  }
  const worked = rotation.steps.find((name) => offered.includes(name));
  expect(worked, 'the amend offers none of the seeded types').toBeDefined();
  await rotationPage.amendOverride(amend, worked ?? '', 'Izmjena nakon promjene (E2E).');
  await expect(amend).toHaveCount(0);
  await expect(rotationPage.statusWith(overrides.done.amended)).toBeVisible();
  await expect(rotationPage.overrideReviewRows).toHaveCount(1);

  // DISCARD: one neutral confirmation naming the team and the date.
  await rotationPage.discardOverrideIn(rotationPage.overrideReviewRow(team, shownDate(discarded))).click();
  const confirm = rotationPage.dialog();
  await expect(confirm).toContainText(`${team} · ${shownDate(discarded)}`);
  await expect(confirm.locator('.bg-destructive, .text-destructive, .border-destructive')).toHaveCount(0);
  await rotationPage.confirmDiscardIn(confirm).click();
  await expect(rotationPage.statusWith(overrides.done.discarded)).toBeVisible();
  await expect(rotationPage.overrideReview).toHaveCount(0);

  // THE CALENDAR follows: the confirmed and the amended are applied (✎),
  // the discarded is gone.
  for (const [date, marked] of [
    [confirmed, true],
    [amended, true],
    [discarded, false],
  ] as const) {
    await calendarPage.goto(`?prikaz=sve&mjesec=${date.slice(0, 7)}`);
    const cell = await calendarPage.cellOf(team, date);
    if (marked) await expect(cell, date).toContainText('\u270E');
    else await expect(cell, date).not.toContainText('\u270E');
  }
});
