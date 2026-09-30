import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeSeededRotation,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 4.1b: *Sati*, the viewer's own month of hours. The fixture team gets
 * a rotation from today in SQL (`seedTeamRotation`: `[Dan, Noć, Slobodno,
 * Slobodno]`, 12 h each working step), under the run's rotation hold, and the
 * member on that team reads a non-zero total equal to the seeded shifts left
 * in the month times 12 h, with the same count, each band's own hours and
 * shifts, band hours summing to the total, and no untimed note. The admin, on
 * no team, reads 0 h while that team works. A bad `mjesec` falls back to the current month, and
 * the screen does not scroll sideways at 390 px.
 */

const sati = hr.sati;
const hours = hr.organization.hourBands.duration.hours;

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

const DAY_MS = 86_400_000;

/**
 * The days of `month` (`YYYY-MM`) on which the seeded pattern, starting on
 * `today`, is at `step` (0 `Dan`, 1 `Noć`, 2 and 3 `Slobodno`); none before it.
 */
function daysAtStep(month: string, today: string, step: number): number {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const start = Date.parse(`${today}T12:00:00Z`);
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  let count = 0;

  for (let day = 1; day <= days; day += 1) {
    const offset = Math.round((Date.UTC(year, index - 1, day, 12) - start) / DAY_MS);

    if (offset >= 0 && offset % 4 === step) count += 1;
  }

  return count;
}

/** The working shifts of `month`: the `Dan` and `Noć` days. */
function workingShiftsIn(month: string, today: string): number {
  return daysAtStep(month, today, 0) + daysAtStep(month, today, 1);
}

/** Minutes of a figure as a row reads it: `12 h`, `12 h 30 min`, `45 min`, or `null`. */
function minutesOfFigure(text: string): number | null {
  const found = /^(?:(\d+) h)?\s*(?:(\d+) min)?$/.exec(text.trim());

  if (found === null || (found[1] === undefined && found[2] === undefined)) return null;

  return Number(found[1] ?? 0) * 60 + Number(found[2] ?? 0);
}

/** The month after `month`, `YYYY-MM`. */
function nextMonth(month: string): string {
  const [year, index] = month.split('-').map(Number) as [number, number];

  return new Date(Date.UTC(year, index, 15)).toISOString().slice(0, 7);
}

/** `12 h`, as a figure reads. */
function hoursOf(shifts: number): string {
  return fill(hours, { hours: String(shifts * 12) });
}

/** `Listopad 2026` — the heading a month carries. */
function monthHeading(date: string): string {
  const name = new Intl.DateTimeFormat('hr', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 7)}-15T12:00:00Z`),
  );

  return fill(hr.kalendar.monthHeading, {
    month: `${name.charAt(0).toLocaleUpperCase('hr')}${name.slice(1)}`,
    year: date.slice(0, 4),
  });
}

test.describe('as a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('the month shows a non-zero total equal to the seeded shifts times 12 h, split by band', async ({
    hoursPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const month = rotation.today.slice(0, 7);
    const dan = daysAtStep(month, rotation.today, 0);
    const noc = daysAtStep(month, rotation.today, 1);
    const shifts = dan + noc;
    expect(shifts, 'the seeded month holds a working shift').toBeGreaterThan(0);

    await hoursPage.goto();
    await expect(hoursPage.heading(hr.nav.sati)).toBeVisible();
    await expect(hoursPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    await expect(hoursPage.figureIn(hoursPage.totalTile, hoursOf(shifts))).toBeVisible();
    await expect(hoursPage.figureIn(hoursPage.shiftsTile, plural(sati.shiftCount, shifts))).toBeVisible();

    // PER BAND, under the run fixture's two bands (Dan from 07:00, Noć from
    // 19:00): the seeded Dan 07:00–19:00 lies wholly in the first and Noć
    // 19:00–07:00 wholly in the second, so neither splits.
    const [danBand, nocBand] = fixture.bands;
    if (danBand === undefined || nocBand === undefined) throw new Error('E2E: the fixture holds two bands');
    const danRow = hoursPage.bandRow(danBand.name);
    const nocRow = hoursPage.bandRow(nocBand.name);
    await expect(danRow).toHaveCount(1);
    await expect(nocRow).toHaveCount(1);
    await expect(hoursPage.figureIn(danRow, hoursOf(dan))).toBeVisible();
    await expect(hoursPage.figureIn(danRow, plural(sati.shiftCount, dan))).toBeVisible();
    await expect(hoursPage.figureIn(nocRow, plural(sati.shiftCount, noc))).toBeVisible();
    // The hour band spec adds bands of its own before 07:00 (01:xx, 03:xx,
    // 05:xx) when the whole suite runs, which only ever shortens Noć's
    // stretch; run with the fixture's two alone, Noć holds every night whole.
    if ((await hoursPage.bandRows.count()) === fixture.bands.length) {
      await expect(hoursPage.figureIn(nocRow, hoursOf(noc))).toBeVisible();
    }

    // The band hours sum to the total, every band row counted.
    const minutes = (await hoursPage.bandHours()).map(minutesOfFigure);
    expect(minutes, 'a band row reads no figure').not.toContain(null);
    expect(minutes.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBe(shifts * 12 * 60);

    await expect(hoursPage.figureIn(hoursPage.leaveRow, hoursOf(0))).toBeVisible();
    // Every seeded shift has times, so no note says otherwise.
    await expect(hoursPage.untimedNote).toHaveCount(0);
    await expect(hoursPage.currentButton).toBeDisabled();
  });

  test('a bad month falls back to the current one, and the phone does not scroll sideways', async ({
    page,
    hoursPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);

    await page.setViewportSize({ width: 390, height: 844 });
    await hoursPage.goto('?mjesec=2026-13');
    await expect(hoursPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
    await expect(
      hoursPage.figureIn(hoursPage.totalTile, hoursOf(workingShiftsIn(rotation.today.slice(0, 7), rotation.today))),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);

    // The next month, through the shared navigation: every day of it projected.
    const next = nextMonth(rotation.today.slice(0, 7));
    await hoursPage.nextButton.click();
    await expect(page).toHaveURL(new RegExp(`mjesec=${next}`));
    await expect(hoursPage.currentButton).toBeEnabled();
    await expect(hoursPage.figureIn(hoursPage.totalTile, hoursOf(workingShiftsIn(next, rotation.today)))).toBeVisible();
    await expectNoHorizontalScroll(page);
    await hoursPage.currentButton.click();
    await expect(hoursPage.monthHeading(monthHeading(rotation.today))).toBeVisible();
  });
});

test.describe('as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin on no team reads their own 0 h, never the organization', async ({ hoursPage, fixture }) => {
    // The member's team works this month, so the organization has hours: the
    // admin's page must still show only the admin's own, none.
    const rotation = await seeded(fixture.slug, fixture.team.id);
    expect(workingShiftsIn(rotation.today.slice(0, 7), rotation.today)).toBeGreaterThan(0);

    await hoursPage.goto();
    await expect(hoursPage.heading(hr.nav.sati)).toBeVisible();
    await expect(hoursPage.figureIn(hoursPage.totalTile, hoursOf(0))).toBeVisible();
    await expect(hoursPage.figureIn(hoursPage.shiftsTile, plural(sati.shiftCount, 0))).toBeVisible();
  });
});
