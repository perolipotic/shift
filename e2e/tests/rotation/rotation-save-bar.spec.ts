import { randomBytes } from 'node:crypto';

import type { Locator, Page, Route } from '@playwright/test';

import type { RotationPage } from '../../pages/rotation.page.ts';
import {
  holdRotation,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { NEXT_LABELS } from '../../utils/rotation.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.5c: a save bar at the end of the builder keeps "Spremi rotaciju"
 * and "Odbaci promjene" in reach.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from three days ago — the version in force today — and the
 * fixture team keeps none, so the builder opens on an empty draft (mixed
 * patterns). Nothing here writes a rotation: every draft is local, a save
 * that reaches the write is stalled and then answered with a failure, and
 * "Odbaci promjene" forgets the draft. The seed and the team are removed in
 * the `afterEach`.
 */

test.use({ storageState: ADMIN_STATE });

const builder = hr.rotation.builder;
/** How many days before today the seeded version starts. */
const IN_FORCE_DAYS_BEFORE = 3;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; teams: string[] } | null = null;

test.afterEach(async () => {
  // EVERY STEP RUNS, whichever fails; the first failure is reported once all have run.
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (cause) {
      failures.push(cause);
    }
  };
  const seeded = seed;
  const own = written;

  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  seed = null;
  written = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

/** The hold, and a team of the test's own on the seeded rotation, in force since three days ago. */
async function setUp(slug: string): Promise<SeededRotation> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; teams: string[] } = { slug, teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix, IN_FORCE_DAYS_BEFORE);

  return seed;
}

/** The builder, open on its empty draft. */
async function openBuilder(rotationPage: RotationPage): Promise<void> {
  await rotationPage.goto();
  // Enabled once the draft is shown, at every width (below 640 px only step 1 shows).
  await expect(rotationPage.saveButton).toBeEnabled();
  await expect(rotationPage.steps, 'the builder did not open on an empty draft').toHaveCount(0);
}

/** The bar's computed `position`. */
async function positionOf(bar: Locator): Promise<string> {
  return bar.evaluate((element) => getComputedStyle(element).position);
}

/** Clean: static, and not marked sticky — whatever the page's height. */
async function expectStatic(rotationPage: RotationPage): Promise<void> {
  await expect(rotationPage.saveBar).toHaveAttribute('data-sticky', 'false');
  expect(await positionOf(rotationPage.saveBar)).toBe('static');
}

/** Dirty from 640 px up: sticky, pinned to the viewport's bottom, and nothing drawn over it. */
async function expectStickyAtBottom(page: Page, rotationPage: RotationPage): Promise<void> {
  await expect(rotationPage.saveBar).toHaveAttribute('data-sticky', 'true');
  expect(await positionOf(rotationPage.saveBar)).toBe('sticky');
  await expect(rotationPage.saveButton).toBeInViewport();
  const box = await rotationPage.saveBar.boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'the bar has no box').not.toBeNull();
  expect(viewport, 'no viewport').not.toBeNull();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
  // NO OVERLAP: what is drawn at the bar's bottom edge, across it, is the bar.
  const covered = await rotationPage.saveBar.evaluate((bar) => {
    const rect = bar.getBoundingClientRect();
    return [0.1, 0.5, 0.9].some((share) => {
      const hit = document.elementFromPoint(rect.left + rect.width * share, rect.bottom - 2);
      return hit === null || !bar.contains(hit);
    });
  });
  expect(covered, 'something is drawn over the save bar').toBe(false);
}

async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

/** The save's first write — the pattern insert — held until `answer()`, then refused, so nothing is written. */
function stalledPatternInsert(): {
  readonly matches: (url: URL) => boolean;
  readonly handler: (route: Route) => Promise<void>;
  readonly inFlight: Promise<void>;
  readonly answer: () => void;
} {
  let reached: () => void = () => undefined;
  let answer: () => void = () => undefined;
  const inFlight = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });

  return {
    matches: (url) => url.pathname.endsWith('/rest/v1/rotation_patterns'),
    handler: async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      reached();
      await answered;
      return route.fulfill({ status: 500, body: '{}' });
    },
    inFlight,
    answer: () => answer(),
  };
}

test.describe('from 640 px up', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('a draft keeps the bar at the viewport bottom however far up the admin scrolls, with its hint', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    const rotation = await setUp(fixture.slug);

    await openBuilder(rotationPage);

    // CLEAN: static, with no discard and no hint.
    await expect(rotationPage.saveButton).toBeVisible();
    await expect(rotationPage.discardButton).toHaveCount(0);
    await expectStatic(rotationPage);

    // DIRTY: an edit, then scrolled to the top — the bar stays in view.
    await rotationPage.addStep(rotation.steps[0]);
    const effectiveFrom = addDays(rotation.today, 10);
    await rotationPage.effectiveFromInput.fill(effectiveFrom);
    await scrollToTop(page);
    await expectStickyAtBottom(page, rotationPage);
    await expect(rotationPage.discardButton).toBeInViewport();
    await expect(rotationPage.discardButton).toBeEnabled();

    // THE HINT, in a polite live region: the draft's date, and the date the rotation in force applies from.
    const hint = rotationPage.saveBarHint(
      fill(builder.saveBar.hintInForce, {
        effectiveFrom: fullDate(effectiveFrom),
        inForceFrom: fullDate(rotation.start),
      }),
    );
    await expect(hint).toBeInViewport();
    await expect(hint).toHaveAttribute('aria-live', 'polite');
    expect(rotation.start).toBe(addDays(rotation.today, -IN_FORCE_DAYS_BEFORE));

    // And at the bottom of the page, the bar is still there.
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect(rotationPage.saveButton).toBeInViewport();
  });

  test('a control tabbed to near the bottom scrolls above the sticky bar, never under it', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    const rotation = await setUp(fixture.slug);

    await openBuilder(rotationPage);
    await rotationPage.addStep(rotation.steps[0]);
    await scrollToTop(page);
    await expectStickyAtBottom(page, rotationPage);

    // The last team's step `<select>`, focused without scrolling; then Tab to
    // the preview's cycles choice, which lies below the viewport.
    const teams = await rotationPage.offsetTeamNames();
    const last = teams.at(-1);
    expect(last, 'no team in the offsets').toBeDefined();
    await rotationPage.offsetOf(last ?? '').evaluate((element: HTMLElement) => {
      element.focus({ preventScroll: true });
    });
    const target = rotationPage.previewCyclesSelect;
    // THE HARD CASE: the target scrolled to just above the viewport's bottom
    // edge — inside the viewport, but behind the bar. Without the bar's
    // scroll padding a focus finds it "visible" and does not scroll at all.
    await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      window.scrollBy(0, rect.bottom - window.innerHeight + 8);
    });
    const hidden = await target.boundingBox();
    const behind = await rotationPage.saveBar.boundingBox();
    const hiddenBottom = (hidden?.y ?? 0) + (hidden?.height ?? 0);
    expect(hiddenBottom, 'the target is not behind the bar, so nothing is tested').toBeGreaterThan(behind?.y ?? 0);
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport();

    const field = await target.boundingBox();
    const bar = await rotationPage.saveBar.boundingBox();
    expect(field, 'the focused control has no box').not.toBeNull();
    expect(bar, 'the bar has no box').not.toBeNull();
    const fieldBottom = (field?.y ?? 0) + (field?.height ?? 0);
    expect(fieldBottom, 'the focused control is under the bar').toBeLessThanOrEqual(bar?.y ?? 0);
  });

  test('Odbaci promjene forgets the draft: the prefill and its date are back, focus is on Spremi, and the discard is gone', async ({
    fixture,
    rotationPage,
  }) => {
    const rotation = await setUp(fixture.slug);

    await openBuilder(rotationPage);
    await expect(rotationPage.effectiveFromInput).toHaveValue(rotation.today);
    await rotationPage.addStep(rotation.steps[0]);
    await rotationPage.addStep(rotation.steps[2]);
    await expect(rotationPage.steps).toHaveCount(2);
    const effectiveFrom = addDays(rotation.today, 7);
    await rotationPage.effectiveFromInput.fill(effectiveFrom);
    const hint = rotationPage.saveBarHint(
      fill(builder.saveBar.hintInForce, {
        effectiveFrom: fullDate(effectiveFrom),
        inForceFrom: fullDate(rotation.start),
      }),
    );
    await expect(hint).toBeVisible();

    // Outline, never the alarm variant, and no confirmation: one press.
    await rotationPage.discardButton.click();
    await expect(rotationPage.steps).toHaveCount(0);
    await expect(rotationPage.text(builder.patternEmpty)).toBeVisible();
    await expect(rotationPage.effectiveFromInput).toHaveValue(rotation.today);
    await expect(hint).toHaveCount(0);
    await expect(rotationPage.saveButton).toBeFocused();
    await expect(rotationPage.discardButton).toHaveCount(0);
    await expectStatic(rotationPage);
    await expect(rotationPage.dialog()).toHaveCount(0);
  });

  test('a refused save, then Odbaci promjene: the refusal is gone with the draft', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    const rotation = await setUp(fixture.slug);

    await openBuilder(rotationPage);
    // An own draft with an empty pattern: a step added, then removed.
    await rotationPage.addStep(rotation.steps[0]);
    await rotationPage.removeStepButton(1).click();
    await expect(rotationPage.steps).toHaveCount(0);
    await expect(rotationPage.discardButton).toBeVisible();

    await rotationPage.saveButton.click();
    await expect(page.getByRole('alert')).toHaveCount(1);

    await rotationPage.discardButton.click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(rotationPage.saveButton).toBeFocused();
  });

  test('Odbaci promjene is disabled while the save is in flight, and back once it settles', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    const rotation = await setUp(fixture.slug);
    const stall = stalledPatternInsert();

    await openBuilder(rotationPage);
    await rotationPage.addStep(rotation.steps[0]);
    await rotationPage.effectiveFromInput.fill(addDays(rotation.today, 1));
    await page.route(stall.matches, stall.handler);
    try {
      await rotationPage.saveButton.click();
      await stall.inFlight;
      await expect(rotationPage.discardButton).toBeDisabled();
      await expect(rotationPage.saveButton).toBeDisabled();
    } finally {
      stall.answer();
    }
    // REFUSED, nothing written: the draft is kept, and the discard is back.
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(rotationPage.discardButton).toBeEnabled();
    await expect(rotationPage.steps).toHaveCount(1);
    await page.unroute(stall.matches, stall.handler);
  });
});

test.describe('with no version in force', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the hint has only its first part', async ({ fixture, rotationPage }) => {
    // THE HOLD ALONE: the fixture team keeps no rotation, and the hold
    // removes every version dated today or later, so none is in force.
    hold = holdRotation(fixture.slug);
    await hold.ready;

    await openBuilder(rotationPage);
    const today = await rotationPage.effectiveFromInput.inputValue();
    await rotationPage.openHistory();
    await expect(rotationPage.historyRow(builder.history.status.inForce)).toHaveCount(0);
    await rotationPage.closeHistory();
    await rotationPage.anchorInput.fill(addDays(today, 1));

    await expect(
      rotationPage.saveBarHint(fill(builder.saveBar.hint, { effectiveFrom: fullDate(today) })),
    ).toBeVisible();
  });
});

test.describe('just above 640 px, where the tab bar is gone', () => {
  test.use({ viewport: { width: 700, height: 800 } });

  test('the bar is sticky at the bottom, and nothing overlaps it', async ({ page, fixture, rotationPage }) => {
    const rotation = await setUp(fixture.slug);

    await openBuilder(rotationPage);
    await rotationPage.addStep(rotation.steps[0]);
    await scrollToTop(page);
    // No phone tab bar from 640 px up: one navigation landmark, the aside's.
    await expect(page.getByRole('navigation', { name: hr.shell.navigation })).toHaveCount(1);
    await expectStickyAtBottom(page, rotationPage);
    await expect(rotationPage.discardButton).toBeInViewport();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('at 390 px, on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the bar is in flow at the end, after the step actions, never sticky, and nothing scrolls sideways', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    const rotation = await setUp(fixture.slug);

    await openBuilder(rotationPage);
    // Vrijedi od opens on today (hidden on step 1, read all the same).
    await expect(rotationPage.effectiveFromInput).toHaveValue(rotation.today);
    // Step 2, where the pattern is built.
    await rotationPage.nextButton(NEXT_LABELS[0]).tap();
    await rotationPage.addStep(rotation.steps[0]);
    await expect(rotationPage.steps).toHaveCount(1);

    await expect(rotationPage.discardButton).toBeVisible();
    await expect(rotationPage.saveBar).toHaveAttribute('data-sticky', 'true');
    expect(await positionOf(rotationPage.saveBar), 'the bar is sticky on a phone').toBe('static');
    // After the step actions: Dalje sits above the bar.
    const next = await rotationPage.nextButton(NEXT_LABELS[1]).boundingBox();
    const save = await rotationPage.saveButton.boundingBox();
    expect(next, 'Dalje has no box').not.toBeNull();
    expect(save, 'the save has no box').not.toBeNull();
    expect(save?.y ?? 0).toBeGreaterThan(next?.y ?? 0);
    await expectNoHorizontalScroll(page);

    // The hint wraps above the buttons.
    await rotationPage.saveButton.scrollIntoViewIfNeeded();
    const hint = rotationPage.saveBarHint(
      fill(builder.saveBar.hintInForce, {
        effectiveFrom: fullDate(rotation.today),
        inForceFrom: fullDate(rotation.start),
      }),
    );
    await expect(hint).toBeVisible();
    const hintBox = await hint.boundingBox();
    const saveBox = await rotationPage.saveButton.boundingBox();
    expect(hintBox, 'the hint has no box').not.toBeNull();
    expect((hintBox?.y ?? 0) + (hintBox?.height ?? 0)).toBeLessThanOrEqual((saveBox?.y ?? 0) + 1);
  });
});
