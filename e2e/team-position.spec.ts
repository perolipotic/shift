import { randomBytes } from 'node:crypto';

import { ADMIN_STATE, MEMBER_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { createMember, uniqueMember } from './support/members.ts';
import { expect, test } from './support/test.ts';

test.use({ storageState: ADMIN_STATE });

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
}) => {
  // THE SETTING IS SWITCHED ON and left on, for the reason fire-ranks.spec.ts
  // gives: the run's organization is its own and is deleted at teardown.
  await page.goto('/organizacija');
  await page
    .getByLabel(hr.organization.fireRanks, { exact: true })
    .selectOption({ label: hr.organization.fireRanksOn });
  await expect(page.getByText(hr.organization.fireRanksStatusOn, { exact: true })).toBeVisible();

  // A fresh team and a fresh member per attempt: a member changes team or
  // position only once per date.
  const teamName = `Smjena ${randomBytes(3).toString('hex')}`;
  const person = uniqueMember('Vozac');
  const driver = hr.smjene.position.driver;
  const commander = hr.smjene.position.commander;

  await page.goto('/ljudi/smjene');
  await page.getByLabel(hr.smjene.name, { exact: true }).fill(teamName);
  await page.getByRole('button', { name: hr.smjene.add }).click();
  await expect(page.getByRole('status')).toHaveText(hr.smjene.created);

  await page.getByRole('link', { name: fill(hr.smjene.edit, { name: teamName }) }).click();
  const teamPath = /\/ljudi\/smjene\/([0-9a-f-]{36})$/;
  await expect(page).toHaveURL(teamPath);
  const teamId = teamPath.exec(new URL(page.url()).pathname)?.[1];
  if (teamId === undefined) throw new Error(`E2E: no team id in ${page.url()}`);

  // Issued with no rank, so the roster line is the name and the position alone.
  await createMember(page, person.name, person.username);

  await page.goto('/ljudi');
  await page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: person.name }) }).click();

  // MOVE IN AS DRIVER, from today. The position control follows the team pick
  // and opens on the default for a move.
  await page.getByLabel(hr.smjene.membership.team, { exact: true }).selectOption({ label: teamName });
  const position = page.getByLabel(hr.smjene.position.label, { exact: true });
  await expect(position.locator('option:checked')).toHaveText(hr.smjene.position.firefighter);
  await position.selectOption({ label: driver });
  await page.getByRole('button', { name: fill(hr.smjene.membership.move, { name: person.name }) }).click();
  await expect(
    page.getByText(
      withAnyDate(hr.smjene.membership.movePositionPrompt, {
        name: person.name,
        team: teamName,
        position: driver,
      }),
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: fill(hr.smjene.membership.moveConfirm, { name: person.name }) })
    .click();
  await expect(page.getByText(hr.smjene.membership.saved, { exact: true })).toBeVisible();
  await expect(
    page.getByText(fill(hr.smjene.membership.currentPosition, { team: teamName, position: driver }), {
      exact: true,
    }),
  ).toBeVisible();

  // THE ROSTER, for the admin and for the member role.
  const onRoster = fill(hr.smjene.roster.withPosition, { name: person.name, position: driver });

  await page.goto(`/smjene/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name: teamName })).toBeVisible();
  await expect(page.getByRole('listitem').getByText(onRoster, { exact: true })).toBeVisible();

  const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
  try {
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/smjene/${teamId}`);
    await expect(memberPage.getByRole('listitem').getByText(onRoster, { exact: true })).toBeVisible();
  } finally {
    await memberContext.close();
  }

  // A POSITION-ONLY CHANGE to commander, from a later date: the same team,
  // still choosable, opens on the member's current position.
  await page.goto('/ljudi');
  await page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: person.name }) }).click();
  await page.getByLabel(hr.smjene.membership.team, { exact: true }).selectOption({ label: teamName });
  await expect(position.locator('option:checked')).toHaveText(driver);
  await position.selectOption({ label: commander });

  const date = page.getByLabel(hr.smjene.membership.date, { exact: true });
  const minimum = await date.getAttribute('min');
  if (minimum === null) throw new Error('E2E: the team date control has no minimum');
  await date.fill(isoDaysAfter(minimum, 7));

  await page.getByRole('button', { name: fill(hr.smjene.membership.move, { name: person.name }) }).click();
  await expect(
    page.getByText(
      withAnyDate(hr.smjene.membership.positionPromptFuture, {
        name: person.name,
        team: teamName,
        position: commander,
      }),
    ),
  ).toBeVisible();
  await page
    .getByRole('button', { name: fill(hr.smjene.membership.moveConfirm, { name: person.name }) })
    .click();
  await expect(page.getByText(hr.smjene.membership.saved, { exact: true })).toBeVisible();

  // SCHEDULED — worded as a position change in the same team, never as a move
  // onto it — and offered only as a withdrawal.
  const scheduledLine = page.getByText(
    withAnyDate(hr.smjene.membership.scheduledPositionOnly, { team: teamName, position: commander }),
  );
  await expect(scheduledLine).toBeVisible();
  const withdraw = page.getByRole('button', {
    name: fill(hr.smjene.membership.withdraw, { name: person.name }),
  });
  await expect(withdraw).toBeVisible();
  await expect(position).toHaveCount(0);

  // Today is still driver on the roster.
  await page.goto(`/smjene/${teamId}`);
  await expect(page.getByRole('listitem').getByText(onRoster, { exact: true })).toBeVisible();

  // WITHDRAW it, exactly like a move: the line goes and the offer returns.
  await page.goto('/ljudi');
  await page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: person.name }) }).click();
  await withdraw.click();
  await page
    .getByRole('button', { name: fill(hr.smjene.membership.withdrawConfirm, { name: person.name }) })
    .click();
  await expect(page.getByText(hr.smjene.membership.saved, { exact: true })).toBeVisible();
  await expect(scheduledLine).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: fill(hr.smjene.membership.move, { name: person.name }) }),
  ).toBeVisible();
  await page.getByLabel(hr.smjene.membership.team, { exact: true }).selectOption({ label: teamName });
  await expect(position.locator('option:checked')).toHaveText(driver);
});
