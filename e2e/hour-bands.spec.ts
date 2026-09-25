import { randomBytes } from 'node:crypto';

import { ADMIN_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { expect, firstBand, test } from './support/test.ts';

test.use({ storageState: ADMIN_STATE });

const bands = hr.organization.hourBands;

test('the hour band list shows the fixture bands', async ({ page, fixture }) => {
  await page.goto('/organizacija/satni-pojasi');

  await expect(page.getByRole('heading', { level: 1, name: bands.heading })).toBeVisible();
  for (const band of fixture.bands) {
    await expect(page.getByRole('link', { name: fill(bands.edit, { name: band.name }) })).toBeVisible();
  }
});

/**
 * A start no other attempt in this run uses. A start is unique per
 * organization, and a retry or a `--repeat-each` copy runs against the same
 * one, so the start is derived from the attempt: 01:00 for the first, then a
 * minute on per retry and ten per repeat. The fixture's 07:00 and 19:00 are
 * out of reach of any plausible count.
 */
function attemptStart(retry: number, repeatEachIndex: number): string {
  const minutes = 60 + repeatEachIndex * 10 + retry;
  const hours = Math.floor(minutes / 60) % 24;

  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

test('adding a band lists it', async ({ page }, testInfo) => {
  const name = `Popodne ${randomBytes(3).toString('hex')}`;

  await page.goto('/organizacija/satni-pojasi');
  // The add form is a dialog, opened from the explainer.
  await page.getByRole('button', { name: bands.open }).click();
  await expect(page.getByRole('dialog', { name: bands.addHeading })).toBeVisible();
  await page.getByLabel(bands.name, { exact: true }).fill(name);
  await page
    .getByLabel(bands.start, { exact: true })
    .fill(attemptStart(testInfo.retry, testInfo.repeatEachIndex));
  await page.getByRole('button', { name: bands.add }).click();

  // The dialog closes on success, and the confirmation is on the page.
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('status')).toHaveText(bands.created);
  await expect(page.getByRole('link', { name: fill(bands.edit, { name }) })).toBeVisible();
});

test('editing a band opens it in a dialog over the list, and its close returns to the list', async ({
  page,
  fixture,
}) => {
  const band = firstBand(fixture);

  await page.goto('/organizacija/satni-pojasi');
  await page.getByRole('link', { name: fill(bands.edit, { name: band.name }) }).click();

  const dialog = page.getByRole('dialog', { name: bands.editHeading });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(bands.name, { exact: true })).toHaveValue(band.name);
  // The list stays behind it.
  await expect(page.getByRole('heading', { level: 1, name: bands.heading })).toBeAttached();

  await dialog.getByRole('button', { name: bands.close }).click();
  await expect(page).toHaveURL('/organizacija/satni-pojasi');
  await expect(page.getByRole('dialog')).toBeHidden();
});
