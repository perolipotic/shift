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
 *
 * Story 8.2b: *Sati*, *Godišnji* and *Ljudi* (the members' directory and the
 * admin's table) read offline the same way. A member reads all four online;
 * offline, each opens under the note, with no unavailable message. An admin
 * reads *Ljudi* online; offline, entering it again runs its role guard on the
 * level cached on the device — never pending — and the table renders under the
 * note. An admin's *Sati* opens offline from what *Danas* read, and the
 * overview from *Godišnji*'s own read; a member's team roster opens offline
 * from the roster the directory read.
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

test.describe('offline reading of Sati, Godišnji and Ljudi, as a member (story 8.2b)', () => {
  test.use({ storageState: MEMBER_STATE });

  test('each surface read online opens offline under the as-of note, and the note goes on reconnect', async ({
    page,
    todayPage,
    hoursPage,
    leavePage,
    peoplePage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.hoursTile).toBeVisible();
    await expect(todayPage.leaveTile).toBeVisible();
    await expect(todayPage.busyMain).toHaveCount(0);

    // Online, each surface once, by client-side navigation.
    await hoursPage.navigationLink(hr.nav.sati, { exact: true }).click();
    await expect(hoursPage.totalTile).toBeVisible();
    await expect(hoursPage.busyMain).toHaveCount(0);
    await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
    await expect(leavePage.allowanceFigure).toBeVisible();
    await expect(leavePage.busyMain).toHaveCount(0);
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.directoryGroups.first()).toBeVisible();
    await expect(peoplePage.busyMain).toHaveCount(0);
    await expect(peoplePage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    await expect(peoplePage.offlineNote, 'the directory, offline, draws its snapshot under the note').toHaveCount(1);
    await expect(peoplePage.directoryGroups.first()).toBeVisible();
    await expect(peoplePage.alert).toHaveCount(0);

    await hoursPage.navigationLink(hr.nav.sati, { exact: true }).click();
    await expect(hoursPage.heading(hr.sati.title.own)).toBeVisible();
    await expect(hoursPage.offlineNote).toHaveCount(1);
    await expect(hoursPage.totalTile).toBeVisible();
    await expect(hoursPage.unavailableAlert).toHaveCount(0);

    await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
    await expect(leavePage.heading(hr.nav.godisnji)).toBeVisible();
    await expect(leavePage.offlineNote).toHaveCount(1);
    await expect(leavePage.allowanceFigure).toBeVisible();
    await expect(leavePage.retryButton).toHaveCount(0);

    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.heading(hr.nav.ljudi)).toBeVisible();
    await expect(peoplePage.offlineNote).toHaveCount(1);
    await expect(peoplePage.directoryGroups.first()).toBeVisible();
    await expect(peoplePage.directoryRetry).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(peoplePage.offlineNote).toHaveCount(0);
    await expect(peoplePage.directoryGroups.first()).toBeVisible();
  });

  test("a team's roster the directory read opens offline under the note", async ({ page, todayPage, peoplePage }) => {
    await todayPage.goto();
    await expect(todayPage.busyMain).toHaveCount(0);
    // The directory reads one roster per active team, the member's own among them.
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.directoryGroups.first()).toBeVisible();
    await expect(peoplePage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    // The directory links no line, so the roster is opened from Danas's team link — a client-side navigation.
    await todayPage.navigationLink(hr.nav.danas, { exact: true }).click();
    const rosterLink = todayPage.rosterLinks.first();

    await expect(rosterLink).toBeVisible();
    const team = ((await rosterLink.textContent()) ?? '').trim();

    expect(team, 'the roster link names a team').not.toBe('');
    await rosterLink.click();
    await expect(page).toHaveURL(/\/smjene\/[^/]+$/);
    await expect(peoplePage.heading(team, { exact: true })).toBeVisible();
    await expect(peoplePage.offlineNote).toHaveCount(1);
    await expect(peoplePage.alert).toHaveCount(0);
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

test.describe("offline reading of the admin's Sati, Godišnji and Ljudi table (story 8.2b)", () => {
  test.use({ storageState: ADMIN_STATE });

  test("the admin's Sati opens offline from what Danas read, and Godišnji's overview from its own read", async ({
    page,
    todayPage,
    hoursPage,
    leavePage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.busyMain).toHaveCount(0);
    // The overview's records are Godišnji's own read: read once online.
    await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
    await expect(leavePage.overviewTable).toBeVisible();
    await expect(leavePage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await hoursPage.navigationLink(hr.nav.sati, { exact: true }).click();
    await expect(hoursPage.heading(hr.nav.sati, { exact: true })).toBeVisible();
    await expect(hoursPage.offlineNote).toHaveCount(1);
    await expect(hoursPage.organizationTable).toBeVisible();
    await expect(hoursPage.unavailableAlert).toHaveCount(0);

    await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
    await expect(leavePage.heading(hr.nav.godisnji)).toBeVisible();
    await expect(leavePage.offlineNote).toHaveCount(1);
    await expect(leavePage.overviewTable).toBeVisible();
    await expect(leavePage.overviewUnavailable).toHaveCount(0);
  });

  test('entering Ljudi offline opens the table on the cached level, under the note, never pending', async ({
    page,
    todayPage,
    peoplePage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.table).toBeVisible();
    await expect(peoplePage.busyMain).toHaveCount(0);
    await expect(peoplePage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    // Leave and enter again: the role guard runs on entering, with no connection.
    await todayPage.navigationLink(hr.nav.danas, { exact: true }).click();
    await expect(todayPage.heading(hr.nav.danas)).toBeVisible();
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.heading(hr.nav.ljudi)).toBeVisible();
    await expect(peoplePage.offlineNote).toHaveCount(1);
    await expect(peoplePage.table).toBeVisible();
    await expect(peoplePage.alertWith(hr.ljudi.error.unavailable)).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(peoplePage.offlineNote).toHaveCount(0);
    await expect(peoplePage.table).toBeVisible();
  });
});
