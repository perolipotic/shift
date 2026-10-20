import { hr } from '../../utils/i18n.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 8.2: a surface read online reads offline. A member reads *Danas*
 * online — the calendar snapshot, their own leave and resolutions, the member
 * list and the organization, every read *Kalendar* needs for a member too.
 * The connection drops, and a client-side navigation opens *Kalendar*: the
 * month renders whole under *Bez veze · stanje od …*, with no unavailable
 * message and no request. When the connection comes back, the note goes, and
 * the month is drawn from the fresh read.
 *
 * An admin's *Danas* — *Treba tebe*, the coverage, the absences and the week,
 * over the organization's leave and resolutions — reads offline the same
 * way, under ONE note, and so does their *Kalendar*.
 */

test.describe('offline reading, as a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('Kalendar opens offline from what Danas read, under the as-of note, and the note goes on reconnect', async ({
    page,
    todayPage,
    calendarPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.heading(hr.nav.danas)).toBeVisible();
    // Every read Danas stands on has landed: the tiles need all five.
    await expect(todayPage.hoursTile).toBeVisible();
    await expect(todayPage.leaveTile).toBeVisible();
    await expect(todayPage.busyMain).toHaveCount(0);
    await expect(todayPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    await expect(todayPage.offlineNote, 'Danas, offline, draws its snapshot under the note').toBeVisible();

    // A client-side navigation: no document request, the app shell stays.
    await calendarPage.navigationLink(hr.nav.kalendar, { exact: true }).click();
    await expect(calendarPage.heading(hr.nav.kalendar)).toBeVisible();
    await expect(calendarPage.offlineNote).toBeVisible();
    await expect(calendarPage.grid).toBeVisible();
    await expect(calendarPage.unavailableAlert).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(calendarPage.offlineNote).toHaveCount(0);
    await expect(calendarPage.grid).toBeVisible();
    await expect(calendarPage.unavailableAlert).toHaveCount(0);
  });
});

test.describe('offline reading, as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test("the admin's Danas and Kalendar read offline under one note each, and the note goes on reconnect", async ({
    page,
    todayPage,
    calendarPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.heading(hr.nav.danas)).toBeVisible();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.weekCard).toBeVisible();
    await expect(todayPage.busyMain).toHaveCount(0);
    await expect(todayPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    await expect(todayPage.offlineNote, 'the admin Danas shows exactly one note').toHaveCount(1);
    await expect(todayPage.offlineNote).toBeVisible();
    await expect(todayPage.needsYouCard, 'the admin body is drawn offline').toBeVisible();
    await expect(todayPage.weekCard).toBeVisible();
    await expect(todayPage.alertWith(hr.danas.admin.unavailable)).toHaveCount(0);

    await calendarPage.navigationLink(hr.nav.kalendar, { exact: true }).click();
    await expect(calendarPage.heading(hr.nav.kalendar)).toBeVisible();
    await expect(calendarPage.offlineNote).toHaveCount(1);
    await expect(calendarPage.grid).toBeVisible();
    await expect(calendarPage.unavailableAlert).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(calendarPage.offlineNote).toHaveCount(0);
    await expect(calendarPage.grid).toBeVisible();
  });
});
