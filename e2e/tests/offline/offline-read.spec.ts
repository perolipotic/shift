import { randomBytes, randomUUID } from 'node:crypto';

import {
  holdRotation,
  removeLeaveRecordsInSql,
  removeSeededRotation,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
} from '../../utils/database-helper.ts';
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
 *
 * Story 8.2c: the admin's work surfaces read offline the same way. *Raspored*
 * read online — *Riješeni* too, names and all — opens offline under the note
 * on both tabs; a *Riješeni* never opened online is unavailable, with no
 * note. A resolution page and a member page read online open offline under
 * ONE note each — the member page's leave card decides with the page, and
 * adds none — and reconnecting removes it. A member page whose leave was
 * never read is unavailable offline as a whole, with no note; a real open
 * conflict (the conflicts specs' seeded rotation) opens offline ready, under
 * one note, from Raspored's row.
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

test.describe("offline reading of the admin's work surfaces (story 8.2c)", () => {
  test.use({ storageState: ADMIN_STATE });

  test('Raspored read online opens offline under the note on both tabs, and the note goes on reconnect', async ({
    page,
    todayPage,
    conflictsPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await conflictsPage.navigationLink(hr.nav.raspored, { exact: true }).click();
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(conflictsPage.busyMain).toHaveCount(0);
    // *Riješeni* reads the names of whoever decided once it is open: read them
    // online — its count stands only once they have landed.
    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedCount).toBeVisible();
    await expect(conflictsPage.retryButton).toHaveCount(0);
    await conflictsPage.unresolvedTab.click();
    await expect(conflictsPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    // Leave and enter again, with no connection.
    await todayPage.navigationLink(hr.nav.danas, { exact: true }).click();
    await expect(todayPage.heading(hr.nav.danas)).toBeVisible();
    await conflictsPage.navigationLink(hr.nav.raspored, { exact: true }).click();
    await expect(conflictsPage.heading(hr.nav.raspored)).toBeVisible();
    await expect(conflictsPage.offlineNote).toHaveCount(1);
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(conflictsPage.retryButton).toHaveCount(0);

    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedTab).toHaveAttribute('aria-selected', 'true');
    await expect(conflictsPage.offlineNote, 'Riješeni, read online, opens offline under the note').toHaveCount(1);
    await expect(conflictsPage.resolvedCount).toBeVisible();
    await expect(conflictsPage.retryButton).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(conflictsPage.offlineNote).toHaveCount(0);
    await expect(conflictsPage.retryButton).toHaveCount(0);
  });

  test('going offline on an open Raspored keeps the queue under the note, and Riješeni never opened online is unavailable, with no note', async ({
    page,
    todayPage,
    conflictsPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await conflictsPage.navigationLink(hr.nav.raspored, { exact: true }).click();
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(conflictsPage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(conflictsPage.offlineNote, 'the queue read online is drawn under the note').toHaveCount(1);
    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedTab).toHaveAttribute('aria-selected', 'true');
    await expect(conflictsPage.retryButton).toBeVisible();
    await expect(conflictsPage.offlineNote).toHaveCount(0);
  });

  test('a resolution page and a member page read online open offline under one note each, and the note goes on reconnect', async ({
    page,
    fixture,
    resolutionPage,
    peoplePage,
  }) => {
    // A conflict that is not open: the page reads its five reads all the same,
    // and says so — a snapshot drawn, never the unavailable state.
    await resolutionPage.gotoConflict(randomUUID(), '2026-06-15', fixture.team.id);
    await expect(resolutionPage.heading(hr.raspored.resolution.heading)).toBeVisible();
    await expect(resolutionPage.missingLine).toBeVisible();
    await expect(resolutionPage.busyMain).toHaveCount(0);
    await expect(resolutionPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    // The member page, by client-side navigation: the edit's reads and the leave card's.
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.table).toBeVisible();
    await peoplePage.editLink(fixture.member.name).first().click();
    await expect(peoplePage.memberHeading(fixture.member.name)).toBeVisible();
    // The leave year in the heading: the card's reads have all landed.
    await expect(peoplePage.leaveHeading).toHaveText(/\d{4}/);
    await expect(peoplePage.retryLeaveButton).toHaveCount(0);
    await expect(peoplePage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    await expect(peoplePage.offlineNote, 'the member page shows exactly one note').toHaveCount(1);
    await expect(peoplePage.memberHeading(fixture.member.name)).toBeVisible();
    await expect(peoplePage.basicsCard).toBeVisible();
    await expect(peoplePage.leaveHeading).toHaveText(/\d{4}/);
    await expect(peoplePage.retryLeaveButton).toHaveCount(0);

    // Back to the resolution page, with no connection: the list, then the conflict.
    await page.goBack();
    await expect(peoplePage.table).toBeVisible();
    await page.goBack();
    await expect(resolutionPage.heading(hr.raspored.resolution.heading)).toBeVisible();
    await expect(resolutionPage.offlineNote).toHaveCount(1);
    await expect(resolutionPage.missingLine).toBeVisible();
    await expect(resolutionPage.alertWith(hr.raspored.resolution.unavailable)).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(resolutionPage.offlineNote).toHaveCount(0);
    await expect(resolutionPage.missingLine).toBeVisible();

    // And forward to the member page, online again: no note.
    await page.goForward();
    await page.goForward();
    await expect(peoplePage.memberHeading(fixture.member.name)).toBeVisible();
    await expect(peoplePage.leaveHeading).toHaveText(/\d{4}/);
    await expect(peoplePage.offlineNote).toHaveCount(0);
  });
  test('a member page whose leave was never read is unavailable offline as a whole, with no note', async ({
    page,
    fixture,
    todayPage,
    peoplePage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    // The member list is read — the table — but this member's page, and so their leave, never is.
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.table).toBeVisible();
    await expect(peoplePage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await peoplePage.editLink(fixture.member.name).first().click();
    await expect(page).toHaveURL(/\/ljudi\/[^/]+$/);
    // The member is in the cached list, yet the page is never half drawn: the member read is unavailable too.
    await expect(peoplePage.basicsCard.getByRole('button', { name: hr.ljudi.error.retry, exact: true })).toBeVisible();
    await expect(peoplePage.memberHeading(fixture.member.name)).toHaveCount(0);
    await expect(peoplePage.offlineNote).toHaveCount(0);
  });

  test('an open conflict read online opens offline whole under one note, from Raspored, by client-side navigation', async ({
    page,
    fixture,
    conflictsPage,
    resolutionPage,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // The conflicts specs' scenario: a team of its own with a rotation from
    // today (Dan, Noć, Slobodno, Slobodno), a member on it, and leave over
    // today, so today's Dan is an open conflict.
    const hold = holdRotation(fixture.slug);
    let rotation: Awaited<ReturnType<typeof seedTeamRotation>> | null = null;
    let member: { readonly id: string; readonly name: string } | null = null;

    try {
      await hold.ready;
      const suffix = randomBytes(3).toString('hex');
      const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);

      rotation = await seedTeamRotation(fixture.slug, team.id, suffix);
      const { today } = rotation;

      member = await seedLeaveMember(fixture.slug, team.id, today, 20);
      await seedLeaveRecord(fixture.slug, member.id, today, today);

      await resolutionPage.gotoConflict(member.id, today, team.id);
      await expect(resolutionPage.heading(hr.raspored.resolution.heading)).toBeVisible();
      await expect(resolutionPage.acceptOption).toBeVisible();
      await expect(resolutionPage.busyMain).toHaveCount(0);
      await expect(resolutionPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

      await page.context().setOffline(true);
      await expect(resolutionPage.offlineNote, 'the open conflict, offline, under one note').toHaveCount(1);

      // Away to the queue and back to the conflict, with no connection.
      await resolutionPage.backLink.click();
      await expect(conflictsPage.offlineNote).toHaveCount(1);
      const row = conflictsPage.rowsOf(member.name).first();

      await expect(row).toBeVisible();
      await conflictsPage.rowLink(row).click();
      await expect(page).toHaveURL(`/raspored/${member.id}/${today}/${team.id}`);
      await expect(resolutionPage.offlineNote).toHaveCount(1);
      await expect(resolutionPage.acceptOption).toBeVisible();
      await expect(resolutionPage.alertWith(hr.raspored.resolution.unavailable)).toHaveCount(0);

      await page.context().setOffline(false);
      await expect(resolutionPage.offlineNote).toHaveCount(0);
      await expect(resolutionPage.acceptOption).toBeVisible();
    } finally {
      if (member !== null) await removeLeaveRecordsInSql(fixture.slug, member.id).catch(() => undefined);
      if (rotation !== null) await removeSeededRotation(rotation).catch(() => undefined);
      await hold.release();
    }
  });
});
