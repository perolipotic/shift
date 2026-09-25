import { defineConfig, devices } from '@playwright/test';

/**
 * The remote smoke: a short check of a deployed environment that writes nothing
 * — except, if signup turns out to be OPEN, the one account its signup probe
 * then creates (`smoke/deployment.spec.ts`). Run by the pipeline after each
 * deploy, and against the local stack in the e2e job
 * (`.github/workflows/pipeline.yml`). It is not
 * the E2E suite: there is no web server to start, no stack to check and no
 * organization to provision, because the target is a live host.
 *
 * `SMOKE_BASE_URL` is the deployed origin. Locally, point it at the dev server:
 *
 *   SMOKE_BASE_URL=http://127.0.0.1:5173 pnpm test:smoke
 *
 * See `smoke/support/env.ts` for the other variables.
 */

const baseURL = process.env['SMOKE_BASE_URL'];
if (baseURL === undefined || baseURL.trim() === '') {
  throw new Error('smoke: set SMOKE_BASE_URL to the deployed origin, e.g. https://staging.<project>.pages.dev');
}

export default defineConfig({
  testDir: 'smoke',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // A live host can hiccup once; twice is a finding.
  retries: process.env['CI'] ? 1 : 0,
  // Its own report and output folders: in the e2e job it runs right after the
  // E2E suite, and must not overwrite that suite's report.
  outputDir: 'test-results-smoke',
  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-smoke' }]]
    : 'list',
  use: {
    baseURL: baseURL.trim(),
    locale: 'hr-HR',
    timezoneId: 'Europe/Zagreb',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
