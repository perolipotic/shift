import { randomBytes } from 'node:crypto';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { SwapDecisionPage } from '../../pages/conflicts.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import { TodayPage } from '../../pages/today.page.ts';
import {
  API_URL,
  holdRotation,
  removeLeaveMemberInSql,
  seedLeaveRecord,
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
import { addDays, dayMonth, fullDate, weekdayOf } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { offlineWriteNoteIn } from '../../utils/offline.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 12.4: an admin decides a swap on its own screen,
 * `/za-odluku/zamjena/$requestId`, reached from *Za odluku*'s row.
 *
 * As in `answer-swap.spec.ts`: two teams of the test's own get the seeded
 * rotation (`[Dan, Noć, Slobodno, Slobodno]`) under the run's rotation hold —
 * the PROPOSER's from today, so it works Dan on today + 4, and the
 * COLLEAGUE's from two days before today, so it works Dan on today + 6 — and
 * a fresh member on each. The proposal is seeded in SQL as the proposer
 * would have sent it, and the colleague ACCEPTS it through *Danas*, as 12.3
 * proves; the admin is the run's own.
 *
 * Covered: the accepted swap is a *Zamjena smjene* row in *Za odluku* and on
 * admin *Danas* that opens its screen, with what it does; *Odobri* writes the
 * decision (the status line, the row gone, the colleague in for the proposer
 * in the calendar's day detail, *Odlučeno* listing it *Odobrena*); with the
 * proposer on leave that day, *Odobri* opens the erasure confirmation first
 * and sends nothing until it is saved; *Odbij*
 * records the decision alone (*Nije odobrena*); a swap withdrawn meanwhile is
 * refused as no longer waiting; offline both decisions are gated and nothing
 * is sent.
 *
 * RUN IN CI ONLY: it needs 0049 on a fresh stack.
 */

test.describe.configure({ timeout: 120_000 });

const zaOdluku = hr.zaOdluku;
const swapWords = zaOdluku.swap;
const swaps = hr.danas.swaps;

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
  /** The proposer's Dan: today + 4, or today. */
  readonly given: string;
  readonly swapId: string;
}

/**
 * Two teams with the seeded rotation two days apart, a fresh member on each,
 * and one open proposal between them: the proposer's Dan `givenOffset` days
 * from today (4, or 0 — today is a Dan too), the colleague off that day.
 */
async function seeded(slug: string, givenOffset: 0 | 4 = 4): Promise<Seeded> {
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
  const given = addDays(today, givenOffset);
  const swapId = await seedSwapRequestInSql(slug, {
    proposerId: proposer.id,
    addresseeId: colleague.id,
    teamId: proposerTeam.id,
    date: given,
  });

  return { proposer, colleague, proposerTeam, given, swapId };
}

/** `subota 05.10.2026` — a date as the day detail and the card name it. */
function detailDate(date: string): string {
  return `${weekdayOf(date)} ${dayMonth(date)}${date.slice(0, 4)}`;
}

/** A member signed in to a fresh context of its own, on *Danas*. */
async function danasOf(browser: Browser, slug: string, member: SeededLeaveMember): Promise<TodayPage> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  contexts.push(context);
  const page = await context.newPage();
  await new LoginPage(page).signIn(slug, member.username, member.password);
  const today = new TodayPage(page);

  await today.goto();

  return today;
}

/** The colleague accepts the swap on their *Danas* (12.3): it then waits for an admin. */
async function accepted(browser: Browser, slug: string, swap: Seeded): Promise<void> {
  const today = await danasOf(browser, slug, swap.colleague);

  await today.swapButton(swaps.acceptName, detailDate(swap.given), swap.proposerTeam.name).click();
  await expect(today.swapsText(swaps.status.waitingDecision)).toBeVisible();
  expect(await swapRequestStateInSql(slug, swap.swapId)).toEqual({ answer: 'accepted', open: true, decided: false });
}

/** Every decision the page sends: 0049's definer. */
function spyOnDecisions(page: Page): () => readonly string[] {
  const sent: string[] = [];

  page.on('request', (outgoing) => {
    if (outgoing.url().startsWith(`${API_URL}/rest/v1/rpc/decide_swap_request`)) sent.push(outgoing.url());
  });

  return () => sent;
}

/** `Ivo → Karlo`: how every swap row and screen names its two members. */
function partiesOf(swap: Seeded): string {
  return fill(swapWords.parties, { proposer: swap.proposer.name, addressee: swap.colleague.name });
}

test.describe("an admin's swap decision screen", () => {
  test.use({ storageState: ADMIN_STATE });

  test('Waits: an accepted swap is a row in Za odluku and on Danas; Odobri writes the decision, and Odlučeno lists it', async ({
    page,
    browser,
    conflictsPage,
    calendarPage,
    fixture,
  }) => {
    // TODAY'S Dan, so the row is among *Treba tebe*'s earliest on admin Danas.
    const swap = await seeded(fixture.slug, 0);
    const screen = new SwapDecisionPage(page);
    // A PROPOSED swap waits for its colleague, never for an admin.
    await conflictsPage.goto();
    await expect(conflictsPage.unresolvedTab).toBeVisible();
    await expect(conflictsPage.anyCountHeading).toBeVisible();
    await expect(screen.queueRows(partiesOf(swap))).toHaveCount(0);

    await accepted(browser, fixture.slug, swap);

    // Admin Danas: *Treba tebe* lists it, as a row of its own kind.
    const danas = new TodayPage(page);

    await danas.goto();
    await expect(danas.needsYouCard).toBeVisible();
    const danasRow = danas.needsYouRowLinksWith(partiesOf(swap));

    await expect(danasRow).toHaveCount(1);
    await expect(danasRow).toContainText(zaOdluku.kind.swap);
    await expect(danasRow).toHaveAttribute('href', new RegExp(`/za-odluku/zamjena/${swap.swapId}$`));

    // Za odluku: one row of its kind, naming both members and the given shift.
    await conflictsPage.goto();
    const row = screen.queueRows(partiesOf(swap));

    await expect(row).toHaveCount(1);
    await expect(row).toContainText(zaOdluku.kind.swap);
    await expect(row).toContainText(fill(swapWords.shift, { date: fullDate(swap.given), team: swap.proposerTeam.name }));

    // The row opens its own screen: what the swap does, and both decisions.
    await row.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/za-odluku/zamjena/${swap.swapId}$`));
    await expect(screen.swapHeading).toBeVisible();
    await expect(screen.line(partiesOf(swap))).toBeVisible();
    await expect(screen.line(swapWords.previewHeading)).toBeVisible();
    await expect(
      screen.line(
        fill(swapWords.worksInstead, {
          day: detailDate(swap.given),
          team: swap.proposerTeam.name,
          in: swap.colleague.name,
          out: swap.proposer.name,
        }),
      ),
    ).toBeVisible();
    await expect(screen.rejectButton).toBeVisible();

    // Odobri: no erasure here, so the decision is written at once, and the queue says so, focused.
    await screen.approveButton.click();
    await expect(page).toHaveURL(/\/za-odluku$/);
    const saved = conflictsPage.savedStatus.filter({
      hasText: fill(zaOdluku.savedSwapApproved, {
        proposer: swap.proposer.name,
        addressee: swap.colleague.name,
        date: fullDate(swap.given),
      }),
    });

    await expect(saved).toBeVisible();
    await expect(saved).toBeFocused();
    await expect(screen.queueRows(partiesOf(swap))).toHaveCount(0);
    expect(await swapRequestStateInSql(fixture.slug, swap.swapId)).toEqual({ answer: 'accepted', open: false, decided: true });

    // THE OVERRIDE IS WRITTEN: the calendar's day detail shows the colleague in for the proposer, as any roster change.
    await calendarPage.goto(`?prikaz=sve&mjesec=${swap.given.slice(0, 7)}`);
    await (await calendarPage.cellOf(swap.proposerTeam.name, swap.given)).click();
    const detail = calendarPage.detailOf(swap.proposerTeam.name, swap.given);

    await expect(calendarPage.rosterChangesIn(detail)).toContainText(
      fill(hr.kalendar.detail.rosterChange.replaced, { out: swap.proposer.name, in: swap.colleague.name }),
    );

    // Odlučeno lists it, Odobrena, by whom and when.
    await conflictsPage.goto();
    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedCount).toBeVisible();
    const entry = conflictsPage.resolvedEntries.filter({ hasText: partiesOf(swap) });

    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(swapWords.status.approved);
    await expect(entry).toContainText(zaOdluku.kind.swap);

    // Opened again by URL, it is read-only.
    await screen.gotoSwap(swap.swapId);
    await expect(screen.line(swapWords.status.approved)).toBeVisible();
    await expect(screen.approveButton).toHaveCount(0);
    await expect(screen.rejectButton).toHaveCount(0);
  });

  test('Approve, erasure: the proposer on leave that day — the confirmation first, and nothing sent until it is saved', async ({
    page,
    browser,
    conflictsPage,
    fixture,
  }) => {
    const swap = await seeded(fixture.slug);
    const screen = new SwapDecisionPage(page);

    // The proposer's leave on the given Dan: an unresolved collision the approval would erase.
    await seedLeaveRecord(fixture.slug, swap.proposer.id, swap.given, swap.given);
    await accepted(browser, fixture.slug, swap);
    await screen.gotoSwap(swap.swapId);

    const sent = spyOnDecisions(page);
    const parts = screen.erasures;

    await screen.approveButton.click();
    const dialog = parts.dialog(1);

    await expect(dialog).toBeVisible();
    const rows = parts.rowsIn(dialog);

    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText(
      fill(hr.kalendar.detail.rosterChange.erasures.rowWithout, { member: swap.proposer.name, team: swap.proposerTeam.name }),
    );
    await expect(parts.saveIn(dialog)).toHaveAttribute('aria-disabled', 'true');
    expect(sent(), 'a decision left before the confirmation').toEqual([]);

    await parts.confirmIn(rows.nth(0)).click();
    await parts.saveIn(dialog).click();
    await expect(page).toHaveURL(/\/za-odluku$/);
    await expect(
      conflictsPage.savedStatus.filter({
        hasText: fill(zaOdluku.savedSwapApproved, {
          proposer: swap.proposer.name,
          addressee: swap.colleague.name,
          date: fullDate(swap.given),
        }),
      }),
    ).toBeVisible();
    expect(sent()).toHaveLength(1);
    expect(await swapRequestStateInSql(fixture.slug, swap.swapId)).toEqual({ answer: 'accepted', open: false, decided: true });
  });

  test('Reject: Odbij records the decision alone', async ({ page, browser, conflictsPage, fixture }) => {
    const swap = await seeded(fixture.slug);
    const screen = new SwapDecisionPage(page);

    await accepted(browser, fixture.slug, swap);
    await screen.gotoSwap(swap.swapId);
    await screen.rejectButton.click();
    await expect(page).toHaveURL(/\/za-odluku$/);
    await expect(
      conflictsPage.savedStatus.filter({
        hasText: fill(zaOdluku.savedSwapRejected, {
          proposer: swap.proposer.name,
          addressee: swap.colleague.name,
          date: fullDate(swap.given),
        }),
      }),
    ).toBeVisible();
    expect(await swapRequestStateInSql(fixture.slug, swap.swapId)).toEqual({ answer: 'accepted', open: false, decided: true });

    await conflictsPage.resolvedTab.click();
    await expect(conflictsPage.resolvedEntries.filter({ hasText: partiesOf(swap) })).toContainText(swapWords.status.rejected);
  });

  test('Race: a swap withdrawn meanwhile is refused as no longer waiting, and read again', async ({ page, browser, fixture }) => {
    const swap = await seeded(fixture.slug);
    const screen = new SwapDecisionPage(page);

    await accepted(browser, fixture.slug, swap);
    await screen.gotoSwap(swap.swapId);
    await expect(screen.rejectButton).toBeVisible();

    // The proposer withdraws it on their own Danas.
    const sender = await danasOf(browser, fixture.slug, swap.proposer);

    await sender.swapButton(swaps.withdrawName, detailDate(swap.given), swap.proposerTeam.name).click();
    await expect(sender.swapsText(swaps.status.withdrawn)).toBeVisible();

    await screen.rejectButton.click();
    await expect(screen.alertWith(swapWords.notWaiting)).toBeVisible();
    await expect(screen.line(swapWords.status.withdrawn)).toBeVisible();
    expect(await swapRequestStateInSql(fixture.slug, swap.swapId)).toEqual({ answer: 'accepted', open: false, decided: false });
  });

  test('Offline: both decisions state the connection need and send nothing', async ({ page, browser, fixture }) => {
    const swap = await seeded(fixture.slug);
    const screen = new SwapDecisionPage(page);

    await accepted(browser, fixture.slug, swap);
    // Read online once, so the snapshot is on the device.
    await screen.gotoSwap(swap.swapId);
    const approve = screen.approveButton;
    const reject = screen.rejectButton;

    await expect(approve).toBeVisible();

    const sent = spyOnDecisions(page);
    await page.context().setOffline(true);
    try {
      await expect(offlineWriteNoteIn(page)).toBeVisible();
      for (const control of [approve, reject]) {
        await expect(control).toHaveAttribute('aria-disabled', 'true');
        await control.click({ force: true });
      }
      expect(sent(), 'a decision left the page offline').toEqual([]);
    } finally {
      await page.context().setOffline(false);
    }
    expect(sent(), 'the reconnect sent a decision').toEqual([]);
    expect(await swapRequestStateInSql(fixture.slug, swap.swapId)).toEqual({ answer: 'accepted', open: true, decided: false });
  });
});
