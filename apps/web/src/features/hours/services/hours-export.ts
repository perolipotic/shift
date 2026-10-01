import type { OrganizationHoursRow, OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { t } from '@/lib/i18n';
import { formatIsoMonthName } from '@/lib/i18n/format';

/**
 * The organization's month as a sheet (story 4.3): exactly the rows the
 * table shows, in its order, filter and period — the SAME
 * `OrganizationHoursView` the table rendered; nothing is read again.
 *
 * EVERY RULE OF THE EXPORT IS HERE (AD-15), and the node suite executes it:
 * the columns, the cells, the sheet's and the file's names, when the action
 * is offered, and what a failed build does. `./xlsx` is the only module that
 * knows the writer, and it only maps these cells onto it.
 *
 * NO HOUR IS COMPUTED HERE (AD-3, AD-7). Every figure is the domain's minutes
 * on `row.hours`, divided by 1440 — a spreadsheet duration, a fraction of a
 * day, which `./xlsx` formats `[h]:mm` — never a parsed display string, so
 * the file's figures are the screen's (`750` minutes reads `12:30`, as the
 * screen's `12 h 30 min`). The one division is the only arithmetic.
 */

/** A cell of the sheet: text as it reads, or a figure as a number. */
export type HoursExportCell =
  | { readonly kind: 'text'; readonly value: string }
  /** A duration: `minutes / 1440`, a fraction of a day. */
  | { readonly kind: 'hours'; readonly value: number }
  /** A count of shifts. */
  | { readonly kind: 'count'; readonly value: number };

/** The sheet, ready for a writer: one header row, then one row per table row. */
export interface HoursExport {
  readonly fileName: string;
  readonly sheetName: string;
  /** The header row: Member, Team, shifts, one per band (its name as stored), Total, Leave. */
  readonly columns: readonly string[];
  /** One row per `view.rows` entry, in order; each as long as `columns`. */
  readonly rows: readonly (readonly HoursExportCell[])[];
}

/** The file's extension: a format, not copy. */
const HOURS_EXPORT_EXTENSION = '.xlsx';

/** Minutes in a day: a spreadsheet stores a duration as a fraction of one. */
const MINUTES_PER_DAY = 1440;

/** The longest the organization's part of a file name may be. */
export const FILE_NAME_ORGANIZATION_MAX = 100;

/** The build or the writer failed: logged beside it, never shown. */
export const HOURS_EXPORT_FAILED = 'HOURS_EXPORT_FAILED';

/** The characters no file name may carry on the systems an admin saves to. */
const UNSAFE_FILE_NAME = /[\\/:*?"<>|]/g;

/** Minutes a figure holds, as a spreadsheet duration. */
function durationOf(minutes: number): number {
  return minutes / MINUTES_PER_DAY;
}

/** Trailing dots and spaces, which Windows drops from a file name. */
const TRAILING_DOTS = /[. ]+$/;

/**
 * The organization's name as the file name may carry it: the unsafe
 * characters and the control characters (U+0000–U+001F) removed, its spacing
 * closed up, trailing dots and spaces dropped, and at most
 * {@link FILE_NAME_ORGANIZATION_MAX} characters. `''` when nothing is left.
 */
export function fileNameSafeOf(name: string): string {
  const visible = [...name.replace(UNSAFE_FILE_NAME, '')].filter((character) => character.charCodeAt(0) > 0x1f).join('');
  const spaced = visible.replace(/\s+/g, ' ').trim().replace(TRAILING_DOTS, '');

  return [...spaced].slice(0, FILE_NAME_ORGANIZATION_MAX).join('').trim().replace(TRAILING_DOTS, '');
}

function text(value: string): HoursExportCell {
  return { kind: 'text', value };
}

function hours(minutes: number): HoursExportCell {
  return { kind: 'hours', value: durationOf(minutes) };
}

/**
 * One table row as cells, the bands in `bandIds` order.
 *
 * @throws RangeError for a band the row's hours do not carry.
 */
function cellsOf(row: OrganizationHoursRow, bandIds: readonly string[]): readonly HoursExportCell[] {
  const bands = bandIds.map((bandId) => {
    const band = row.hours.bands.find((one) => one.bandId === bandId);

    if (band === undefined) throw new RangeError(`band ${bandId} is not in the row of ${row.memberId}`);

    return hours(band.minutes);
  });

  return [
    text(row.name),
    text(row.team === null ? t('sati.organization.noTeam') : row.team.name),
    { kind: 'count', value: row.shiftCount },
    ...bands,
    hours(row.hours.totalMinutes),
    hours(row.hours.leaveMinutes),
  ];
}

/**
 * The sheet `view` stands for, `organizationName` the snapshot's.
 *
 * @throws RangeError for a month the locale layer cannot name, or a band a
 *   row lacks.
 */
export function hoursExportOf(view: OrganizationHoursView, organizationName: string): HoursExport {
  const month = formatIsoMonthName(`${view.header.month}-01`);

  if (month === null) throw new RangeError(`the month ${view.header.month}`);

  const bandIds = view.bands.map((band) => band.bandId);
  const fileName = t('sati.organization.export.fileName', {
    organization: fileNameSafeOf(organizationName),
    month,
    year: view.header.year,
  });

  return {
    // An organization with nothing left to show leaves its gap, closed here.
    fileName: `${fileName.replace(/ {2,}/g, ' ').trim()}${HOURS_EXPORT_EXTENSION}`,
    sheetName: t('sati.organization.export.sheetName'),
    columns: [
      t('sati.organization.member'),
      t('sati.organization.team'),
      t('sati.organization.shifts'),
      ...view.bands.map((band) => band.name),
      t('sati.organization.total'),
      t('sati.organization.leave'),
    ],
    rows: view.rows.map((row) => cellsOf(row, bandIds)),
  };
}

/**
 * Whether the action is closed outright: no row to export. Drawn as a native
 * `disabled`, out of the tab order, because there is nothing it could do.
 */
export function hoursExportEmpty(view: OrganizationHoursView): boolean {
  return view.rows.length === 0;
}

/**
 * Whether choosing the action does nothing: no row to export, or a file
 * already being built. While building it stays FOCUSABLE (`aria-disabled`),
 * so the keyboard focus the press put on it is not dropped to the page.
 */
export function hoursExportDisabled(view: OrganizationHoursView, pending: boolean): boolean {
  return pending || hoursExportEmpty(view);
}

/** The action's label: its imperative, or what it says while the file is built. */
export function hoursExportMessageKey(
  pending: boolean,
): 'sati.organization.export.action' | 'sati.organization.export.pending' {
  return pending ? 'sati.organization.export.pending' : 'sati.organization.export.action';
}

/** What writes a sheet to a file: `./xlsx`'s writer, or a test's. */
export type HoursExportWriter = (sheet: HoursExport) => Promise<void>;

/**
 * Builds the sheet and writes it, GUARDED: a failed build, a writer that
 * cannot load, or one that refuses, is logged and answered `false` — never
 * thrown, so the screen shows its message and offers the action again.
 */
export async function exportHours(
  view: OrganizationHoursView,
  organizationName: string,
  write: HoursExportWriter,
): Promise<boolean> {
  try {
    await write(hoursExportOf(view, organizationName));

    return true;
  } catch (cause) {
    console.error(HOURS_EXPORT_FAILED, cause);

    return false;
  }
}
