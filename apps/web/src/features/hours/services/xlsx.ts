import type { Cell, SheetData } from 'write-excel-file/browser';

import {
  HOURS_SHAPE_HOURS,
  HOURS_SHAPE_HOURS_MINUTES,
  HOURS_SHAPE_MINUTES,
  type HoursExport,
  type HoursExportCell,
  type HoursShape,
} from '@/features/hours/services/hours-export';

/**
 * THE ONLY MODULE THAT KNOWS THE XLSX WRITER (story 4.3): `write-excel-file`,
 * pinned in `apps/web/package.json`. It is loaded by a dynamic `import()`
 * here, when an admin chooses the export, and never before — so it never
 * enters the entry chunk (`test/localization-applied.test.ts` holds that).
 *
 * It decides nothing: `./hours-export` built the sheet, and this maps each of
 * its cells onto the writer's — text as text, a count as a number, an empty
 * figure as no cell at all, and hours as a duration in the number format of
 * the shape the screen reads it in, so 750 minutes reads `12 h 30 min`,
 * 11 520 reads `192 h` (a total past a day keeps its hours), 30 reads
 * `30 min`, and a column still sums natively.
 */

/** Whole hours, `192 h`; `[h]` does not wrap at 24. */
export const HOURS_FORMAT_HOURS = '[h] "h"';
/** Hours and minutes, `12 h 30 min`; `m` after `h` is the minutes. */
export const HOURS_FORMAT_HOURS_MINUTES = '[h] "h" m "min"';
/** Under an hour, `30 min`; `[m]` is the elapsed minutes. */
export const HOURS_FORMAT_MINUTES = '[m] "min"';

/** The number format a shape reads in. Exhaustive. */
export function hoursCellFormatOf(shape: HoursShape): string {
  switch (shape) {
    case HOURS_SHAPE_HOURS:
      return HOURS_FORMAT_HOURS;
    case HOURS_SHAPE_HOURS_MINUTES:
      return HOURS_FORMAT_HOURS_MINUTES;
    case HOURS_SHAPE_MINUTES:
      return HOURS_FORMAT_MINUTES;
  }
}

/** Column widths, in characters: the names wide, a figure narrow, a band's by its name. */
const NAME_WIDTH = 28;
const TEAM_WIDTH = 20;
const FIGURE_WIDTH = 10;
const FIGURE_WIDTH_MAX = 24;
/** Room beside the widest text, so Excel never draws `####` for a figure that just fits. */
const PADDING = 2;

/**
 * How many characters a cell reads as in its number format: an hours cell as
 * the screen reads it (`192 h 30 min`), a count as its digits, an empty cell
 * as nothing. It reads the duration back to whole minutes only to measure it.
 */
export function renderedLengthOf(cell: HoursExportCell): number {
  switch (cell.kind) {
    case 'text':
      return [...cell.value].length;
    case 'count':
      return String(cell.value).length;
    case 'empty':
      return 0;
    case 'hours': {
      const minutes = Math.round(cell.value * 1440);
      const hours = String(Math.floor(minutes / 60)).length;
      const rest = String(minutes % 60).length;

      switch (cell.shape) {
        case HOURS_SHAPE_HOURS:
          return hours + ' h'.length;
        case HOURS_SHAPE_HOURS_MINUTES:
          return hours + ' h '.length + rest + ' min'.length;
        case HOURS_SHAPE_MINUTES:
          return String(minutes).length + ' min'.length;
      }
    }
  }
}

/**
 * Each column's width: Member and Team wide; every figure at least
 * {@link FIGURE_WIDTH}, as wide as its heading up to {@link FIGURE_WIDTH_MAX}
 * (a long heading wraps), and never narrower than its widest figure as the
 * file renders it, so no figure reads `####`.
 */
export function columnWidthsOf(sheet: HoursExport): readonly { readonly width: number }[] {
  return sheet.columns.map((column, index) => {
    if (index === 0) return { width: NAME_WIDTH };
    if (index === 1) return { width: TEAM_WIDTH };

    const heading = Math.min(FIGURE_WIDTH_MAX, [...column].length + PADDING);
    const widest = Math.max(0, ...sheet.rows.map((row) => (row[index] === undefined ? 0 : renderedLengthOf(row[index]))));

    return { width: Math.max(FIGURE_WIDTH, heading, widest + PADDING) };
  });
}

function cellOf(cell: HoursExportCell): Cell {
  switch (cell.kind) {
    case 'text':
      return { type: String, value: cell.value };
    case 'count':
      return { type: Number, value: cell.value };
    case 'hours':
      return { type: Number, value: cell.value, format: hoursCellFormatOf(cell.shape) };
    case 'empty':
      return null;
  }
}

/** The sheet as the writer's rows: the bold header row, then every row. */
export function sheetDataOf(sheet: HoursExport): SheetData {
  return [
    sheet.columns.map((column): Cell => ({ type: String, value: column, fontWeight: 'bold' })),
    ...sheet.rows.map((row) => row.map(cellOf)),
  ];
}

/** Writes `sheet` and hands it to the browser as a download named `sheet.fileName`. */
export async function writeHoursExport(sheet: HoursExport): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  await writeXlsxFile(sheetDataOf(sheet), {
    sheet: sheet.sheetName,
    stickyRowsCount: 1,
    columns: [...columnWidthsOf(sheet)],
  }).toFile(sheet.fileName);
}
