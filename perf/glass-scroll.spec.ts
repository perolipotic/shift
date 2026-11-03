import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type CDPSession, type Page } from '@playwright/test';

import { CalendarPage } from '../e2e/pages/calendar.page.ts';
import { LoginPage } from '../e2e/pages/login.page.ts';
import { hr } from '../e2e/utils/i18n.ts';

/**
 * Story 15.5: the glass budget, measured. This is the automatable proxy for a
 * trace on a real low-end Android (DESIGN.md, glass rule 7; UX-DR53). That
 * trace stays a human step (`deferred-work.md`).
 *
 * TWO MEASUREMENTS, both on a phone viewport (390 × 844, DPR 3, touch), as an
 * admin on *Kalendar*'s *Sve smjene* grid, all teams:
 *
 *  1. NFR-22, a mid-range phone on a mobile network: 4× CPU throttling, and
 *     Fast 4G bandwidth (9 Mbit/s down, 1.5 Mbit/s up) at Lighthouse's 150 ms
 *     mobile round trip, which is slower than DevTools' preset. Cold: no HTTP
 *     cache and no service worker. From navigation to the month's grid on
 *     screen, at most 2000 ms.
 *  2. The glass budget, a low-end phone: 6× CPU throttling (DevTools' low-tier
 *     mobile). A Chromium trace while the grid scrolls through one month,
 *     moves to the next and scrolls through that one, under the glass tab bar
 *     and the glass sticky head. No frame may spend over 50 ms in paint or
 *     composite. That is read two ways: no paint, raster, layerize or
 *     composite task in the trace over 50 ms, and no long animation frame
 *     whose rendering phase (from `renderStart` to its end: style, layout,
 *     paint and commit on the main thread) is over 50 ms. Long animation
 *     frames are only reported over 50 ms, so with none the phase reads 0.
 *
 * WHAT A PROXY CANNOT SHOW. CPU throttling slows the renderer's main thread;
 * the GPU, raster and compositor threads of this machine are not throttled,
 * and that is where a `backdrop-filter` costs most. A pass here says the main
 * thread holds; only the real-device trace (`deferred-work.md`) says a weak
 * phone GPU does.
 *
 * The trace (`glass-scroll-trace.json`, opens in DevTools → Performance) and
 * `summary.json` are written to `test-results-perf/` for the PR.
 */

const OUT = fileURLToPath(new URL('../test-results-perf/', import.meta.url));
const TRACE = `${OUT}glass-scroll-trace.json`;
const SUMMARY = `${OUT}summary.json`;

const NFR_22_MS = 2000;
const FRAME_BUDGET_MS = 50;

/** Trace event names that are paint or composite work. */
const PAINT_OR_COMPOSITE = new Set([
  'Paint',
  'PrePaint',
  'PaintImage',
  'Layerize',
  'UpdateLayer',
  'UpdateLayerTree',
  'CompositeLayers',
  'Commit',
  'RasterTask',
  'Decode Image',
  'GPUTask',
]);

function credentials(): { readonly org: string; readonly username: string; readonly password: string } {
  const read = (name: string): string => {
    const found = process.env[name]?.trim();
    if (found === undefined || found === '') throw new Error(`perf: set ${name}`);
    return found;
  };

  return { org: read('PERF_ORG'), username: read('PERF_USERNAME'), password: read('PERF_PASSWORD') };
}

const summary: Record<string, unknown> = {
  // Provenance, so the file attached to a PR says what it measured.
  measuredAt: new Date().toISOString(),
  baseUrl: process.env['PERF_BASE_URL'],
  organization: process.env['PERF_ORG'],
};

function writeSummary(): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
}

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
});

async function signIn(page: Page): Promise<void> {
  const { org, username, password } = credentials();
  await new LoginPage(page).signIn(org, username, password);
}

/** Opens *Kalendar* and makes sure the grid (*Sve smjene*), not the day list, shows. */
async function openGrid(calendar: CalendarPage, page: Page): Promise<void> {
  await calendar.goto();
  await expect(calendar.monthHeading()).toBeVisible();
  const modeSwitch = page.getByRole('button', { name: hr.kalendar.mode.sve, exact: true });
  // Wait until the screen has settled on one mode before deciding.
  await expect(calendar.grid.or(modeSwitch).first()).toBeVisible();
  if (!(await calendar.grid.isVisible())) {
    await page.getByRole('button', { name: hr.kalendar.mode.sve, exact: true }).click();
  }
  await expect(calendar.grid).toBeVisible();
}

async function throttle(session: CDPSession, rate: number): Promise<void> {
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

test('NFR-22: the month grid renders within two seconds on a mid-range phone', async ({ page }) => {
  await signIn(page);
  const calendar = new CalendarPage(page);
  // Once unthrottled, so the mode the screen remembers is the grid.
  await openGrid(calendar, page);

  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await throttle(session, 4);

  // "Cold" here means no HTTP cache and no service worker; the session is
  // already signed in, as a member's phone is.
  const started = Date.now();
  await page.goto('/kalendar');
  await expect(calendar.grid, 'the grid did not come back (was Sve smjene not remembered?)').toBeVisible({
    timeout: 30_000,
  });
  await expect(calendar.grid.getByRole('gridcell').first()).toBeVisible();
  const elapsed = Date.now() - started;

  summary['browser'] = page.context().browser()?.version();
  summary['nfr22'] = { cpuThrottling: 4, network: '9/1.5 Mbit/s, 150 ms', coldMonthGridMs: elapsed, budgetMs: NFR_22_MS };
  writeSummary();
  expect(elapsed, `the month grid took ${String(elapsed)} ms`).toBeLessThanOrEqual(NFR_22_MS);
});

test('the glass budget: scrolling two months spends no frame over 50 ms in paint or composite on a low-end phone', async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __loaf: boolean }).__loaf = PerformanceObserver.supportedEntryTypes.includes(
      'long-animation-frame',
    );
    const frames: { duration: number; render: number }[] = [];
    (window as unknown as { __frames: typeof frames }).__frames = frames;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { renderStart: number })[]) {
          const end = entry.startTime + entry.duration;
          frames.push({ duration: entry.duration, render: entry.renderStart > 0 ? end - entry.renderStart : 0 });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      // No LoAF in this browser: the trace's task check still runs.
    }
  });

  await signIn(page);
  const calendar = new CalendarPage(page);
  await openGrid(calendar, page);

  const session = await page.context().newCDPSession(page);
  await throttle(session, 6);
  await page.evaluate(() => {
    (window as unknown as { __frames: unknown[] }).__frames.length = 0;
  });

  mkdirSync(OUT, { recursive: true });
  await browser.startTracing(page, {
    path: TRACE,
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'toplevel',
      'blink.user_timing',
    ],
  });

  const scrolled: number[] = [];
  const scrollThrough = async (): Promise<void> => {
    await page.mouse.move(195, 500);
    for (let step = 0; step < 16; step += 1) {
      await page.mouse.wheel(0, 320);
      await page.waitForTimeout(120);
    }
    // How far it got: the page's scroll, or the grid's own scroller's.
    scrolled.push(
      await page.evaluate(() => {
        let furthest = window.scrollY;
        for (const element of document.querySelectorAll('*')) furthest = Math.max(furthest, element.scrollTop);
        return furthest;
      }),
    );
    for (let step = 0; step < 16; step += 1) {
      await page.mouse.wheel(0, -320);
      await page.waitForTimeout(120);
    }
  };

  try {
    const heading = await calendar.monthHeading().innerText();
    expect(heading, 'the month heading is empty, so the month change cannot be checked').not.toBe('');
    await scrollThrough();
    await calendar.nextButton.click();
    await expect(calendar.monthHeading()).not.toHaveText(heading);
    await expect(calendar.grid).toBeVisible();
    await scrollThrough();
  } finally {
    await browser.stopTracing();
  }
  expect(
    await page.evaluate(() => (window as unknown as { __loaf: boolean }).__loaf),
    'this browser has no long-animation-frame timing, so the frame check would measure nothing',
  ).toBe(true);
  const frames = await page.evaluate(
    () => (window as unknown as { __frames: { duration: number; render: number }[] }).__frames,
  );

  // The trace's paint and composite tasks, longest first.
  const parsed = JSON.parse(readFileSync(TRACE, 'utf8')) as
    | { traceEvents: { name: string; ph: string; dur?: number }[] }
    | { name: string; ph: string; dur?: number }[];
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const longestByName = new Map<string, number>();
  for (const event of events) {
    if (event.ph !== 'X' || event.dur === undefined || !PAINT_OR_COMPOSITE.has(event.name)) continue;
    longestByName.set(event.name, Math.max(longestByName.get(event.name) ?? 0, event.dur / 1000));
  }
  const longestTaskMs = Math.max(0, ...longestByName.values());
  const longestRenderMs = Math.max(0, ...frames.map((frame) => frame.render));
  const longFrames = frames.filter((frame) => frame.duration > FRAME_BUDGET_MS);

  summary['glassBudget'] = {
    cpuThrottling: 6,
    trace: 'test-results-perf/glass-scroll-trace.json',
    longestPaintOrCompositeTaskMs: Number(longestTaskMs.toFixed(1)),
    longestByTask: Object.fromEntries([...longestByName].map(([name, ms]) => [name, Number(ms.toFixed(1))])),
    scrolledPx: scrolled,
    longAnimationFrames: longFrames.length,
    longestFrameMs: Number(Math.max(0, ...frames.map((frame) => frame.duration)).toFixed(1)),
    longestRenderPhaseMs: Number(longestRenderMs.toFixed(1)),
    budgetMs: FRAME_BUDGET_MS,
  };
  writeSummary();

  expect(Math.min(...scrolled), 'a month did not scroll, so nothing was measured').toBeGreaterThan(0);
  expect(longestByName.size, 'the trace holds no paint or composite task, so nothing was measured').toBeGreaterThan(0);
  expect(longestTaskMs, 'a paint or composite task ran over 50 ms').toBeLessThanOrEqual(FRAME_BUDGET_MS);
  expect(longestRenderMs, 'a frame spent over 50 ms rendering').toBeLessThanOrEqual(FRAME_BUDGET_MS);
});
