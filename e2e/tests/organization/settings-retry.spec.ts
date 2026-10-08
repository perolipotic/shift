import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

/**
 * The settings read's retry (the sign-in and settings fix). The organization
 * read is answered with a service error for as long as `failing` holds — a
 * refused answer rather than an aborted socket, for the reason
 * `calendar.spec.ts` gives — and passed through to the stack once it stops.
 */
test('a failed read offers a retry: a second failure is announced again, and a success lands focus on the name’s change', async ({
  page,
  organizationPage,
}) => {
  let failing = true;
  await page.route('**/rest/v1/organizations*', (route) =>
    failing
      ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"unavailable"}' })
      : route.fallback(),
  );

  await organizationPage.goto();

  const alert = organizationPage.alertWith(hr.organization.error.unavailable);
  const retry = page.getByRole('button', { name: hr.shell.retry, exact: true });

  await expect(alert).toBeVisible();
  await expect(retry).toBeVisible();

  // A retry that fails again REMOUNTS the alert, which is what makes a screen
  // reader announce it again: the element marked here must be gone.
  await alert.evaluate((element) => {
    element.setAttribute('data-e2e-first-alert', '');
  });
  await retry.click();
  await expect(page.locator('[data-e2e-first-alert]')).toHaveCount(0);
  await expect(alert).toBeVisible();

  // A retry that succeeds unmounts the button; focus goes to the first change
  // on the page, the name's (story 7.18), rather than dropping to the body.
  failing = false;
  await retry.click();
  await expect(organizationPage.nameOpener).toBeFocused();
  await expect(retry).toHaveCount(0);
  await expect(alert).toHaveCount(0);
});
