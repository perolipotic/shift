import type { Page } from '@playwright/test';

import type { LoginPage } from '../../pages/login.page.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { MINIMUM_TARGET, expectNoHorizontalScroll, expectTouchTargets } from '../../utils/layout.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 7.3: below 640 px the bar is five equal cells, four fixed tabs per
 * role and *Više*, and nothing in it scrolls sideways. *Više* opens a modal
 * sheet with the role's other destinations, the theme and Odjava. From 640 px
 * up the theme sits beside Odjava in the profile menu.
 *
 * Measured at 390 px (the phone the redesign is drawn against) and at 320 px
 * (the narrowest phone), for both roles.
 */

const ADMIN_TABS = [hr.nav.danas, hr.nav.kalendar, hr.nav.raspored, hr.nav.ljudi] as const;
const MEMBER_TABS = [hr.nav.danas, hr.nav.kalendar, hr.nav.sati, hr.nav.godisnji] as const;
const ADMIN_MORE = [hr.nav.sati, hr.nav.godisnji, hr.nav.postavkeRotacije, hr.nav.organizacija] as const;

const ROLES = [
  { title: 'an admin', state: ADMIN_STATE, tabs: ADMIN_TABS, more: ADMIN_MORE },
  { title: 'a member', state: MEMBER_STATE, tabs: MEMBER_TABS, more: [] as readonly string[] },
] as const;

const WIDTHS = [390, 320] as const;

/** Every cell's box in the phone bar: the four tab links and *Više*. */
async function cellBoxes(loginPage: LoginPage) {
  const cells = loginPage.navigation.locator(':scope > a, :scope > button');

  return cells.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();

      return { left: box.left, right: box.right, width: box.width, height: box.height };
    }),
  );
}

/** How far the bar's own content is wider than the bar; 0 or less is no scroll. */
async function navOverflow(page: Page): Promise<number> {
  return page
    .getByRole('navigation', { name: hr.shell.navigation })
    .evaluate((nav) => nav.scrollWidth - nav.clientWidth);
}

for (const width of WIDTHS) {
  for (const role of ROLES) {
    test.describe(`${role.title} at ${String(width)} px`, () => {
      test.use({
        storageState: role.state,
        viewport: { width, height: 800 },
        isMobile: true,
        hasTouch: true,
      });

      test('the bar holds exactly four tabs and Više, and nothing scrolls sideways', async ({
        page,
        loginPage,
      }) => {
        await page.goto('/danas');
        await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

        await expect(loginPage.navigation.getByRole('link')).toHaveText([...role.tabs]);
        await expect(loginPage.moreButton).toBeVisible();
        await expect(loginPage.navigation.getByRole('button')).toHaveCount(1);

        expect(await navOverflow(page), 'the bar scrolls sideways').toBeLessThanOrEqual(0);

        const boxes = await cellBoxes(loginPage);
        expect(boxes).toHaveLength(5);
        for (const box of boxes) {
          expect(box.height, 'a bar cell is below the 44 px target').toBeGreaterThanOrEqual(MINIMUM_TARGET);
          expect(box.left, 'a bar cell starts off screen').toBeGreaterThanOrEqual(0);
          expect(box.right, 'a bar cell ends off screen').toBeLessThanOrEqual(width);
          // Five equal cells across the whole width: 64 px each at 320 px.
          expect(box.width).toBeCloseTo(width / 5, 0);
        }

        // The current tab is marked and inside the viewport.
        const current = loginPage.navigationLink(hr.nav.danas, { exact: true });
        await expect(current).toHaveAttribute('aria-current', 'page');
        await expect(current).toBeInViewport({ ratio: 1 });
        await expect(loginPage.moreButton).not.toHaveAttribute('aria-current', 'page');
      });

      test('Više opens a labelled sheet with the rest, the theme and Odjava, and Escape returns focus', async ({
        loginPage,
        page,
      }) => {
        await page.goto('/danas');
        await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

        await expect(loginPage.moreButton).toHaveAttribute('aria-expanded', 'false');
        await loginPage.moreButton.click();
        await expect(loginPage.moreSheet).toBeVisible();
        await expect(loginPage.moreButton).toHaveAttribute('aria-expanded', 'true');

        const sheet = loginPage.moreSheet;
        await expect(sheet.getByRole('link')).toHaveText([...role.more]);
        await expect(sheet.getByRole('group', { name: hr.shell.theme.label })).toBeVisible();
        for (const name of [hr.shell.theme.system, hr.shell.theme.light, hr.shell.theme.dark]) {
          await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
        }
        await expect(sheet.getByRole('button', { name: hr.shell.signOut, exact: true })).toBeVisible();
        await expect(sheet.getByRole('button', { name: hr.shell.moreClose, exact: true })).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);

        await page.keyboard.press('Escape');
        await expect(loginPage.moreSheet).toBeHidden();
        await expect(loginPage.moreButton).toBeFocused();
        await expect(loginPage.moreButton).toHaveAttribute('aria-expanded', 'false');
      });

      if (role.more.length > 0) {
        test('following Sati from the sheet closes it and marks Više as current', async ({ loginPage, page }) => {
          await page.goto('/danas');
          await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

          await loginPage.moreButton.click();
          await loginPage.moreSheet.getByRole('link', { name: hr.nav.sati, exact: true }).click();

          await expect(page).toHaveURL('/sati');
          await expect(loginPage.moreSheet).toBeHidden();
          await expect(loginPage.moreButton).toHaveAttribute('aria-current', 'page');
          await expect(loginPage.moreButton).toBeInViewport({ ratio: 1 });
          await expect(loginPage.navigation.locator('[aria-current="page"]')).toHaveCount(1);

          // And inside the sheet the Sati row is the current one.
          await loginPage.moreButton.click();
          await expect(
            loginPage.moreSheet.getByRole('link', { name: hr.nav.sati, exact: true }),
          ).toHaveAttribute('aria-current', 'page');
        });
      }
    });
  }
}

test.describe('at a desktop viewport', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the profile menu holds the theme and Odjava, and the sidebar foot has no theme of its own', async ({
    page,
    loginPage,
    fixture,
  }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await expect(loginPage.themeGroup).toHaveCount(0);
    await expect(loginPage.moreButton).toBeHidden();

    await loginPage.profileButton(fixture.admin.name).click();
    await expect(loginPage.themeGroup).toBeVisible();
    for (const name of [hr.shell.theme.system, hr.shell.theme.light, hr.shell.theme.dark]) {
      await expect(loginPage.themeGroup.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(loginPage.signOutButton).toBeVisible();
  });
});

/** GoTrue's logout, `POST /auth/v1/logout`, and nothing else. */
function isLogout(url: URL): boolean {
  return url.pathname.endsWith('/auth/v1/logout');
}

/** The chrome's role read: `GET /rest/v1/members?select=role…`, and nothing else. */
function isRoleRead(url: URL): boolean {
  return url.pathname.endsWith('/rest/v1/members') && url.searchParams.get('select') === 'role';
}

test.describe('the I/O matrix at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.describe('as a member', () => {
    // The logout never reaches GoTrue: it is answered 500 here, so the shared
    // member session is never revoked and no other spec is disturbed.
    test.use({ storageState: MEMBER_STATE });

    // A REFUSED LOGOUT STILL SIGNS THIS DEVICE OUT (human decision 2026-10-06).
    // The pinned auth-js (`GoTrueClient._signOut`) removes the local session on
    // any logout error other than 401/403/404 before returning the error, so
    // the session-cache rule sees SIGNED_OUT and the guard sends the person to
    // the sign-in prompt. The server session that survives is ledgered in
    // `deferred-work.md`.
    test('a refused sign-out in the sheet still signs this device out', async ({ page, loginPage }) => {
      await page.route(isLogout, (route) =>
        route.fulfill({ status: 500, json: { code: 500, msg: 'e2e: logout refused' } }),
      );

      await page.goto('/danas');
      await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

      await loginPage.moreButton.click();
      await expect(loginPage.moreSheet).toBeVisible();
      await loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true }).click();

      await expect(page).toHaveURL(/\/prijava/);
      await expect(loginPage.organizationHeading).toBeVisible();
      await expect(loginPage.moreSheet).toHaveCount(0);
      await expect(loginPage.alertWith(hr.shell.error.signOut)).toHaveCount(0);
    });

    test('a role read that fails leaves no tabs, Više still opens theme and Odjava, and the alert offers a retry', async ({
      page,
      loginPage,
    }) => {
      // Answered as a PostgREST error rather than aborted: an aborted request
      // left the read pending (the skeleton) past the assertion's wait.
      await page.route(isRoleRead, (route) =>
        route.fulfill({
          status: 400,
          json: { code: '42703', details: null, hint: null, message: 'e2e: role read refused' },
        }),
      );

      await page.goto('/danas');

      await expect(loginPage.alertWith(hr.shell.error.destinations)).toBeVisible();
      await expect(page.getByRole('button', { name: hr.shell.retry, exact: true })).toBeVisible();
      await expect(loginPage.navigation.getByRole('link')).toHaveCount(0);

      await loginPage.moreButton.click();
      await expect(loginPage.moreSheet).toBeVisible();
      await expect(loginPage.moreSheet.getByRole('link')).toHaveCount(0);
      await expect(loginPage.moreSheet.getByRole('group', { name: hr.shell.theme.label })).toBeVisible();
      await expect(
        loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true }),
      ).toBeVisible();
    });

    test('while the role read is pending the tab area is a skeleton, and Više is already there', async ({
      page,
      loginPage,
    }) => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(isRoleRead, async (route) => {
        await held;
        await route.continue();
      });

      try {
        await page.goto('/danas');

        await expect(loginPage.navigation.locator('.animate-pulse')).toBeVisible();
        await expect(loginPage.navigation.getByRole('link')).toHaveCount(0);
        await expect(loginPage.moreButton).toBeVisible();
      } finally {
        release();
      }

      await expect(loginPage.navigation.getByRole('link')).toHaveText([...MEMBER_TABS]);
      await expect(loginPage.navigation.locator('.animate-pulse')).toHaveCount(0);
    });
  });
});

test.describe('closing the sheet at 390 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the close button and a backdrop press each close it, with focus back on Više', async ({
    page,
    loginPage,
  }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet).toBeVisible();
    await loginPage.moreSheet.getByRole('button', { name: hr.shell.moreClose, exact: true }).click();
    await expect(loginPage.moreSheet).toBeHidden();
    await expect(loginPage.moreButton).toBeFocused();

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet).toBeVisible();
    // The sheet is docked at the bottom, so the top of the viewport is backdrop.
    await page.mouse.click(195, 40);
    await expect(loginPage.moreSheet).toBeHidden();
    await expect(loginPage.moreButton).toBeFocused();
  });

  test('turning the viewport wide closes the sheet', async ({ page, loginPage }) => {
    await page.goto('/danas');
    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet).toBeVisible();

    await page.setViewportSize({ width: 1024, height: 844 });

    await expect(loginPage.moreSheet).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('pressing the row of the page already open closes the sheet', async ({ page, loginPage }) => {
    await page.goto('/sati');
    await expect(loginPage.moreButton).toHaveAttribute('aria-current', 'page');

    await loginPage.moreButton.click();
    const sati = loginPage.moreSheet.getByRole('link', { name: hr.nav.sati, exact: true });
    await expect(sati).toHaveAttribute('aria-current', 'page');
    await sati.click();

    await expect(loginPage.moreSheet).toBeHidden();
    await expect(page).toHaveURL('/sati');
  });
});

test.describe('at a desktop viewport, collapsed', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the collapsed rail’s profile menu still holds the theme and Odjava', async ({ page, loginPage, fixture }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await page.getByRole('button', { name: hr.shell.menuHide, exact: true }).click();
    await expect(page.getByRole('button', { name: hr.shell.menuShow, exact: true })).toBeVisible();

    await loginPage.profileButton(fixture.admin.name).click();
    await expect(loginPage.themeGroup).toBeVisible();
    await expect(loginPage.themeGroup.getByRole('button')).toHaveCount(3);
    for (const name of [hr.shell.theme.system, hr.shell.theme.light, hr.shell.theme.dark]) {
      await expect(loginPage.themeGroup.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(loginPage.signOutButton).toBeVisible();
  });
});

/** GoTrue's refresh grant, `POST /auth/v1/token?grant_type=refresh_token`. */
function isRefreshGrant(url: URL): boolean {
  return url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'refresh_token';
}

test.describe('a refused sign-out that keeps the session, at 390 px', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('closes the sheet, focuses the alert and stays on the page', async ({ page, loginPage }) => {
    // NOTHING REACHES GOTRUE. The logout is answered here (and is never even
    // sent on this path), and every refresh is a 503, which auth-js treats as
    // retryable and so never removes the session for.
    let logouts = 0;
    await page.route(isLogout, (route) => {
      logouts += 1;
      return route.fulfill({ status: 500, json: { code: 500, msg: 'e2e: logout refused' } });
    });
    await page.route(isRefreshGrant, (route) =>
      route.fulfill({ status: 503, json: { code: 503, msg: 'e2e: refresh unavailable' } }),
    );
    // A fake clock, so the refresh's own back-off (about 25 s) is run through
    // rather than waited for.
    await page.clock.install();

    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet).toBeVisible();

    // The stored session's access token is now past its expiry, so the
    // sign-out's own session read has to refresh, and that refresh fails
    // retryably: `_useSession` answers an error and `_signOut` returns it
    // WITHOUT removing the session (`GoTrueClient.js:3419-3420`).
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((name) => name.endsWith('-auth-token'));
      if (key === undefined) throw new Error('E2E: no stored session');
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as { expires_at?: number };
      stored.expires_at = Math.floor(Date.now() / 1000) - 60;
      localStorage.setItem(key, JSON.stringify(stored));
    });

    await loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true }).click();
    await page.clock.runFor(35_000);

    await expect(loginPage.moreSheet).toBeHidden();
    const alert = loginPage.alertWith(hr.shell.error.signOut);
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
    await expect(page).toHaveURL('/danas');
    expect(logouts, 'a logout was sent').toBe(0);
  });
});
