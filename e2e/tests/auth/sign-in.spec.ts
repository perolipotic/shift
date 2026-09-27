import { ADMIN_DESTINATIONS, MEMBER_DESTINATIONS, hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * The full sign-in flow, per test, through GoTrue and the access token hook.
 *
 * NOT PARALLEL WITHIN THIS FILE, despite `fullyParallel`: the sign-out below
 * revokes every session of the spare account (supabase-js signs out globally)
 * and the member test signs in as that same account, so the two must never
 * overlap. `mode: 'default'` runs this file's tests one after another in one
 * worker. A failure does not skip the rest: Playwright replaces the worker and
 * carries on with the next test, and a retry runs in a fresh worker after the
 * failed attempt has ended — so no two of these ever run at the same time.
 */
test.describe.configure({ mode: 'default' });

test('an admin signs in and lands on Danas with the admin destinations', async ({ loginPage, fixture }) => {
  await loginPage.signIn(fixture.slug, fixture.admin.username, fixture.password);

  for (const name of [...MEMBER_DESTINATIONS, ...ADMIN_DESTINATIONS]) {
    await expect(loginPage.navigationLink(name, { exact: true })).toBeVisible();
  }
});

test('a member signs in and lands on Danas without the admin destinations', async ({ loginPage, fixture }) => {
  await loginPage.signIn(fixture.slug, fixture.spare.username, fixture.password);

  for (const name of MEMBER_DESTINATIONS) {
    await expect(loginPage.navigationLink(name, { exact: true })).toBeVisible();
  }
  for (const name of ADMIN_DESTINATIONS) {
    await expect(loginPage.navigationLink(name, { exact: true })).toHaveCount(0);
  }
});

test('a wrong password is refused on the page', async ({ page, loginPage, fixture }) => {
  await loginPage.submitSignIn(fixture.slug, fixture.admin.username, `${fixture.password}-wrong`);

  await expect(loginPage.alert).toHaveText(hr.auth.error.credentials);
  await expect(page).toHaveURL(`/prijava/${fixture.slug}`);
});

test('Odjava signs out and returns to the organization prompt', async ({ page, loginPage, fixture }) => {
  await loginPage.signIn(fixture.slug, fixture.spare.username, fixture.password);

  // On the sidebar the exit lives in the profile menu: the card, named by the
  // person's own name, discloses it.
  const profile = loginPage.profileButton(fixture.spare.name);
  await expect(profile).toHaveAttribute('aria-expanded', 'false');
  await profile.click();
  await expect(profile).toHaveAttribute('aria-expanded', 'true');
  await loginPage.signOutButton.click();

  await expect(page).toHaveURL('/prijava');
  await expect(loginPage.organizationHeading).toBeVisible();

  // Signed out for real: an app route sends the visitor back to the prompt.
  await page.goto('/danas');
  await expect(page).toHaveURL('/prijava');
});
