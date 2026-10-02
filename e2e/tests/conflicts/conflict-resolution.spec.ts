import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import type { Page } from '@playwright/test';

import {
  holdRotation,
  removeLeaveRecordsInSql,
  removeSeededRotation,
  seedConflictResolution,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { dayMonth } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { readXlsx } from '../../utils/xlsx.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.4b: an admin opens a conflict on its own screen and accepts it as
 * uncovered.
 *
 * A team of the test's own gets a rotation in SQL from today (`[Dan, Noć,
 * Slobodno, Slobodno]`) under the run's rotation hold, and a fresh member on
 * it; a record over today to today + 4 — the worked example — makes three
 * conflicts: today (Dan), + 1 (Noć) and + 4 (Dan).
 *
 * The queue is the whole organization's and other specs write leave to it
 * meanwhile, so where a test counts positions (Open, Ends) the leave read is
 * answered with this member's records alone — the real rows, filtered — and
 * the queue holds exactly the three.
 *
 * Each test holds the run's rotation for its whole length, so the matrix's
 * rows share three tests rather than one each: Open, Ends, Missing and the
 * phone; Accept, end to end; and Failed then both Gone refusals.
 */

test.use({ storageState: ADMIN_STATE });

// Every test but the member's holds the run's rotation for its whole length,
// so each may wait for the others of this file, and of other files, first.
test.describe.configure({ timeout: 120_000 });

const raspored = hr.raspored;
const resolution = raspored.resolution;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let member: { readonly slug: string; readonly id: string } | null = null;

test.afterEach(async () => {
  try {
    if (member !== null) await removeLeaveRecordsInSql(member.slug, member.id).catch(() => undefined);
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    member = null;
    seed = null;
    await hold?.release();
    hold = null;
  }
});

/** An ISO date `count` days after another, by calendar arithmetic in UTC. */
function isoDaysAfter(iso: string, count: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);

  return day.toISOString().slice(0, 10);
}

interface Scenario {
  readonly team: { readonly id: string; readonly name: string };
  readonly seeded: { readonly id: string; readonly name: string };
  readonly today: string;
  readonly dates: readonly [string, string, string];
}

/** The team, its rotation from today, a member on it, and the worked example's record. */
async function scenarioOf(slug: string): Promise<Scenario> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const { today } = seed;
  const seeded = await seedLeaveMember(slug, team.id, today, 20);
  member = { slug, id: seeded.id };
  await seedLeaveRecord(slug, seeded.id, today, isoDaysAfter(today, 4));

  return { team, seeded, today, dates: [today, isoDaysAfter(today, 1), isoDaysAfter(today, 4)] };
}

/** Answers the organization's leave read with `memberId`'s live records alone: the real rows, filtered. */
async function onlyLeaveOf(page: Page, memberId: string): Promise<void> {
  await page.route('**/rest/v1/leave_records*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const answered = await route.fetch();
    const rows = (await answered.json()) as { readonly member_id?: string }[];
    const own = Array.isArray(rows) ? rows.filter((row) => row.member_id === memberId) : [];

    return route.fulfill({
      response: answered,
      headers: {
        ...answered.headers(),
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Content-Range',
        'content-range': own.length === 0 ? '*/0' : `0-${String(own.length - 1)}/${String(own.length)}`,
      },
      body: JSON.stringify(own),
    });
  });
}

test('opens a conflict from its queue row, shows K of N, moves with ‹ › in the queue\'s order, each disabled at its end, says a URL with no conflict is not open, and fits a phone', async ({
  page,
  conflictsPage,
  resolutionPage,
  fixture,
}) => {
  const { team, seeded, dates } = await scenarioOf(fixture.slug);
  await onlyLeaveOf(page, seeded.id);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(3);
  // No checkbox, no bulk action: each row is its link, and nothing else.
  await expect(conflictsPage.rows.getByRole('checkbox')).toHaveCount(0);
  await expect(conflictsPage.rows.getByRole('button')).toHaveCount(0);

  // OPEN THE 2ND OF 3.
  await conflictsPage.rowLink(rows.nth(1)).click();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${dates[1]}/${team.id}`);
  await expect(resolutionPage.heading(resolution.heading)).toBeVisible();
  await expect(resolutionPage.position(2, 3)).toBeVisible();
  await expect(resolutionPage.backLink).toHaveText(plural(resolution.back, 3));
  await expect(resolutionPage.previousButton).toHaveAccessibleName(fill(resolution.previous, { date: dayMonth(dates[0]) }));
  await expect(resolutionPage.nextButton).toHaveAccessibleName(fill(resolution.next, { date: dayMonth(dates[2]) }));
  await expect(resolutionPage.previousButton).toBeEnabled();
  await expect(resolutionPage.nextButton).toBeEnabled();
  // ONE card, nothing preselected.
  await expect(resolutionPage.options).toHaveCount(1);
  await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'false');
  await expect(resolutionPage.line(resolution.hintChoose)).toBeVisible();

  // ‹ TO THE 1ST: ‹ disabled there, nothing saved.
  await resolutionPage.previousButton.click();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${dates[0]}/${team.id}`);
  await expect(resolutionPage.position(1, 3)).toBeVisible();
  await expect(resolutionPage.previousButton).toBeDisabled();
  await expect(resolutionPage.previousButton).toHaveAccessibleName(resolution.previousNone);

  // › › TO THE LAST: › disabled there.
  await resolutionPage.nextButton.click();
  await expect(resolutionPage.position(2, 3)).toBeVisible();
  await resolutionPage.nextButton.click();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${dates[2]}/${team.id}`);
  await expect(resolutionPage.position(3, 3)).toBeVisible();
  await expect(resolutionPage.nextButton).toBeDisabled();
  await expect(resolutionPage.nextButton).toHaveAccessibleName(resolution.nextNone);

  // NOTHING WAS SAVED: the queue still holds three.
  await resolutionPage.cancelLink.click();
  await expect(page).toHaveURL('/raspored');
  await expect(rows).toHaveCount(3);

  // MISSING: + 2 is a Slobodno — on leave, but no working shift, so no conflict.
  await resolutionPage.gotoConflict(seeded.id, isoDaysAfter(dates[0], 2), team.id);
  await expect(resolutionPage.missingLine).toBeVisible();
  await expect(resolutionPage.backLink).toBeVisible();
  await expect(resolutionPage.options).toHaveCount(0);

  // A PHONE: no sideways scroll, the strip in three columns, ‹ › shown, and
  // the footer's buttons full width.
  await page.setViewportSize({ width: 390, height: 844 });
  await resolutionPage.gotoConflict(seeded.id, dates[0], team.id);
  await expect(resolutionPage.acceptOption).toBeVisible();
  await expectNoHorizontalScroll(page);
  const tops = await resolutionPage.stripLabels.evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().top));
  expect(tops).toHaveLength(3);
  expect(Math.max(...tops) - Math.min(...tops), 'the strip wraps into rows').toBeLessThan(2);
  await expect(resolutionPage.previousButton).toBeVisible();
  await expect(resolutionPage.nextButton).toBeVisible();
  const card = await resolutionPage.acceptOption.boundingBox();
  for (const button of [resolutionPage.saveButton, resolutionPage.cancelLink]) {
    expect((await button.boundingBox())?.width ?? 0).toBeGreaterThan((card?.width ?? 0) - 2);
  }
});

test('accepts a conflict as uncovered by keyboard: the queue drops it with a status line, the cell is uncovered, and Sati and the .xlsx count 12 h of leave', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  hoursPage,
  fixture,
}) => {
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  const sati = hr.sati.organization;

  // SATI BEFORE: the member's shifts and total, and no leave.
  await hoursPage.goto();
  const row = hoursPage.organizationRow(seeded.name);
  await expect(row).toHaveCount(1);
  await expect(await hoursPage.cellIn(row, sati.leave)).toHaveText(hr.sati.noFigure);
  // `15 smjena`: the count, then its noun.
  const shiftsOf = async (): Promise<number> =>
    Number(/^\d+/.exec(((await (await hoursPage.cellIn(row, sati.shifts)).textContent()) ?? '').trim())?.[0]);
  const shiftsBefore = await shiftsOf();
  expect(shiftsBefore).toBeGreaterThan(0);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(3);
  await conflictsPage.rowLink(rows.nth(0)).click();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);

  // THE STRIP: three terms, in order.
  await expect(resolutionPage.stripLabels).toHaveText([resolution.coverageLabel, resolution.hoursLabel, resolution.balanceLabel]);
  await expect(resolutionPage.acceptOption).toContainText(fill(resolution.hoursAsLeave, { hours: '12 h' }));
  await expect(resolutionPage.acceptOption).toContainText(resolution.balanceUnchanged);

  // SPREMI BEFORE A CHOICE saves nothing, sends focus to the choice, and the hint stays.
  await expect(resolutionPage.saveButton).toHaveAttribute('aria-disabled', 'true');
  await resolutionPage.saveButton.focus();
  await page.keyboard.press('Enter');
  await expect(resolutionPage.acceptOption).toBeFocused();
  await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'false');
  await expect(resolutionPage.line(resolution.hintChoose)).toBeVisible();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);

  // BY KEYBOARD: Tab reaches the card, Space selects it, and Tab goes on to Spremi.
  await resolutionPage.nextButton.focus();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.acceptOption).toBeFocused();
  await page.keyboard.press('Space');
  await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'true');
  await expect(resolutionPage.line(resolution.hintRecorded)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.cancelLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.saveButton).toBeFocused();
  await page.keyboard.press('Enter');

  // BACK ON THE QUEUE with the status line, focused so it is announced; the row is gone.
  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.savedStatus).toContainText(seeded.name);
  await expect(conflictsPage.savedStatus).toContainText(team.name);
  await expect(conflictsPage.savedStatus).toBeFocused();
  await expect(rows).toHaveCount(2);

  // THE LINE IS GONE on a reload.
  await page.reload();
  await expect(rows).toHaveCount(2);
  await expect(conflictsPage.savedStatus).toHaveCount(0);

  // THE CALENDAR: today's cell of the team is uncovered, and no longer in conflict.
  await calendarPage.goto();
  const cell = await calendarPage.cellOf(team.name, today);
  await expect(cell).toHaveAccessibleName(new RegExp(`, ${escapeRegExp(hr.kalendar.modifier.uncovered)}(,|$)`));
  await expect(cell).not.toHaveAccessibleName(new RegExp(`, ${escapeRegExp(hr.kalendar.modifier.conflict)}(,|$)`));

  // SATI: 12 h of leave, one shift fewer.
  await hoursPage.goto();
  await expect(row).toHaveCount(1);
  await expect(await hoursPage.cellIn(row, sati.leave)).toHaveText('12 h');
  await expect.poll(shiftsOf).toBe(shiftsBefore - 1);

  // THE .XLSX: the same 12 h in the leave column.
  const download = await hoursPage.exportDownload();
  const workbook = readXlsx(readFileSync(await download.path()));
  const [header, ...body] = workbook.rows;
  const leaveColumn = (header ?? []).findIndex((one) => one?.type === 'text' && one.value === sati.leave);
  const own = body.find((cells) => cells[0]?.type === 'text' && cells[0].value === seeded.name);
  expect(leaveColumn).toBeGreaterThan(-1);
  const leave = own?.[leaveColumn];
  expect(leave?.type).toBe('number');
  expect(leave?.type === 'number' ? Math.round(leave.value * 1440) : null).toBe(720);
});

test('a failed save says so and Spremi saves again, the saved line is gone on navigation, a denied save says so, and a conflict resolved meanwhile or whose leave was removed is no longer open', async ({
  page,
  conflictsPage,
  resolutionPage,
  fixture,
}) => {
  const { team, seeded, dates } = await scenarioOf(fixture.slug);
  const [today, next, last] = dates;

  // FAILED: the write does not reach the database; Spremi saves again.
  const write = '**/rest/v1/conflict_resolutions*';
  await page.route(write, (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.fallback()));
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(resolution.error.failed)).toBeVisible();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);
  await page.unroute(write);
  await resolutionPage.saveButton.click();
  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.savedStatus).toContainText(seeded.name);

  // THE LINE IS GONE on navigation: away and back, and on the Raspored tab itself.
  await conflictsPage.navigationLink(hr.nav.kalendar, { exact: true }).click();
  await expect(page).toHaveURL(/\/kalendar/);
  await conflictsPage.navigationLink(hr.nav.raspored, { exact: true }).click();
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.savedStatus).toHaveCount(0);
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.anyCountHeading).toBeVisible();
  await expect(conflictsPage.savedStatus).toHaveCount(0);

  // DENIED, 42501: the database refuses the caller.
  await page.route(write, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy', details: null, hint: null }),
        })
      : route.fallback(),
  );
  await resolutionPage.gotoConflict(seeded.id, next, team.id);
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(resolution.error.denied)).toBeVisible();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${next}/${team.id}`);
  await page.unroute(write);

  // GONE, 23505: resolved meanwhile, in SQL, while the screen is open.
  await resolutionPage.gotoConflict(seeded.id, next, team.id);
  await expect(resolutionPage.acceptOption).toBeVisible();
  await seedConflictResolution(fixture.slug, seeded.id, next, team.id);
  // The re-read of the resolutions is held until the refused POST has answered.
  let posted: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    posted = resolve;
  });
  await page.route(write, async (route) => {
    if (route.request().method() === 'POST') {
      const response = await route.fetch();
      await route.fulfill({ response });
      posted();
      return;
    }
    await answered;
    await route.fallback();
  });
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(resolution.error.gone)).toBeVisible();
  // Nothing left to save, and one way back.
  await expect(resolutionPage.saveButton).toHaveCount(0);
  await expect(resolutionPage.backLink).toHaveCount(1);
  await page.unroute(write);
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${next}/${team.id}`);

  // GONE, P0002: the leave removed meanwhile, in SQL, while the screen is open.
  await resolutionPage.gotoConflict(seeded.id, last, team.id);
  await expect(resolutionPage.acceptOption).toBeVisible();
  await removeLeaveRecordsInSql(fixture.slug, seeded.id);
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(resolution.error.gone)).toBeVisible();
  // The leave is re-read too, so the conflict is gone from the screen: no card, one way back.
  await expect(resolutionPage.options).toHaveCount(0);
  await expect(resolutionPage.saveButton).toHaveCount(0);
  await expect(resolutionPage.backLink).toHaveCount(1);
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${last}/${team.id}`);
});

test.describe('a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('opening a resolution screen is sent to Danas, as Raspored is', async ({ page }) => {
    await page.goto('/raspored/00000000-0000-4000-8000-000000000000/2026-10-02/00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL('/danas');
  });
});
