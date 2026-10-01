import type { Cell, SheetData } from 'write-excel-file/browser';

import type { HoursExport, HoursExportCell } from '@/features/hours/services/hours-export';

/**
 * THE ONLY MODULE THAT KNOWS THE XLSX WRITER (story 4.3): `write-excel-file`,
 * pinned in `apps/web/package.json`. It is loaded by a dynamic `import()`
 * here, when an admin chooses the export, and never before — so it never
 * enters the entry chunk (`test/localization-applied.test.ts` holds that).
 *
 * It decides nothing: `./hours-export` built the sheet, and this maps each of
 * its cells onto the writer's — text as text, a count as a number, and hours
 * as a duration in `[h]:mm`, so 750 minutes reads `12:30` as the screen's
 * `12 h 30 min`, a total past a day keeps its hours (`108:00`), and a column
 * sums natively.
 */

/** A duration in hours and minutes; `[h]` does not wrap at 24. */
export const HOURS_CELL_FORMAT = '[h]:mm';

/** Column widths, in characters: the names wide, a figure narrow, a band's by its name. */
const NAME_WIDTH = 28;
const TEAM_WIDTH = 20;
const FIGURE_WIDTH = 10;
const FIGURE_WIDTH_MAX = 24;

/**
 * Each column's width: Member and Team wide, every figure at least
 * {@link FIGURE_WIDTH} and as wide as its heading, up to {@link FIGURE_WIDTH_MAX}.
 */
export function columnWidthsOf(sheet: HoursExport): readonly { readonly width: number }[] {
  return sheet.columns.map((column, index) => {
    if (index === 0) return { width: NAME_WIDTH };
    if (index === 1) return { width: TEAM_WIDTH };

    return { width: Math.min(FIGURE_WIDTH_MAX, Math.max(FIGURE_WIDTH, [...column].length + 2)) };
  });
}

function cellOf(cell: HoursExportCell): Cell {
  switch (cell.kind) {
    case 'text':
      return { type: String, value: cell.value };
    case 'count':
      return { type: Number, value: cell.value };
    case 'hours':
      return { type: Number, value: cell.value, format: HOURS_CELL_FORMAT };
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
