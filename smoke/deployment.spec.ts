import { expect, test } from '@playwright/test';

import { LoginPage } from '../e2e/pages/login.page.ts';
import { hr } from '../e2e/utils/i18n.ts';
import { publishableKey, smokeAccount, supabaseUrl } from './support/env.ts';

/**
 * The remote smoke: DEPLOY.md §5.2c and §6, run by the pipeline instead of by
 * hand.
 *
 * It writes nothing on purpose. The signup probe (story 19.1) sends a
 * synthesized address, which Kong answers itself and never relays to GoTrue
 * (AD-22), so it creates no account whether the stack's door is shut or open.
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
  await expect(page.getByRole('heading', { level: 1, name: hr.auth.heading })).toBeVisible();
  await expect(page.getByRole('textbox', { name: hr.auth.organization.label, exact: true })).toBeVisible();

  expect(messages.filter((line) => line.includes('SUPABASE_ENVIRONMENT_MISSING'))).toEqual([]);
});

/**
 * Whether the smoke is pointed at the local CLI stack: its Kong is the CLI's,
 * with no allow-list and no mail route (AD-22 is the deployed compose's), so
 * GoTrue answers the signup probe itself there.
 */
function againstLocalStack(): boolean {
  const host = new URL(supabaseUrl()).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

test.describe('signup', () => {
  // Never retried, as before: one probe, one answer.
  test.describe.configure({ retries: 0 });

  /** A synthesized address: Kong never relays it, and the hook refuses it, so the probe writes nothing. */
  const probeBody = (): Record<string, string> => ({
    email: `smoke-probe-${crypto.randomUUID()}@smoke.shift.invalid`,
    password: `probe-${crypto.randomUUID()}`,
  });

  test('is answered by Kong with one 200 {}, or locally refused by the hook, and creates nothing (story 19.1)', async ({ request }) => {
    const response = await request.post(`${supabaseUrl()}/auth/v1/signup`, {
      headers: { apikey: publishableKey(), 'content-type': 'application/json' },
      data: probeBody(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    const body = await response.text();

    if (againstLocalStack()) {
      // The CLI's GoTrue, behind the CLI's Kong: the before-user-created hook
      // (0066) refuses a synthesized address with its one answer.
      expect(response.status(), `the local hook did not refuse the probe: ${body}`).toBe(403);
      expect(body).toContain('SIGNUP_REFUSED');
      return;
    }

    // AD-22: Kong answers every signup, recover and resend itself, with
    // `200 {}`, and relays only an email identity's address. KONG_HEADERS=off:
    // no Server, Via or X-Kong-* header names the gateway or GoTrue's latency.
    const hint = `the signup route on ${supabaseUrl()} is not Kong's one answer (HTTP ${String(response.status())}): DEPLOY.md §9.9`;
    expect(response.status(), hint).toBe(200);
    expect(body, hint).toBe('{}');
    const names = Object.keys(response.headers());
    expect(names.filter((name) => name === 'server' || name === 'via' || name.startsWith('x-kong')), hint).toEqual([]);
  });

  test('closes every other auth path and spelling, as Kong\'s own 404 (story 19.1)', async ({ request }) => {
    test.skip(againstLocalStack(), 'the CLI\'s Kong has no allow-list; AD-22 is the deployed compose\'s (DEPLOY.md §9.9)');
    // A POST with the key, as a client creating an account or a passwordless
    // session would send it: a GET on a POST-only route would prove nothing.
    for (const path of ['/auth/v1/otp', '/auth/v1/magiclink', '/auth/v1/signup/', '/auth/v1//signup', '/auth/v1/sign%75p']) {
      const response = await request.post(`${supabaseUrl()}${path}`, {
        headers: { apikey: publishableKey(), 'content-type': 'application/json' },
        data: probeBody(),
        timeout: REQUEST_TIMEOUT_MS,
      });
      expect(response.status(), `POST ${path}`).toBe(404);
    }
  });
});

test('admin-auth answers CORS for the deployed origin', async ({ request, baseURL }) => {
  // Not a preflight: a request carrying `Access-Control-Request-Method` can be
  // answered by the gateway itself. `Access-Control-Allow-Methods: POST, OPTIONS`
  // is sent only by the function, and only for an origin its
  // `SHIFT_ALLOWED_ORIGINS` admits (`e2e/utils/database-helper.ts` `requireAdminAuth`).
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

  // Sign-in, and nothing after it: no sign-out, no write. `LoginPage.signIn` asserts the
  // landing itself; the URL is asserted here too so this case states its own
  // claim.
  await new LoginPage(page).signIn(account.organization, account.username, account.password);
  await expect(page).toHaveURL('/danas');
});
