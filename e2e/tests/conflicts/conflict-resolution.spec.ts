import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import {
  databaseNow,
  holdRotation,
  removeLeaveRecordsInSql,
  removeRotationChangesOver,
  removeSeededRotation,
  seedConflictResolution,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedMemberStatusVersions,
  seedRosterOverride,
  seedRotationChange,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { dayMonth } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { leaveText } from '../../pages/hours.page.ts';
import { chargedLeaveDays } from '../../utils/rotation.ts';
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
 *
 * Story 5.4c adds the second card, "Zamijeni osobu": a replacement by
 * keyboard end to end, the arrow keys across the two cards, Taken and Gone.
 * The replacement is a fresh member on a second team of the test's own with
 * no rotation, so they are `slobodan` that day.
 *
 * Story 5.4d adds the third card, "Izmijeni godišnji odmor", which writes no
 * resolution: by keyboard to the member page's amend form, prefilled — a
 * cancel leaves the conflict in the queue, a saved amend takes it away — and
 * a one-day record to its removal confirmation, or nothing once it is gone.
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
/** Other members a test recorded leave for (story 5.4c's leave pick), removed with the test's own. */
let othersOnLeave: { readonly slug: string; readonly id: string }[] = [];

test.afterEach(async () => {
  try {
    for (const other of othersOnLeave) await removeLeaveRecordsInSql(other.slug, other.id).catch(() => undefined);
    othersOnLeave = [];
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

/**
 * The leave *Sati* shows for the scenario's member in today's month: the
 * record's charged days, derived from the seeded schedule as *Godišnji*
 * charges them — an accepted or replaced shift still stands on the member's
 * schedule, so its date still counts, and never as hours (2026-10-10).
 */
function leaveOf({ today }: Scenario): string {
  if (seed === null) throw new Error('E2E: no seeded rotation');

  const days = chargedLeaveDays(seed, today, isoDaysAfter(today, 4), today.slice(0, 7));

  // Today's own Dan is in conflict, so the record charges a day at least: never a `—` that would pass by accident.
  expect(days, 'the record charges a leave day').toBeGreaterThan(0);

  return leaveText(days);
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
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
  // THREE cards since story 5.4d, in their fixed order, nothing preselected.
  await expect(resolutionPage.options).toHaveCount(3);
  await expect(resolutionPage.options).toHaveText([
    new RegExp(`^${resolution.acceptTitle}`),
    new RegExp(`^${resolution.replaceTitle}`),
    new RegExp(`^${resolution.amendTitle}`),
  ]);
  await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'false');
  await expect(resolutionPage.replaceOption).toHaveAttribute('aria-checked', 'false');
  await expect(resolutionPage.amendOption).toHaveAttribute('aria-checked', 'false');
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
  // The third card's strip too (story 5.4d): three columns, its words wrapping inside them.
  await resolutionPage.amendOption.scrollIntoViewIfNeeded();
  const amendTops = await resolutionPage
    .stripLabelsOf(resolutionPage.amendOption)
    .evaluateAll((labels) => labels.map((label) => label.getBoundingClientRect().top));
  expect(amendTops).toHaveLength(3);
  expect(Math.max(...amendTops) - Math.min(...amendTops), 'the third strip wraps into rows').toBeLessThan(2);
  await expectNoHorizontalScroll(page);
  await expect(resolutionPage.previousButton).toBeVisible();
  await expect(resolutionPage.nextButton).toBeVisible();
  const card = await resolutionPage.acceptOption.boundingBox();
  for (const button of [resolutionPage.saveButton, resolutionPage.cancelLink]) {
    expect((await button.boundingBox())?.width ?? 0).toBeGreaterThan((card?.width ?? 0) - 2);
  }
});

test('accepts a conflict as uncovered by keyboard: the queue drops it with a status line, the cell is uncovered, Sati takes the shift out of the hours, and Sati and the .xlsx count the leave in days', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  hoursPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const scenario = await scenarioOf(fixture.slug);
  const { team, seeded, today } = scenario;
  const sati = hr.sati.organization;
  const leaveDays = leaveOf(scenario);

  // SATI BEFORE: the member's shifts and total, and the recorded leave's days.
  await hoursPage.goto();
  const row = hoursPage.organizationRow(seeded.name);
  await expect(row).toHaveCount(1);
  await expect(await hoursPage.cellIn(row, sati.leave)).toHaveText(leaveDays);
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
  await expect(resolutionPage.stripLabels).toHaveText([resolution.coverageLabel, resolution.absentLabel, resolution.balanceLabel]);
  // Leave is counted in days, never hours (2026-10-10): `1 dan godišnjeg`, no `12 h`.
  await expect(resolutionPage.acceptOption).toContainText(plural(resolution.daysAsLeave, 1));
  await expect(resolutionPage.acceptOption).not.toContainText('12 h');
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

  // SATI: one shift fewer, the same leave days — the accepted date is still a charged leave day — and no leave hours.
  await hoursPage.goto();
  await expect(row).toHaveCount(1);
  await expect.poll(shiftsOf).toBe(shiftsBefore - 1);
  await expect(await hoursPage.cellIn(row, sati.leave)).toHaveText(leaveDays);

  // THE .XLSX: the same day count, a plain number, under a heading that names days; no leave hours.
  const download = await hoursPage.exportDownload();
  const workbook = readXlsx(readFileSync(await download.path()));
  const [header, ...body] = workbook.rows;
  const leaveColumn = (header ?? []).findIndex((one) => one?.type === 'text' && one.value === sati.export.leaveDays);
  const own = body.find((cells) => cells[0]?.type === 'text' && cells[0].value === seeded.name);
  expect(leaveColumn).toBeGreaterThan(-1);
  expect(own?.[leaveColumn]).toEqual({ type: 'number', value: Number(/^\d+/.exec(leaveDays)?.[0]), format: null });
  expect(header?.[leaveColumn + 1]).toEqual({ type: 'text', value: sati.conflicts });
});

test('a failed save says so and Spremi saves again, the saved line is gone on navigation, a denied save says so, and a conflict resolved meanwhile or whose leave was removed is no longer open', async ({
  page,
  conflictsPage,
  resolutionPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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

/**
 * An arrow key held until focus lands on `target`, then released. Radix's
 * roving focus moves focus a tick after the keydown, and a radio is checked
 * only when it gains focus WHILE an arrow key is down — a person's key stays
 * down that long; Playwright's `press` does not.
 */
async function arrowTo(page: Page, key: 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft', target: Locator): Promise<void> {
  await page.keyboard.down(key);
  await expect(target).toBeFocused();
  await page.keyboard.up(key);
}

/** A fresh member on a second team of the test's own, with no rotation: `slobodan` on every date. */
async function replacementOf(slug: string, today: string, nameTail = ''): Promise<{ readonly id: string; readonly name: string }> {
  const other = await seedExtraTeam(slug, `Smjena ${randomBytes(3).toString('hex')}`);
  const seeded = await seedLeaveMember(slug, other.id, today, 20, nameTail);

  return { id: seeded.id, name: seeded.name };
}

/** Card 2's coverage for a team of one: `1 od 1 člana` — the absent member's shift, covered by the replacement. */
function replaceCoverageOfOne(): string {
  return `1 od ${plural(resolution.coverage.replace(/^\{covered\} od /, '').replace('{total,', '{count,'), 1)}`;
}

test('moves the selection across the three cards with the arrow keys, and Tab reaches only the checked card, or the first', async ({
  page,
  resolutionPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await expect(resolutionPage.acceptOption).toBeVisible();

  // NOTHING CHECKED: Tab reaches the first card, and the next Tab leaves the group.
  await resolutionPage.nextButton.focus();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.acceptOption).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.cancelLink).toBeFocused();

  // THE ARROWS move the selection, both ways.
  await page.keyboard.press('Shift+Tab');
  await expect(resolutionPage.acceptOption).toBeFocused();
  await arrowTo(page, 'ArrowDown', resolutionPage.replaceOption);
  await expect(resolutionPage.replaceOption).toHaveAttribute('aria-checked', 'true');
  await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'false');
  await arrowTo(page, 'ArrowUp', resolutionPage.acceptOption);
  await expect(resolutionPage.acceptOption).toHaveAttribute('aria-checked', 'true');
  await arrowTo(page, 'ArrowRight', resolutionPage.replaceOption);
  await expect(resolutionPage.replaceOption).toHaveAttribute('aria-checked', 'true');
  // ON TO THE THIRD (story 5.4d), and back.
  await arrowTo(page, 'ArrowDown', resolutionPage.amendOption);
  await expect(resolutionPage.amendOption).toHaveAttribute('aria-checked', 'true');
  await expect(resolutionPage.replaceOption).toHaveAttribute('aria-checked', 'false');
  await arrowTo(page, 'ArrowUp', resolutionPage.replaceOption);
  await expect(resolutionPage.replaceOption).toHaveAttribute('aria-checked', 'true');

  // THE CHECKED CARD is the group's one tab stop: from ‹ › Tab lands on it,
  // and Shift+Tab from the picker after it comes back to it.
  await resolutionPage.nextButton.focus();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.replaceOption).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.candidates.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(resolutionPage.replaceOption).toBeFocused();
});

test('replaces the absent member by keyboard: the queue drops the conflict with a status line naming the replacement, the day roster holds them with no uncovered mark, and Sati counts the leave in days and gives the replacement the shift', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  hoursPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const scenario = await scenarioOf(fixture.slug);
  const { team, seeded, today } = scenario;
  const dino = await replacementOf(fixture.slug, today);
  const sati = hr.sati.organization;

  // SATI BEFORE: the replacement's shifts.
  await hoursPage.goto();
  const dinoRow = hoursPage.organizationRow(dino.name);
  await expect(dinoRow).toHaveCount(1);
  const shiftsOf = async (row: typeof dinoRow): Promise<number> => {
    const text = ((await (await hoursPage.cellIn(row, sati.shifts)).textContent()) ?? '').trim();
    const count = /^\d+/.exec(text)?.[0];

    return count === undefined ? 0 : Number(count);
  };
  const dinoBefore = await shiftsOf(dinoRow);
  // And the absent member's leave days before the decision, which it must not change.
  await expect(await hoursPage.cellIn(hoursPage.organizationRow(seeded.name), sati.leave)).toHaveText(leaveOf(scenario));

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(3);
  await conflictsPage.rowLink(rows.nth(0)).click();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);

  // CARD 2 BY KEYBOARD: Tab to the group, the arrow to the second card.
  await resolutionPage.nextButton.focus();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.acceptOption).toBeFocused();
  await arrowTo(page, 'ArrowDown', resolutionPage.replaceOption);
  await expect(resolutionPage.replaceOption).toHaveAttribute('aria-checked', 'true');
  // Its strip: the coverage one higher, never "Nepokriveno", the hours and the balance as the first card's.
  await expect(resolutionPage.replaceOption).toContainText(replaceCoverageOfOne());
  await expect(resolutionPage.replaceOption).not.toContainText(resolution.uncovered);
  // Leave is counted in days, never hours (2026-10-10): `1 dan godišnjeg`, no `12 h`.
  await expect(resolutionPage.replaceOption).toContainText(plural(resolution.daysAsLeave, 1));
  await expect(resolutionPage.replaceOption).not.toContainText('12 h');
  await expect(resolutionPage.replaceOption).toContainText(resolution.balanceUnchanged);

  // THE PICKER, after the card, nothing picked: Spremi waits and says who is missing.
  await expect(resolutionPage.candidates).toBeVisible();
  await expect(resolutionPage.candidates.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(resolutionPage.candidateGroup(resolution.candidates.free)).toBeVisible();
  await expect(resolutionPage.candidateGroup(resolution.candidates.free).getByRole('radio', { name: new RegExp(`^${escapeRegExp(dino.name)}`) })).toHaveCount(1);
  // Neither the absent member nor anyone on the team is offered.
  await expect(resolutionPage.candidate(seeded.name)).toHaveCount(0);
  await expect(resolutionPage.line(resolution.hintChooseReplacement)).toBeVisible();
  await expect(resolutionPage.saveButton).toHaveAttribute('aria-disabled', 'true');
  await resolutionPage.saveButton.focus();
  await page.keyboard.press('Enter');
  await expect(resolutionPage.candidates.getByRole('radio').first()).toBeFocused();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);

  // PICK DINO with the arrow keys: each one moves the pick, across the groups, which block nothing.
  const dinoRadio = resolutionPage.candidate(dino.name);
  const radios = resolutionPage.candidates.getByRole('radio');
  const names = await radios.evaluateAll((all) => all.map((radio) => radio.textContent ?? ''));
  const at = names.findIndex((name) => name.startsWith(dino.name));
  expect(at).toBeGreaterThanOrEqual(0);
  for (let step = 1; step <= at; step += 1) await arrowTo(page, 'ArrowDown', radios.nth(step));
  await expect(dinoRadio).toHaveAttribute('aria-checked', 'true');
  await expect(dinoRadio).toBeFocused();
  await expect(resolutionPage.replaceOption).toContainText(`${replaceCoverageOfOne()}${fill(resolution.replacementShown, { name: dino.name })}`);
  await expect(resolutionPage.line(resolution.hintRecorded)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.cancelLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(resolutionPage.saveButton).toBeFocused();
  await page.keyboard.press('Enter');

  // BACK ON THE QUEUE: the status line names the replacement, and the row is gone.
  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.savedStatus).toContainText(seeded.name);
  await expect(conflictsPage.savedStatus).toContainText(dino.name);
  await expect(conflictsPage.savedStatus).toBeFocused();
  await expect(rows).toHaveCount(2);

  // THE DAY ROSTER holds Dino beside the absent member; the cell is not uncovered.
  await calendarPage.goto();
  const cell = await calendarPage.cellOf(team.name, today);
  await expect(cell).not.toHaveAccessibleName(new RegExp(`, ${escapeRegExp(hr.kalendar.modifier.uncovered)}(,|$)`));
  await expect(cell).not.toHaveAccessibleName(new RegExp(`, ${escapeRegExp(hr.kalendar.modifier.conflict)}(,|$)`));
  await cell.click();
  const detail = calendarPage.detailOf(team.name, today);
  await expect(calendarPage.rosterIn(detail)).toContainText(dino.name);
  await expect(calendarPage.rosterIn(detail)).toContainText(seeded.name);
  // The roster change is the one 0032 wrote, with the reason generated through t().
  await expect(calendarPage.rosterChangeItemsIn(detail)).toHaveCount(1);
  await expect(calendarPage.rosterChangeItemsIn(detail)).toContainText(fill(resolution.replaceReason, { member: seeded.name }));
  await page.keyboard.press('Escape');

  // SATI: the absent member's leave in days, the replaced date among them, never as hours; Dino has the shift.
  // The replaced date still counts: a replacement's override only ADDS Dino
  // (human, 2026-10-02), so the absent member stays rostered on that date with
  // their working shift, and Godišnji charges it (R4.2) — today is one of the
  // dates `leaveOf` counts, and the figure is unchanged by the decision.
  expect(chargedLeaveDays(seed!, today, today, today.slice(0, 7)), 'the replaced date is a charged leave day').toBe(1);
  await hoursPage.goto();
  const absentRow = hoursPage.organizationRow(seeded.name);
  await expect(absentRow).toHaveCount(1);
  await expect(await hoursPage.cellIn(absentRow, sati.leave)).toHaveText(leaveOf(scenario));
  await expect.poll(() => shiftsOf(dinoRow)).toBe(dinoBefore + 1);
  await expect(await hoursPage.cellIn(dinoRow, sati.leave)).toHaveText(hr.sati.noFigure);
});

test('a replacement already put on the shift meanwhile is named and leaves the list, and a conflict resolved meanwhile or whose leave was removed is no longer open', async ({
  page,
  resolutionPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, dates } = await scenarioOf(fixture.slug);
  const [today, next, last] = dates;
  const dino = await replacementOf(fixture.slug, today);
  const eva = await replacementOf(fixture.slug, today);

  // TAKEN, 23505 on the override's key: Dino put on the shift in SQL while the screen is open.
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await resolutionPage.replaceOption.click();
  await resolutionPage.candidate(dino.name).click();
  if (seed === null) throw new Error('E2E: no seeded rotation');
  await seedRosterOverride(seed, team.id, today, null, dino.name, 'E2E: već dodan');
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(fill(resolution.error.taken, { name: dino.name }))).toBeVisible();
  // The candidates are read again: Dino is gone from the list, and nobody is picked.
  await expect(resolutionPage.candidate(dino.name)).toHaveCount(0);
  await expect(resolutionPage.line(resolution.hintChooseReplacement)).toBeVisible();
  // The next step is another pick: focus is on the re-read list.
  await expect(resolutionPage.candidates.getByRole('radio').first()).toBeFocused();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);

  // GONE, 23505 on the resolution's key: resolved meanwhile, in SQL.
  await resolutionPage.gotoConflict(seeded.id, next, team.id);
  await resolutionPage.replaceOption.click();
  await resolutionPage.candidate(eva.name).click();
  await seedConflictResolution(fixture.slug, seeded.id, next, team.id);
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(resolution.error.gone)).toBeVisible();
  await expect(resolutionPage.saveButton).toHaveCount(0);
  await expect(resolutionPage.backLink).toHaveCount(1);

  // GONE, P0002: the leave removed meanwhile, in SQL.
  await resolutionPage.gotoConflict(seeded.id, last, team.id);
  await resolutionPage.replaceOption.click();
  await resolutionPage.candidate(eva.name).click();
  await removeLeaveRecordsInSql(fixture.slug, seeded.id);
  await resolutionPage.saveButton.click();
  await expect(resolutionPage.alertWith(resolution.error.gone)).toBeVisible();
  await expect(resolutionPage.options).toHaveCount(0);
  await expect(resolutionPage.backLink).toHaveCount(1);
});

test('fits the picker on a phone: no sideways scroll, and every candidate line wraps rather than truncating', async ({
  page,
  resolutionPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  // A name far wider than a phone, one unbroken word in it, so a line that
  // truncated or pushed the page sideways would show.
  const long = await replacementOf(
    fixture.slug,
    today,
    'Ana-Marija Kovačević-Horvatinčić Zrinski-Frankopan Nepregledivodugoprezimekojesenemozeprelomitinarazmaku',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await resolutionPage.replaceOption.click();
  await expect(resolutionPage.candidates).toBeVisible();
  await expectNoHorizontalScroll(page);
  const clipped = await resolutionPage.candidates.getByRole('radio').evaluateAll((radios) =>
    radios.filter((radio) => radio.scrollWidth > radio.clientWidth + 1 || getComputedStyle(radio).textOverflow === 'ellipsis').length,
  );
  expect(clipped, 'a candidate line is cut off').toBe(0);
  // The long line is there in full, and wraps onto more than one line.
  const longRadio = resolutionPage.candidate(long.name);
  await expect(longRadio).toHaveText(new RegExp(`^${escapeRegExp(long.name)}`));
  const box = await longRadio.boundingBox();
  expect(box?.height ?? 0, 'the long candidate line does not wrap').toBeGreaterThan(50);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
});

test('a pick is dropped when the choice moves to the first card: accepting saves as uncovered, with no override and no replacement on the day', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  const dino = await replacementOf(fixture.slug, today);

  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await resolutionPage.replaceOption.click();
  await resolutionPage.candidate(dino.name).click();
  await expect(resolutionPage.replaceOption).toContainText(dino.name);

  // TO CARD 1: the picker goes, and card 2 no longer names anybody.
  await resolutionPage.acceptOption.click();
  await expect(resolutionPage.candidates).toHaveCount(0);
  await expect(resolutionPage.replaceOption).not.toContainText(dino.name);
  // BACK TO CARD 2: nobody is picked.
  await resolutionPage.replaceOption.click();
  await expect(resolutionPage.candidates.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(resolutionPage.line(resolution.hintChooseReplacement)).toBeVisible();
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();

  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.savedStatus).toContainText(raspored.saved.replace(/^[\s\S]*\{member\}/, ''));
  await expect(conflictsPage.savedStatus).not.toContainText(dino.name);

  await calendarPage.goto();
  const cell = await calendarPage.cellOf(team.name, today);
  await expect(cell).toHaveAccessibleName(new RegExp(`, ${escapeRegExp(hr.kalendar.modifier.uncovered)}(,|$)`));
  await cell.click();
  const detail = calendarPage.detailOf(team.name, today);
  await expect(calendarPage.rosterIn(detail)).toContainText(seeded.name);
  await expect(calendarPage.rosterIn(detail)).not.toContainText(dino.name);
  await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);
});

test('Leave pick: a member on leave that date can be picked, and back on the queue, with no reload, their own new conflict is listed', async ({
  page,
  conflictsPage,
  resolutionPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  const eva = await replacementOf(fixture.slug, today);
  await seedLeaveRecord(fixture.slug, eva.id, today, today);
  othersOnLeave.push({ slug: fixture.slug, id: eva.id });

  await conflictsPage.goto();
  await expect(conflictsPage.rowsOf(seeded.name)).toHaveCount(3);
  await expect(conflictsPage.rowsOf(eva.name)).toHaveCount(0);
  await conflictsPage.rowLink(conflictsPage.rowsOf(seeded.name).nth(0)).click();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);

  await resolutionPage.replaceOption.click();
  // Offered under its own heading, and selectable: the group only informs.
  const evaRadio = resolutionPage.candidateGroup(resolution.candidates.onLeave).getByRole('radio', {
    name: new RegExp(`^${escapeRegExp(eva.name)}`),
  });
  await expect(evaRadio).toBeEnabled();
  await evaRadio.click();
  await resolutionPage.saveButton.click();

  // In-app, no reload: the calendar read is invalidated, so Eva's own conflict is derived at once.
  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.savedStatus).toContainText(eva.name);
  await expect(conflictsPage.rowsOf(seeded.name)).toHaveCount(2);
  await expect(conflictsPage.rowsOf(eva.name)).toHaveCount(1);
  await expect(conflictsPage.rowsOf(eva.name)).toContainText(team.name);
});

/**
 * Story 5.5d: a replacement that no longer applies stops hiding its conflict.
 * The replacement is seeded in SQL as 0032 writes it — Dino's override and
 * the `replace_member` resolution naming it — and then stops applying: its
 * override removed in the calendar (0033 ends the resolution with it, so the
 * key is free), or left pending by a rotation change saved after it (the
 * resolution stays live and holds the key until that override is removed).
 */
test('Removed override: removing the replacement in the calendar asks nothing, the conflict is back in the queue and in Sati, and accepting it saves', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  hoursPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const scenario = await scenarioOf(fixture.slug);
  const { team, seeded, today } = scenario;
  const dino = await replacementOf(fixture.slug, today);
  const sati = hr.sati.organization;
  const rosterChange = hr.kalendar.detail.rosterChange;
  await seedConflictResolution(fixture.slug, seeded.id, today, team.id, 'replace_member', dino.id);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(2);
  await hoursPage.goto();
  const absentRow = hoursPage.organizationRow(seeded.name);
  await expect(absentRow).toHaveCount(1);
  await expect(await hoursPage.cellIn(absentRow, sati.leave)).toHaveText(leaveOf(scenario));
  const conflictsCell = await hoursPage.cellIn(absentRow, sati.conflicts);
  const countOf = async (): Promise<number> => {
    const text = (await conflictsCell.textContent()) ?? '';
    const found = /\d+/.exec(text)?.[0];
    if (found === undefined) throw new Error(`E2E: the conflicts cell reads no number: ${text}`);

    return Number(found);
  };
  const before = await countOf();

  // THE CALENDAR: the replacement's override goes through its own confirmation, and no erasure dialog follows.
  await calendarPage.goto(`?prikaz=sve&mjesec=${today.slice(0, 7)}`);
  await (await calendarPage.cellOf(team.name, today)).click();
  const detail = calendarPage.detailOf(team.name, today);
  const block = calendarPage.rosterChangesIn(detail);
  const added = fill(rosterChange.added, { name: dino.name });
  await expect(block).toContainText(added);
  await calendarPage.rosterRemoveIn(block).click();
  const confirm = calendarPage.rosterRemoveConfirmOf(added, team.name, today);
  await calendarPage.confirmRosterRemoveIn(confirm).click();
  await expect(calendarPage.statusIn(detail)).toContainText(rosterChange.removedDone);
  // Removed straight from its confirmation: nothing it erases is asked about.
  await expect(calendarPage.rosterErasures('removal').dialog(1)).toHaveCount(0);
  await expect(block).toHaveCount(0);
  await page.keyboard.press('Escape');

  // SATI: the absent member's shift is band hours again, and counted as a conflict; the leave days stand.
  await hoursPage.goto();
  await expect(absentRow).toHaveCount(1);
  await expect(await hoursPage.cellIn(absentRow, sati.leave)).toHaveText(leaveOf(scenario));
  await expect.poll(countOf).toBe(before + 1);

  // THE QUEUE lists it again, and its screen holds nothing: 0033 ended the resolution with the override.
  await conflictsPage.goto();
  await expect(rows).toHaveCount(3);
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await expect(resolutionPage.acceptOption).toBeVisible();
  await expect(resolutionPage.line(resolution.held)).toHaveCount(0);
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();
  await expect(page).toHaveURL('/raspored');
  await expect(conflictsPage.savedStatus).toContainText(seeded.name);
  await expect(rows).toHaveCount(2);
});

test('Pending after rotation save: the conflict is listed again, Spremi waits with the hint linking to the calendar, and once the pending change is removed accepting saves', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today, dates } = await scenarioOf(fixture.slug);
  const last = dates[2];
  const dino = await replacementOf(fixture.slug, today);
  const rosterChange = hr.kalendar.detail.rosterChange;
  await seedConflictResolution(fixture.slug, seeded.id, last, team.id, 'replace_member', dino.id);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(2);

  // A ROTATION CHANGE saved after the replacement, from today + 1 on its own step: the same
  // schedule, so the conflict on today + 4 stands, but Dino's override is now pending review.
  if (seed === null) throw new Error('E2E: no seeded rotation');
  const rotation = seed;
  const since = await databaseNow();
  await seedRotationChange(rotation, team.id, dates[1], 1);
  try {
    await conflictsPage.goto();
    await expect(rows).toHaveCount(3);
    await resolutionPage.gotoConflict(seeded.id, last, team.id);
    await expect(resolutionPage.line(resolution.held)).toBeVisible();

    // The key is still held: Spremi waits, and a press writes nothing.
    const writes = resolutionWritesOf(page);
    await resolutionPage.acceptOption.click();
    await expect(resolutionPage.saveButton).toHaveAttribute('aria-disabled', 'true');
    // `aria-disabled` keeps it focusable: a press does nothing.
    await resolutionPage.saveButton.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/raspored/${seeded.id}/${last}/${team.id}`);
    expect(writes.count()).toBe(0);

    // THE HINT'S LINK: the grid on that month, narrowed to the team; the pending change is removed there.
    await page.getByRole('link', { name: resolution.heldAction, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/kalendar\\?.*mjesec=${last.slice(0, 7)}`));
    await expect(page).toHaveURL(new RegExp(`smjena=${team.id}`));
    await (await calendarPage.cellOf(team.name, last)).click();
    const detail = calendarPage.detailOf(team.name, last);
    const pending = calendarPage.rosterPendingIn(detail);
    const added = fill(rosterChange.added, { name: dino.name });
    await expect(pending).toContainText(added);
    await calendarPage.rosterRemoveIn(pending).click();
    await calendarPage.confirmRosterRemoveIn(calendarPage.rosterRemoveConfirmOf(added, team.name, last)).click();
    await expect(calendarPage.statusIn(detail)).toContainText(rosterChange.removedDone);
    await expect(calendarPage.rosterErasures('removal').dialog(1)).toHaveCount(0);
    await expect(pending).toHaveCount(0);
    await page.keyboard.press('Escape');

    // RE-DECIDED: the key is free, the line is gone, and accepting saves.
    await resolutionPage.gotoConflict(seeded.id, last, team.id);
    await expect(resolutionPage.acceptOption).toBeVisible();
    await expect(resolutionPage.line(resolution.held)).toHaveCount(0);
    await resolutionPage.acceptOption.click();
    await resolutionPage.saveButton.click();
    await expect(page).toHaveURL('/raspored');
    await expect(rows).toHaveCount(2);
  } finally {
    await removeRotationChangesOver(rotation, since);
  }
});

test('Inert replacement: a replacement deactivated before the date holds the conflict with the hint, its change is removed from the day detail, and accepting then saves', async ({
  page,
  conflictsPage,
  resolutionPage,
  calendarPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today, dates } = await scenarioOf(fixture.slug);
  const last = dates[2];
  const dino = await replacementOf(fixture.slug, today);
  const rosterChange = hr.kalendar.detail.rosterChange;
  await seedConflictResolution(fixture.slug, seeded.id, last, team.id, 'replace_member', dino.id);
  // Dino is deactivated from today + 1: on today + 4 the replacement is inert.
  await seedMemberStatusVersions(fixture.slug, dino.id, [{ active: false, effectiveFrom: dates[1] }]);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(3);
  await resolutionPage.gotoConflict(seeded.id, last, team.id);
  await expect(resolutionPage.line(resolution.held)).toBeVisible();
  await resolutionPage.acceptOption.click();
  await expect(resolutionPage.saveButton).toHaveAttribute('aria-disabled', 'true');

  // THE DAY DETAIL lists the inert change apart, and it can be removed there.
  await calendarPage.goto(`?prikaz=sve&mjesec=${last.slice(0, 7)}`);
  await (await calendarPage.cellOf(team.name, last)).click();
  const detail = calendarPage.detailOf(team.name, last);
  const inert = detail.getByRole('region', { name: rosterChange.inertHeading, exact: true });
  const added = fill(rosterChange.added, { name: dino.name });
  await expect(inert).toContainText(added);
  await calendarPage.rosterRemoveIn(inert).click();
  await calendarPage.confirmRosterRemoveIn(calendarPage.rosterRemoveConfirmOf(added, team.name, last)).click();
  await expect(calendarPage.statusIn(detail)).toContainText(rosterChange.removedDone);
  await expect(calendarPage.rosterErasures('removal').dialog(1)).toHaveCount(0);
  await expect(inert).toHaveCount(0);
  await page.keyboard.press('Escape');

  await resolutionPage.gotoConflict(seeded.id, last, team.id);
  await expect(resolutionPage.acceptOption).toBeVisible();
  await expect(resolutionPage.line(resolution.held)).toHaveCount(0);
  await resolutionPage.acceptOption.click();
  await resolutionPage.saveButton.click();
  await expect(page).toHaveURL('/raspored');
  await expect(rows).toHaveCount(2);
});

test.describe('a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('opening a resolution screen is sent to Danas, as Raspored is', async ({ page }) => {
    await page.goto('/raspored/00000000-0000-4000-8000-000000000000/2026-10-02/00000000-0000-4000-8000-000000000000');
    await expect(page).toHaveURL('/danas');
  });
});

/**
 * Counts every resolution write from here on — an insert into
 * `conflict_resolutions` or 0032's `replace_conflict_member` — and, as the
 * positive control that the listener sees writes at all, every leave amend
 * (`amend_leave_record`). The third card makes no resolution write.
 */
function resolutionWritesOf(page: Page): { readonly count: () => number; readonly amends: () => number } {
  let writes = 0;
  let amends = 0;

  page.on('request', (request) => {
    if (request.method() === 'GET') return;
    if (/\/rest\/v1\/(conflict_resolutions|rpc\/replace_conflict_member)\b/.test(request.url())) writes += 1;
    if (/\/rest\/v1\/rpc\/amend_leave_record\b/.test(request.url())) amends += 1;
  });

  return { count: () => writes, amends: () => amends };
}

test('amends the leave by keyboard: card 3 opens the member page\'s amend form prefilled with the range that clears the conflict, a cancel leaves it in the queue, a saved amend takes it away, and no resolution is written', async ({
  page,
  conflictsPage,
  resolutionPage,
  peoplePage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  const last = isoDaysAfter(today, 4);
  const start = isoDaysAfter(today, 1);
  const writes = resolutionWritesOf(page);

  await conflictsPage.goto();
  const rows = conflictsPage.rowsOf(seeded.name);
  await expect(rows).toHaveCount(3);

  /** From the queue's first row to the member page, by keyboard, through card 3. */
  async function amendByKeyboard(): Promise<void> {
    await conflictsPage.rowLink(rows.nth(0)).click();
    await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);
    await amendFromScreen();
  }

  /** From the open resolution screen to the member page, by keyboard, through card 3. */
  async function amendFromScreen(): Promise<void> {
    await expect(resolutionPage.amendOption).toBeVisible();
    await resolutionPage.nextButton.focus();
    await page.keyboard.press('Tab');
    await expect(resolutionPage.acceptOption).toBeFocused();
    await arrowTo(page, 'ArrowDown', resolutionPage.replaceOption);
    await arrowTo(page, 'ArrowDown', resolutionPage.amendOption);
    await expect(resolutionPage.amendOption).toHaveAttribute('aria-checked', 'true');
    // Tab leaves the group: the picker is card 2's alone.
    await page.keyboard.press('Tab');
    await expect(resolutionPage.cancelLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(resolutionPage.saveButton).toBeFocused();
    await expect(resolutionPage.saveButton).toHaveAttribute('aria-disabled', 'false');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/ljudi/${seeded.id}`);
  }

  // CARD 3: the computed start, the strip in the same three terms, and nothing marked recommended.
  await conflictsPage.rowLink(rows.nth(0)).click();
  await expect(resolutionPage.amendOption).toContainText(
    fill(resolution.amendBodyStarts, { name: seeded.name, date: dayMonth(today), newDate: dayMonth(start) }),
  );
  await expect(resolutionPage.stripLabelsOf(resolutionPage.amendOption)).toHaveText([
    resolution.coverageLabel,
    resolution.absentLabel,
    resolution.balanceLabel,
  ]);
  // Card 3's coverage, one higher, as card 2's: the absent member works their own shift.
  await expect(resolutionPage.amendOption).toContainText(replaceCoverageOfOne());
  await expect(resolutionPage.amendOption).toContainText(fill(resolution.amendWorks, { name: seeded.name }));
  await expect(resolutionPage.amendOption).toContainText(fill(resolution.hoursAsWork, { hours: '12 h' }));
  // 20 less the record's 3 is 17; dropping today gives one back.
  await expect(resolutionPage.amendOption).toContainText(plural(resolution.balance, 18));
  await expect(resolutionPage.amendOption).toContainText(plural(resolution.balanceGained, 1));
  await expect(resolutionPage.amendOption).not.toContainText(/preporu/i);
  await resolutionPage.amendOption.click();
  await expect(resolutionPage.line(fill(resolution.hintAmend, { date: dayMonth(start) }))).toBeVisible();
  await resolutionPage.cancelLink.click();
  await expect(page).toHaveURL('/raspored');

  // THE LAST DAY (today + 4): the leave ends the day before, and the hint names that date.
  const dayBefore = isoDaysAfter(today, 3);
  await resolutionPage.gotoConflict(seeded.id, last, team.id);
  await expect(resolutionPage.amendOption).toContainText(
    fill(resolution.amendBodyEnds, { name: seeded.name, date: dayMonth(last), newDate: dayMonth(dayBefore) }),
  );
  await resolutionPage.amendOption.click();
  await expect(resolutionPage.line(fill(resolution.hintAmend, { date: dayMonth(dayBefore) }))).toBeVisible();
  await resolutionPage.cancelLink.click();
  await expect(page).toHaveURL('/raspored');

  // THE AMEND DIALOG, opened once and prefilled with the range that clears the conflict, focus in it.
  await amendByKeyboard();
  await expect(peoplePage.leaveAmendDialog(today, last)).toBeVisible();
  await expect(peoplePage.leaveFromInput).toBeFocused();
  await expect(peoplePage.leaveFromInput).toHaveValue(start);
  await expect(peoplePage.leaveToInput).toHaveValue(last);
  await expect(peoplePage.backToConflictsLink).toBeVisible();

  // A RELOAD reopens nothing — the opening has left the entry — and the way back stays.
  await page.reload();
  await expect(peoplePage.leaveRecordRow(today, last)).toHaveCount(1);
  await expect(peoplePage.leaveDialog).toHaveCount(0);
  await expect(peoplePage.backToConflictsLink).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`/raspored/${seeded.id}/${today}/${team.id}`);
  await amendFromScreen();
  await expect(peoplePage.leaveAmendDialog(today, last)).toBeVisible();

  // CANCEL: the conflict is still open; with no opener, focus goes to the list's heading.
  await peoplePage.amendCancelButton.click();
  await expect(peoplePage.leaveDialog).toHaveCount(0);
  await expect(peoplePage.leaveRecordsHeading).toBeFocused();
  await peoplePage.backToConflictsLink.click();
  await expect(page).toHaveURL('/raspored');
  await expect(rows).toHaveCount(3);

  // SAVE THE AMEND: back on the queue, today's conflict is gone, the other two stand.
  await amendByKeyboard();
  await expect(peoplePage.leaveFromInput).toBeFocused();
  await peoplePage.amendSaveButton.click();
  await expect(peoplePage.leaveDialog).toHaveCount(0);
  await expect(peoplePage.leaveRecordRow(start, last)).toHaveCount(1);
  await peoplePage.backToConflictsLink.click();
  await expect(page).toHaveURL('/raspored');
  await expect(rows).toHaveCount(2);

  // NOTHING WAS WRITTEN as a resolution: the leave amend is the write, and the listener saw it.
  expect(writes.amends()).toBe(1);
  expect(writes.count()).toBe(0);
  // Reached any other way, the member page offers no way back to the conflicts.
  await peoplePage.gotoMember(seeded.id);
  await expect(peoplePage.leaveHeading).toBeVisible();
  await expect(peoplePage.backToConflictsLink).toHaveCount(0);
});

test('a one-day record: card 3 says the leave is removed and Spremi opens its removal confirmation; a record gone before arrival opens nothing', async ({
  page,
  resolutionPage,
  peoplePage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, seeded, today } = await scenarioOf(fixture.slug);
  await removeLeaveRecordsInSql(fixture.slug, seeded.id);
  await seedLeaveRecord(fixture.slug, seeded.id, today, today);
  const writes = resolutionWritesOf(page);

  // ONE DAY: the removal sentence and hint.
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await expect(resolutionPage.amendOption).toContainText(
    fill(resolution.amendBodyRemoves, { name: seeded.name, date: dayMonth(today) }),
  );
  await resolutionPage.amendOption.click();
  await expect(resolutionPage.line(resolution.hintAmendRemove)).toBeVisible();
  await resolutionPage.saveButton.click();
  await expect(page).toHaveURL(`/ljudi/${seeded.id}`);
  const confirm = peoplePage.removeLeaveConfirmOf(today, today, 1);
  await expect(confirm).toBeVisible();
  // Focus is in the confirmation, the modal's own.
  await expect(confirm.locator(':focus')).toHaveCount(1);
  await peoplePage.cancelRemoveLeaveIn(confirm).click();
  await expect(confirm).toHaveCount(0);

  // GONE: the record removed while the screen is open — the member page opens nothing.
  await resolutionPage.gotoConflict(seeded.id, today, team.id);
  await expect(resolutionPage.amendOption).toBeVisible();
  await removeLeaveRecordsInSql(fixture.slug, seeded.id);
  await resolutionPage.amendOption.click();
  await resolutionPage.saveButton.click();
  await expect(page).toHaveURL(`/ljudi/${seeded.id}`);
  await expect(peoplePage.leaveHeading).toBeVisible();
  await expect(peoplePage.text(hr.ljudi.leaveRecord.recordsEmpty)).toBeVisible();
  await expect(peoplePage.leaveRecordRows).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(peoplePage.backToConflictsLink).toBeVisible();
  expect(writes.count()).toBe(0);
});
