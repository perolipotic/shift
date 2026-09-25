import { ADMIN_STATE, MEMBER_STATE } from './support/fixture.ts';
import { hr } from './support/i18n.ts';
import { navigation, signIn } from './support/sign-in.ts';
import { expect, test as setup } from './support/test.ts';

/**
 * Signs in once per role through the UI and stores the session, so every other
 * spec starts authenticated. Only the sign-in specs sign in per test.
 */

setup('sign in as the admin', async ({ page, fixture }) => {
  await signIn(page, fixture.slug, fixture.admin.username, fixture.password);
  await expect(navigation(page).getByRole('link', { name: hr.nav.ljudi })).toBeVisible();

  await page.context().storageState({ path: ADMIN_STATE });
});

setup('sign in as a member', async ({ page, fixture }) => {
  await signIn(page, fixture.slug, fixture.member.username, fixture.password);
  await expect(navigation(page).getByRole('link', { name: hr.nav.danas })).toBeVisible();

  await page.context().storageState({ path: MEMBER_STATE });
});
