import { randomBytes } from 'node:crypto';

import { holdRotation, type RotationHold } from './support/database.ts';
import { ADMIN_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import {
  NEXT_LABELS,
  STEP_HEADINGS,
  addShiftType,
  previewCell,
  stepBar,
  stepButton,
  stepProgress,
} from './support/rotation.ts';
import { expect, test } from './support/test.ts';

/**
 * Story 2.4: the rotation configured end to end on a phone. Below 640 px the
 * four sections are one stepper (1 Tipovi, 2 Uzorak, 3 Pomaci, 4 Pregled); from
 * 640 px up it is the 2.3b panel, with no stepper at all.
 */

test.use({ storageState: ADMIN_STATE });

const builder = hr.rotation.builder;
const stepper = builder.stepper;

/** The run organization's rotation, while the phone test holds it (`holdRotation`). */
let hold: RotationHold | null = null;

test.afterEach(async () => {
  await hold?.release();
  hold = null;
});

test.describe('at 390 px, on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('an admin walks the four steps, goes back through the bar, builds, saves from the header and sees the prefill', async ({
    page,
    fixture,
  }) => {
    // THE ROTATION IS THIS TEST'S ALONE while it runs: a save binds every
    // active team, and the desktop builder spec saves one too.
    test.slow();
    hold = holdRotation(fixture.slug);
    await hold.ready;

    const suffix = randomBytes(3).toString('hex');
    const teamName = `Smjena ${suffix}`;
    const work = `Dnevna ${suffix}`;
    const off = `Slobodno ${suffix}`;

    await page.goto('/ljudi/smjene');
    await page.getByRole('button', { name: hr.smjene.open }).click();
    await page.getByLabel(hr.smjene.name, { exact: true }).fill(teamName);
    await page.getByRole('button', { name: hr.smjene.add }).click();
    await expect(page.getByRole('status')).toHaveText(hr.smjene.created);

    await page.goto('/postavke-rotacije');

    // STEP 1: only Tipovi, current; the other three disabled; no Natrag. A
    // mount never moves focus to the progress line.
    await expect(stepProgress(page, 1)).toBeVisible();
    await expect(stepProgress(page, 1)).not.toBeFocused();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[0], exact: true })).toBeVisible();
    for (const heading of STEP_HEADINGS.slice(1)) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeHidden();
    }
    await expect(stepButton(page, 1)).toHaveAttribute('aria-current', 'step');
    await expect(stepButton(page, 1)).toBeEnabled();
    for (const step of [2, 3, 4]) await expect(stepButton(page, step)).toBeDisabled();
    await expect(page.getByRole('button', { name: stepper.back, exact: true })).toHaveCount(0);

    // A tap on the current step changes nothing, and moves no focus.
    await stepButton(page, 1).tap();
    await expect(stepProgress(page, 1)).toBeVisible();
    await expect(stepProgress(page, 1)).not.toBeFocused();

    // The types this attempt builds with, added on step 1.
    await addShiftType(page, work, ['07:00', '19:00']);
    await addShiftType(page, off, null);

    // STEP 2, with the pattern still empty — Dalje is never held back.
    await page.getByRole('button', { name: NEXT_LABELS[0], exact: true }).tap();
    await expect(stepProgress(page, 2)).toBeFocused();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[1], exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[0], exact: true })).toBeHidden();
    await expect(page.getByText(builder.patternEmpty, { exact: true })).toBeVisible();

    // STEP 3 over an empty pattern: the existing note says why there is no offset yet.
    await page.getByRole('button', { name: NEXT_LABELS[1], exact: true }).tap();
    await expect(stepProgress(page, 3)).toBeFocused();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[2], exact: true })).toBeVisible();
    await expect(page.getByText(builder.offsetsEmpty, { exact: true })).toBeVisible();

    // The bar: 1 and 2 done — a check and "završeno", not colour alone — 3
    // current, and 4 not reached, so a forward jump to it does nothing.
    for (const step of [1, 2]) {
      await expect(stepButton(page, step)).toBeEnabled();
      await expect(stepButton(page, step)).toHaveAccessibleName(new RegExp(stepper.done));
      await expect(stepButton(page, step)).not.toHaveAttribute('aria-current', 'step');
    }
    await expect(stepButton(page, 3)).toHaveAttribute('aria-current', 'step');
    await expect(stepButton(page, 4)).toBeDisabled();

    // BACK THROUGH THE BAR to Uzorak; Pomaci stays openable (reached 3).
    await stepButton(page, 2).tap();
    await expect(stepProgress(page, 2)).toBeFocused();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[1], exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[2], exact: true })).toBeHidden();
    await expect(stepButton(page, 3)).toBeEnabled();
    await expect(stepButton(page, 4)).toBeDisabled();

    // Build [work, off].
    const newStep = page.getByLabel(builder.newStep, { exact: true });
    for (const name of [work, off]) {
      await newStep.selectOption({ label: name });
      await page.getByRole('button', { name: builder.addStep }).tap();
    }
    const steps = page.getByRole('list', { name: builder.stepsCaption }).getByRole('listitem');
    await expect(steps).toHaveCount(2);
    for (const [index, name] of [work, off].entries()) await expect(steps.nth(index)).toContainText(name);

    // Forward through the bar to the step already reached: this attempt's
    // team stands on step 1 (the work type) on the anchor, today.
    await stepButton(page, 3).tap();
    await expect(stepProgress(page, 3)).toBeFocused();
    const teamStep = page.getByLabel(fill(builder.offsetOf, { name: teamName }), { exact: true });
    await expect(teamStep).toBeVisible();
    await expect(teamStep).toHaveValue('0');

    // STEP 4: the preview; Natrag, and no Dalje past the last step.
    await page.getByRole('button', { name: NEXT_LABELS[2], exact: true }).tap();
    await expect(stepProgress(page, 4)).toBeFocused();
    await expect(page.getByRole('heading', { name: STEP_HEADINGS[3], exact: true })).toBeVisible();
    for (const label of NEXT_LABELS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
    await expect(await previewCell(page, teamName, 0)).toContainText(work);
    await expect(await previewCell(page, teamName, 1)).toContainText(off);

    // Natrag goes one step back, and Dalje returns.
    await page.getByRole('button', { name: stepper.back, exact: true }).tap();
    await expect(stepProgress(page, 3)).toBeFocused();
    await page.getByRole('button', { name: NEXT_LABELS[2], exact: true }).tap();
    await expect(stepProgress(page, 4)).toBeFocused();

    // THE SHIFT TYPE DIALOG'S REMOUNT, from step 1: a rename saved in the
    // type's dialog, which remounts the section; closed, the stepper is still
    // on step 1 with everything it reached, and the draft is kept with the new
    // name. (The rename also refreshes the rotation's read, so the save below
    // binds every team the run's organization has by now.)
    const renamed = `Odmor ${suffix}`;
    await stepButton(page, 1).tap();
    await expect(stepProgress(page, 1)).toBeFocused();
    await page.getByRole('link', { name: fill(hr.rotation.shiftTypes.edit, { name: off }) }).tap();
    await page.getByRole('textbox', { name: hr.rotation.shiftTypes.name, exact: true }).fill(renamed);
    await page.getByRole('button', { name: hr.rotation.shiftTypes.save, exact: true }).tap();
    await expect(page.getByText(hr.rotation.shiftTypes.renamed, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: hr.rotation.shiftTypes.close, exact: true }).tap();
    await expect(page).toHaveURL('/postavke-rotacije');
    await expect(stepProgress(page, 1)).toBeVisible();
    await expect(stepProgress(page, 1)).not.toBeFocused();
    await expect(stepButton(page, 1)).toHaveAttribute('aria-current', 'step');
    for (const step of [2, 3, 4]) await expect(stepButton(page, step)).toBeEnabled();
    await stepButton(page, 2).tap();
    await expect(steps).toHaveCount(2);
    for (const [index, name] of [work, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
    await stepButton(page, 4).tap();
    await expect(stepProgress(page, 4)).toBeFocused();

    // SAVE FROM THE HEADER, on step 4; the outcome sits under the header.
    await page.getByRole('button', { name: builder.save }).tap();
    await expect(page.getByText(builder.saved, { exact: true })).toBeVisible();

    // THE PREFILL: a landed save re-opens the builder as the rotation now in
    // force, on the step it was saved from. Walked back through the bar, it
    // is the pattern and the offset just saved. Checked in this tab rather
    // than after a reload: a team another spec adds to the run's
    // organization after the save has no assignment, which empties a
    // freshly read prefill (mixed patterns) — a race this test does not own.
    await expect(stepButton(page, 4)).toHaveAttribute('aria-current', 'step');
    await stepButton(page, 2).tap();
    await expect(steps).toHaveCount(2);
    for (const [index, name] of [work, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
    await stepButton(page, 3).tap();
    await expect(teamStep).toHaveValue('0');

    // Saved again unchanged, from step 3: refused under the header — the
    // shown draft IS the rotation in force — and the step and the draft stay
    // as they were.
    await page.getByRole('button', { name: builder.save }).tap();
    await expect(page.getByText(builder.error.unchanged, { exact: true })).toBeVisible();
    await expect(stepButton(page, 3)).toHaveAttribute('aria-current', 'step');
    await expect(teamStep).toHaveValue('0');

    // A new tab's stepper opens on step 1 again, with nothing reached.
    await page.reload();
    await expect(stepProgress(page, 1)).toBeVisible();
    for (const step of [2, 3, 4]) await expect(stepButton(page, step)).toBeDisabled();
  });
});

test.describe('at desktop width', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('there is no stepper, and all four sections show', async ({ page }) => {
    await page.goto('/postavke-rotacije');

    for (const heading of STEP_HEADINGS) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    await expect(stepBar(page)).toBeHidden();
    await expect(stepProgress(page, 1)).toBeHidden();
    await expect(page.getByRole('button', { name: stepper.back, exact: true })).toBeHidden();
    for (const label of NEXT_LABELS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeHidden();
    }
  });
});
