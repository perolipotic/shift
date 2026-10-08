import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import type { RotationPage } from '../../pages/rotation.page.ts';
import { archiveShiftType, removeLeaveMemberInSql, seedLongNamedMember } from '../../utils/database-helper.ts';
import { ADMIN_STATE, MEMBER_STATE, type Fixture } from '../../utils/run-fixture.ts';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll, expectTouchTargets } from '../../utils/layout.ts';
import { NEXT_LABELS, STEP_HEADINGS } from '../../utils/rotation.ts';
import { expect, firstBand, test, type PageObjects } from '../../utils/custom-fixtures.ts';

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

/** The page objects a screen's ready element is read from. */
type ScreenPages = Pick<
  PageObjects,
  'loginPage' | 'peoplePage' | 'teamsPage' | 'hourBandsPage' | 'organizationPage' | 'todayPage'
>;

interface Screen {
  readonly title: string;
  readonly path: (fixture: Fixture) => string;
  readonly ready: (pages: ScreenPages, fixture: Fixture) => Locator;
}

async function checkScreen(page: Page, pages: ScreenPages, fixture: Fixture, screen: Screen): Promise<void> {
  await page.goto(screen.path(fixture));
  await expect(screen.ready(pages, fixture)).toBeVisible();

  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
}

const signedOut: readonly Screen[] = [
  {
    title: 'sign-in without a slug',
    path: () => '/prijava',
    ready: ({ loginPage }) => loginPage.organizationInput,
  },
  {
    title: 'sign-in from the DVD link',
    path: (fixture) => `/prijava/${fixture.slug}`,
    ready: ({ loginPage }) => loginPage.passwordInput,
  },
];

const asMember: readonly Screen[] = [
  {
    title: 'Danas',
    path: () => '/danas',
    ready: ({ teamsPage }, fixture) => teamsPage.rosterLink(fixture.team.name),
  },
];

const asAdmin: readonly Screen[] = [
  {
    // STORY 6.3: an admin's own Danas — Treba tebe, the coverage, the
    // absences and the week, whose grid scrolls inside its own region.
    title: 'Danas',
    path: () => '/danas',
    ready: ({ todayPage }) => todayPage.openConflictsLink(),
  },
  {
    title: 'Ljudi',
    path: () => '/ljudi',
    ready: ({ peoplePage }, fixture) => peoplePage.editLink(fixture.member.name),
  },
  {
    title: 'new member',
    path: () => '/ljudi/novi',
    ready: ({ peoplePage }) => peoplePage.usernameInput,
  },
  {
    title: 'teams',
    path: () => '/ljudi/smjene',
    ready: ({ teamsPage }, fixture) => teamsPage.editLink(fixture.team.name),
  },
  {
    title: 'roster',
    path: (fixture) => `/smjene/${fixture.team.id}`,
    ready: ({ teamsPage }, fixture) => teamsPage.rosterEntry(fixture.member.name),
  },
  {
    title: 'hour bands',
    path: () => '/organizacija/satni-pojasi',
    ready: ({ hourBandsPage }, fixture) => hourBandsPage.editLink(firstBand(fixture).name),
  },
  {
    title: 'Organizacija',
    path: () => '/organizacija',
    ready: ({ organizationPage }) => organizationPage.nameOpener,
  },
];

test.describe('signed out', () => {
  for (const screen of signedOut) {
    test(`${screen.title} fits 320 px`, async ({
      page,
      fixture,
      loginPage,
      peoplePage,
      teamsPage,
      hourBandsPage,
      organizationPage,
      todayPage,
    }) => {
      const pages = { loginPage, peoplePage, teamsPage, hourBandsPage, organizationPage, todayPage };
      await checkScreen(page, pages, fixture, screen);
    });
  }
});

test.describe('as a member', () => {
  test.use({ storageState: MEMBER_STATE });

  for (const screen of asMember) {
    test(`${screen.title} fits 320 px`, async ({
      page,
      fixture,
      loginPage,
      peoplePage,
      teamsPage,
      hourBandsPage,
      organizationPage,
      todayPage,
    }) => {
      const pages = { loginPage, peoplePage, teamsPage, hourBandsPage, organizationPage, todayPage };
      await checkScreen(page, pages, fixture, screen);
    });
  }
});

test.describe('as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  for (const screen of asAdmin) {
    test(`${screen.title} fits 320 px`, async ({
      page,
      fixture,
      loginPage,
      peoplePage,
      teamsPage,
      hourBandsPage,
      organizationPage,
      todayPage,
    }) => {
      const pages = { loginPage, peoplePage, teamsPage, hourBandsPage, organizationPage, todayPage };
      await checkScreen(page, pages, fixture, screen);
    });
  }
});

/**
 * STORY 2.4: the rotation screen below 640 px is a four-step stepper, so it is
 * measured on EACH step — reached through Dalje, as a person reaches it — and
 * not only on the first. The preview's wide grid scrolls inside its own
 * container, never the page.
 */
async function checkRotationSteps(page: Page, rotationPage: RotationPage): Promise<void> {
  await rotationPage.goto();

  for (const [index, heading] of STEP_HEADINGS.entries()) {
    const next = NEXT_LABELS[index - 1];

    if (next !== undefined) await rotationPage.nextButton(next).tap();
    await expect(rotationPage.stepProgress(index + 1)).toBeVisible();
    await expect(rotationPage.sectionHeading(heading)).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  }
}

test.describe('as an admin, the rotation screen', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Postavke rotacije fits 320 px on each of its four steps', async ({ page, rotationPage }) => {
    await checkRotationSteps(page, rotationPage);
  });

  // STORY 2.4, a regression only: the dialogs of the hour bands and the shift
  // types open at 320 px with no sideways page scroll and 44 px controls.
  test('the hour band dialogs fit 320 px', async ({ page, hourBandsPage, fixture }) => {
    await hourBandsPage.goto();
    await hourBandsPage.openButton.tap();
    await expect(hourBandsPage.addDialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    await hourBandsPage.closeButton.tap();
    await expect(hourBandsPage.dialog()).toBeHidden();

    await hourBandsPage.editLink(firstBand(fixture).name).tap();
    await expect(hourBandsPage.dialog()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });

  test('the new shift type dialog fits 320 px', async ({ page, rotationPage }) => {
    await rotationPage.goto();
    await rotationPage.shiftTypeOpenButton.tap();
    await expect(rotationPage.addShiftTypeDialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});

// STORY 2.3b, OWNER LAYOUT: the rotation screen at 390 px too — the phone the
// builder is designed against — now walked step by step (story 2.4).
test.describe('as an admin at 390 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('Postavke rotacije fits 390 px on each of its four steps', async ({ page, rotationPage }) => {
    await checkRotationSteps(page, rotationPage);
  });
});

// STORY 7.6: below 640 px the Sati, Ljudi and shift-types tables are stacked
// rows, so neither the page nor any element in it scrolls sideways — at the
// narrowest phone and at the one the screens are designed against. Sati and
// Ljudi each list a member of the test's own whose name holds one unbroken
// word wider than the phone, so a row that cannot wrap it fails here on every
// run, not only after another spec left such a name in the run organization.
for (const width of [320, 390]) {
  test.describe(`as an admin, the stacked rows at ${String(width)} px`, () => {
    test.use({ storageState: ADMIN_STATE, viewport: { width, height: 844 } });

    test('Sati is stacked rows, and nothing in it scrolls sideways', async ({ page, hoursPage, fixture }) => {
      const long = await seedLongNamedMember(fixture.slug);
      try {
        await hoursPage.goto();
        await expect(hoursPage.organizationListRow(long.name)).toBeVisible();
        await expect(hoursPage.organizationTable).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await expectNoInnerHorizontalScroll(page);
        await expectTouchTargets(page);
      } finally {
        await removeLeaveMemberInSql(fixture.slug, long.id);
      }
    });

    test('Ljudi is stacked rows, and nothing in it scrolls sideways', async ({ page, peoplePage, fixture }) => {
      const long = await seedLongNamedMember(fixture.slug);
      try {
        await peoplePage.goto();
        await expect(peoplePage.listRow(fixture.member.name)).toBeVisible();
        await expect(peoplePage.listRow(long.name)).toBeVisible();
        await expect(peoplePage.table).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await expectNoInnerHorizontalScroll(page);
        await expectTouchTargets(page);
      } finally {
        await removeLeaveMemberInSql(fixture.slug, long.id);
      }
    });

    test('the shift types step is stacked rows, and nothing in it scrolls sideways', async ({
      page,
      rotationPage,
      fixture,
    }) => {
      // The run organization starts with no type: this test adds its own, a
      // long name crossing midnight, and archives it whatever happens.
      const name = `Noćna dežurna smjena ${randomBytes(3).toString('hex')}`;

      try {
        await rotationPage.goto();
        await rotationPage.addShiftType(name, ['19:00', '07:00']);
        await expect(rotationPage.shiftTypeList.getByRole('listitem').filter({ hasText: name })).toBeVisible();
        await expectNoHorizontalScroll(page);
        // The types' own card: the rotation history below it is a table that
        // keeps its scroller until it stacks too (`deferred-work.md`).
        await expectNoInnerHorizontalScroll(page, rotationPage.shiftTypeList.locator('xpath=..'));
        await expectTouchTargets(page);
      } finally {
        await archiveShiftType(fixture.slug, name);
      }
    });
  });
}
