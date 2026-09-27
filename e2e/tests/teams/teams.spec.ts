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
  holdRotationForTeams,
}) => {
  // EVERYTHING THIS TEST WRITES IS ITS OWN, per attempt: a member can move
  // teams only once per date, so a retry reusing a fixture member would be
  // refused. A fresh team and a fresh member make a second attempt a first.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Premjestena');

  // Create the team, under the rotation's hold (`holdRotationForTeams`).
  await teamsPage.goto();
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
  await expect(teamsPage.rosterCount(1)).toBeVisible();

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

/** The id in a team's `/ljudi/smjene/:id` URL. */
function teamIdOf(url: string): string {
  const id = /\/ljudi\/smjene\/([0-9a-f-]{36})$/.exec(new URL(url).pathname)?.[1];
  if (id === undefined) throw new Error(`E2E: no team id in ${url}`);

  return id;
}

test('a taken name is refused in the add dialog, keeping what was typed, with the field marked and focused', async ({
  teamsPage,
  fixture,
}) => {
  // Nothing is written: the fixture team's own name is refused.
  await teamsPage.goto();
  await teamsPage.addTeam(fixture.team.name);

  await expect(teamsPage.addDialog).toBeVisible();
  await expect(teamsPage.addRefusal).toHaveText(hr.smjene.error.taken);
  await expect(teamsPage.addNameInput).toHaveValue(fixture.team.name);
  await expect(teamsPage.addNameInput).toHaveAttribute('aria-invalid', 'true');
  await expect(teamsPage.addNameInput).toBeFocused();
});

test('a renamed team is confirmed and listed under its new name', async ({ page, teamsPage, holdRotationForTeams }) => {
  // ITS OWN TEAM, per attempt, added under the rotation's hold and archived
  // at the end.
  // Neither name holds the other, so a link matched by either is that team's alone.
  const suffix = randomBytes(3).toString('hex');
  const teamName = `Smjena ${suffix}`;
  const renamed = `Preimenovana ${suffix}`;

  await teamsPage.goto();
  await holdRotationForTeams(async () => {
    await teamsPage.addTeam(teamName);
    await expect(teamsPage.status).toHaveText(hr.smjene.created);
  });
  await teamsPage.openTeam(teamName);
  await expect(teamsPage.editDialog).toBeVisible();

  await teamsPage.editNameInput.fill(renamed);
  await teamsPage.editSaveButton.click();
  await expect(teamsPage.statusWith(hr.smjene.saved)).toBeVisible();
  await expect(teamsPage.editNameInput).toHaveValue(renamed);

  await teamsPage.closeButton.click();
  await expect(page).toHaveURL('/ljudi/smjene');
  await expect(teamsPage.editLink(renamed)).toBeVisible();
  await expect(teamsPage.editLink(teamName)).toHaveCount(0);

  // Archived at the end, so this test leaves no active team behind.
  await teamsPage.openTeam(renamed);
  await teamsPage.archiveButton(renamed).click();
  await teamsPage.archiveConfirmButton(renamed).click();
  await expect(teamsPage.statusWith(hr.smjene.archivedDone)).toBeVisible();
});

test('an archived team asks first, keeps what was typed when cancelled, moves under the archived heading, and its roster says so', async ({
  page,
  teamsPage,
  holdRotationForTeams,
}) => {
  // ITS OWN TEAM, per attempt, added under the rotation's hold, and never
  // given a member: a team with members cannot be archived.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const typed = `${teamName} upisano`;

  await teamsPage.goto();
  await holdRotationForTeams(async () => {
    await teamsPage.addTeam(teamName);
    await expect(teamsPage.status).toHaveText(hr.smjene.created);
  });
  await teamsPage.openTeam(teamName);
  await expect(teamsPage.editDialog).toBeVisible();
  const teamId = teamIdOf(page.url());

  // Armed: the confirmation names the team, in place of the form.
  await teamsPage.editNameInput.fill(typed);
  await teamsPage.archiveButton(teamName).click();
  await expect(teamsPage.archivePrompt(teamName)).toBeVisible();
  await expect(teamsPage.editNameInput).toBeHidden();

  // Cancelled: back to the form, with what was typed.
  await teamsPage.archiveCancelButton.click();
  await expect(teamsPage.editNameInput).toHaveValue(typed);

  // Confirmed: archived, and the dialog now views the team.
  await teamsPage.archiveButton(teamName).click();
  await teamsPage.archiveConfirmButton(teamName).click();
  await expect(teamsPage.statusWith(hr.smjene.archivedDone)).toBeVisible();
  await expect(teamsPage.viewDialog).toBeVisible();
  await expect(teamsPage.text(hr.smjene.archivedNote)).toBeVisible();

  // Closed, it is listed under the archived heading, viewed rather than edited.
  await teamsPage.closeButton.click();
  await expect(page).toHaveURL('/ljudi/smjene');
  await expect(teamsPage.archivedViewLink(teamName)).toBeVisible();
  await expect(teamsPage.editLink(teamName)).toHaveCount(0);

  // Its roster: the archived notice, and nobody in it.
  await teamsPage.gotoRoster(teamId);
  await expect(teamsPage.heading(teamName)).toBeVisible();
  await expect(teamsPage.rosterArchivedNotice).toBeVisible();
  await expect(teamsPage.rosterCount(0)).toBeVisible();
});
