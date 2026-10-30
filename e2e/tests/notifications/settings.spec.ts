import { ADMIN_STATE, MEMBER_STATE, readFixture } from '../../utils/run-fixture.ts';
import {
  emailNotificationsOf,
  holdMemberEmailInSql,
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
 */

const copy = hr.postavkeObavijesti;
const organization = hr.organization;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

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
