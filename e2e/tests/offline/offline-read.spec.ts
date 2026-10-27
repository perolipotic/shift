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
 * Story 8.2c: the admin's work surfaces read offline the same way. *Za odluku*
 * read online — *Odlučeno* too, names and all — opens offline under the note
 * on both tabs; a *Odlučeno* never opened online is unavailable, with no
 * note. A resolution page and a member page read online open offline under
 * ONE note each — the member page's leave card decides with the page, and
 * adds none — and reconnecting removes it. A member page whose leave was
 * never read is unavailable offline as a whole, with no note; a real open
 * conflict (the conflicts specs' seeded rotation) opens offline ready, under
 * one note, from Za odluku's row.
 *
 * Story 8.2d: the settings surfaces read offline the same way. An admin reads
 * *Ljudi/smjene*, *Organizacija*, *Satni pojasi* and *Postavke rotacije*
 * online; offline, each opens under one note, with no *Pokušaj ponovno* —
 * the editor's dialog over *Satni pojasi* too — and reconnecting removes the
 * note; a team's and a shift type's editor over the cached lists hold their
 * values, with no alert. An *Organizacija* never read online is unavailable
 * offline, with no read retry and no note, never an endless skeleton; its
 * cards come back with the connection. A *Postavke rotacije* never read, or
 * with only its shift types cached, is unavailable as a whole, both sections,
 * with no retry and no note.
 *
 * Story 8.2e: no surface offers *Pokušaj ponovno* offline — its re-read would
 * pause until the connection returns. A member's *Danas*, *Kalendar*, *Sati*
 * and *Godišnji* never read online are unavailable offline with no retry, and
 * so are an admin's *Ljudi* table and *Godišnji* overview; an admin *Danas*, a
 * resolution page and the chrome's role notice whose read failed online offer
 * the retry online and none offline. A retry that had focus when the
 * connection dropped (*Kalendar*, the organization card) hands it to its
 * alert, and online the retry is back.
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

  test('Za odluku read online opens offline under the note on both tabs, and the note goes on reconnect', async ({
    page,
    todayPage,
    conflictsPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await conflictsPage.navigationLink(hr.nav.zaOdluku, { exact: true }).click();
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(conflictsPage.busyMain).toHaveCount(0);
    // *Odlučeno* reads the names of whoever decided once it is open: read them
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
    await conflictsPage.navigationLink(hr.nav.zaOdluku, { exact: true }).click();
    await expect(conflictsPage.heading(hr.nav.zaOdluku)).toBeVisible();
    await expect(conflictsPage.offlineNote).toHaveCount(1);
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(conflictsPage.retryButton).toHaveCount(0);

    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedTab).toHaveAttribute('aria-selected', 'true');
    await expect(conflictsPage.offlineNote, 'Odlučeno, read online, opens offline under the note').toHaveCount(1);
    await expect(conflictsPage.resolvedCount).toBeVisible();
    await expect(conflictsPage.retryButton).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(conflictsPage.offlineNote).toHaveCount(0);
    await expect(conflictsPage.retryButton).toHaveCount(0);
  });

  test('going offline on an open Za odluku keeps the queue under the note, and Odlučeno never opened online is unavailable, with no note', async ({
    page,
    todayPage,
    conflictsPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await conflictsPage.navigationLink(hr.nav.zaOdluku, { exact: true }).click();
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(conflictsPage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(conflictsPage.offlineNote, 'the queue read online is drawn under the note').toHaveCount(1);
    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedTab).toHaveAttribute('aria-selected', 'true');
    await expect(conflictsPage.alertWith(hr.zaOdluku.unavailable)).toBeVisible();
    // STORY 8.2e: no read retry offline; it comes back with the connection.
    await expect(conflictsPage.retryButton).toHaveCount(0);
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
    await expect(resolutionPage.heading(hr.zaOdluku.resolution.heading)).toBeVisible();
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
    await expect(resolutionPage.heading(hr.zaOdluku.resolution.heading)).toBeVisible();
    await expect(resolutionPage.offlineNote).toHaveCount(1);
    await expect(resolutionPage.missingLine).toBeVisible();
    await expect(resolutionPage.alertWith(hr.zaOdluku.resolution.unavailable)).toHaveCount(0);

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
    // The member is in the cached list, yet the page is never half drawn: the
    // member read is unavailable too — with no read retry offline (story 8.2e).
    await expect(peoplePage.basicsCard.getByRole('alert')).toBeVisible();
    await expect(peoplePage.basicsCard.getByRole('button', { name: hr.ljudi.error.retry, exact: true })).toHaveCount(0);
    await expect(peoplePage.retryLeaveButton).toHaveCount(0);
    await expect(peoplePage.teamsRetry).toHaveCount(0);
    await expect(peoplePage.memberHeading(fixture.member.name)).toHaveCount(0);
    await expect(peoplePage.offlineNote).toHaveCount(0);
  });

  test('an open conflict read online opens offline whole under one note, from Za odluku, by client-side navigation', async ({
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
      await expect(resolutionPage.heading(hr.zaOdluku.resolution.heading)).toBeVisible();
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
      await expect(page).toHaveURL(`/za-odluku/${member.id}/${today}/${team.id}`);
      await expect(resolutionPage.offlineNote).toHaveCount(1);
      await expect(resolutionPage.acceptOption).toBeVisible();
      await expect(resolutionPage.alertWith(hr.zaOdluku.resolution.unavailable)).toHaveCount(0);

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

test.describe('offline reading of the settings surfaces (story 8.2d)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('each settings surface read online opens offline under one note, with no read retry, its editors too, and the note goes on reconnect', async ({
    page,
    fixture,
    todayPage,
    peoplePage,
    teamsPage,
    organizationPage,
    hourBandsPage,
    rotationPage,
  }) => {
    const band = fixture.bands[0];
    // A type of this test's own, so the shift type editor has one to open.
    const type = `Odmor ${randomBytes(3).toString('hex')}`;

    expect(band, 'the fixture has an hour band').toBeDefined();
    if (band === undefined) return;

    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();

    // Online, each surface once, by client-side navigation.
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.table).toBeVisible();
    await peoplePage.teamsLink.click();
    await expect(teamsPage.editLink(fixture.team.name)).toBeVisible();
    await expect(teamsPage.busyMain).toHaveCount(0);

    await organizationPage.navigationLink(hr.nav.organizacija, { exact: true }).click();
    await expect(organizationPage.timeRegion).toBeVisible();
    await expect(organizationPage.hourBandsCovered).toBeVisible();
    await expect(organizationPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await organizationPage.hourBandsLink.click();
    await expect(hourBandsPage.editLink(band.name)).toBeVisible();
    await expect(hourBandsPage.busyMain).toHaveCount(0);

    await rotationPage.navigationLink(hr.nav.postavkeRotacije, { exact: true }).click();
    // The history button stands once the builder's own snapshot has landed.
    await expect(rotationPage.historyButton).toBeVisible();
    await rotationPage.addShiftType(type, null);
    await expect(rotationPage.shiftTypeEditLink(type)).toBeVisible();
    await expect(rotationPage.historyButton).toBeVisible();
    await expect(rotationPage.busyMain).toHaveCount(0);
    await expect(rotationPage.offlineNote, 'a fresh surface carries no note').toHaveCount(0);

    await page.context().setOffline(true);
    // Postavke rotacije: the shift types and the builder under ONE note.
    await expect(rotationPage.offlineNote, 'the open page shows exactly one note').toHaveCount(1);
    await expect(rotationPage.historyButton).toBeVisible();
    await expect(rotationPage.shiftTypesRetryButton).toHaveCount(0);
    await expect(rotationPage.rotationRetryButton).toHaveCount(0);
    // The shift type editor over the cached list: its form holds the name, no alert, no retry.
    await rotationPage.shiftTypeEditLink(type).click();
    await expect(rotationPage.shiftTypeNameTextbox).toHaveValue(type);
    await expect(rotationPage.shiftTypeEditDialog.getByRole('alert')).toHaveCount(0);
    await expect(rotationPage.shiftTypesRetryButton).toHaveCount(0);
    await rotationPage.shiftTypeCloseButton.click();
    await expect(page).toHaveURL('/postavke-rotacije');

    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.table).toBeVisible();
    await peoplePage.teamsLink.click();
    await expect(teamsPage.heading(hr.smjene.heading, { exact: true })).toBeVisible();
    await expect(teamsPage.offlineNote).toHaveCount(1);
    await expect(teamsPage.editLink(fixture.team.name)).toBeVisible();
    await expect(teamsPage.retryButton).toHaveCount(0);
    // The team editor over the cached list: its form holds the name, no alert, no retry.
    await teamsPage.editLink(fixture.team.name).click();
    await expect(teamsPage.editNameInput).toHaveValue(fixture.team.name);
    await expect(teamsPage.editDialog.getByRole('alert')).toHaveCount(0);
    await expect(teamsPage.retryButton).toHaveCount(0);
    await teamsPage.closeButton.click();
    await expect(page).toHaveURL('/ljudi/smjene');

    await organizationPage.navigationLink(hr.nav.organizacija, { exact: true }).click();
    await expect(organizationPage.heading(hr.nav.organizacija, { exact: true })).toBeVisible();
    await expect(organizationPage.offlineNote).toHaveCount(1);
    await expect(organizationPage.timeRegion).toBeVisible();
    await expect(organizationPage.hourBandsCovered).toBeVisible();
    await expect(organizationPage.shellRetryButton).toHaveCount(0);

    await organizationPage.hourBandsLink.click();
    await expect(hourBandsPage.listHeading).toBeVisible();
    await expect(hourBandsPage.offlineNote).toHaveCount(1);
    await expect(hourBandsPage.editLink(band.name)).toBeVisible();
    await expect(hourBandsPage.shellRetryButton).toHaveCount(0);
    // The editor's dialog over the list: drawn from the same snapshot, with no read retry.
    await hourBandsPage.editLink(band.name).click();
    await expect(hourBandsPage.editDialogName).toHaveValue(band.name);
    await expect(hourBandsPage.editDialog.getByRole('alert')).toHaveCount(0);
    await expect(hourBandsPage.shellRetryButton).toHaveCount(0);
    await hourBandsPage.editDialogClose.click();
    await expect(hourBandsPage.editDialog).toHaveCount(0);

    await rotationPage.navigationLink(hr.nav.postavkeRotacije, { exact: true }).click();
    await expect(rotationPage.offlineNote).toHaveCount(1);
    await expect(rotationPage.historyButton).toBeVisible();

    await page.context().setOffline(false);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    await expect(rotationPage.historyButton).toBeVisible();
  });

  test('an Organizacija never read online is unavailable offline with no read retry and no note, and both come back with the connection', async ({
    page,
    todayPage,
    organizationPage,
  }) => {
    // THE PRECONDITION: nothing in this session reads the hour bands before
    // the connection drops, so they are not in the cache.
    const bandReads: string[] = [];

    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/rest/v1/hour_bands')) bandReads.push(request.url());
    });

    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.busyMain).toHaveCount(0);
    await expect(organizationPage.hourBandsRegion, 'the bands card never rendered').toHaveCount(0);
    expect(bandReads, 'the hour bands were read before the connection dropped').toEqual([]);

    await page.context().setOffline(true);
    // The organization row is cached (the chrome reads it), the hour bands never were.
    await organizationPage.navigationLink(hr.nav.organizacija, { exact: true }).click();
    await expect(organizationPage.heading(hr.nav.organizacija, { exact: true })).toBeVisible();
    await expect(organizationPage.alertWith(hr.organization.error.unavailable)).toBeVisible();
    await expect(organizationPage.shellRetryButton).toHaveCount(0);
    await expect(organizationPage.offlineNote).toHaveCount(0);
    await expect(organizationPage.statusWith(hr.organization.loading), 'never an endless skeleton').toHaveCount(0);
    await expect(organizationPage.timeRegion).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(organizationPage.timeRegion).toBeVisible();
    await expect(organizationPage.hourBandsCovered).toBeVisible();
    await expect(organizationPage.offlineNote).toHaveCount(0);
  });

  test('a Postavke rotacije never read online is unavailable offline, both sections, with no read retry and no note', async ({
    page,
    todayPage,
    rotationPage,
  }) => {
    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await expect(todayPage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await rotationPage.navigationLink(hr.nav.postavkeRotacije, { exact: true }).click();
    await expect(rotationPage.heading(hr.nav.postavkeRotacije, { exact: true })).toBeVisible();
    await expect(rotationPage.shiftTypesUnavailable).toBeVisible();
    await expect(rotationPage.rotationUnavailable).toBeVisible();
    await expect(rotationPage.shiftTypesRetryButton).toHaveCount(0);
    await expect(rotationPage.rotationRetryButton).toHaveCount(0);
    await expect(rotationPage.offlineNote).toHaveCount(0);
  });

  test('a Postavke rotacije with only its shift types cached is unavailable offline as a whole, with no note', async ({
    page,
    todayPage,
    rotationPage,
  }) => {
    // The builder's own read fails online (a service error, not an aborted
    // socket), so only the shift types are cached when the connection drops.
    // Both reads start at `organizations`; the builder's embeds its rotation views.
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/organizations') && url.search.includes('rotation_assignments_in_view'),
      (route) =>
        route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"unavailable"}' }),
    );

    await todayPage.goto();
    await expect(todayPage.needsYouCard).toBeVisible();
    await rotationPage.navigationLink(hr.nav.postavkeRotacije, { exact: true }).click();
    // Online, a failed read is the whole surface's unavailable state, with its retry.
    await expect(rotationPage.rotationUnavailable).toBeVisible();
    await expect(rotationPage.rotationRetryButton).toBeVisible();
    await expect(rotationPage.historyButton).toHaveCount(0);

    await page.context().setOffline(true);
    await expect(rotationPage.shiftTypesUnavailable).toBeVisible();
    await expect(rotationPage.rotationUnavailable).toBeVisible();
    await expect(rotationPage.shiftTypesRetryButton).toHaveCount(0);
    await expect(rotationPage.rotationRetryButton).toHaveCount(0);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    await expect(rotationPage.historyButton).toHaveCount(0);
  });
});

test.describe('no read retry offline (story 8.2e)', () => {
  test.use({ storageState: MEMBER_STATE });

  test('Danas, Kalendar, Sati and Godišnji never read online are unavailable offline, with no read retry', async ({
    page,
    peoplePage,
    todayPage,
    calendarPage,
    hoursPage,
    leavePage,
  }) => {
    // THE PRECONDITION: the directory reads neither the calendar snapshot nor
    // the member's own leave and resolutions, so none is cached.
    await peoplePage.goto();
    await expect(peoplePage.directoryGroups.first()).toBeVisible();
    await expect(peoplePage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await todayPage.navigationLink(hr.nav.danas, { exact: true }).click();
    await expect(todayPage.heading(hr.nav.danas)).toBeVisible();
    await expect(todayPage.unavailableAlert).toBeVisible();
    await expect(todayPage.retryButton).toHaveCount(0);
    await expect(todayPage.offlineNote).toHaveCount(0);

    await calendarPage.navigationLink(hr.nav.kalendar, { exact: true }).click();
    await expect(calendarPage.heading(hr.nav.kalendar)).toBeVisible();
    await expect(calendarPage.unavailableAlert).toBeVisible();
    await expect(calendarPage.retryButton).toHaveCount(0);
    await expect(calendarPage.offlineNote).toHaveCount(0);

    await hoursPage.navigationLink(hr.nav.sati, { exact: true }).click();
    await expect(hoursPage.heading(hr.nav.sati)).toBeVisible();
    await expect(hoursPage.unavailableAlert).toBeVisible();
    await expect(hoursPage.retryButton).toHaveCount(0);
    await expect(hoursPage.offlineNote).toHaveCount(0);

    await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
    await expect(leavePage.heading(hr.nav.godisnji)).toBeVisible();
    await expect(leavePage.alertWith(hr.godisnji.unavailable)).toBeVisible();
    await expect(leavePage.retryButton).toHaveCount(0);
    await expect(leavePage.offlineNote).toHaveCount(0);
  });
});

test.describe('no read retry offline, as an admin (story 8.2e)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a read retry that has focus when the connection drops hands it to its alert, and comes back online', async ({
    page,
    calendarPage,
  }) => {
    // A refused answer rather than an aborted socket, as the calendar
    // conflicts spec's: the organization's leave read fails online, so the
    // month is unavailable with its retry.
    const records = '**/rest/v1/leave_records*';

    await page.route(records, (route) => route.fulfill({ status: 500, body: '{}' }));
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.unavailableAlert).toBeVisible();
    await calendarPage.retryButton.focus();
    await expect(calendarPage.retryButton).toBeFocused();

    await page.context().setOffline(true);
    await expect(calendarPage.retryButton).toHaveCount(0);
    await expect(calendarPage.unavailableAlert, 'focus moves to the alert beside the retry').toBeFocused();

    await page.context().setOffline(false);
    await expect(calendarPage.unavailableAlert).toBeVisible();
    await expect(calendarPage.retryButton, 'online, the retry is back').toBeVisible();
  });

  test('the organization card\'s read retry, focused when the connection drops, hands focus to its alert', async ({
    page,
    organizationPage,
  }) => {
    // The settings retry spec's failing read: a refused answer, so the card
    // shows its message and its retry online.
    await page.route('**/rest/v1/organizations*', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"unavailable"}' }),
    );
    await organizationPage.goto();
    const alert = organizationPage.alertWith(hr.organization.error.unavailable);

    await expect(alert).toBeVisible();
    await organizationPage.shellRetryButton.focus();
    await expect(organizationPage.shellRetryButton).toBeFocused();

    await page.context().setOffline(true);
    await expect(organizationPage.shellRetryButton).toHaveCount(0);
    await expect(alert, 'focus moves to the alert beside the retry').toBeFocused();

    await page.context().setOffline(false);
    await expect(organizationPage.shellRetryButton, 'online, the retry is back').toBeVisible();
  });

  test('an admin Danas whose read failed online keeps its alert offline, with no read retry', async ({
    page,
    todayPage,
  }) => {
    await page.route('**/rest/v1/leave_records*', (route) => route.fulfill({ status: 500, body: '{}' }));
    await todayPage.goto();
    await expect(todayPage.adminUnavailableAlert).toBeVisible();
    await expect(todayPage.retryButton, 'online, the read retry is offered').toBeVisible();

    await page.context().setOffline(true);
    await expect(todayPage.adminUnavailableAlert).toBeVisible();
    await expect(todayPage.retryButton).toHaveCount(0);
  });

  test('a resolution page whose read failed online keeps its alert offline, with no read retry', async ({
    page,
    fixture,
    resolutionPage,
  }) => {
    await page.route('**/rest/v1/leave_records*', (route) => route.fulfill({ status: 500, body: '{}' }));
    await resolutionPage.gotoConflict(randomUUID(), '2026-06-15', fixture.team.id);
    const alert = resolutionPage.alertWith(hr.zaOdluku.resolution.unavailable);
    const retry = resolutionPage.retryButton;

    await expect(alert).toBeVisible();
    await expect(retry, 'online, the read retry is offered').toBeVisible();

    await page.context().setOffline(true);
    await expect(alert).toBeVisible();
    await expect(retry).toHaveCount(0);
  });

  test('the Ljudi table and the Godišnji overview never read online are unavailable offline, with no read retry', async ({
    page,
    organizationPage,
    peoplePage,
    leavePage,
  }) => {
    // THE PRECONDITION: Organizacija reads neither the member list nor the
    // calendar snapshot, so neither is cached when the connection drops.
    await organizationPage.goto();
    await expect(organizationPage.timeRegion).toBeVisible();
    await expect(organizationPage.busyMain).toHaveCount(0);

    await page.context().setOffline(true);
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(peoplePage.heading(hr.nav.ljudi)).toBeVisible();
    await expect(peoplePage.alertWith(hr.ljudi.error.unavailable)).toBeVisible();
    await expect(peoplePage.membersRetry).toHaveCount(0);

    await leavePage.navigationLink(hr.nav.godisnji, { exact: true }).click();
    await expect(leavePage.heading(hr.nav.godisnji)).toBeVisible();
    await expect(leavePage.overviewUnavailable).toBeVisible();
    await expect(leavePage.retryButton).toHaveCount(0);
  });

  test('the chrome\'s role notice, with no role read online, offers no retry offline', async ({ page, todayPage }) => {
    // The role read refused online, as the phone navigation spec's: the
    // notice and its retry show, and no role is cached.
    await page.route(
      (url) => url.pathname.endsWith('/rest/v1/members') && url.searchParams.get('select') === 'role',
      (route) =>
        route.fulfill({
          status: 400,
          json: { code: '42703', details: null, hint: null, message: 'e2e: role read refused' },
        }),
    );
    await page.goto('/danas');
    const notice = todayPage.alertWith(hr.shell.error.destinations);

    await expect(notice).toBeVisible();
    await expect(todayPage.shellRetryButton, 'online, the retry is offered').toBeVisible();

    await page.context().setOffline(true);
    await expect(notice).toBeVisible();
    await expect(todayPage.shellRetryButton).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(todayPage.shellRetryButton, 'online, the retry is back').toBeVisible();
  });
});
