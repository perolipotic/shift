import { defineConfig, devices } from '@playwright/test';

/**
 * The E2E smoke suite: Chromium only, against the real local Supabase stack and
 * Vite on 127.0.0.1:5173 — the one origin the admin-auth Edge Function's CORS
 * admits (`supabase/functions/.env`), which is why the port is strict.
 *
 * Every run provisions its own organization in globalSetup and deletes it in
 * globalTeardown (`e2e/support/fixture.ts`). See `e2e/README.md`.
 */

const BASE_URL = 'http://127.0.0.1:5173';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    locale: 'hr-HR',
    timezoneId: 'Europe/Zagreb',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @shift/web exec vite --host 127.0.0.1 --port 5173 --strictPort',
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // The function answers 401 without a JWT once it is served, which
      // Playwright counts as up. The stack check first, because web servers
      // start before globalSetup.
      command: 'node e2e/support/require-stack.ts && pnpm exec supabase functions serve admin-auth',
      url: 'http://127.0.0.1:54321/functions/v1/admin-auth',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
