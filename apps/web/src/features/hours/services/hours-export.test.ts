import type { Collision } from '@shift/domain';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  FILE_NAME_ORGANIZATION_MAX,
  HOURS_EXPORT_FAILED,
  exportHours,
  fileNameSafeOf,
  hoursExportDisabled,
  hoursExportEmpty,
  hoursExportMessageKey,
  hoursExportOf,
  type HoursExport,
  type HoursExportCell,
} from '@/features/hours/services/hours-export';
import { monthHeaderOf } from '@/features/calendar/utils/month';
import { hoursSearchOf, myHoursViewOf, type HoursSearch } from '@/features/hours/services/my-hours';
import { organizationHoursOf, type OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { HOURS_CELL_FORMAT, columnWidthsOf, sheetDataOf } from '@/features/hours/services/xlsx';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  TODAY,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 4.3's rules, executed (AD-15): the sheet an admin downloads is the
 * table's own view — its rows, order and figures — every row of the spec's
 * matrix, over both fixtures. Figures are compared against the domain's
 * minutes on each row, never against display text.
 */

const MONTH = '2026-09';

/** No leave, so no collision: every row's conflict cell is 0. */
const NO_COLLISIONS: readonly Collision[] = [];

const ANA = '00000000-0000-4000-8000-0000000000c1';
const CEDO = '00000000-0000-4000-8000-0000000000c2';
const DORA = '00000000-0000-4000-8000-0000000000c3';

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

/** The viewer (an admin) and Čedo on the first team, Ana on the second, Dora on none. */
async function organizationOf(rows: FixtureRows): Promise<CalendarSnapshot> {
  const [a, b] = [teamOf(rows, 0), teamOf(rows, 1)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(a, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, a, SEEDED),
            memberMembershipRow(ANA, b, SEEDED),
            memberMembershipRow(CEDO, a, SEEDED),
          ],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Anić'),
      calendarMemberRow(CEDO, 'Čedo Čačić'),
      calendarMemberRow(DORA, 'Dora Dorić'),
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function viewOf(snapshot: CalendarSnapshot, search: HoursSearch = { mjesec: MONTH }): OrganizationHoursView {
  const outcome = organizationHoursOf(snapshot, search, TODAY, NO_COLLISIONS);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

function valueOf(cell: HoursExportCell | undefined): string | number {
  if (cell === undefined || cell.kind === 'empty') throw new Error('no cell');

  return cell.value;
}

function numbersOf(row: readonly HoursExportCell[]): readonly number[] {
  return row.flatMap((cell) => (cell.kind === 'hours' ? [cell.value] : []));
}

afterEach(() => {
  vi.restoreAllMocks();
});

let pilot: CalendarSnapshot;
let uj5: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  pilot = await organizationOf(PILOT);
  uj5 = await organizationOf(UJ5);
});

describe('the sheet', () => {
  it.each([
    { fixture: 'pilot', snapshot: () => pilot },
    { fixture: 'UJ-5', snapshot: () => uj5 },
  ])('$fixture: one header row of the table’s columns, then each row as the table has it', ({ snapshot }) => {
    const view = viewOf(snapshot());
    const sheet = hoursExportOf(view, snapshot().organizationName);

    expect(sheet.columns).toEqual([
      t('sati.organization.member'),
      t('sati.organization.team'),
      t('sati.organization.shifts'),
      ...view.bands.map((band) => band.name),
      t('sati.organization.total'),
      t('sati.organization.leave'),
      t('sati.organization.conflicts'),
    ]);
    expect(sheet.sheetName).toBe(t('sati.organization.export.sheetName'));
    expect(sheet.rows).toHaveLength(view.rows.length);
    view.rows.forEach((row, index) => {
      const cells = sheet.rows[index]!;

      expect(cells).toHaveLength(sheet.columns.length);
      expect(cells[0]).toEqual({ kind: 'text', value: row.name });
      expect(cells[1]).toEqual({ kind: 'text', value: row.team?.name ?? t('sati.organization.noTeam') });
      expect(cells[2]).toEqual({ kind: 'count', value: row.shiftCount });
      expect(cells.slice(3)).toEqual([
        ...view.bands.map((band) => ({
          kind: 'hours',
          value: row.hours.bands.find((one) => one.bandId === band.bandId)!.minutes / 1440,
        })),
        { kind: 'hours', value: row.hours.totalMinutes / 1440 },
        // No leave before Epic 5: the cell is empty, as the screen's `—`.
        { kind: 'empty' },
        // No collision without leave: a zero, never an empty cell.
        { kind: 'count', value: 0 },
      ]);
      expect(row.hours.leaveMinutes).toBe(0);
    });
  });

  it('screen equals file: filtered by team, sorted by total descending, the same rows in the same order', () => {
    const view = viewOf(pilot, hoursSearchOf({ mjesec: MONTH, smjena: teamOf(PILOT, 0), sort: 'ukupno', smjer: 'silazno' }));
    const sheet = hoursExportOf(view, pilot.organizationName);

    expect(view.rows.length).toBeGreaterThan(1);
    expect(view.rows.length).toBeLessThan(viewOf(pilot).rows.length);
    expect(sheet.rows.map((row) => valueOf(row[0]))).toEqual(view.rows.map((row) => row.name));
    expect(sheet.rows.map((row) => valueOf(row.at(-3)))).toEqual(view.rows.map((row) => row.hours.totalMinutes / 1440));
  });

  it('UJ-5: the band cells show the split, and sum to Total on every row, in minutes', () => {
    const view = viewOf(uj5);
    const sheet = hoursExportOf(view, uj5.organizationName);

    expect(view.bands.map((band) => band.name)).toEqual(['Jutro', 'Popodne', 'Noć']);
    expect(sheet.columns.slice(3, 6)).toEqual(['Jutro', 'Popodne', 'Noć']);
    sheet.rows.forEach((cells, index) => {
      const row = view.rows[index]!;
      const [bands, total] = [numbersOf(cells).slice(0, 3), numbersOf(cells)[3]!];

      // DI-7 in minutes, before any division could hide a mismatch.
      expect(row.hours.bands.reduce((sum, band) => sum + band.minutes, 0)).toBe(row.hours.totalMinutes);
      expect(bands.map((duration) => Math.round(duration * 1440)).reduce((sum, minutes) => sum + minutes, 0)).toBe(
        Math.round(total * 1440),
      );
    });
    // Some band actually splits: not every hour lands in one column.
    expect(sheet.rows.some((cells) => numbersOf(cells).slice(0, 3).filter((hours) => hours > 0).length > 1)).toBe(true);
  });

  it('half hours: 750 minutes is the duration 750 / 1440, formatted [h]:mm (reads 12:30)', () => {
    const view = viewOf(pilot);
    const [first] = view.rows;
    const half = { ...first!, hours: { ...first!.hours, totalMinutes: 750 } };
    const sheet = hoursExportOf({ ...view, rows: [half] }, pilot.organizationName);
    const total = sheet.rows[0]!.at(-3);

    expect(total).toEqual({ kind: 'hours', value: 750 / 1440 });
    const written = sheetDataOf(sheet)[1]!.at(-3);

    expect(written).toEqual({ type: Number, value: 750 / 1440, format: HOURS_CELL_FORMAT });
    expect(HOURS_CELL_FORMAT).toBe('[h]:mm');
    // `[h]` does not wrap at a day: 108 hours stays 108:00.
    const long = hoursExportOf({ ...view, rows: [{ ...first!, hours: { ...first!.hours, totalMinutes: 6480 } }] }, 'DVD');

    expect(long.rows[0]!.at(-3)).toEqual({ kind: 'hours', value: 4.5 });
  });

  it('leave: 0 is an empty cell, and a positive leave a [h]:mm duration with no further change', () => {
    const view = viewOf(pilot);
    const [first] = view.rows;
    const withLeave = { ...first!.hours, leaveMinutes: 750 };
    // The row's leave figure through the one rule that sets it, as the table's rows are built.
    const leave = myHoursViewOf(pilot, monthHeaderOf(MONTH, TODAY), withLeave, 0).leave;
    const some = hoursExportOf({ ...view, rows: [{ ...first!, hours: withLeave, leave }] }, pilot.organizationName);
    const none = hoursExportOf({ ...view, rows: [first!] }, pilot.organizationName);

    expect(first!.leave).toBeNull();
    expect(none.rows[0]!.at(-2)).toEqual({ kind: 'empty' });
    expect(sheetDataOf(none)[1]!.at(-2)).toBeNull();
    expect(some.rows[0]!.at(-2)).toEqual({ kind: 'hours', value: 750 / 1440 });
    expect(sheetDataOf(some)[1]!.at(-2)).toEqual({ type: Number, value: 750 / 1440, format: HOURS_CELL_FORMAT });
    // Every other figure is unchanged by the leave.
    expect(some.rows[0]!.slice(0, -2)).toEqual(none.rows[0]!.slice(0, -2));
    expect(some.rows[0]!.at(-1)).toEqual(none.rows[0]!.at(-1));
  });

  it('no team: the cell is the text the screen shows', () => {
    const sheet = hoursExportOf(viewOf(pilot, { mjesec: MONTH, osoba: DORA }), pilot.organizationName);

    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]![1]).toEqual({ kind: 'text', value: t('sati.organization.noTeam') });
    expect(t('sati.organization.noTeam')).toBe('—');
  });

  it('zero bands: Member, Team, shifts, Total, Leave, conflicts', async () => {
    const view = viewOf(await organizationOf({ ...PILOT, bands: [] }));
    const sheet = hoursExportOf(view, pilot.organizationName);

    expect(sheet.columns).toEqual([
      t('sati.organization.member'),
      t('sati.organization.team'),
      t('sati.organization.shifts'),
      t('sati.organization.total'),
      t('sati.organization.leave'),
      t('sati.organization.conflicts'),
    ]);
    for (const row of sheet.rows) expect(row).toHaveLength(6);
  });

  it('a band a row does not carry refuses the sheet', () => {
    const view = viewOf(pilot);
    const broken = { ...view, bands: [...view.bands, { ...view.bands[0]!, bandId: 'gone' }] };

    expect(() => hoursExportOf(broken, pilot.organizationName)).toThrow(RangeError);
  });

  it('writes every figure as a number cell, every heading as text, and an empty leave as no cell', () => {
    const view = viewOf(uj5);
    const sheet = hoursExportOf(view, uj5.organizationName);
    const [header, ...rows] = sheetDataOf(sheet);

    expect(header).toEqual(sheet.columns.map((column) => ({ type: String, value: column, fontWeight: 'bold' })));
    for (const [index, row] of rows.entries()) {
      const figures = row.slice(2, -2);
      const leave = view.rows[index]!.leave;

      expect(row.slice(0, 2).map((cell) => (cell as { type: unknown }).type)).toEqual([String, String]);
      expect(figures.every((cell) => (cell as { type: unknown }).type === Number)).toBe(true);
      expect(figures.slice(1).every((cell) => (cell as { format?: string }).format === HOURS_CELL_FORMAT)).toBe(true);
      expect((row[2] as { format?: string }).format).toBeUndefined();
      // The leave cell as its row has it: none when empty, else a duration.
      if (leave === null) expect(row.at(-2)).toBeNull();
      else expect(row.at(-2)).toMatchObject({ type: Number, format: HOURS_CELL_FORMAT });
      // The conflict count: a plain number, no duration format, 0 included.
      expect(row.at(-1)).toEqual({ type: Number, value: view.rows[index]!.conflictCount });
    }
  });
});

describe('the column widths', () => {
  it('the names wide, each figure at least 10 and as wide as its heading, at most 24', () => {
    const sheet = hoursExportOf(viewOf(uj5), uj5.organizationName);
    const widths = columnWidthsOf(sheet).map((column) => column.width);

    expect(widths).toHaveLength(sheet.columns.length);
    expect(widths.slice(0, 2)).toEqual([28, 20]);
    for (const [index, width] of widths.slice(2).entries()) {
      const heading = sheet.columns[index + 2]!;

      expect(width).toBe(Math.min(24, Math.max(10, heading.length + 2)));
    }
    const long = columnWidthsOf({ ...sheet, columns: [...sheet.columns.slice(0, 3), 'P'.repeat(60)] });

    expect(long.at(-1)).toEqual({ width: 24 });
  });
});

describe('the file name', () => {
  it('carries the organization, the lowercase month and the year', () => {
    expect(hoursExportOf(viewOf(pilot), 'DVD Mladost').fileName).toBe('Sati DVD Mladost rujan 2026.xlsx');
  });

  it('unsafe org name: \\ / : * ? " < > | are removed', () => {
    expect(hoursExportOf(viewOf(pilot), 'DVD "A/B"').fileName).toBe('Sati DVD AB rujan 2026.xlsx');
    expect(fileNameSafeOf('a\\b/c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(fileNameSafeOf('  DVD  :  Sjever ')).toBe('DVD Sjever');
  });

  it('drops control characters, trailing dots and spaces, and caps the organization at 100 characters', () => {
    expect(fileNameSafeOf('DVD\u0000\u0007A\u001fB\tC')).toBe('DVDABC');
    expect(fileNameSafeOf('DVD Mladost...  ')).toBe('DVD Mladost');
    expect(fileNameSafeOf('DVD. . .')).toBe('DVD');
    expect(fileNameSafeOf('Ž'.repeat(150))).toBe('Ž'.repeat(FILE_NAME_ORGANIZATION_MAX));
    expect(FILE_NAME_ORGANIZATION_MAX).toBe(100);
    // A cut that lands on a space or a dot does not end the part on one.
    expect(fileNameSafeOf(`${'a'.repeat(99)} b`)).toBe('a'.repeat(99));
    expect(hoursExportOf(viewOf(pilot), 'x'.repeat(120)).fileName).toBe(`Sati ${'x'.repeat(100)} rujan 2026.xlsx`);
  });

  it('an organization with nothing left is omitted cleanly, with no double space', () => {
    for (const name of ['???', ' "/" ', '...', '\u0001']) {
      expect(hoursExportOf(viewOf(pilot), name).fileName, JSON.stringify(name)).toBe('Sati rujan 2026.xlsx');
    }
  });

  it('follows the period shown', () => {
    expect(hoursExportOf(viewOf(pilot, { mjesec: '2027-01' }), 'DVD').fileName).toBe('Sati DVD siječanj 2027.xlsx');
  });
});

describe('the action', () => {
  it('no rows: closed; closed while building; otherwise open', () => {
    const view = viewOf(pilot);

    expect(hoursExportEmpty(view)).toBe(false);
    expect(hoursExportEmpty({ ...view, rows: [] })).toBe(true);

    expect(hoursExportDisabled(view, false)).toBe(false);
    expect(hoursExportDisabled(view, true)).toBe(true);
    expect(hoursExportDisabled({ ...view, rows: [] }, false)).toBe(true);
  });

  it('says the imperative, and the pending label while building', () => {
    expect(hoursExportMessageKey(false)).toBe('sati.organization.export.action');
    expect(hoursExportMessageKey(true)).toBe('sati.organization.export.pending');
  });

  it('hands the writer the sheet the view stands for', async () => {
    const view = viewOf(pilot);
    const written: HoursExport[] = [];

    await expect(
      exportHours(view, pilot.organizationName, async (sheet) => {
        written.push(sheet);
      }),
    ).resolves.toEqual({ fileName: hoursExportOf(view, pilot.organizationName).fileName, count: view.rows.length });
    expect(written).toEqual([hoursExportOf(view, pilot.organizationName)]);
  });

  it('the status line names the file written and how many people it holds (story 7.14)', async () => {
    const view = viewOf(pilot);
    const done = await exportHours(view, pilot.organizationName, () => Promise.resolve());

    expect(done).toEqual({ fileName: hoursExportOf(view, pilot.organizationName).fileName, count: view.rows.length });
    expect(t('sati.organization.export.done', done!)).toContain(done!.fileName);
    expect(t('sati.organization.export.done', { fileName: 'x.xlsx', count: 1 })).toContain('1 osobom');
    expect(t('sati.organization.export.done', { fileName: 'x.xlsx', count: 3 })).toContain('3 osobe');
    expect(t('sati.organization.export.done', { fileName: 'x.xlsx', count: 17 })).toContain('17 osoba');
  });

  it('import fails: logged, answered null, never thrown — and a build that throws the same', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = viewOf(pilot);
    const chunk = new TypeError('Failed to fetch dynamically imported module');

    await expect(exportHours(view, pilot.organizationName, () => Promise.reject(chunk))).resolves.toBeNull();
    expect(errors).toHaveBeenCalledWith(HOURS_EXPORT_FAILED, chunk);
    const broken = { ...view, bands: [...view.bands, { ...view.bands[0]!, bandId: 'gone' }] };

    await expect(exportHours(broken, pilot.organizationName, () => Promise.resolve())).resolves.toBeNull();
    expect(errors).toHaveBeenLastCalledWith(HOURS_EXPORT_FAILED, expect.any(RangeError));
  });
});
