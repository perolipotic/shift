import { randomBytes } from 'node:crypto';

import type { Locator, Page, Route } from '@playwright/test';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import type { RotationPage } from '../../pages/rotation.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { SetPasswordPage } from '../../pages/set-password.page.ts';
import {
  API_URL,
  databaseNow,
  holdAtSetPasswordInSql,
  holdRotation,
  OFFLINE_MEMBER_USERNAME_PREFIX,
  removeLeaveMemberInSql,
  removeOfflineMemberInSql,
  removeRotationChangesOver,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedRotationChange,
  seedShiftTypeOverride,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { offlineSignInNoteOf, offlineWriteNoteIn, offlineWriteNoteNamedBy } from '../../utils/offline.ts';
import { ADMIN_STATE, RUN_TIMEZONE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 8.3a: offline, a write control states that it needs a connection, and
 * a press sends nothing. The form was typed online; the connection drops; the
 * control is `aria-disabled`, names *Za ovo je potrebna veza.* in its
 * description, and a press — or Enter in a field — writes nothing, queues
 * nothing and starts no erasure check (no *Ne mogu provjeriti…*). The input
 * is kept. Reconnecting lifts the gate and sends nothing by itself.
 *
 * Covered here: the Kalendar roster save, its erasure confirmation's save and
 * the override set; the resolution's *Spremi*; the member page's team change
 * and a leave removal's confirm (a `type="button"` path); *Dodaj osobu*; the
 * sign-in, gated with *Za prijavu je potrebna veza.*; and the set-password
 * submit.
 *
 * Story 8.3b, the settings surfaces: the Organizacija name's *Spremi*, the
 * hour band add, the shift type add, *Spremi rotaciju* (no erasure check
 * starts) and the override review's *Potvrdi* (a seeded pending override),
 * and the team rename.
 *
 * THE REQUEST SPY counts every request to the Supabase API while offline,
 * less GoTrue's token REFRESH (the client's own, never a write), and every
 * WRITE after the reconnect. The reconnect's settle point is deterministic:
 * the surface's as-of note goes once every read is fresh again, and only then
 * are the writes counted.
 */

const membership = hr.smjene.membership;
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: RUN_TIMEZONE }).format(new Date());

/**
 * The RPCs that WRITE on the surfaces this spec visits (the read RPCs — the
 * calendar's, the roster's, the resolutions' — are reads). The request
 * writes (`withdraw_leave_request`, `decide_leave_request`) are spied where
 * their surfaces are: `leave/leave-request.spec.ts` and
 * `leave/leave-decision.spec.ts` (retro 8–9 item 19, V2).
 */
const WRITE_RPC = /\/rest\/v1\/rpc\/(remove_|replace_|confirm_|amend_)/;

/** A spy on the page's requests to the Supabase API. */
interface RequestSpy {
  /** Every API request since the spy started, less the client's token refresh. */
  readonly all: () => readonly string[];
  /** Every API WRITE: a non-GET to a table, a write RPC, a function, a password change or a sign-in. */
  readonly writes: () => readonly string[];
}

function spyOnApi(page: Page): RequestSpy {
  const seen: { method: string; url: string }[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(API_URL)) return;
    if (!/\/(rest|functions|auth)\/v1\//.test(url)) return;
    // TOLERATED: the client refreshing its own token is never a write.
    if (url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')) return;
    seen.push({ method: request.method(), url });
  });

  const write = ({ method, url }: { method: string; url: string }): boolean => {
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
    if (url.includes('/rest/v1/rpc/')) return WRITE_RPC.test(url);

    return url.includes('/rest/v1/') || url.includes('/functions/v1/') || url.includes('/auth/v1/');
  };

  return {
    all: () => seen.map((request) => `${request.method} ${request.url}`),
    writes: () => seen.filter(write).map((request) => `${request.method} ${request.url}`),
  };
}

/** The gated control offline: `aria-disabled`, focusable, and described by the note it sits beside. */
async function expectGated(control: Locator, note: Locator): Promise<void> {
  await expect(note).toBeVisible();
  await expect(control).toHaveAttribute('aria-disabled', 'true');
  // FOCUSABLE, never natively `disabled` (Playwright counts `aria-disabled` as disabled, so it is asked directly).
  await expect(control).not.toHaveAttribute('disabled');
  const noteId = await note.getAttribute('id');
  expect(noteId, 'the note has no id to be named by').not.toBeNull();
  await expect(control).toHaveAttribute('aria-describedby', new RegExp(`(^|\\s)${noteId ?? ''}(\\s|$)`));
}

/**
 * A pointer press and a keyboard press on a gated control. `force`, because
 * Playwright waits for an `aria-disabled` control to become enabled; the
 * press is the user's, and it must do nothing.
 */
async function press(control: Locator): Promise<void> {
  await control.click({ force: true });
  await control.focus();
  await expect(control, 'the gated control is not focusable').toBeFocused();
  await control.press('Enter');
}

/** The gate lifted: no note, and the control no longer `aria-disabled` for being offline. */
async function expectLifted(control: Locator, scope: Page | Locator): Promise<void> {
  await expect(offlineWriteNoteIn(scope)).toHaveCount(0);
  await expect(control).not.toHaveAttribute('aria-describedby', /offline-write-/);
}

/**
 * The API's requests held unanswered from now on (story 8.3b): a check or a
 * write in flight that the connection then drops under. `drop` aborts every
 * one held as a dropped connection would, and stops holding.
 */
async function holdApi(page: Page): Promise<{ readonly held: () => number; readonly drop: () => Promise<void> }> {
  const pattern = `${API_URL}/rest/v1/**`;
  const held: Route[] = [];
  let holding = true;
  await page.route(pattern, async (route) => {
    // ONCE DROPPED, a request is failed as the dropped connection would fail it.
    if (holding) held.push(route);
    else await route.abort('internetdisconnected');
  });

  return {
    held: () => held.length,
    drop: async () => {
      holding = false;
      for (const route of held.splice(0)) await route.abort('internetdisconnected');
      await page.unroute(pattern);
    },
  };
}

/** Opens `team`'s day detail on `date`. */
async function openDay(calendarPage: CalendarPage, teamName: string, date: string): Promise<Locator> {
  await calendarPage.goto(`?prikaz=sve&mjesec=${date.slice(0, 7)}`);
  await (await calendarPage.cellOf(teamName, date)).click();
  const detail = calendarPage.detailOf(teamName, date);
  await expect(detail).toBeVisible();

  return detail;
}

test.describe('offline writes on the admin surfaces', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

  let hold: RotationHold | null = null;
  let seed: SeededRotation | null = null;
  /** When a test seeded a scheduled change: the changes since then are removed first. */
  let seededSince: string | null = null;
  let written: { readonly slug: string; members: string[]; teams: string[]; usernames: string[] } | null = null;

  test.afterEach(async ({ page }) => {
    await page.context().setOffline(false);
    // EVERY STEP RUNS, whichever fails; the first failure is reported once all have run.
    const failures: unknown[] = [];
    const attempt = async (step: () => Promise<void>): Promise<void> => {
      try {
        await step();
      } catch (cause) {
        failures.push(cause);
      }
    };
    const seeded = seed;
    const since = seededSince;
    const own = written;

    // A scheduled change first, if the test left one standing.
    if (seeded !== null && since !== null) await attempt(() => removeRotationChangesOver(seeded, since));
    // The seed next: it deletes every roster override, which names the member.
    if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
    for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
    for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
    for (const name of own?.usernames ?? []) await attempt(() => removeOfflineMemberInSql(own?.slug ?? '', name));
    seed = null;
    seededSince = null;
    written = null;
    await attempt(async () => {
      await hold?.release();
    });
    hold = null;
    if (failures.length > 0) throw failures[0];
  });

  /** What a test writes, removed afterwards. */
  function own(slug: string): { readonly slug: string; members: string[]; teams: string[]; usernames: string[] } {
    written ??= { slug, members: [], teams: [], usernames: [] };

    return written;
  }

  /**
   * Under the run's rotation hold: a team of the test's own with the seeded
   * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
   * on it — on leave over today + 4, a Dan, when `onLeave`: one conflict.
   */
  async function rotationWithMember(
    slug: string,
    onLeave: boolean,
    daysBefore = 0,
  ): Promise<{ team: { id: string; name: string }; person: SeededLeaveMember; rotation: SeededRotation }> {
    hold = holdRotation(slug);
    await hold.ready;
    seededSince = await databaseNow();
    const mine = own(slug);
    const suffix = randomBytes(3).toString('hex');
    const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
    mine.teams.push(team.id);
    seed = await seedTeamRotation(slug, team.id, suffix, daysBefore);
    const person = await seedLeaveMember(slug, team.id, seed.today, 20);
    mine.members.push(person.id);
    if (onLeave) {
      const date = addDays(seed.today, 4);
      await seedLeaveRecord(slug, person.id, date, date);
    }

    return { team, person, rotation: seed };
  }

  /**
   * {@link rotationWithMember} on leave, and a Slobodno override on today + 4
   * left pending review by a change saved after it, anchored on Noć from
   * today + 1 so today + 4 stays a Dan: confirming it would erase the
   * member's conflict there (story 5.5h's setup).
   */
  async function pendingOverride(
    slug: string,
  ): Promise<{ team: { id: string; name: string }; rotation: SeededRotation; date: string }> {
    const { team, rotation } = await rotationWithMember(slug, true);
    const date = addDays(rotation.today, 4);
    await seedShiftTypeOverride(rotation, team.id, date, 2, 'Bez veze (E2E).');
    await seedRotationChange(rotation, team.id, addDays(rotation.today, 1), 1);

    return { team, rotation, date };
  }

  /**
   * {@link rotationWithMember} on leave over today + 4, seeded from two days
   * back, and a change scheduled tomorrow anchored on Noć — so today + 4 is a
   * Dan only under the scheduled change, and cancelling it would erase the
   * member's conflict (story 5.5g's setup). The builder's save is refused as
   * scheduled, and its cancel's confirmation is opened.
   */
  async function armScheduledCancel(slug: string, rotationPage: RotationPage): Promise<Locator> {
    const { team, rotation } = await rotationWithMember(slug, true, 2);
    const scheduled = addDays(rotation.today, 1);
    await seedRotationChange(rotation, team.id, scheduled, 1);

    await rotationPage.goto();
    await expect(rotationPage.effectiveFromInput).toBeVisible();
    await rotationPage.saveButton.click();
    await expect(rotationPage.scheduledRefusal).toBeVisible();
    await rotationPage.cancelScheduledOffer(fullDate(scheduled)).click();
    const dialog = rotationPage.dialog();
    await expect(dialog).toContainText(
      fill(hr.rotation.builder.cancelScheduled.prompt, { date: fullDate(scheduled) }),
    );

    return dialog;
  }

  test('the Kalendar roster save is gated offline before its erasure check, and the reconnect sends nothing', async ({
    page,
    fixture,
    calendarPage,
  }) => {
    test.slow(); // the shared rotation lock can take longer than the default timeout
    const { team, person, rotation } = await rotationWithMember(fixture.slug, false);
    // Today is the rotation's first step, a Dan: the day has a roster.
    const detail = await openDay(calendarPage, team.name, rotation.today);
    const form = await calendarPage.openRosterFormIn(detail);
    await calendarPage.chooseIn(calendarPage.rosterOutIn(form), person.name);
    await calendarPage.rosterReasonIn(form).fill('Bez veze (E2E).');
    const save = calendarPage.rosterSaveIn(form);
    await expect(offlineWriteNoteIn(form), 'online, no note').toHaveCount(0);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(form));
    await expect(offlineWriteNoteIn(form)).toHaveText(hr.offline.needsConnection);

    // A press, and Enter in the reason: nothing happens.
    await press(save);
    await calendarPage.rosterReasonIn(form).press('Enter');
    await expect(form, 'the form closed on an offline press').toBeVisible();
    await expect(calendarPage.rosterUnchecked, 'the erasure check started offline').toHaveCount(0);
    await expect(calendarPage.rosterReasonIn(form)).toHaveValue('Bez veze (E2E).');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    // RECONNECT: the gate lifts, and nothing is sent until the admin presses.
    await page.context().setOffline(false);
    await expectLifted(save, form);
    await expect(calendarPage.offlineNote, 'the surface never settled after the reconnect').toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(calendarPage.rosterReasonIn(form)).toHaveValue('Bez veze (E2E).');
  });

  test("the roster erasure confirmation's save is gated offline, and a press sends nothing", async ({
    page,
    fixture,
    calendarPage,
  }) => {
    test.slow();
    const { team, person, rotation } = await rotationWithMember(fixture.slug, true);
    const date = addDays(rotation.today, 4);
    const detail = await openDay(calendarPage, team.name, date);
    // ONLINE: the change would erase the member's conflict, so the confirmation opens.
    await calendarPage.changeRosterIn(detail, person.name, null, 'Bez veze (E2E).');
    const parts = calendarPage.rosterErasures('save');
    const dialog = parts.dialog(1);
    await expect(dialog).toBeVisible();
    const row = parts.rowsIn(dialog).nth(0);
    await parts.confirmIn(row).click();
    const save = parts.saveIn(dialog);
    await expect(save).toHaveAttribute('aria-disabled', 'false');

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(dialog));

    await press(save);
    await expect(dialog, 'the confirmation closed on an offline press').toBeVisible();
    await expect(calendarPage.rosterUnchecked).toHaveCount(0);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, dialog);
    await expect(calendarPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(dialog).toBeVisible();
  });

  test('the Kalendar override set is gated offline, and the reconnect sends nothing', async ({
    page,
    fixture,
    calendarPage,
  }) => {
    test.slow();
    const { team, rotation } = await rotationWithMember(fixture.slug, false);
    const detail = await openDay(calendarPage, team.name, rotation.today);
    const form = await calendarPage.openOverrideFormIn(detail);
    // Any type but the placeholder.
    await calendarPage.overrideTypeIn(form).selectOption({ index: 1 });
    await calendarPage.overrideReasonIn(form).fill('Bez veze (E2E).');
    const save = calendarPage.overrideSaveIn(form);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(form));

    await press(save);
    await calendarPage.overrideReasonIn(form).press('Enter');
    await expect(form).toBeVisible();
    await expect(calendarPage.overrideUnchecked, 'the erasure check started offline').toHaveCount(0);
    await expect(calendarPage.overrideReasonIn(form)).toHaveValue('Bez veze (E2E).');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, form);
    await expect(calendarPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
  });

  test("the resolution's Spremi is gated offline, and the reconnect sends nothing", async ({
    page,
    fixture,
    resolutionPage,
  }) => {
    test.slow();
    const { team, person, rotation } = await rotationWithMember(fixture.slug, true);
    const date = addDays(rotation.today, 4);

    await resolutionPage.gotoConflict(person.id, date, team.id);
    await expect(resolutionPage.heading(hr.zaOdluku.resolution.heading)).toBeVisible();
    await resolutionPage.acceptOption.click();
    const save = resolutionPage.saveButton;
    await expect(save).toHaveAttribute('aria-disabled', 'false');

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(resolutionPage.main));

    await press(save);
    await expect(page, 'the save went back to the queue').toHaveURL(`/za-odluku/${person.id}/${date}/${team.id}`);
    await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'true');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, resolutionPage.main);
    await expect(resolutionPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
  });

  test("the member page's team change is gated offline before its erasure check, and the reconnect sends nothing", async ({
    page,
    fixture,
    peoplePage,
  }) => {
    const mine = own(fixture.slug);
    const person = await seedLeaveMember(fixture.slug, fixture.team.id, today(), 20);
    mine.members.push(person.id);

    await peoplePage.gotoMember(person.id);
    await peoplePage.moveButton(person.name).click();
    await expect(peoplePage.teamDialog).toBeVisible();
    await peoplePage.teamSelect.selectOption({ label: membership.none });
    const save = peoplePage.teamSaveButton;

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(peoplePage.teamDialog));

    await press(save);
    await peoplePage.dateInput.press('Enter');
    await expect(peoplePage.teamDialog).toBeVisible();
    await expect(peoplePage.memberUnchecked, 'the erasure check started offline').toHaveCount(0);
    await expect(peoplePage.selectedTeam).toHaveText(membership.none);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, peoplePage.teamDialog);
    await expect(peoplePage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(peoplePage.statusWith(membership.saved)).toHaveCount(0);
  });

  test("a leave removal's confirm is gated offline, and the reconnect sends nothing", async ({
    page,
    fixture,
    peoplePage,
  }) => {
    const mine = own(fixture.slug);
    const on = today();
    const person = await seedLeaveMember(fixture.slug, fixture.team.id, on, 20);
    mine.members.push(person.id);
    await seedLeaveRecord(fixture.slug, person.id, on, on);

    await peoplePage.gotoMember(person.id);
    await peoplePage.removeLeaveButton(on, on).click();
    const confirm = peoplePage.dialog();
    await expect(confirm).toBeVisible();
    const remove = peoplePage.confirmRemoveLeaveIn(confirm);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(remove, offlineWriteNoteIn(confirm));

    await press(remove);
    await expect(confirm, 'the confirmation closed on an offline press').toBeVisible();
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(remove, confirm);
    await expect(peoplePage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(peoplePage.removeLeaveButton(on, on), 'the record was removed').toHaveCount(1);
  });

  test('Dodaj osobu is gated offline, and the reconnect sends nothing', async ({ page, fixture, peoplePage }) => {
    const suffix = randomBytes(3).toString('hex');
    const person = { name: `Bez veze ${suffix}`, username: `${OFFLINE_MEMBER_USERNAME_PREFIX}${suffix}` };
    // REGISTERED FIRST: if the gate ever let it through, the account is removed.
    own(fixture.slug).usernames.push(person.username);

    await peoplePage.gotoNew();
    await peoplePage.fillNewMember(person.name, person.username);
    const add = peoplePage.addSubmitButton;

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(add, offlineWriteNoteIn(peoplePage.addDialog));

    await press(add);
    await peoplePage.addNameInput.press('Enter');
    await expect(peoplePage.addDialog).toBeVisible();
    await expect(peoplePage.addNameInput).toHaveValue(person.name);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(add, peoplePage.addDialog);
    await expect(peoplePage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(peoplePage.createdStatus(person.name, person.username)).toHaveCount(0);
  });

  // ------------------------------------------------ the settings surfaces (story 8.3b)

  test("Organizacija's name save is gated offline, and the reconnect sends nothing", async ({
    page,
    organizationPage,
  }) => {
    await organizationPage.goto();
    await organizationPage.nameOpener.click();
    const dialog = organizationPage.nameDialog;
    await expect(dialog).toBeVisible();
    await organizationPage.nameInput.fill('Bez veze (E2E)');
    const save = organizationPage.saveIn(dialog);
    await expect(offlineWriteNoteIn(dialog), 'online, no note').toHaveCount(0);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(dialog));
    await expect(offlineWriteNoteIn(dialog)).toHaveText(hr.offline.needsConnection);

    await press(save);
    await organizationPage.nameInput.press('Enter');
    await expect(dialog, 'the dialog closed on an offline press').toBeVisible();
    await expect(organizationPage.nameInput).toHaveValue('Bez veze (E2E)');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, dialog);
    await expect(organizationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(dialog).toBeVisible();
  });

  test('the hour band add is gated offline, and the reconnect sends nothing', async ({ page, hourBandsPage }) => {
    const bands = hr.organization.hourBands;

    await hourBandsPage.goto();
    await hourBandsPage.openButton.click();
    const dialog = hourBandsPage.addDialog;
    await expect(dialog).toBeVisible();
    await hourBandsPage.nameInput.fill('Bez veze');
    await hourBandsPage.startInput.fill('03:17');
    const add = dialog.getByRole('button', { name: bands.add, exact: true });

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(add, offlineWriteNoteIn(dialog));
    await expect(offlineWriteNoteIn(dialog)).toHaveText(hr.offline.needsConnection);

    await press(add);
    await hourBandsPage.nameInput.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(hourBandsPage.nameInput).toHaveValue('Bez veze');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(add, dialog);
    await expect(hourBandsPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(hourBandsPage.statusWith(bands.created)).toHaveCount(0);
  });

  test('the shift type add is gated offline, and the reconnect sends nothing', async ({ page, rotationPage }) => {
    const shiftTypes = hr.rotation.shiftTypes;
    const name = `Bez veze ${randomBytes(3).toString('hex')}`;

    await rotationPage.goto();
    await rotationPage.shiftTypeOpenButton.click();
    const dialog = rotationPage.addShiftTypeDialog;
    await expect(dialog).toBeVisible();
    await rotationPage.addShiftTypeName.fill(name);
    await rotationPage.addShiftTypeKind.selectOption({ label: shiftTypes.nonworking });
    const add = dialog.getByRole('button', { name: shiftTypes.add, exact: true });

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(add, offlineWriteNoteIn(dialog));
    await expect(offlineWriteNoteIn(dialog)).toHaveText(hr.offline.needsConnection);

    await press(add);
    await rotationPage.addShiftTypeName.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(rotationPage.addShiftTypeName).toHaveValue(name);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(add, dialog);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(rotationPage.statusWith(shiftTypes.created)).toHaveCount(0);
  });

  test('Spremi rotaciju is gated offline before its erasure check, and the reconnect sends nothing', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    // A member on leave over today + 4, a Dan: an all-free draft would erase that conflict.
    const { rotation } = await rotationWithMember(fixture.slug, true);
    await rotationPage.goto();
    await expect(rotationPage.effectiveFromInput).toBeVisible();
    await rotationPage.addStep(rotation.steps[2]);
    await rotationPage.effectiveFromInput.fill(addDays(rotation.today, 1));
    const save = rotationPage.saveButton;
    const bar = rotationPage.saveBar;
    await expect(offlineWriteNoteIn(bar), 'online, no note').toHaveCount(0);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(bar));

    await press(save);
    await expect(rotationPage.erasuresUnavailable, 'the erasure check started offline').toHaveCount(0);
    await expect(rotationPage.dialog(), 'the erasure confirmation opened offline').toHaveCount(0);
    await expect(
      rotationPage.alertWith(hr.rotation.builder.error.saveUnavailable),
      "the save's unavailable refusal said it, not the note",
    ).toHaveCount(0);
    await expect(rotationPage.savedConfirmation).toHaveCount(0);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, bar);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(rotationPage.savedConfirmation).toHaveCount(0);
  });

  test("the override review's Potvrdi is gated offline before its erasure check, and the reconnect sends nothing", async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    const { team, date } = await pendingOverride(fixture.slug);

    await rotationPage.goto();
    const row = rotationPage.overrideReviewRow(team.name, fullDate(date));
    await expect(row).toHaveCount(1);
    const confirm = rotationPage.confirmOverrideIn(row);
    await expect(confirm).toBeVisible();

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    // THE REVIEW'S OWN NOTE, the one its confirms name (the save bar has its own).
    await expect(confirm).toHaveAttribute('aria-describedby', /offline-write-/);
    const note = await offlineWriteNoteNamedBy(page, confirm);
    await expectGated(confirm, note);
    await expect(note).toHaveText(hr.offline.needsConnection);

    await press(confirm);
    await confirm.press('Space');
    await expect(rotationPage.reviewUnchecked, 'the erasure check started offline').toHaveCount(0);
    await expect(rotationPage.dialog(), 'the erasure confirmation opened offline').toHaveCount(0);
    await expect(row).toHaveCount(1);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(confirm, rotationPage.main);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(row).toHaveCount(1);
  });

  test("the override amend's save is gated offline, and the reconnect sends nothing", async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    const { team, rotation, date } = await pendingOverride(fixture.slug);

    await rotationPage.goto();
    const row = rotationPage.overrideReviewRow(team.name, fullDate(date));
    await expect(row).toHaveCount(1);
    // THE OPENER IS NOT GATED: the dialog opens online or offline (decision 4a).
    await rotationPage.amendOverrideIn(row).click();
    const dialog = rotationPage.amendDialogOf(team.name, fullDate(date));
    await expect(dialog).toBeVisible();
    await rotationPage.amendTypeIn(dialog).selectOption({ label: rotation.steps[1] });
    await rotationPage.amendReasonIn(dialog).fill('Bez veze (E2E).');
    const save = dialog.getByRole('button', { name: hr.rotation.builder.overrides.amendDialog.save, exact: true });

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(dialog));
    await expect(offlineWriteNoteIn(dialog)).toHaveText(hr.offline.needsConnection);

    await press(save);
    await rotationPage.amendReasonIn(dialog).press('Enter');
    await expect(dialog, 'the amend closed on an offline press').toBeVisible();
    await expect(rotationPage.reviewUnchecked, 'the erasure check started offline').toHaveCount(0);
    await expect(rotationPage.amendReasonIn(dialog)).toHaveValue('Bez veze (E2E).');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, dialog);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(dialog).toBeVisible();
  });

  test("the override discard's confirm is gated offline, and the reconnect sends nothing", async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    const { team, date } = await pendingOverride(fixture.slug);

    await rotationPage.goto();
    const row = rotationPage.overrideReviewRow(team.name, fullDate(date));
    await expect(row).toHaveCount(1);
    await rotationPage.discardOverrideIn(row).click();
    const dialog = rotationPage.dialog();
    await expect(dialog).toBeVisible();
    const discard = rotationPage.confirmDiscardIn(dialog);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(discard, offlineWriteNoteIn(dialog));
    await expect(offlineWriteNoteIn(dialog)).toHaveText(hr.offline.needsConnection);

    await press(discard);
    await expect(dialog, 'the confirmation closed on an offline press').toBeVisible();
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(discard, dialog);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(row).toHaveCount(1);
  });

  test("the rotation cancel's confirm is gated offline before its erasure check, and the reconnect sends nothing", async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    const dialog = await armScheduledCancel(fixture.slug, rotationPage);
    const confirm = rotationPage.cancelScheduledConfirm;

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(confirm, offlineWriteNoteIn(dialog));

    await press(confirm);
    await expect(dialog, 'the confirmation closed on an offline press').toBeVisible();
    await expect(rotationPage.cancelErasuresUnavailable, 'the erasure check started offline').toHaveCount(0);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(confirm, dialog);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(dialog).toBeVisible();
  });

  test('a rotation save whose connection drops mid-check shows only the note, and Spremi works again after the reconnect', async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    // A member on leave over today + 4, a Dan: an all-free draft would erase that conflict.
    const { rotation } = await rotationWithMember(fixture.slug, true);
    await rotationPage.goto();
    await expect(rotationPage.effectiveFromInput).toBeVisible();
    await rotationPage.addStep(rotation.steps[2]);
    await rotationPage.effectiveFromInput.fill(addDays(rotation.today, 1));
    const save = rotationPage.saveButton;

    const spy = spyOnApi(page);
    // ONLINE: the press starts the check; its reads are held, then the connection drops under them.
    const api = await holdApi(page);
    await save.click();
    await expect.poll(api.held, { message: 'the erasure check never asked' }).toBeGreaterThan(0);
    await page.context().setOffline(true);
    await api.drop();
    // The check's reads retry once before it settles as unavailable.
    await expect(save, 'the check never settled').not.toHaveAttribute('aria-busy', 'true', { timeout: 20_000 });

    await expectGated(save, offlineWriteNoteIn(rotationPage.saveBar));
    await expect(save, 'focus fell off the pressed save').toBeFocused();
    await expect(rotationPage.erasuresUnavailable, 'the unchecked refusal showed offline').toHaveCount(0);
    await expect(rotationPage.alertWith(hr.rotation.builder.error.saveUnavailable)).toHaveCount(0);
    await expect(rotationPage.dialog()).toHaveCount(0);

    // RECONNECT: the save's state was released, so the next press runs the check again.
    await page.context().setOffline(false);
    await expectLifted(save, rotationPage.saveBar);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'a write was sent').toEqual([]);
    await save.click();
    await expect(rotationPage.erasureDialog(1), 'the save did not work again after the reconnect').toBeVisible();
    expect(spy.writes(), 'a write was sent').toEqual([]);
  });

  test("a rotation cancel whose connection drops mid-check keeps its confirmation open under the note", async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    const dialog = await armScheduledCancel(fixture.slug, rotationPage);
    const confirm = rotationPage.cancelScheduledConfirm;

    const spy = spyOnApi(page);
    const api = await holdApi(page);
    await confirm.click();
    await expect.poll(api.held, { message: 'the erasure check never asked' }).toBeGreaterThan(0);
    await page.context().setOffline(true);
    await api.drop();
    // The check's reads retry once before it settles as unavailable.
    await expect(confirm, 'the check never settled').not.toHaveAttribute('aria-busy', 'true', { timeout: 20_000 });

    await expect(dialog, 'the confirmation closed when the connection dropped').toBeVisible();
    await expectGated(confirm, offlineWriteNoteIn(dialog));
    await expect(confirm, 'focus fell off the pressed confirm').toBeFocused();
    await expect(rotationPage.cancelErasuresUnavailable, 'the unchecked refusal showed offline').toHaveCount(0);

    await page.context().setOffline(false);
    await expectLifted(confirm, dialog);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'a write was sent').toEqual([]);
    await expect(confirm).not.toHaveAttribute('disabled');
    await expect(dialog).toBeVisible();
  });

  test("the shift type's times save is gated offline, and the reconnect sends nothing", async ({
    page,
    fixture,
    rotationPage,
  }) => {
    test.slow();
    const { rotation } = await rotationWithMember(fixture.slug, false);
    await rotationPage.goto();
    await rotationPage.shiftTypeEditLink(rotation.steps[0]).click();
    const dialog = rotationPage.shiftTypeEditDialog;
    await expect(dialog).toBeVisible();
    await rotationPage.timesStartInput.fill('06:30');
    const save = rotationPage.timesCorrectButton;

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    // THE DIALOG'S ONE NOTE, which the rename and the times both name.
    await expect(offlineWriteNoteIn(dialog)).toHaveCount(1);
    await expectGated(save, offlineWriteNoteIn(dialog));
    await expectGated(rotationPage.shiftTypeSaveButton, offlineWriteNoteIn(dialog));
    await expect(offlineWriteNoteIn(dialog)).toHaveText(hr.offline.needsConnection);

    await press(save);
    await rotationPage.timesStartInput.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(rotationPage.timesStartInput).toHaveValue('06:30');
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, dialog);
    await expect(rotationPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
  });

  test("the team archive's confirm is gated offline, and the reconnect sends nothing", async ({
    page,
    fixture,
    teamsPage,
  }) => {
    const mine = own(fixture.slug);
    const team = await seedExtraTeam(fixture.slug, `Smjena ${randomBytes(3).toString('hex')}`);
    mine.teams.push(team.id);

    await teamsPage.goto();
    await teamsPage.openTeam(team.name);
    await expect(teamsPage.editDialog).toBeVisible();
    await teamsPage.archiveButton(team.name).click();
    const confirm = teamsPage.archiveConfirmButton(team.name);
    await expect(confirm).toBeVisible();

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(confirm, offlineWriteNoteIn(teamsPage.editDialog));

    await press(confirm);
    await expect(teamsPage.archivePrompt(team.name), 'the confirmation closed on an offline press').toBeVisible();
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(confirm, teamsPage.editDialog);
    await expect(teamsPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(teamsPage.archivePrompt(team.name)).toBeVisible();
  });

  test('the team rename is gated offline, and the reconnect sends nothing', async ({ page, fixture, teamsPage }) => {
    const mine = own(fixture.slug);
    const suffix = randomBytes(3).toString('hex');
    const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
    mine.teams.push(team.id);
    const renamed = `Bez veze ${suffix}`;

    await teamsPage.goto();
    await teamsPage.openTeam(team.name);
    const dialog = teamsPage.editDialog;
    await expect(dialog).toBeVisible();
    await teamsPage.editNameInput.fill(renamed);
    const save = teamsPage.editSaveButton;

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(save, offlineWriteNoteIn(dialog));

    await press(save);
    await teamsPage.editNameInput.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(teamsPage.editNameInput).toHaveValue(renamed);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(save, dialog);
    await expect(teamsPage.offlineNote).toHaveCount(0);
    expect(spy.writes(), 'the reconnect sent a write').toEqual([]);
    await expect(teamsPage.editNameInput).toHaveValue(renamed);
  });
});

test.describe('offline sign-in and set-password', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let members: { readonly slug: string; readonly id: string }[] = [];

  test.afterEach(async () => {
    const failures: unknown[] = [];
    for (const member of members) {
      try {
        await removeLeaveMemberInSql(member.slug, member.id);
      } catch (cause) {
        failures.push(cause);
      }
    }
    members = [];
    if (failures.length > 0) throw failures[0];
  });

  test('the sign-in is gated offline with its own note, and the reconnect signs nobody in', async ({
    page,
    fixture,
  }) => {
    const login = new LoginPage(page);

    await login.goto();
    // Typed, never submitted online: the spare account's sessions are the sign-in spec's.
    await login.fillCredentialsFor(fixture.slug, fixture.spare.username, fixture.password);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    const note = offlineSignInNoteOf(page);
    await expectGated(login.submitButton, note);
    await expect(note).toHaveText(hr.offline.signInNeedsConnection);

    await press(login.submitButton);
    await login.passwordInput.press('Enter');
    await expect(page).toHaveURL(/\/prijava/);
    await expect(login.passwordInput).toHaveValue(fixture.password);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    // RECONNECT: the re-render that lifts the gate is the settle point; a
    // sign-in sent by the reconnect itself would be issued from it.
    await page.context().setOffline(false);
    await expect(note).toHaveCount(0);
    await expect(login.submitButton).not.toHaveAttribute('aria-disabled', 'true');
    expect(spy.writes(), 'the reconnect signed somebody in').toEqual([]);
    await expect(page).toHaveURL(/\/prijava/);
  });

  test('the set-password submit is gated offline, and the reconnect saves nothing', async ({ page, fixture }) => {
    const member = await seedLeaveMember(fixture.slug, fixture.team.id, today(), 20);
    members.push({ slug: fixture.slug, id: member.id });
    await holdAtSetPasswordInSql(fixture.slug, member.id);
    const login = new LoginPage(page);
    const step = new SetPasswordPage(page);
    const chosen = `${member.username}-vlastita`;

    await login.submitSignIn(fixture.slug, member.username, member.password);
    await expect(step.stepHeading).toBeVisible();
    await step.passwordInput.fill(chosen);
    await step.repeatInput.fill(chosen);

    const spy = spyOnApi(page);
    await page.context().setOffline(true);
    await expectGated(step.submitButton, offlineWriteNoteIn(page));

    await press(step.submitButton);
    await step.repeatInput.press('Enter');
    await expect(step.stepHeading).toBeVisible();
    await expect(step.repeatInput).toHaveValue(chosen);
    expect(spy.all(), 'a request left the page offline').toEqual([]);

    await page.context().setOffline(false);
    await expectLifted(step.submitButton, page);
    expect(spy.writes(), 'the reconnect saved a password').toEqual([]);
    await expect(step.stepHeading).toBeVisible();
  });
});
