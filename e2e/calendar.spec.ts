import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';

import {
  holdRotation,
  removeSeededRotation,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from './support/database.ts';
import { ADMIN_STATE, MEMBER_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { MINIMUM_TARGET, expectNoHorizontalScroll, expectTouchTargets } from './support/layout.ts';
import { signIn } from './support/sign-in.ts';
import { expect, test } from './support/test.ts';

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
 */

const kalendar = hr.kalendar;

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;

test.afterEach(async () => {
  try {
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

/** The type the seeded pattern names on `date`, from its start today. */
function expectedType(rotation: SeededRotation, date: string): string {
  const days = Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${rotation.today}T12:00:00Z`)) / 86_400_000,
  );
  const step = rotation.steps[((days % 4) + 4) % 4];
  if (step === undefined) throw new Error(`E2E: no step for ${date}`);

  return step;
}

/** The grid's cell for `teamName` on `date`. */
async function cellOf(page: Page, teamName: string, date: string): Promise<Locator> {
  const grid = page.getByRole('table', { name: /\d{4}$/ });
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
  return row.getByRole('cell').nth(column - 1);
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
    await expect(cell.getByText(kalendar.noRotation, { exact: true })).toHaveCount(1);
  });

  test('a read that fails shows the alert and no grid', async ({ page }) => {
    // A refused answer rather than an aborted socket: the client retries a
    // network failure on its own schedule, and the point here is the screen.
    await page.route('**/rest/v1/organizations*', (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"E2E","message":"refused"}' }),
    );
    await page.goto('/kalendar');

    await expect(page.getByRole('alert').filter({ hasText: kalendar.error.unavailable })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
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
    await expect(page.getByRole('table')).toHaveCount(0);

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
    // The full name is there for a screen reader, not drawn.
    await expect(cell.getByText(expectedType(rotation, rotation.today), { exact: true })).toHaveClass(/(^|\s)sr-only(\s|$)/);

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
    await expect(page.getByRole('table')).toBeVisible();
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
    expect(select).not.toMatch(/position\b(?!,shift_type_id)|rank|created_by|auth_user_id|members\([^)]*name/);
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
    await expect(page.getByRole('table')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
});
