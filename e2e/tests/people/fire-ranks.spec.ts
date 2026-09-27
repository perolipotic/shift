import { randomBytes } from 'node:crypto';

import { TeamsPage } from '../../pages/teams.page.ts';
import { holdFireRanks, type RotationHold } from '../../utils/database-helper.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { uniqueMember } from '../../utils/members.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

/**
 * The fire-rank setting, held for this test (story 3.4b): `calendar.spec.ts`
 * switches it off for a moment to read the day detail without ranks.
 */
let ranksHold: RotationHold | null = null;

test.beforeEach(async ({ fixture }) => {
  ranksHold = holdFireRanks(fixture.slug);
  await ranksHold.ready;
});

test.afterEach(async () => {
  await ranksHold?.release();
  ranksHold = null;
});

test('with fire ranks switched on, a member created with a rank shows it on the roster', async ({
  page,
  browser,
  organizationPage,
  peoplePage,
  teamsPage,
  holdRotationForTeams,
}) => {
  // The setting is switched ON and left on: the run's organization is its own
  // and is deleted at teardown, and switching it back off could race another
  // attempt of this test. Nothing else in the suite depends on it being off —
  // the rank control is optional and the roster still lists every name.
  await organizationPage.goto();
  await organizationPage.switchFireRanksOn();
  await expect(organizationPage.text(hr.organization.fireRanksStatusOn)).toBeVisible();

  // A fresh team and a fresh member per attempt, for the reason teams.spec.ts
  // gives: a member moves teams only once per date.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Docasnik');
  const rank = hr.ljudi.rank.nco;

  await teamsPage.goto();
  // Under the rotation's hold (`holdRotationForTeams`): a team added between
  // a rotation spec's save and its reload would empty that spec's prefill.
  await holdRotationForTeams(async () => {
    // The add form is a dialog, opened from the header.
    await teamsPage.addTeam(teamName);
    await expect(teamsPage.status).toHaveText(hr.smjene.created);
  });

  await teamsPage.openTeam(teamName);
  const teamPath = /\/ljudi\/smjene\/([0-9a-f-]{36})$/;
  await expect(page).toHaveURL(teamPath);
  const teamId = teamPath.exec(new URL(page.url()).pathname)?.[1];
  if (teamId === undefined) throw new Error(`E2E: no team id in ${page.url()}`);

  // Issue the member WITH a rank: the rank travels in the one create call.
  await peoplePage.gotoNew();
  await peoplePage.fillNewMember(person.name, person.username);
  await peoplePage.rankSelect.selectOption({ label: rank });
  await peoplePage.saveButton.click();
  await expect(peoplePage.status).toHaveText(hr.ljudi.form.created);

  // The edit form reads the stored rank back.
  await peoplePage.openMember(person.name);
  await expect(peoplePage.selectedRank).toHaveText(rank);

  // Put them on the team from today, then read the roster.
  await peoplePage.moveToTeam(teamName, person.name);
  await expect(peoplePage.text(hr.smjene.membership.saved)).toBeVisible();

  // THE EXACT LINE. With fire ranks and positions on, the move put the member
  // on the team in the default position, so the roster names both.
  const onRoster = fill(hr.smjene.roster.withRankAndPosition, {
    name: person.name,
    rank,
    position: hr.smjene.position.firefighter,
  });

  await teamsPage.gotoRoster(teamId);
  await expect(teamsPage.heading(teamName)).toBeVisible();
  await expect(teamsPage.rosterLine(onRoster)).toBeVisible();

  // The member role reads the rank through the roster RPC, not the members table.
  const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
  try {
    const memberTeams = new TeamsPage(await memberContext.newPage());
    await memberTeams.gotoRoster(teamId);
    await expect(memberTeams.rosterLine(onRoster)).toBeVisible();
  } finally {
    await memberContext.close();
  }
});
