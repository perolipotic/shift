import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { Browser, Page } from '@playwright/test';

import { LoginPage } from '../../pages/login.page.ts';
import {
  holdRotation,
  organizationNameOf,
  removeFormerMemberInSql,
  removeLeaveRecordsInSql,
  removeSeededRotation,
  seedConflictResolution,
  seedExtraTeam,
  seedFormerMember,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  type RotationHold,
  type SeededLeaveMember,
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
 *
 * Story 5.3d: a team of the test's own gets the same rotation, and a fresh
 * member on it. The admin opens *Sati* first, so its reads are cached; then,
 * in the app alone — never a reload — records today to today + 4 (Dan, Noć,
 * Slobodno, Slobodno, Dan, the worked example) on the member's page and goes
 * back to *Sati*: the member's row shows `⚠` and the month's count of the
 * three colliding dates, every figure as before, and the run's member and
 * admin show `0`; the downloaded `.xlsx` carries the same numbers in its own
 * column. A member with their own leave reads their own line; the run's
 * member, with none, reads no line. A failed leave read shows the
 * unavailable message and no figure, and its retry brings the table back.
 *
 * Story 5.4a: a resolution seeded in SQL on today's conflict takes it off the
 * member's count in the table and the `.xlsx`, and off a member's own line. A
 * failed resolutions read shows the unavailable message, and its retry brings
 * the table back.
 */

const sati = hr.sati;
const organization = hr.sati.organization;
const hours = hr.organization.hourBands.duration.hours;

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded, removed before the hold is released. */
let seed: SeededRotation | null = null;
/** The former member this file's test seeded, removed before the hold is released. */
let former: { readonly slug: string; readonly id: string } | null = null;
/** Members whose live records are soft-removed afterwards (story 5.3d). */
let withLeave: { readonly slug: string; readonly id: string }[] = [];

test.afterEach(async () => {
  try {
    for (const member of withLeave) await removeLeaveRecordsInSql(member.slug, member.id).catch(() => undefined);
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    withLeave = [];
    seed = null;
    try {
      if (former !== null) await removeFormerMemberInSql(former.slug, former.id);
    } finally {
      former = null;
      await hold?.release();
      hold = null;
    }
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

/** The number a conflicts cell shows: `0`, or `⚠` and the number. */
function conflictsOf(text: string): number {
  const found = /^(?:⚠\s*)?(\d+)$/.exec(text.trim());

  if (found === null) throw new Error(`E2E: a conflicts cell reads ${text}`);

  return Number(found[1]);
}

/** What a downloaded sheet holds: each row's total, in minutes, and every row as read back, in file order. */
interface ExportedTable {
  readonly totals: number[];
  readonly headings: readonly string[];
  readonly body: readonly (readonly (XlsxCell | null)[])[];
}

/**
 * Exports what the table shows and holds the file to it (story 4.3): its
 * name, the sheet's, the headings, and every row in order — text as shown,
 * the shift count and the conflict count (story 5.3d) numbers, every hour
 * figure a `[h]:mm` duration equal to the screen's minutes, and an empty
 * figure (`—`) an absent cell.
 */
async function expectExportIsTable(hoursPage: HoursPage, fileName: string): Promise<ExportedTable> {
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
      } else if (label === organization.conflicts) {
        // The state is the column and the number, 0 included: never a colour or a glyph.
        expect(cell, `${label} of row ${String(index)}`).toEqual({ type: 'number', value: conflictsOf(text), format: null });
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

  return {
    totals: body.map((cells) => exportedMinutes(cells[headings.indexOf(organization.total)]) ?? -1),
    headings,
    body,
  };
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    // No leave, so no shift in conflict: nothing is added (story 5.3d).
    await expect(hoursPage.conflictsLine).toHaveCount(0);
    await expect(hoursPage.currentButton).toBeDisabled();
  });

  test("a failed read of their own leave shows the unavailable message with a retry, and the retry brings their figures back", async ({
    page,
    hoursPage,
  }) => {
    const own = '**/rest/v1/rpc/my_leave_records*';
    await page.route(own, (route) => route.fulfill({ status: 500, body: '{}' }));

    await hoursPage.goto();
    await expect(hoursPage.unavailableAlert).toBeVisible();
    await expect(hoursPage.retryButton).toBeVisible();
    await expect(hoursPage.totalTile).toHaveCount(0);

    await page.unroute(own);
    await hoursPage.retryButton.click();
    await expect(hoursPage.totalTile).toBeVisible();
    await expect(hoursPage.shiftsTile).toBeVisible();
    await expect(hoursPage.unavailableAlert).toHaveCount(0);
    await expect(hoursPage.retryButton).toHaveCount(0);
  });

  test('a bad month falls back to the current one, and the phone does not scroll sideways', async ({
    page,
    hoursPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
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
      organization.conflicts,
    ]);
    // No leave on the run's member: a zero, shown.
    await expect(await hoursPage.cellIn(row, organization.conflicts)).toHaveText('0');
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
    const { totals } = await expectExportIsTable(hoursPage, fileName);
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

  test("a member who has left since keeps their row last month, and their name opens their calendar month", async ({
    page,
    hoursPage,
    calendarPage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    // Epic 4 retro, C1: active all last month, inactive from this month's first
    // day — so inactive today. The calendar offers everyone active in the month
    // shown, as a Sati row, so the link opens them and not the whole grid.
    // The member is in the shared run organization only while this test holds
    // its rotation lock, and is removed (afterEach) before the lock is released.
    hold = holdRotation(fixture.slug);
    await hold.ready;
    const seededFormer = await seedFormerMember(fixture.slug, fixture.team.id);
    former = { slug: fixture.slug, id: seededFormer.id };

    await hoursPage.goto(`?mjesec=${seededFormer.month}`);
    await expect(hoursPage.organizationTable).toBeVisible();
    await expect(hoursPage.memberLink(seededFormer.name)).toBeVisible();

    await hoursPage.memberLink(seededFormer.name).click();
    await expect(page).toHaveURL(new RegExp(`/kalendar\\?.*mjesec=${seededFormer.month}`));
    await expect(page).toHaveURL(new RegExp(`[?&]osoba=${seededFormer.id}`));
    await expect(calendarPage.personHeading(seededFormer.name)).toBeVisible();
    await expect(calendarPage.personListOf(seededFormer.name)).toBeVisible();
    await expect(calendarPage.anyGrid).toHaveCount(0);
    // Their days last month are on their team — what the seeded membership is for.
    await expect(calendarPage.personDaysOnTeam(seededFormer.name, fixture.team.name).first()).toBeVisible();
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

/** An ISO date `count` days after another, by calendar arithmetic in UTC. */
function isoDaysAfter(iso: string, count: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);

  return day.toISOString().slice(0, 10);
}

/** The worked example's colliding offsets from today: Dan, Noć and Dan. */
const COLLIDING = [0, 1, 4] as const;

/** How many of the worked example's collisions, leave from `today`, fall in `month`. */
function collidingIn(month: string, today: string): number {
  return COLLIDING.filter((offset) => isoDaysAfter(today, offset).startsWith(`${month}-`)).length;
}

/** A team of the test's own with the seeded rotation from today, under the hold. */
async function seededTeam(slug: string): Promise<{ readonly today: string; readonly team: { readonly id: string; readonly name: string } }> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  seed = await seedTeamRotation(slug, team.id, suffix);

  return { today: seed.today, team };
}

/** *Sati* as `member`, in a fresh context of its own. */
async function signedInAs(browser: Browser, slug: string, member: SeededLeaveMember): Promise<{ page: Page; hours: HoursPage }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await new LoginPage(page).signIn(slug, member.username, member.password);

    return { page, hours: new HoursPage(page) };
  } catch (cause) {
    await context.close();
    throw cause;
  }
}

test.describe('the conflict count, as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the admin records leave and opens Sati: the count is in the table and the file without a reload, and no figure moves', async ({
    page,
    hoursPage,
    peoplePage,
    fixture,
  }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { today, team } = await seededTeam(fixture.slug);
    const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
    withLeave.push({ slug: fixture.slug, id: member.id });
    const month = today.slice(0, 7);
    const expected = collidingIn(month, today);
    expect(expected, "today's own Dan collides, so the month counts one at least").toBeGreaterThan(0);

    // SATI FIRST, so its reads are cached before the write: what follows
    // proves the write's invalidation, never a first read.
    await hoursPage.goto();
    const row = hoursPage.organizationRow(member.name);
    await expect(row).toHaveCount(1);
    await expect(await hoursPage.cellIn(row, organization.conflicts)).toHaveText('0');
    const before = await row.textContent();
    expect(before, 'the row reads before the write').not.toBeNull();
    // A marker on the window: if any step below reloads the page, it is gone.
    await page.evaluate(() => {
      (window as unknown as { noReload: boolean }).noReload = true;
    });

    // RECORD THE WORKED EXAMPLE on the member's page, reached in the app alone.
    await peoplePage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await peoplePage.listedMember(member.name).click();
    await expect(peoplePage.leaveHeading).toBeVisible();
    await peoplePage.enterLeave(today, isoDaysAfter(today, 4));
    await peoplePage.saveLeaveButton.click();
    await expect(peoplePage.status).toBeVisible();

    // BACK TO SATI through the navigation.
    await peoplePage.navigationLink(hr.nav.sati, { exact: true }).click();
    await expect(hoursPage.organizationTable).toBeVisible();
    const conflicts = await hoursPage.cellIn(row, organization.conflicts);
    await expect(conflicts).toHaveText(`⚠${String(expected)}`);
    // The glyph is hidden from readers: the heading and the number carry it.
    await expect(conflicts.locator('[aria-hidden]')).toHaveText('⚠');
    // EVERY FIGURE AS BEFORE: the shifts in conflict still count, and the leave stays empty.
    await expect(await hoursPage.cellIn(row, organization.leave)).toHaveText(sati.noFigure);
    const after = await row.textContent();
    expect(after, 'the row reads after the write').not.toBeNull();
    expect(after?.replace(/⚠\d+$/, '')).toBe(before?.replace(/0$/, ''));
    // Nobody else's count moves.
    await expect(await hoursPage.cellIn(hoursPage.organizationRow(fixture.member.name), organization.conflicts)).toHaveText('0');
    await expect(await hoursPage.cellIn(hoursPage.organizationRow(fixture.admin.name), organization.conflicts)).toHaveText('0');

    // THE FILE: the same numbers in their own column.
    const { headings, body } = await expectExportIsTable(
      hoursPage,
      hoursExportFileName(await organizationNameOf(fixture.slug), month),
    );
    const column = headings.indexOf(organization.conflicts);
    expect(column, 'the file has the conflicts column').toBeGreaterThan(-1);
    const countOf = (name: string) =>
      body.find((cells) => cells[0]?.type === 'text' && cells[0].value === name)?.[column] ?? null;
    expect(countOf(member.name)).toEqual({ type: 'number', value: expected, format: null });
    expect(countOf(fixture.member.name)).toEqual({ type: 'number', value: 0, format: null });
    expect(countOf(fixture.admin.name)).toEqual({ type: 'number', value: 0, format: null });

    // THE NEXT MONTH counts only its own dates.
    await hoursPage.nextButton.click();
    await expect(page).toHaveURL(new RegExp(`[?&]mjesec=${nextMonth(month)}`));
    const later = collidingIn(nextMonth(month), today);
    await expect(await hoursPage.cellIn(row, organization.conflicts)).toHaveText(
      later === 0 ? '0' : `⚠${String(later)}`,
    );
    expect(await page.evaluate(() => (window as unknown as { noReload?: boolean }).noReload)).toBe(true);
  });

  test('a failed leave read shows the unavailable message and no figure, and the retry brings the table back', async ({
    page,
    hoursPage,
  }) => {
    const records = '**/rest/v1/leave_records*';
    await page.route(records, (route) => route.fulfill({ status: 500, body: '{}' }));

    await hoursPage.goto();
    await expect(hoursPage.unavailableAlert).toBeVisible();
    await expect(hoursPage.retryButton).toBeVisible();
    await expect(hoursPage.organizationTable).toHaveCount(0);

    await page.unroute(records);
    await hoursPage.retryButton.click();
    await expect(hoursPage.organizationTable).toBeVisible();
    await expect(hoursPage.columnHeader(organization.conflicts)).toBeVisible();
    await expect(hoursPage.unavailableAlert).toHaveCount(0);
    await expect(hoursPage.retryButton).toHaveCount(0);
  });

  test('a leave row that cannot be trusted shows the unavailable message with no retry', async ({ page, hoursPage }) => {
    // The real answer's headers (CORS and the count) kept; its rows replaced
    // by one of a member the organization does not hold.
    await page.route('**/rest/v1/leave_records*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-range': '0-0/1' },
        body: JSON.stringify([
          { id: 'e2e-untrusted', member_id: '00000000-0000-4000-8000-00000000dead', during: '[2026-09-10,2026-09-11)' },
        ]),
      });
    });

    await hoursPage.goto();
    await expect(hoursPage.unavailableAlert).toBeVisible();
    await expect(hoursPage.organizationTable).toHaveCount(0);
    // Reading the same rows again would refuse them again: no retry is offered.
    await expect(hoursPage.retryButton).toHaveCount(0);
  });
});

/**
 * The first start, a whole rotation cycle (4 days) on from `today` at a time,
 * so it is a Dan, whose worked example (Dan, Noć, Slobodno, Slobodno, Dan)
 * lies in one month: all three of its conflicts count there.
 */
function oneMonthWorkedExample(today: string): { readonly from: string; readonly to: string; readonly month: string } {
  for (let offset = 0; ; offset += 4) {
    const from = isoDaysAfter(today, offset);
    const to = isoDaysAfter(from, 4);
    if (from.slice(0, 7) === to.slice(0, 7)) return { from, to, month: from.slice(0, 7) };
  }
}

test.describe('resolutions, as an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test("a resolved conflict takes exactly one off the member's count in the table and the file", async ({ hoursPage, fixture }) => {
    test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
    const { today, team } = await seededTeam(fixture.slug);
    const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
    withLeave.push({ slug: fixture.slug, id: member.id });
    const worked = oneMonthWorkedExample(today);
    await seedLeaveRecord(fixture.slug, member.id, worked.from, worked.to);
    const row = hoursPage.organizationRow(member.name);

    // BEFORE: all three of the worked example's conflicts, in one month.
    await hoursPage.goto(`?mjesec=${worked.month}`);
    await expect(row).toHaveCount(1);
    await expect(await hoursPage.cellIn(row, organization.conflicts)).toHaveText('⚠3');

    // AFTER: the first Dan resolved, and exactly one less.
    await seedConflictResolution(fixture.slug, member.id, worked.from, team.id);
    await hoursPage.goto(`?mjesec=${worked.month}`);
    await expect(row).toHaveCount(1);
    await expect(await hoursPage.cellIn(row, organization.conflicts)).toHaveText('⚠2');

    const { headings, body } = await expectExportIsTable(
      hoursPage,
      hoursExportFileName(await organizationNameOf(fixture.slug), worked.month),
    );
    const column = headings.indexOf(organization.conflicts);
    expect(column, 'the file has the conflicts column').toBeGreaterThan(-1);
    const counted = body.find((cells) => cells[0]?.type === 'text' && cells[0].value === member.name)?.[column] ?? null;
    expect(counted).toEqual({ type: 'number', value: 2, format: null });
  });

  test('a failed resolutions read shows the unavailable message and no figure, and the retry brings the table back', async ({
    page,
    hoursPage,
  }) => {
    const resolutions = '**/rest/v1/conflict_resolutions*';
    await page.route(resolutions, (route) => route.fulfill({ status: 500, body: '{}' }));

    await hoursPage.goto();
    await expect(hoursPage.unavailableAlert).toBeVisible();
    await expect(hoursPage.retryButton).toBeVisible();
    await expect(hoursPage.organizationTable).toHaveCount(0);

    await page.unroute(resolutions);
    await hoursPage.retryButton.click();
    await expect(hoursPage.organizationTable).toBeVisible();
    await expect(hoursPage.unavailableAlert).toHaveCount(0);
  });
});

test('a member with one of their own conflicts resolved reads exactly one fewer on their own line', async ({ browser, fixture }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { today, team } = await seededTeam(fixture.slug);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: member.id });
  const worked = oneMonthWorkedExample(today);
  await seedLeaveRecord(fixture.slug, member.id, worked.from, worked.to);

  const { page, hours } = await signedInAs(browser, fixture.slug, member);
  try {
    await hours.goto(`?mjesec=${worked.month}`);
    await expect(hours.totalTile).toBeVisible();
    await expect(hours.conflictsLine).toHaveText(plural(sati.conflicts, 3));

    await seedConflictResolution(fixture.slug, member.id, worked.from, team.id);
    await hours.goto(`?mjesec=${worked.month}`);
    await expect(hours.totalTile).toBeVisible();
    await expect(hours.conflictsLine).toHaveText(plural(sati.conflicts, 2));
  } finally {
    await page.context().close();
  }
});

test('a member with their own leave reads their own line of shifts in conflict', async ({ browser, fixture }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { today, team } = await seededTeam(fixture.slug);
  const member = await seedLeaveMember(fixture.slug, team.id, today, 20);
  withLeave.push({ slug: fixture.slug, id: member.id });
  await seedLeaveRecord(fixture.slug, member.id, today, isoDaysAfter(today, 4));
  const expected = collidingIn(today.slice(0, 7), today);

  const { page, hours } = await signedInAs(browser, fixture.slug, member);
  try {
    await hours.goto();
    await expect(hours.totalTile).toBeVisible();
    await expect(hours.conflictsLine).toHaveText(plural(sati.conflicts, expected));
    // Their own figures, never the table.
    await expect(hours.organizationTable).toHaveCount(0);
  } finally {
    await page.context().close();
  }
});
