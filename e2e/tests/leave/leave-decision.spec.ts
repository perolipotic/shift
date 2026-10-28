import { randomBytes, randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { LeaveRequestReviewPage } from '../../pages/conflicts.page.ts';
import { LeavePage } from '../../pages/leave.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
import {
  API_URL,
  closedRequestShownInSql,
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedLeaveRequest,
  seedTeamRotation,
  withdrawLeaveRequestInSql,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { offlineWriteNoteIn } from '../../utils/offline.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 9.4: an admin decides a leave request on its own screen,
 * `/za-odluku/zahtjev/$requestId`. Opened by URL here; since story 9.5 the
 * queue lists the request and its row opens the same screen
 * (`conflicts-queue.spec.ts`).
 *
 * A team of the test's own gets the seeded rotation from today (`[Dan, Noć,
 * Slobodno, Slobodno]`) under the run's rotation hold, and a fresh member on
 * it with 20 days. The request is today + 4 (Dan) to today + 5 (Noć): two
 * working days, and two collisions once approved.
 *
 * Covered: a pending request's preview (cost, collisions) and both buttons;
 * *Odobri* creates the leave — its collisions in the queue, the status line,
 * the request read *Odobren*, the leave card and the member's *Godišnji*
 * showing it; *Odbij* records only the decision; a stale approval (23P01)
 * stays pending and names the overlap; a request closed meanwhile (P0002)
 * says so and reads as it now stands; a closed request read-only; an unknown
 * id; offline, both decisions gated and nothing sent; and a member is turned
 * away by the admin guard.
 */

test.describe.configure({ timeout: 120_000 });

const zaOdluku = hr.zaOdluku;
const request = zaOdluku.request;
const status = hr.godisnji.request.status;
const days = hr.count.days;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { slug: string; members: string[]; teams: string[] } = { slug: '', members: [], teams: [] };

test.afterEach(async () => {
  try {
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
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

interface Scenario {
  readonly member: SeededLeaveMember;
  readonly today: string;
  /** The pattern's step types: `Dan …`, `Noć …`, as the seed names them. */
  readonly steps: SeededRotation['steps'];
  readonly from: string;
  readonly to: string;
}

/** A team with the seeded rotation from today, a fresh member on it, and the request's range (+4 Dan, +5 Noć). */
async function scenarioOf(slug: string): Promise<Scenario> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  written = { slug, members: [], teams: [team.id] };
  seed = await seedTeamRotation(slug, team.id, suffix);
  const member = await seedLeaveMember(slug, team.id, seed.today, 20);
  written.members.push(member.id);

  return { member, today: seed.today, steps: seed.steps, from: addDays(seed.today, 4), to: addDays(seed.today, 5) };
}

/** Every decision the page sends: 0040's `decide_leave_request`. */
function spyOnDecisions(page: Page): () => readonly string[] {
  const sent: string[] = [];

  page.on('request', (outgoing) => {
    if (outgoing.url().startsWith(`${API_URL}/rest/v1/rpc/decide_leave_request`)) sent.push(outgoing.url());
  });

  return () => sent;
}

test.describe("an admin's leave request decision screen", () => {
  test.use({ storageState: ADMIN_STATE });

  test('previews a pending request, approves it, and the leave and its collisions follow', async ({
    page,
    browser,
    conflictsPage,
    peoplePage,
    fixture,
  }) => {
    const { member, steps, from, to } = await scenarioOf(fixture.slug);
    const requestId = await seedLeaveRequest(fixture.slug, member.id, from, to);
    const review = new LeaveRequestReviewPage(page);

    await review.gotoRequest(requestId);
    await expect(review.requestHeading).toBeVisible();
    await expect(review.line(member.name)).toBeVisible();
    await expect(review.line(status.pending)).toBeVisible();
    await expect(review.line(fill(request.range, { from: fullDate(from), to: fullDate(to) }))).toBeVisible();
    await expect(review.figure(hr.godisnji.request.cost)).toHaveText(plural(days, 2));
    // THE DIALOG'S WORDING for what approval creates: its count, and each collision.
    await expect(review.line(plural(hr.ljudi.leaveRecord.conflictsCreated, 2))).toBeVisible();
    await expect(review.line(peoplePage.leaveConflictLine(from, steps[0]))).toBeVisible();
    await expect(review.line(peoplePage.leaveConflictLine(to, steps[1]))).toBeVisible();
    await expect(review.rejectButton).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    // CACHED FIRST, in-app: the member page (no record yet) and the queue, then
    // back to the request through history — no load from here on.
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await peoplePage.editLink(member.name).click();
    await expect(peoplePage.leaveRecordsHeading).toBeVisible();
    await expect(peoplePage.leaveRecordRow(from, to)).toHaveCount(0);
    await peoplePage.navigationLink(hr.nav.zaOdluku, { exact: true }).click();
    await expect(conflictsPage.unresolvedTab).toBeVisible();
    // Story 9.5: the pending request is the member's one row, and names its kind.
    await expect(conflictsPage.rowsOf(member.name)).toHaveCount(1);
    await expect(conflictsPage.rowsOf(member.name)).toContainText(zaOdluku.kind.request);
    await page.goBack();
    await page.goBack();
    await page.goBack();
    await expect(review.approveButton).toBeVisible();

    // NO CONFIRMATION: Odobri decides, and the queue says so, focused.
    await review.approveButton.click();
    await expect(page).toHaveURL(/\/za-odluku$/);
    const saved = conflictsPage.savedStatus.filter({
      hasText: fill(zaOdluku.savedRequestApproved, { member: member.name, from: fullDate(from), to: fullDate(to) }),
    });
    await expect(saved).toBeVisible();
    await expect(saved).toBeFocused();
    // The approval's leave record raises its two collisions in the queue, which was cached before it,
    // and the request itself is gone from it (story 9.5).
    await expect(conflictsPage.rowsOf(member.name)).toHaveCount(2);
    await expect(conflictsPage.rowsOf(member.name).filter({ hasText: zaOdluku.kind.request })).toHaveCount(0);

    // Back to the request, with no reload: it reads Odobren, by whom and when — as stored — and offers nothing.
    await page.goBack();
    await expect(review.line(status.approved)).toBeVisible();
    const decided = await closedRequestShownInSql(fixture.slug, requestId);
    expect(decided.actor, 'the decision names its admin').not.toBeNull();
    await expect(review.decidedLine(decided.actor ?? '', decided.date, decided.time)).toBeVisible();
    await expect(review.approveButton).toHaveCount(0);
    await expect(review.rejectButton).toHaveCount(0);

    // The admin leave card, reached in-app and read before the approval, shows the new record.
    await page.goForward();
    await expect(page).toHaveURL(/\/za-odluku$/);
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await peoplePage.editLink(member.name).click();
    await expect(peoplePage.leaveRecordRow(from, to)).toBeVisible();

    // And the member's Godišnji reads the request Odobren.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const memberPage = await context.newPage();
      await new LoginPage(memberPage).signIn(fixture.slug, member.username, member.password);
      const leave = new LeavePage(memberPage);
      await leave.goto();
      await expect(leave.requestRow(`${fullDate(from)}–${fullDate(to)}`)).toContainText(status.approved);
    } finally {
      await context.close();
    }
  });

  test('rejects a request: only the decision is recorded', async ({ page, conflictsPage, peoplePage, fixture }) => {
    const { member, from, to } = await scenarioOf(fixture.slug);
    const requestId = await seedLeaveRequest(fixture.slug, member.id, from, to);
    const review = new LeaveRequestReviewPage(page);

    await review.gotoRequest(requestId);
    await review.rejectButton.click();
    await expect(page).toHaveURL(/\/za-odluku$/);
    await expect(
      conflictsPage.savedStatus.filter({
        hasText: fill(zaOdluku.savedRequestRejected, { member: member.name, from: fullDate(from), to: fullDate(to) }),
      }),
    ).toBeVisible();
    await expect(conflictsPage.unresolvedTab).toBeVisible();
    await expect(conflictsPage.rowsOf(member.name)).toHaveCount(0);

    await page.goBack();
    await expect(review.line(status.rejected)).toBeVisible();
    await expect(review.approveButton).toHaveCount(0);

    // No leave record was written.
    await peoplePage.gotoMember(member.id);
    await expect(peoplePage.leaveRecordsHeading).toBeVisible();
    await expect(peoplePage.leaveRecordRow(from, to)).toHaveCount(0);
  });

  test('refuses a stale approval: leave recorded since keeps the request pending, and the overlap is named', async ({
    page,
    fixture,
  }) => {
    const { member, from, to } = await scenarioOf(fixture.slug);
    const requestId = await seedLeaveRequest(fixture.slug, member.id, from, to);
    const review = new LeaveRequestReviewPage(page);

    await review.gotoRequest(requestId);
    await expect(review.figure(hr.godisnji.request.cost)).toHaveText(plural(days, 2));
    // An admin's direct leave over the request's last day, recorded after the screen read.
    await seedLeaveRecord(fixture.slug, member.id, to, to);

    await review.approveButton.click();
    await expect(review.alertWith(request.approvalStale)).toBeVisible();
    await expect(review.alertWith(request.approvalStale)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/za-odluku/zahtjev/${requestId}$`));
    await expect(review.line(status.pending)).toBeVisible();
    // The re-read records name the overlap; the request can still be rejected.
    await expect(review.line(hr.ljudi.leaveRecord.overlap)).toBeVisible();
    await expect(review.rejectButton).toBeVisible();
  });

  test('says a request closed meanwhile no longer waits, and reads it as it now stands', async ({ page, fixture }) => {
    const { member, from, to } = await scenarioOf(fixture.slug);
    const requestId = await seedLeaveRequest(fixture.slug, member.id, from, to);
    const review = new LeaveRequestReviewPage(page);

    await review.gotoRequest(requestId);
    await expect(review.rejectButton).toBeVisible();
    await withdrawLeaveRequestInSql(fixture.slug, requestId);

    await review.rejectButton.click();
    await expect(review.alertWith(request.notPending)).toBeVisible();
    await expect(review.line(status.withdrawn)).toBeVisible();
    await expect(review.approveButton).toHaveCount(0);
    await expect(review.rejectButton).toHaveCount(0);
  });

  test('reads a closed request only: its word, who decided and when, or the date it was withdrawn', async ({
    page,
    fixture,
  }) => {
    const { member, from, to } = await scenarioOf(fixture.slug);
    const approved = await seedLeaveRequest(fixture.slug, member.id, from, to, 'approved');
    const withdrawn = await seedLeaveRequest(fixture.slug, member.id, addDays(from, 8), addDays(to, 8), 'withdrawn');
    const review = new LeaveRequestReviewPage(page);

    await review.gotoRequest(approved);
    await expect(review.line(status.approved)).toBeVisible();
    // AS STORED, in the organization's zone: no clock or runner zone in the assertion.
    const decided = await closedRequestShownInSql(fixture.slug, approved);
    expect(decided.actor, 'the decision names its admin').not.toBeNull();
    await expect(review.decidedLine(decided.actor ?? '', decided.date, decided.time)).toBeVisible();
    await expect(review.figure(hr.godisnji.request.cost)).toHaveCount(0);
    await expect(review.approveButton).toHaveCount(0);

    await review.gotoRequest(withdrawn);
    await expect(review.line(status.withdrawn)).toBeVisible();
    const closed = await closedRequestShownInSql(fixture.slug, withdrawn);
    await expect(review.line(fill(hr.godisnji.request.withdrawnOn, { date: closed.date }))).toBeVisible();
    await expect(review.rejectButton).toHaveCount(0);
  });

  test('says an unknown request does not exist, with the way back', async ({ page }) => {
    const review = new LeaveRequestReviewPage(page);

    for (const id of [randomUUID(), 'not-a-request']) {
      await review.gotoRequest(id);
      await expect(review.line(request.missing)).toBeVisible();
      await expect(review.backLink).toBeVisible();
      await expect(review.approveButton).toHaveCount(0);
    }
  });

  test('offline, reads the request under the as-of note, gates both decisions and sends nothing', async ({
    page,
    fixture,
  }) => {
    const { member, from, to } = await scenarioOf(fixture.slug);
    const requestId = await seedLeaveRequest(fixture.slug, member.id, from, to);
    const review = new LeaveRequestReviewPage(page);

    await review.gotoRequest(requestId);
    await expect(review.figure(hr.godisnji.request.cost)).toHaveText(plural(days, 2));

    const decisions = spyOnDecisions(page);
    await page.context().setOffline(true);
    try {
      await expect(offlineWriteNoteIn(page)).toBeVisible();
      for (const button of [review.approveButton, review.rejectButton]) {
        await expect(button).toHaveAttribute('aria-disabled', 'true');
        await button.click({ force: true });
      }
      await expect(page).toHaveURL(new RegExp(`/za-odluku/zahtjev/${requestId}$`));

      // Away and back, still offline: the one snapshot, under the as-of note.
      await review.backLink.click();
      await expect(page).toHaveURL(/\/za-odluku$/);
      await page.goBack();
      await expect(review.offlineNote).toBeVisible();
      await expect(review.figure(hr.godisnji.request.cost)).toHaveText(plural(days, 2));
      await expect(review.approveButton).toHaveAttribute('aria-disabled', 'true');
      expect(decisions(), 'a decision left the page offline').toEqual([]);
    } finally {
      await page.context().setOffline(false);
    }
    await expect(review.approveButton).not.toHaveAttribute('aria-disabled', 'true');
    expect(decisions(), 'the reconnect sent a decision').toEqual([]);
  });
});

test.describe("a member and a request's decision screen", () => {
  test.use({ storageState: MEMBER_STATE });

  test('is sent to Danas, as Za odluku is', async ({ page }) => {
    await page.goto(`/za-odluku/zahtjev/${randomUUID()}`);
    await expect(page).toHaveURL('/danas');
  });
});
