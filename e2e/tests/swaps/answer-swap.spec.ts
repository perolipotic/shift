import { randomBytes } from 'node:crypto';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { CalendarPage } from '../../pages/calendar.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { TodayPage } from '../../pages/today.page.ts';
import {
  API_URL,
  holdRotation,
  promoteToAdminInSql,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedSwapRequestInSql,
  seedTeamRotation,
  swapRequestStateInSql,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, weekdayOf } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { offlineWriteNoteIn } from '../../utils/offline.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 12.3: the colleague accepts or declines, and either member withdraws.
 *
 * Two teams of the test's own get the seeded rotation (`[Dan, Noć, Slobodno,
 * Slobodno]`) under the run's rotation hold, as in `propose-swap.spec.ts`:
 * the PROPOSER's from today, so it works Dan on today + 4, and the
 * COLLEAGUE's from two days before today, so it works Dan on today + 6 and is
 * off on today + 4. A fresh member on each, each signed in to a context of
 * its own. The proposal is seeded in SQL as the proposer would have sent it
 * (12.2's form is `propose-swap.spec.ts`'s to prove).
 *
 * Covered: the addressee sees *Zamjene* on *Danas* with their consequence and
 * accepts (*Čeka odluku*, stored accepted and open); the addressee declines
 * and the proposer sees *Odbijena*; the proposer withdraws (*Povučena*), and
 * the addressee's answer after it is refused as no longer open and the list
 * re-reads; the day detail marks the proposed shift instead of offering the
 * link, and the proposal surface shows a notice; offline every button states
 * the connection need and sends nothing.
 *
 * RUN IN CI ONLY: it needs 0049 on a fresh stack.
 */

const swaps = hr.danas.swaps;
const swap = hr.kalendar.swap;

let hold: RotationHold | null = null;
const seeds: SeededRotation[] = [];
const contexts: BrowserContext[] = [];
let written: { slug: string; members: string[]; teams: string[] } = { slug: '', members: [], teams: [] };

test.afterEach(async () => {
  try {
    while (contexts.length > 0) await contexts.pop()?.close();
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
  readonly proposer: SeededLeaveMember;
  readonly colleague: SeededLeaveMember;
  readonly proposerTeam: { readonly id: string; readonly name: string };
  readonly colleagueTeam: { readonly id: string; readonly name: string };
  /** The proposer's Dan, today + 4. */
  readonly given: string;
  /** The colleague's Dan, today + 6. */
  readonly back: string;
  /** The open swap: the proposer's Dan to the colleague, with the colleague's Dan in return. */
  readonly swapId: string;
}

/** Two teams with the seeded rotation two days apart, a fresh member on each, and one open proposal between them. */
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
  const given = addDays(today, 4);
  const back = addDays(today, 6);
  const swapId = await seedSwapRequestInSql(slug, {
    proposerId: proposer.id,
    addresseeId: colleague.id,
    teamId: proposerTeam.id,
    date: given,
    returnTeamId: colleagueTeam.id,
    returnDate: back,
  });

  return { proposer, colleague, proposerTeam, colleagueTeam, given, back, swapId };
}

/** One member signed in to a fresh context of its own. */
interface SignedIn {
  readonly page: Page;
  readonly today: TodayPage;
  readonly calendar: CalendarPage;
}

async function signedIn(browser: Browser, slug: string, member: SeededLeaveMember): Promise<SignedIn> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  contexts.push(context);
  const page = await context.newPage();
  await new LoginPage(page).signIn(slug, member.username, member.password);

  return { page, today: new TodayPage(page), calendar: new CalendarPage(page) };
}

/** `subota 05.10.2026` — a date as the day detail and the card name it. */
function detailDate(date: string): string {
  return `${weekdayOf(date)} ${dayMonth(date)}${date.slice(0, 4)}`;
}

/** The card's button `message` (`Prihvati zamjenu {day} · {team}`) for the given shift. */
function button(signed: SignedIn, message: string, date: string, team: string) {
  return signed.today.swapButton(message, detailDate(date), team);
}

/** Every call the page sends to a swap definer. */
function spyOnSwapCalls(page: Page): () => readonly string[] {
  const calls: string[] = [];

  page.on('request', (sent) => {
    if (/\/rest\/v1\/rpc\/(answer|withdraw)_swap_request/.test(sent.url()) && sent.url().startsWith(API_URL)) {
      calls.push(`${sent.method()} ${sent.url()}`);
    }
  });

  return () => calls;
}

test.describe('the colleague answers a swap', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the addressee sees it on Danas with their consequence, and Prihvati leaves it waiting for a decision', async ({
    browser,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { proposer, colleague, proposerTeam, colleagueTeam, given, back, swapId } = await seeded(fixture.slug);
    const addressee = await signedIn(browser, fixture.slug, colleague);

    await addressee.today.goto();
    const zamjene = addressee.today.swapsCard;

    await expect(zamjene).toBeVisible();
    await expect(addressee.today.swapsText(fill(swaps.fromColleague, { name: proposer.name }))).toBeVisible();
    await expect(addressee.today.swapsText(swaps.status.waitingYou)).toBeVisible();
    // THE CONSEQUENCE, the addressee's own: they work the given date, the proposer their return shift.
    await expect(addressee.today.swapsText(fill(swap.youWorkInstead, { day: detailDate(given), team: proposerTeam.name, name: proposer.name }))).toBeVisible();
    await expect(addressee.today.swapsText(fill(swap.worksInstead, { day: detailDate(back), team: colleagueTeam.name, name: proposer.name }))).toBeVisible();
    // No Povuci before accepting: before that, the addressee declines.
    await expect(button(addressee, swaps.withdrawName, given, proposerTeam.name)).toHaveCount(0);

    await button(addressee, swaps.acceptName, given, proposerTeam.name).click();
    await expect(addressee.today.swapsStatusWith(fill(swaps.accepted, { day: detailDate(given), team: proposerTeam.name }))).toBeVisible();
    await expect(addressee.today.swapsText(swaps.status.waitingDecision)).toBeVisible();
    await expect(button(addressee, swaps.acceptName, given, proposerTeam.name)).toHaveCount(0);
    await expect(button(addressee, swaps.withdrawName, given, proposerTeam.name)).toBeVisible();
    expect(await swapRequestStateInSql(fixture.slug, swapId)).toEqual({ answer: 'accepted', open: true, decided: false });

    // The proposer reads it as waiting for a decision too.
    const sender = await signedIn(browser, fixture.slug, proposer);

    await sender.today.goto();
    await expect(sender.today.swapsText(swaps.status.waitingDecision)).toBeVisible();
  });

  test('an admin asked to take a shift sees Zamjene on their own Danas, with Prihvati', async ({ browser, fixture }) => {
    test.slow();
    const { colleague, proposerTeam, given } = await seeded(fixture.slug);

    // The colleague is an admin: 12.2's colleague list includes members with the admin role.
    await promoteToAdminInSql(fixture.slug, colleague.id);
    const addressee = await signedIn(browser, fixture.slug, colleague);

    await addressee.today.goto();
    await expect(addressee.today.swapsCard).toBeVisible();
    await expect(addressee.today.swapsText(swaps.status.waitingYou)).toBeVisible();
    await expect(button(addressee, swaps.acceptName, given, proposerTeam.name)).toBeVisible();
  });

  test('Odbij declines it, and the proposer sees it declined', async ({ browser, fixture }) => {
    test.slow();
    const { proposer, colleague, proposerTeam, given, swapId } = await seeded(fixture.slug);
    const addressee = await signedIn(browser, fixture.slug, colleague);

    await addressee.today.goto();
    await button(addressee, swaps.declineName, given, proposerTeam.name).click();
    await expect(addressee.today.swapsStatusWith(fill(swaps.declined, { day: detailDate(given), team: proposerTeam.name }))).toBeVisible();
    await expect(addressee.today.swapsText(swaps.status.declined)).toBeVisible();
    expect(await swapRequestStateInSql(fixture.slug, swapId)).toEqual({ answer: 'declined', open: false, decided: false });

    const sender = await signedIn(browser, fixture.slug, proposer);

    await sender.today.goto();
    await expect(sender.today.swapsText(swaps.status.declined)).toBeVisible();
    await expect(button(sender, swaps.withdrawName, given, proposerTeam.name)).toHaveCount(0);
  });

  test('the proposer withdraws it, and an answer after that is refused as no longer open', async ({ browser, fixture }) => {
    test.slow();
    const { proposer, colleague, proposerTeam, given, swapId } = await seeded(fixture.slug);
    // The addressee's page is read first, so it still offers Prihvati after the withdrawal.
    const addressee = await signedIn(browser, fixture.slug, colleague);

    await addressee.today.goto();
    await expect(button(addressee, swaps.acceptName, given, proposerTeam.name)).toBeVisible();

    const sender = await signedIn(browser, fixture.slug, proposer);

    await sender.today.goto();
    await expect(sender.today.swapsText(fill(swaps.toColleague, { name: colleague.name }))).toBeVisible();
    await expect(sender.today.swapsText(swaps.status.waitingColleague)).toBeVisible();
    await button(sender, swaps.withdrawName, given, proposerTeam.name).click();
    await expect(sender.today.swapsStatusWith(fill(swaps.withdrawn, { day: detailDate(given), team: proposerTeam.name }))).toBeVisible();
    await expect(sender.today.swapsText(swaps.status.withdrawn)).toBeVisible();
    expect(await swapRequestStateInSql(fixture.slug, swapId)).toEqual({ answer: null, open: false, decided: false });

    // RACE: the addressee's stale page answers, P0002 says so, and the list re-reads.
    await button(addressee, swaps.acceptName, given, proposerTeam.name).click();
    await expect(addressee.today.swapsAlertWith(fill(swaps.notOpen, { day: detailDate(given), team: proposerTeam.name }))).toBeVisible();
    await expect(addressee.today.swapsText(swaps.status.withdrawn)).toBeVisible();
    await expect(button(addressee, swaps.acceptName, given, proposerTeam.name)).toHaveCount(0);
    expect(await swapRequestStateInSql(fixture.slug, swapId)).toEqual({ answer: null, open: false, decided: false });
  });

  test('the day detail marks the proposed shift instead of offering it again, and the form shows a notice', async ({
    browser,
    fixture,
  }) => {
    test.slow();
    const { proposer, colleague, proposerTeam, given } = await seeded(fixture.slug);
    const sender = await signedIn(browser, fixture.slug, proposer);

    await sender.calendar.goto(`?mjesec=${given.slice(0, 7)}&dan=${given}&danSmjena=${proposerTeam.id}`);
    await expect(sender.calendar.dialog()).toBeVisible();
    await expect(sender.calendar.text(fill(swap.proposedMark, { name: colleague.name }))).toBeVisible();
    await expect(sender.calendar.swapAction).toHaveCount(0);

    await sender.calendar.gotoSwap(given, proposerTeam.id);
    await expect(sender.calendar.text(fill(swap.alreadyProposed, { name: colleague.name }))).toBeVisible();
    await expect(sender.calendar.swapColleague).toHaveCount(0);
    await expect(sender.calendar.swapSendButton).toHaveCount(0);
  });

  test('offline, every button states the connection need and sends nothing', async ({ browser, fixture }) => {
    test.slow();
    const { colleague, proposerTeam, given, swapId } = await seeded(fixture.slug);
    const addressee = await signedIn(browser, fixture.slug, colleague);

    // Read online once, so the snapshot is on the device.
    await addressee.today.goto();
    const accept = button(addressee, swaps.acceptName, given, proposerTeam.name);
    const decline = button(addressee, swaps.declineName, given, proposerTeam.name);

    await expect(accept).toBeVisible();

    const calls = spyOnSwapCalls(addressee.page);
    await addressee.page.context().setOffline(true);
    try {
      await expect(offlineWriteNoteIn(addressee.page)).toBeVisible();
      for (const control of [accept, decline]) {
        await expect(control).toHaveAttribute('aria-disabled', 'true');
        await control.click({ force: true });
      }
      expect(calls(), 'a call left the page offline').toEqual([]);
    } finally {
      await addressee.page.context().setOffline(false);
    }
    expect(calls(), 'the reconnect sent a call').toEqual([]);
    expect(await swapRequestStateInSql(fixture.slug, swapId)).toEqual({ answer: null, open: true, decided: false });
  });
});
