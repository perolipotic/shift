import { expect, test } from '@playwright/test';

import { hr } from '../e2e/support/i18n.ts';
import { signIn } from '../e2e/support/sign-in.ts';
import { publishableKey, smokeAccount, supabaseUrl } from './support/env.ts';

/**
 * The remote smoke: DEPLOY.md §5.2c and §6, run by the pipeline instead of by
 * hand.
 *
 * It writes nothing on purpose, with ONE exception to know about: the signup
 * probe. On a correctly configured project that request is refused, but if
 * signup is open the probe has just CREATED an account on that project — which
 * is the finding, and which must then be deleted by hand. That case never
 * retries, so one failure is at most one account, and its failure message
 * names the address to delete.
 *
 * It never signs out either: a sign-out revokes every session of the account
 * (`e2e/README.md`), including a person's own.
 */

const REQUEST_TIMEOUT_MS = 15_000;

test('serves the SPA shell at / and at a deep link, both with HTTP 200', async ({ request }) => {
  // AD-14: a static host with no server answers every path with index.html at
  // 200 (`apps/web/public/_redirects`). A 404 here, or a redirect, is a broken
  // fallback rule.
  for (const path of ['/', '/some/deep/route']) {
    const response = await request.get(path, { maxRedirects: 0, timeout: REQUEST_TIMEOUT_MS });
    expect(response.status(), `GET ${path}`).toBe(200);
    expect(await response.text(), `GET ${path} is not the SPA shell`).toContain('id="root"');
  }
});

test('renders the sign-in screen, and the build carries a usable Supabase environment', async ({ page }) => {
  // The client is built on first use, and a bad `VITE_*` value throws
  // `SUPABASE_ENVIRONMENT_MISSING` into whichever screen needed it — which then
  // looks exactly like a Supabase outage (DEPLOY.md §4). The console is the only
  // place the code surfaces, so the console is what is read. `/` reads the
  // session before deciding where to send a visitor, which is what builds it.
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => messages.push(`${error.name}: ${error.message}`));

  await page.goto('/');
  await expect(page).toHaveURL('/prijava');
  await expect(page.getByRole('heading', { level: 1, name: hr.auth.organization.heading })).toBeVisible();
  await expect(page.getByLabel(hr.auth.organization.label, { exact: true })).toBeVisible();

  expect(messages.filter((line) => line.includes('SUPABASE_ENVIRONMENT_MISSING'))).toEqual([]);
});

test.describe('signup', () => {
  // Never retried: if signup is open, every attempt creates an account.
  test.describe.configure({ retries: 0 });

  test('is refused with 422 signup_disabled', async ({ request }) => {
    // `config push` is the only thing that turns Supabase's default open signup
    // off remotely (DEPLOY.md §5.2a), so the outcome is probed, not the exit
    // code. A random `.invalid` address, so an account created by an OPEN
    // result cannot be mistaken for a real one.
    const probe = `smoke-probe-${crypto.randomUUID()}@example.invalid`;
    const response = await request.post(`${supabaseUrl()}/auth/v1/signup`, {
      headers: { apikey: publishableKey(), 'content-type': 'application/json' },
      data: { email: probe, password: `probe-${crypto.randomUUID()}` },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const body: unknown = await response.json().catch(() => null);
    const hint =
      `signup is not refused on ${supabaseUrl()} (HTTP ${String(response.status())}). ` +
      `This probe may have CREATED the account ${probe} on that project: delete it ` +
      '(Authentication → Users), re-run `supabase config push` and re-probe (DEPLOY.md §6).';
    expect(response.status(), hint).toBe(422);
    expect(body, hint).toMatchObject({ error_code: 'signup_disabled' });
  });
});

test('admin-auth answers CORS for the deployed origin', async ({ request, baseURL }) => {
  // Not a preflight: a request carrying `Access-Control-Request-Method` can be
  // answered by the gateway itself. `Access-Control-Allow-Methods: POST, OPTIONS`
  // is sent only by the function, and only for an origin its
  // `SHIFT_ALLOWED_ORIGINS` admits (`e2e/support/database.ts` `requireAdminAuth`).
  const origin = new URL(baseURL ?? '').origin;
  const response = await request.fetch(`${supabaseUrl()}/functions/v1/admin-auth`, {
    method: 'OPTIONS',
    headers: { Origin: origin },
    timeout: REQUEST_TIMEOUT_MS,
  });

  const headers = response.headers();
  const allowOrigin = headers['access-control-allow-origin'];
  const allowMethods = headers['access-control-allow-methods'];
  const seen = `HTTP ${String(response.status())}, allow-origin ${allowOrigin ?? 'absent'}, allow-methods ${allowMethods ?? 'absent'}`;

  expect(response.status(), `admin-auth OPTIONS for ${origin}: ${seen}`).toBe(204);
  expect(allowOrigin, `admin-auth does not admit ${origin}: ${seen}`).toBeDefined();
  expect(allowMethods?.replace(/\s/g, ''), `admin-auth does not admit ${origin}: ${seen}`).toBe('POST,OPTIONS');
});

test('signs the smoke account in and lands on /danas', async ({ page }) => {
  const account = smokeAccount();
  test.skip(account === null, 'SMOKE_ORG, SMOKE_USERNAME and SMOKE_PASSWORD are not set');
  if (account === null) return;

  // Sign-in, and nothing after it: no sign-out, no write. `signIn` asserts the
  // landing itself; the URL is asserted here too so this case states its own
  // claim.
  await signIn(page, account.organization, account.username, account.password);
  await expect(page).toHaveURL('/danas');
});
