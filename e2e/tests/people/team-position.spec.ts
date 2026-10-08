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

/** A message as a pattern, with `{date}` standing for whatever the screen
 *  formats the date as and every other placeholder filled. */
function withAnyDate(message: string, values: Readonly<Record<string, string>>): RegExp {
  const escaped = fill(message, values).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`^${escaped.replace('\\{date\\}', '.+')}$`);
}

/** An ISO date `days` after another, by calendar arithmetic in UTC. */
function isoDaysAfter(iso: string, days: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);

  return day.toISOString().slice(0, 10);
}

test('with positions in use, a member moved in as driver shows it on the roster, and a promotion is scheduled', async ({
  page,
  browser,
  organizationPage,
  peoplePage,
  teamsPage,
  holdRotationForTeams,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  // THE SETTING IS SWITCHED ON and left on, for the reason fire-ranks.spec.ts
  // gives: the run's organization is its own and is deleted at teardown.
  await organizationPage.goto();
  await organizationPage.switchFireRanksOn();
  await expect(organizationPage.text(hr.organization.fireRanksStatusOn)).toBeVisible();

  // A fresh team and a fresh member per attempt: a member changes team or
  // position only once per date.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Vozac');
  const driver = hr.smjene.position.driver;
  const commander = hr.smjene.position.commander;

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

  // Issued with no rank, so the roster line is the name and the position alone.
  await peoplePage.createMember(person.name, person.username);

  await peoplePage.openMember(person.name);

  // MOVE IN AS DRIVER, from today, in the team dialog (story 7.11): it opens
  // empty, and the position control follows the team pick, opening on the
  // default for a move.
  await peoplePage.moveButton(person.name).click();
  await expect(peoplePage.selectedTeam).toHaveText(hr.smjene.membership.choose);
  await expect(peoplePage.positionSelect).toHaveCount(0);
  await peoplePage.teamSelect.selectOption({ label: teamName });
  const position = peoplePage.positionSelect;
  await expect(peoplePage.selectedPosition).toHaveText(hr.smjene.position.firefighter);
  await position.selectOption({ label: driver });
  await peoplePage.teamSaveButton.click();
  await expect(peoplePage.teamDialog).toHaveCount(0);
  await expect(peoplePage.teamCard.getByRole('status')).toContainText(hr.smjene.membership.saved);
  await expect(
    peoplePage.text(fill(hr.smjene.membership.currentPosition, { team: teamName, position: driver })),
  ).toBeVisible();
  // THE HEADER says it too: the position in the team.
  await expect(peoplePage.text(`${driver}${hr.ljudi.page.separator}${teamName}`, { exact: false })).toBeVisible();

  // THE ROSTER, for the admin and for the member role.
  const onRoster = fill(hr.smjene.roster.withPosition, { name: person.name, position: driver });

  await teamsPage.gotoRoster(teamId);
  await expect(teamsPage.heading(teamName)).toBeVisible();
  await expect(teamsPage.rosterLine(onRoster)).toBeVisible();

  const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
  try {
    const memberTeams = new TeamsPage(await memberContext.newPage());
    await memberTeams.gotoRoster(teamId);
    await expect(memberTeams.rosterLine(onRoster)).toBeVisible();
  } finally {
    await memberContext.close();
  }

  // A POSITION-ONLY CHANGE to commander, from a later date: the same team,
  // marked `sadašnja` and still choosable while positions are used, opens on
  // the member's current position. No second confirm: Spremi writes.
  const currentChoice = fill(hr.smjene.membership.currentChoice, { team: teamName });

  await peoplePage.openMember(person.name);
  await peoplePage.moveButton(person.name).click();
  await expect(peoplePage.teamSelect.getByRole('option', { name: currentChoice })).toBeEnabled();
  await peoplePage.teamSelect.selectOption({ label: currentChoice });
  await expect(peoplePage.selectedPosition).toHaveText(driver);
  await position.selectOption({ label: commander });

  const date = peoplePage.dateInput;
  const minimum = await date.getAttribute('min');
  if (minimum === null) throw new Error('E2E: the team date control has no minimum');
  await date.fill(isoDaysAfter(minimum, 7));

  await peoplePage.teamSaveButton.click();
  await expect(peoplePage.teamDialog).toHaveCount(0);
  await expect(peoplePage.teamCard.getByRole('status')).toContainText(hr.smjene.membership.saved);

  // SCHEDULED — worded as a position change in the same team, never as a move
  // onto it — and offered only as a withdrawal.
  const scheduledLine = peoplePage.text(
    withAnyDate(hr.smjene.membership.scheduledPositionOnly, { team: teamName, position: commander }),
    { exact: false },
  );
  await expect(scheduledLine).toBeVisible();
  const withdraw = peoplePage.withdrawButton(person.name);
  await expect(withdraw).toBeVisible();
  // NO MOVE IS OFFERED beside a scheduled change: no Promijeni, no controls.
  await expect(peoplePage.moveButton(person.name)).toHaveCount(0);
  await expect(position).toHaveCount(0);

  // Today is still driver on the roster.
  await teamsPage.gotoRoster(teamId);
  await expect(teamsPage.rosterLine(onRoster)).toBeVisible();

  // WITHDRAW it, exactly like a move: the line goes and the offer returns.
  await peoplePage.openMember(person.name);
  await withdraw.click();
  await peoplePage.withdrawConfirmButton(person.name).click();
  await expect(peoplePage.text(hr.smjene.membership.saved)).toBeVisible();
  await expect(scheduledLine).toHaveCount(0);
  await expect(peoplePage.moveButton(person.name)).toBeVisible();
  await peoplePage.moveButton(person.name).click();
  await peoplePage.teamSelect.selectOption({ label: currentChoice });
  await expect(peoplePage.selectedPosition).toHaveText(driver);
});
