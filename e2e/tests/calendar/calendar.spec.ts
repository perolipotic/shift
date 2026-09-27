import { randomBytes, randomUUID } from 'node:crypto';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import {
  holdFireRanks,
  holdRotation,
  removeSeededRotation,
  seedShiftTypeOverride,
  seedTeamRotation,
  setFireRanks,
  setRankAndPosition,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { dayMonth, weekdayOf } from '../../utils/dates.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { MINIMUM_TARGET, expectNoHorizontalScroll, expectTouchTargets } from '../../utils/layout.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 3.1: anyone reads a month. The fixture team gets a rotation from
 * today in SQL (`seedTeamRotation`), under the run's rotation hold, and the
 * calendar is read as an admin and as a member: the same grid, the team's
 * column, the projected types, month navigation with no second read, and the
 * phone layout.
 *
 * Story 3.2a: the two modes on a phone — a member lands on *Moj raspored*,
 * an admin on the grid, the switch shows the compressed one-letter grid,
 * `prikaz` survives month navigation, the member on no team reads the notice,
 * and it is all one read.
 *
 * Story 3.2b: the grid is an ARIA grid — one tab stop that starts on today,
 * the arrows, Home, End and Ctrl+End moving focus at 1280 px and at 390 px —
 * every gridcell named in full, and no legend while no mark is on screen.
 *
 * Story 3.3a: *Sve smjene* narrowed to one team by a native Select — the
 * all-teams option counting the columns, the teams under their heading — kept
 * across month navigation and cleared by the reset, and a phone-safe row.
 *
 * Story 3.3b: the same Select lists every active person under *Osobe*, to an
 * admin and to a member-role account alike; choosing one replaces the grid
 * with their day list headed with their name, kept across months, dropped by
 * choosing a team and by the reset, and a person on no team is explained.
 *
 * Story 3.4b: a cell — clicked, or Enter or Space on it — and a day-list day
 * open the read-only day detail: the type, its times and who is rostered as at
 * that date; an off day and a day before the rotation say so. Escape returns
 * focus to the opener.
 *
 * Story 3.5a: a shift-type override, written in SQL (`seedShiftTypeOverride`),
 * marks its cell and its day with `✎`, the persistent legend shows beside the
 * grid and the day list, and the day detail names the projected type, the
 * author, the time and the reason.
 */

const kalendar = hr.kalendar;

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** The fire-rank setting, while the rank test holds it (`holdFireRanks`). */
let ranksHold: RotationHold | null = null;
/** What the rank test changed, put back before its hold is released. */
let restoreRanks: (() => Promise<void>) | null = null;
let restoreMember: (() => Promise<void>) | null = null;

test.afterEach(async () => {
  try {
    try {
      await restoreMember?.();
      await restoreRanks?.();
    } finally {
      restoreMember = null;
      restoreRanks = null;
      await ranksHold?.release();
      ranksHold = null;
    }
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
    await hold?.release();
    hold = null;
  }
});

async function seeded(slug: string, teamId: string): Promise<SeededRotation> {
  hold = holdRotation(slug);
  await hold.ready;
  seed = await seedTeamRotation(slug, teamId, randomBytes(3).toString('hex'));

  return seed;
}

/** A `YYYY-MM-DD` date `days` days from `date`, by UTC arithmetic. */
function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);

  return instant.toISOString().slice(0, 10);
}

/** The first date of the month after `date`'s. */
function firstOfNextMonth(date: string): string {
  const instant = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  instant.setUTCMonth(instant.getUTCMonth() + 1);

  return instant.toISOString().slice(0, 10);
}

/** `Listopad 2026` — the heading a month carries. */
function monthHeading(date: string): string {
  const name = new Intl.DateTimeFormat('hr', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 7)}-15T12:00:00Z`),
  );

  return fill(kalendar.monthHeading, {
    month: `${name.charAt(0).toLocaleUpperCase('hr')}${name.slice(1)}`,
    year: date.slice(0, 4),
  });
}

/** The type the seeded pattern names on `date`, from its start today. */
function expectedType(rotation: SeededRotation, date: string): string {
  const days = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${rotation.today}T12:00:00Z`)) / 86_400_000,
  );
  const step = rotation.steps[((days % 4) + 4) % 4];
  if (step === undefined) throw new Error(`E2E: no step for ${date}`);

  return step;
}

for (const [role, storageState] of [
  ['an admin', ADMIN_STATE],
  ['a member', MEMBER_STATE],
] as const) {
  test.describe(`as ${role}`, () => {
    test.use({ storageState });

    test('the month shows the team column and the projected types, today marked', async ({ calendarPage, fixture }) => {
      const rotation = await seeded(fixture.slug, fixture.team.id);

      await calendarPage.goto();
      await expect(calendarPage.heading(hr.nav.kalendar)).toBeVisible();
      await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
      await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();

      const today = calendarPage.todayRowAnywhere;
      await expect(today).toHaveCount(1);
      await expect(calendarPage.rowHeaderIn(today)).toContainText(dayMonth(rotation.today));

      const first = await calendarPage.cellOf(fixture.team.name, rotation.today);
      await expect(first).toContainText(expectedType(rotation, rotation.today));
      // From 640 px up the full names are DRAWN, not merely read out: the
      // `sm:not-sr-only` spans have a real box.
      for (const drawn of [
        calendarPage.drawnText(calendarPage.columnHeader(fixture.team.name), fixture.team.name),
        calendarPage.drawnText(first, expectedType(rotation, rotation.today)),
      ]) {
        const box = await drawn.boundingBox();
        expect(box, 'a full name has no box').not.toBeNull();
        expect(box!.width).toBeGreaterThan(1);
        expect(box!.height).toBeGreaterThan(1);
      }
      // Desktop: the range is shown beside the name — visible, not merely in the DOM.
      await expect(calendarPage.drawnText(first, '07:00–19:00')).toBeVisible();

      // The next month, through the URL: every date projected from today.
      const next = firstOfNextMonth(rotation.today);
      await calendarPage.goto(`?mjesec=${next.slice(0, 7)}`);
      await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
      for (const offset of [0, 1, 2, 3]) {
        const date = addDays(next, offset);
        await expect(await calendarPage.cellOf(fixture.team.name, date), date).toContainText(expectedType(rotation, date));
      }
      // A crossing shift is shown once, with both clock times.
      const night = [0, 1, 2, 3].map((offset) => addDays(next, offset)).find(
        (date) => expectedType(rotation, date) === rotation.steps[1],
      );
      if (night === undefined) throw new Error('E2E: no night in four days');
      await expect(calendarPage.drawnText(await calendarPage.cellOf(fixture.team.name, night), '19:00–07:00')).toBeVisible();
    });
  });
}

test.describe('month navigation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('next, next, previous change the month without reading again', async ({ page, calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await calendarPage.goto();
    await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    await expect(await calendarPage.cellOf(fixture.team.name, rotation.today)).toContainText(
      expectedType(rotation, rotation.today),
    );

    const reads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/organizations')) reads.push(request.url());
    });

    const next = firstOfNextMonth(rotation.today);
    const afterNext = firstOfNextMonth(next);

    await calendarPage.nextButton.click();
    await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`mjesec=${next.slice(0, 7)}`));
    await calendarPage.nextButton.click();
    await expect(calendarPage.monthHeading(monthHeading(afterNext))).toBeVisible();
    await expect(await calendarPage.cellOf(fixture.team.name, afterNext)).toContainText(expectedType(rotation, afterNext));
    await calendarPage.previousButton.click();
    await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
    await expect(await calendarPage.cellOf(fixture.team.name, next)).toContainText(expectedType(rotation, next));

    await calendarPage.currentButton.click();
    await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    // On the current month, `Ovaj mjesec` has nowhere to go.
    await expect(calendarPage.currentButton).toBeDisabled();

    // Whatever a navigation might have fetched has landed before the count is read.
    await page.waitForLoadState('networkidle');
    expect(reads, 'moving between months read the snapshot again').toEqual([]);
  });

  test('the bounds disable only the button that would leave the calendar', async ({ calendarPage }) => {
    await calendarPage.goto('?mjesec=9999-12');
    await expect(calendarPage.nextButton).toBeDisabled();
    await expect(calendarPage.previousButton).toBeEnabled();

    await calendarPage.goto('?mjesec=0001-01');
    await expect(calendarPage.previousButton).toBeDisabled();
    await expect(calendarPage.nextButton).toBeEnabled();
  });
});

test.describe('edge months and a failed read', () => {
  test.use({ storageState: MEMBER_STATE });

  test('a month before any rotation shows the mark, named for a screen reader', async ({ calendarPage, fixture }) => {
    await calendarPage.goto('?mjesec=0001-01');
    const cell = await calendarPage.cellOf(fixture.team.name, '0001-01-01');

    await expect(cell).toContainText('\u2014');
    // The mark is drawn; the gridcell's own label names it.
    await expect(cell).toHaveAccessibleName(`${weekdayOf('0001-01-01')} 01.01., ${fixture.team.name}, ${kalendar.noRotation}`);
  });

  test('a read that fails shows the alert and no grid', async ({ page, calendarPage }) => {
    // A refused answer rather than an aborted socket: the client retries a
    // network failure on its own schedule, and the point here is the screen.
    await page.route('**/rest/v1/organizations*', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"refused"}' }),
    );
    await calendarPage.goto();

    await expect(calendarPage.unavailableAlert).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);
  });
});

test.describe('at 320 px', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 320, height: 720 } });

  test('the page never scrolls sideways in either mode, and the buttons are touch targets', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await calendarPage.goto();
    await expect(calendarPage.today).toContainText(
      expectedType(rotation, rotation.today),
    );
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);

    await calendarPage.goto('?prikaz=sve');
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).toContainText(expectedType(rotation, rotation.today));
    // Below 1024 px the range is not shown — dropped, never abbreviated.
    await expect(calendarPage.drawnText(cell, '07:00–19:00', { exact: false })).toBeHidden();

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});

/** Whether `letter` is the start of `word`, uppercased, and shorter than it: a compressed label. */
function expectLetterOf(letter: string, word: string): void {
  expect(letter.length, `${letter} is not a short label of ${word}`).toBeGreaterThan(0);
  expect(word.toLocaleUpperCase('hr').startsWith(letter), `${letter} does not start ${word}`).toBe(true);
}

test.describe('on a phone, as a member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 } });

  test('lands on Moj raspored with the seeded types, and the switch shows the letters', async ({ page, calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    const reads: string[] = [];
    page.on('request', (request) => {
      const url = decodeURIComponent(request.url());
      if (url.includes('/rest/v1/organizations') && url.includes('rotation_assignments')) reads.push(url);
    });

    await calendarPage.goto();
    await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    const { moj, sve } = calendarPage.modes();
    await expect(moj).toHaveAttribute('aria-pressed', 'true');
    await expect(sve).toHaveAttribute('aria-pressed', 'false');
    await expect(calendarPage.anyGrid).toHaveCount(0);

    // A day per date, today marked, each the member's own team's type.
    await expect(calendarPage.dayListItems).toHaveCount(
      new Date(Date.UTC(Number(rotation.today.slice(0, 4)), Number(rotation.today.slice(5, 7)), 0)).getUTCDate(),
    );
    const today = calendarPage.today;
    await expect(today).toHaveCount(1);
    await expect(today).toContainText(dayMonth(rotation.today));
    await expect(today).toContainText(expectedType(rotation, rotation.today));
    // The day list shows the range of a working type.
    const tomorrow = addDays(rotation.today, 1);
    if (tomorrow.slice(0, 7) === rotation.today.slice(0, 7)) {
      const row = calendarPage.dayListItem(dayMonth(tomorrow));
      await expect(row).toContainText(expectedType(rotation, tomorrow));
      await expect(calendarPage.drawnText(row, '19:00–07:00')).toBeVisible();
    }

    // One tap to the compressed grid: one letter per team and per cell.
    await sve.click();
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(sve).toHaveAttribute('aria-pressed', 'true');
    const header = calendarPage.columnHeader(fixture.team.name);
    await expect(calendarPage.letterOf(header)).toBeVisible();
    expectLetterOf(await calendarPage.letterOf(header).innerText(), fixture.team.name.split(' ').at(-1) ?? '');
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    const letter = calendarPage.letterOf(cell);
    await expect(letter).toBeVisible();
    expectLetterOf(await letter.innerText(), expectedType(rotation, rotation.today));
    // The full name is not drawn below 640 px: the gridcell's label names it.
    await expect(calendarPage.drawnText(cell, expectedType(rotation, rotation.today))).toBeHidden();
    await expect(cell).toHaveAccessibleName(new RegExp(`, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}(,|$)`));

    // The compressed cells and the switch are touch targets.
    for (const target of [calendarPage.targetOf(cell), moj, sve]) {
      const box = await target.boundingBox();
      expect(box, 'a target has no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
      expect(box!.height).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
    }
    await expectTouchTargets(page);

    // `prikaz` survives next, and the switch back keeps the month.
    const next = firstOfNextMonth(rotation.today);
    await calendarPage.nextButton.click();
    await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`mjesec=${next.slice(0, 7)}`));
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(calendarPage.anyGrid).toBeVisible();
    await moj.click();
    await expect(page).toHaveURL(/prikaz=moj/);
    await expect(page).toHaveURL(new RegExp(`mjesec=${next.slice(0, 7)}`));
    await expect(calendarPage.dayListItems.first()).toContainText(expectedType(rotation, next));
    await calendarPage.previousButton.click();
    await expect(page).toHaveURL(/prikaz=moj/);
    await expect(calendarPage.dayList).toBeVisible();

    // One read, filtered to the viewer's own member row, naming nobody.
    await page.waitForLoadState('networkidle');
    expect(reads, 'the calendar read more than once').toHaveLength(1);
    const read = reads[0] ?? '';
    expect(read).toMatch(/members\.auth_user_id=eq\.[0-9a-f-]{36}/);
    const select = new URL(read).searchParams.get('select') ?? '';
    expect(select).toContain('members(organization_id,id,role,team_membership_versions(');
    // Story 3.4a: the organization's rank setting and the positions of the
    // organization-level membership versions are read (shown by 3.4b, never
    // used); no member's rank or name ever comes through the select.
    expect(select).toContain('team_membership_versions(organization_id,member_id,team_id,position,effective_from)');
    expect(select).toContain('member_status_versions(organization_id,member_id,active,effective_from)');
    const unexpected = select
      .replace('uses_fire_ranks', '')
      .replace('team_membership_versions(organization_id,member_id,team_id,position,effective_from)', '');
    expect(unexpected).not.toMatch(/position\b(?!,shift_type_id)|rank|created_by|auth_user_id|members\([^)]*name/);
  });
});

test.describe('on a phone, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('lands on the compressed grid', async ({ calendarPage, fixture }) => {
    await calendarPage.goto();
    const { moj, sve } = calendarPage.modes();
    await expect(sve).toHaveAttribute('aria-pressed', 'true');
    await expect(moj).toHaveAttribute('aria-pressed', 'false');
    const header = calendarPage.columnHeader(fixture.team.name);
    await expect(calendarPage.letterOf(header)).toBeVisible();
    await expect(calendarPage.dayList).toHaveCount(0);
  });
});

test.describe('on a phone, as the member on no team', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('reads the notice, never an empty list', async ({ page, calendarPage, loginPage, fixture }) => {
    await loginPage.signIn(fixture.slug, fixture.spare.username, fixture.password);
    await calendarPage.goto();

    await expect(calendarPage.noTeamNotice).toBeVisible();
    await expect(calendarPage.modes().moj).toHaveAttribute('aria-pressed', 'true');
    await expect(calendarPage.dayList).toHaveCount(0);
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

for (const [width, height, name] of [
  [1280, 800, 'the full grid at 1280 px'],
  [390, 844, 'the compressed grid at 390 px'],
] as const) {
  test.describe(`the keyboard grid: ${name}`, () => {
    test.use({ storageState: ADMIN_STATE, viewport: { width, height } });

    test('one tab stop on today, the keys move focus, and every cell is named in full', async ({ page, calendarPage, fixture }) => {
      const rotation = await seeded(fixture.slug, fixture.team.id);

      await calendarPage.goto('?prikaz=sve');
      const grid = calendarPage.grid;
      const today = await calendarPage.cellOf(fixture.team.name, rotation.today);
      await expect(grid).toBeVisible();
      await expect(grid).toHaveAttribute('aria-readonly', 'true');

      // A gridcell's name holds the date, the team, the type and the range —
      // the same at every width, and never a bare letter.
      await expect(today).toHaveAccessibleName(
        `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, 07:00–19:00`,
      );

      // No override is seeded here, so no mark is on screen and there is no
      // legend: no list, no tooltip, no icon.
      await expect(calendarPage.legendOf().heading).toHaveCount(0);

      // Exactly one tab stop, on today's first team.
      const stops = calendarPage.tabStops;
      await expect(stops).toHaveCount(1);
      await expect(calendarPage.todayFirstCell).toHaveAttribute('tabindex', '0');
      const rows = await calendarPage.rowCount();
      const columns = await calendarPage.columnCount();
      const cells = calendarPage.cells;
      await expect(cells).toHaveCount(rows * columns);

      // Tab enters the grid on that one cell, and a second Tab leaves it. The
      // control before the grid is the team filter (story 3.3a), under the switch.
      await calendarPage.teamFilter.focus();
      await page.keyboard.press('Tab');
      await expect(calendarPage.todayFirstCell).toBeFocused();
      const start = await calendarPage.focusedCell();
      expect(start?.column).toBe(0);
      expect(await calendarPage.focusIsVisible(), 'no visible focus').toBe(true);
      await page.keyboard.press('Tab');
      expect(await calendarPage.focusedCell(), 'a second Tab stayed in the grid').toBeNull();
      await page.keyboard.press('Shift+Tab');
      expect(await calendarPage.focusedCell()).toEqual(start);
      // Space on a cell opens its detail and never scrolls, near the top
      // where the page could still scroll (story 3.4b); Escape comes back.
      await page.keyboard.press('Control+Home');
      const first = calendarPage.cellAt({ row: 0, column: 0 });
      const origin = () => first.evaluate((element) => element.getBoundingClientRect().top);
      const before = await origin();
      await page.keyboard.press('Space');
      await expect(calendarPage.dialog()).toBeVisible();
      expect(await origin(), 'Space scrolled the page').toBe(before);
      await page.keyboard.press('Escape');
      await expect(calendarPage.dialog()).toHaveCount(0);
      expect(await calendarPage.focusedCell()).toEqual({ row: 0, column: 0 });

      const lastRow = rows - 1;
      const lastColumn = columns - 1;
      for (const [key, expected] of [
        ['Control+Home', { row: 0, column: 0 }],
        ['ArrowLeft', { row: 0, column: 0 }],
        ['ArrowUp', { row: 0, column: 0 }],
        ['ArrowDown', { row: 1, column: 0 }],
        ['End', { row: 1, column: lastColumn }],
        ['ArrowRight', { row: 1, column: lastColumn }],
        ['Home', { row: 1, column: 0 }],
        ['ArrowRight', { row: 1, column: Math.min(1, lastColumn) }],
        ['ArrowLeft', { row: 1, column: 0 }],
        ['Control+End', { row: lastRow, column: lastColumn }],
        ['ArrowDown', { row: lastRow, column: lastColumn }],
        ['ArrowUp', { row: lastRow - 1, column: lastColumn }],
      ] as const) {
        await page.keyboard.press(key);
        expect(await calendarPage.focusedCell(), key).toEqual(expected);
        // The roving tab stop follows focus: still exactly one.
        await expect(stops).toHaveCount(1);
      }
      const here = { row: lastRow - 1, column: lastColumn };
      // Enter and Space open the focused cell's detail (story 3.4b): the URL
      // stays, Space never scrolls the page, and Escape returns focus.
      const url = page.url();
      const focused = calendarPage.cellAt(here);
      // Where the focused cell sits on screen: any scroller moving would move it.
      const top = () => focused.evaluate((element) => element.getBoundingClientRect().top);
      const scrolled = await top();
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key);
        await expect(calendarPage.dialog(), key).toBeVisible();
        expect(await top(), `${key} scrolled the page`).toBe(scrolled);
        await page.keyboard.press('Escape');
        await expect(calendarPage.dialog(), key).toHaveCount(0);
        expect(await calendarPage.focusedCell(), key).toEqual(here);
      }
      expect(page.url()).toBe(url);
      // With Shift, Alt or Meta held, or Ctrl with an arrow, the key is the browser's: focus stays.
      // Last, since the browser may scroll the page for some of them.
      for (const key of ['Shift+ArrowUp', 'Alt+ArrowLeft', 'Meta+ArrowUp', 'Control+ArrowUp', 'Shift+Home']) {
        await page.keyboard.press(key);
        expect(await calendarPage.focusedCell(), key).toEqual(here);
      }

      // The tab stop resets when the month changes, and coming back starts on today again.
      await calendarPage.nextButton.click();
      await expect(calendarPage.monthHeading(monthHeading(firstOfNextMonth(rotation.today)))).toBeVisible();
      await expect(stops).toHaveCount(1);
      await expect(stops).toHaveAttribute('data-row', '0');
      await expect(stops).toHaveAttribute('data-column', '0');
      await calendarPage.previousButton.click();
      await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
      await expect(stops).toHaveCount(1);
      await expect(calendarPage.todayFirstCell).toHaveAttribute('tabindex', '0');
      await expect(stops).toHaveAttribute('data-column', '0');

      await expectNoHorizontalScroll(page);
    });
  });
}

/** `/kalendar`'s search for the grid on the month `date` falls in. */
function gridMonthOf(date: string): string {
  return `?prikaz=sve&mjesec=${date.slice(0, 7)}`;
}

/** The range the seeded pattern shows on `date`, from the times seeded; `null` on a non-working day. */
function expectedRange(rotation: SeededRotation, date: string): string | null {
  const days = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${rotation.today}T12:00:00Z`)) / 86_400_000,
  );

  return rotation.ranges[((days % 4) + 4) % 4] ?? null;
}

test.describe('the day detail at 1280 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('a working cell shows the type, both times and the roster; Escape closes it and focus returns', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).toHaveAttribute('aria-haspopup', 'dialog');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(expectedType(rotation, rotation.today));
    await expect(detail).toContainText(range);
    await expect(calendarPage.rosterHeadingIn(detail)).toBeVisible();
    // The rank test below may have ranks on: the line starts with her name.
    await expect(calendarPage.rosterLinesIn(detail)).toHaveCount(1);
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);
    // Toni is on no team, and the admin is on none either.
    await expect(detail).not.toContainText(fixture.spare.name);

    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(cell).toBeFocused();

    // The close button closes it too, and focus returns the same way.
    await cell.click();
    await calendarPage.closeIn(calendarPage.detailOf(fixture.team.name, rotation.today)).click();
    await expect(calendarPage.dialog()).toHaveCount(0);
    await expect(cell).toBeFocused();
  });

  test('the roster line reads `Ime · čin · položaj` with ranks on, and the name alone with them off', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    ranksHold = holdFireRanks(fixture.slug);
    await ranksHold.ready;
    const was = await setFireRanks(fixture.slug, true);
    restoreRanks = async () => {
      await setFireRanks(fixture.slug, was);
    };
    const before = await setRankAndPosition(fixture.slug, fixture.member.name, fixture.team.id, {
      fireRank: 'nco',
      position: 'driver',
    });
    restoreMember = async () => {
      await setRankAndPosition(fixture.slug, fixture.member.name, fixture.team.id, before);
    };

    const line = () => calendarPage.rosterLinesIn(calendarPage.detailOf(fixture.team.name, rotation.today));

    await calendarPage.goto(gridMonthOf(rotation.today));
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    await expect(line()).toHaveText(
      fill(hr.smjene.roster.withRankAndPosition, {
        name: fixture.member.name,
        rank: hr.ljudi.rank.nco,
        position: hr.smjene.position.driver,
      }),
    );

    await setFireRanks(fixture.slug, false);
    await page.reload();
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    await expect(line()).toHaveText(fixture.member.name);
  });

  test('a day before the rotation shows the no-rotation text and no roster', async ({ calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // The seeded rotation starts today, so yesterday has none.
    const yesterday = addDays(rotation.today, -1);

    await calendarPage.goto(gridMonthOf(yesterday));
    await (await calendarPage.cellOf(fixture.team.name, yesterday)).click();
    const detail = calendarPage.detailOf(fixture.team.name, yesterday);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fill(kalendar.detail.noRotation, { team: fixture.team.name }));
    await expect(detail).not.toContainText(fixture.member.name);
    await expect(calendarPage.listsIn(detail)).toHaveCount(0);
  });

  test('an off-day cell says the team does not work, with no roster', async ({ calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Dan, Noć, Slobodno, Slobodno from today: the day after tomorrow is off.
    const off = addDays(rotation.today, 2);
    expect(expectedRange(rotation, off)).toBeNull();

    await calendarPage.goto(gridMonthOf(off));
    await (await calendarPage.cellOf(fixture.team.name, off)).click();
    const detail = calendarPage.detailOf(fixture.team.name, off);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fill(kalendar.detail.off, { team: fixture.team.name }));
    await expect(detail).not.toContainText(fixture.member.name);
    await expect(calendarPage.listsIn(detail)).toHaveCount(0);
  });

  test('browser Back while the detail is open closes it, and it does not reopen', async ({ page, calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const next = firstOfNextMonth(rotation.today);

    await calendarPage.goto(gridMonthOf(rotation.today));
    await calendarPage.goto(gridMonthOf(next));
    await (await calendarPage.cellOf(fixture.team.name, next)).click();
    await expect(calendarPage.detailOf(fixture.team.name, next)).toBeVisible();
    await page.goBack();
    await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    await expect(calendarPage.dialog()).toHaveCount(0);
    await page.goForward();
    await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
    await expect(calendarPage.dialog()).toHaveCount(0);
  });
});

test.describe('the day detail at 390 px, as a member in Moj raspored', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tapping today's day opens the detail naming her", async ({ page, calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');

    await calendarPage.goto();
    const today = calendarPage.today;
    await expect(today).toContainText(expectedType(rotation, rotation.today));
    const opener = calendarPage.openerIn(today);
    // Named in full, as the grid's cell is, and announcing its Dialog.
    await expect(opener).toHaveAccessibleName(
      `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, ${range}`,
    );
    await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
    await opener.tap();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(expectedType(rotation, rotation.today));
    await expect(calendarPage.itemsIn(detail)).toContainText(fixture.member.name);
    await expectNoHorizontalScroll(page);

    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

const REASON = 'Zamjena zbog vježbe (E2E).';

test.describe('a shift-type override at 1280 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('marks the cell with ✎ and the legend, and the detail names the projected type, author, time and reason', async ({
    calendarPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Today projects the first step (Dan); the team worked the second (Noć).
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 1, REASON);
    const projected = expectedType(rotation, rotation.today);
    expect(projected).not.toBe(override.typeName);

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    // The mark is on the cell itself, without opening anything.
    await expect(cell).toContainText(override.typeName);
    await expect(cell).toContainText('\u270E');
    await expect(cell).toHaveAccessibleName(
      `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${override.typeName}, 19:00–07:00, ${kalendar.modifier.overridden}`,
    );
    // Only the overridden cell carries it: a neighbour in the same month —
    // yesterday, or tomorrow on the 1st — is unmarked.
    const yesterday = addDays(rotation.today, -1);
    const neighbour = yesterday.slice(0, 7) === rotation.today.slice(0, 7) ? yesterday : addDays(rotation.today, 1);
    await expect(await calendarPage.cellOf(fixture.team.name, neighbour)).not.toContainText('\u270E');
    // The persistent legend, never a tooltip.
    const legend = calendarPage.legendOf();
    await expect(legend.heading).toBeVisible();
    await expect(legend.items).toHaveText([`\u270E${kalendar.modifier.overridden}`]);

    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    // The kind, the type and the range follow the type worked.
    await expect(detail).toContainText('19:00–07:00');
    await expect(calendarPage.rosterIn(detail)).toContainText(
      fixture.member.name,
    );
    const block = calendarPage.overrideIn(detail);
    await expect(block).toBeVisible();
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: projected }));
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(
      fill(kalendar.detail.override.savedAt, { date: override.savedDate, time: override.savedTime }),
    );
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
  });

  test('a working day made an off one: the off text, no roster, and the block naming the projected type', async ({
    calendarPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Today projects the first step (Dan); the team was off (Slobodno).
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 2, REASON);
    const projected = expectedType(rotation, rotation.today);
    expect(expectedRange(rotation, rotation.today), 'today is not a working day').not.toBeNull();

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).toContainText(override.typeName);
    await expect(cell).toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fill(kalendar.detail.off, { team: fixture.team.name }));
    await expect(calendarPage.rosterIn(detail)).toHaveCount(0);
    const block = calendarPage.overrideIn(detail);
    await expect(block).toBeVisible();
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: projected }));
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
  });
});

test.describe('a shift-type override at 390 px, as a member in Moj raspored', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('marks the day with ✎ and the legend, and the detail names the change', async ({ page, calendarPage, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 1, REASON);

    await calendarPage.goto();
    const today = calendarPage.today;
    await expect(today).toContainText(override.typeName);
    await expect(today).toContainText('\u270E');
    const legend = calendarPage.legendOf();
    await expect(legend.heading).toBeVisible();
    await expect(legend.items).toHaveText([`\u270E${kalendar.modifier.overridden}`]);
    await expectNoHorizontalScroll(page);

    await calendarPage.openerIn(today).tap();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const block = calendarPage.overrideIn(detail);
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: expectedType(rotation, rotation.today) }));
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(
      fill(kalendar.detail.override.savedAt, { date: override.savedDate, time: override.savedTime }),
    );
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
    await expectNoHorizontalScroll(page);
  });
});

/** A search parameter's value, matched whole: `name=value` followed by `&` or the end. */
function searchParamPattern(name: string, value: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`[?&]${escape(name)}=${escape(value)}(&|$)`);
}

/** Any value of a search parameter. */
function anySearchParamPattern(name: string): RegExp {
  return new RegExp(`[?&]${name}=`);
}

/** The grid's one tab stop is on today's row, column 0. */
async function expectTabStopOnToday(calendarPage: CalendarPage): Promise<void> {
  const stops = calendarPage.tabStops;
  await expect(stops).toHaveCount(1);
  await expect(calendarPage.todayFirstCell).toHaveAttribute('tabindex', '0');
  await expect(stops).toHaveAttribute('data-column', '0');
}

test.describe('the team filter at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('narrows the grid to one team, keeps it across months, and resets in one press', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    // The run organization may hold teams other specs created: count, never assume.
    const columns = await calendarPage.columnCount();
    expect(columns).toBeGreaterThan(0);
    const team = searchParamPattern('smjena', fixture.team.id);

    const select = calendarPage.teamFilter;
    await expect(select).toBeVisible();
    await expect(calendarPage.allTeamsOption).toHaveText(fill(kalendar.filter.all, { count: String(columns) }));
    await expect(select).toHaveValue('');
    const grouped = calendarPage.teamOptions;
    await expect(grouped).toHaveCount(columns);
    await expect(grouped.filter({ hasText: fixture.team.name })).toHaveCount(1);
    const reset = calendarPage.resetButton;
    await expect(reset).toHaveCount(0);

    // Choosing a team narrows the grid and resets the tab stop to today.
    await calendarPage.moveTabStopOffToday();
    await select.selectOption(fixture.team.id);
    await expect(page).toHaveURL(team);
    await expect(calendarPage.headerCells).toHaveCount(2);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    await expect(select).toHaveValue(fixture.team.id);
    await expect(reset).toBeVisible();
    await expectTabStopOnToday(calendarPage);

    // One press brings every column back, on /kalendar, the reset goes, focus
    // lands on the filter rather than <body>, and the tab stop is on today.
    await calendarPage.moveTabStopOffToday();
    await reset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(/\/kalendar(\?|$)/);
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(select).toHaveValue('');
    await expect(reset).toHaveCount(0);
    await expect(select).toBeFocused();
    await expectTabStopOnToday(calendarPage);

    // The next month keeps the team: the heading moves, the filter stays.
    await select.selectOption(fixture.team.id);
    await expect(page).toHaveURL(team);
    const heading = calendarPage.monthHeading();
    const thisMonth = (await heading.innerText()).trim();
    await calendarPage.nextButton.click();
    await expect(heading).not.toHaveText(thisMonth);
    await expect(page).toHaveURL(anySearchParamPattern('mjesec'));
    await expect(page).toHaveURL(team);
    await expect(calendarPage.headerCells).toHaveCount(2);
    await expect(select).toHaveValue(fixture.team.id);

    // A reset there drops the team and keeps the month.
    const mjesec = new URL(page.url()).searchParams.get('mjesec') ?? '';
    expect(mjesec).toMatch(/^\d{4}-\d{2}$/);
    await reset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(searchParamPattern('mjesec', mjesec));
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(select).toBeFocused();
  });

  test('an unknown team id shows every column, reads as all teams, and offers no reset', async ({ page, calendarPage, fixture }) => {
    const unknown = randomUUID();
    await calendarPage.goto(`?smjena=${unknown}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const select = calendarPage.teamFilter;
    await expect(select).toHaveValue('');
    const columns = await calendarPage.columnCount();
    await expect(calendarPage.teamOptions).toHaveCount(columns);
    await expect(calendarPage.allTeamsOption).toHaveText(fill(kalendar.filter.all, { count: String(columns) }));
    await expect(calendarPage.resetButton).toHaveCount(0);
    // Silently ignored, and left in the URL.
    await expect(page).toHaveURL(searchParamPattern('smjena', unknown));
  });

  test('Moj raspored ignores the team, shows no filter, and keeps it in the URL', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto(`?prikaz=moj&smjena=${fixture.team.id}`);
    await expect(calendarPage.modes().moj).toHaveAttribute('aria-pressed', 'true');
    await expect(calendarPage.monthHeading(/\d{4}$/)).toBeVisible();
    await expect(calendarPage.teamFilter).toHaveCount(0);
    await expect(calendarPage.resetButton).toHaveCount(0);
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
  });
});

test.describe('the person filter at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test("shows one person's day list in place of the grid, kept across months and cleared by a team or the reset", async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const columns = await calendarPage.columnCount();
    const select = calendarPage.teamFilter;
    const reset = calendarPage.resetButton;

    // The Osobe group follows the teams and lists the fixture's people.
    await expect(calendarPage.filterGroups).toHaveCount(2);
    await expect(calendarPage.filterGroups.nth(1)).toHaveAttribute('label', kalendar.filter.people);
    for (const person of [fixture.admin, fixture.member, fixture.spare]) {
      await expect(calendarPage.peopleOptions.filter({ hasText: person.name }), person.name).toHaveCount(1);
    }

    // Choosing her shows her day list headed with her name, and no grid.
    await select.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    const osoba = new URL(page.url()).searchParams.get('osoba') ?? '';
    expect(osoba).not.toBe('');
    await expect(calendarPage.personHeading(fixture.member.name)).toBeVisible();
    const list = calendarPage.personListOf(fixture.member.name);
    await expect(list).toBeVisible();
    await expect(list).toHaveAccessibleName(
      `${fixture.member.name} ${(await calendarPage.monthHeading().innerText()).trim()}`,
    );
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expect(select).toHaveValue(`osoba:${osoba}`);
    await expect(reset).toBeVisible();

    // The next month keeps her.
    const heading = calendarPage.monthHeading();
    const thisMonth = (await heading.innerText()).trim();
    await calendarPage.nextButton.click();
    await expect(heading).not.toHaveText(thisMonth);
    await expect(page).toHaveURL(anySearchParamPattern('mjesec'));
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
    await expect(calendarPage.personListOf(fixture.member.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);

    // Choosing a team drops her: the grid narrowed to that team.
    await select.selectOption(fixture.team.id);
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
    await expect(calendarPage.headerCells).toHaveCount(2);

    // Back to her, then the reset returns the whole grid and keeps the month.
    await select.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    const mjesec = new URL(page.url()).searchParams.get('mjesec') ?? '';
    await reset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(searchParamPattern('mjesec', mjesec));
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(select).toHaveValue('');
    await expect(reset).toHaveCount(0);
    await expect(select).toBeFocused();
  });

  test('forgets the grid tab stop when a person is chosen and reset', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const select = calendarPage.teamFilter;

    await calendarPage.moveTabStopOffToday();
    await select.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await calendarPage.resetButton.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expectTabStopOnToday(calendarPage);
  });

  test('a person on no team all month is explained, never an empty list', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    const select = calendarPage.teamFilter;
    await expect(calendarPage.peopleOptions.filter({ hasText: fixture.spare.name })).toHaveCount(1);

    await select.selectOption({ label: fixture.spare.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.personHeading(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.personNoTeam(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.personListOf(fixture.spare.name)).toHaveCount(0);
    await expect(calendarPage.anyGrid).toHaveCount(0);
  });

  test('an unknown person id is ignored: the grid, and no reset', async ({ page, calendarPage, fixture }) => {
    const unknown = randomUUID();
    await calendarPage.goto(`?osoba=${unknown}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    await expect(calendarPage.teamFilter).toHaveValue('');
    await expect(calendarPage.resetButton).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('osoba', unknown));
  });
});

test.describe('the person filter in Moj raspored', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('Moj raspored ignores the person, shows no filter, and keeps it in the URL', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    const value = await calendarPage.peopleOptions.filter({ hasText: fixture.member.name }).getAttribute('value');
    const osoba = (value ?? '').replace(/^osoba:/, '');
    expect(osoba).not.toBe('');

    await calendarPage.goto(`?prikaz=moj&osoba=${osoba}`);
    await expect(calendarPage.modes().moj).toHaveAttribute('aria-pressed', 'true');
    await expect(calendarPage.monthHeading(/\d{4}$/)).toBeVisible();
    await expect(calendarPage.teamFilter).toHaveCount(0);
    await expect(calendarPage.personHeading(fixture.member.name, { exact: false })).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
  });
});

test.describe('the person filter for a member-role account', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 1280, height: 800 } });

  test('lists the colleagues under Osobe', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.teamFilter).toBeVisible();
    for (const person of [fixture.admin, fixture.member, fixture.spare]) {
      await expect(calendarPage.peopleOptions.filter({ hasText: person.name }), person.name).toHaveCount(1);
    }
    // Every option is a name and nothing else: no address, no username.
    for (const text of await calendarPage.peopleOptions.allInnerTexts()) {
      expect(text).not.toMatch(/@|e2e\./);
    }

    // A colleague's month — the reading `calendar_members()` exists for.
    const select = calendarPage.teamFilter;
    await select.selectOption({ label: fixture.admin.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.personHeading(fixture.admin.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);

    await select.selectOption({ label: fixture.spare.name });
    await expect(calendarPage.personHeading(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.personNoTeam(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);
  });
});

test.describe('the team filter at 320 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 320, height: 720 } });

  test('never scrolls the page sideways, and the select and the reset are touch targets', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto(`?prikaz=sve&smjena=${fixture.team.id}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const select = calendarPage.teamFilter;
    const reset = calendarPage.resetButton;
    await expect(select).toHaveValue(fixture.team.id);
    await expect(reset).toBeVisible();

    for (const target of [select, reset]) {
      const box = await target.boundingBox();
      expect(box, 'a target has no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
      expect(box!.height).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
    }
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});
