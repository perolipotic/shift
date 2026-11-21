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
import { CalendarPage } from '../../pages/calendar.page.ts';
import { HistoryPage } from '../../pages/history.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { PeoplePage } from '../../pages/people.page.ts';
import { TodayPage } from '../../pages/today.page.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Stories 18.3, 18.4 and 18.5: the member page's loan dialog, driven end to
 * end, and the marks a loan draws (epic 18 retro A5).
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and a fresh member
 * on it from today. The member is lent to the fixture's team (which has no
 * rotation), the loan is ended early (*Završi danas*), then removed; a refusal is
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

test('a loan is drawn where rosters are read: day detail, Osoba picker, Ljudi, history, and the member’s Danas and Moj raspored', async ({
  browser,
  fixture,
  page,
  peoplePage,
  calendarPage,
}) => {
  test.slow();
  // Story 18.5's marks (epic 18 retro A5). Under the run's rotation hold, a
  // team of the test's own (`lentTo`) gets the seeded rotation from today, so
  // today is its Dan; a second team (`home`) has none. A fresh member on
  // `home` from today is lent to `lentTo` from today to today + 3 through the
  // dialog, so the history holds the admin's own *Posudba*.
  hold = holdRotation(fixture.slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug: fixture.slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const lentTo = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
  own.teams.push(lentTo.id);
  const home = await seedExtraTeam(fixture.slug, `Matična ${suffix}`);
  own.teams.push(home.id);
  seed = await seedTeamRotation(fixture.slug, lentTo.id, suffix);
  const today = seed.today;
  const person = await seedLeaveMember(fixture.slug, home.id, today, 40);
  own.members.push(person.id);
  const to = addDays(today, 3);
  const lentFrom = fill(loans.mark.lentFrom, { team: home.name });
  const withTeam = fill(loans.mark.now, { team: lentTo.name });
  const notice = fill(loans.mark.with, { team: lentTo.name, to: fullDate(to) });

  await peoplePage.gotoMember(person.id);
  await peoplePage.lendButton(person.name).click();
  const lend = peoplePage.lendDialog;
  await expect(lend).toBeVisible();
  await lend.getByLabel(loans.team).selectOption({ label: lentTo.name });
  await lend.getByLabel(loans.from).fill(today);
  await lend.getByLabel(loans.to).fill(to);
  await lend.getByLabel(loans.reason).fill('Pojačanje');
  await lend.getByRole('button', { name: loans.save, exact: true }).click();
  await expect(lend).toHaveCount(0);
  await expect(peoplePage.statusWith(loans.saved)).toBeVisible();
  await expect.poll(() => teamLoansOfInSql(fixture.slug, person.id)).toEqual([
    { teamId: lentTo.id, from: today, to, live: true },
  ]);

  // THE DAY DETAIL: today's Dan of the loan team lists them, marked with the team they come from.
  await calendarPage.goto(`?prikaz=sve&mjesec=${today.slice(0, 7)}`);
  await (await calendarPage.cellOf(lentTo.name, today)).click();
  const detail = calendarPage.detailOf(lentTo.name, today);
  await expect(detail).toBeVisible();
  const line = calendarPage.rosterLinesIn(detail).filter({ hasText: person.name });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(lentFrom);
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  // THE OSOBA PICKER: placed under the loan team, not their own, with the same mark.
  const filters = calendarPage.filters;
  await filters.openSheet();
  await filters.personField.click();
  await expect(filters.personPicker).toBeVisible();
  await filters.personSearch.fill(person.name);
  // The option's name is the person's, then a hidden separator and the mark.
  const option = filters.personPicker.getByRole('button', { name: new RegExp(`^${escapeRegExp(person.name)}(?=,|\\s|$)`) });
  await expect(option).toHaveCount(1);
  await expect(option).toContainText(lentFrom);
  await expect(filters.personGroup(lentTo.name)).toBeVisible();
  await expect(filters.personGroup(home.name)).toHaveCount(0);

  // LJUDI, the admin's list: the row keeps their own team, then `trenutno u timu …`.
  await peoplePage.goto();
  await peoplePage.searchInput.fill(person.name);
  const row = peoplePage.memberRow(person.name);
  await expect(row).toContainText(home.name);
  await expect(row).toContainText(withTeam);

  // POVIJEST PROMJENA: one *Posudba · dodano* under the person.
  const historyPage = new HistoryPage(page);
  await historyPage.goto(`?osoba=${person.id}`);
  const added = historyPage.kindText(hr.history.record.loan, hr.history.action.added);
  await expect(historyPage.table.getByRole('row').filter({ hasText: added })).toHaveCount(1);

  // AS THE MEMBER, in a fresh context of their own (never a stored state; `today.spec.ts`'s `signedInAs`).
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1280, height: 900 },
  });
  try {
    const memberPage = await context.newPage();
    await new LoginPage(memberPage).signIn(fixture.slug, person.username, person.password);
    // DANAS: `U timu {tim} do {do}.`
    await expect(new TodayPage(memberPage).text(notice)).toBeVisible();
    // MOJ RASPORED: the same notice.
    const kalendar = new CalendarPage(memberPage);
    await kalendar.goto('?prikaz=moj');
    await expect(kalendar.text(notice)).toBeVisible();
    // The members' directory: under their own team, `trenutno u timu …`.
    const ljudi = new PeoplePage(memberPage);
    await ljudi.goto();
    const group = ljudi.directoryGroup(home.name);
    await expect(group).toContainText(person.name);
    await expect(group).toContainText(withTeam);
  } finally {
    await context.close();
  }
});
