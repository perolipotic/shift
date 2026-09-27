import { randomBytes } from 'node:crypto';

import { TeamsPage } from '../../pages/teams.page.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { uniqueMember } from '../../utils/members.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

test('a created team gets a member, and its roster lists them for every role', async ({
  page,
  browser,
  peoplePage,
  teamsPage,
}) => {
  // EVERYTHING THIS TEST WRITES IS ITS OWN, per attempt: a member can move
  // teams only once per date, so a retry reusing a fixture member would be
  // refused. A fresh team and a fresh member make a second attempt a first.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Premjestena');

  // Create the team.
  await teamsPage.goto();
  // The add form is a dialog, opened from the header.
  await teamsPage.addTeam(teamName);
  await expect(teamsPage.status).toHaveText(hr.smjene.created);

  await teamsPage.openTeam(teamName);
  const teamPath = /\/ljudi\/smjene\/([0-9a-f-]{36})$/;
  await expect(page).toHaveURL(teamPath);
  const teamId = teamPath.exec(new URL(page.url()).pathname)?.[1];
  if (teamId === undefined) throw new Error(`E2E: no team id in ${page.url()}`);

  // Issue the member, then put them on the team from today (the date field's
  // default).
  await peoplePage.createMember(person.name, person.username);
  await peoplePage.openMember(person.name);
  await peoplePage.moveToTeam(teamName, person.name);
  await expect(peoplePage.text(hr.smjene.membership.saved)).toBeVisible();

  // The roster, as the admin.
  await teamsPage.gotoRoster(teamId);
  await expect(teamsPage.heading(teamName)).toBeVisible();
  await expect(teamsPage.rosterEntry(person.name)).toBeVisible();

  // And as the member role, which reaches every roster of its organization.
  const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
  try {
    const memberTeams = new TeamsPage(await memberContext.newPage());
    await memberTeams.gotoRoster(teamId);
    await expect(memberTeams.heading(teamName)).toBeVisible();
    await expect(memberTeams.rosterEntry(person.name)).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
