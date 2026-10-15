import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

/**
 * The admin list screens' read retry (deferred-work sweep, as `kalendar.retry`
 * is): the team list's read is answered with a service error for as long as
 * `failing` holds — a refused answer rather than an aborted socket, for the
 * reason `calendar.spec.ts` gives — and passed through once it stops.
 */
test('a failed team list read offers Pokušaj ponovno, which reads it again', async ({ page, teamsPage, fixture }) => {
  let failing = true;
  await page.route('**/rest/v1/teams*', (route) =>
    failing
      ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"unavailable"}' })
      : route.fallback(),
  );

  await teamsPage.goto();

  const alert = teamsPage.alertWith(hr.smjene.error.unavailable);
  const retry = page.getByRole('button', { name: hr.smjene.error.retry, exact: true });

  await expect(alert).toBeVisible();
  await expect(retry).toBeVisible();

  failing = false;
  await retry.click();
  await expect(alert).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  await expect(page.getByText(fixture.team.name, { exact: true }).first()).toBeVisible();
});
