import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';

import {
  API_URL,
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedTeamRotation,
  swapRequestsOfInSql,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, fullDate, weekdayOf } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { offlineWriteNoteIn } from '../../utils/offline.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 12.2: a member proposes a swap from the day detail.
 *
 * Two teams of the test's own get the seeded rotation (`[Dan, Noć, Slobodno,
 * Slobodno]`) under the run's rotation hold: the PROPOSER's from today, so it
 * works Dan on today + 4, and the COLLEAGUE's from two days before today, so
 * it works Dan on today + 6 and is off on today + 4. A fresh member on each,
 * signed in to a context of its own.
 *
 * Covered: the day detail offers *Predloži zamjenu* on the proposer's own
 * working shift and not on the colleague's; the form previews a one-way cover
 * and sends it, landing on *Kalendar* with the status line, and the database
 * holds it with no return shift; a proposal with a return shift is stored with
 * it; a second open proposal of the same shift is refused (23505), named,
 * and the chosen colleague kept; a shift that is not the viewer's shows the
 * notice and no form; offline *Pošalji* states the connection need and sends
 * nothing; and an admin opening the form is sent to *Kalendar*.
 *
 * RUN IN CI ONLY: it needs 0049 on a fresh stack.
 */

const swap = hr.kalendar.swap;

let hold: RotationHold | null = null;
const seeds: SeededRotation[] = [];
let written: { slug: string; members: string[]; teams: string[] } = { slug: '', members: [], teams: [] };

test.afterEach(async () => {
  try {
    while (seeds.length > 0) {
      const seed = seeds.pop();
      if (seed !== undefined) await removeSeededRotation(seed);
    }
  } finally {
    const own = written;
    written = { slug: '', members: [], teams: [] };
    try {
      for (const id of own.members) await removeLeaveMemberInSql(own.slug, id);
      for (const id of own.teams) await removeTeamInSql(own.slug, id);
    } finally {
      await hold?.release();
      hold = null;
    }
  }
});

/** What a test's swap stands on. */
interface Seeded {
  readonly today: string;
  readonly proposer: SeededLeaveMember;
  readonly colleague: SeededLeaveMember;
  readonly proposerTeam: { readonly id: string; readonly name: string };
  readonly colleagueTeam: { readonly id: string; readonly name: string };
  /** The proposer's Dan, today + 4. */
  readonly given: string;
  /** The colleague's Dan, today + 6. */
  readonly back: string;
}

/** Two teams with the seeded rotation two days apart, and a fresh member on each. */
async function seeded(slug: string): Promise<Seeded> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const proposerTeam = await seedExtraTeam(slug, `Smjena ${suffix} P`);
  const colleagueTeam = await seedExtraTeam(slug, `Smjena ${suffix} K`);
  written = { slug, members: [], teams: [proposerTeam.id, colleagueTeam.id] };
  const own = await seedTeamRotation(slug, proposerTeam.id, `${suffix}p`);
  seeds.push(own);
  seeds.push(await seedTeamRotation(slug, colleagueTeam.id, `${suffix}k`, 2));
  const today = own.today;
  const proposer = await seedLeaveMember(slug, proposerTeam.id, today, 20);
  written.members.push(proposer.id);
  const colleague = await seedLeaveMember(slug, colleagueTeam.id, today, 20);
  written.members.push(colleague.id);

  return { today, proposer, colleague, proposerTeam, colleagueTeam, given: addDays(today, 4), back: addDays(today, 6) };
}

/** `subota 05.10.2026` — a date as the day detail and the swap preview name it. */
function detailDate(date: string): string {
  return `${weekdayOf(date)} ${dayMonth(date)}${date.slice(0, 4)}`;
}

/** A month as a sentence of the preview names it: `u rujnu` and `2026` (UX-DR34). */
function monthIn(date: string): { readonly month: string; readonly year: string } {
  const months: Readonly<Record<string, string>> = hr.filter.monthIn;

  return { month: months[String(Number(date.slice(5, 7)))] ?? '', year: date.slice(0, 4) };
}

/** `−12 h`, `+12 h` or `bez promjene`: a whole-hour delta as the preview signs it. */
function deltaOf(hours: number): string {
  if (hours === 0) return swap.noChange;

  const duration = fill(hr.organization.hourBands.duration.hours, { hours: String(Math.abs(hours)) });

  return fill(hours < 0 ? hr.kalendar.detail.preview.less : hr.kalendar.detail.preview.more, { duration });
}

/** Every insert the page sends to `swap_requests`. */
function spyOnSwapWrites(page: Page): () => readonly string[] {
  const writes: string[] = [];

  page.on('request', (sent) => {
    if (sent.url().startsWith(`${API_URL}/rest/v1/swap_requests`) && sent.method() !== 'GET') {
      writes.push(`${sent.method()} ${sent.url()}`);
    }
  });

  return () => writes;
}

test.describe('a member proposes a swap', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the day detail links their own shift, the preview shows a one-way cover, and Pošalji sends it', async ({
    page,
    loginPage,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { proposer, colleague, proposerTeam, colleagueTeam, given, back } = await seeded(fixture.slug);

    await loginPage.signIn(fixture.slug, proposer.username, proposer.password);

    // NO LINK on a shift that is not theirs.
    await calendarPage.goto(`?mjesec=${back.slice(0, 7)}&dan=${back}&danSmjena=${colleagueTeam.id}`);
    await expect(calendarPage.dialog()).toBeVisible();
    await expect(calendarPage.swapAction).toHaveCount(0);

    // THE LINK on their own working shift.
    await calendarPage.goto(`?mjesec=${given.slice(0, 7)}&dan=${given}&danSmjena=${proposerTeam.id}`);
    await calendarPage.swapAction.click();
    await expect(page).toHaveURL(new RegExp(`/kalendar/zamjena\\?dan=${given}&smjena=${proposerTeam.id}$`));
    await expect(calendarPage.heading(swap.heading)).toBeVisible();
    await expect(calendarPage.text(swap.chooseColleague)).toBeVisible();

    await calendarPage.swapColleague.selectOption(colleague.id);
    await expect(
      calendarPage.text(fill(swap.worksInstead, { day: detailDate(given), team: proposerTeam.name, name: colleague.name })),
    ).toBeVisible();
    await expect(calendarPage.text(new RegExp(`^${swap.hoursYou.split('{')[0] ?? ''}.*: −`))).toBeVisible();

    await calendarPage.swapSendButton.click();
    await expect(page).toHaveURL(new RegExp(`/kalendar\\?mjesec=${given.slice(0, 7)}`));
    await expect(
      calendarPage.statusWith(fill(swap.sent, { date: fullDate(given), team: proposerTeam.name, name: colleague.name })),
    ).toBeVisible();
    expect(await swapRequestsOfInSql(fixture.slug, proposer.id)).toEqual([
      { addresseeId: colleague.id, teamId: proposerTeam.id, date: given, returnTeamId: null, returnDate: null, open: true },
    ]);

    // DUPLICATE (story 12.3): a shift already proposed in an open swap shows a notice naming the
    // colleague, and no form, so no second proposal can be sent (0049's 23505 stays the backstop).
    await calendarPage.gotoSwap(given, proposerTeam.id);
    await expect(calendarPage.text(fill(swap.alreadyProposed, { name: colleague.name }))).toBeVisible();
    await expect(calendarPage.swapColleague).toHaveCount(0);
    await expect(calendarPage.swapSendButton).toHaveCount(0);
    expect(await swapRequestsOfInSql(fixture.slug, proposer.id)).toHaveLength(1);
  });

  test('with a shift in return: both dates in the preview, and both shifts stored', async ({ page, loginPage, calendarPage, fixture }) => {
    test.slow();
    const { proposer, colleague, proposerTeam, colleagueTeam, given, back } = await seeded(fixture.slug);

    await loginPage.signIn(fixture.slug, proposer.username, proposer.password);
    await calendarPage.gotoSwap(given, proposerTeam.id);
    await calendarPage.swapColleague.selectOption(colleague.id);
    await calendarPage.swapReturn.selectOption(`${back}/${colleagueTeam.id}`);
    await expect(
      calendarPage.text(fill(swap.youWorkInstead, { day: detailDate(back), team: colleagueTeam.name, name: colleague.name })),
    ).toBeVisible();
    // THE HOURS, per month: each gives a Dan (12 h) and takes one, so within one month both net to no change.
    const sameMonth = given.slice(0, 7) === back.slice(0, 7);
    const yours = sameMonth
      ? [[given, 0]]
      : [
          [given, -12],
          [back, 12],
        ];
    for (const [date, hours] of yours as [string, number][]) {
      await expect(calendarPage.text(fill(swap.hoursYou, { ...monthIn(date), delta: deltaOf(hours) }))).toBeVisible();
      await expect(
        calendarPage.text(fill(swap.hoursOf, { name: colleague.name, ...monthIn(date), delta: deltaOf(-hours) })),
      ).toBeVisible();
    }

    await calendarPage.swapSendButton.click();
    await expect(page).toHaveURL(/\/kalendar\?mjesec=/);
    await expect(
      calendarPage.statusWith(
        fill(swap.sentWithReturn, {
          date: fullDate(given),
          team: proposerTeam.name,
          name: colleague.name,
          returnDate: fullDate(back),
          returnTeam: colleagueTeam.name,
        }),
      ),
    ).toBeVisible();
    expect(await swapRequestsOfInSql(fixture.slug, proposer.id)).toEqual([
      {
        addresseeId: colleague.id,
        teamId: proposerTeam.id,
        date: given,
        returnTeamId: colleagueTeam.id,
        returnDate: back,
        open: true,
      },
    ]);
  });

  test('a shift that is not theirs shows the notice and no form', async ({ loginPage, calendarPage, fixture }) => {
    test.slow();
    const { proposer, colleagueTeam, back } = await seeded(fixture.slug);

    await loginPage.signIn(fixture.slug, proposer.username, proposer.password);
    await calendarPage.gotoSwap(back, colleagueTeam.id);
    await expect(calendarPage.text(swap.notOwn)).toBeVisible();
    await expect(calendarPage.swapColleague).toHaveCount(0);
    await expect(calendarPage.swapSendButton).toHaveCount(0);
  });

  test('offline, Pošalji states the connection need and sends nothing', async ({ page, loginPage, calendarPage, fixture }) => {
    test.slow();
    const { proposer, colleague, proposerTeam, given } = await seeded(fixture.slug);

    await loginPage.signIn(fixture.slug, proposer.username, proposer.password);
    // The form read online once, so its snapshot is on the device.
    await calendarPage.gotoSwap(given, proposerTeam.id);
    await expect(calendarPage.swapColleague).toBeVisible();

    const writes = spyOnSwapWrites(page);
    await page.context().setOffline(true);
    try {
      await calendarPage.swapColleague.selectOption(colleague.id);
      await expect(offlineWriteNoteIn(page)).toBeVisible();
      const send = calendarPage.swapSendButton;
      await expect(send).toHaveAttribute('aria-disabled', 'true');
      await send.click({ force: true });
      await expect(page).toHaveURL(/\/kalendar\/zamjena\?/);
      await expect(calendarPage.swapColleague).toHaveValue(colleague.id);
      expect(writes(), 'a write left the page offline').toEqual([]);
    } finally {
      await page.context().setOffline(false);
    }
    expect(writes(), 'the reconnect sent a write').toEqual([]);
    expect(await swapRequestsOfInSql(fixture.slug, proposer.id)).toEqual([]);
  });
});

test.describe("an admin's swap form", () => {
  test.use({ storageState: ADMIN_STATE });

  test('is not theirs: opening it lands on Kalendar', async ({ page, calendarPage }) => {
    await calendarPage.gotoSwap('2026-01-01', 'x');
    await expect(page).toHaveURL(/\/kalendar$/);
  });
});
