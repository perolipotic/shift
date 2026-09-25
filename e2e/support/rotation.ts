import type { Locator, Page } from '@playwright/test';

import { fill, hr } from './i18n.ts';
import { expect } from './test.ts';

/**
 * The rotation screen's shared steps, for the desktop builder spec and the
 * phone stepper spec alike.
 */

const builder = hr.rotation.builder;
const shiftTypes = hr.rotation.shiftTypes;

/** Adds a shift type through its dialog: working with its times, or non-working with `null`. */
export async function addShiftType(page: Page, name: string, times: readonly [string, string] | null) {
  await page.getByRole('button', { name: shiftTypes.open }).click();
  await page.getByLabel(shiftTypes.name, { exact: true }).fill(name);
  if (times === null) {
    await page.getByLabel(shiftTypes.kind, { exact: true }).selectOption({ label: shiftTypes.nonworking });
  } else {
    await page.getByLabel(shiftTypes.start, { exact: true }).fill(times[0]);
    await page.getByLabel(shiftTypes.end, { exact: true }).fill(times[1]);
  }
  await page.getByRole('button', { name: shiftTypes.add }).click();
  await expect(page.getByText(shiftTypes.created, { exact: true })).toBeVisible();
}

/**
 * The cell one team works in on the `day`-th date (0 = today) of the
 * transposed preview: teams are rows (the team's name in the first cell),
 * dates are columns (headed `Dan N`).
 */
export async function previewCell(page: Page, teamName: string, day: number): Promise<Locator> {
  const table = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: fill(builder.dayNumber, { day: '1' }) }),
  });
  const row = table.getByRole('row').filter({ has: page.getByRole('cell', { name: teamName, exact: true }) });
  await expect(row, `the preview has no row for ${teamName}`).toHaveCount(1);

  return row.getByRole('cell').nth(day + 1);
}

const stepper = builder.stepper;

/** The phone stepper's four step names, in order. */
export const STEP_NAMES = [
  stepper.step.types,
  stepper.step.pattern,
  stepper.step.offsets,
  stepper.step.preview,
] as const;

/** Dalje's label on steps 1–3, naming the step it leads to. */
export const NEXT_LABELS = [stepper.next.pattern, stepper.next.offsets, stepper.next.preview] as const;

/** The heading each step's section carries, in order. */
export const STEP_HEADINGS = [
  shiftTypes.heading,
  builder.patternHeading,
  builder.offsetsHeading,
  builder.previewHeading,
] as const;

/** The progress line above the bar: `Korak N od 4`. */
export function stepProgress(page: Page, step: number): Locator {
  return page.getByText(fill(stepper.progress, { current: String(step), total: '4' }), { exact: true });
}

/** The step bar. */
export function stepBar(page: Page): Locator {
  return page.getByRole('navigation', { name: stepper.label });
}

/** One step's button in the bar, by its name. */
export function stepButton(page: Page, step: number): Locator {
  const name = STEP_NAMES[step - 1];
  if (name === undefined) throw new Error(`E2E: no step ${step}`);

  return stepBar(page).getByRole('button', { name: new RegExp(name) });
}
