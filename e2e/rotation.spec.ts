import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import { holdRotation, type RotationHold } from './support/database.ts';
import { ADMIN_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { addShiftType, previewCell } from './support/rotation.ts';
import { expect, test } from './support/test.ts';

test.use({ storageState: ADMIN_STATE });

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;

test.afterEach(async () => {
  await hold?.release();
  hold = null;
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
 * A real mouse drag: press on the handle, move past dnd-kit's activation
 * distance, glide onto the target row's centre, release.
 */
async function dragOnto(page: Page, handle: Locator, target: Locator): Promise<void> {
  // Centred first, so the drag stays clear of the viewport edge where
  // dnd-kit's auto-scroll would move the page under the pointer.
  await handle.evaluate((element) => {
    element.scrollIntoView({ block: 'center' });
  });
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('E2E: the drag has nothing to hold or nowhere to go');

  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 10, { steps: 5 });
  await page.mouse.move(start.x, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
}

/** What dnd-kit's live region says — every word of it from `hr.json`. */
function announced(page: Page, message: string): Locator {
  return page.getByText(message, { exact: true });
}

/**
 * One macrotask in the page. dnd-kit's keyboard sensor starts listening for
 * the arrows in a `setTimeout` after the lift, so a key pressed before that
 * timer has run is lost — which happens under a loaded, parallel run. A
 * zero-delay timer queued now runs after dnd-kit's; nothing is waited on by
 * the clock.
 */
async function afterPendingTimers(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      }),
  );
}

/**
 * The keyboard path: focus the handle, space lifts (announced), one arrow
 * moves (announced), space drops (announced) — each awaited, since dnd-kit
 * starts listening for the arrows only once the lift has rendered.
 */
async function keyboardMove(
  page: Page,
  handle: Locator,
  from: number,
  arrow: 'ArrowUp' | 'ArrowDown',
  to: number,
): Promise<void> {
  const positions = { from: String(from), to: String(to) };

  await handle.focus();
  await page.keyboard.press('Space');
  await expect(announced(page, fill(builder.drag.lifted, { position: String(from) }))).toBeAttached();
  await afterPendingTimers(page);
  await page.keyboard.press(arrow);
  await expect(announced(page, fill(builder.drag.over, positions))).toBeAttached();
  await page.keyboard.press('Space');
  await expect(announced(page, fill(builder.drag.dropped, positions))).toBeAttached();
}

test('an admin builds a rotation, sees its figures and cycle, saves it, and it opens as the rotation in force', async ({
  page,
  fixture,
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

  await page.goto('/ljudi/smjene');
  await page.getByRole('button', { name: hr.smjene.open }).click();
  await page.getByLabel(hr.smjene.name, { exact: true }).fill(teamName);
  await page.getByRole('button', { name: hr.smjene.add }).click();
  await expect(page.getByRole('status')).toHaveText(hr.smjene.created);

  await page.goto('/postavke-rotacije');
  await addShiftType(page, a, ['07:00', '19:00']);
  await addShiftType(page, b, ['19:00', '07:00']);
  await addShiftType(page, off, null);

  // Build [A, B, Slob].
  const newStep = page.getByLabel(builder.newStep, { exact: true });
  for (const name of [a, b, off]) {
    await newStep.selectOption({ label: name });
    await page.getByRole('button', { name: builder.addStep }).click();
  }
  const steps = page.getByRole('list', { name: builder.stepsCaption }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  for (const [index, name] of [a, b, off].entries()) await expect(steps.nth(index)).toContainText(name);

  // THE STEP CONTROLS, by drag. The team — on step 1, A, like every team of
  // an empty draft — follows its step wherever it goes.
  const teamStep = page.getByLabel(fill(builder.offsetOf, { name: teamName }), { exact: true });
  const handle = (position: number) =>
    page.getByRole('button', { name: fill(builder.drag.handle, { position: String(position) }), exact: true });
  await expect(teamStep).toHaveValue('0');

  // By MOUSE: step 1's handle dragged onto step 2 → [B, A, Slob].
  await dragOnto(page, handle(1), steps.nth(1));
  for (const [index, name] of [b, a, off].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(teamStep).toHaveValue('1');
  await expect(await previewCell(page, teamName, 0)).toContainText(a);

  // By KEYBOARD: step 3's handle, space, up, space → [B, Slob, A], and focus
  // stays on the moved step's handle, now step 2.
  await keyboardMove(page, handle(3), 3, 'ArrowUp', 2);
  for (const [index, name] of [b, off, a].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(handle(2)).toBeFocused();
  await expect(teamStep).toHaveValue('2');
  await expect(await previewCell(page, teamName, 0)).toContainText(a);
  await expect(await previewCell(page, teamName, 1)).toContainText(b);

  // Escape cancels a lifted step: nothing moves.
  await handle(1).focus();
  await page.keyboard.press('Space');
  await expect(announced(page, fill(builder.drag.lifted, { position: '1' }))).toBeAttached();
  await afterPendingTimers(page);
  await page.keyboard.press('ArrowDown');
  await expect(announced(page, fill(builder.drag.over, { from: '1', to: '2' }))).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(announced(page, fill(builder.drag.cancelled, { position: '1' }))).toBeAttached();
  for (const [index, name] of [b, off, a].entries()) await expect(steps.nth(index)).toContainText(name);

  // Step 2 removed → [B, A]. Anchored today, the team works A today, B tomorrow.
  await page.getByRole('button', { name: fill(builder.remove, { position: '2' }), exact: true }).click();
  await expect(steps).toHaveCount(2);
  for (const [index, name] of [b, a].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(teamStep).toHaveValue('1');
  await expect(await previewCell(page, teamName, 0)).toContainText(a);
  await expect(await previewCell(page, teamName, 1)).toContainText(b);

  // THE ANCHOR. One day later, the team stands on A tomorrow, so on B today.
  const anchor = page.getByLabel(builder.anchor, { exact: true });
  const today = await anchor.inputValue();
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  await anchor.fill(tomorrow.toISOString().slice(0, 10));
  await expect(await previewCell(page, teamName, 0)).toContainText(b);
  await anchor.fill(today);
  await expect(await previewCell(page, teamName, 0)).toContainText(a);

  // Back to [A, B, Slob]: step 2 lifted up by keyboard, then Slob added again.
  await keyboardMove(page, handle(2), 2, 'ArrowUp', 1);
  for (const [index, name] of [a, b].entries()) await expect(steps.nth(index)).toContainText(name);
  await newStep.selectOption({ label: off });
  await page.getByRole('button', { name: builder.addStep }).click();
  await expect(steps).toHaveCount(3);
  for (const [index, name] of [a, b, off].entries()) await expect(steps.nth(index)).toContainText(name);

  // The figures: 3 dana · 2 · 24 h.
  await expect(page.getByText(fewForm(builder.cycleLength, 3), { exact: true })).toBeVisible();
  await expect(page.getByText(builder.workingStepsLabel, { exact: true }).locator('..')).toContainText('2');
  await expect(page.getByText(builder.cycleHoursLabel, { exact: true }).locator('..')).toContainText(
    fill(shiftTypes.duration.hours, { hours: '24' }),
  );

  // RASPOREDI RAVNOMJERNO. The run's own teams — the fixture's and this
  // attempt's — both put on step 2, then spread: team i of n on 3 steps lands
  // on floor(i * 3 / n) while n <= 3, else on i wrapped by 3, in the order the
  // offsets list them.
  const bothOnStep2 = fill(builder.stepOption, { position: '2', name: b });
  for (const name of [fixture.team.name, teamName]) {
    await page.getByLabel(fill(builder.offsetOf, { name }), { exact: true }).selectOption({ label: bothOnStep2 });
  }
  await expect(page.getByLabel(fill(builder.offsetOf, { name: fixture.team.name }), { exact: true })).toHaveValue('1');
  await expect(teamStep).toHaveValue('1');
  await page.getByRole('button', { name: builder.spread, exact: true }).click();
  const offsets = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: builder.columnOffset, exact: true }),
  });
  // Every body row's first cell is its team's name, in the list's order.
  const bodyRows = offsets.getByRole('row').filter({ has: page.getByRole('cell') });
  const teamNames: string[] = [];
  for (const row of await bodyRows.all()) {
    teamNames.push(((await row.getByRole('cell').first().textContent()) ?? '').trim());
  }
  const listed = teamNames.length;
  for (const [index, name] of teamNames.entries()) {
    const expected = listed <= 3 ? Math.floor((index * 3) / listed) : index - Math.floor(index / 3) * 3;
    await expect(page.getByLabel(fill(builder.offsetOf, { name }), { exact: true })).toHaveValue(String(expected));
  }
  expect(teamNames).toEqual(expect.arrayContaining([fixture.team.name, teamName]));

  // The team made for this attempt on step 2, anchored today: B, Slob, A.
  await page
    .getByLabel(fill(builder.offsetOf, { name: teamName }), { exact: true })
    .selectOption({ label: fill(builder.stepOption, { position: '2', name: b }) });
  for (const [row, name] of [b, off, a].entries()) {
    await expect(await previewCell(page, teamName, row)).toContainText(name);
  }

  // A RENAME in the type's edit dialog, BEFORE saving: the dialog's route
  // remounts the builder, and the unsaved draft — kept outside it — is
  // intact when the dialog closes, with the new name and no reload.
  const renamed = `Odmor ${suffix}`;
  await page.getByRole('link', { name: fill(shiftTypes.edit, { name: off }) }).click();
  // By role, so the closed add dialog's hidden field of the same label is not matched.
  await page.getByRole('textbox', { name: shiftTypes.name, exact: true }).fill(renamed);
  await page.getByRole('button', { name: shiftTypes.save, exact: true }).click();
  await expect(page.getByText(shiftTypes.renamed, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: shiftTypes.close, exact: true }).click();
  await expect(page).toHaveURL('/postavke-rotacije');
  await expect(steps).toHaveCount(3);
  for (const [index, name] of [a, b, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(teamStep).toHaveValue('1');
  for (const [row, name] of [b, renamed, a].entries()) {
    await expect(await previewCell(page, teamName, row)).toContainText(name);
  }

  await page.getByRole('button', { name: builder.save }).click();
  await expect(page.getByText(builder.saved, { exact: true })).toBeVisible();

  // Reloaded, the builder opens as the rotation now in force, anchored on
  // the organization's today (the prefill's anchor is always today).
  await page.reload();
  await expect(steps).toHaveCount(3);
  await expect(anchor).toHaveValue(today);
  for (const [index, name] of [a, b, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
  await expect(page.getByLabel(fill(builder.offsetOf, { name: teamName }), { exact: true })).toHaveValue('1');
  for (const [row, name] of [b, renamed, a].entries()) {
    await expect(await previewCell(page, teamName, row)).toContainText(name);
  }

  // And saving it again unchanged is refused before anything is sent.
  await page.getByRole('button', { name: builder.save }).click();
  await expect(page.getByText(builder.error.unchanged, { exact: true })).toBeVisible();

  // TWO CYCLES in the preview: twice the cycle's dates, `Dan N` restarting,
  // the second cycle named over its first day. A view choice only.
  await page
    .getByLabel(builder.previewCycles, { exact: true })
    .selectOption({ label: fewForm(builder.cycleCount, 2) });
  const preview = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: fill(builder.dayNumber, { day: '1' }) }),
  });
  // The team column, then 2 × 3 dates.
  await expect(preview.getByRole('columnheader')).toHaveCount(1 + 2 * 3);
  await expect(preview.getByRole('columnheader', { name: fill(builder.cycleLabel, { cycle: '2' }) })).toHaveCount(1);
  await expect(await previewCell(page, teamName, 3)).toContainText(b);
});

/** An ICU message with its `{count, plural, …}` block replaced by the filled `few` form — `3 dana …`. */
function withFewCount(message: string, count: number): string {
  return message.replace(/\{count, plural, [\s\S]*?other \{[^}]*\}\}/, fewForm(message, count));
}

test('a saved rotation reports its coverage gap, duplicate and rest gap, and an edit clears them', async ({
  page,
  fixture,
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

  await page.goto('/ljudi/smjene');
  await page.getByRole('button', { name: hr.smjene.open }).click();
  await page.getByLabel(hr.smjene.name, { exact: true }).fill(teamName);
  await page.getByRole('button', { name: hr.smjene.add }).click();
  await expect(page.getByRole('status')).toHaveText(hr.smjene.created);

  await page.goto('/postavke-rotacije');
  await addShiftType(page, a, ['07:00', '19:00']);
  await addShiftType(page, b, ['19:00', '07:00']);
  await addShiftType(page, off, null);

  // [A, B, Slob], and every team — the fixture's and this attempt's, at least
  // two — on step 1, as an empty draft starts them.
  const newStep = page.getByLabel(builder.newStep, { exact: true });
  for (const name of [a, b, off]) {
    await newStep.selectOption({ label: name });
    await page.getByRole('button', { name: builder.addStep }).click();
  }
  const steps = page.getByRole('list', { name: builder.stepsCaption }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  for (const name of [fixture.team.name, teamName]) {
    await expect(page.getByLabel(fill(builder.offsetOf, { name }), { exact: true })).toHaveValue('0');
  }

  // Saved, never blocked: the confirmation carries the warnings. Over the
  // next cycle every team works A, then B, then is free — so B is uncovered
  // on day 1, A on day 2, both on day 3; A is doubled on day 1 and B on day
  // 2; and A → B is 24 h of work with no free day between.
  await page.getByRole('button', { name: builder.save }).click();
  const confirmation = page.getByRole('status').filter({ hasText: builder.saved });
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
  await expect(confirmation.getByRole('listitem')).toHaveCount(3 + 3 + 2);

  // The next edit clears them with the confirmation: the builder re-opened
  // as the rotation now in force, and a step removed from it.
  await expect(steps).toHaveCount(3);
  await page.getByRole('button', { name: fill(builder.remove, { position: '3' }), exact: true }).click();
  await expect(steps).toHaveCount(2);
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText(withFewCount(warnings.coverageGap, 3))).toHaveCount(0);

  // And a reload shows none: warnings are never standing.
  await page.reload();
  await expect(steps).toHaveCount(3);
  await expect(page.getByText(builder.saved, { exact: true })).toHaveCount(0);
  await expect(page.getByText(withFewCount(warnings.summary, 3))).toHaveCount(0);
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
  page,
  fixture,
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

  await page.goto('/postavke-rotacije');
  await addShiftType(page, a, ['07:00', '19:00']);
  await addShiftType(page, off, null);

  const newStep = page.getByLabel(builder.newStep, { exact: true });
  const steps = page.getByRole('list', { name: builder.stepsCaption }).getByRole('listitem');
  const before = await steps.count();
  for (const name of [a, off]) {
    await newStep.selectOption({ label: name });
    await page.getByRole('button', { name: builder.addStep }).click();
  }
  await expect(steps).toHaveCount(before + 2);

  // `Vrijedi od` opens on today; the anchor stays where it was when it moves.
  const effective = page.getByLabel(builder.effectiveFrom, { exact: true });
  const anchor = page.getByLabel(builder.anchor, { exact: true });
  await expect(effective).toHaveValue(organizationDate(0));
  const anchored = await anchor.inputValue();
  await effective.fill(tomorrow);
  await expect(anchor).toHaveValue(anchored);
  // The preview starts on the effective date: its first date column is tomorrow.
  const preview = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: fill(builder.dayNumber, { day: '1' }) }),
  });
  await expect(preview.getByRole('columnheader').nth(1)).toContainText(shownDate(tomorrow).slice(0, 6));

  await page.getByRole('button', { name: builder.save }).click();
  await expect(page.getByRole('status').filter({ hasText: builder.saved })).toBeVisible();

  // The history names the change: from tomorrow, scheduled, by the admin.
  const table = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: history.columnSaved }),
  });
  const scheduledRow = table.getByRole('row').filter({ hasText: shownDate(tomorrow) });
  await expect(scheduledRow).toHaveCount(1);
  await expect(scheduledRow).toContainText(history.status.scheduled);
  await expect(scheduledRow).toContainText(fixture.admin.name);

  // A second change is refused while that one is scheduled; the cancel is
  // offered beside the refusal.
  await newStep.selectOption({ label: a });
  await page.getByRole('button', { name: builder.addStep }).click();
  await page.getByRole('button', { name: builder.save }).click();
  const refusal = page.getByRole('alert').filter({ hasText: builder.error.scheduled });
  await expect(refusal).toBeVisible();
  await refusal
    .getByRole('button', { name: fill(builder.cancelScheduled.offer, { date: shownDate(tomorrow) }) })
    .click();

  // Confirmed in a dialog, then gone: the history no longer lists it.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(fill(builder.cancelScheduled.prompt, { date: shownDate(tomorrow) }));
  await dialog.getByRole('button', { name: builder.cancelScheduled.confirm }).click();
  await expect(page.getByRole('status').filter({ hasText: builder.cancelScheduled.done })).toBeVisible();
  await expect(table.getByRole('row').filter({ hasText: shownDate(tomorrow) })).toHaveCount(0);
  await expect(refusal).toHaveCount(0);
});
