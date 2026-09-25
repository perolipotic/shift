import type { Locator, Page } from '@playwright/test';

import { ADMIN_STATE, MEMBER_STATE, type Fixture } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { expectNoHorizontalScroll, expectTouchTargets } from './support/layout.ts';
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
