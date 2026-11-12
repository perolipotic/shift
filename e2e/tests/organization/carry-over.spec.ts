import type { Page } from '@playwright/test';

import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { icu, hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const organization = hr.organization;

/**
 * 5, 30.06. and 2099: the story's I/O matrix, the first year moved to 2099
 * (story 13.4b) so the setting carries nothing into any leave year the
 * shared organization's other specs read while this one holds it.
 */
const FACT = { count: 5, dayMonth: '30.06.', year: '2099' } as const;

/**
 * Story 13.4: *Prijenos godišnjeg* on *Organizacija*. Only the setting: since
 * 13.4b every balance derives carried days from it, so its first year is 2099
 * and no other surface changes while it is set. The run's organization has none (no default, nothing in the seed);
 * the case starts by clearing it through the dialog and ends by clearing it
 * again, so a failed run restores it too. Serial: the organization is shared.
 */
test.describe.configure({ mode: 'serial' });

/** Every organization PATCH the page sends, by its JSON body. */
function patchesOf(page: Page): unknown[] {
  const bodies: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/rest/v1/organizations')) {
      bodies.push(request.postDataJSON());
    }
  });
  return bodies;
}

test('sets 5, 30.06. and 2099 in one PATCH, refuses an impossible day before sending, and clears it', async ({
  page,
  organizationPage,
}) => {
  await organizationPage.goto();
  try {
    await organizationPage.clearCarryOver();
    const patches = patchesOf(page);

    // SET: one PATCH, the four columns and nothing else, and the card reads
    // the returned row.
    await organizationPage.carryOverOpener.click();
    await expect(organizationPage.carryOverMaxDays).toHaveValue('');
    await organizationPage.carryOverMaxDays.fill('5');
    await organizationPage.carryOverExpiryDay.selectOption('30');
    await organizationPage.carryOverExpiryMonth.selectOption('6');
    await organizationPage.carryOverFirstYear.fill('2099');
    await organizationPage.saveIn(organizationPage.carryOverDialog).click();

    await expect(organizationPage.carryOverDialog).toHaveCount(0);
    await expect(organizationPage.text(icu(organization.carryOverStatusSet, FACT))).toBeVisible();
    await expect(organizationPage.carryOverOpener).toBeFocused();
    await expect(
      organizationPage.carryOverRegion.getByText(icu(organization.carryOverFact, FACT), { exact: true }),
    ).toBeVisible();
    expect(icu(organization.carryOverFact, FACT)).toBe(
      'Najviše 5 dana. Preneseni dani istječu 30.06., od godine godišnjeg 2099.',
    );
    expect(patches).toEqual([
      {
        carry_over_max_days: 5,
        carry_over_expiry_month: 6,
        carry_over_expiry_day: 30,
        carry_over_first_leave_year: 2099,
      },
    ]);

    // REFUSE: 31.06. is no date, refused before anything is sent, the day
    // marked and focused, and what was entered kept.
    await organizationPage.carryOverOpener.click();
    await expect(organizationPage.carryOverMaxDays).toHaveValue('5');
    await expect(organizationPage.carryOverExpiryDay).toHaveValue('30');
    await expect(organizationPage.carryOverExpiryMonth).toHaveValue('6');
    await expect(organizationPage.carryOverFirstYear).toHaveValue('2099');
    await organizationPage.carryOverExpiryDay.selectOption('31');
    await organizationPage.saveIn(organizationPage.carryOverDialog).click();

    await expect(organizationPage.carryOverDialog.getByRole('alert')).toHaveText(organization.error.carryOver);
    await expect(organizationPage.carryOverExpiryDay).toHaveAttribute('aria-invalid', 'true');
    await expect(organizationPage.carryOverExpiryDay).toBeFocused();
    await expect(organizationPage.carryOverExpiryDay).toHaveValue('31');
    expect(patches, 'a refused entry was sent').toHaveLength(1);

    // CLEAR: an empty cap sends four nulls, whatever the other fields hold.
    await organizationPage.carryOverMaxDays.fill('');
    await organizationPage.saveIn(organizationPage.carryOverDialog).click();

    await expect(organizationPage.carryOverDialog).toHaveCount(0);
    await expect(organizationPage.text(organization.carryOverStatusNone)).toBeVisible();
    await expect(organizationPage.carryOverRegion.getByText(organization.carryOverNone, { exact: true })).toBeVisible();
    expect(patches.at(-1)).toEqual({
      carry_over_max_days: null,
      carry_over_expiry_month: null,
      carry_over_expiry_day: null,
      carry_over_first_leave_year: null,
    });
  } finally {
    // RESTORE: the run's organization goes back to no carry-over.
    if ((await organizationPage.carryOverDialog.count()) > 0) {
      await page.keyboard.press('Escape');
    }
    await organizationPage.clearCarryOver();
  }
});
