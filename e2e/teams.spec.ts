import { randomBytes } from 'node:crypto';

import { ADMIN_STATE, MEMBER_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { createMember, uniqueMember } from './support/members.ts';
import { expect, test } from './support/test.ts';

test.use({ storageState: ADMIN_STATE });

test('a created team gets a member, and its roster lists them for every role', async ({ page, browser }) => {
  // EVERYTHING THIS TEST WRITES IS ITS OWN, per attempt: a member can move
  // teams only once per date, so a retry reusing a fixture member would be
  // refused. A fresh team and a fresh member make a second attempt a first.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Premjestena');

  // Create the team.
  await page.goto('/ljudi/smjene');
  await page.getByLabel(hr.smjene.name, { exact: true }).fill(teamName);
  await page.getByRole('button', { name: hr.smjene.add }).click();
  await expect(page.getByRole('status')).toHaveText(hr.smjene.created);

  await page.getByRole('link', { name: fill(hr.smjene.edit, { name: teamName }) }).click();
  const teamPath = /\/ljudi\/smjene\/([0-9a-f-]{36})$/;
  await expect(page).toHaveURL(teamPath);
  const teamId = teamPath.exec(new URL(page.url()).pathname)?.[1];
  if (teamId === undefined) throw new Error(`E2E: no team id in ${page.url()}`);

  // Issue the member, then put them on the team from today (the date field's
  // default).
  await createMember(page, person.name, person.username);
  await page.goto('/ljudi');
  await page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: person.name }) }).click();
  await page.getByLabel(hr.smjene.membership.team, { exact: true }).selectOption({ label: teamName });
  await page.getByRole('button', { name: fill(hr.smjene.membership.move, { name: person.name }) }).click();
  await page
    .getByRole('button', { name: fill(hr.smjene.membership.moveConfirm, { name: person.name }) })
    .click();
  await expect(page.getByText(hr.smjene.membership.saved, { exact: true })).toBeVisible();

  // The roster, as the admin.
  await page.goto(`/smjene/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name: teamName })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: person.name })).toBeVisible();

  // And as the member role, which reaches every roster of its organization.
  const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/smjene/${teamId}`);
    await expect(memberPage.getByRole('heading', { level: 1, name: teamName })).toBeVisible();
    await expect(memberPage.getByRole('listitem').filter({ hasText: person.name })).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
