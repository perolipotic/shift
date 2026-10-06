import type { Route } from '@playwright/test';

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

// The refusals below sign in as the SPARE account, never the admin every
// other spec's stored session belongs to: repeated failed attempts must not
// throttle or lock the account the rest of the suite depends on.

test('a wrong password is refused on the page', async ({ page, loginPage, fixture }) => {
  await loginPage.submitSignIn(fixture.slug, fixture.spare.username, `${fixture.password}-wrong`);

  await expect(loginPage.alert).toHaveText(hr.auth.error.credentials);
  await expect(page).toHaveURL(`/prijava/${fixture.slug}`);
});

test('after a refusal the button is enabled again, and a second attempt with the right password lands on Danas', async ({
  page,
  loginPage,
  fixture,
}) => {
  await loginPage.submitSignIn(fixture.slug, fixture.spare.username, `${fixture.password}-wrong`);
  await expect(loginPage.alert).toHaveText(hr.auth.error.credentials);
  await expect(loginPage.submitButton).toBeEnabled();

  await loginPage.passwordInput.fill(fixture.password);
  await loginPage.submitButton.click();
  await expect(page).toHaveURL('/danas');
  await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
});

/** GoTrue's password grant, `POST /auth/v1/token?grant_type=password`, and nothing else. */
function isPasswordGrant(url: URL): boolean {
  return url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'password';
}

test('an auth service that cannot be reached says sign-in is unavailable, leaves the form usable, and a retry once it is back signs in', async ({
  page,
  loginPage,
  fixture,
}) => {
  // The password grant fails in transport, for this test's page only.
  const failPasswordGrant = (route: Route) => route.abort('failed');
  await page.route(isPasswordGrant, failPasswordGrant);

  try {
    await loginPage.submitSignIn(fixture.slug, fixture.spare.username, fixture.password);

    await expect(loginPage.alert).toHaveText(hr.auth.error.unavailable);
    await expect(page).toHaveURL(`/prijava/${fixture.slug}`);
    await expect(loginPage.submitButton).toBeEnabled();
  } finally {
    await page.unroute(isPasswordGrant, failPasswordGrant);
  }

  // The service is back: the same form, submitted again, signs in.
  await loginPage.submitButton.click();
  await expect(page).toHaveURL('/danas');
  await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
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

  // Signed out for real: an app route sends the visitor back to the prompt,
  // carrying the route it asked for.
  await page.goto('/danas');
  await expect(page).toHaveURL(`/prijava?povratak=${encodeURIComponent('/danas')}`);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Odjava in the Više sheet signs out and returns to the organization prompt', async ({
    page,
    loginPage,
    fixture,
  }) => {
    await loginPage.signIn(fixture.slug, fixture.spare.username, fixture.password);

    // On a phone the exit lives in the Više sheet (story 7.3).
    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet).toBeVisible();
    await loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true }).click();

    await expect(page).toHaveURL('/prijava');
    await expect(loginPage.organizationHeading).toBeVisible();
  });
});

test('a signed-out deep link to Kalendar lands back on it, search and hash intact, after sign-in', async ({
  page,
  loginPage,
  fixture,
}) => {
  const deepLink = '/kalendar?mjesec=2031-02#tjedan';

  await page.goto(deepLink);
  await expect(page).toHaveURL(`/prijava?povratak=${encodeURIComponent(deepLink)}`);
  await expect(loginPage.organizationHeading).toBeVisible();

  await loginPage.continueSignIn(fixture.slug, fixture.spare.username, fixture.password);

  await expect(page).toHaveURL(deepLink);
  await expect(loginPage.heading(hr.nav.kalendar)).toBeVisible();
});

test('a return target that points off the application lands on Danas instead', async ({
  page,
  loginPage,
  fixture,
}) => {
  await page.goto(`/prijava?povratak=${encodeURIComponent('//evil.example/kalendar')}`);

  await loginPage.continueSignIn(fixture.slug, fixture.spare.username, fixture.password);

  await expect(page).toHaveURL('/danas');
});

test('the submit keeps keyboard focus while pending, and a refusal moves it to the password', async ({
  page,
  loginPage,
  fixture,
}) => {
  // The password grant is HELD until the assertions on the pending state have
  // run, so the in-flight window is observed rather than raced.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holdPasswordGrant = async (route: Route) => {
    await held;
    await route.continue();
  };
  await page.route(isPasswordGrant, holdPasswordGrant);

  try {
    await loginPage.goto();
    await loginPage.fillCredentialsFor(fixture.slug, fixture.spare.username, `${fixture.password}-wrong`);
    await loginPage.submitButton.focus();
    await page.keyboard.press('Enter');

    await expect(loginPage.submitButton).toHaveAttribute('aria-disabled', 'true');
    await expect(loginPage.submitButton).toBeFocused();

    release();

    await expect(loginPage.alert).toHaveText(hr.auth.error.credentials);
    await expect(loginPage.passwordInput).toBeFocused();
    await expect(loginPage.submitButton).toHaveAttribute('aria-disabled', 'false');
  } finally {
    release();
    await page.unroute(isPasswordGrant, holdPasswordGrant);
  }
});
