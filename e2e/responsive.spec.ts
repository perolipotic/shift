import type { Locator, Page } from '@playwright/test';

import { ADMIN_STATE, MEMBER_STATE, type Fixture } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { expectNoHorizontalScroll, expectTouchTargets } from './support/layout.ts';
import { NEXT_LABELS, STEP_HEADINGS, stepProgress } from './support/rotation.ts';
import { expect, firstBand, test } from './support/test.ts';

/**
 * The phone-width criteria no unit test can check: at 320 × 640, on a touch
 * phone, no screen scrolls sideways and every control is a 44 px target.
 *
 * Each screen names the element that proves it has finished loading, so the
 * measurement is of the rendered screen and not of its skeleton. Paths and
 * names that depend on the run are functions of the fixture, which is read
 * inside the test rather than when this file loads.
 */

test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

interface Screen {
  readonly title: string;
  readonly path: (fixture: Fixture) => string;
  readonly ready: (page: Page, fixture: Fixture) => Locator;
}

async function checkScreen(page: Page, fixture: Fixture, screen: Screen): Promise<void> {
  await page.goto(screen.path(fixture));
  await expect(screen.ready(page, fixture)).toBeVisible();

  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
}

const signedOut: readonly Screen[] = [
  {
    title: 'organization prompt',
    path: () => '/prijava',
    ready: (page) => page.getByLabel(hr.auth.organization.label, { exact: true }),
  },
  {
    title: 'sign-in',
    path: (fixture) => `/prijava/${fixture.slug}`,
    ready: (page) => page.getByLabel(hr.auth.password, { exact: true }),
  },
];

const asMember: readonly Screen[] = [
  {
    title: 'Danas',
    path: () => '/danas',
    ready: (page, fixture) => page.getByRole('link', { name: fixture.team.name }),
  },
];

const asAdmin: readonly Screen[] = [
  {
    title: 'Ljudi',
    path: () => '/ljudi',
    ready: (page, fixture) =>
      page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: fixture.member.name }) }),
  },
  {
    title: 'new member',
    path: () => '/ljudi/novi',
    ready: (page) => page.getByLabel(hr.ljudi.form.username, { exact: true }),
  },
  {
    title: 'teams',
    path: () => '/ljudi/smjene',
    ready: (page, fixture) =>
      page.getByRole('link', { name: fill(hr.smjene.edit, { name: fixture.team.name }) }),
  },
  {
    title: 'roster',
    path: (fixture) => `/smjene/${fixture.team.id}`,
    ready: (page, fixture) => page.getByRole('listitem').filter({ hasText: fixture.member.name }),
  },
  {
    title: 'hour bands',
    path: () => '/organizacija/satni-pojasi',
    ready: (page, fixture) =>
      page.getByRole('link', {
        name: fill(hr.organization.hourBands.edit, { name: firstBand(fixture).name }),
      }),
  },
  {
    title: 'Organizacija',
    path: () => '/organizacija',
    ready: (page) => page.getByLabel(hr.organization.name, { exact: true }),
  },
];

test.describe('signed out', () => {
  for (const screen of signedOut) {
    test(`${screen.title} fits 320 px`, async ({ page, fixture }) => {
      await checkScreen(page, fixture, screen);
    });
  }
});

test.describe('as a member', () => {
  test.use({ storageState: MEMBER_STATE });

  for (const screen of asMember) {
    test(`${screen.title} fits 320 px`, async ({ page, fixture }) => {
      await checkScreen(page, fixture, screen);
    });
  }
});

test.describe('as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const screen of asAdmin) {
    test(`${screen.title} fits 320 px`, async ({ page, fixture }) => {
      await checkScreen(page, fixture, screen);
    });
  }
});

/**
 * STORY 2.4: the rotation screen below 640 px is a four-step stepper, so it is
 * measured on EACH step — reached through Dalje, as a person reaches it — and
 * not only on the first. The preview's wide grid scrolls inside its own
 * container, never the page.
 */
async function checkRotationSteps(page: Page): Promise<void> {
  await page.goto('/postavke-rotacije');

  for (const [index, heading] of STEP_HEADINGS.entries()) {
    const next = NEXT_LABELS[index - 1];

    if (next !== undefined) await page.getByRole('button', { name: next, exact: true }).tap();
    await expect(stepProgress(page, index + 1)).toBeVisible();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  }
}

test.describe('as an admin, the rotation screen', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Postavke rotacije fits 320 px on each of its four steps', async ({ page }) => {
    await checkRotationSteps(page);
  });

  // STORY 2.4, a regression only: the dialogs of the hour bands and the shift
  // types open at 320 px with no sideways page scroll and 44 px controls.
  test('the hour band dialogs fit 320 px', async ({ page, fixture }) => {
    const bands = hr.organization.hourBands;

    await page.goto('/organizacija/satni-pojasi');
    await page.getByRole('button', { name: bands.open }).tap();
    await expect(page.getByRole('dialog', { name: bands.addHeading })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await page.getByRole('button', { name: bands.close, exact: true }).tap();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('link', { name: fill(bands.edit, { name: firstBand(fixture).name }) }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });

  test('the new shift type dialog fits 320 px', async ({ page }) => {
    const shiftTypes = hr.rotation.shiftTypes;

    await page.goto('/postavke-rotacije');
    await page.getByRole('button', { name: shiftTypes.open }).tap();
    await expect(page.getByRole('dialog', { name: shiftTypes.addHeading })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});

// STORY 2.3b, OWNER LAYOUT: the rotation screen at 390 px too — the phone the
// builder is designed against — now walked step by step (story 2.4).
test.describe('as an admin at 390 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('Postavke rotacije fits 390 px on each of its four steps', async ({ page }) => {
    await checkRotationSteps(page);
  });
});
