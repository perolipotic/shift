import { randomBytes } from 'node:crypto';

import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, firstBand, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const bands = hr.organization.hourBands;

test('the hour band list shows the fixture bands', async ({ hourBandsPage, fixture }) => {
  await hourBandsPage.goto();

  await expect(hourBandsPage.listHeading).toBeVisible();
  for (const band of fixture.bands) {
    await expect(hourBandsPage.editLink(band.name)).toBeVisible();
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

test('adding a band lists it', async ({ hourBandsPage }, testInfo) => {
  const name = `Popodne ${randomBytes(3).toString('hex')}`;

  await hourBandsPage.goto();
  // The add form is a dialog, opened from the explainer.
  await hourBandsPage.openButton.click();
  await expect(hourBandsPage.addDialog).toBeVisible();
  await hourBandsPage.nameInput.fill(name);
  await hourBandsPage.startInput.fill(attemptStart(testInfo.retry, testInfo.repeatEachIndex));
  await hourBandsPage.addButton.click();

  // The dialog closes on success, and the confirmation is on the page.
  await expect(hourBandsPage.dialog()).toBeHidden();
  await expect(hourBandsPage.status).toHaveText(bands.created);
  await expect(hourBandsPage.editLink(name)).toBeVisible();
});

test('editing a band opens it in a dialog over the list, and its close returns to the list', async ({
  page,
  hourBandsPage,
  fixture,
}) => {
  const band = firstBand(fixture);

  await hourBandsPage.goto();
  await hourBandsPage.editLink(band.name).click();

  const dialog = hourBandsPage.editDialog;

  await expect(dialog).toBeVisible();
  await expect(hourBandsPage.editDialogName).toHaveValue(band.name);
  // The list stays behind it.
  await expect(hourBandsPage.listHeading).toBeAttached();

  await hourBandsPage.editDialogClose.click();
  await expect(page).toHaveURL('/organizacija/satni-pojasi');
  await expect(hourBandsPage.dialog()).toBeHidden();
});
