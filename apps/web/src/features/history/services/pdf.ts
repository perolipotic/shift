import { bytesOfBase64, sharedCoverageOf } from '@/features/history/services/font-coverage';
import {
  yieldToUi,
  type HistoryExport,
  type HistoryExportChange,
  type HistoryExportRow,
} from '@/features/history/services/history-export';
import { drawableExport, type Covers } from '@/features/history/services/history-pdf-text';

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
 *
 * A ROW IS NEVER CUT BY A PAGE (epic 14 retro A9). pdfmake continued a row
 * that did not fit at a page's foot with empty *Vrijeme*, *Autor*, *Vrsta*
 * and *Predmet* cells, and under `dontBreakRows` it silently drops a row
 * taller than a page. So an entry's changes are packed into table rows whose
 * estimated height always fits a page (`historyChunksOf`), each repeating the
 * identifying cells, every one after the first marked *(nastavak)*, and the
 * table keeps every row whole.
 *
 * WHAT ROBOTO CANNOT DRAW IS REPLACED before layout, against the faces the
 * writer registers (`./font-coverage`, `./history-pdf-text`).
 */

/** The font every string is drawn in: pdfmake's bundled Roboto. */
export const HISTORY_PDF_FONT = 'Roboto';

/** pdfmake's own Roboto table (`src/browser-extensions/index.js`): the faces in `vfs_fonts`. */
export const HISTORY_PDF_FACES = {
  normal: 'Roboto-Regular.ttf',
  bold: 'Roboto-Medium.ttf',
  italics: 'Roboto-Italic.ttf',
  bolditalics: 'Roboto-MediumItalic.ttf',
} as const;

const FONT_SIZE = 8;

const MARGIN = 32;
const PAGE_MARGINS = [MARGIN, 40, MARGIN, 40] as const;
/** A4 landscape in points, as pdfmake sizes it. */
const PAGE_WIDTH = 841.89;
export const HISTORY_PDF_PAGE_HEIGHT = 595.28;
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

/** Roboto's line at 8 pt: (ascender 1900 − descender −500) / 2048 em. */
export const HISTORY_PDF_LINE_HEIGHT = (2400 / 2048) * FONT_SIZE;
/** The air between two changes: 2 pt under one, 2 pt over the next. */
const CHANGE_GAP = 4;
/**
 * The most a table row's changes are estimated to take. A row this tall,
 * under the repeated header row, fits an empty page (pinned in `pdf.test.ts`),
 * so `dontBreakRows` moves it to the next page whole and never drops it.
 */
export const HISTORY_PDF_CHUNK_HEIGHT = 400;
/**
 * The width a character is estimated at: one em (8 pt), against Roboto's
 * average of about half that, which absorbs what wrapping at word boundaries
 * wastes. Roboto's widest glyph is 1.18 em: a chunk of nothing but those still
 * fits a page, as the budget leaves room for it (pinned in `pdf.test.ts`).
 */
export const HISTORY_PDF_CHARACTER_WIDTH = FONT_SIZE;
const LINE_CHARACTERS = Math.floor(FLEX_WIDTH / HISTORY_PDF_CHARACTER_WIDTH);
/** The most lines one change's side may be estimated at: a longer side continues on the next row. */
const SIDE_LINES = Math.floor((HISTORY_PDF_CHUNK_HEIGHT - CHANGE_GAP) / HISTORY_PDF_LINE_HEIGHT);

/** `paragraph` cut into lines of at most `perLine` characters, after a space where one is near; joined back with `''`, it is `paragraph`. */
function linesOf(paragraph: string, perLine = LINE_CHARACTERS): string[] {
  const characters = [...paragraph];
  const lines: string[] = [];

  while (characters.length > perLine) {
    const head = characters.slice(0, perLine);
    const space = head.findLastIndex((character) => /\s/u.test(character));
    const cut = space >= perLine / 2 ? space + 1 : perLine;

    lines.push(characters.splice(0, cut).join(''));
  }
  lines.push(characters.join(''));

  return lines;
}

/** The lines `text` is estimated to take in a column `width` points wide: each paragraph at least one. */
function lineCountOf(text: string, width = FLEX_WIDTH): number {
  const perLine = Math.max(1, Math.floor(width / HISTORY_PDF_CHARACTER_WIDTH));

  return text.split('\n').reduce((sum, paragraph) => sum + linesOf(paragraph, perLine).length, 0);
}

/**
 * The estimated height of a row's identifying cells (time and *(nastavak)*,
 * author, kind and badge, subject): repeated on each chunk beside it, so it
 * must stay under the budget too (pinned in `pdf.test.ts` for the longest
 * names).
 */
export function historyIdentifyingHeightOf(row: HistoryExportRow, continued: string): number {
  const [time, author, kind] = FIXED_WIDTHS;
  const subject = FLEX_WIDTH;
  const lines = Math.max(
    lineCountOf(row.time, time) + lineCountOf(continued, time),
    lineCountOf(row.author, author),
    lineCountOf(row.kind, kind) + (row.badge === null ? 0 : lineCountOf(row.badge, kind)),
    lineCountOf(row.subject, subject),
  );

  return lines * HISTORY_PDF_LINE_HEIGHT;
}

/** `text` in pieces of at most SIDE_LINES estimated lines, in order; nothing is dropped. */
function piecesOf(text: string): string[] {
  const pieces: string[] = [];
  let piece = '';
  let used = 0;

  text.split('\n').forEach((paragraph, index) => {
    linesOf(paragraph).forEach((line, at) => {
      if (used === SIDE_LINES) {
        pieces.push(piece);
        piece = '';
        used = 0;
      }
      // A new paragraph starts on a new line, unless it starts a piece.
      piece += at === 0 && index > 0 && used > 0 ? `\n${line}` : line;
      used += 1;
    });
  });
  pieces.push(piece);

  return pieces;
}

function heightOf(change: HistoryExportChange): number {
  return Math.max(lineCountOf(change.before), lineCountOf(change.after)) * HISTORY_PDF_LINE_HEIGHT + CHANGE_GAP;
}

/** A change too tall for one row, as consecutive pieces of its two sides. */
function partsOf(change: HistoryExportChange): readonly HistoryExportChange[] {
  if (lineCountOf(change.before) <= SIDE_LINES && lineCountOf(change.after) <= SIDE_LINES) return [change];

  const before = piecesOf(change.before);
  const after = piecesOf(change.after);

  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => ({
    before: before[index] ?? '',
    after: after[index] ?? '',
  }));
}

/**
 * The table rows `row` is drawn as: its changes, in order, packed so no row's
 * estimated height passes HISTORY_PDF_CHUNK_HEIGHT. A row with no visible
 * change is one table row.
 */
export function historyChunksOf(row: HistoryExportRow): readonly (readonly HistoryExportChange[])[] {
  const chunks: HistoryExportChange[][] = [];
  let chunk: HistoryExportChange[] = [];
  let height = 0;

  for (const part of row.changes.flatMap(partsOf)) {
    const partHeight = heightOf(part);

    if (chunk.length > 0 && height + partHeight > HISTORY_PDF_CHUNK_HEIGHT) {
      chunks.push(chunk);
      chunk = [];
      height = 0;
    }
    chunk.push(part);
    height += partHeight;
  }
  chunks.push(chunk);

  return chunks;
}

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
function changesCellOf(row: HistoryExportRow, changes: readonly HistoryExportChange[]): object {
  if (row.none !== null || changes.length === 0) return { text: row.none ?? '', colSpan: 2 };

  return {
    colSpan: 2,
    layout: sidesLayout(changes.length),
    table: {
      widths: [...SIDE_WIDTHS],
      body: changes.map((change) => [{ text: change.before }, { text: change.after }]),
    },
  };
}

function kindCellOf(row: HistoryExportRow): object {
  return {
    stack: [{ text: row.kind }, ...(row.badge === null ? [] : [{ text: row.badge, italics: true }])],
  };
}

/** The time, and under it *(nastavak)* on a row that continues the entry above. */
function timeCellOf(row: HistoryExportRow, continued: string | null): object {
  return continued === null ? { text: row.time } : { stack: [{ text: row.time }, { text: continued, italics: true }] };
}

function rowCellsOf(row: HistoryExportRow, changes: readonly HistoryExportChange[], continued: string | null): readonly object[] {
  return [
    timeCellOf(row, continued),
    { text: row.author },
    kindCellOf(row),
    { text: row.subject },
    changesCellOf(row, changes),
    spannedCell(),
  ];
}

/** Every table row of `model`, an entry's continuations after it, each repeating its identifying cells. */
function bodyRowsOf(model: HistoryExport): readonly (readonly object[])[] {
  return model.rows.flatMap((row) =>
    historyChunksOf(row).map((changes, index) => rowCellsOf(row, changes, index === 0 ? null : model.continued)),
  );
}

/** The pdfmake document definition: pure, so the node suite reads every string it draws. */
export function historyDocumentOf(model: HistoryExport) {
  return {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [...PAGE_MARGINS],
    info: { title: model.title },
    defaultStyle: { font: HISTORY_PDF_FONT, fontSize: FONT_SIZE },
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
          // Safe only because no row is taller than a page (`historyChunksOf`): pdfmake drops one that is.
          dontBreakRows: true,
          widths: [...WIDTHS],
          body: [model.columns.map((column) => ({ text: column, bold: true })), ...bodyRowsOf(model)],
        },
      },
    ],
  };
}

/** The code points every registered face draws, read once from `vfs_fonts`. */
let coverage: ReadonlySet<number> | null = null;

/** The code points all four Roboto faces in `vfs` map. */
export function historyPdfCoverageOf(vfs: Readonly<Record<string, string>>): ReadonlySet<number> {
  return sharedCoverageOf(Object.values(HISTORY_PDF_FACES).map((file) => bytesOfBase64(vfs[file] ?? '')));
}

/**
 * The definition the writer hands pdfmake: `model` with every character the
 * faces lack replaced, laid out. The render test renders THIS, so it is the
 * writer's own composition that is proven.
 */
export function historyPdfDefinitionOf(model: HistoryExport, covers: Covers) {
  return historyDocumentOf(drawableExport(model, covers));
}

/**
 * Writes `model` and hands it to the browser as a download named
 * `model.fileName`. The stages it can split yield to the UI between them;
 * pdfmake's own layout and rendering is one synchronous call, bounded by
 * `HISTORY_EXPORT_LIMIT`.
 */
export async function writeHistoryExport(model: HistoryExport): Promise<void> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);

  pdfMake.addVirtualFileSystem(vfs);
  await yieldToUi();
  coverage ??= historyPdfCoverageOf(vfs);

  const drawn = coverage;

  await yieldToUi();
  const definition = historyPdfDefinitionOf(model, (point) => drawn.has(point));

  await yieldToUi();
  await pdfMake.createPdf(definition).download(model.fileName);
}
