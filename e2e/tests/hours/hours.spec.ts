import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  holdRotation,
  organizationNameOf,
  removeSeededRotation,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { hoursExportFileName, readXlsx, type XlsxCell } from '../../utils/xlsx.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';
import { HoursPage } from '../../pages/hours.page.ts';

/**
 * Story 4.1b: *Sati*, the viewer's own month of hours. The fixture team gets
 * a rotation from today in SQL (`seedTeamRotation`: `[Dan, Noć, Slobodno,
 * Slobodno]`, 12 h each working step), under the run's rotation hold, and the
 * member on that team reads a non-zero total equal to the seeded shifts left
 * in the month times 12 h, with the same count, each band's own hours and
 * shifts, band hours summing to the total, an empty (`—`) leave, and no
 * untimed note. A bad
 * `mjesec` falls back to the current month, and the screen does not scroll
 * sideways at 390 px. Story 4.2: the admin reads a table of every member,
 * whose row for that member equals what the member reads; it filters by team
 * and by person, sorts by total across a reload, keeps both across a month
 * change, links a name to that member's calendar month, and does not scroll
 * the page sideways at 390 px. Story 4.3: sorted, then filtered, the admin
 * exports the month, and the downloaded `.xlsx` — unzipped and read back —
 * carries the table's headings, rows, order and figures, every figure a
 * number cell and an empty leave an empty cell; a filter that leaves no row closes the export; a writer that
 * cannot load shows the failure and leaves the action usable; a member has
 * no export.
 */

const sati = hr.sati;
const organization = hr.sati.organization;
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

/** A downloaded duration as minutes: a spreadsheet stores one as a fraction of a day. */
function exportedMinutes(cell: XlsxCell | null | undefined): number | null {
  return cell?.type === 'number' ? Math.round(cell.value * 1440) : null;
}

/**
 * Exports what the table shows and holds the file to it (story 4.3): its
 * name, the sheet's, the headings, and every row in order — text as shown,
 * the shift count a number, every hour figure a `[h]:mm` duration equal to
 * the screen's minutes, and an empty figure (`—`) an absent cell. Answers each row's total, in minutes, in file order.
 */
async function expectExportIsTable(hoursPage: HoursPage, fileName: string): Promise<number[]> {
  await expect(hoursPage.exportButton).toBeEnabled();
  const headings = (await hoursPage.columnHeaders.allTextContents()).map((text) => text.trim());
  const shown = await hoursPage.organizationMatrix();
  expect(shown.length, 'the table shows a row').toBeGreaterThan(0);
  const download = await hoursPage.exportDownload();
  expect(download.suggestedFilename()).toBe(fileName);
  const workbook = readXlsx(readFileSync(await download.path()));
  expect(workbook.name).toBe(organization.export.sheetName);
  const [header, ...body] = workbook.rows;
  expect(header?.map((cell) => (cell?.type === 'text' ? cell.value : null))).toEqual(headings);
  expect(body).toHaveLength(shown.length);
  for (const [index, written] of body.entries()) {
    const texts = shown[index] ?? [];
    // The writer may leave out an empty trailing cell. Only the leave, the
    // last column, may be empty, and only where the screen shows `—`: then,
    // and only then, the row is one short, and that one cell is padded.
    const leaveEmpty = headings.at(-1) === organization.leave && texts[headings.length - 1] === sati.noFigure;
    expect(written.length, `cells of row ${String(index)}`).toBe(
      leaveEmpty && written.length === headings.length - 1 ? headings.length - 1 : headings.length,
    );
    const cells = written.length === headings.length ? written : [...written, null];
    expect(cells).toHaveLength(headings.length);
    for (const [column, label] of headings.entries()) {
      const cell = cells[column];
      const text = texts[column] ?? '';
      if (label === organization.member || label === organization.team) {
        expect(cell, `${label} of row ${String(index)}`).toEqual({ type: 'text', value: text });
      } else if (label === organization.shifts) {
        expect(cell, `${label} of row ${String(index)}`).toEqual({
          type: 'number',
          value: Number(/^\d+/.exec(text)?.[0]),
          format: null,
        });
      } else if (label === organization.leave && text === sati.noFigure) {
        // An empty figure (a leave of 0): no cell, never a 0:00.
        expect(cell ?? null, `${label} of row ${String(index)} is empty`).toBeNull();
      } else {
        // A band, the total or a leave: a duration, read back as the screen's minutes.
        expect(cell?.type, `${label} of row ${String(index)} is a number`).toBe('number');
        expect(cell?.type === 'number' ? cell.format : null).toBe('[h]:mm');
        expect(exportedMinutes(cell), `${label} of row ${String(index)}`).toBe(minutesOfFigure(text));
      }
    }
  }
  // THE ORDER IS THE SCREEN'S.
  expect(body.map((cells) => (cells[0]?.type === 'text' ? cells[0].value : null))).toEqual(shown.map((row) => row[0]));
  await expect(hoursPage.exportButton).toBeEnabled();
  await expect(hoursPage.exportFailed).toHaveCount(0);

  return body.map((cells) => exportedMinutes(cells[headings.indexOf(organization.total)]) ?? -1);
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
    // No export for a member-role account, not even of their own hours (story 4.3).
    await expect(hoursPage.exportButton).toHaveCount(0);
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

    // No leave exists before Epic 5: the figure reads empty, never `0 h`.
    await expect(hoursPage.figureIn(hoursPage.leaveRow, sati.noFigure)).toBeVisible();
    await expect(hoursPage.figureIn(hoursPage.leaveRow, hoursOf(0))).toHaveCount(0);
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

  test("the table's row for the member equals what the member reads, and filters, sorts, keeps them across months and links", async ({
    browser,
    page,
    hoursPage,
    calendarPage,
    fixture,
  }) => {
    const rotation = await seeded(fixture.slug, fixture.team.id);
    const month = rotation.today.slice(0, 7);
    expect(workingShiftsIn(month, rotation.today), 'the seeded month holds a working shift').toBeGreaterThan(0);

    // WHAT THE MEMBER READS on their own Sati, in a session of their own:
    // the text actually shown, never a value worked out here.
    const memberContext = await browser.newContext({ storageState: MEMBER_STATE });
    let memberTotal: string;
    let memberShifts: string;
    let memberBandNames: string[];
    let memberBandHours: string[];
    let memberBandShifts: string[];
    try {
      const memberHours = new HoursPage(await memberContext.newPage());
      await memberHours.goto();
      await expect(memberHours.tileValue(sati.total)).toHaveText(/\S/);
      await expect(memberHours.bandNames.first()).toBeVisible();
      memberTotal = ((await memberHours.tileValue(sati.total).textContent()) ?? '').trim();
      memberShifts = ((await memberHours.tileValue(sati.shifts).textContent()) ?? '').trim();
      memberBandNames = (await memberHours.bandNames.allTextContents()).map((text) => text.trim());
      memberBandHours = (await memberHours.bandHourFigures.allTextContents()).map((text) => text.trim());
      memberBandShifts = (await memberHours.bandShiftFigures.allTextContents()).map((text) => text.trim());
    } finally {
      await memberContext.close();
    }
    // Every fixture band is among them (the hour band spec may add its own
    // while the whole suite runs), each with its hours and its shifts.
    for (const band of fixture.bands) expect(memberBandNames).toContain(band.name);
    expect(memberBandHours).toHaveLength(memberBandNames.length);
    expect(memberBandShifts).toHaveLength(memberBandNames.length);

    await hoursPage.goto();
    await expect(hoursPage.heading(hr.nav.sati)).toBeVisible();
    await expect(hoursPage.organizationTable).toBeVisible();
    // An admin never sees their own tiles: the table stands in their place.
    await expect(hoursPage.totalTile).toHaveCount(0);

    const row = hoursPage.organizationRow(fixture.member.name);
    await expect(row).toHaveCount(1);
    await expect(await hoursPage.cellIn(row, organization.total)).toHaveText(memberTotal);
    await expect(await hoursPage.cellIn(row, organization.shifts)).toHaveText(memberShifts);
    await expect(await hoursPage.cellIn(row, organization.team)).toHaveText(fixture.team.name);
    await expect(await hoursPage.cellIn(row, organization.leave)).toHaveText(sati.noFigure);
    // ONE COLUMN PER BAND, the member's bands exactly, each cell the member's figures.
    await expect(hoursPage.columnHeaders).toHaveText([
      organization.member,
      organization.team,
      organization.shifts,
      ...memberBandNames,
      organization.total,
      organization.leave,
    ]);
    for (const [index, name] of memberBandNames.entries()) {
      const cell = await hoursPage.cellIn(row, name);
      await expect(hoursPage.bandCellHours(cell)).toHaveText(memberBandHours[index] ?? '');
      await expect(hoursPage.bandCellShifts(cell)).toHaveText(memberBandShifts[index] ?? '');
    }

    // THE TEAM FILTER NARROWS: the admin, on no team, leaves the table, and
    // every row left is on the chosen team.
    const adminRow = hoursPage.organizationRow(fixture.admin.name);
    await expect(adminRow).toHaveCount(1);
    await hoursPage.teamFilter.selectOption({ label: fixture.team.name });
    await expect(page).toHaveURL(/[?&]tim=/);
    await expect(adminRow).toHaveCount(0);
    await expect(row).toHaveCount(1);
    await expect
      .poll(async () => {
        const teams = await hoursPage.columnTexts(organization.team);
        return teams.length > 0 && teams.every((team) => team === fixture.team.name);
      })
      .toBe(true);

    // THE PERSON FILTER: the member alone, and chosen.
    await hoursPage.teamFilter.selectOption({ index: 0 });
    await expect(page).not.toHaveURL(/[?&]tim=/);
    await expect(adminRow).toHaveCount(1);
    await hoursPage.personFilter.selectOption({ label: fixture.member.name });
    await expect(page).toHaveURL(/[?&]osoba=/);
    await expect(hoursPage.organizationRows).toHaveCount(1);
    await expect(row).toHaveCount(1);
    await expect(hoursPage.chosenOption(hoursPage.personFilter)).toHaveText(fixture.member.name);
    await hoursPage.personFilter.selectOption({ index: 0 });
    await expect(page).not.toHaveURL(/[?&]osoba=/);
    await expect(adminRow).toHaveCount(1);

    // SORTING BY TOTAL: ascending first, then descending, and a reload keeps it.
    await hoursPage.sortButton(organization.total).click();
    await expect(page).toHaveURL(/[?&]sort=ukupno/);
    await expect(hoursPage.columnHeader(organization.total)).toHaveAttribute('aria-sort', 'ascending');
    await hoursPage.sortButton(organization.total).click();
    await expect(page).toHaveURL(/[?&]smjer=silazno/);
    await expect(hoursPage.columnHeader(organization.total)).toHaveAttribute('aria-sort', 'descending');
    await expect(hoursPage.columnHeader(organization.member)).toHaveAttribute('aria-sort', 'none');
    await expect
      .poll(async () => {
        const totals = (await hoursPage.columnTexts(organization.total)).map(minutesOfFigure);
        return (
          totals.length > 1 &&
          !totals.includes(null) &&
          totals.every((total, index) => index === 0 || (totals[index - 1] ?? 0) >= (total ?? 0))
        );
      })
      .toBe(true);
    const order = (await hoursPage.organizationRows.allTextContents()).map((text) => text.trim());
    await page.reload();
    await expect(hoursPage.columnHeader(organization.total)).toHaveAttribute('aria-sort', 'descending');
    await expect(hoursPage.organizationRows).toHaveText(order);

    // THE EXPORT KEEPS THE ORDER (story 4.3): every row, sorted by total
    // descending — the seeded member above those with none, so the order is
    // one the file could get wrong.
    const fileName = hoursExportFileName(await organizationNameOf(fixture.slug), month);
    const totals = await expectExportIsTable(hoursPage, fileName);
    expect(totals.length, 'the unfiltered table has more than one row').toBeGreaterThan(1);
    expect(new Set(totals).size, 'the totals differ, so the order is tested').toBeGreaterThan(1);
    expect(totals).toEqual([...totals].sort((first, second) => second - first));

    // THE MONTH KEEPS THE FILTER AND THE SORT.
    await hoursPage.teamFilter.selectOption({ label: fixture.team.name });
    await expect(page).toHaveURL(/[?&]tim=/);

    // THE EXPORT IS THE SCREEN, FILTERED (story 4.3): by team, sorted by
    // total descending, the file holds exactly the rows shown.
    await expect(hoursPage.chosenOption(hoursPage.teamFilter)).toHaveText(fixture.team.name);
    await expectExportIsTable(hoursPage, fileName);
    const next = nextMonth(month);
    await hoursPage.nextButton.click();
    await expect(page).toHaveURL(new RegExp(`[?&]mjesec=${next}`));
    await expect(page).toHaveURL(/[?&]tim=/);
    await expect(page).toHaveURL(/[?&]sort=ukupno/);
    await expect(page).toHaveURL(/[?&]smjer=silazno/);
    await expect(hoursPage.columnHeader(organization.total)).toHaveAttribute('aria-sort', 'descending');
    await expect(hoursPage.chosenOption(hoursPage.teamFilter)).toHaveText(fixture.team.name);

    // No sideways page scroll at phone width: the table scrolls in its own box.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(hoursPage.organizationTable).toBeVisible();
    await expectNoHorizontalScroll(page);

    // The name opens their calendar month, where the roster changes behind a figure show.
    await hoursPage.memberLink(fixture.member.name).click();
    await expect(page).toHaveURL(new RegExp(`/kalendar\\?.*mjesec=${next}`));
    await expect(page).toHaveURL(/[?&]prikaz=sve/);
    await expect(page).toHaveURL(/[?&]osoba=/);
    await expect(calendarPage.personHeading(fixture.member.name)).toBeVisible();
  });

  test('a filter that leaves no row closes the export', async ({ page, hoursPage, fixture }) => {
    await hoursPage.goto();
    await expect(hoursPage.organizationTable).toBeVisible();
    await expect(hoursPage.exportButton).toBeEnabled();
    // The admin is on no team: on the fixture team AND the admin, nobody is left.
    await hoursPage.teamFilter.selectOption({ label: fixture.team.name });
    await expect(page).toHaveURL(/[?&]tim=/);
    await hoursPage.personFilter.selectOption({ label: fixture.admin.name });
    await expect(page).toHaveURL(/[?&]osoba=/);
    await expect(hoursPage.organizationRows.filter({ has: page.getByRole('link') })).toHaveCount(0);
    await expect(hoursPage.exportButton).toBeDisabled();
    await hoursPage.personFilter.selectOption({ index: 0 });
    await expect(hoursPage.exportButton).toBeEnabled();
  });

  test('a writer that cannot load shows the failure, and the action is usable again', async ({ page, hoursPage }) => {
    // The writer's own module, whichever server serves it: Vite's optimized
    // dependency in development, the lazily split chunk in a build.
    let aborted = 0;
    await page.route(/write-excel-file|\/assets\/browser-[\w-]+\.js(?:\?|$)/, async (route) => {
      aborted += 1;
      await route.abort();
    });
    await hoursPage.goto();
    await expect(hoursPage.organizationTable).toBeVisible();
    await expect(hoursPage.exportFailed).toHaveCount(0);
    await hoursPage.exportButton.click();
    await expect(hoursPage.exportFailed).toBeVisible();
    expect(aborted, 'the writer was requested, and refused').toBeGreaterThan(0);
    // Usable again: open, its own label back, and the focus the press gave it kept.
    await expect(hoursPage.exportButton).toBeEnabled();
    await expect(hoursPage.exportButton).not.toHaveAttribute('aria-disabled', 'true');
    await expect(hoursPage.exportButton).toBeFocused();
    await hoursPage.exportButton.click();
    await expect(hoursPage.exportFailed).toBeVisible();
    await expect(hoursPage.exportButton).toBeEnabled();
  });
});
