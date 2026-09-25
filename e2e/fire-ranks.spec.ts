import { randomBytes } from 'node:crypto';

import { ADMIN_STATE, MEMBER_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { uniqueMember } from './support/members.ts';
import { expect, test } from './support/test.ts';

test.use({ storageState: ADMIN_STATE });

test('with fire ranks switched on, a member created with a rank shows it on the roster', async ({
  page,
  browser,
}) => {
  // The setting is switched ON and left on: the run's organization is its own
  // and is deleted at teardown, and switching it back off could race another
  // attempt of this test. Nothing else in the suite depends on it being off —
  // the rank control is optional and the roster still lists every name.
  await page.goto('/organizacija');
  await page
    .getByLabel(hr.organization.fireRanks, { exact: true })
    .selectOption({ label: hr.organization.fireRanksOn });
  await expect(page.getByText(hr.organization.fireRanksStatusOn, { exact: true })).toBeVisible();

  // A fresh team and a fresh member per attempt, for the reason teams.spec.ts
  // gives: a member moves teams only once per date.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Docasnik');
  const rank = hr.ljudi.rank.nco;

  await page.goto('/ljudi/smjene');
  await page.getByLabel(hr.smjene.name, { exact: true }).fill(teamName);
  await page.getByRole('button', { name: hr.smjene.add }).click();
  await expect(page.getByRole('status')).toHaveText(hr.smjene.created);

  await page.getByRole('link', { name: fill(hr.smjene.edit, { name: teamName }) }).click();
  const teamPath = /\/ljudi\/smjene\/([0-9a-f-]{36})$/;
  await expect(page).toHaveURL(teamPath);
  const teamId = teamPath.exec(new URL(page.url()).pathname)?.[1];
  if (teamId === undefined) throw new Error(`E2E: no team id in ${page.url()}`);

  // Issue the member WITH a rank: the rank travels in the one create call.
  await page.goto('/ljudi/novi');
  await page.getByLabel(hr.ljudi.name, { exact: true }).fill(person.name);
  await page.getByLabel(hr.ljudi.form.username, { exact: true }).fill(person.username);
  await page.getByLabel(hr.ljudi.rank.label, { exact: true }).selectOption({ label: rank });
  await page.getByRole('button', { name: hr.ljudi.form.save }).click();
  await expect(page.getByRole('status')).toHaveText(hr.ljudi.form.created);

  // The edit form reads the stored rank back.
  await page.goto('/ljudi');
  await page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: person.name }) }).click();
  await expect(page.getByLabel(hr.ljudi.rank.label, { exact: true }).locator('option:checked')).toHaveText(
    rank,
  );

  // Put them on the team from today, then read the roster.
  await page.getByLabel(hr.smjene.membership.team, { exact: true }).selectOption({ label: teamName });
  await page.getByRole('button', { name: fill(hr.smjene.membership.move, { name: person.name }) }).click();
  await page
    .getByRole('button', { name: fill(hr.smjene.membership.moveConfirm, { name: person.name }) })
    .click();
  await expect(page.getByText(hr.smjene.membership.saved, { exact: true })).toBeVisible();

  // THE EXACT LINE. With fire ranks and positions on, the move put the member
  // on the team in the default position, so the roster names both.
  const onRoster = fill(hr.smjene.roster.withRankAndPosition, {
    name: person.name,
    rank,
    position: hr.smjene.position.firefighter,
  });

  await page.goto(`/smjene/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name: teamName })).toBeVisible();
  await expect(page.getByRole('listitem').getByText(onRoster, { exact: true })).toBeVisible();

  // The member role reads the rank through the roster RPC, not the members table.
  const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/smjene/${teamId}`);
    await expect(memberPage.getByRole('listitem').getByText(onRoster, { exact: true })).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
