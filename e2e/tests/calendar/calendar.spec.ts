import { randomBytes, randomUUID } from 'node:crypto';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import {
  holdFireRanks,
  holdRotation,
  removeOverrideInSql,
  removeRosterOverridesInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedRosterOverride,
  seedRotationChange,
  seedShiftTypeOverride,
  seedTeamRotation,
  setFireRanks,
  setRankAndPosition,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth, weekdayOf } from '../../utils/dates.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { escapeRegExp, fill, hr } from '../../utils/i18n.ts';
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
 *
 * Story 3.5b: an admin sets an override from the day detail — the Dialog
 * held while the insert is in flight — and removes it through a neutral
 * confirmation, the cell back to its projection; a blank reason is refused
 * without a request and keeps the type; a member sees no form.
 *
 * Story 3.6a: a roster override, written in SQL (`seedRosterOverride`) — a
 * replacement on the fixture team today, its member taken off and the member
 * on no team put on — marks the cell with the same `✎`; the day detail's
 * roster follows it and its change block names the change, author, time and
 * reason; the member put on reads that shift in their own Moj raspored at
 * 390 px, and the person filter on the member taken off lacks it.
 *
 * Story 3.6b: an admin replaces the team's member with the member on no team
 * from the day detail's roster form — the Dialog held while the insert is in
 * flight, the member put on offered with their rank — and removes it through
 * a neutral confirmation, the roster back to its default; "nothing chosen" is
 * refused without a request; a seeded inert change is listed to the admin and
 * removed; and a member sees no form, no removal and no inert block.
 *
 * Epic 4 retro C2: putting on a member whose own team works the same window
 * shows a neutral hint beside "Dolazi", gone for nobody or a member on no
 * team, and the save still lands.
 */

const kalendar = hr.kalendar;
const filterWords = hr.filter;

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** The fire-rank setting, while the rank test holds it (`holdFireRanks`). */
let ranksHold: RotationHold | null = null;
/** What the rank test changed, put back before its hold is released. */
let restoreRanks: (() => Promise<void>) | null = null;
let restoreMember: (() => Promise<void>) | null = null;
/** A second team and its rotation (story 3.6a), removed after the fixture team's seed, before the hold is released. */
let extra: { readonly slug: string; readonly teamId: string; readonly seed: SeededRotation | null } | null = null;

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
    if (extra !== null) {
      if (extra.seed !== null) await removeSeededRotation(extra.seed);
      await removeTeamInSql(extra.slug, extra.teamId);
    }
  } finally {
    seed = null;
    extra = null;
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

/**
 * Holds the run organization's rotation without seeding one (story 3.6a): a
 * test that reads the member on no team as on no team all month must not run
 * while another test's roster override puts him on a shift, and every roster
 * override is seeded under this same hold.
 */
async function held(slug: string): Promise<void> {
  hold = holdRotation(slug);
  await hold.ready;
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
      test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    // On the current month, "ovaj mjesec" is a label in the trigger, not a
    // disabled button (story 7.4), and focus is on the trigger, never <body>.
    await expect(calendarPage.thisMonthLabel).toBeVisible();
    await expect(calendarPage.currentButton).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toBeFocused();

    // Whatever a navigation might have fetched has landed before the count is read.
    await page.waitForLoadState('networkidle');
    expect(reads, 'moving between months read the snapshot again').toEqual([]);
  });

  test('the bounds disable only the button that would leave the calendar', async ({ page, calendarPage }) => {
    await calendarPage.goto('?mjesec=9999-12');
    await expect(calendarPage.nextButton).toBeDisabled();
    await expect(calendarPage.previousButton).toBeEnabled();
    // PgDn at the upper bound does what the disabled › does: nothing (story 7.4).
    await calendarPage.previousButton.focus();
    await page.keyboard.press('PageDown');
    await expect(page).toHaveURL(/mjesec=9999-12/);

    await calendarPage.goto('?mjesec=0001-01');
    await expect(calendarPage.previousButton).toBeDisabled();
    await expect(calendarPage.nextButton).toBeEnabled();
    await calendarPage.nextButton.focus();
    await page.keyboard.press('PageUp');
    await expect(page).toHaveURL(/mjesec=0001-01/);
    await expect(calendarPage.monthHeading(monthHeading('0001-01-01'))).toBeVisible();
  });
});

/**
 * Story 7.4: the month is one toolbar, ‹ month ▾ ›, shared with *Sati*. PgUp
 * and PgDn step it from anywhere in the group; the month opens a picker of
 * twelve months with the year's ‹ ›; `Ovaj mjesec` is a button only off the
 * current month. No rotation is needed: the toolbar reads none.
 */
test.describe('the month toolbar', () => {
  test.use({ storageState: ADMIN_STATE });

  test('on the current month the trigger carries the label and no Ovaj mjesec button is drawn', async ({
    calendarPage,
  }) => {
    await calendarPage.goto();
    await expect(calendarPage.monthToolbar).toBeVisible();
    await expect(calendarPage.monthTrigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(calendarPage.monthTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(calendarPage.thisMonthLabel).toBeVisible();
    await expect(calendarPage.currentButton).toHaveCount(0);
  });

  test('PgDn and PgUp in the toolbar step the month, and focus stays where it was', async ({ page, calendarPage }) => {
    await calendarPage.goto('?mjesec=2026-07&prikaz=sve');
    await calendarPage.previousButton.focus();

    await page.keyboard.press('PageDown');
    await expect(page).toHaveURL(/mjesec=2026-08/);
    await expect(calendarPage.monthHeading(monthHeading('2026-08-01'))).toBeVisible();
    await expect(calendarPage.previousButton).toBeFocused();

    await calendarPage.monthTrigger.focus();
    await page.keyboard.press('PageUp');
    await page.keyboard.press('PageUp');
    await expect(page).toHaveURL(/mjesec=2026-06/);
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(calendarPage.monthTrigger).toBeFocused();
  });

  test('a month in another year is picked from the picker, keeping the filters, and focus returns to the trigger', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto(`?mjesec=2026-07&prikaz=sve&smjena=${fixture.team.id}`);
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.monthPicker).toBeVisible();
    await expect(calendarPage.monthTrigger).toHaveAttribute('aria-expanded', 'true');
    // It opens on the shown month, focused and marked.
    await expect(calendarPage.pickerMonth(monthHeading('2026-07-01'))).toBeFocused();
    await expect(calendarPage.pickerMonth(monthHeading('2026-07-01'))).toHaveAttribute('aria-current', 'true');
    // The arrows move by a month and by a row of four.
    await page.keyboard.press('ArrowRight');
    await expect(calendarPage.pickerMonth(monthHeading('2026-08-01'))).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(calendarPage.pickerMonth(monthHeading('2026-04-01'))).toBeFocused();

    await calendarPage.pickerYears().previous.click();
    await expect(calendarPage.pickerYear).toHaveText('2025');
    await calendarPage.pickerMonth(monthHeading('2025-03-01')).click();

    await expect(page).toHaveURL(/mjesec=2025-03/);
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(page).toHaveURL(new RegExp(`smjena=${fixture.team.id}`));
    await expect(calendarPage.monthPicker).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toBeFocused();
    await expect(calendarPage.monthHeading(monthHeading('2025-03-01'))).toBeVisible();
  });

  test('Escape closes the picker with the month unchanged, and focus returns to the trigger', async ({
    page,
    calendarPage,
  }) => {
    await calendarPage.goto('?mjesec=2026-07');
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.monthPicker).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');

    await expect(calendarPage.monthPicker).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toBeFocused();
    await expect(page).toHaveURL(/mjesec=2026-07/);
  });

  test('Ovaj mjesec returns to the current month with focus on the trigger', async ({ page, calendarPage }) => {
    await calendarPage.goto('?mjesec=2026-07&prikaz=sve');
    await calendarPage.currentButton.click();

    await expect(page).not.toHaveURL(/mjesec=/);
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(calendarPage.thisMonthLabel).toBeVisible();
    await expect(calendarPage.currentButton).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toBeFocused();
  });

  test('picking the current month from the picker drops the month from the URL', async ({ page, calendarPage }) => {
    await calendarPage.goto('?prikaz=sve');
    // Today's month, as the trigger names it, before moving off it.
    const heading = (await calendarPage.monthHeading().innerText()).trim();
    await calendarPage.nextButton.click();
    await expect(page).toHaveURL(/mjesec=/);

    await calendarPage.monthTrigger.click();
    await calendarPage.pickerYears().previous.click();
    await calendarPage.pickerYears().next.click();
    await calendarPage.pickerMonth(heading).click();

    await expect(page).not.toHaveURL(/mjesec=/);
    await expect(page).toHaveURL(/prikaz=sve/);
    await expect(calendarPage.thisMonthLabel).toBeVisible();
    await expect(calendarPage.currentButton).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toBeFocused();
  });

  test("the picker's year stops at the calendar's bounds, and focus stays in the picker", async ({
    calendarPage,
  }) => {
    await calendarPage.goto('?mjesec=0001-01');
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.pickerYears().previous).toBeDisabled();
    await expect(calendarPage.pickerYears().next).toBeEnabled();

    await calendarPage.goto('?mjesec=9999-12');
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.pickerYears().next).toBeDisabled();

    // Reaching the last year disables the pressed button: focus moves to the
    // month the picker holds, never to <body>.
    await calendarPage.goto('?mjesec=9998-05');
    await calendarPage.monthTrigger.click();
    await calendarPage.pickerYears().next.click();
    await expect(calendarPage.pickerYear).toHaveText('9999');
    await expect(calendarPage.pickerYears().next).toBeDisabled();
    await expect(calendarPage.pickerMonth(monthHeading('9999-05-01'))).toBeFocused();
  });

  test('a press outside, a second press on the trigger, and Tab out each close the picker', async ({
    page,
    calendarPage,
  }) => {
    await calendarPage.goto('?mjesec=2026-07');

    await calendarPage.monthTrigger.click();
    await expect(calendarPage.monthPicker).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(calendarPage.monthPicker).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toHaveAttribute('aria-expanded', 'false');

    await calendarPage.monthTrigger.click();
    await expect(calendarPage.monthTrigger).toHaveAttribute('aria-expanded', 'true');
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.monthPicker).toHaveCount(0);
    await expect(calendarPage.monthTrigger).toHaveAttribute('aria-expanded', 'false');

    // Tab from the focused month leaves the picker: it closes where focus went.
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.pickerMonth(monthHeading('2026-07-01'))).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(calendarPage.monthPicker).toHaveCount(0);
    await expect(page).toHaveURL(/mjesec=2026-07/);
  });

  test('PgUp on ‹ reaching the first month moves focus to the trigger, never <body>', async ({
    page,
    calendarPage,
  }) => {
    await calendarPage.goto('?mjesec=0001-02');
    await calendarPage.previousButton.focus();
    await page.keyboard.press('PageUp');

    await expect(page).toHaveURL(/mjesec=0001-01/);
    await expect(calendarPage.previousButton).toBeDisabled();
    await expect(calendarPage.monthTrigger).toBeFocused();
  });

  test('at 320 px the open picker fits: every control 44 px and no sideways scroll', async ({ page, calendarPage }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    // The current month: the widest trigger, with its "ovaj mjesec" label.
    await calendarPage.goto();
    await expect(calendarPage.thisMonthLabel).toBeVisible();
    await expectNoHorizontalScroll(page);
    await calendarPage.monthTrigger.click();
    await expect(calendarPage.monthPicker).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
    const box = await calendarPage.monthPicker.boundingBox();
    expect(box, 'the picker has no box').not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    await held(fixture.slug);
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
      test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
      // control before the grid is the filter bar's last one drawn (story 7.5).
      await calendarPage.filters.lastControl.focus();
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    // Toni is on no team, and the admin is on none either: neither is on the
    // roster (story 3.6b offers both to put on, in the admin's roster form).
    await expect(calendarPage.rosterIn(detail)).not.toContainText(fixture.spare.name);

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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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

  test('browser Back after an in-app month change closes the detail and returns focus to the grid', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // The opener is gone once Back shows the other month, so focus falls back
    // to the grid's one tab stop. The months are changed in the app, not by
    // `goto`: a Back across two loaded documents restores the earlier document,
    // where focus starts on the body as in any fresh page.
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const next = firstOfNextMonth(rotation.today);

    await calendarPage.goto(gridMonthOf(rotation.today));
    await calendarPage.nextButton.click();
    await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
    await (await calendarPage.cellOf(fixture.team.name, next)).click();
    await expect(calendarPage.detailOf(fixture.team.name, next)).toBeVisible();
    await page.goBack();
    await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    await expect(calendarPage.dialog()).toHaveCount(0);
    await expect(calendarPage.tabStops).toHaveCount(1);
    await expect(calendarPage.tabStops).toBeFocused();
  });

  test('a day opened before the late close event of a month change stays open', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // Back to the earlier month closes the detail through a `detailKey`
    // change, and the dialog's `close` event comes as a later task. A click
    // the browser runs ahead of that task opens a day of the month Back
    // showed; the late event is stale and must not close it.
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const next = firstOfNextMonth(rotation.today);

    await calendarPage.goto(gridMonthOf(rotation.today));
    const today = calendarPage.detailOf(fixture.team.name, rotation.today);
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    const position = await calendarPage.positionOf(cell);
    await calendarPage.nextButton.click();
    await expect(calendarPage.monthHeading(monthHeading(next))).toBeVisible();
    await (await calendarPage.cellOf(fixture.team.name, next)).click();
    await expect(calendarPage.detailOf(fixture.team.name, next)).toBeVisible();

    await calendarPage.clickOnDialogClose(position);
    await page.goBack();
    await expect(calendarPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    await expect.poll(() => calendarPage.clickedOnDialogClose()).toBe(true);
    await expect(today).toBeVisible();
    await expect(calendarPage.dialog()).toHaveCount(1);

    // It still closes as any day does, and focus returns to its cell.
    await page.keyboard.press('Escape');
    await expect(calendarPage.dialog()).toHaveCount(0);
    await expect(cell).toBeFocused();
  });

  test('browser Back while the detail is open closes it, and it does not reopen', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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

const ROSTER_REASON = 'Zamjena zbog bolovanja (E2E).';

test.describe('a roster override at 1280 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('a replacement marks the cell with ✎, and the detail shows the roster it leaves and the change', async ({
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');
    const change = await seedRosterOverride(
      rotation,
      fixture.team.id,
      rotation.today,
      fixture.member.name,
      fixture.spare.name,
      ROSTER_REASON,
    );

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    // The type is the projection's; the mark is the roster's, on the cell itself.
    await expect(cell).toContainText(expectedType(rotation, rotation.today));
    await expect(cell).toContainText('\u270E');
    await expect(cell).toHaveAccessibleName(
      `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, ${range}, ${kalendar.modifier.overridden}`,
    );
    const yesterday = addDays(rotation.today, -1);
    const neighbour = yesterday.slice(0, 7) === rotation.today.slice(0, 7) ? yesterday : addDays(rotation.today, 1);
    await expect(await calendarPage.cellOf(fixture.team.name, neighbour)).not.toContainText('\u270E');
    const legend = calendarPage.legendOf();
    await expect(legend.items).toHaveText([`\u270E${kalendar.modifier.overridden}`]);

    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    // Toni is put on, and she is taken off.
    await expect(calendarPage.rosterLinesIn(detail)).toHaveCount(1);
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.spare.name);
    await expect(calendarPage.rosterIn(detail)).not.toContainText(fixture.member.name);
    const block = calendarPage.rosterChangesIn(detail);
    await expect(block).toBeVisible();
    await expect(calendarPage.rosterChangeItemsIn(detail)).toHaveCount(1);
    await expect(block).toContainText(
      fill(kalendar.detail.rosterChange.replaced, { out: fixture.member.name, in: fixture.spare.name }),
    );
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(
      fill(kalendar.detail.override.savedAt, { date: change.savedDate, time: change.savedTime }),
    );
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: ROSTER_REASON }));
    // No shift-type override: its block is absent.
    await expect(calendarPage.overrideIn(detail)).toHaveCount(0);
  });

  test('the person filter on the member taken off lacks the shift', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');
    await seedRosterOverride(rotation, fixture.team.id, rotation.today, fixture.member.name, fixture.spare.name, ROSTER_REASON);
    // Today's shift of the team, as a day list's button is named.
    const shift = `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, ${range}, ${kalendar.modifier.overridden}`;

    await calendarPage.goto(gridMonthOf(rotation.today));
    await calendarPage.filters.choosePerson(fixture.member.name);
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.personHeading(fixture.member.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);
    // Her month rendered — the list, or the notice when today was her one day
    // on the team this month — and holds no such day: she was taken off.
    await expect(
      calendarPage.personListOf(fixture.member.name).or(calendarPage.personNoTeam(fixture.member.name)),
    ).toBeVisible();
    await expect(calendarPage.dayOpenerNamed(shift)).toHaveCount(0);

    // Toni, on no team, holds that one shift this month.
    await calendarPage.filters.choosePerson(fixture.spare.name);
    const spare = calendarPage.personListOf(fixture.spare.name);
    await expect(spare).toBeVisible();
    await expect(calendarPage.todayIn(spare)).toContainText('\u270E');
    await expect(calendarPage.dayOpenerNamed(shift)).toHaveCount(1);
  });
});

test.describe('a roster override at 390 px, as the member put on', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the member on no team reads the shift they were put on in Moj raspored, and its detail", async ({
    page,
    calendarPage,
    loginPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');
    await seedRosterOverride(rotation, fixture.team.id, rotation.today, fixture.member.name, fixture.spare.name, ROSTER_REASON);

    await loginPage.signIn(fixture.slug, fixture.spare.username, fixture.password);
    await calendarPage.goto();
    await expect(calendarPage.modes().moj).toHaveAttribute('aria-pressed', 'true');
    await expect(calendarPage.noTeamNotice).toHaveCount(0);
    const today = calendarPage.today;
    await expect(today).toContainText(expectedType(rotation, rotation.today));
    await expect(today).toContainText('\u270E');
    const opener = calendarPage.openerIn(today);
    await expect(opener).toHaveAccessibleName(
      `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, ${range}, ${kalendar.modifier.overridden}`,
    );
    await expectNoHorizontalScroll(page);

    await opener.tap();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.spare.name);
    await expect(calendarPage.rosterChangesIn(detail)).toContainText(
      fill(kalendar.detail.rosterChange.replaced, { out: fixture.member.name, in: fixture.spare.name }),
    );
    await expectNoHorizontalScroll(page);
  });
});

test.describe('a double shift at 390 px, as the member put on in Moj raspored', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('her own team works today and she is put on another team\'s shift: two openers, her own first', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const suffix = randomBytes(3).toString('hex');
    const beta = await seedExtraTeam(fixture.slug, `Smjena Beta ${suffix}`);
    extra = { slug: fixture.slug, teamId: beta.id, seed: null };
    const other = await seedTeamRotation(fixture.slug, beta.id, randomBytes(3).toString('hex'));
    extra = { ...extra, seed: other };
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');
    await seedRosterOverride(rotation, beta.id, rotation.today, null, fixture.member.name, ROSTER_REASON);
    const prefix = `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}`;

    await calendarPage.goto();
    const openers = calendarPage.openerIn(calendarPage.today);
    await expect(openers).toHaveCount(2);
    await expect(openers.nth(0)).toHaveAccessibleName(
      `${prefix}, ${fixture.team.name}, ${expectedType(rotation, rotation.today)}, ${range}`,
    );
    await expect(openers.nth(1)).toHaveAccessibleName(
      `${prefix}, ${beta.name}, ${expectedType(other, rotation.today)}, ${range}, ${kalendar.modifier.overridden}`,
    );
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);

    await openers.nth(1).tap();
    const detail = calendarPage.detailOf(beta.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);
    await expect(calendarPage.rosterChangesIn(detail)).toContainText(
      fill(kalendar.detail.rosterChange.added, { name: fixture.member.name }),
    );
  });
});

test.describe('a roster override a rotation change left pending, at 1280 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('the day keeps its default roster and no ✎, and the detail lists the change as waiting for review', async ({
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // A replacement on D+3, then a change from D+1 saved after it: the new
    // version anchors D+1 on the third step, so D+3 projects Dan — a working
    // day, where the change would otherwise apply.
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const date = addDays(rotation.today, 3);
    const change = await seedRosterOverride(
      rotation,
      fixture.team.id,
      date,
      fixture.member.name,
      fixture.spare.name,
      ROSTER_REASON,
    );
    await seedRotationChange(rotation, fixture.team.id, addDays(rotation.today, 1), 2);

    await calendarPage.goto(gridMonthOf(date));
    const cell = await calendarPage.cellOf(fixture.team.name, date);
    await expect(cell).toContainText(rotation.steps[0]);
    await expect(cell).not.toContainText('\u270E');

    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, date);
    await expect(detail).toBeVisible();
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);
    await expect(calendarPage.rosterIn(detail)).not.toContainText(fixture.spare.name);
    await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);
    const pending = calendarPage.rosterPendingIn(detail);
    await expect(pending).toBeVisible();
    await expect(pending).toContainText(
      fill(kalendar.detail.rosterChange.replaced, { out: fixture.member.name, in: fixture.spare.name }),
    );
    await expect(pending).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(pending).toContainText(
      fill(kalendar.detail.override.savedAt, { date: change.savedDate, time: change.savedTime }),
    );
    await expect(pending).toContainText(fill(kalendar.detail.override.reason, { reason: ROSTER_REASON }));
  });
});

test.describe('an admin changes a shift roster at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('replaces the member with the member on no team, then removes the change through the neutral confirmation', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Ranks on, and the member on no team given one: the candidate line shows it.
    ranksHold = holdFireRanks(fixture.slug);
    await ranksHold.ready;
    const was = await setFireRanks(fixture.slug, true);
    restoreRanks = async () => {
      await setFireRanks(fixture.slug, was);
    };
    const before = await setRankAndPosition(fixture.slug, fixture.spare.name, fixture.team.id, {
      fireRank: 'firefighter',
      position: null,
    });
    restoreMember = async () => {
      await setRankAndPosition(fixture.slug, fixture.spare.name, fixture.team.id, before);
    };
    const replaced = fill(kalendar.detail.rosterChange.replaced, { out: fixture.member.name, in: fixture.spare.name });

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).not.toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    // STORY 7.9: the day detail is facts — no form — and its footer opens the roster dialog.
    await expect(detail.locator('form')).toHaveCount(0);
    await expect(calendarPage.changesIn(detail)).toContainText(kalendar.detail.changes.empty);
    await expect(calendarPage.rosterRemoveIn(detail)).toHaveCount(0);
    const form = await calendarPage.openRosterFormIn(detail);
    // The member put on reads `Ime · čin · Smjena` — on no team here — under "slobodan", and nobody is preselected.
    const spareLine = fill(hr.smjene.roster.withRankAndPosition, {
      name: fixture.spare.name,
      rank: hr.ljudi.rank.firefighter,
      position: kalendar.detail.rosterChange.set.noTeam,
    });
    await expect(calendarPage.optionIn(calendarPage.rosterInIn(form), spareLine)).toHaveCount(1);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterInIn(form), fixture.spare.name)).toHaveText(spareLine);
    const free = calendarPage.rosterInGroupIn(form, 'free');
    await expect(free).toHaveAttribute('label', hr.raspored.resolution.candidates.free);
    await expect(calendarPage.memberOptionIn(free, fixture.spare.name)).toHaveCount(1);
    await expect(calendarPage.rosterInIn(form)).toHaveValue('');
    // The member on the default roster is offered to take off, not to put on.
    await expect(calendarPage.memberOptionIn(calendarPage.rosterOutIn(form), fixture.member.name)).toHaveCount(1);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterInIn(form), fixture.member.name)).toHaveCount(0);
    // *Što se mijenja* says nothing until a choice is made, then who leaves, who arrives, and their hours.
    await expect(calendarPage.previewIn(form)).toBeEmpty();
    await calendarPage.chooseIn(calendarPage.rosterOutIn(form), fixture.member.name);
    await calendarPage.chooseIn(calendarPage.rosterInIn(form), fixture.spare.name);
    await expect(calendarPage.previewIn(form)).toContainText(fill(kalendar.detail.preview.out, { name: fixture.member.name }));
    await expect(calendarPage.previewIn(form)).toContainText(fill(kalendar.detail.preview.in, { name: fixture.spare.name }));
    await expect(calendarPage.previewIn(form)).toContainText(/−\d/);
    await expect(calendarPage.previewIn(form)).toContainText(/\+\d/);

    // WHILE THE INSERT IS IN FLIGHT, Escape, the backdrop and the close
    // button close nothing. `removeSeededRotation` deletes every roster
    // change of the run organization even when a step below fails.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const insert = '**/rest/v1/roster_overrides*';
    await page.route(insert, async (route) => {
      if (route.request().method() === 'POST') await held;
      await route.continue();
    });
    await calendarPage.fillRosterIn(form, fixture.member.name, fixture.spare.name, ROSTER_REASON);
    await expect(calendarPage.rosterSaveIn(form)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await calendarPage.rosterCloseIn(form).click();
    await expect(form).toBeVisible();
    await expect(detail).toBeVisible();
    release();

    // Landed: the dialog closes, focus returns to its opener, and the day detail says so.
    const block = calendarPage.rosterChangesIn(detail);
    await expect(block).toBeVisible();
    await page.unroute(insert);
    await expect(calendarPage.rosterForm).toHaveCount(0);
    await expect(calendarPage.rosterOpenerIn(detail)).toBeFocused();
    await expect(block).toContainText(replaced);
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: ROSTER_REASON }));
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.rosterChange.saved);
    await expect(calendarPage.rosterLinesIn(detail)).toHaveCount(1);
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.spare.name);
    // Both members are named by a live change: neither is offered again.
    const again = await calendarPage.openRosterFormIn(detail);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterOutIn(again), fixture.member.name)).toHaveCount(0);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterInIn(again), fixture.spare.name)).toHaveCount(0);
    // Its cancel closes it, and focus returns to the opener.
    await calendarPage.rosterCancelIn(again).click();
    await expect(calendarPage.rosterForm).toHaveCount(0);
    await expect(calendarPage.rosterOpenerIn(detail)).toBeFocused();
    await expect(cell).toContainText('\u270E');

    // Remove: one neutral confirmation naming the change, the team and the date.
    const remove = calendarPage.rosterRemoveIn(block);
    await remove.click();
    const confirm = calendarPage.rosterRemoveConfirmOf(replaced, fixture.team.name, rotation.today);
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('.bg-destructive, .text-destructive, .border-destructive')).toHaveCount(0);
    // Its cancel keeps the change, and focus returns to its removal.
    await calendarPage.cancelRosterRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(block).toBeVisible();
    await expect(remove).toBeFocused();
    await remove.click();
    await calendarPage.confirmRosterRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(block).toHaveCount(0);
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.rosterChange.removedDone);
    // Focus is back on the roster dialog's opener.
    await expect(calendarPage.rosterOpenerIn(detail)).toBeFocused();
    // The default roster, and its candidates, are back.
    await expect(calendarPage.rosterLinesIn(detail)).toHaveCount(1);
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);
    const back = await calendarPage.openRosterFormIn(detail);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterOutIn(back), fixture.member.name)).toHaveCount(1);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterInIn(back), fixture.spare.name)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(calendarPage.rosterForm).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(cell).not.toContainText('\u270E');
  });

  test('putting on a member whose own team works the same window warns beside "Dolazi", and saving still succeeds', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // Both teams work the seeded rotation's first step today: Dan 07:00–19:00.
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const beta = await seedExtraTeam(fixture.slug, `Smjena Beta ${randomBytes(3).toString('hex')}`);
    extra = { slug: fixture.slug, teamId: beta.id, seed: null };
    const other = await seedTeamRotation(fixture.slug, beta.id, randomBytes(3).toString('hex'));
    extra = { ...extra, seed: other };
    const range = expectedRange(rotation, rotation.today);
    if (range === null) throw new Error('E2E: the seeded rotation does not work today');
    const hintText = fill(kalendar.detail.rosterChange.set.overlap, {
      name: fixture.member.name,
      team: fixture.team.name,
      day: `${weekdayOf(rotation.today)} ${dayMonth(rotation.today)}`,
      range,
    });
    const added = fill(kalendar.detail.rosterChange.added, { name: fixture.member.name });

    await calendarPage.goto(gridMonthOf(rotation.today));
    const betaCell = await calendarPage.cellOf(beta.name, rotation.today);
    await betaCell.click();
    const detail = calendarPage.detailOf(beta.name, rotation.today);
    await expect(detail).toBeVisible();
    const form = await calendarPage.openRosterFormIn(detail);
    const put = calendarPage.rosterInIn(form);
    const hint = calendarPage.rosterOverlapIn(form);
    // The live region is there from the start, empty, and describes nothing.
    await expect(hint).toHaveCount(1);
    await expect(hint).toBeEmpty();
    await expect(put).toHaveAccessibleDescription('');
    // STORY 7.9: she works that day, so she is under "radi taj dan · 24 h bez pauze" — informing, never blocking.
    const working = calendarPage.rosterInGroupIn(form, 'working');
    await expect(working).toHaveAttribute('label', hr.raspored.resolution.candidates.working);
    await expect(calendarPage.memberOptionIn(working, fixture.member.name)).toHaveCount(1);

    // Her own team works the same window: the hint names it, tied to the field, neutral.
    await calendarPage.chooseIn(put, fixture.member.name);
    await expect(hint).toHaveText(hintText);
    await expect(put).toHaveAccessibleDescription(hintText);
    await expect(form.locator('.text-destructive, .bg-destructive')).toHaveCount(0);
    await expect(calendarPage.rosterSaveIn(form)).toBeEnabled();

    // Nobody, and then a member on no team: no hint.
    await put.selectOption({ label: kalendar.detail.rosterChange.set.none });
    await expect(hint).toBeEmpty();
    await calendarPage.chooseIn(put, fixture.spare.name);
    await expect(hint).toBeEmpty();

    // Warned, never blocked: the save lands, and the hint goes with the chosen member.
    await calendarPage.fillRosterIn(form, null, fixture.member.name, ROSTER_REASON);
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.rosterChange.saved);
    await expect(calendarPage.rosterForm).toHaveCount(0);
    const block = calendarPage.rosterChangesIn(detail);
    await expect(block).toContainText(added);

    await calendarPage.rosterRemoveIn(block).click();
    const confirm = calendarPage.rosterRemoveConfirmOf(added, beta.name, rotation.today);
    await calendarPage.confirmRosterRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(block).toHaveCount(0);
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.rosterChange.removedDone);
    // She is offered again, on "— nitko —": no hint from before the save.
    await calendarPage.openRosterFormIn(detail);
    await expect(calendarPage.memberOptionIn(put, fixture.member.name)).toHaveCount(1);
    await expect(hint).toBeEmpty();

    // Chosen, then the dialog and the day closed: another team's working day in the same window starts with no hint.
    await calendarPage.chooseIn(put, fixture.member.name);
    await expect(hint).toHaveText(hintText);
    await page.keyboard.press('Escape');
    await expect(calendarPage.rosterForm).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    const own = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(own).toBeVisible();
    const ownForm = await calendarPage.openRosterFormIn(own);
    await expect(calendarPage.rosterOverlapIn(ownForm)).toHaveCount(1);
    await expect(calendarPage.rosterOverlapIn(ownForm)).toBeEmpty();
    await expect(calendarPage.rosterInIn(ownForm)).toHaveAccessibleDescription('');
  });

  test('nothing chosen is refused without a request and keeps the reason', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/roster_overrides')) writes.push(request.method());
    });

    await calendarPage.goto(gridMonthOf(rotation.today));
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const form = await calendarPage.changeRosterIn(detail, null, null, ROSTER_REASON);

    await expect(calendarPage.alertIn(form)).toHaveText(kalendar.detail.rosterChange.refused.member);
    await expect(calendarPage.rosterReasonIn(form)).toHaveValue(ROSTER_REASON);
    await expect(calendarPage.rosterOutIn(form)).toBeFocused();
    await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);
    expect(writes, 'a refused preflight sent a request').toEqual([]);
  });

  test('a save answered 23505 says taken, keeps the reason, and the re-read no longer offers the member', async ({
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await calendarPage.goto(gridMonthOf(rotation.today));
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const form = await calendarPage.openRosterFormIn(detail);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterOutIn(form), fixture.member.name)).toHaveCount(1);
    // Another admin takes her off the shift while the day is open.
    await seedRosterOverride(rotation, fixture.team.id, rotation.today, fixture.member.name, null, ROSTER_REASON);
    await calendarPage.fillRosterIn(form, fixture.member.name, fixture.spare.name, ROSTER_REASON);

    await expect(calendarPage.alertIn(form)).toHaveText(kalendar.detail.rosterChange.refused.taken);
    await expect(calendarPage.rosterReasonIn(form)).toHaveValue(ROSTER_REASON);
    // The re-read shows the day as it is: her removal applied, and she is offered no more.
    await expect(calendarPage.rosterChangesIn(detail)).toContainText(
      fill(kalendar.detail.rosterChange.removed, { name: fixture.member.name }),
    );
    await expect(calendarPage.memberOptionIn(calendarPage.rosterOutIn(form), fixture.member.name)).toHaveCount(0);
  });

  test('a removal answered P0002 holds its confirmation while in flight, then says gone and shows the day as it is', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    await seedRosterOverride(rotation, fixture.team.id, rotation.today, fixture.member.name, fixture.spare.name, ROSTER_REASON);
    const replaced = fill(kalendar.detail.rosterChange.replaced, { out: fixture.member.name, in: fixture.spare.name });

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const block = calendarPage.rosterChangesIn(detail);
    await calendarPage.rosterRemoveIn(block).click();
    const confirm = calendarPage.rosterRemoveConfirmOf(replaced, fixture.team.name, rotation.today);
    await expect(confirm).toBeVisible();

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const removal = '**/rest/v1/rpc/remove_roster_override*';
    await page.route(removal, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();

        return;
      }
      await held;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'P0002', message: 'ROSTER_OVERRIDE_NOT_LIVE', details: null, hint: null }),
      });
    });
    await calendarPage.confirmRosterRemoveIn(confirm).click();
    // While held: Escape, the backdrop and the (disabled) cancel leave it open.
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await calendarPage.cancelRosterRemoveIn(confirm).click({ force: true });
    await expect(confirm).toBeVisible();
    await expect(detail).toBeAttached();
    // Another admin's removal lands meanwhile; the answer is then P0002.
    await removeRosterOverridesInSql(rotation, fixture.team.id, rotation.today);
    release();

    await expect(confirm).toHaveCount(0);
    await expect(detail).toBeVisible();
    await expect(calendarPage.alertIn(detail)).toHaveText(kalendar.detail.rosterChange.refused.gone);
    // The re-read shows the day as it is: no change, the default roster.
    await expect(block).toHaveCount(0);
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);
    await expect(cell).not.toContainText('\u270E');
    await page.unroute(removal);
  });

  test('lists a seeded inert change apart, and removes it', async ({ calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // The member on no team is not on the roster, so taking him off applies to nothing.
    await seedRosterOverride(rotation, fixture.team.id, rotation.today, fixture.spare.name, null, ROSTER_REASON);
    const removed = fill(kalendar.detail.rosterChange.removed, { name: fixture.spare.name });

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).not.toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const inert = calendarPage.rosterInertIn(detail);
    await expect(inert).toBeVisible();
    await expect(inert).toContainText(removed);
    await expect(inert).toContainText(fill(kalendar.detail.override.reason, { reason: ROSTER_REASON }));
    await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);

    await calendarPage.rosterRemoveIn(inert).click();
    const confirm = calendarPage.rosterRemoveConfirmOf(removed, fixture.team.name, rotation.today);
    await expect(confirm).toBeVisible();
    await calendarPage.confirmRosterRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(inert).toHaveCount(0);
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.rosterChange.removedDone);
    const form = await calendarPage.openRosterFormIn(detail);
    await expect(calendarPage.memberOptionIn(calendarPage.rosterInIn(form), fixture.spare.name)).toHaveCount(1);
  });
});

test.describe('the roster form at 390 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('a working day opens the roster dialog, and the page never scrolls sideways', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await calendarPage.goto(gridMonthOf(rotation.today));
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).tap();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(calendarPage.rosterOpenerIn(detail)).toBeVisible();
    await expectNoHorizontalScroll(page);
    const form = await calendarPage.openRosterFormIn(detail);
    await expect(calendarPage.rosterSaveIn(form)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('the roster form at 390 px, as a member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('offers a member-role account no form, no removal and no inert block', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // An inert change: the member on no team taken off a shift he is not on.
    await seedRosterOverride(rotation, fixture.team.id, rotation.today, fixture.spare.name, null, ROSTER_REASON);

    await calendarPage.goto();
    await calendarPage.openerIn(calendarPage.today).tap();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(calendarPage.rosterLinesIn(detail)).toContainText(fixture.member.name);
    await expect(calendarPage.rosterOpenerIn(detail)).toHaveCount(0);
    await expect(calendarPage.overrideOpenerIn(detail)).toHaveCount(0);
    await expect(calendarPage.conflictsIn(detail)).toHaveCount(0);
    await expect(calendarPage.rosterRemoveIn(detail)).toHaveCount(0);
    await expect(calendarPage.rosterInertIn(detail)).toHaveCount(0);
    await expect(detail).not.toContainText(fixture.spare.name);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('an admin sets and removes a shift-type override at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('sets Noć on today from the detail, then removes it through the neutral confirmation', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Today projects the first step (Dan); the admin sets the second (Noć).
    const projected = expectedType(rotation, rotation.today);
    const worked = rotation.steps[1];
    expect(projected).not.toBe(worked);

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).not.toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(detail.locator('form')).toHaveCount(0);
    await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);
    const form = await calendarPage.openOverrideFormIn(detail);
    // The projected type is not offered.
    await expect(calendarPage.overrideTypeIn(form).locator('option', { hasText: projected })).toHaveCount(0);
    // Nothing is chosen yet, so *Što se mijenja* says nothing; then it follows the type chosen, before any save.
    await expect(calendarPage.overrideTypeIn(form)).toHaveValue('');
    await expect(calendarPage.previewIn(form)).toBeEmpty();
    await calendarPage.overrideTypeIn(form).selectOption({ label: worked });
    await expect(calendarPage.previewIn(form)).toContainText(kalendar.detail.preview.heading);
    await expect(calendarPage.previewIn(form)).toContainText(new RegExp(`→ ${escapeRegExp(worked)}`));

    // WHILE THE INSERT IS IN FLIGHT, Escape, the backdrop and the close
    // button close nothing. Every override written here is of a seeded type,
    // so the `afterEach`'s `removeSeededRotation` deletes it even when a step
    // below fails.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The insert alone is held: a CORS preflight passes at once.
    const insert = '**/rest/v1/shift_type_overrides*';
    await page.route(insert, async (route) => {
      if (route.request().method() === 'POST') await held;
      await route.continue();
    });
    await calendarPage.fillOverrideIn(form, worked, REASON);
    await expect(calendarPage.overrideSaveIn(form)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await calendarPage.overrideCloseIn(form).click();
    await expect(form).toBeVisible();
    await expect(detail).toBeVisible();
    release();

    // Set: the block and the removal replace the form, and the cell is marked.
    const block = calendarPage.overrideIn(detail);
    await expect(block).toBeVisible();
    await page.unroute(insert);
    await expect(block).toContainText(fill(kalendar.detail.override.projected, { type: projected }));
    await expect(block).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    await expect(block).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.override.saved);
    await expect(calendarPage.overrideForm).toHaveCount(0);
    await expect(calendarPage.overrideOpenerIn(detail)).toHaveCount(0);
    const remove = calendarPage.overrideRemoveIn(detail);
    await expect(remove).toBeFocused();
    await expect(cell).toContainText(worked);
    await expect(cell).toContainText('\u270E');

    // Remove: one neutral confirmation naming the team, the date and the type restored.
    await remove.click();
    const confirm = calendarPage.removeConfirmOf(fixture.team.name, rotation.today, projected);
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('.bg-destructive, .text-destructive, .border-destructive')).toHaveCount(0);
    // Its cancel keeps the override.
    await calendarPage.cancelRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(block).toBeVisible();
    await expect(remove).toBeFocused();
    await remove.click();
    await calendarPage.confirmRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(block).toHaveCount(0);
    await expect(calendarPage.overrideOpenerIn(detail)).toBeVisible();
    await expect(calendarPage.overrideOpenerIn(detail)).toBeFocused();
    await expect(calendarPage.statusIn(detail)).toHaveText(
      fill(kalendar.detail.override.removed, { type: projected }),
    );

    // The cell is back to its projection.
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await expect(cell).toContainText(projected);
    await expect(cell).not.toContainText('\u270E');
  });

  test('no type chosen is refused with its own words, without a request, and focuses the type', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/shift_type_overrides')) writes.push(request.method());
    });

    await calendarPage.goto(gridMonthOf(rotation.today));
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const form = await calendarPage.openOverrideFormIn(detail);
    await calendarPage.overrideReasonIn(form).fill(REASON);
    await calendarPage.overrideSaveIn(form).click();

    await expect(calendarPage.alertIn(form)).toHaveText(kalendar.detail.override.refused.type);
    await expect(calendarPage.overrideTypeIn(form)).toBeFocused();
    await expect(calendarPage.overrideReasonIn(form)).toHaveValue(REASON);
    expect(writes, 'a refused preflight sent a request').toEqual([]);
  });

  test('a blank reason is refused without a request, keeps the type chosen and focuses the reason', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const worked = rotation.steps[1];
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/rest/v1/shift_type_overrides')) writes.push(request.method());
    });

    await calendarPage.goto(gridMonthOf(rotation.today));
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    const form = await calendarPage.setOverrideIn(detail, worked, '   ');

    await expect(calendarPage.alertIn(form)).toHaveText(kalendar.detail.override.refused.reason);
    await expect(calendarPage.overrideTypeIn(form).locator('option:checked')).toHaveText(worked);
    await expect(calendarPage.overrideReasonIn(form)).toHaveValue('   ');
    await expect(calendarPage.overrideReasonIn(form)).toBeFocused();
    await expect(calendarPage.overrideIn(detail)).toHaveCount(0);
    expect(writes, 'a refused preflight sent a request').toEqual([]);

    // Closed and reopened, the day carries no refusal of the last visit.
    await page.keyboard.press('Escape');
    await expect(calendarPage.overrideForm).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    await (await calendarPage.cellOf(fixture.team.name, rotation.today)).click();
    await expect(detail).toBeVisible();
    await expect(calendarPage.alertIn(detail)).toHaveCount(0);
  });

  test('a removal answered P0002 holds its confirmation while in flight, then says gone and shows the day as it is', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    // Seeded in SQL on a seeded type: the `afterEach` deletes it whatever happens.
    await seedShiftTypeOverride(rotation, fixture.team.id, rotation.today, 1, REASON);
    const projected = expectedType(rotation, rotation.today);

    await calendarPage.goto(gridMonthOf(rotation.today));
    const cell = await calendarPage.cellOf(fixture.team.name, rotation.today);
    await expect(cell).toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await calendarPage.overrideRemoveIn(detail).click();
    const confirm = calendarPage.removeConfirmOf(fixture.team.name, rotation.today, projected);
    await expect(confirm).toBeVisible();

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const removal = '**/rest/v1/rpc/remove_shift_type_override*';
    await page.route(removal, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();

        return;
      }
      await held;
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'P0002', message: 'SHIFT_TYPE_OVERRIDE_NOT_LIVE', details: null, hint: null }),
      });
    });
    await calendarPage.confirmRemoveIn(confirm).click();
    // While held: Escape, the backdrop and the (disabled) cancel leave it open.
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await calendarPage.cancelRemoveIn(confirm).click({ force: true });
    await expect(confirm).toBeVisible();
    await expect(detail).toBeAttached();
    // Another admin's removal lands meanwhile; the answer is then P0002.
    await removeOverrideInSql(rotation, fixture.team.id, rotation.today);
    release();

    await expect(confirm).toHaveCount(0);
    await expect(detail).toBeVisible();
    await expect(calendarPage.alertIn(detail)).toHaveText(kalendar.detail.override.refused.gone);
    // The re-read shows the day as it is: no override, the form offered again.
    await expect(calendarPage.overrideIn(detail)).toHaveCount(0);
    await expect(calendarPage.overrideOpenerIn(detail)).toBeVisible();
    await expect(cell).not.toContainText('\u270E');
    await page.unroute(removal);
  });
});

test.describe('the override form at 390 px, as a member', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('offers a member-role account no form and no removal in the detail', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const tomorrow = addDays(rotation.today, 1);
    await seedShiftTypeOverride(rotation, fixture.team.id, tomorrow, 1, REASON);

    await calendarPage.goto();
    await calendarPage.openerIn(calendarPage.today).tap();
    const detail = calendarPage.detailOf(fixture.team.name, rotation.today);
    await expect(detail).toBeVisible();
    await expect(calendarPage.overrideOpenerIn(detail)).toHaveCount(0);
    await expect(calendarPage.overrideTypeIn(detail)).toHaveCount(0);
    await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);
    await expect(detail.locator('form')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    // An overridden day too: the block, and still no removal.
    await calendarPage.goto(`?prikaz=sve&mjesec=${tomorrow.slice(0, 7)}`);
    await (await calendarPage.cellOf(fixture.team.name, tomorrow)).click();
    const overridden = calendarPage.detailOf(fixture.team.name, tomorrow);
    await expect(calendarPage.overrideIn(overridden)).toBeVisible();
    await expect(calendarPage.overrideRemoveIn(overridden)).toHaveCount(0);
    await expect(calendarPage.overrideOpenerIn(overridden)).toHaveCount(0);
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

/** `Prikazano: sve smjene (4)` — the unfiltered summary up to its person count. */
function summaryAllOf(columns: number): string {
  return fill(filterWords.summary.all.split(' · ')[0] ?? '', { teams: String(columns) });
}

/** `Prikazano: Smjena B · ` — the team summary up to its counts. */
function summaryTeamOf(team: string): string {
  return `${fill(filterWords.summary.team.split(' · ')[0] ?? '', { team })} · `;
}

test.describe('the team filter at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('narrows the grid to one team, says so, keeps it across months, and clears in one press', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    // The run organization may hold teams other specs created: count, never assume.
    const columns = await calendarPage.columnCount();
    expect(columns).toBeGreaterThan(0);
    const team = searchParamPattern('smjena', fixture.team.id);
    const filters = calendarPage.filters;

    // Two chips, both `sve`, no ✕ and no `Poništi filtre`; the summary says all.
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(null));
    await expect(filters.personChip).toHaveAccessibleName(filters.personChipText(null));
    await expect(filters.teamChip).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(filters.teamChip).toHaveAttribute('aria-expanded', 'false');
    await expect(filters.summary).toContainText(summaryAllOf(columns));
    await expect(filters.clearButton).toHaveCount(0);

    // The Smjena picker: `Sve smjene (N)` chosen, every team with its count.
    await filters.teamChip.click();
    await expect(filters.teamPicker).toBeVisible();
    await expect(filters.teamChip).toHaveAttribute('aria-expanded', 'true');
    await expect(filters.allTeamsOption(columns)).toHaveAttribute('aria-pressed', 'true');
    await expect(filters.allTeamsOption(columns)).toBeFocused();
    await expect(filters.teamOptions).toHaveCount(columns);
    await expect(filters.teamOption(fixture.team.name)).toHaveCount(1);
    // Escape closes it, focus back on the chip.
    await page.keyboard.press('Escape');
    await expect(filters.teamPicker).toHaveCount(0);
    await expect(filters.teamChip).toBeFocused();

    // Choosing a team narrows the grid, says so, and resets the tab stop to today.
    await calendarPage.moveTabStopOffToday();
    await filters.chooseTeam(fixture.team.name);
    await expect(page).toHaveURL(team);
    await expect(calendarPage.headerCells).toHaveCount(2);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(fixture.team.name));
    await expect(filters.teamChip).toBeFocused();
    await expect(filters.removeTeam(fixture.team.name)).toBeVisible();
    await expect(filters.summary).toContainText(summaryTeamOf(fixture.team.name));
    await expect(filters.clearButton).toBeVisible();
    await expectTabStopOnToday(calendarPage);

    // The ✕ drops the team, and focus moves to the next chip, Osoba.
    await filters.removeTeam(fixture.team.name).click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(filters.personChip).toBeFocused();
    await expect(filters.clearButton).toHaveCount(0);

    // `Poništi filtre` brings every column back, on /kalendar, focus on the
    // first chip rather than <body>, and the tab stop on today.
    await filters.chooseTeam(fixture.team.name);
    await expect(page).toHaveURL(team);
    await calendarPage.moveTabStopOffToday();
    await filters.clearButton.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(/\/kalendar(\?|$)/);
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(null));
    await expect(filters.clearButton).toHaveCount(0);
    await expect(filters.teamChip).toBeFocused();
    await expectTabStopOnToday(calendarPage);

    // The next month keeps the team: the heading moves, the filter stays.
    await filters.chooseTeam(fixture.team.name);
    await expect(page).toHaveURL(team);
    const heading = calendarPage.monthHeading();
    const thisMonth = (await heading.innerText()).trim();
    await calendarPage.nextButton.click();
    await expect(heading).not.toHaveText(thisMonth);
    await expect(page).toHaveURL(anySearchParamPattern('mjesec'));
    await expect(page).toHaveURL(team);
    await expect(calendarPage.headerCells).toHaveCount(2);
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(fixture.team.name));

    // `Poništi filtre` there drops the team and keeps the month, and Back
    // undoes the clear: the team is back.
    const mjesec = new URL(page.url()).searchParams.get('mjesec') ?? '';
    expect(mjesec).toMatch(/^\d{4}-\d{2}$/);
    await filters.clearButton.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(searchParamPattern('mjesec', mjesec));
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(filters.teamChip).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(team);
    await expect(calendarPage.headerCells).toHaveCount(2);
  });

  test('an unknown team id shows every column, reads as `sve`, and offers no ✕', async ({ page, calendarPage, fixture }) => {
    const unknown = randomUUID();
    await calendarPage.goto(`?smjena=${unknown}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const filters = calendarPage.filters;
    const columns = await calendarPage.columnCount();
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(null));
    await expect(filters.summary).toContainText(summaryAllOf(columns));
    await expect(filters.clearButton).toHaveCount(0);
    // Silently ignored, and left in the URL.
    await expect(page).toHaveURL(searchParamPattern('smjena', unknown));
  });

  test('Moj raspored ignores the team, shows no filter, and keeps it in the URL', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto(`?prikaz=moj&smjena=${fixture.team.id}`);
    await expect(calendarPage.modes().moj).toHaveAttribute('aria-pressed', 'true');
    await expect(calendarPage.monthHeading(/\d{4}$/)).toBeVisible();
    await expect(calendarPage.filters.bar).toHaveCount(0);
    await expect(calendarPage.filters.summary).toHaveCount(0);
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
  });
});

test.describe('the person filter at 1280 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test("a person replaces the team: their day list in place of the grid, kept across months, cleared by ✕", async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const columns = await calendarPage.columnCount();
    const filters = calendarPage.filters;

    // The Osoba picker: a search, every person grouped by team, the spare under Bez smjene.
    await filters.chooseTeam(fixture.team.name);
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
    await filters.personChip.click();
    await expect(filters.personPicker).toBeVisible();
    await expect(filters.personSearch).toBeFocused();
    for (const person of [fixture.admin, fixture.member, fixture.spare]) {
      await expect(filters.personOption(person.name), person.name).toHaveCount(1);
    }
    await expect(filters.personGroup(fixture.team.name)).toBeVisible();
    await expect(filters.personGroup(filterWords.noTeam)).toBeVisible();
    // The search filters live, and says how many of all it shows.
    await filters.personSearch.fill(fixture.member.name);
    await expect(filters.personOption(fixture.member.name)).toBeVisible();
    await expect(filters.personOption(fixture.spare.name)).toHaveCount(0);
    await expect(filters.personPicker.locator(filters.matchesOf(1))).toBeVisible();

    // Choosing her drops the team: her day list headed with her name, no grid,
    // the Smjena chip hidden, and the summary names her team.
    await filters.personOption(fixture.member.name).click();
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    const osoba = new URL(page.url()).searchParams.get('osoba') ?? '';
    expect(osoba).not.toBe('');
    await expect(filters.personPicker).toHaveCount(0);
    await expect(filters.personChip).toBeFocused();
    await expect(filters.personChip).toHaveAccessibleName(filters.personChipText(fixture.member.name));
    await expect(filters.teamChip).toHaveCount(0);
    await expect(filters.summary).toHaveText(
      fill(filterWords.summary.person, { person: fixture.member.name, team: fixture.team.name }),
    );
    await expect(calendarPage.personHeading(fixture.member.name)).toBeVisible();
    const list = calendarPage.personListOf(fixture.member.name);
    await expect(list).toBeVisible();
    await expect(list).toHaveAccessibleName(
      `${fixture.member.name} ${(await calendarPage.monthHeading().innerText()).trim()}`,
    );
    await expect(calendarPage.anyGrid).toHaveCount(0);

    // The next month keeps her.
    const heading = calendarPage.monthHeading();
    const thisMonth = (await heading.innerText()).trim();
    await calendarPage.nextButton.click();
    await expect(heading).not.toHaveText(thisMonth);
    await expect(page).toHaveURL(anySearchParamPattern('mjesec'));
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
    await expect(calendarPage.personListOf(fixture.member.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);

    // Her ✕ returns the whole grid, keeps the month, and focus lands on the
    // Smjena chip, drawn again.
    const mjesec = new URL(page.url()).searchParams.get('mjesec') ?? '';
    await filters.removePerson(fixture.member.name).click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).toHaveURL(searchParamPattern('mjesec', mjesec));
    await expect(calendarPage.headerCells).toHaveCount(columns + 1);
    await expect(filters.teamChip).toBeFocused();
    await expect(filters.clearButton).toHaveCount(0);
  });

  test('Poništi filtre with a person chosen puts focus on the Smjena chip it brings back', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const filters = calendarPage.filters;

    await filters.choosePerson(fixture.member.name);
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(filters.teamChip).toHaveCount(0);
    await filters.clearButton.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    // Focus waits for the re-render: the Smjena chip, drawn again, never Osoba.
    await expect(filters.teamChip).toBeFocused();
  });

  test('the pickers move by ↑ ↓ Home End, and ↓ from the search enters the list', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const filters = calendarPage.filters;
    const columns = await calendarPage.columnCount();

    await filters.teamChip.click();
    const all = filters.allTeamsOption(columns);
    const teams = filters.teamOptions;
    await expect(all).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(teams.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(teams.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(all).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(all).toBeFocused();
    // One tab stop: the option focused is the only one Tab reaches.
    await expect(filters.teamPicker.locator('button[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(filters.teamChip).toBeFocused();

    await filters.personChip.click();
    await expect(filters.personSearch).toBeFocused();
    await filters.personSearch.fill(fixture.member.name);
    await page.keyboard.press('ArrowDown');
    // The tab stop is `Sve osobe` (nobody chosen), and ↓ moves on to her.
    await page.keyboard.press('ArrowDown');
    await expect(filters.personOption(fixture.member.name)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(filters.personChip).toBeFocused();
  });

  test('forgets the grid tab stop when a person is chosen and the filters cleared', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();

    await calendarPage.moveTabStopOffToday();
    await calendarPage.filters.choosePerson(fixture.member.name);
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await calendarPage.filters.clearButton.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expectTabStopOnToday(calendarPage);
  });

  test('a person on no team all month is explained, never an empty list', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    await held(fixture.slug);
    await calendarPage.goto();

    await calendarPage.filters.choosePerson(fixture.spare.name);
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.personHeading(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.personNoTeam(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.personListOf(fixture.spare.name)).toHaveCount(0);
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expect(calendarPage.filters.summary).toHaveText(
      fill(filterWords.summary.personNoTeam, { person: fixture.spare.name }),
    );
  });

  test('an unknown person id is ignored: the grid, and both chips `sve`', async ({ page, calendarPage, fixture }) => {
    const unknown = randomUUID();
    await calendarPage.goto(`?osoba=${unknown}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    await expect(calendarPage.filters.personChip).toHaveAccessibleName(calendarPage.filters.personChipText(null));
    await expect(calendarPage.filters.teamChip).toHaveAccessibleName(calendarPage.filters.teamChipText(null));
    await expect(calendarPage.filters.clearButton).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('osoba', unknown));
  });
});

test.describe('the filter bar while the month loads', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('is omitted until the month is shown: the toolbar stands in, the skeleton below', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/rest/v1/organizations*', async (route) => {
      await gate;
      await route.continue();
    });
    await calendarPage.goto('?prikaz=sve');

    await expect(page.locator('main[aria-busy="true"]')).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);
    await expect(calendarPage.filters.bar).toHaveCount(0);
    await expect(calendarPage.filters.summary).toHaveCount(0);

    release();
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    await expect(calendarPage.filters.bar).toBeVisible();
    await expect(calendarPage.filters.summary).toBeVisible();
  });
});

test.describe('the person filter in Moj raspored', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('Moj raspored ignores the person, shows no filter, and keeps it in the URL', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto();
    await calendarPage.filters.choosePerson(fixture.member.name);
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    const osoba = new URL(page.url()).searchParams.get('osoba') ?? '';
    expect(osoba).not.toBe('');

    await calendarPage.goto(`?prikaz=moj&osoba=${osoba}`);
    await expect(calendarPage.modes().moj).toHaveAttribute('aria-pressed', 'true');
    await expect(calendarPage.monthHeading(/\d{4}$/)).toBeVisible();
    await expect(calendarPage.filters.bar).toHaveCount(0);
    await expect(calendarPage.personHeading(fixture.member.name, { exact: false })).toHaveCount(0);
    await expect(page).toHaveURL(searchParamPattern('osoba', osoba));
  });
});

test.describe('the person filter for a member-role account', () => {
  test.use({ storageState: MEMBER_STATE, viewport: { width: 1280, height: 800 } });

  test('lists the colleagues in the Osoba picker', async ({ page, calendarPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    await held(fixture.slug);
    await calendarPage.goto('?prikaz=sve');
    const filters = calendarPage.filters;
    await filters.personChip.click();
    for (const person of [fixture.admin, fixture.member, fixture.spare]) {
      await expect(filters.personOption(person.name), person.name).toHaveCount(1);
    }
    // Every option is a name and nothing else: no address, no username.
    for (const text of await filters.personPicker.getByRole('button').allInnerTexts()) {
      expect(text).not.toMatch(/@|e2e\./);
    }

    // A colleague's month — the reading `calendar_members()` exists for.
    await filters.personOption(fixture.admin.name).click();
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await expect(calendarPage.personHeading(fixture.admin.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);

    await filters.choosePerson(fixture.spare.name);
    await expect(calendarPage.personHeading(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.personNoTeam(fixture.spare.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);
  });
});

test.describe('the filters on a phone', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('Filtri opens a sheet whose choices write the URL at once, and the active chip stays above the content', async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const filters = calendarPage.filters;
    const columns = await calendarPage.columnCount();

    // Only active chips show: none yet, and `Filtri` carries no number.
    await expect(filters.filtriButton).toHaveAccessibleName(filterWords.open);
    await expect(filters.teamChip).toBeHidden();
    await expect(filters.personChip).toBeHidden();

    await filters.filtriButton.click();
    await expect(filters.sheet).toBeVisible();
    await expect(filters.replaceNote).toBeVisible();
    await expect(filters.sheet.getByRole('radio', { name: fill(filterWords.allTeams, { count: String(columns) }) })).toBeChecked();

    // Choosing a team writes the URL at once, and `Prikaži` counts its people.
    const before = await filters.sheetShowAny.innerText();
    await filters.sheetTeam(fixture.team.name).check();
    await expect(page).toHaveURL(searchParamPattern('smjena', fixture.team.id));
    await expect(filters.sheetTeam(fixture.team.name)).toBeChecked();
    await expect(filters.sheetShowAny).not.toHaveText(before);

    // Escape closes it, focus on `Filtri`, which now counts one.
    await page.keyboard.press('Escape');
    await expect(filters.sheet).toBeHidden();
    await expect(filters.filtriButton).toBeFocused();
    await expect(filters.filtriButton).toHaveAccessibleName(fill(filterWords.openCount, { count: '1' }));
    // The active chip stays visible, with its ✕, above the grid.
    await expect(filters.teamChip).toBeVisible();
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(fixture.team.name));
    await expect(filters.removeTeam(fixture.team.name)).toBeVisible();
    await expect(filters.personChip).toBeHidden();
    const chipBox = await filters.teamChip.boundingBox();
    const gridBox = await calendarPage.grid.boundingBox();
    expect(chipBox!.y).toBeLessThan(gridBox!.y);
    await expectNoHorizontalScroll(page);

    // Back works: each choice was its own entry.
    await page.goBack();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(filters.teamChip).toBeHidden();

    // `Prikaži …` closes the sheet.
    await filters.filtriButton.click();
    await filters.sheetPerson(fixture.member.name).click();
    await expect(page).toHaveURL(anySearchParamPattern('osoba'));
    await filters.sheetShow(1).click();
    await expect(filters.sheet).toBeHidden();
    await expect(filters.personChip).toHaveAccessibleName(filters.personChipText(fixture.member.name));
  });
});

test.describe('the filters on a phone, after a change', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test('✕ on the only active chip moves focus to Filtri, never to the page', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto(`?prikaz=sve&smjena=${fixture.team.id}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const filters = calendarPage.filters;

    await filters.removeTeam(fixture.team.name).click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(filters.teamChip).toBeHidden();
    await expect(filters.filtriButton).toBeFocused();
  });

  test("the sheet's Poništi clears both and updates Prikaži, and reopening starts with an empty search", async ({
    page,
    calendarPage,
    fixture,
  }) => {
    await calendarPage.goto(`?prikaz=sve&smjena=${fixture.team.id}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const filters = calendarPage.filters;

    await filters.filtriButton.click();
    await expect(filters.sheet).toBeVisible();
    // A phone's chip says it opened the sheet.
    await expect(filters.filtriButton).toHaveAttribute('aria-expanded', 'true');
    const narrowed = await filters.sheetShowAny.innerText();
    await filters.sheetReset.click();
    await expect(page).not.toHaveURL(anySearchParamPattern('smjena'));
    await expect(page).not.toHaveURL(anySearchParamPattern('osoba'));
    await expect(filters.sheetShowAny).not.toHaveText(narrowed);

    // Type into the search, close, reopen: the search is empty again.
    // (Escape in a search with text first clears the text, as the browser does.)
    await filters.personSearch.fill(fixture.member.name);
    await filters.sheet.getByRole('button', { name: filterWords.sheetClose, exact: true }).click();
    await expect(filters.sheet).toBeHidden();
    await filters.filtriButton.click();
    await expect(filters.sheet).toBeVisible();
    await expect(filters.personSearch).toHaveValue('');
    await expect(filters.sheetPerson(fixture.spare.name)).toBeVisible();
  });

  test('an active chip opens the sheet and says so', async ({ calendarPage, fixture }) => {
    await calendarPage.goto(`?prikaz=sve&smjena=${fixture.team.id}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const filters = calendarPage.filters;

    await expect(filters.teamChip).toHaveAttribute('aria-expanded', 'false');
    await filters.teamChip.click();
    await expect(filters.sheet).toBeVisible();
    await expect(filters.teamChip).toHaveAttribute('aria-expanded', 'true');
    const controls = await filters.teamChip.getAttribute('aria-controls');
    expect(controls).not.toBeNull();
    await expect(filters.sheet).toHaveAttribute('id', controls ?? '');
  });

  test('the sheet closes when the viewport turns wide', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const filters = calendarPage.filters;

    await filters.filtriButton.click();
    await expect(filters.sheet).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(filters.sheet).toBeHidden();
    await expect(filters.teamChip).toBeVisible();
  });
});

test.describe('the filters on a wide screen turning narrow', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('an open picker closes when the viewport turns narrow', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto('?prikaz=sve');
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeVisible();
    const filters = calendarPage.filters;

    await filters.teamChip.click();
    await expect(filters.teamPicker).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(filters.teamPicker).toHaveCount(0);
  });
});

test.describe('the team filter at 320 px', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 320, height: 720 } });

  test('never scrolls the page sideways, and Filtri, the chip and its ✕ are touch targets', async ({ page, calendarPage, fixture }) => {
    await calendarPage.goto(`?prikaz=sve&smjena=${fixture.team.id}`);
    await expect(calendarPage.columnHeader(fixture.team.name)).toBeAttached();
    const filters = calendarPage.filters;
    await expect(filters.teamChip).toHaveAccessibleName(filters.teamChipText(fixture.team.name));
    const remove = filters.removeTeam(fixture.team.name);
    await expect(remove).toBeVisible();

    for (const target of [filters.filtriButton, filters.teamChip, remove, filters.clearButton]) {
      const box = await target.boundingBox();
      expect(box, 'a target has no box').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
      expect(box!.height).toBeGreaterThanOrEqual(MINIMUM_TARGET - 0.5);
    }
    await expectNoHorizontalScroll(page);
    await expectTouchTargets(page);
  });
});

test.describe('an override a rotation change left pending, at 1280 px, as an admin', () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

  test('the day shows the projection with no ✎, and the detail says the override waits for review', async ({
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // STORY 3.5c. An override on D+3, then a change from D+1 saved after it:
    // the new version anchors D+1 on the third step, so D+3 projects the
    // first (Dan) where the override names the second (Noć).
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const date = addDays(rotation.today, 3);
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, date, 1, REASON);
    await seedRotationChange(rotation, fixture.team.id, addDays(rotation.today, 1), 2);
    const projected = rotation.steps[0];
    expect(projected).not.toBe(override.typeName);

    await calendarPage.goto(gridMonthOf(date));
    const cell = await calendarPage.cellOf(fixture.team.name, date);
    await expect(cell).toContainText(projected);
    await expect(cell).not.toContainText('\u270E');

    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, date);
    await expect(detail).toBeVisible();
    await expect(calendarPage.overrideIn(detail)).toHaveCount(0);
    const pending = calendarPage.pendingOverrideIn(detail);
    await expect(pending).toBeVisible();
    await expect(pending).toContainText(fill(kalendar.detail.override.pending.type, { type: override.typeName }));
    await expect(pending).toContainText(fill(kalendar.detail.override.reason, { reason: REASON }));
    await expect(pending).toContainText(fill(kalendar.detail.override.author, { name: fixture.admin.name }));
    // The admin may only remove it here; no set form.
    const remove = calendarPage.overrideRemoveIn(detail);
    await expect(remove).toBeVisible();
    await expect(calendarPage.overrideOpenerIn(detail)).toHaveCount(0);

    // Removed through the pending copy: the day already shows the projection.
    await remove.click();
    const confirm = calendarPage.pendingRemoveConfirmOf(fixture.team.name, date);
    await expect(confirm).toBeVisible();
    await expect(confirm.locator('.bg-destructive, .text-destructive, .border-destructive')).toHaveCount(0);
    await calendarPage.confirmRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(pending).toHaveCount(0);
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.override.pending.removed);
    // With nothing pending, the type dialog's opener is back.
    await expect(calendarPage.overrideOpenerIn(detail)).toBeVisible();
    await calendarPage.closeIn(detail).click();
    await expect(cell).toContainText(projected);
    await expect(cell).not.toContainText('\u270E');
  });

  test('an override before the team\'s first version is pending on a day with no rotation, and can be removed', async ({
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const date = addDays(rotation.today, -2);
    const override = await seedShiftTypeOverride(rotation, fixture.team.id, date, 1, REASON);

    await calendarPage.goto(gridMonthOf(date));
    const cell = await calendarPage.cellOf(fixture.team.name, date);
    await expect(cell).not.toContainText('\u270E');
    await cell.click();
    const detail = calendarPage.detailOf(fixture.team.name, date);
    await expect(detail).toContainText(fill(kalendar.detail.noRotation, { team: fixture.team.name }));
    const pending = calendarPage.pendingOverrideIn(detail);
    await expect(pending).toContainText(fill(kalendar.detail.override.pending.type, { type: override.typeName }));
    await expect(calendarPage.overrideOpenerIn(detail)).toHaveCount(0);

    await calendarPage.overrideRemoveIn(detail).click();
    const confirm = calendarPage.pendingRemoveConfirmOf(fixture.team.name, date);
    await calendarPage.confirmRemoveIn(confirm).click();
    await expect(confirm).toHaveCount(0);
    await expect(pending).toHaveCount(0);
    await expect(calendarPage.statusIn(detail)).toHaveText(kalendar.detail.override.pending.removed);
    await expect(calendarPage.overrideRemoveIn(detail)).toHaveCount(0);
  });
});
