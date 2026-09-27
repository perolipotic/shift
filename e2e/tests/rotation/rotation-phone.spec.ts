import { randomBytes } from 'node:crypto';

import { holdRotation, type RotationHold } from '../../utils/database-helper.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { NEXT_LABELS, STEP_HEADINGS } from '../../utils/rotation.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

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
    rotationPage,
    teamsPage,
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

    await teamsPage.goto();
    await teamsPage.addTeam(teamName);
    await expect(teamsPage.status).toHaveText(hr.smjene.created);

    await rotationPage.goto();

    // STEP 1: only Tipovi, current; the other three disabled; no Natrag. A
    // mount never moves focus to the progress line.
    await expect(rotationPage.stepProgress(1)).toBeVisible();
    await expect(rotationPage.stepProgress(1)).not.toBeFocused();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[0])).toBeVisible();
    for (const heading of STEP_HEADINGS.slice(1)) {
      await expect(rotationPage.sectionHeading(heading)).toBeHidden();
    }
    await expect(rotationPage.stepButton(1)).toHaveAttribute('aria-current', 'step');
    await expect(rotationPage.stepButton(1)).toBeEnabled();
    for (const step of [2, 3, 4]) await expect(rotationPage.stepButton(step)).toBeDisabled();
    await expect(rotationPage.backButton).toHaveCount(0);

    // A tap on the current step changes nothing, and moves no focus.
    await rotationPage.stepButton(1).tap();
    await expect(rotationPage.stepProgress(1)).toBeVisible();
    await expect(rotationPage.stepProgress(1)).not.toBeFocused();

    // The types this attempt builds with, added on step 1.
    await rotationPage.addShiftType(work, ['07:00', '19:00']);
    await rotationPage.addShiftType(off, null);

    // STEP 2, with the pattern still empty — Dalje is never held back.
    await rotationPage.nextButton(NEXT_LABELS[0]).tap();
    await expect(rotationPage.stepProgress(2)).toBeFocused();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[1])).toBeVisible();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[0])).toBeHidden();
    await expect(rotationPage.text(builder.patternEmpty)).toBeVisible();

    // STEP 3 over an empty pattern: the existing note says why there is no offset yet.
    await rotationPage.nextButton(NEXT_LABELS[1]).tap();
    await expect(rotationPage.stepProgress(3)).toBeFocused();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[2])).toBeVisible();
    await expect(rotationPage.text(builder.offsetsEmpty)).toBeVisible();

    // The bar: 1 and 2 done — a check and "završeno", not colour alone — 3
    // current, and 4 not reached, so a forward jump to it does nothing.
    for (const step of [1, 2]) {
      await expect(rotationPage.stepButton(step)).toBeEnabled();
      await expect(rotationPage.stepButton(step)).toHaveAccessibleName(new RegExp(stepper.done));
      await expect(rotationPage.stepButton(step)).not.toHaveAttribute('aria-current', 'step');
    }
    await expect(rotationPage.stepButton(3)).toHaveAttribute('aria-current', 'step');
    await expect(rotationPage.stepButton(4)).toBeDisabled();

    // BACK THROUGH THE BAR to Uzorak; Pomaci stays openable (reached 3).
    await rotationPage.stepButton(2).tap();
    await expect(rotationPage.stepProgress(2)).toBeFocused();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[1])).toBeVisible();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[2])).toBeHidden();
    await expect(rotationPage.stepButton(3)).toBeEnabled();
    await expect(rotationPage.stepButton(4)).toBeDisabled();

    // Build [work, off].
    const newStep = rotationPage.newStepSelect;
    for (const name of [work, off]) {
      await newStep.selectOption({ label: name });
      await rotationPage.addStepButton.tap();
    }
    const steps = rotationPage.steps;
    await expect(steps).toHaveCount(2);
    for (const [index, name] of [work, off].entries()) await expect(steps.nth(index)).toContainText(name);

    // Forward through the bar to the step already reached: this attempt's
    // team stands on step 1 (the work type) on the anchor, today.
    await rotationPage.stepButton(3).tap();
    await expect(rotationPage.stepProgress(3)).toBeFocused();
    const teamStep = rotationPage.offsetOf(teamName);
    await expect(teamStep).toBeVisible();
    await expect(teamStep).toHaveValue('0');

    // STEP 4: the preview; Natrag, and no Dalje past the last step.
    await rotationPage.nextButton(NEXT_LABELS[2]).tap();
    await expect(rotationPage.stepProgress(4)).toBeFocused();
    await expect(rotationPage.sectionHeading(STEP_HEADINGS[3])).toBeVisible();
    for (const label of NEXT_LABELS) {
      await expect(rotationPage.nextButton(label)).toHaveCount(0);
    }
    await expect(await rotationPage.previewCell(teamName, 0)).toContainText(work);
    await expect(await rotationPage.previewCell(teamName, 1)).toContainText(off);

    // Natrag goes one step back, and Dalje returns.
    await rotationPage.backButton.tap();
    await expect(rotationPage.stepProgress(3)).toBeFocused();
    await rotationPage.nextButton(NEXT_LABELS[2]).tap();
    await expect(rotationPage.stepProgress(4)).toBeFocused();

    // THE SHIFT TYPE DIALOG'S REMOUNT, from step 1: a rename saved in the
    // type's dialog, which remounts the section; closed, the stepper is still
    // on step 1 with everything it reached, and the draft is kept with the new
    // name. (The rename also refreshes the rotation's read, so the save below
    // binds every team the run's organization has by now.)
    const renamed = `Odmor ${suffix}`;
    await rotationPage.stepButton(1).tap();
    await expect(rotationPage.stepProgress(1)).toBeFocused();
    await rotationPage.shiftTypeEditLink(off).tap();
    await rotationPage.shiftTypeNameTextbox.fill(renamed);
    await rotationPage.shiftTypeSaveButton.tap();
    await expect(rotationPage.text(hr.rotation.shiftTypes.renamed)).toBeVisible();
    await rotationPage.shiftTypeCloseButton.tap();
    await expect(page).toHaveURL('/postavke-rotacije');
    await expect(rotationPage.stepProgress(1)).toBeVisible();
    await expect(rotationPage.stepProgress(1)).not.toBeFocused();
    await expect(rotationPage.stepButton(1)).toHaveAttribute('aria-current', 'step');
    for (const step of [2, 3, 4]) await expect(rotationPage.stepButton(step)).toBeEnabled();
    await rotationPage.stepButton(2).tap();
    await expect(steps).toHaveCount(2);
    for (const [index, name] of [work, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
    await rotationPage.stepButton(4).tap();
    await expect(rotationPage.stepProgress(4)).toBeFocused();

    // SAVE FROM THE HEADER, on step 4; the outcome sits under the header.
    await rotationPage.saveButton.tap();
    await expect(rotationPage.text(builder.saved)).toBeVisible();

    // THE PREFILL: a landed save re-opens the builder as the rotation now in
    // force, on the step it was saved from. Walked back through the bar, it
    // is the pattern and the offset just saved. Checked in this tab rather
    // than after a reload: a team another spec adds to the run's
    // organization after the save has no assignment, which empties a
    // freshly read prefill (mixed patterns) — a race this test does not own.
    await expect(rotationPage.stepButton(4)).toHaveAttribute('aria-current', 'step');
    await rotationPage.stepButton(2).tap();
    await expect(steps).toHaveCount(2);
    for (const [index, name] of [work, renamed].entries()) await expect(steps.nth(index)).toContainText(name);
    await rotationPage.stepButton(3).tap();
    await expect(teamStep).toHaveValue('0');

    // Saved again unchanged, from step 3: refused under the header — the
    // shown draft IS the rotation in force — and the step and the draft stay
    // as they were.
    await rotationPage.saveButton.tap();
    await expect(rotationPage.text(builder.error.unchanged)).toBeVisible();
    await expect(rotationPage.stepButton(3)).toHaveAttribute('aria-current', 'step');
    await expect(teamStep).toHaveValue('0');

    // A new tab's stepper opens on step 1 again, with nothing reached.
    await page.reload();
    await expect(rotationPage.stepProgress(1)).toBeVisible();
    for (const step of [2, 3, 4]) await expect(rotationPage.stepButton(step)).toBeDisabled();
  });
});

test.describe('at desktop width', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('there is no stepper, and all four sections show', async ({ rotationPage }) => {
    await rotationPage.goto();

    for (const heading of STEP_HEADINGS) {
      await expect(rotationPage.sectionHeading(heading)).toBeVisible();
    }
    await expect(rotationPage.stepBar).toBeHidden();
    await expect(rotationPage.stepProgress(1)).toBeHidden();
    await expect(rotationPage.backButton).toBeHidden();
    for (const label of NEXT_LABELS) {
      await expect(rotationPage.nextButton(label)).toBeHidden();
    }
  });
});
