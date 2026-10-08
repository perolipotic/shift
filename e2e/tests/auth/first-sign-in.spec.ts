import { LoginPage } from '../../pages/login.page.ts';
import { PeoplePage } from '../../pages/people.page.ts';
import { SetPasswordPage } from '../../pages/set-password.page.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { uniqueMember } from '../../utils/members.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * A member's first sign-in (story 7.8): an admin issues the account and copies
 * the four-word password; the member, in a context of their own, signs in with
 * it and reaches nothing but the set-password step until they save their own.
 */

test('a new member sets their own password at the first sign-in, then signs in with it', async ({
  browser,
  fixture,
}) => {
  test.slow(); // two contexts, three sign-ins

  // THE ADMIN: issue the account and copy what is shown.
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const { name, username } = uniqueMember('Prva Prijava');
  let issued: string;

  try {
    await admin.grantPermissions(['clipboard-read', 'clipboard-write']);
    const adminPage = await admin.newPage();
    const people = new PeoplePage(adminPage);

    await people.createMember(name, username);
    await expect(people.issuedPassword).toBeVisible();
    await expect(people.text(hr.ljudi.form.credentialOnce)).toBeVisible();
    await people.copyButton.click();
    await expect(people.statusWith(hr.ljudi.form.copied)).toBeVisible();

    issued = await adminPage.evaluate(() => navigator.clipboard.readText());
    expect(issued).toMatch(/^[a-z]{3,6}(-[a-z]{3,6}){3}$/);
    await expect(people.issuedPassword).toHaveText(issued);
  } finally {
    await admin.close();
  }

  // THE MEMBER, in a fresh context.
  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } });

  try {
    const page = await member.newPage();
    const login = new LoginPage(page);
    const step = new SetPasswordPage(page);
    const chosen = `${username}-vlastita`;

    await login.submitSignIn(fixture.slug, username, issued);
    await expect(page).toHaveURL('/postavi-lozinku');
    await expect(step.stepHeading).toBeVisible();

    // A GUARDED DESTINATION, typed: it lands back on the step.
    await page.goto('/kalendar');
    await expect(page).toHaveURL('/postavi-lozinku');

    // THE MISMATCH IS REFUSED ON THE PAGE, with no request.
    let updates = 0;
    page.on('request', (request) => {
      if (request.url().includes('/auth/v1/user') && request.method() === 'PUT') updates += 1;
    });
    await step.save(chosen, `${chosen}x`);
    await expect(step.alertWith(hr.auth.setPassword.error.mismatch)).toBeVisible();
    await expect(step.repeatInput).toBeFocused();
    expect(updates, 'a mismatch reached the service').toBe(0);

    // SAVED: the member continues to their landing surface, still signed in.
    await step.save(chosen);
    await expect(page).toHaveURL('/danas');
    await expect(step.heading(hr.nav.danas)).toBeVisible();

    // AND THE STEP IS GONE: the URL alone sends them on.
    await page.goto('/postavi-lozinku');
    await expect(page).toHaveURL('/danas');

    // OUT, AND BACK IN WITH THE NEW PASSWORD: straight to Danas.
    await step.profileButton(name).click();
    await step.signOutButton.click();
    await expect(page).toHaveURL(/\/prijava/);
    await login.signIn(fixture.slug, username, chosen);
  } finally {
    await member.close();
  }
});

test('the step offers Odjava, which ends the session', async ({ browser, fixture }) => {
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const { name, username } = uniqueMember('Odjava Korak');
  let issued: string;

  try {
    const people = new PeoplePage(await admin.newPage());

    await people.createMember(name, username);
    issued = (await people.issuedPassword.textContent()) ?? '';
  } finally {
    await admin.close();
  }

  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } });

  try {
    const page = await member.newPage();
    const step = new SetPasswordPage(page);

    await new LoginPage(page).submitSignIn(fixture.slug, username, issued);
    await expect(page).toHaveURL('/postavi-lozinku');
    await step.signOutButton.click();
    await expect(page).toHaveURL(/\/prijava/);
    await page.goto('/postavi-lozinku');
    await expect(page).toHaveURL(/\/prijava\?povratak=/);
  } finally {
    await member.close();
  }
});

/** Issues a member as the admin and returns the shown password. */
async function issued(browser: import('@playwright/test').Browser, label: string) {
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const member = uniqueMember(label);

  try {
    const people = new PeoplePage(await admin.newPage());

    await people.createMember(member.name, member.username);

    return { ...member, password: (await people.issuedPassword.textContent()) ?? '' };
  } finally {
    await admin.close();
  }
}

test('a clear that fails after the password landed retries only the clear', async ({ browser, fixture }) => {
  test.slow();
  const { username, password } = await issued(browser, 'Ponovi Nastavak');
  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } });

  try {
    const page = await member.newPage();
    const step = new SetPasswordPage(page);
    const chosen = `${username}-vlastita`;
    let updates = 0;

    page.on('request', (request) => {
      if (request.url().includes('/auth/v1/user') && request.method() === 'PUT') updates += 1;
    });
    // THE FIRST CLEAR FAILS; every later one goes through.
    let refused = false;
    await page.route('**/functions/v1/admin-auth', async (route) => {
      if (route.request().method() === 'POST' && !refused) {
        refused = true;
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PASSWORD_FLAG_NOT_CLEARED' }),
        });

        return;
      }
      await route.continue();
    });

    await new LoginPage(page).submitSignIn(fixture.slug, username, password);
    await expect(page).toHaveURL('/postavi-lozinku');

    await step.save(chosen);
    await expect(step.alertWith(hr.auth.setPassword.error.notContinued)).toBeVisible();
    expect(updates, 'the password was not set exactly once').toBe(1);

    // THE RETRY: the fields hold what was saved, and only the clear goes out.
    await expect(step.passwordInput).toHaveAttribute('readonly', '');
    await step.submitButton.click();
    await expect(page).toHaveURL('/danas');
    expect(updates, 'the retry set the password again').toBe(1);
  } finally {
    await member.close();
  }
});

test('an admin reset shows four words with Kopiraj, and holds the next sign-in at the step', async ({
  browser,
  fixture,
}) => {
  test.slow();
  const { name, username } = await issued(browser, 'Nova Lozinka');
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  let reset: string;

  try {
    await admin.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await admin.newPage();
    const people = new PeoplePage(page);

    await people.goto();
    await people.editLink(name).click();
    await people.resetButton(name).click();
    await people.resetConfirmButton(name).click();
    await expect(people.statusWith(hr.ljudi.form.resetIssued)).toBeVisible();
    await expect(people.text(hr.ljudi.form.resetCredentialOnce)).toBeVisible();
    await expect(people.issuedPassword).toBeVisible();
    await people.copyButton.click();
    await expect(people.statusWith(hr.ljudi.form.copied)).toBeVisible();

    reset = await page.evaluate(() => navigator.clipboard.readText());
    expect(reset).toMatch(/^[a-z]{3,6}(-[a-z]{3,6}){3}$/);
  } finally {
    await admin.close();
  }

  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } });

  try {
    const page = await member.newPage();

    await new LoginPage(page).submitSignIn(fixture.slug, username, reset);
    await expect(page).toHaveURL('/postavi-lozinku');
  } finally {
    await member.close();
  }
});
