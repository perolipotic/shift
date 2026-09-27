import { ADMIN_STATE, MEMBER_STATE } from '../utils/run-fixture.ts';
import { hr } from '../utils/i18n.ts';
import { expect, test as setup } from '../utils/custom-fixtures.ts';

/**
 * Signs in once per role through the UI and stores the session, so every other
 * spec starts authenticated. Only the sign-in specs sign in per test.
 */

setup('sign in as the admin', async ({ page, loginPage, fixture }) => {
  await loginPage.signIn(fixture.slug, fixture.admin.username, fixture.password);
  await expect(loginPage.navigationLink(hr.nav.ljudi)).toBeVisible();

  await page.context().storageState({ path: ADMIN_STATE });
});

setup('sign in as a member', async ({ page, loginPage, fixture }) => {
  await loginPage.signIn(fixture.slug, fixture.member.username, fixture.password);
  await expect(loginPage.navigationLink(hr.nav.danas)).toBeVisible();

  await page.context().storageState({ path: MEMBER_STATE });
});
