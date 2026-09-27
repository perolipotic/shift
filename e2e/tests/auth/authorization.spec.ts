import { MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * The route guards, opened directly rather than through the navigation (which
 * simply does not offer them to a member).
 *
 * Every admin-only destination is here, `/raspored` and `/organizacija`
 * included: both carry the admin guard the other admin routes do, and a member
 * who types either lands where one sent away from `/ljudi` does.
 */

test.describe('a member opening an admin screen directly', () => {
  test.use({ storageState: MEMBER_STATE });

  for (const path of [
    '/ljudi',
    '/ljudi/novi',
    '/organizacija/satni-pojasi',
    '/postavke-rotacije',
    '/raspored',
    '/organizacija',
  ]) {
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
