import { randomBytes, randomUUID } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

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
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { MINIMUM_TARGET, expectNoHorizontalScroll, expectTouchTargets } from '../../utils/layout.ts';
import { signIn } from '../../utils/sign-in.ts';
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

/** `05.10.` — a date as its row header starts. */
function dayMonth(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

/** `subota` — a date's weekday, as its row header and its cells' labels name it. */
function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat('hr', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
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

/** The calendar grid, named by the month heading. */
function gridOf(page: Page): Locator {
  return page.getByRole('grid', { name: /\d{4}$/ });
}

/** The grid's cell for `teamName` on `date`. */
async function cellOf(page: Page, teamName: string, date: string): Promise<Locator> {
  const grid = gridOf(page);
  // The grid renders once the snapshot has landed; the skeleton has no headers.
  await expect(grid.getByRole('columnheader', { name: teamName, exact: true })).toBeVisible();
  // The header's text without its compressed letter, which is `aria-hidden`.
  const heads = await grid.getByRole('columnheader').evaluateAll((elements) =>
    elements.map((element) => {
      const copy = element.cloneNode(true) as Element;
      for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();

      return copy.textContent ?? '';
    }),
  );
  const column = heads.indexOf(teamName);
  expect(column, `the grid has no column for ${teamName}: ${heads.join(', ')}`).toBeGreaterThan(0);
  const escaped = dayMonth(date).replace(/\./g, '\\.');
  const row = grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${escaped}`) }) });
  await expect(row, `the grid has no row for ${date}`).toHaveCount(1);

  // The first column is the row header; the cells follow it.
  return row.getByRole('gridcell').nth(column - 1);
}

for (const [role, storageState] of [
  ['an admin', ADMIN_STATE],
  ['a member', MEMBER_STATE],
] as const) {
  test.describe(`as ${role}`, () => {
    test.use({ storageState });

    test('the month shows the team column and the projected types, today marked', async ({ page, fixture }) => {
      const rotation = await seeded(fixture.slug, fixture.team.id);

      await page.goto('/kalendar');
      await expect(page.getByRole('heading', { level: 1, name: hr.nav.kalendar })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: monthHeading(rotation.today) })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();

      const today = page.locator('tr[aria-current="date"]');
      await expect(today).toHaveCount(1);
      await expect(today.getByRole('rowheader')).toContainText(dayMonth(rotation.today));

      const first = await cellOf(page, fixture.team.name, rotation.today);
      await expect(first).toContainText(expectedType(rotation, rotation.today));
      // From 640 px up the full names are DRAWN, not merely read out: the
      // `sm:not-sr-only` spans have a real box.
      for (const drawn of [
        page.getByRole('columnheader', { name: fixture.team.name, exact: true }).getByText(fixture.team.name, { exact: true }),
        first.getByText(expectedType(rotation, rotation.today), { exact: true }),
      ]) {
        const box = await drawn.boundingBox();
        expect(box, 'a full name has no box').not.toBeNull();
        expect(box!.width).toBeGreaterThan(1);
        expect(box!.height).toBeGreaterThan(1);
      }
      // Desktop: the range is shown beside the name — visible, not merely in the DOM.
      await expect(first.getByText('07:00–19:00', { exact: true })).toBeVisible();

      // The next month, through the URL: every date projected from today.
      const next = firstOfNextMonth(rotation.today);
      await page.goto(`/kalendar?mjesec=${next.slice(0, 7)}`);
      await expect(page.getByRole('heading', { level: 2, name: monthHeading(next) })).toBeVisible();
      for (const offset of [0, 1, 2, 3]) {
        const date = addDays(next, offset);
        await expect(await cellOf(page, fixture.team.name, date), date).toContainText(expectedType(rotation, date));
      }
      // A crossing shift is shown once, with both clock times.
      const night = [0, 1, 2, 3].map((offset) => addDays(next, offset)).find(
        (date) => expectedType(rotation, date) === rotation.steps[1],
      );
      if (night === undefined) throw new Error('E2E: no night in four days');
      await expect((await cellOf(page, fixture.team.name, night)).getByText('19:00–07:00', { exact: true })).toBeVisible();
    });
  });
}

test.describe('month navigation', () => {
  test.use({ storageState: ADMIN_STATE });

  test('next, next, previous change the month without reading again', async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await page.goto('/kalendar');
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(rotation.today) })).toBeVisible();
    await expect(await cellOf(page, fixture.team.name, rotation.today)).toContainText(
      expectedType(rotation, rotation.today),
    );

    const reads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/organizations')) reads.push(request.url());
    });

    const next = firstOfNextMonth(rotation.today);
    const afterNext = firstOfNextMonth(next);

    await page.getByRole('button', { name: kalendar.next }).click();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(next) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`mjesec=${next.slice(0, 7)}`));
    await page.getByRole('button', { name: kalendar.next }).click();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(afterNext) })).toBeVisible();
    await expect(await cellOf(page, fixture.team.name, afterNext)).toContainText(expectedType(rotation, afterNext));
    await page.getByRole('button', { name: kalendar.previous }).click();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(next) })).toBeVisible();
    await expect(await cellOf(page, fixture.team.name, next)).toContainText(expectedType(rotation, next));

    await page.getByRole('button', { name: kalendar.current, exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(rotation.today) })).toBeVisible();
    // On the current month, `Ovaj mjesec` has nowhere to go.
    await expect(page.getByRole('button', { name: kalendar.current, exact: true })).toBeDisabled();

    // Whatever a navigation might have fetched has landed before the count is read.
    await page.waitForLoadState('networkidle');
    expect(reads, 'moving between months read the snapshot again').toEqual([]);
  });

  test('the bounds disable only the button that would leave the calendar', async ({ page }) => {
    await page.goto('/kalendar?mjesec=9999-12');
    await expect(page.getByRole('button', { name: kalendar.next })).toBeDisabled();
    await expect(page.getByRole('button', { name: kalendar.previous })).toBeEnabled();

    await page.goto('/kalendar?mjesec=0001-01');
    await expect(page.getByRole('button', { name: kalendar.previous })).toBeDisabled();
    await expect(page.getByRole('button', { name: kalendar.next })).toBeEnabled();
  });
});

test.describe('edge months and a failed read', () => {
  test.use({ storageState: MEMBER_STATE });

  test('a month before any rotation shows the mark, named for a screen reader', async ({ page, fixture }) => {
    await page.goto('/kalendar?mjesec=0001-01');
    const cell = await cellOf(page, fixture.team.name, '0001-01-01');

    await expect(cell).toContainText('\u2014');
    // The mark is drawn; the gridcell's own label names it.
    await expect(cell).toHaveAccessibleName(`${weekdayOf('0001-01-01')} 01.01., ${fixture.team.name}, ${kalendar.noRotation}`);
  });

  test('a read that fails shows the alert and no grid', async ({ page }) => {
    // A refused answer rather than an aborted socket: the client retries a
    // network failure on its own schedule, and the point here is the screen.
    await page.route('**/rest/v1/organizations*', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"refused"}' }),
    );
    await page.goto('/kalendar');

    await expect(page.getByRole('alert').filter({ hasText: kalendar.error.unavailable })).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
  });
});

test.describe('at 320 px', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 320, height: 720 } });

  test('the page never scrolls sideways in either mode, and the buttons are touch targets', async ({
    page,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await page.goto('/kalendar');
    await expect(dayList(page).locator('li[aria-current="date"]')).toContainText(
      expectedType(rotation, rotation.today),
    );
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);

    await page.goto('/kalendar?prikaz=sve');
    const cell = await cellOf(page, fixture.team.name, rotation.today);
    await expect(cell).toContainText(expectedType(rotation, rotation.today));
    // Below 1024 px the range is not shown — dropped, never abbreviated.
    await expect(cell.getByText('07:00–19:00')).toBeHidden();

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});

/** *Moj raspored*: the day list, named by the month heading. */
function dayList(page: Page): Locator {
  return page.getByRole('list', { name: /\d{4}$/ });
}

/** The mode switch's two buttons. */
function modes(page: Page): { readonly moj: Locator; readonly sve: Locator } {
  const group = page.getByRole('group', { name: kalendar.mode.label });

  return {
    moj: group.getByRole('button', { name: kalendar.mode.moj, exact: true }),
    sve: group.getByRole('button', { name: kalendar.mode.sve, exact: true }),
  };
}

/** The drawn, `aria-hidden` letter of a compressed header or cell. */
function letterOf(locator: Locator): Locator {
  return locator.locator('[aria-hidden="true"]').first();
}

/** Whether `letter` is the start of `word`, uppercased, and shorter than it: a compressed label. */
function expectLetterOf(letter: string, word: string): void {
  expect(letter.length, `${letter} is not a short label of ${word}`).toBeGreaterThan(0);
  expect(word.toLocaleUpperCase('hr').startsWith(letter), `${letter} does not start ${word}`).toBe(true);
}

test.describe('on a phone, as a member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 } });

  test('lands on Moj raspored with the seeded types, and the switch shows the letters', async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    const reads: string[] = [];
    page.on('request', (request) => {
      const url = decodeURIComponent(request.url());
      if (url.includes('/rest/v1/organizations') && url.includes('rotation_assignments')) reads.push(url);
    });

    await page.goto('/kalendar');
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(rotation.today) })).toBeVisible();
    const { moj, sve } = modes(page);
    await expect(moj).toHaveAttribute('aria-pressed', 'true');
    await expect(sve).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('grid')).toHaveCount(0);

    // A day per date, today marked, each the member's own team's type.
    const list = dayList(page);
    await expect(list.getByRole('listitem')).toHaveCount(
      new Date(Date.UTC(Number(rotation.today.slice(0, 4)), Number(rotation.today.slice(5, 7)), 0)).getUTCDate(),
    );
    const today = list.locator('li[aria-current="date"]');
    await expect(today).toHaveCount(1);
    await expect(today).toContainText(dayMonth(rotation.today));
    await expect(today).toContainText(expectedType(rotation, rotation.today));
    // The day list shows the range of a working type.
    const tomorrow = addDays(rotation.today, 1);
    if (tomorrow.slice(0, 7) === rotation.today.slice(0, 7)) {
      const row = list.getByRole('listitem').filter({ hasText: dayMonth(tomorrow) });
      await expect(row).toContainText(expectedType(rotation, tomorrow));
      await expect(row.getByText('19:00–07:00', { exact: true })).toBeVisible();
    }

    // One tap to the compressed grid: one letter per team and per cell.
    await sve.click();
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(sve).toHaveAttribute('aria-pressed', 'true');
    const header = page.getByRole('columnheader', { name: fixture.team.name, exact: true });
    await expect(letterOf(header)).toBeVisible();
    expectLetterOf(await letterOf(header).innerText(), fixture.team.name.split(' ').at(-1) ?? '');
    const cell = await cellOf(page, fixture.team.name, rotation.today);
    const letter = letterOf(cell);
    await expect(letter).toBeVisible();
    expectLetterOf(await letter.innerText(), expectedType(rotation, rotation.today));
    // The full name is not drawn below 640 px: the gridcell's label names it.
    await expect(cell.getByText(expectedType(rotation, rotation.today), { exact: true })).toBeHidden();
    await expect(cell).toHaveAccessibleName(new RegExp(`, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}(,|$)`));

    // The compressed cells and the switch are touch targets.
    for (const target of [cell.locator('div').first(), moj, sve]) {
      const box = await target.boundingBox();
      expect(box, 'a target has no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
      expect(box!.height).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
    }
    await expectTouchTargets(page);

    // `prikaz` survives next, and the switch back keeps the month.
    const next = firstOfNextMonth(rotation.today);
    await page.getByRole('button', { name: kalendar.next }).click();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(next) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`mjesec=${next.slice(0, 7)}`));
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(page.getByRole('grid')).toBeVisible();
    await moj.click();
    await expect(page).toHaveURL(/prikaz=moj/);
    await expect(page).toHaveURL(new RegExp(`mjesec=${next.slice(0, 7)}`));
    await expect(dayList(page).getByRole('listitem').first()).toContainText(expectedType(rotation, next));
    await page.getByRole('button', { name: kalendar.previous }).click();
    await expect(page).toHaveURL(/prikaz=moj/);
    await expect(dayList(page)).toBeVisible();

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

  test('lands on the compressed grid', async ({ page, fixture }) => {
    await page.goto('/kalendar');
    const { moj, sve } = modes(page);
    await expect(sve).toHaveAttribute('aria-pressed', 'true');
    await expect(moj).toHaveAttribute('aria-pressed', 'false');
    const header = page.getByRole('columnheader', { name: fixture.team.name, exact: true });
    await expect(letterOf(header)).toBeVisible();
    await expect(dayList(page)).toHaveCount(0);
  });
});

test.describe('on a phone, as the member on no team', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('reads the notice, never an empty list', async ({ page, fixture }) => {
    await signIn(page, fixture.slug, fixture.spare.username, fixture.password);
    await page.goto('/kalendar');

    await expect(page.getByText(kalendar.noTeam, { exact: true })).toBeVisible();
    await expect(modes(page).moj).toHaveAttribute('aria-pressed', 'true');
    await expect(dayList(page)).toHaveCount(0);
    await expect(page.getByRole('grid')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});

/** The focused gridcell's position among the data cells, or `null` when focus is not on one. */
async function focusedCell(page: Page): Promise<{ readonly row: number; readonly column: number } | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTableCellElement) || active.getAttribute('role') !== 'gridcell') return null;
    const row = active.parentElement;
    if (!(row instanceof HTMLTableRowElement)) return null;

    // Past the header row and the date column.
    return { row: row.rowIndex - 1, column: active.cellIndex - 1 };
  });
}

for (const [width, height, name] of [
  [1280, 800, 'the full grid at 1280 px'],
  [390, 844, 'the compressed grid at 390 px'],
] as const) {
  test.describe(`the keyboard grid: ${name}`, () => {
    test.use({ storageState: ADMIN_STATE, viewport: { width, height } });

    test('one tab stop on today, the keys move focus, and every cell is named in full', async ({ page, fixture }) => {
      const rotation = await seeded(fixture.slug, fixture.team.id);

      await page.goto('/kalendar?prikaz=sve');
      const grid = gridOf(page);
      const today = await cellOf(page, fixture.team.name, rotation.today);
      await expect(grid).toBeVisible();
      await expect(grid).toHaveAttribute('aria-readonly', 'true');

      // A gridcell's name holds the date, the team, the type and the range —
      // the same at every width, and never a bare letter.
      await expect(today).toHaveAccessibleName(
        `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, 07:00–19:00`,
      );

      // No override is seeded here, so no mark is on screen and there is no
      // legend: no list, no tooltip, no icon.
      await expect(page.getByText(kalendar.legend, { exact: true })).toHaveCount(0);

      // Exactly one tab stop, on today's first team.
      const stops = grid.locator('[role="gridcell"][tabindex="0"]');
      await expect(stops).toHaveCount(1);
      const todayRow = grid.locator('tr[aria-current="date"]');
      await expect(todayRow.getByRole('gridcell').first()).toHaveAttribute('tabindex', '0');
      const rows = await grid.locator('tbody tr').count();
      const columns = await grid.locator('thead th').count() - 1;
      const cells = grid.getByRole('gridcell');
      await expect(cells).toHaveCount(rows * columns);

      // Tab enters the grid on that one cell, and a second Tab leaves it. The
      // control before the grid is the team filter (story 3.3a), under the switch.
      await teamFilterOf(page).focus();
      await page.keyboard.press('Tab');
      await expect(todayRow.getByRole('gridcell').first()).toBeFocused();
      const start = await focusedCell(page);
      expect(start?.column).toBe(0);
      expect(await page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false), 'no visible focus').toBe(true);
      await page.keyboard.press('Tab');
      expect(await focusedCell(page), 'a second Tab stayed in the grid').toBeNull();
      await page.keyboard.press('Shift+Tab');
      expect(await focusedCell(page)).toEqual(start);
      // Space on a cell opens its detail and never scrolls, near the top
      // where the page could still scroll (story 3.4b); Escape comes back.
      await page.keyboard.press('Control+Home');
      const first = grid.locator('[role="gridcell"][data-row="0"][data-column="0"]');
      const origin = () => first.evaluate((element) => element.getBoundingClientRect().top);
      const before = await origin();
      await page.keyboard.press('Space');
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await origin(), 'Space scrolled the page').toBe(before);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await focusedCell(page)).toEqual({ row: 0, column: 0 });

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
        expect(await focusedCell(page), key).toEqual(expected);
        // The roving tab stop follows focus: still exactly one.
        await expect(stops).toHaveCount(1);
      }
      const here = { row: lastRow - 1, column: lastColumn };
      // Enter and Space open the focused cell's detail (story 3.4b): the URL
      // stays, Space never scrolls the page, and Escape returns focus.
      const url = page.url();
      const focused = grid.locator(
        `[role="gridcell"][data-row="${String(here.row)}"][data-column="${String(here.column)}"]`,
      );
      // Where the focused cell sits on screen: any scroller moving would move it.
      const top = () => focused.evaluate((element) => element.getBoundingClientRect().top);
      const scrolled = await top();
      for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key);
        await expect(page.getByRole('dialog'), key).toBeVisible();
        expect(await top(), `${key} scrolled the page`).toBe(scrolled);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog'), key).toHaveCount(0);
        expect(await focusedCell(page), key).toEqual(here);
      }
      expect(page.url()).toBe(url);
      // With Shift, Alt or Meta held, or Ctrl with an arrow, the key is the browser's: focus stays.
      // Last, since the browser may scroll the page for some of them.
      for (const key of ['Shift+ArrowUp', 'Alt+ArrowLeft', 'Meta+ArrowUp', 'Control+ArrowUp', 'Shift+Home']) {
        await page.keyboard.press(key);
        expect(await focusedCell(page), key).toEqual(here);
      }

      // The tab stop resets when the month changes, and coming back starts on today again.
      await page.getByRole('button', { name: kalendar.next }).click();
      await expect(page.getByRole('heading', { level: 2, name: monthHeading(firstOfNextMonth(rotation.today)) })).toBeVisible();
      await expect(stops).toHaveCount(1);
      await expect(stops).toHaveAttribute('data-row', '0');
      await expect(stops).toHaveAttribute('data-column', '0');
      await page.getByRole('button', { name: kalendar.previous }).click();
      await expect(page.getByRole('heading', { level: 2, name: monthHeading(rotation.today) })).toBeVisible();
      await expect(stops).toHaveCount(1);
      await expect(todayRow.getByRole('gridcell').first()).toHaveAttribute('tabindex', '0');
      await expect(stops).toHaveAttribute('data-column', '0');

      await expectNoHorizontalScroll(page);
    });
  });
}

/** `subota 05.10.2026` — a date as the day detail's title names it, year included. */
function detailDate(date: string): string {
  return `${weekdayOf(date)} ${dayMonth(date)}${date.slice(0, 4)}`;
}

/** The day detail's Dialog, named by its title: the team and the date. */
function detailOf(page: Page, teamName: string, date: string): Locator {
  return page.getByRole('dialog', { name: fill(kalendar.detail.title, { team: teamName, date: detailDate(date) }) });
}

/** `/kalendar`'s grid on the month `date` falls in. */
function gridMonthOf(date: string): string {
  return `/kalendar?prikaz=sve&mjesec=${date.slice(0, 7)}`;
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
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');

    await page.goto(gridMonthOf(rotation.today));
    const cell = await cellOf(page, fixture.team.name, rotation.today);
    await expect(cell).toHaveAttribute('aria-haspopup', 'dialog');
    await cell.click();
    const detail = detailOf(page, fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(expectedType(rotation, rotation.today));
    await expect(detail).toContainText(range);
    await expect(detail.getByRole('heading', { name: kalendar.detail.roster, exact: true })).toBeVisible();
    // The rank test below may have ranks on: the line starts with her name.
    const roster = detail.getByRole('list', { name: kalendar.detail.roster, exact: true });
    await expect(roster.getByRole('listitem')).toHaveCount(1);
    await expect(roster.getByRole('listitem')).toContainText(fixture.member.name);
    // Toni is on no team, and the admin is on none either.
    await expect(detail).not.toContainText(fixture.spare.name);

    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(cell).toBeFocused();

    // The close button closes it too, and focus returns the same way.
    await cell.click();
    await detailOf(page, fixture.team.name, rotation.today)
      .getByRole('button', { name: kalendar.detail.close, exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(cell).toBeFocused();
  });

  test('the roster line reads `Ime · čin · položaj` with ranks on, and the name alone with them off', async ({
    page,
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

    const line = (page: Page) =>
      detailOf(page, fixture.team.name, rotation.today)
        .getByRole('list', { name: kalendar.detail.roster, exact: true })
        .getByRole('listitem');

    await page.goto(gridMonthOf(rotation.today));
    await (await cellOf(page, fixture.team.name, rotation.today)).click();
    await expect(line(page)).toHaveText(
      fill(hr.smjene.roster.withRankAndPosition, {
        name: fixture.member.name,
        rank: hr.ljudi.rank.nco,
        position: hr.smjene.position.driver,
      }),
    );

    await setFireRanks(fixture.slug, false);
    await page.reload();
    await (await cellOf(page, fixture.team.name, rotation.today)).click();
    await expect(line(page)).toHaveText(fixture.member.name);
  });

  test('a day before the rotation shows the no-rotation text and no roster', async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // The seeded rotation starts today, so yesterday has none.
    const yesterday = addDays(rotation.today, -1);

    await page.goto(gridMonthOf(yesterday));
    await (await cellOf(page, fixture.team.name, yesterday)).click();
    const detail = detailOf(page, fixture.team.name, yesterday);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fill(kalendar.detail.noRotation, { team: fixture.team.name }));
    await expect(detail).not.toContainText(fixture.member.name);
    await expect(detail.getByRole('list')).toHaveCount(0);
  });

  test('an off-day cell says the team does not work, with no roster', async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Dan, Noć, Slobodno, Slobodno from today: the day after tomorrow is off.
    const off = addDays(rotation.today, 2);
    expect(expectedRange(rotation, off)).toBeNull();

    await page.goto(gridMonthOf(off));
    await (await cellOf(page, fixture.team.name, off)).click();
    const detail = detailOf(page, fixture.team.name, off);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fill(kalendar.detail.off, { team: fixture.team.name }));
    await expect(detail).not.toContainText(fixture.member.name);
    await expect(detail.getByRole('list')).toHaveCount(0);
  });

  test('browser Back while the detail is open closes it, and it does not reopen', async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const next = firstOfNextMonth(rotation.today);

    await page.goto(gridMonthOf(rotation.today));
    await page.goto(gridMonthOf(next));
    await (await cellOf(page, fixture.team.name, next)).click();
    await expect(detailOf(page, fixture.team.name, next)).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(rotation.today) })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole('heading', { level: 2, name: monthHeading(next) })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('the day detail at 390 px, as a member in Moj raspored', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tapping today's day opens the detail naming her", async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');

    await page.goto('/kalendar');
    const today = dayList(page).locator('li[aria-current="date"]');
    await expect(today).toContainText(expectedType(rotation, rotation.today));
    const opener = today.getByRole('button');
    // Named in full, as the grid's cell is, and announcing its Dialog.
    await expect(opener).toHaveAccessibleName(
      `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, ${range}`,
    );
    await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
    await opener.tap();
    const detail = detailOf(page, fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(expectedType(rotation, rotation.today));
    await expect(detail.getByRole('listitem')).toContainText(fixture.member.name);
    await expectNoHorizontalScroll(page);

    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

/** The legend's heading and its overridden entry. */
function legendOf(page: Page): { readonly heading: Locator; readonly list: Locator } {
  return {
    heading: page.getByText(kalendar.legend, { exact: true }),
    list: page.getByRole('list', { name: kalendar.legend, exact: true }),
  };
}

const REASON = 'Zamjena zbog vježbe (E2E).';

test.describe('a shift-type override at 1280 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('marks the cell with ✎ and the legend, and the detail names the projected type, author, time and reason', async ({
    page,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Today projects the first step (Dan); the team worked the second (Noć).
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 1, REASON);
    const projected = expectedType(rotation, rotation.today);
    expect(projected).not.toBe(override.typeName);

    await page.goto(gridMonthOf(rotation.today));
    const cell = await cellOf(page, fixture.team.name, rotation.today);
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
    await expect(await cellOf(page, fixture.team.name, neighbour)).not.toContainText('\u270E');
    // The persistent legend, never a tooltip.
    const legend = legendOf(page);
    await expect(legend.heading).toBeVisible();
    await expect(legend.list.getByRole('listitem')).toHaveText([`\u270E${kalendar.modifier.overridden}`]);

    await cell.click();
    const detail = detailOf(page, fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    // The kind, the type and the range follow the type worked.
    await expect(detail).toContainText('19:00–07:00');
    await expect(detail.getByRole('list', { name: kalendar.detail.roster, exact: true })).toContainText(
      fixture.member.name,
    );
    const block = detail.getByRole('region', { name: kalendar.detail.override.heading });
    await expect(block).toBeVisible();
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: projected }));
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(
      fill(kalendar.detail.override.savedAt, { date: override.savedDate, time: override.savedTime }),
    );
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
  });

  test('a working day made an off one: the off text, no roster, and the block naming the projected type', async ({
    page,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Today projects the first step (Dan); the team was off (Slobodno).
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 2, REASON);
    const projected = expectedType(rotation, rotation.today);
    expect(expectedRange(rotation, rotation.today), 'today is not a working day').not.toBeNull();

    await page.goto(gridMonthOf(rotation.today));
    const cell = await cellOf(page, fixture.team.name, rotation.today);
    await expect(cell).toContainText(override.typeName);
    await expect(cell).toContainText('\u270E');
    await cell.click();
    const detail = detailOf(page, fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fill(kalendar.detail.off, { team: fixture.team.name }));
    await expect(detail.getByRole('list', { name: kalendar.detail.roster, exact: true })).toHaveCount(0);
    const block = detail.getByRole('region', { name: kalendar.detail.override.heading });
    await expect(block).toBeVisible();
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: projected }));
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
  });
});

test.describe('a shift-type override at 390 px, as a member in Moj raspored', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('marks the day with ✎ and the legend, and the detail names the change', async ({ page, fixture }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 1, REASON);

    await page.goto('/kalendar');
    const today = dayList(page).locator('li[aria-current="date"]');
    await expect(today).toContainText(override.typeName);
    await expect(today).toContainText('\u270E');
    const legend = legendOf(page);
    await expect(legend.heading).toBeVisible();
    await expect(legend.list.getByRole('listitem')).toHaveText([`\u270E${kalendar.modifier.overridden}`]);
    await expectNoHorizontalScroll(page);

    await today.getByRole('button').tap();
    const detail = detailOf(page, fixture.team.name, rotation.today);
    const block = detail.getByRole('region', { name: kalendar.detail.override.heading });
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: expectedType(rotation, rotation.today) }));
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(
      fill(kalendar.detail.override.savedAt, { date: override.savedDate, time: override.savedTime }),
    );
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
    await expectNoHorizontalScroll(page);
  });
});

/** The team filter's native select. */
function teamFilterOf(page: Page): Locator {
  return page.getByRole('combobox', { name: kalendar.filter.label, exact: true });
}

/** The grid's team columns: its column headers but the date's. */
async function columnCountOf(page: Page): Promise<number> {
  return (await gridOf(page).locator('thead th').count()) - 1;
}

/** A search parameter's value, matched whole: `name=value` followed by `&` or the end. */
function searchParamPattern(name: string, value: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return new RegExp(`[?&]${escape(name)}=${escape(value)}(&|$)`);
}

/** Any value of a search parameter. */
function anySearchParamPattern(name: string): RegExp {
  return new RegExp(`[?&]${name}=`);
}

/**
 * Moves the grid's tab stop off today's first cell, so a later reset of it is
 * observable: focus that cell, then Ctrl+Home — or Ctrl+End when today is the
 * first row — and check the one tab stop has left it.
 */
async function moveTabStopOffToday(page: Page): Promise<void> {
  const grid = gridOf(page);
  const todayFirst = grid.locator('tr[aria-current="date"]').getByRole('gridcell').first();
  await todayFirst.focus();
  await page.keyboard.press('Control+Home');
  if ((await todayFirst.getAttribute('tabindex')) === '0') await page.keyboard.press('Control+End');
  await expect(todayFirst).toHaveAttribute('tabindex', '-1');
  await expect(grid.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
}

/** The grid's one tab stop is on today's row, column 0. */
async function expectTabStopOnToday(page: Page): Promise<void> {
  const grid = gridOf(page);
  const stops = grid.locator('[role="gridcell"][tabindex="0"]');
  await expect(stops).toHaveCount(1);
  await expect(grid.locator('tr[aria-current="date"]').getByRole('gridcell').first()).toHaveAttribute('tabindex', '0');
  await expect(stops).toHaveAttribute('data-column', '0');
}

test.describe('the team filter at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('narrows the grid to one team, keeps it across months, and resets in one press', async ({ page, fixture }) => {
    await page.goto('/kalendar');
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();
    // The run organization may hold teams other specs created: count, never assume.
    const columns = await columnCountOf(page);
    expect(columns).toBeGreaterThan(0);
    const team = searchParamPattern('smjena', fixture.team.id);

    const select = teamFilterOf(page);
    await expect(select).toBeVisible();
    await expect(select.locator('option').first()).toHaveText(fill(kalendar.filter.all, { count: String(columns) }));
    await expect(select).toHaveValue('');
    const grouped = select.locator(`optgroup[label="${kalendar.filter.group}"] > option`);
    await expect(grouped).toHaveCount(columns);
    await expect(grouped.filter({ hasText: fixture.team.name })).toHaveCount(1);
    const reset = page.getByRole('button', { name: kalendar.filter.reset, exact: true });
    await expect(reset).toHaveCount(0);

    // Choosing a team narrows the grid and resets the tab stop to today.
    await moveTabStopOffToday(page);
    await select.selectOption(fixture.team.id);
    await expect(page).toHaveURL(team);
    await expect(gridOf(page).locator('thead th')).toHaveCount(2);
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();
    await expect(select).toHaveValue(fixture.team.id);
    await expect(reset).toBeVisible();
    await expectTabStopOnToday(page);

    // One press brings every column back, on /kalendar, the reset goes, focus
    // lands on the filter rather than <body>, and the tab stop is on today.
    await moveTabStopOffToday(page);
    await reset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(/\/kalendar(\?|$)/);
    await expect(gridOf(page).locator('thead th')).toHaveCount(columns + 1);
    await expect(select).toHaveValue('');
    await expect(reset).toHaveCount(0);
    await expect(select).toBeFocused();
    await expectTabStopOnToday(page);

    // The next month keeps the team: the heading moves, the filter stays.
    await select.selectOption(fixture.team.id);
    await expect(page).toHaveURL(team);
    const heading = page.getByRole('heading', { level: 2 });
    const thisMonth = (await heading.innerText()).trim();
    await page.getByRole('button', { name: kalendar.next }).click();
    await expect(heading).not.toHaveText(thisMonth);
    await expect(page).toHaveURL(anySearchParamPattern('mjesec'));
    await expect(page).toHaveURL(team);
    await expect(gridOf(page).locator('thead th')).toHaveCount(2);
    await expect(select).toHaveValue(fixture.team.id);

    // A reset there drops the team and keeps the month.
    const mjesec = new URL(page.url()).searchParams.get('mjesec') ?? '';
    expect(mjesec).toMatch(/^\d{4}-\d{2}$/);
    await reset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(searchParamPattern('mjesec', mjesec));
    await expect(gridOf(page).locator('thead th')).toHaveCount(columns + 1);
    await expect(select).toBeFocused();
  });

  test('an unknown team id shows every column, reads as all teams, and offers no reset', async ({ page, fixture }) => {
    const unknown = randomUUID();
    await page.goto(`/kalendar?smjena=${unknown}`);
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();
    const select = teamFilterOf(page);
    await expect(select).toHaveValue('');
    const columns = await columnCountOf(page);
    await expect(select.locator(`optgroup[label="${kalendar.filter.group}"] > option`)).toHaveCount(columns);
    await expect(select.locator('option').first()).toHaveText(fill(kalendar.filter.all, { count: String(columns) }));
    await expect(page.getByRole('button', { name: kalendar.filter.reset, exact: true })).toHaveCount(0);
    // Silently ignored, and left in the URL.
    await expect(page).toHaveURL(searchParamPattern('smjena', unknown));
  });

  test('Moj raspored ignores the team, shows no filter, and keeps it in the URL', async ({ page, fixture }) => {
    await page.goto(`/kalendar?prikaz=moj&smjena=${fixture.team.id}`);
    await expect(modes(page).moj).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { level: 2, name: /\d{4}$/ })).toBeVisible();
    await expect(teamFilterOf(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: kalendar.filter.reset, exact: true })).toHaveCount(0);
    await expect(page.getByRole('grid')).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
  });
});

/**
 * A person's day list, named by their heading and then the month's
 * (`Lana Članica Rujan 2026`), so the month is never lost.
 */
function personListOf(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return page.getByRole('list', { name: new RegExp(`^${escaped} \\S+ \\d{4}$`) });
}

/** The people under the filter's *Osobe* heading. */
function peopleOptionsOf(page: Page): Locator {
  return teamFilterOf(page).locator(`optgroup[label="${kalendar.filter.people}"] > option`);
}

test.describe('the person filter at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test("shows one person's day list in place of the grid, kept across months and cleared by a team or the reset", async ({
    page,
    fixture,
  }) => {
    await page.goto('/kalendar');
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();
    const columns = await columnCountOf(page);
    const select = teamFilterOf(page);
    const reset = page.getByRole('button', { name: kalendar.filter.reset, exact: true });

    // The Osobe group follows the teams and lists the fixture's people.
    await expect(select.locator('optgroup')).toHaveCount(2);
    await expect(select.locator('optgroup').nth(1)).toHaveAttribute('label', kalendar.filter.people);
    for (const person of [fixture.admin, fixture.member, fixture.spare]) {
      await expect(peopleOptionsOf(page).filter({ hasText: person.name }), person.name).toHaveCount(1);
    }

    // Choosing her shows her day list headed with her name, and no grid.
    await select.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    const osoba = new URL(page.url()).searchParams.get('osoba') ?? '';
    expect(osoba).not.toBe('');
    await expect(page.getByRole('heading', { level: 3, name: fixture.member.name, exact: true })).toBeVisible();
    const list = personListOf(page, fixture.member.name);
    await expect(list).toBeVisible();
    await expect(list).toHaveAccessibleName(
      `${fixture.member.name} ${(await page.getByRole('heading', { level: 2 }).innerText()).trim()}`,
    );
    await expect(page.getByRole('grid')).toHaveCount(0);
    await expect(select).toHaveValue(`osoba:${osoba}`);
    await expect(reset).toBeVisible();

    // The next month keeps her.
    const heading = page.getByRole('heading', { level: 2 });
    const thisMonth = (await heading.innerText()).trim();
    await page.getByRole('button', { name: kalendar.next }).click();
    await expect(heading).not.toHaveText(thisMonth);
    await expect(page).toHaveURL(anySearchParamPattern('mjesec'));
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
    await expect(personListOf(page, fixture.member.name)).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);

    // Choosing a team drops her: the grid narrowed to that team.
    await select.selectOption(fixture.team.id);
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
    await expect(gridOf(page).locator('thead th')).toHaveCount(2);

    // Back to her, then the reset returns the whole grid and keeps the month.
    await select.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    const mjesec = new URL(page.url()).searchParams.get('mjesec') ?? '';
    await reset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(searchParamPattern('mjesec', mjesec));
    await expect(gridOf(page).locator('thead th')).toHaveCount(columns + 1);
    await expect(select).toHaveValue('');
    await expect(reset).toHaveCount(0);
    await expect(select).toBeFocused();
  });

  test('forgets the grid tab stop when a person is chosen and reset', async ({ page, fixture }) => {
    await page.goto('/kalendar');
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();
    const select = teamFilterOf(page);

    await moveTabStopOffToday(page);
    await select.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(page.getByRole('grid')).toHaveCount(0);
    await page.getByRole('button', { name: kalendar.filter.reset, exact: true }).click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expectTabStopOnToday(page);
  });

  test('a person on no team all month is explained, never an empty list', async ({ page, fixture }) => {
    await page.goto('/kalendar');
    const select = teamFilterOf(page);
    await expect(peopleOptionsOf(page).filter({ hasText: fixture.spare.name })).toHaveCount(1);

    await select.selectOption({ label: fixture.spare.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(page.getByRole('heading', { level: 3, name: fixture.spare.name, exact: true })).toBeVisible();
    await expect(page.getByText(fill(kalendar.person.noTeam, { name: fixture.spare.name }), { exact: true })).toBeVisible();
    await expect(personListOf(page, fixture.spare.name)).toHaveCount(0);
    await expect(page.getByRole('grid')).toHaveCount(0);
  });

  test('an unknown person id is ignored: the grid, and no reset', async ({ page, fixture }) => {
    const unknown = randomUUID();
    await page.goto(`/kalendar?osoba=${unknown}`);
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeVisible();
    await expect(teamFilterOf(page)).toHaveValue('');
    await expect(page.getByRole('button', { name: kalendar.filter.reset, exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('osoba', unknown));
  });
});

test.describe('the person filter in Moj raspored', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('Moj raspored ignores the person, shows no filter, and keeps it in the URL', async ({ page, fixture }) => {
    await page.goto('/kalendar');
    const value = await peopleOptionsOf(page).filter({ hasText: fixture.member.name }).getAttribute('value');
    const osoba = (value ?? '').replace(/^osoba:/, '');
    expect(osoba).not.toBe('');

    await page.goto(`/kalendar?prikaz=moj&osoba=${osoba}`);
    await expect(modes(page).moj).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { level: 2, name: /\d{4}$/ })).toBeVisible();
    await expect(teamFilterOf(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3, name: fixture.member.name })).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
  });
});

test.describe('the person filter for a member-role account', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 1280, height: 800 } });

  test('lists the colleagues under Osobe', async ({ page, fixture }) => {
    await page.goto('/kalendar?prikaz=sve');
    await expect(teamFilterOf(page)).toBeVisible();
    for (const person of [fixture.admin, fixture.member, fixture.spare]) {
      await expect(peopleOptionsOf(page).filter({ hasText: person.name }), person.name).toHaveCount(1);
    }
    // Every option is a name and nothing else: no address, no username.
    for (const text of await peopleOptionsOf(page).allInnerTexts()) {
      expect(text).not.toMatch(/@|e2e\./);
    }

    // A colleague's month — the reading `calendar_members()` exists for.
    const select = teamFilterOf(page);
    await select.selectOption({ label: fixture.admin.name });
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(page.getByRole('heading', { level: 3, name: fixture.admin.name, exact: true })).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);

    await select.selectOption({ label: fixture.spare.name });
    await expect(page.getByRole('heading', { level: 3, name: fixture.spare.name, exact: true })).toBeVisible();
    await expect(page.getByText(fill(kalendar.person.noTeam, { name: fixture.spare.name }), { exact: true })).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
  });
});

test.describe('the team filter at 320 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 320, height: 720 } });

  test('never scrolls the page sideways, and the select and the reset are touch targets', async ({ page, fixture }) => {
    await page.goto(`/kalendar?prikaz=sve&smjena=${fixture.team.id}`);
    await expect(gridOf(page).getByRole('columnheader', { name: fixture.team.name, exact: true })).toBeAttached();
    const select = teamFilterOf(page);
    const reset = page.getByRole('button', { name: kalendar.filter.reset, exact: true });
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
