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
  hoursShapeOf,
  type HoursExport,
  type HoursExportCell,
} from '@/features/hours/services/hours-export';
import { durationMessageKey } from '@/features/hour-bands/services/list';
import { NO_LEAVE_RECORDS, type LeaveRecordsByMember } from '@/features/hours/services/hours-conflicts';
import { hoursSearchOf, leaveFigureOf, type HoursSearch } from '@/features/hours/services/my-hours';
import { organizationHoursOf, type OrganizationHoursView } from '@/features/hours/services/organization-hours';
import {
  HOURS_FORMAT_HOURS,
  HOURS_FORMAT_HOURS_MINUTES,
  HOURS_FORMAT_MINUTES,
  columnWidthsOf,
  hoursCellFormatOf,
  renderedLengthOf,
  sheetDataOf,
} from '@/features/hours/services/xlsx';
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

function viewOf(
  snapshot: CalendarSnapshot,
  leaveRecords: LeaveRecordsByMember,
  search: HoursSearch = { mjesec: MONTH },
): OrganizationHoursView {
  const outcome = organizationHoursOf(snapshot, search, TODAY, NO_COLLISIONS, [], leaveRecords);

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
    const view = viewOf(snapshot(), NO_LEAVE_RECORDS);
    const sheet = hoursExportOf(view, snapshot().organizationName);

    expect(sheet.columns).toEqual([
      t('sati.organization.member'),
      t('sati.organization.team'),
      t('sati.organization.shifts'),
      ...view.bands.map((band) => band.name),
      t('sati.organization.total'),
      t('sati.organization.export.leaveDays'),
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
        ...view.bands.map((band) => {
          const minutes = row.hours.bands.find((one) => one.bandId === band.bandId)!.minutes;

          return { kind: 'hours', value: minutes / 1440, shape: hoursShapeOf(minutes) };
        }),
        { kind: 'hours', value: row.hours.totalMinutes / 1440, shape: hoursShapeOf(row.hours.totalMinutes) },
        // No leave: the leave cell is empty, as the screen's `—`.
        { kind: 'empty' },
        // No collision without leave: a zero, never an empty cell.
        { kind: 'count', value: 0 },
      ]);
      expect(row.leaveDays).toBe(0);
    });
  });

  it('screen equals file: filtered by team, sorted by total descending, the same rows in the same order', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS, hoursSearchOf({ mjesec: MONTH, smjena: teamOf(PILOT, 0), sort: 'ukupno', smjer: 'silazno' }));
    const sheet = hoursExportOf(view, pilot.organizationName);

    expect(view.rows.length).toBeGreaterThan(1);
    expect(view.rows.length).toBeLessThan(viewOf(pilot, NO_LEAVE_RECORDS).rows.length);
    expect(sheet.rows.map((row) => valueOf(row[0]))).toEqual(view.rows.map((row) => row.name));
    expect(sheet.rows.map((row) => valueOf(row.at(-3)))).toEqual(view.rows.map((row) => row.hours.totalMinutes / 1440));
  });

  it('UJ-5: the band cells show the split, and sum to Total on every row, in minutes', () => {
    const view = viewOf(uj5, NO_LEAVE_RECORDS);
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

  it.each([
    { minutes: 11_520, screen: '192 h', format: HOURS_FORMAT_HOURS },
    { minutes: 750, screen: '12 h 30 min', format: HOURS_FORMAT_HOURS_MINUTES },
    { minutes: 30, screen: '30 min', format: HOURS_FORMAT_MINUTES },
    { minutes: 0, screen: '0 h', format: HOURS_FORMAT_HOURS },
  ])('$minutes min: the duration $minutes / 1440, in the format of the screen’s $screen', ({ minutes, screen, format }) => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const [first] = view.rows;
    const row = { ...first!, hours: { ...first!.hours, totalMinutes: minutes } };
    const sheet = hoursExportOf({ ...view, rows: [row] }, pilot.organizationName);

    expect(t(durationMessageKey(minutes), { hours: Math.floor(minutes / 60), minutes: minutes % 60 })).toBe(screen);
    expect(sheet.rows[0]!.at(-3)).toEqual({ kind: 'hours', value: minutes / 1440, shape: hoursShapeOf(minutes) });
    expect(sheetDataOf(sheet)[1]!.at(-3)).toEqual({ type: Number, value: minutes / 1440, format });
  });

  it('the formats: whole hours, hours and minutes, minutes — `[h]` never wraps at a day', () => {
    expect(HOURS_FORMAT_HOURS).toBe('[h] "h"');
    expect(HOURS_FORMAT_HOURS_MINUTES).toBe('[h] "h" m "min"');
    expect(HOURS_FORMAT_MINUTES).toBe('[m] "min"');
    expect(hoursCellFormatOf(hoursShapeOf(11_520))).toBe(HOURS_FORMAT_HOURS);
    expect(11_520 / 1440).toBe(8);
  });

  it('leave: one cell of days, a plain count, empty at 0, the number the row shows', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const [first] = view.rows;
    const rowWith = (days: number) => ({ ...first!, leaveDays: days, leave: leaveFigureOf(days) });
    const some = hoursExportOf({ ...view, rows: [rowWith(3)] }, pilot.organizationName);
    // The domain's leave minutes are shown nowhere, the file included.
    const decided = hoursExportOf(
      { ...view, rows: [{ ...rowWith(3), hours: { ...first!.hours, leaveMinutes: 720 } }] },
      pilot.organizationName,
    );
    const none = hoursExportOf({ ...view, rows: [first!] }, pilot.organizationName);

    expect(first!.leave).toBeNull();
    expect(none.rows[0]!.at(-2)).toEqual({ kind: 'empty' });
    expect(sheetDataOf(none)[1]!.at(-2)).toBeNull();
    expect(some.rows[0]!.at(-2)).toEqual({ kind: 'count', value: 3 });
    expect(sheetDataOf(some)[1]!.at(-2)).toEqual({ type: Number, value: 3 });
    expect(decided.rows[0]).toEqual(some.rows[0]);
    expect(t('sati.organization.export.leaveDays')).toBe('Godišnji odmor (dani)');
    // Every other figure is unchanged by the leave.
    expect(some.rows[0]!.slice(0, -2)).toEqual(none.rows[0]!.slice(0, -2));
    expect(some.rows[0]!.at(-1)).toEqual(none.rows[0]!.at(-1));
  });

  it('a recorded leave reads back as the row\'s days', () => {
    const memberId = viewOf(pilot, NO_LEAVE_RECORDS).rows[0]!.memberId;
    const view = viewOf(pilot, new Map([[memberId, [{ from: `${MONTH}-05`, to: `${MONTH}-12` }]]]), { mjesec: MONTH });
    const index = view.rows.findIndex((row) => row.memberId === memberId);
    const row = view.rows[index]!;
    const sheet = hoursExportOf(view, pilot.organizationName);

    expect(row.leaveDays).toBeGreaterThan(0);
    expect(row.leave).toEqual({ key: 'count.days', values: { count: row.leaveDays } });
    expect(sheet.rows[index]!.at(-2)).toEqual({ kind: 'count', value: row.leaveDays });
  });

  it('no team: the cell is the text the screen shows', () => {
    const sheet = hoursExportOf(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: MONTH, osoba: DORA }), pilot.organizationName);

    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]![1]).toEqual({ kind: 'text', value: t('sati.organization.noTeam') });
    expect(t('sati.organization.noTeam')).toBe('—');
  });

  it('zero bands: Member, Team, shifts, Total, leave days, conflicts', async () => {
    const view = viewOf(await organizationOf({ ...PILOT, bands: [] }), NO_LEAVE_RECORDS);
    const sheet = hoursExportOf(view, pilot.organizationName);

    expect(sheet.columns).toEqual([
      t('sati.organization.member'),
      t('sati.organization.team'),
      t('sati.organization.shifts'),
      t('sati.organization.total'),
      t('sati.organization.export.leaveDays'),
      t('sati.organization.conflicts'),
    ]);
    for (const row of sheet.rows) expect(row).toHaveLength(6);
  });

  it('a band a row does not carry refuses the sheet', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const broken = { ...view, bands: [...view.bands, { ...view.bands[0]!, bandId: 'gone' }] };

    expect(() => hoursExportOf(broken, pilot.organizationName)).toThrow(RangeError);
  });

  it('writes every figure as a number cell, every heading as text, and an empty leave as no cell', () => {
    const view = viewOf(uj5, NO_LEAVE_RECORDS);
    const sheet = hoursExportOf(view, uj5.organizationName);
    const [header, ...rows] = sheetDataOf(sheet);

    expect(header).toEqual(sheet.columns.map((column) => ({ type: String, value: column, fontWeight: 'bold' })));
    for (const [index, row] of rows.entries()) {
      const figures = row.slice(2, -2);
      const leave = view.rows[index]!.leave;

      expect(row.slice(0, 2).map((cell) => (cell as { type: unknown }).type)).toEqual([String, String]);
      expect(figures.every((cell) => (cell as { type: unknown }).type === Number)).toBe(true);
      expect(
        figures.slice(1).every((cell) => {
          const minutes = Math.round((cell as { value: number }).value * 1440);

          return (cell as { format?: string }).format === hoursCellFormatOf(hoursShapeOf(minutes));
        }),
      ).toBe(true);
      expect((row[2] as { format?: string }).format).toBeUndefined();
      // The leave cell as the row has it: none when no day, else the days a plain number, no duration format.
      if (leave === null) expect(row.at(-2)).toBeNull();
      else expect(row.at(-2)).toEqual({ type: Number, value: leave.values.count });
      // The conflict count: a plain number, no duration format, 0 included.
      expect(row.at(-1)).toEqual({ type: Number, value: view.rows[index]!.conflictCount });
    }
  });
});

describe('the column widths', () => {
  it('the names wide, each figure at least 10 and as wide as its heading, at most 24', () => {
    const sheet = hoursExportOf(viewOf(uj5, NO_LEAVE_RECORDS), uj5.organizationName);
    const widths = columnWidthsOf(sheet).map((column) => column.width);

    expect(widths).toHaveLength(sheet.columns.length);
    expect(widths.slice(0, 2)).toEqual([28, 20]);
    for (const [index, width] of widths.slice(2).entries()) {
      const heading = sheet.columns[index + 2]!;

      const widest = Math.max(0, ...sheet.rows.map((row) => renderedLengthOf(row[index + 2]!)));

      expect(width).toBe(Math.max(10, Math.min(24, heading.length + 2), widest + 2));
    }
    const long = columnWidthsOf({ ...sheet, columns: [...sheet.columns.slice(0, 3), 'P'.repeat(60)] });

    expect(long.at(-1)).toEqual({ width: 24 });
  });

  it('a figure column is never narrower than its widest figure as the file renders it, so Excel shows no ####', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const [first] = view.rows;
    const wide = { ...first!, hours: { ...first!.hours, totalMinutes: 999 * 60 + 30 } };
    const sheet = hoursExportOf({ ...view, rows: [wide] }, pilot.organizationName);
    const total = sheet.columns.indexOf(t('sati.organization.total'));
    const cell = sheet.rows[0]![total]!;

    expect(renderedLengthOf(cell)).toBe('999 h 30 min'.length);
    expect(columnWidthsOf(sheet)[total]!.width).toBeGreaterThanOrEqual('999 h 30 min'.length + 2);
    expect(renderedLengthOf({ kind: 'hours', value: 11_520 / 1440, shape: hoursShapeOf(11_520) })).toBe('192 h'.length);
    expect(renderedLengthOf({ kind: 'hours', value: 30 / 1440, shape: hoursShapeOf(30) })).toBe('30 min'.length);
    expect(renderedLengthOf({ kind: 'hours', value: 750 / 1440, shape: hoursShapeOf(750) })).toBe('12 h 30 min'.length);
  });
});

describe('the file name', () => {
  it('carries the organization, the lowercase month and the year', () => {
    expect(hoursExportOf(viewOf(pilot, NO_LEAVE_RECORDS), 'DVD Mladost').fileName).toBe('Sati DVD Mladost rujan 2026.xlsx');
  });

  it('unsafe org name: \\ / : * ? " < > | are removed', () => {
    expect(hoursExportOf(viewOf(pilot, NO_LEAVE_RECORDS), 'DVD "A/B"').fileName).toBe('Sati DVD AB rujan 2026.xlsx');
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
    expect(hoursExportOf(viewOf(pilot, NO_LEAVE_RECORDS), 'x'.repeat(120)).fileName).toBe(`Sati ${'x'.repeat(100)} rujan 2026.xlsx`);
  });

  it('an organization with nothing left is omitted cleanly, with no double space', () => {
    for (const name of ['???', ' "/" ', '...', '\u0001']) {
      expect(hoursExportOf(viewOf(pilot, NO_LEAVE_RECORDS), name).fileName, JSON.stringify(name)).toBe('Sati rujan 2026.xlsx');
    }
  });

  it('follows the period shown', () => {
    expect(hoursExportOf(viewOf(pilot, NO_LEAVE_RECORDS, { mjesec: '2027-01' }), 'DVD').fileName).toBe('Sati DVD siječanj 2027.xlsx');
  });
});

describe('the action', () => {
  it('no rows: closed; closed while building; otherwise open', () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);

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
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const written: HoursExport[] = [];

    await expect(
      exportHours(view, pilot.organizationName, async (sheet) => {
        written.push(sheet);
      }),
    ).resolves.toEqual({ fileName: hoursExportOf(view, pilot.organizationName).fileName, count: view.rows.length });
    expect(written).toEqual([hoursExportOf(view, pilot.organizationName)]);
  });

  it('the status line names the file written and how many people it holds (story 7.14)', async () => {
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const done = await exportHours(view, pilot.organizationName, () => Promise.resolve());

    expect(done).toEqual({ fileName: hoursExportOf(view, pilot.organizationName).fileName, count: view.rows.length });
    expect(t('sati.organization.export.done', done!)).toContain(done!.fileName);
    expect(t('sati.organization.export.done', { fileName: 'x.xlsx', count: 1 })).toContain('1 osobom');
    expect(t('sati.organization.export.done', { fileName: 'x.xlsx', count: 3 })).toContain('3 osobe');
    expect(t('sati.organization.export.done', { fileName: 'x.xlsx', count: 17 })).toContain('17 osoba');
  });

  it('import fails: logged, answered null, never thrown — and a build that throws the same', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = viewOf(pilot, NO_LEAVE_RECORDS);
    const chunk = new TypeError('Failed to fetch dynamically imported module');

    await expect(exportHours(view, pilot.organizationName, () => Promise.reject(chunk))).resolves.toBeNull();
    expect(errors).toHaveBeenCalledWith(HOURS_EXPORT_FAILED, chunk);
    const broken = { ...view, bands: [...view.bands, { ...view.bands[0]!, bandId: 'gone' }] };

    await expect(exportHours(broken, pilot.organizationName, () => Promise.resolve())).resolves.toBeNull();
    expect(errors).toHaveBeenLastCalledWith(HOURS_EXPORT_FAILED, expect.any(RangeError));
  });
});
