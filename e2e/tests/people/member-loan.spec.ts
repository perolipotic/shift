import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  teamLoansOfInSql,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Stories 18.3 and 18.4: the member page's loan dialog, driven end to end.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
 * on it from today. The member is lent to the fixture's team (which has no
 * rotation), the loan is amended (ended later), then removed; a refusal is
 * kept in the dialog; and a loan that would erase a conflict waits for the
 * erasure dialog. Everything written — the seed, the member with their loans
 * and leave, and the team — is removed in the `afterEach` whatever happens.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });

const loans = hr.loans;
const erasures = hr.ljudi.erasures;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; members: string[]; teams: string[] } | null = null;

test.afterEach(async () => {
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
  const own = written;

  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  // The member, with their loans, leave and resolutions, and only then the team their versions name.
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  seed = null;
  written = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

interface Setup {
  readonly rotation: SeededRotation;
  readonly person: SeededLeaveMember;
}

async function setUp(slug: string, leave: readonly [number, number] | null): Promise<Setup> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(slug, team.id, rotation.today, 40);
  own.members.push(person.id);
  if (leave !== null) {
    await seedLeaveRecord(slug, person.id, addDays(rotation.today, leave[0]), addDays(rotation.today, leave[1]));
  }

  return { rotation, person };
}

test('lends a member, keeps a refusal in the dialog, amends the loan and removes it', async ({ fixture, peoplePage }) => {
  test.slow();
  const { rotation, person } = await setUp(fixture.slug, null);
  // From today, so the amend offers *Završi danas*.
  const from = rotation.today;
  const to = addDays(rotation.today, 3);

  await peoplePage.gotoMember(person.id);

  // LEND (18.3).
  await peoplePage.lendButton(person.name).click();
  const lend = peoplePage.lendDialog;
  await expect(lend).toBeVisible();
  await lend.getByLabel(loans.team).selectOption({ label: fixture.team.name });
  await lend.getByLabel(loans.from).fill(from);
  await lend.getByLabel(loans.to).fill(to);
  await lend.getByLabel(loans.reason).fill('Pojačanje');
  await expect(lend.getByText(loans.changes, { exact: true })).toBeVisible();
  await lend.getByRole('button', { name: loans.save, exact: true }).click();
  await expect(lend).toHaveCount(0);
  await expect(peoplePage.statusWith(loans.saved)).toBeVisible();
  await expect.poll(() => teamLoansOfInSql(fixture.slug, person.id)).toEqual([
    { teamId: fixture.team.id, from, to, live: true },
  ]);

  // A REFUSAL KEPT IN THE DIALOG: a second loan sharing a date.
  await peoplePage.lendButton(person.name).click();
  await expect(lend).toBeVisible();
  await lend.getByLabel(loans.team).selectOption({ label: fixture.team.name });
  await lend.getByLabel(loans.from).fill(to);
  await lend.getByLabel(loans.to).fill(to);
  await lend.getByLabel(loans.reason).fill('Opet');
  await lend.getByRole('button', { name: loans.save, exact: true }).click();
  await expect(lend.getByRole('alert')).toContainText(loans.error.overlap);
  await expect(lend).toBeVisible();
  await lend.getByRole('button', { name: loans.cancel, exact: true }).click();
  await expect(lend).toHaveCount(0);

  // AMEND (18.4): ended early with *Završi danas*, the reason left empty (kept).
  const later = rotation.today;
  const amendButton = peoplePage.amendLoanButton(person.name, fixture.team.name);
  await amendButton.click();
  const amend = peoplePage.amendLoanDialog;
  await expect(amend).toBeVisible();
  await expect(amend.getByLabel(loans.from)).toHaveValue(from);
  await expect(amend.getByLabel(loans.to)).toHaveValue(to);
  await amend.getByRole('button', { name: loans.endToday, exact: true }).click();
  await expect(amend.getByLabel(loans.to)).toHaveValue(later);
  await amend.getByRole('button', { name: loans.save, exact: true }).click();
  await expect(amend).toHaveCount(0);
  await expect(peoplePage.statusWith(loans.amended)).toBeVisible();
  await expect.poll(() => teamLoansOfInSql(fixture.slug, person.id)).toEqual([
    { teamId: fixture.team.id, from, to, live: false },
    { teamId: fixture.team.id, from, to: later, live: true },
  ]);

  // REMOVE (18.4): the same dialog, *Ukloni posudbu*.
  await amendButton.click();
  await expect(amend).toBeVisible();
  await amend.getByRole('switch', { name: loans.remove }).click();
  await expect(amend.getByRole('switch', { name: loans.remove })).toHaveAttribute('aria-checked', 'true');
  await amend.getByRole('button', { name: loans.save, exact: true }).click();
  await expect(amend).toHaveCount(0);
  await expect(peoplePage.statusWith(loans.removed)).toBeVisible();
  await expect.poll(async () => (await teamLoansOfInSql(fixture.slug, person.id)).filter((loan) => loan.live)).toEqual([]);
  await expect(amendButton).toHaveCount(0);
});

test('a loan that would erase a conflict waits for the erasure dialog, and writes once it is confirmed', async ({
  fixture,
  peoplePage,
}) => {
  test.slow();
  // Leave on today + 4, a Dan of the member's own team: one conflict, which
  // a loan to the fixture's team (no rotation) over that date erases.
  const { rotation, person } = await setUp(fixture.slug, [4, 4]);
  const date = addDays(rotation.today, 4);

  await peoplePage.gotoMember(person.id);
  await peoplePage.lendButton(person.name).click();
  const lend = peoplePage.lendDialog;
  await lend.getByLabel(loans.team).selectOption({ label: fixture.team.name });
  await lend.getByLabel(loans.from).fill(date);
  await lend.getByLabel(loans.to).fill(date);
  await lend.getByLabel(loans.reason).fill('Pojačanje');
  await lend.getByRole('button', { name: loans.save, exact: true }).click();

  const parts = peoplePage.memberErasures(fill(loans.confirm, { name: person.name }));
  const dialog = parts.dialog(1);
  await expect(dialog).toBeVisible();
  const rows = parts.rowsIn(dialog);
  await expect(rows).toHaveCount(1);
  // Nothing is written before the confirmation.
  expect(await teamLoansOfInSql(fixture.slug, person.id)).toEqual([]);
  await parts.confirmIn(rows.nth(0)).click();
  await parts.saveIn(dialog).click();

  await expect(dialog).toHaveCount(0);
  await expect(lend).toHaveCount(0);
  const saved = peoplePage.statusWith(loans.saved);
  await expect(saved).toBeVisible();
  await expect(saved).toContainText(plural(erasures.removed, 1));
  await expect.poll(() => teamLoansOfInSql(fixture.slug, person.id)).toEqual([
    { teamId: fixture.team.id, from: date, to: date, live: true },
  ]);
});
