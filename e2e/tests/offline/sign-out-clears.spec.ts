import type { Browser, BrowserContext, Page } from '@playwright/test';

import { LoginPage } from '../../pages/login.page.ts';
import { TodayPage } from '../../pages/today.page.ts';
import { SetPasswordPage } from '../../pages/set-password.page.ts';
import {
  holdAtSetPasswordInSql,
  removeLeaveMemberInSql,
  seedLeaveMember,
  type SeededLeaveMember,
} from '../../utils/database-helper.ts';
import { hr } from '../../utils/i18n.ts';
import { deviceSnapshotOf, snapshotDataOf, type DeviceSnapshot } from '../../utils/offline.ts';
import { RUN_TIMEZONE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 8.3a: signing out clears the device. A member reads *Danas* online,
 * and the device snapshot — IndexedDB's `shift-query-cache`, tagged with
 * their auth user id — is there. *Odjava*, from the sidebar's profile menu
 * and from the phone's *Više* sheet, deletes it before the sign-in form
 * renders. A second account signing in on the same device starts from
 * nothing: the snapshot it keeps is its own, and the chrome names it, never
 * the first.
 *
 * OFFLINE, WITH AN EXPIRED TOKEN — the truck an hour after the last token —
 * auth-js cannot load the session to sign it out; *Odjava* falls back to a
 * local sign-out, lands on `/prijava`, and the snapshot and the stored
 * session are gone.
 *
 * Every account here is FRESH, seeded per test: a sign-out revokes every
 * session of its account (supabase-js signs out globally), so the stored
 * member and the spare account the sign-in spec uses are never touched.
 */

let written: { readonly slug: string; readonly members: string[] } | null = null;

test.afterEach(async () => {
  // EVERY REMOVAL RUNS, whichever fails; the first failure is reported once all have run.
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (cause) {
      failures.push(cause);
    }
  };
  const own = written;
  written = null;
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  if (failures.length > 0) throw failures[0];
});

/** The organization's today, `YYYY-MM-DD`, in the run's zone. */
function organizationToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: RUN_TIMEZONE }).format(new Date());
}

/** A fresh member account of the run organization, on the fixture team, removed after the test. */
async function freshMember(slug: string, teamId: string): Promise<SeededLeaveMember> {
  written ??= { slug, members: [] };
  const member = await seedLeaveMember(slug, teamId, organizationToday(), 20);
  written.members.push(member.id);

  return member;
}

/** A context of its own with nobody signed in, so its storage is this test's alone. */
async function freshDevice(browser: Browser, phone = false): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  });

  return { context, page: await context.newPage() };
}

/** Signs `member` in, reads *Danas* whole, and answers the snapshot the device then keeps. */
async function readDanas(page: Page, slug: string, member: SeededLeaveMember): Promise<DeviceSnapshot> {
  const today = new TodayPage(page);
  await new LoginPage(page).signIn(slug, member.username, member.password);
  await expect(today.hoursTile).toBeVisible();
  await expect(today.leaveTile).toBeVisible();
  await expect(today.busyMain).toHaveCount(0);

  let kept: DeviceSnapshot | null = null;
  await expect
    .poll(
      async () => {
        kept = await deviceSnapshotOf(page);

        return kept !== null && snapshotDataOf(kept, 'member-name') !== undefined;
      },
      { message: 'the device keeps no snapshot after Danas was read', timeout: 15_000 },
    )
    .toBe(true);

  if (kept === null) throw new Error('E2E: no snapshot');

  return kept;
}

/** Rewrites the stored session's `expires_at` to an hour ago: the token expires on the device. */
async function expireStoredToken(page: Page): Promise<void> {
  const rewritten = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => /^sb-.+-auth-token$/.test(name));
    if (key === undefined) return false;
    const session = JSON.parse(localStorage.getItem(key) ?? 'null') as { expires_at?: number } | null;
    if (session === null) return false;
    session.expires_at = Math.floor(Date.now() / 1000) - 3600;
    localStorage.setItem(key, JSON.stringify(session));

    return true;
  });
  expect(rewritten, 'no stored session to expire').toBe(true);
}

/** The auth sessions stored on the device. */
async function storedSessions(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).filter((name) => /^sb-.+-auth-token$/.test(name)));
}

/** Waits until the device holds no snapshot. */
async function expectNoSnapshot(page: Page): Promise<void> {
  await expect
    .poll(async () => deviceSnapshotOf(page), { message: 'the snapshot outlived the sign-out', timeout: 10_000 })
    .toBeNull();
}

test('Odjava from the sidebar deletes the device snapshot, and a second account sees none of the first', async ({
  browser,
  fixture,
}) => {
  const first = await freshMember(fixture.slug, fixture.team.id);
  const second = await freshMember(fixture.slug, fixture.team.id);
  const { context, page } = await freshDevice(browser);

  try {
    const login = new LoginPage(page);
    const before = await readDanas(page, fixture.slug, first);
    expect(before.owner, 'the snapshot carries its owner').not.toBe('');

    const profile = login.profileButton(first.name);
    await profile.click();
    await login.signOutButton.click();
    await expect(page).toHaveURL('/prijava');
    await expect(login.signInHeading).toBeVisible();
    await expectNoSnapshot(page);

    // THE SECOND ACCOUNT, on the same device.
    const after = await readDanas(page, fixture.slug, second);
    expect(after.owner, "the second account's snapshot is the first's").not.toBe(before.owner);
    expect(JSON.stringify(after.queries), "the first account's id is in the second's snapshot").not.toContain(
      before.owner,
    );
    expect(snapshotDataOf(after, 'member-name'), "the chrome's name is not the second account's").not.toEqual(
      snapshotDataOf(before, 'member-name'),
    );
    await expect(login.profileButton(second.name)).toBeVisible();
    await expect(login.profileButton(first.name)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('Odjava from the Više sheet on a phone deletes the device snapshot', async ({ browser, fixture }) => {
  const member = await freshMember(fixture.slug, fixture.team.id);
  const { context, page } = await freshDevice(browser, true);

  try {
    const login = new LoginPage(page);
    await readDanas(page, fixture.slug, member);

    await login.moreButton.click();
    await expect(login.moreSheet).toBeVisible();
    await login.moreSheet.getByRole('button', { name: hr.shell.signOut, exact: true }).click();
    await expect(page).toHaveURL('/prijava');
    await expect(login.signInHeading).toBeVisible();
    await expectNoSnapshot(page);
  } finally {
    await context.close();
  }
});

test('offline with an expired token, Odjava signs out locally and deletes the device snapshot', async ({
  browser,
  fixture,
}) => {
  const member = await freshMember(fixture.slug, fixture.team.id);
  const { context, page } = await freshDevice(browser);

  try {
    const login = new LoginPage(page);
    await readDanas(page, fixture.slug, member);

    await context.setOffline(true);
    // THE TOKEN EXPIRES while offline: the stored session's `expires_at` an hour ago.
    await expireStoredToken(page);

    await login.profileButton(member.name).click();
    const pressed = Date.now();
    await login.signOutButton.click();

    await expect(page).toHaveURL('/prijava');
    // WITHIN SECONDS: never auth-js's ~30 s refresh back-off.
    expect(Date.now() - pressed, 'the offline Odjava waited out the refresh').toBeLessThan(5_000);
    await expect(login.signInHeading).toBeVisible();
    // No refusal: the local sign-out is the success.
    await expect(login.alertWith(hr.shell.error.signOut)).toHaveCount(0);
    await expectNoSnapshot(page);
    expect(await storedSessions(page), 'the session is still stored on the device').toEqual([]);
  } finally {
    await context.close();
  }
});

test("offline with an expired token, the set-password step's Odjava signs out locally", async ({ browser, fixture }) => {
  const member = await freshMember(fixture.slug, fixture.team.id);
  await holdAtSetPasswordInSql(fixture.slug, member.id);
  const { context, page } = await freshDevice(browser);

  try {
    const login = new LoginPage(page);
    const step = new SetPasswordPage(page);
    await login.submitSignIn(fixture.slug, member.username, member.password);
    await expect(step.stepHeading).toBeVisible();

    await context.setOffline(true);
    await expireStoredToken(page);

    const pressed = Date.now();
    await step.signOutButton.click();
    await expect(page).toHaveURL('/prijava');
    await expect(login.signInHeading).toBeVisible();
    expect(Date.now() - pressed, 'the offline Odjava waited out the refresh').toBeLessThan(5_000);
    await expect(step.alertWith(hr.auth.setPassword.error.signOut)).toHaveCount(0);
    expect(await storedSessions(page), 'the session is still stored on the device').toEqual([]);
    await expectNoSnapshot(page);
  } finally {
    await context.close();
  }
});
