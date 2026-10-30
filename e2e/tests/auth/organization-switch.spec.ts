import type { Browser, BrowserContext } from '@playwright/test';

import { LoginPage } from '../../pages/login.page.ts';
import { removeLeaveMemberInSql, seedLeaveMember, type SeededLeaveMember } from '../../utils/database-helper.ts';
import { hr } from '../../utils/i18n.ts';
import { deviceSnapshotOf } from '../../utils/offline.ts';
import { RUN_TIMEZONE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Retro 10 A5: a signed-in visitor on ANOTHER organization's sign-in link is
 * offered that organization, never silently redirected inside the current one.
 *
 * Each test signs in a FRESH member of its own, in a context of its own: the
 * switch signs out, and supabase-js revokes every session of the account, so
 * the stored member state or the spare account must never be the one signed
 * out here. Organization B need not exist: nothing is looked up before
 * sign-in, and the offer only compares the session's slug with the link's.
 */

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: RUN_TIMEZONE }).format(new Date());

let context: BrowserContext | undefined;
let member: SeededLeaveMember | undefined;

test.afterEach(async ({ fixture }) => {
  await context?.close();
  context = undefined;
  if (member !== undefined) await removeLeaveMemberInSql(fixture.slug, member.id);
  member = undefined;
});

async function signedIn(browser: Browser, slug: string, teamId: string): Promise<LoginPage> {
  member = await seedLeaveMember(slug, teamId, today(), 0);
  context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const login = new LoginPage(await context.newPage());
  await login.signIn(slug, member.username, member.password);

  return login;
}

test('a link for the same organization still goes where povratak points', async ({ browser, fixture }) => {
  const login = await signedIn(browser, fixture.slug, fixture.team.id);

  await login.page.goto(`/prijava/${fixture.slug.toUpperCase()}?povratak=%2Fgodisnji`);
  await expect(login.page).toHaveURL('/godisnji');
  await expect(login.switchHeading).toHaveCount(0);
});

test('a link for another organization offers it; staying keeps the session in this one', async ({
  browser,
  fixture,
}) => {
  const login = await signedIn(browser, fixture.slug, fixture.team.id);
  const other = `${fixture.slug}-b`;

  await login.page.goto(`/prijava/${other}?povratak=%2Fgodisnji`);
  await expect(login.switchHeading).toBeVisible();
  await expect(login.switchBody(fixture.slug, other)).toBeVisible();
  // Not followed inside this organization, and no form over a live session.
  await expect(login.page).toHaveURL(`/prijava/${other}?povratak=%2Fgodisnji`);
  await expect(login.usernameInput).toHaveCount(0);

  await login.stayButton(fixture.slug).click();
  await expect(login.page).toHaveURL('/danas');
  await expect(login.heading(hr.nav.danas)).toBeVisible();
});

test('choosing the other organization signs out first, then opens its form with the return path', async ({
  browser,
  fixture,
}) => {
  const login = await signedIn(browser, fixture.slug, fixture.team.id);
  const other = `${fixture.slug}-b`;
  // A's Danas is read and kept on the device before the switch.
  await expect(login.heading(hr.nav.danas)).toBeVisible();
  await expect
    .poll(async () => (await deviceSnapshotOf(login.page))?.owner ?? null, {
      message: "A's snapshot was never kept",
      timeout: 10_000,
    })
    .not.toBeNull();

  await login.page.goto(`/prijava/${other}?povratak=%2Fgodisnji`);
  await login.switchButton(other).click();

  await expect(login.signInHeading).toBeVisible();
  await expect(login.page).toHaveURL(`/prijava/${other}?povratak=%2Fgodisnji`);
  await expect(login.organizationRow).toContainText(other);
  await expect(login.usernameInput).toBeVisible();
  // NOTHING OF A SURVIVES INTO B: the device's kept snapshot went with the session.
  await expect
    .poll(async () => deviceSnapshotOf(login.page), { message: "A's snapshot outlived the switch", timeout: 10_000 })
    .toBeNull();

  // The session ended: a signed-in route sends the visitor to sign in.
  await login.page.goto('/danas');
  await expect(login.page).toHaveURL(/\/prijava/);
  await expect(login.signInHeading).toBeVisible();
});
