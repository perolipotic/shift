import { defineConfig, devices } from '@playwright/test';

/**
 * The glass performance run (story 15.5): an on-demand measurement, never part
 * of CI, because throttled timing is too noisy to gate a merge on. It is the
 * automatable proxy for the low-end Android trace that DESIGN.md's glass
 * budget asks for (`perf/glass-scroll.spec.ts` says what it measures).
 *
 * Point it at a PRODUCTION build (the minified, split bundle is what a phone
 * gets), e.g. a `vite preview` on a free port. The spec blocks the service
 * worker, so the NFR-22 load is a first visit, not a cached one:
 *
 *   PERF_BASE_URL=http://127.0.0.1:5174 \
 *   PERF_ORG=dvd-demo PERF_USERNAME=admin PERF_PASSWORD=… pnpm test:perf
 *
 * The trace and a summary land in `test-results-perf/`, to attach to the PR.
 */

const baseURL = process.env['PERF_BASE_URL'];
if (baseURL === undefined || baseURL.trim() === '') {
  throw new Error('perf: set PERF_BASE_URL to a production build, e.g. http://127.0.0.1:5174 (vite preview)');
}

export default defineConfig({
  testDir: 'perf',
  // One measurement at a time: two throttled pages would measure each other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: 'test-results-perf/artifacts',
  reporter: 'list',
  use: {
    baseURL: baseURL.trim(),
    locale: 'hr-HR',
    timezoneId: 'Europe/Zagreb',
    trace: 'off',
  },
  // A phone's user agent, so no desktop-only path runs; the spec sets the
  // viewport, the density and touch.
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
});
