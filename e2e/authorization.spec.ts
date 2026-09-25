import { MEMBER_STATE } from './support/fixture.ts';
import { expect, test } from './support/test.ts';

/**
 * The route guards, opened directly rather than through the navigation (which
 * simply does not offer them to a member).
 *
 * Only the routes that carry an admin guard today. `/raspored` and
 * `/organizacija` have none yet — a known gap, deferred — so they are
 * deliberately not asserted here.
 */

test.describe('a member opening an admin screen directly', () => {
  test.use({ storageState: MEMBER_STATE });

  for (const path of ['/ljudi', '/ljudi/novi', '/organizacija/satni-pojasi', '/postavke-rotacije']) {
    test(`is sent from ${path} to Danas`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL('/danas');
    });
  }
});

test('a signed-out visitor opening Ljudi is sent to the sign-in prompt', async ({ page }) => {
  await page.goto('/ljudi');
  await expect(page).toHaveURL('/prijava');
});
