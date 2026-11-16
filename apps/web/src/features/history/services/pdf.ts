import type { HistoryExport, HistoryExportRow } from '@/features/history/services/history-export';

/**
 * THE ONLY MODULE THAT KNOWS THE PDF WRITER (story 14.3; spine AD-11):
 * `pdfmake`, pinned in `apps/web/package.json`. It and its fonts are loaded
 * by a dynamic `import()` here, when an admin chooses the export, and never
 * before — so neither enters the entry chunk nor the service worker's
 * precache (`vite.config.ts` `globIgnores`; `test/localization-applied.test.ts`
 * and `test/static-hosting.test.ts` hold both). The export is online only.
 *
 * It decides nothing: `./history-export` built the document, and this lays it
 * out — landscape A4, the header row repeated on each page, *Bilo* and *Sada*
 * side by side so each change's two sides align, and `Stranica n od m` in the
 * footer. Every string is drawn in Roboto, the faces `pdf.test.ts` checks
 * every character against: bold is Roboto-Medium, italic Roboto-Italic.
 */

/** The font every string is drawn in: pdfmake's bundled Roboto. */
export const HISTORY_PDF_FONT = 'Roboto';

const MARGIN = 32;
const PAGE_MARGINS = [MARGIN, 40, MARGIN, 40] as const;
/** A4 landscape's width in points, as pdfmake sizes it. */
const PAGE_WIDTH = 841.89;
/** pdfmake's default table layout: 4 pt either side of a cell's text, 1 pt lines. */
const CELL_PADDING = 4;
const LINE = 1;
/** Vrijeme, Autor, Vrsta: wide enough for `16. 11. 2026. 10:42` and a kind's words. */
const FIXED_WIDTHS = [80, 70, 90] as const;
/**
 * Predmet, *Bilo* and *Sada* share what is left, in POINTS, never `'*'`: a
 * star column grows to its longest unbroken word (an e-mail address, a link),
 * and one such word widened the whole table off the page, *Bilo* and *Sada*
 * with it (seen on a rendered export, story 14.3 review). A fixed width makes
 * pdfmake break that word inside its cell instead.
 */
const FLEX_WIDTH = Math.floor(
  (PAGE_WIDTH -
    2 * MARGIN -
    6 * 2 * CELL_PADDING -
    7 * LINE -
    FIXED_WIDTHS.reduce((sum, width) => sum + width, 0)) /
    3,
);
/** Vrijeme, Autor, Vrsta, Predmet, *Bilo*, *Sada*. */
const WIDTHS = [...FIXED_WIDTHS, FLEX_WIDTH, FLEX_WIDTH, FLEX_WIDTH] as const;
/**
 * The change table inside the `colSpan: 2` cell, also in points: the span is
 * both columns, the padding between them and their line. With no padding on
 * its outer edges, *Bilo*'s text starts where the row's other text does, and
 * *Sada*'s under its header.
 */
const SIDE_WIDTHS = [FLEX_WIDTH + 1, FLEX_WIDTH] as const;

/**
 * A cell that a `colSpan` to its left covers: pdfmake wants it present and
 * empty. A FRESH object per row, as pdfmake writes its layout state onto
 * every node it lays out.
 */
function spannedCell(): object {
  return {};
}

/**
 * A change's own two-column table: no lines, no padding on its outer edges (so
 * its first line sits on the row's first line), the outer table's padding
 * between the two sides, and a little air between two changes.
 */
function sidesLayout(changes: number): object {
  return {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: (column: number) => (column === 0 ? 0 : CELL_PADDING),
    paddingRight: (column: number) => (column === 0 ? CELL_PADDING : 0),
    paddingTop: (row: number) => (row === 0 ? 0 : 2),
    paddingBottom: (row: number) => (row === changes - 1 ? 0 : 2),
  };
}

/** A row's *Bilo* and *Sada*: a borderless two-column table so each change's sides align, or the `none` line across both. */
function changesCellOf(row: HistoryExportRow): object {
  if (row.none !== null) return { text: row.none, colSpan: 2 };

  return {
    colSpan: 2,
    layout: sidesLayout(row.changes.length),
    table: {
      widths: [...SIDE_WIDTHS],
      body: row.changes.map((change) => [{ text: change.before }, { text: change.after }]),
    },
  };
}

function kindCellOf(row: HistoryExportRow): object {
  return {
    stack: [{ text: row.kind }, ...(row.badge === null ? [] : [{ text: row.badge, italics: true }])],
  };
}

function rowCellsOf(row: HistoryExportRow): readonly object[] {
  return [
    { text: row.time },
    { text: row.author },
    kindCellOf(row),
    { text: row.subject },
    changesCellOf(row),
    spannedCell(),
  ];
}

/** The pdfmake document definition: pure, so the node suite reads every string it draws. */
export function historyDocumentOf(model: HistoryExport) {
  return {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [...PAGE_MARGINS],
    info: { title: model.title },
    defaultStyle: { font: HISTORY_PDF_FONT, fontSize: 8 },
    footer: (page: number, pages: number) => ({
      text: model.pageText(page, pages),
      alignment: 'right',
      margin: [MARGIN, 12],
    }),
    content: [
      { text: model.title, bold: true, fontSize: 14, margin: [0, 0, 0, 6] },
      ...model.lines.map((text) => ({ text, margin: [0, 0, 0, 2] })),
      {
        margin: [0, 8, 0, 0],
        table: {
          headerRows: 1,
          widths: [...WIDTHS],
          body: [model.columns.map((column) => ({ text: column, bold: true })), ...model.rows.map(rowCellsOf)],
        },
      },
    ],
  };
}

/** Writes `model` and hands it to the browser as a download named `model.fileName`. */
export async function writeHistoryExport(model: HistoryExport): Promise<void> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);

  pdfMake.addVirtualFileSystem(vfs);
  await pdfMake.createPdf(historyDocumentOf(model)).download(model.fileName);
}
