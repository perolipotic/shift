import type { Page } from '@playwright/test';

import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 8.4: *Instaliraj* in *Više* (and in the desktop profile menu), drawn
 * only where it can do something. The dev server registers no worker and
 * links no manifest, so Chrome never offers a real prompt here: the events
 * are synthesized.
 */

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
/** Instagram's in-app browser: WebKit on an iPhone, with no Add to Home Screen. */
const IPHONE_INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.2.23.88';
/** iPadOS asks for the desktop site: desktop Safari's user agent. */
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

interface InstallProbe {
  __installPrompts: number;
  __installPrevented: boolean | null;
  __answerInstall?: () => void;
}

/**
 * A synthetic `beforeinstallprompt` whose `prompt()` is counted on
 * `window.__installPrompts` and whose choice is `dismissed`. Runs in the
 * page; returns whether the app kept the browser from showing its own
 * (`preventDefault`).
 */
function dispatchInstallPrompt(): boolean {
  const probe = window as unknown as InstallProbe;
  probe.__installPrompts = 0;
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt: () => {
      probe.__installPrompts += 1;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
  });
  window.dispatchEvent(event);
  probe.__installPrevented = event.defaultPrevented;
  return event.defaultPrevented;
}

/**
 * As {@link dispatchInstallPrompt}, but the member has not answered yet: the
 * choice settles only when the test calls `window.__answerInstall()`.
 */
function dispatchUnansweredInstallPrompt(): void {
  const probe = window as unknown as InstallProbe;
  probe.__installPrompts = 0;
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt: () => {
      probe.__installPrompts += 1;
      return Promise.resolve();
    },
    userChoice: new Promise((resolve) => {
      probe.__answerInstall = () => resolve({ outcome: 'dismissed', platform: 'web' });
    }),
  });
  window.dispatchEvent(event);
}

async function offerInstallPrompt(page: Page): Promise<boolean> {
  return page.evaluate(dispatchInstallPrompt);
}

async function promptCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as InstallProbe).__installPrompts);
}

test.describe('on a phone', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE });

  test('a held prompt shows Instaliraj in Više; only the press opens it, and focus moves to Odjava', async ({
    page,
    loginPage,
  }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    expect(await offerInstallPrompt(page), 'the browser showed its own prompt').toBe(true);
    // Nothing opens by itself.
    expect(await promptCount(page)).toBe(0);

    await loginPage.moreButton.click();
    const install = loginPage.moreSheet.getByRole('button', { name: hr.shell.install, exact: true });
    await expect(install).toBeVisible();
    await expect(install).not.toHaveAttribute('aria-expanded');

    await install.click();
    await expect.poll(() => promptCount(page)).toBe(1);
    // The choice was made: the event is spent and the row is gone, the
    // sheet stays open, and focus is on Odjava rather than the page.
    await expect(install).toHaveCount(0);
    await expect(loginPage.moreSheet).toBeVisible();
    await expect(loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true })).toBeFocused();
  });

  test('while its prompt shows the row is aria-disabled, and a second press opens nothing', async ({
    page,
    loginPage,
  }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
    await page.evaluate(dispatchUnansweredInstallPrompt);

    await loginPage.moreButton.click();
    const install = loginPage.moreSheet.getByRole('button', { name: hr.shell.install, exact: true });
    await expect(install).not.toHaveAttribute('aria-disabled');

    await install.click();
    await expect.poll(() => promptCount(page)).toBe(1);
    await expect(install).toHaveAttribute('aria-disabled', 'true');
    // Playwright waits for an `aria-disabled` control to be enabled; the
    // member's press is not refused, it does nothing.
    await install.click({ force: true });
    expect(await promptCount(page)).toBe(1);

    await page.evaluate(() => (window as unknown as InstallProbe).__answerInstall?.());
    await expect(install).toHaveCount(0);
  });

  test('a prompt the browser offers before the app renders is held all the same', async ({ page, loginPage }) => {
    await page.addInitScript(`document.addEventListener('DOMContentLoaded', () => (${dispatchInstallPrompt.toString()})());`);
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    const install = loginPage.moreSheet.getByRole('button', { name: hr.shell.install, exact: true });
    await expect(install).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as InstallProbe).__installPrevented)).toBe(true);

    await install.click();
    await expect.poll(() => promptCount(page)).toBe(1);
  });

  test('without a prompt or iOS, Više has no Instaliraj', async ({ page, loginPage }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true })).toBeVisible();
    await expect(loginPage.installButton).toHaveCount(0);
  });

  test('appinstalled removes the row', async ({ page, loginPage }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
    await offerInstallPrompt(page);

    await loginPage.moreButton.click();
    await expect(loginPage.installButton).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(loginPage.installButton).toHaveCount(0);
    expect(await promptCount(page)).toBe(0);
  });
});

test.describe('on an iPhone, in any browser', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE, userAgent: IPHONE_UA });

  test('Instaliraj reveals the Share → Add to Home Screen steps inline', async ({ page, loginPage }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    const install = loginPage.moreSheet.getByRole('button', { name: hr.shell.install, exact: true });
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute('aria-expanded', 'false');
    const steps = loginPage.moreSheet.getByText(hr.shell.installIosSteps, { exact: true });
    await expect(steps).toBeHidden();

    await install.click();
    await expect(install).toHaveAttribute('aria-expanded', 'true');
    await expect(steps).toBeVisible();
    const controls = await install.getAttribute('aria-controls');
    expect(await steps.getAttribute('id')).toBe(controls);
    // One dialog: the sheet. The steps open none of their own.
    await expect(loginPage.dialogs).toHaveCount(1);

    await install.click();
    await expect(steps).toBeHidden();

    // The steps close with the sheet: reopened, they are closed.
    await install.click();
    await expect(steps).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(loginPage.moreSheet).toBeHidden();
    await loginPage.moreButton.click();
    await expect(install).toHaveAttribute('aria-expanded', 'false');
    await expect(steps).toBeHidden();
  });

  test('a standalone display mode shows no Instaliraj, even with a prompt held', async ({ page, loginPage }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        if (!query.includes('display-mode: standalone')) return original(query);
        // An installed app's answer: standalone, and it never changes.
        const standalone: MediaQueryList = {
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        };
        return standalone;
      };
    });
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();
    await offerInstallPrompt(page);

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true })).toBeVisible();
    await expect(loginPage.installButton).toHaveCount(0);
  });

  test('navigator.standalone (opened from the Home Screen) shows no Instaliraj', async ({ page, loginPage }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    });
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true })).toBeVisible();
    await expect(loginPage.installButton).toHaveCount(0);
  });
});

test.describe('in an iPhone app\'s in-app browser', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE, userAgent: IPHONE_INSTAGRAM_UA });

  test('Više has no Instaliraj: the in-app browser cannot add to the Home Screen', async ({ page, loginPage }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.moreButton.click();
    await expect(loginPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true })).toBeVisible();
    await expect(loginPage.installButton).toHaveCount(0);
  });
});

test.describe('on the desktop', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the profile menu shows Instaliraj when a prompt is held, and not without one', async ({
    page,
    loginPage,
    fixture,
  }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.profileButton(fixture.admin.name).click();
    await expect(loginPage.signOutButton).toBeVisible();
    await expect(loginPage.installButton).toHaveCount(0);

    await offerInstallPrompt(page);
    await expect(loginPage.installButton).toBeVisible();

    await loginPage.installButton.click();
    await expect.poll(() => promptCount(page)).toBe(1);
    await expect(loginPage.installButton).toHaveCount(0);
    await expect(loginPage.signOutButton).toBeFocused();
  });
});

test.describe('on an iPad (iPadOS, desktop site)', () => {
  test.use({ storageState: ADMIN_STATE, userAgent: IPAD_UA, hasTouch: true });

  test('the profile menu reveals the iOS steps, and they wrap inside the collapsed rail\'s menu', async ({
    page,
    loginPage,
    fixture,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    });
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.menuHideButton.click();
    await loginPage.profileButton(fixture.admin.name).click();
    const install = loginPage.installButton;
    await expect(install).toHaveAttribute('aria-expanded', 'false');

    await install.click();
    const steps = loginPage.profileMenu.getByText(hr.shell.installIosSteps, { exact: true });
    await expect(steps).toBeVisible();
    expect(await steps.getAttribute('id')).toBe(await install.getAttribute('aria-controls'));

    // Inside its menu and on screen: the text wraps, it never overflows.
    const fit = await steps.evaluate((element) => {
      const own = element.getBoundingClientRect();
      const menu = element.closest('#profile-menu')?.getBoundingClientRect();
      return {
        inMenu: menu !== undefined && own.left >= menu.left && own.right <= menu.right,
        onScreen: own.right <= window.innerWidth,
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(fit).toEqual({ inMenu: true, onScreen: true, overflow: 0 });

    // The steps close with the menu: reopened, they are closed.
    await page.keyboard.press('Escape');
    await expect(loginPage.profileMenu).toHaveCount(0);
    await loginPage.profileButton(fixture.admin.name).click();
    await expect(install).toHaveAttribute('aria-expanded', 'false');
    await expect(steps).toBeHidden();
  });
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the sign-in screen offers no install, holds the prompt and opens nothing', async ({ page, loginPage }) => {
    await page.goto(loginPage.path);
    await expect(loginPage.organizationInput).toBeVisible();
    expect(await offerInstallPrompt(page), 'the browser showed its own prompt on sign-in').toBe(true);
    await expect(loginPage.installButton).toHaveCount(0);
    expect(await promptCount(page)).toBe(0);
  });
});
