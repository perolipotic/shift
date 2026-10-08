import { randomBytes } from 'node:crypto';

import type { Browser, Page } from '@playwright/test';

import { CalendarPage } from '../../pages/calendar.page.ts';
import { LoginPage } from '../../pages/login.page.ts';
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
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { fullDate } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 5.3c: an admin sees every unresolved conflict on the calendar without
 * opening a day, and leave shows as a hatch.
 *
 * A team of the test's own gets a rotation from today in SQL
 * (`seedTeamRotation`: `[Dan, Noć, Slobodno, Slobodno]`) under the run's
 * rotation hold, and fresh members on it (`seedLeaveMember`). The admin
 * opens *Kalendar* first, so its reads are cached; then, in the app alone —
 * never a reload, so the marks prove the leave write's invalidation — records
 * today to today + 4 — Dan, Noć, Slobodno, Slobodno, Dan, the worked
 * example — on the member's page and goes back to *Kalendar*: the
 * team's cells on offsets 0, 1 and 4 carry `⚠`, the ring and the hatch and are
 * named Konflikt and Godišnji; offsets 2 and 3 carry nothing on the grid; the
 * legend lists Konflikt and Godišnji. The member's person view hatches all
 * five dates and adds `⚠` on the three working ones. Removing the record,
 * in the app the same way, clears every mark, and the page never reloaded.
 *
 * A member signed in to a context of their own reads their own leave hatched
 * in *Moj raspored* with no `⚠`, nothing new on the grid, and nothing of a
 * teammate's leave. A failed leave read shows the calendar's unavailable
 * alert, never a month without its marks, and its retry brings the month back.
 *
 * Story 5.4a: a resolution seeded in SQL on today's conflict takes that
 * cell's conflict mark off the grid, and the other two stay marked; the
 * member's person view still hatches the date as leave. Since story 5.4b the
 * seeded kind, accepted as uncovered, leaves the uncovered mark on the cell. A failed resolutions read
 * shows the same alert, and its retry brings the month back.
 */

test.use({ storageState: ADMIN_STATE });

const kalendar = hr.kalendar;
const CONFLICT = kalendar.modifier.conflict;
const LEAVE = kalendar.modifier.leave;
const UNCOVERED = kalendar.modifier.uncovered;

/** The run organization's rotation, while this file's test holds it. */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** Members whose live records are soft-removed afterwards. */
let withLeave: { readonly slug: string; readonly id: string }[] = [];

test.afterEach(async () => {
  try {
    for (const member of withLeave) await removeLeaveRecordsInSql(member.slug, member.id).catch(() => undefined);
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    withLeave = [];
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

/** `text` as a pattern that matches it literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A label naming `mark` among its parts. */
function names(mark: string): RegExp {
  return new RegExp(`, ${escapeRegExp(mark)}(,|$)`);
}

/** The worked example's five offsets from today, and which of them collide (Dan, Noć, Dan). */
const OFFSETS = [0, 1, 2, 3, 4] as const;
const COLLIDING = new Set<number>([0, 1, 4]);

interface Seeded {
  readonly today: string;
  readonly team: { readonly id: string; readonly name: string };
}

/** A team of the test's own with the seeded rotation from today, under the hold. */
async function seeded(slug: string): Promise<Seeded> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(slug, team.id, suffix);

  return { today: seed.today, team };
}

test('the admin records leave and opens Kalendar: the conflicts and the hatch are there without a reload, and a removal clears them', async ({
  page,
  calendarPage,
  peoplePage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { today, team } = await seeded(fixture.slug);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: member.id });
  const worked = { from: today, to: isoDaysAfter(today, 4) };

  // KALENDAR FIRST, so its two reads are cached before the write: what
  // follows proves the write's invalidation, never a first read.
  await calendarPage.goto('?prikaz=sve');
  await expect(calendarPage.columnHeader(team.name)).toBeVisible();
  await expect(calendarPage.cellsMarkedConflictOrLeave).toHaveCount(0);
  // A marker on the window: if any step below reloads the page, it is gone.
  await page.evaluate(() => {
    (window as unknown as { noReload: boolean }).noReload = true;
  });

  /** The member's page, reached in the app alone: Ljudi, then their row. */
  async function openMember(): Promise<void> {
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await peoplePage.listedMember(member.name).click();
    await expect(peoplePage.leaveHeading).toBeVisible();
  }

  /** Kalendar, reached in the app alone, on today's month. */
  async function openKalendar(): Promise<void> {
    await peoplePage.navigationLink(hr.nav.kalendar, { exact: true }).click();
    await expect(calendarPage.columnHeader(team.name)).toBeVisible();
  }

  // RECORD THE WORKED EXAMPLE on the member's page.
  await openMember();
  await peoplePage.enterLeave(worked.from, worked.to);
  await peoplePage.saveLeaveButton.click();
  await expect(peoplePage.status).toBeVisible();

  // THE GRID, back from the navigation.
  await openKalendar();
  // Today's month carries offset 0's conflict, so the legend is there.
  await expect(calendarPage.legendOf().heading).toBeVisible();
  expect(await calendarPage.legendNames()).toEqual([CONFLICT, LEAVE]);

  for (const offset of OFFSETS) {
    const date = isoDaysAfter(today, offset);
    await calendarPage.showMonthOf(date, today);
    const cell = await calendarPage.cellOf(team.name, date);

    if (COLLIDING.has(offset)) {
      await expect(cell, date).toHaveAccessibleName(new RegExp(`, ${escapeRegExp(CONFLICT)}, ${escapeRegExp(LEAVE)}$`));
      // ⚠ drawn, the conflict's ring and the leave hatch over the type's fill,
      // and the leave glyph lucide's Clock.
      await expect(calendarPage.drawnText(cell, '⚠', { exact: false })).toBeVisible();
      await expect(cell.locator('.modifier-ring-conflict.modifier-hatch-leave')).toHaveCount(1);
      await expect(cell.locator('svg.lucide-clock')).toHaveCount(1);
      await expect(cell.locator('svg.lucide-clock')).toHaveAttribute('aria-hidden', 'true');
    } else {
      // A non-working date raises nothing on the grid: it names the shift, not the person.
      await expect(cell, date).not.toHaveAccessibleName(names(CONFLICT));
      await expect(cell, date).not.toHaveAccessibleName(names(LEAVE));
      await expect(cell.locator('[class*="modifier-"]')).toHaveCount(0);
    }
  }

  // THE PERSON VIEW: every leave date hatched, the working ones also ⚠.
  await calendarPage.showMonthOf(today, today);
  await calendarPage.filters.choosePerson(member.name);
  const list = calendarPage.personListOf(member.name);
  await expect(list).toBeVisible();
  for (const offset of OFFSETS) {
    const date = isoDaysAfter(today, offset);
    await calendarPage.showMonthOf(date, today);
    const day = calendarPage.dayButtonIn(list, team.name, date);
    await expect(day, date).toHaveCount(1);
    await expect(day, date).toHaveAccessibleName(names(LEAVE));
    if (COLLIDING.has(offset)) await expect(day, date).toHaveAccessibleName(names(CONFLICT));
    else await expect(day, date).not.toHaveAccessibleName(names(CONFLICT));
  }

  // REMOVE THE RECORD on the member's page, in the app: every mark clears.
  await openMember();
  await peoplePage.removeLeaveButton(worked.from, worked.to).click();
  const confirm = peoplePage.dialog();
  await peoplePage.confirmRemoveLeaveIn(confirm).click();
  await expect(confirm).toHaveCount(0);
  await expect(peoplePage.removeLeaveButton(worked.from, worked.to)).toHaveCount(0);

  await openKalendar();
  for (const offset of OFFSETS) {
    const date = isoDaysAfter(today, offset);
    await calendarPage.showMonthOf(date, today);
    const cell = await calendarPage.cellOf(team.name, date);
    await expect(cell, date).not.toHaveAccessibleName(names(CONFLICT));
    await expect(cell, date).not.toHaveAccessibleName(names(LEAVE));
  }
  await expect(calendarPage.cellsMarkedConflictOrLeave).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);
});

/** *Kalendar* as `member`, in a fresh context of its own. */
async function signedInAs(browser: Browser, slug: string, member: SeededLeaveMember): Promise<{ page: Page; calendar: CalendarPage }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await new LoginPage(page).signIn(slug, member.username, member.password);

    return { page, calendar: new CalendarPage(page) };
  } catch (cause) {
    await context.close();
    throw cause;
  }
}

test("a member reads their own leave hatched with no conflict, nothing new on the grid, and nothing of a teammate's", async ({
  browser,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { today, team } = await seeded(fixture.slug);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  const teammate = await seedLeaveMember(fixture.slug, team.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: member.id }, { slug: fixture.slug, id: teammate.id });
  // The member's own worked example, and the teammate's leave right after it.
  await seedLeaveRecord(fixture.slug, member.id, today, isoDaysAfter(today, 4));
  await seedLeaveRecord(fixture.slug, teammate.id, isoDaysAfter(today, 5), isoDaysAfter(today, 8));

  const { page, calendar } = await signedInAs(browser, fixture.slug, member);
  try {
    // MOJ RASPORED: every own leave date hatched, none ⚠; the teammate's dates bare.
    await calendar.goto('?prikaz=moj');
    await expect(calendar.dayList).toBeVisible();
    for (const offset of [...OFFSETS, 5, 6, 7, 8]) {
      const date = isoDaysAfter(today, offset);
      await calendar.showMonthOf(date, today);
      const day = calendar.dayButtonIn(calendar.dayList, team.name, date);
      await expect(day, date).toHaveCount(1);
      await expect(day, date).not.toHaveAccessibleName(names(CONFLICT));
      if (offset <= 4) await expect(day, date).toHaveAccessibleName(names(LEAVE));
      else await expect(day, date).not.toHaveAccessibleName(names(LEAVE));
    }
    await calendar.showMonthOf(today, today);
    expect(await calendar.legendNames()).toEqual([LEAVE]);

    // SVE SMJENE: nothing new — no conflict, no leave, no legend.
    await calendar.modes().sve.click();
    await expect(calendar.grid).toBeVisible();
    for (const date of [today, isoDaysAfter(today, 8)]) {
      await calendar.showMonthOf(date, today);
      await expect(calendar.cells.first()).toBeVisible();
      await expect(calendar.cellsMarkedConflictOrLeave).toHaveCount(0);
      await expect(calendar.legendOf().heading).toHaveCount(0);
    }

    // STORY 7.9: the day detail of a day in unresolved conflict states no conflict to a member, and offers no change.
    await calendar.showMonthOf(today, today);
    await (await calendar.cellOf(team.name, today)).click();
    const detail = calendar.detailOf(team.name, today);
    await expect(detail).toBeVisible();
    await expect(calendar.rosterLinesIn(detail).filter({ hasText: member.name })).toHaveCount(1);
    await expect(calendar.conflictsIn(detail)).toHaveCount(0);
    await expect(calendar.rosterOpenerIn(detail)).toHaveCount(0);
    await expect(calendar.overrideOpenerIn(detail)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    // THE TEAMMATE'S PERSON VIEW: nothing of their leave.
    await calendar.showMonthOf(today, today);
    await calendar.filters.choosePerson(teammate.name);
    const theirs = calendar.personListOf(teammate.name);
    await expect(theirs).toBeVisible();
    for (const offset of [5, 6, 7, 8]) {
      const date = isoDaysAfter(today, offset);
      await calendar.showMonthOf(date, today);
      const day = calendar.dayButtonIn(theirs, team.name, date);
      await expect(day, date).toHaveCount(1);
      await expect(day, date).not.toHaveAccessibleName(names(LEAVE));
      await expect(day, date).not.toHaveAccessibleName(names(CONFLICT));
    }
  } finally {
    await page.context().close();
  }
});

test('a failed leave read shows the unavailable alert and no month, and the retry brings the month back', async ({
  page,
  calendarPage,
  fixture,
}) => {
  const records = '**/rest/v1/leave_records*';
  await page.route(records, (route) => route.fulfill({ status: 500, body: '{}' }));

  await calendarPage.goto('?prikaz=sve');
  await expect(calendarPage.unavailableAlert).toBeVisible();
  await expect(calendarPage.retryButton).toBeVisible();
  await expect(calendarPage.anyGrid).toHaveCount(0);

  await page.unroute(records);
  await calendarPage.retryButton.click();
  await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
  await expect(calendarPage.unavailableAlert).toHaveCount(0);
  await expect(calendarPage.retryButton).toHaveCount(0);
});

test('a conflict accepted as uncovered carries the uncovered mark and no conflict mark on the grid, the other two still do, and the person view keeps its leave', async ({
  calendarPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { today, team } = await seeded(fixture.slug);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: member.id });
  await seedLeaveRecord(fixture.slug, member.id, today, isoDaysAfter(today, 4));
  await seedConflictResolution(fixture.slug, member.id, today, team.id);

  await calendarPage.goto('?prikaz=sve');
  await expect(calendarPage.columnHeader(team.name)).toBeVisible();
  for (const offset of COLLIDING) {
    const date = isoDaysAfter(today, offset);
    await calendarPage.showMonthOf(date, today);
    const cell = await calendarPage.cellOf(team.name, date);

    if (offset === 0) {
      // Story 5.4b: accepted as uncovered — the uncovered mark alone.
      await expect(cell, date).not.toHaveAccessibleName(names(CONFLICT));
      await expect(cell, date).not.toHaveAccessibleName(names(LEAVE));
      await expect(cell, date).toHaveAccessibleName(names(UNCOVERED));
    } else {
      await expect(cell, date).toHaveAccessibleName(names(CONFLICT));
    }
  }

  // The person view: today is still leave, and no longer a conflict.
  await calendarPage.showMonthOf(today, today);
  await calendarPage.filters.choosePerson(member.name);
  const list = calendarPage.personListOf(member.name);
  await expect(list).toBeVisible();
  const day = calendarPage.dayButtonIn(list, team.name, today);
  await expect(day).toHaveAccessibleName(names(LEAVE));
  await expect(day).not.toHaveAccessibleName(names(CONFLICT));
});

test('the day detail states each unresolved conflict with its leave, links to its decision, and the type dialog previews the change', async ({
  page,
  calendarPage,
  fixture,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  // STORY 7.9. Today + 1 is the seeded rotation's Noć; the member on leave works it.
  const { today, team } = await seeded(fixture.slug);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: member.id });
  const last = isoDaysAfter(today, 4);
  await seedLeaveRecord(fixture.slug, member.id, today, last);
  // Today's is accepted as uncovered: resolved, so its day states no conflict.
  await seedConflictResolution(fixture.slug, member.id, today, team.id);
  const date = isoDaysAfter(today, 1);
  // A member of another team (with no rotation), on leave that day: a candidate "na godišnjem taj dan".
  const elsewhere = await seedExtraTeam(fixture.slug, `Smjena ${randomBytes(3).toString('hex')}`);
  const away = await seedLeaveMember(fixture.slug, elsewhere.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: away.id });
  await seedLeaveRecord(fixture.slug, away.id, date, date);

  await calendarPage.goto('?prikaz=sve');
  await calendarPage.showMonthOf(today, today);
  await (await calendarPage.cellOf(team.name, today)).click();
  const resolved = calendarPage.detailOf(team.name, today);
  await expect(resolved).toBeVisible();
  await expect(calendarPage.conflictsIn(resolved)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(resolved).toHaveCount(0);

  await calendarPage.showMonthOf(date, today);
  await (await calendarPage.cellOf(team.name, date)).click();
  const detail = calendarPage.detailOf(team.name, date);
  await expect(detail).toBeVisible();
  await expect(detail.locator('form')).toHaveCount(0);
  const conflicts = calendarPage.conflictsIn(detail);
  await expect(conflicts).toContainText(
    fill(kalendar.detail.conflict.line, { name: member.name, from: fullDate(today), to: fullDate(last) }),
  );
  await expect(calendarPage.resolveLinksIn(conflicts)).toHaveCount(1);
  await expect(calendarPage.changesIn(detail)).toContainText(kalendar.detail.changes.empty);

  // The type dialog: Slobodno takes the member's hours away, before any save; its cancel returns to the day.
  const form = await calendarPage.openOverrideFormIn(detail);
  const free = seed?.steps[2];
  if (free === undefined) throw new Error('E2E: no seeded rotation');
  await calendarPage.overrideTypeIn(form).selectOption({ label: free });
  await expect(calendarPage.previewIn(form)).toContainText(kalendar.detail.preview.heading);
  await expect(calendarPage.previewIn(form)).toContainText(`→ ${free}`);
  await expect(calendarPage.previewIn(form)).toContainText(member.name);
  await expect(calendarPage.previewIn(form)).toContainText(/−\d/);
  await calendarPage.overrideCancelIn(form).click();
  await expect(calendarPage.overrideForm).toHaveCount(0);
  await expect(calendarPage.overrideOpenerIn(detail)).toBeFocused();

  // The roster dialog: the member on leave elsewhere is offered under "na godišnjem taj dan", none preselected.
  const roster = await calendarPage.openRosterFormIn(detail);
  await expect(calendarPage.rosterInIn(roster)).toHaveValue('');
  const onLeave = calendarPage.rosterInGroupIn(roster, 'onLeave');
  await expect(onLeave).toHaveAttribute('label', hr.raspored.resolution.candidates.onLeave);
  await expect(calendarPage.memberOptionIn(onLeave, away.name)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(calendarPage.rosterForm).toHaveCount(0);

  // "Riješi konflikt" goes to that conflict's decision screen.
  await calendarPage.resolveLinksIn(conflicts).click();
  await expect(page).toHaveURL(`/raspored/${member.id}/${date}/${team.id}`);
});

test('a failed resolutions read shows the unavailable alert and no month, and the retry brings the month back', async ({
  page,
  calendarPage,
  fixture,
}) => {
  const resolutions = '**/rest/v1/conflict_resolutions*';
  await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));

  await calendarPage.goto('?prikaz=sve');
  await expect(calendarPage.unavailableAlert).toBeVisible();
  await expect(calendarPage.retryButton).toBeVisible();
  await expect(calendarPage.anyGrid).toHaveCount(0);

  await page.unroute(resolutions);
  await calendarPage.retryButton.click();
  await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
  await expect(calendarPage.unavailableAlert).toHaveCount(0);
});
