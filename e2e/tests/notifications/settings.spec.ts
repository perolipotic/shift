import type { Page } from '@playwright/test';

import { ADMIN_STATE, MEMBER_STATE, readFixture } from '../../utils/run-fixture.ts';
import {
  emailNotificationsOf,
  holdMemberEmailInSql,
  pushEndpointsOf,
  removePushEndpointInSql,
  restoreMemberEmailInSql,
  setEmailNotificationsInSql,
} from '../../utils/database-helper.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 10.3: *Obavijesti*, a fixed row in *Više* (and in the desktop profile
 * menu) for every role, opens `/obavijesti`: the member's own address with an
 * email on/off saved at once, or `Nemaš upisan e-mail` with no control; and
 * the organization's switch on *Organizacija*. The member's address, their
 * settings row and the organization's switch are set in SQL for a case and
 * restored after it.
 *
 * Story 10.4's push section is asserted here too, at the end, rather than in
 * a file of its own: its cases set the same member's address, and this file
 * runs serially, so no other file races them.
 */

const copy = hr.postavkeObavijesti;
const organization = hr.organization;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** Safari on an iPhone: a browser tab, never the installed app. */
const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

interface PushStub {
  /** The permission before any press. */
  readonly permission: 'default' | 'granted' | 'denied';
  /** What the prompt answers, when a press asks. */
  readonly answer?: 'default' | 'granted' | 'denied';
  /** The browser refuses to subscribe. */
  readonly failSubscribe?: boolean;
  readonly endpoint: string;
}

/**
 * A browser that can receive push, as far as the page can tell: an active
 * worker whose push manager keeps one subscription in `localStorage` (so it
 * survives a reload, as the browser's own does), and a `Notification` whose
 * permission the prompt sets. Counts the prompts in `__e2ePushPrompts`.
 */
async function stubPush(page: Page, stub: PushStub): Promise<void> {
  await page.addInitScript((options: PushStub) => {
    const SUBSCRIBED = '__e2e_push_subscribed';
    const PERMISSION = '__e2e_push_permission';
    const target = window as unknown as Record<string, unknown>;
    const subscription = () => ({
      endpoint: options.endpoint,
      toJSON: () => ({ endpoint: options.endpoint, keys: { p256dh: `B${'k'.repeat(86)}`, auth: 'a'.repeat(22) } }),
      unsubscribe: () => {
        localStorage.removeItem(SUBSCRIBED);
        localStorage.setItem('__e2e_push_unsubscribed', '1');
        return Promise.resolve(true);
      },
    });
    const pushManager = {
      getSubscription: () => Promise.resolve(localStorage.getItem(SUBSCRIBED) === '1' ? subscription() : null),
      subscribe: () => {
        if (options.failSubscribe === true) return Promise.reject(new DOMException('e2e', 'AbortError'));
        localStorage.setItem(SUBSCRIBED, '1');
        return Promise.resolve(subscription());
      },
    };
    const registration = { active: {}, pushManager };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: () => Promise.resolve(registration),
        ready: Promise.resolve(registration),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
    target['PushManager'] = function PushManager() {};
    target['__e2ePushPrompts'] = 0;
    let permission = localStorage.getItem(PERMISSION) ?? options.permission;
    target['Notification'] = {
      get permission() {
        return permission;
      },
      requestPermission: () => {
        target['__e2ePushPrompts'] = Number(target['__e2ePushPrompts']) + 1;
        permission = options.answer ?? 'granted';
        localStorage.setItem(PERMISSION, permission);
        return Promise.resolve(permission);
      },
    };
  }, stub);
}

function prompts(page: Page): Promise<number> {
  return page.evaluate(() => Number((window as unknown as Record<string, unknown>)['__e2ePushPrompts']));
}

test.describe.configure({ mode: 'serial' });

test.describe('a member on a phone, from Više', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE });

  test('opens the settings, and with no address says so and offers no control', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const held = await holdMemberEmailInSql(fixture.slug, fixture.member.username, null);
    try {
      await page.goto('/danas');
      await notificationsPage.moreButton.click();
      await notificationsPage.moreRow.click();

      await expect(page).toHaveURL(/\/obavijesti$/);
      await expect(notificationsPage.heading(copy.heading)).toBeVisible();
      await expect(notificationsPage.noAddress).toBeVisible();
      await expect(notificationsPage.radios).toHaveCount(0);
    } finally {
      await restoreMemberEmailInSql(held);
    }
  });

  test('shows the address, saves the choice at once, and keeps it across a reload', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const address = `${fixture.member.username}@example.org`;
    const held = await holdMemberEmailInSql(fixture.slug, fixture.member.username, address);
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.heading(copy.heading)).toBeVisible();
      await expect(notificationsPage.address(address)).toBeVisible();
      await expect(notificationsPage.emailOn).toBeChecked();

      await notificationsPage.emailOff.click();
      await expect(notificationsPage.savedLine(copy.statusOff)).toBeVisible();

      await page.reload();
      await expect(notificationsPage.emailOff).toBeChecked();
    } finally {
      await restoreMemberEmailInSql(held);
    }
  });

  test('a failed save says so and returns the control to the stored value', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const held = await holdMemberEmailInSql(fixture.slug, fixture.member.username, `${fixture.member.username}@example.org`);
    try {
      // Every write to the settings fails; the read still answers.
      await page.route('**/rest/v1/notification_settings*', (route) =>
        route.request().method() === 'GET'
          ? route.continue()
          : route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"e2e"}' }),
      );
      await notificationsPage.goto();
      await expect(notificationsPage.emailOn).toBeChecked();

      await notificationsPage.emailOff.click();
      await expect(notificationsPage.saveFailed).toBeVisible();
      await expect(notificationsPage.emailOn).toBeChecked();
    } finally {
      await page.unroute('**/rest/v1/notification_settings*');
      await restoreMemberEmailInSql(held);
    }
  });

  test('with the organization switch off, says the organization sends no email and offers no control', async ({
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const held = await holdMemberEmailInSql(fixture.slug, fixture.member.username, `${fixture.member.username}@example.org`);
    const was = await setEmailNotificationsInSql(fixture.slug, false);
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.organizationOff).toBeVisible();
      await expect(notificationsPage.radios).toHaveCount(0);
      // A member cannot turn it back on: no way to Organizacija.
      await expect(notificationsPage.organizationOffLink).toHaveCount(0);
    } finally {
      await setEmailNotificationsInSql(fixture.slug, was);
      await restoreMemberEmailInSql(held);
    }
  });
});

test.describe('a member on a desktop, from the profile menu', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 1280, height: 800 } });

  test('opens the settings from the profile menu, which closes', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    await page.goto('/danas');
    await notificationsPage.profileButton(fixture.member.name).click();
    await notificationsPage.profileRow.click();

    await expect(page).toHaveURL(/\/obavijesti$/);
    await expect(notificationsPage.heading(copy.heading)).toBeVisible();
    await expect(notificationsPage.profileMenu).toHaveCount(0);

    // Pressed again on the page itself: no pathname changes, and the menu still closes.
    await notificationsPage.profileButton(fixture.member.name).click();
    await notificationsPage.profileRow.click();
    await expect(notificationsPage.profileMenu).toHaveCount(0);
  });
});

test.describe('an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('also has the Obavijesti row, and with the switch off is shown the way to Organizacija', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const held = await holdMemberEmailInSql(fixture.slug, fixture.admin.username, `${fixture.admin.username}@example.org`);
    const was = await setEmailNotificationsInSql(fixture.slug, false);
    try {
      await page.goto('/danas');
      await notificationsPage.profileButton(fixture.admin.name).click();
      await notificationsPage.profileRow.click();
      await expect(page).toHaveURL(/\/obavijesti$/);

      await expect(notificationsPage.organizationOff).toBeVisible();
      await notificationsPage.organizationOffLink.click();
      await expect(page).toHaveURL(/\/organizacija$/);
    } finally {
      await setEmailNotificationsInSql(fixture.slug, was);
      await restoreMemberEmailInSql(held);
    }
  });

  test('turns the organization switch off in its dialog, and the database holds it', async ({ organizationPage }) => {
    const fixture = readFixture();
    const was = await setEmailNotificationsInSql(fixture.slug, true);
    try {
      await organizationPage.goto();
      await organizationPage.emailNotificationsOpener.click();
      const dialog = organizationPage.emailNotificationsDialog;
      await dialog.getByRole('radio', { name: organization.emailNotificationsOff, exact: true }).check();
      await organizationPage.saveIn(dialog).click();

      await expect(dialog).toHaveCount(0);
      await expect(organizationPage.text(organization.emailNotificationsStatusOff)).toBeVisible();
      await expect.poll(() => emailNotificationsOf(fixture.slug)).toBe(false);
    } finally {
      await setEmailNotificationsInSql(fixture.slug, was);
    }
  });
});

/*
 * Story 10.4: *Obavijesti na uređaju*, this device's push on/off, its own
 * section on `/obavijesti` beside the email one. The dev server runs no
 * service worker, so the browser's push is stubbed before the page loads
 * (`navigator.serviceWorker`, `PushManager`, `Notification`); the row it
 * registers is the real one, through `register_push_subscription`, and each
 * case removes its own endpoint after it.
 */

test.describe('story 10.4: push on this device, a member on a phone', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE });

  test('in a browser with no Web Push, says it cannot receive notifications, and the email section is its own', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const held = await holdMemberEmailInSql(fixture.slug, fixture.member.username, `${fixture.member.username}@example.org`);
    // A browser without `PushManager` (an older Safari, an in-app browser).
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>)['PushManager'];
    });
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.pushLine(copy.pushUnsupported)).toBeVisible();
      await expect(notificationsPage.pushRadios).toHaveCount(0);
      await expect(notificationsPage.emailOn).toBeChecked();
    } finally {
      await restoreMemberEmailInSql(held);
    }
  });

  test('with no address, still turns push on for this device (asking permission only on the press), keeps it across a reload, and turns it off', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-${Date.now()}`;
    const held = await holdMemberEmailInSql(fixture.slug, fixture.member.username, null);
    await stubPush(page, { permission: 'default', answer: 'granted', endpoint });
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.noAddress).toBeVisible();
      await expect(notificationsPage.pushOff).toBeChecked();
      expect(await prompts(page), 'the browser asked before any press').toBe(0);

      await notificationsPage.pushOn.click();
      await expect(notificationsPage.savedLine(copy.pushStatusOn)).toBeVisible();
      expect(await prompts(page)).toBe(1);
      await expect.poll(() => pushEndpointsOf(fixture.slug, fixture.member.username)).toContain(endpoint);

      await page.reload();
      await expect(notificationsPage.pushOn).toBeChecked();

      await notificationsPage.pushOff.click();
      await expect(notificationsPage.savedLine(copy.pushStatusOff)).toBeVisible();
      await expect.poll(() => pushEndpointsOf(fixture.slug, fixture.member.username)).not.toContain(endpoint);
    } finally {
      await removePushEndpointInSql(endpoint);
      await restoreMemberEmailInSql(held);
    }
  });

  test('a subscribe that fails says so and returns the control to off, with nothing registered', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-failed-${Date.now()}`;
    await stubPush(page, { permission: 'granted', failSubscribe: true, endpoint });
    try {
      await notificationsPage.goto();
      await notificationsPage.pushOn.click();

      await expect(notificationsPage.pushFailed).toBeVisible();
      await expect(notificationsPage.pushOff).toBeChecked();
      expect(await pushEndpointsOf(fixture.slug, fixture.member.username)).not.toContain(endpoint);
    } finally {
      await removePushEndpointInSql(endpoint);
    }
  });

  test('Odjava from Više forgets this device: its row is deleted and the browser unsubscribed', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-signout-${Date.now()}`;
    await stubPush(page, { permission: 'granted', endpoint });
    // The stored member session must outlive this case: the revocation is
    // answered here, so only this page's copy of the session ends.
    await page.route('**/auth/v1/logout**', (route) => route.fulfill({ status: 204, body: '' }));
    try {
      await notificationsPage.goto();
      await notificationsPage.pushOn.click();
      await expect(notificationsPage.savedLine(copy.pushStatusOn)).toBeVisible();
      await expect.poll(() => pushEndpointsOf(fixture.slug, fixture.member.username)).toContain(endpoint);

      await notificationsPage.moreButton.click();
      await notificationsPage.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true }).click();

      await expect(page).toHaveURL(/\/prijava/);
      await expect.poll(() => pushEndpointsOf(fixture.slug, fixture.member.username)).not.toContain(endpoint);
      await expect
        .poll(() => page.evaluate(() => [localStorage.getItem('__e2e_push_subscribed'), localStorage.getItem('__e2e_push_unsubscribed')]))
        .toEqual([null, '1']);
    } finally {
      await page.unroute('**/auth/v1/logout**');
      await removePushEndpointInSql(endpoint);
    }
  });

  test('a prompt answered "block" shows the blocked line and no control', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-blocked-${Date.now()}`;
    await stubPush(page, { permission: 'default', answer: 'denied', endpoint });
    try {
      await notificationsPage.goto();
      await notificationsPage.pushOn.click();

      await expect(notificationsPage.pushLine(copy.pushDenied)).toBeVisible();
      await expect(notificationsPage.pushRadios).toHaveCount(0);
      expect(await pushEndpointsOf(fixture.slug, fixture.member.username)).not.toContain(endpoint);
    } finally {
      await removePushEndpointInSql(endpoint);
    }
  });

  test('a prompt dismissed without an answer returns to off with no failure', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-dismissed-${Date.now()}`;
    await stubPush(page, { permission: 'default', answer: 'default', endpoint });
    try {
      await notificationsPage.goto();
      await notificationsPage.pushOn.click();

      await expect(notificationsPage.pushOff).toBeChecked();
      expect(await prompts(page)).toBe(1);
      await expect(notificationsPage.pushFailed).toHaveCount(0);
      expect(await pushEndpointsOf(fixture.slug, fixture.member.username)).not.toContain(endpoint);
    } finally {
      await removePushEndpointInSql(endpoint);
    }
  });

  test('offline, the choice is gated: the note says why, nothing is asked and nothing is registered', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-offline-${Date.now()}`;
    await stubPush(page, { permission: 'default', answer: 'granted', endpoint });
    try {
      await notificationsPage.goto();
      await expect(notificationsPage.pushOff).toBeChecked();
      await page.context().setOffline(true);

      await expect(notificationsPage.pushSection.getByText(hr.offline.needsConnection, { exact: true })).toBeVisible();
      await expect(notificationsPage.pushSection.getByRole('radiogroup')).toHaveAttribute('aria-disabled', 'true');
      // Pressed anyway: the gate refuses it.
      await notificationsPage.pushOn.click({ force: true });

      await expect(notificationsPage.pushOff).toBeChecked();
      expect(await prompts(page)).toBe(0);
      await page.context().setOffline(false);
      expect(await pushEndpointsOf(fixture.slug, fixture.member.username)).not.toContain(endpoint);
    } finally {
      await page.context().setOffline(false);
      await removePushEndpointInSql(endpoint);
    }
  });

  test('with the permission denied, says notifications are blocked in the browser settings and offers no control', async ({
    page,
    notificationsPage,
  }) => {
    const fixture = readFixture();
    await stubPush(page, { permission: 'denied', endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-denied` });

    await notificationsPage.goto();
    await expect(notificationsPage.pushLine(copy.pushDenied)).toBeVisible();
    await expect(notificationsPage.pushRadios).toHaveCount(0);
    expect(await prompts(page)).toBe(0);
  });
});

test.describe('story 10.4: push on this device, a member on an iPhone, in Safari', () => {
  test.use({ storageState: MEMBER_STATE, ...PHONE, userAgent: IPHONE_SAFARI_UA });

  test('says push needs the installed app, and offers no control', async ({ page, notificationsPage }) => {
    const fixture = readFixture();
    // Even a tab that reports push: on iOS it needs the installed app.
    await stubPush(page, { permission: 'default', endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${fixture.member.username}-ios` });

    await notificationsPage.goto();
    await expect(notificationsPage.pushLine(copy.pushIosInstall)).toBeVisible();
    await expect(notificationsPage.pushRadios).toHaveCount(0);
  });
});
