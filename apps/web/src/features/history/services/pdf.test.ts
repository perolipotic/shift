import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { codePointsOf } from '@/features/history/services/font-coverage';
import { historyExportOf, type HistoryExport, type HistoryExportRow } from '@/features/history/services/history-export';
import { REPLACEMENT } from '@/features/history/services/history-pdf-text';
import type { HistoryRow } from '@/features/history/services/history-rows';
import {
  HISTORY_PDF_CHARACTER_WIDTH,
  HISTORY_PDF_CHUNK_HEIGHT,
  HISTORY_PDF_FACES,
  HISTORY_PDF_FONT,
  HISTORY_PDF_LINE_HEIGHT,
  HISTORY_PDF_PAGE_HEIGHT,
  historyChunksOf,
  historyDocumentOf,
  historyIdentifyingHeightOf,
  historyPdfCoverageOf,
} from '@/features/history/services/pdf';
import { initLocalization, t } from '@/lib/i18n';
import { formatList } from '@/lib/i18n/format';
import resources from '@/lib/i18n/locales/hr.json';

/**
 * Story 14.3: every character the PDF draws is in the font it is drawn in.
 * pdfmake's bundled Roboto has č, ć, đ, š and ž but no `→` — a missing glyph
 * prints as an empty box, silently — so the document is walked string by
 * string, each against the cmap of the face it uses (bold: Roboto-Medium,
 * italic: Roboto-Italic), decoded from the same `vfs_fonts.js` the writer
 * registers, by the same cmap reader the writer substitutes with
 * (`./font-coverage`).
 */

type Face = keyof typeof HISTORY_PDF_FACES;

const vfs = createRequire(import.meta.url)('pdfmake/build/vfs_fonts.js') as Readonly<Record<string, string>>;
const fontOf = (face: Face): Buffer => Buffer.from(vfs[HISTORY_PDF_FACES[face]] ?? '', 'base64');

const FACES: Readonly<Record<Face, ReadonlySet<number>>> = {
  normal: codePointsOf(fontOf('normal')),
  bold: codePointsOf(fontOf('bold')),
  italics: codePointsOf(fontOf('italics')),
  bolditalics: codePointsOf(fontOf('bolditalics')),
};

/** The characters of `text` that `face` cannot draw (line breaks are layout, not glyphs). */
function missingIn(face: Face, text: string): string[] {
  return [...text].filter((character) => character !== '\n' && !FACES[face].has(character.codePointAt(0) ?? 0));
}

interface Drawn {
  readonly text: string;
  readonly face: Face;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every string a pdfmake node draws, with the face it is drawn in (bold and italics inherited). */
function drawnIn(node: unknown, bold: boolean, italics: boolean, out: Drawn[]): Drawn[] {
  if (typeof node === 'string') {
    out.push({ text: node, face: bold ? (italics ? 'bolditalics' : 'bold') : italics ? 'italics' : 'normal' });
  } else if (Array.isArray(node)) {
    for (const child of node) drawnIn(child, bold, italics, out);
  } else if (isRecord(node)) {
    const nextBold = typeof node['bold'] === 'boolean' ? node['bold'] : bold;
    const nextItalics = typeof node['italics'] === 'boolean' ? node['italics'] : italics;

    for (const key of ['text', 'stack', 'table', 'body'] as const) {
      if (key in node) drawnIn(node[key], nextBold, nextItalics, out);
    }
  }

  return out;
}

function row(overrides: Partial<HistoryRow> & Pick<HistoryRow, 'id'>): HistoryRow {
  return {
    time: '16.11.2026 09:05',
    author: 'Đurđa Šoštarić',
    kind: 'Smjena · promijenjeno',
    subject: 'Ćiril Žužić, Smjena Č',
    reconstructed: false,
    marker: false,
    changes: [],
    ...overrides,
  };
}

/** A document that draws every shape the export has, in every face, with č ć đ š ž. */
function fixture(): HistoryExport {
  return historyExportOf({
    view: {
      rows: [
        row({ id: '4', changes: [{ column: 'name', field: 'Naziv', before: 'Čađa – 1', after: 'Žuta, 2.' }] }),
        row({ id: '3', changes: [{ column: 'days', field: 'Dani', before: null, after: '12,5' }] }),
        row({ id: '2', reconstructed: true, changes: [{ column: 'note', field: 'Razlog', before: 'Šišmiš (đak)', after: null }] }),
        row({ id: '1' }),
        row({ id: '0', marker: true, subject: t('history.markerSubject') }),
      ],
      shown: 4,
      total: 12,
      members: [{ id: 'm', label: 'Đurđa Šoštarić', count: 4 }],
      teams: [{ id: 'a', label: 'Smjena Č', count: 4 }],
      begins: { source: 'marker', date: '16.11.2026', time: '10:00' },
      period: { from: '2026-11-01', to: '2026-11-30' },
      organizationName: 'JVP Čakovec–Međimurje',
      zone: 'Europe/Zagreb',
    },
    filters: { period: '2026-11', member: 'm', team: 'a', kind: 'team:changed' },
    generatedAt: new Date('2026-11-16T13:42:00Z'),
  });
}

/** Every string value under a resource subtree, with its key. */
function stringsOf(node: unknown, path: string): (readonly [string, string])[] {
  if (typeof node === 'string') return [[path, node]];
  if (!isRecord(node)) return [];

  return Object.entries(node).flatMap(([key, value]) => stringsOf(value, `${path}.${key}`));
}

/** The two `history.*` strings that hold `→`: the screen's, which the PDF never draws. */
const SCREEN_ONLY = new Set(['history.change', 'history.column.changes']);

beforeAll(async () => {
  await initLocalization();
});

describe('the font detector', () => {
  it('finds Croatian letters and digits in every face, and no arrow in any', () => {
    for (const face of Object.keys(FACES) as Face[]) {
      expect(FACES[face].size, face).toBeGreaterThan(500);
      expect(missingIn(face, 'ČĆĐŠŽčćđšž 0123456789 –…·'), face).toEqual([]);
      expect(missingIn(face, '→'), face).toEqual(['→']);
    }
  });

  it('reads every string a node draws, in its face', () => {
    expect(
      drawnIn({ stack: [{ text: 'a', bold: true }, { text: ['b', { text: 'c', italics: true }] }] }, false, false, []),
    ).toEqual([
      { text: 'a', face: 'bold' },
      { text: 'b', face: 'normal' },
      { text: 'c', face: 'italics' },
    ]);
  });
});

describe('the coverage the writer substitutes against', () => {
  it('is what every face draws: Croatian and the replacement character, no arrow, no emoji, no CJK', () => {
    const coverage = historyPdfCoverageOf(vfs);

    expect(coverage.size).toBeGreaterThan(500);
    for (const face of Object.keys(FACES) as Face[]) for (const point of coverage) expect(FACES[face].has(point)).toBe(true);
    for (const character of ['č', 'Đ', '–', '·', REPLACEMENT, '-', '>', '<', '=']) {
      expect(coverage.has(character.codePointAt(0) ?? 0), character).toBe(true);
    }
    for (const character of ['→', '⇒', '👍', '张', '✓']) expect(coverage.has(character.codePointAt(0) ?? 0), character).toBe(false);
  });
});

/** A face's widest glyph, in points at `size`: `hhea.advanceWidthMax` over `head.unitsPerEm`. */
function widestOf(font: Buffer, size: number): number {
  const tables = font.readUInt16BE(4);
  const offsetOf = (tag: string): number => {
    for (let index = 0; index < tables; index += 1) {
      const record = 12 + index * 16;

      if (font.toString('latin1', record, record + 4) === tag) return font.readUInt32BE(record + 8);
    }
    throw new Error(tag);
  };

  return (font.readUInt16BE(offsetOf('hhea') + 10) / font.readUInt16BE(offsetOf('head') + 18)) * size;
}

/** A table row's height in Roboto, read from the face's own `head` and `hhea`: pdfmake's line height. */
function lineHeightOf(font: Buffer, size: number): number {
  const tables = font.readUInt16BE(4);
  const offsetOf = (tag: string): number => {
    for (let index = 0; index < tables; index += 1) {
      const record = 12 + index * 16;

      if (font.toString('latin1', record, record + 4) === tag) return font.readUInt32BE(record + 8);
    }
    throw new Error(tag);
  };
  const unitsPerEm = font.readUInt16BE(offsetOf('head') + 18);
  const hhea = offsetOf('hhea');

  return ((font.readInt16BE(hhea + 4) - font.readInt16BE(hhea + 6) + font.readInt16BE(hhea + 8)) / unitsPerEm) * size;
}

function exportRow(changes: number, overrides: Partial<HistoryExportRow> = {}): HistoryExportRow {
  return {
    time: '16.11.2026 09:05',
    author: 'Ana Anić',
    kind: 'Smjena · promijenjeno',
    badge: null,
    subject: 'Smjena A',
    changes: Array.from({ length: changes }, (_, index) => ({ before: `Dan ${index}: A`, after: `Dan ${index}: B` })),
    none: null,
    ...overrides,
  };
}

describe('a row taller than a page', () => {
  it('is a chunk that fits an empty page under the repeated header, so dontBreakRows never drops it', () => {
    // Story 14.3's second review: under `dontBreakRows` pdfmake 0.3.13 left a
    // 90-change row out of the file. A chunk no taller than this always fits.
    const content = HISTORY_PDF_PAGE_HEIGHT - 40 - 40;
    // The header row: one line, 4 pt padding over and under, its rules; the chunk's own padding and rules.
    const header = HISTORY_PDF_LINE_HEIGHT + 8 + 2;

    expect(HISTORY_PDF_LINE_HEIGHT).toBeCloseTo(lineHeightOf(fontOf('normal'), 8), 6);
    expect(HISTORY_PDF_LINE_HEIGHT).toBeCloseTo(lineHeightOf(fontOf('bold'), 8), 6);
    expect(HISTORY_PDF_CHUNK_HEIGHT + 8 + 2 + header).toBeLessThan(content);
    // The estimate takes 1 em a character; Roboto's widest glyph is wider. A
    // chunk of nothing but the widest glyphs, in any face, still fits.
    for (const face of Object.keys(HISTORY_PDF_FACES) as Face[]) {
      const widest = widestOf(fontOf(face), 8);

      expect(widest, face).toBeGreaterThan(HISTORY_PDF_CHARACTER_WIDTH);
      expect(HISTORY_PDF_CHUNK_HEIGHT * (widest / HISTORY_PDF_CHARACTER_WIDTH) + 8 + 2 + header, face).toBeLessThan(content);
    }
    expect((historyDocumentOf(fixture()).content.at(-1) as { table: { dontBreakRows: boolean } }).table.dontBreakRows).toBe(true);
  });

  it('keeps the identifying cells of the longest names under the budget beside a full chunk', () => {
    // Names are at most 100 characters (`char_length(name) <= 100`); a subject can name a member and a team.
    const name = 'Đ'.repeat(100);
    const tallest = exportRow(1, {
      author: name,
      subject: `${name}, ${name}, 31.12.2026.–31.12.2027.`,
      kind: 'Zamjena smjene · izmijenjeno',
      badge: t('history.reconstructed'),
    });

    expect(historyIdentifyingHeightOf(tallest, t('history.export.continued'))).toBeLessThan(HISTORY_PDF_CHUNK_HEIGHT);
  });

  it('keeps the most a subject can name under the budget: every member and team column of a swap', () => {
    // `subjectsOfRows` (domain `history.ts`): member_id, member_out_id, member_in_id,
    // proposer_id, addressee_id and team_id, return_team_id, listed by `formatList`.
    const names = Array.from({ length: 6 }, (_, index) => `${String(index)}${'Đ'.repeat(99)}`);
    const tallest = exportRow(1, { author: 'Đ'.repeat(100), subject: formatList(names) });

    expect(historyIdentifyingHeightOf(tallest, t('history.export.continued'))).toBeLessThan(HISTORY_PDF_CHUNK_HEIGHT);
  });

  it('splits 90 changes into four rows, in order, nothing lost', () => {
    const row = exportRow(90);
    const chunks = historyChunksOf(row);

    expect(chunks.map((chunk) => chunk.length)).toEqual([29, 29, 29, 3]);
    expect(chunks.flat()).toEqual(row.changes);
    expect(historyChunksOf(exportRow(3))).toEqual([exportRow(3).changes]);
    expect(historyChunksOf(exportRow(0, { none: 'Bez promijenjenih polja' }))).toEqual([[]]);
  });

  it('splits one huge change at spaces into continuing pieces of both sides, nothing lost', () => {
    const note = Array.from({ length: 500 }, (_, index) => `riječ${index}`).join(' ');
    const json = `{"a":"${'x'.repeat(2000)}"}`;
    const chunks = historyChunksOf(exportRow(0, { changes: [{ before: `Napomena: ${note}`, after: `meta: ${json}\n\nkraj` }] }));
    const parts = chunks.flat();

    expect(chunks.length).toBeGreaterThan(3);
    expect(parts.map((part) => part.before).join('')).toBe(`Napomena: ${note}`);
    // A paragraph break that ends a piece is the piece boundary itself.
    expect(parts.map((part) => part.after).join('').replace(/\n/g, '')).toBe(`meta: ${json}kraj`);
    // Each piece of the note ends after a space, never inside a word.
    for (const part of parts.slice(0, -1)) if (part.before !== '') expect(part.before.endsWith(' ')).toBe(true);
  });

  it('repeats the time, author, kind and subject on each continuation, marked (nastavak)', () => {
    const model = { ...fixture(), rows: [exportRow(90, { badge: 'Rekonstruirano', subject: 'Ljiljana Kovačević' })] };
    const body = (historyDocumentOf(model).content.at(-1) as { table: { body: unknown[][] } }).table.body.slice(1);

    expect(body).toHaveLength(4);
    body.forEach((cells, index) => {
      const drawn = drawnIn(cells.slice(0, 4), false, false, []);

      expect(drawn.map((item) => item.text)).toEqual([
        '16.11.2026 09:05',
        ...(index === 0 ? [] : ['(nastavak)']),
        'Ana Anić',
        'Smjena · promijenjeno',
        'Rekonstruirano',
        'Ljiljana Kovačević',
      ]);
      if (index > 0) expect(drawn[1]).toEqual({ text: t('history.export.continued'), face: 'italics' });
    });
  });
});

describe('the document', () => {
  it('is landscape A4 in Roboto, with a repeated header row and Bilo/Sada spanning two columns', () => {
    const document = historyDocumentOf(fixture());
    const table = document.content.at(-1) as { table: { headerRows: number; widths: unknown[]; body: unknown[][] } };

    expect(document.pageOrientation).toBe('landscape');
    expect(document.pageSize).toBe('A4');
    expect(document.defaultStyle.font).toBe(HISTORY_PDF_FONT);
    expect(table.table.headerRows).toBe(1);
    expect(table.table.body).toHaveLength(1 + fixture().rows.length);
    for (const cells of table.table.body) expect(cells).toHaveLength(table.table.widths.length);
    // Each change row: the fifth cell spans *Bilo* and *Sada*; the sixth is its placeholder.
    expect(table.table.body.slice(1).map((cells) => (cells[4] as { colSpan?: number }).colSpan)).toEqual([2, 2, 2, 2, 2]);
  });

  it('sizes every column in points that fit the page, so one unbroken word cannot widen the table off it', () => {
    // Story 14.3 review: a `'*'` column grows to its longest unbroken word (a
    // long e-mail address, a link); on a rendered export one such word pushed
    // *Bilo* and *Sada* off the page for every row. Fixed widths make pdfmake
    // break the word inside its cell.
    const document = historyDocumentOf(fixture());
    const table = document.content.at(-1) as { table: { widths: unknown[]; body: unknown[][] } };
    const widths = table.table.widths;
    const [left = 0, , right = 0] = document.pageMargins;
    const content = 841.89 - left - right;

    for (const width of widths) expect(typeof width).toBe('number');
    // Each column's 4 pt padding either side, and seven 1 pt lines.
    const used = (widths as number[]).reduce((sum, width) => sum + width + 8, 0) + widths.length + 1;

    expect(used).toBeLessThanOrEqual(content);
    expect(used).toBeGreaterThan(content - 4);
    // A change's two sides fill exactly the two columns they span, the 8 pt between them included.
    const sides = (table.table.body[1]?.[4] as { table: { widths: unknown[] } }).table.widths as number[];
    const [, , , , before = 0, after = 0] = widths as number[];

    expect(sides.every((width) => typeof width === 'number')).toBe(true);
    expect(sides.reduce((sum, width) => sum + width, 0) + 8).toBe(before + 8 + 1 + after);
  });

  it('draws every character in the face it uses', () => {
    const model = fixture();
    const document = historyDocumentOf(model);
    const drawn = [
      ...drawnIn(document.content, false, false, []),
      ...[1, 2, 3].flatMap((page) => drawnIn(document.footer(page, 3), false, false, [])),
      { text: document.info.title, face: 'normal' as const },
    ];

    expect(drawn.length).toBeGreaterThan(40);
    // Every header line, row cell and badge is among them.
    for (const line of model.lines) expect(drawn.map((item) => item.text)).toContain(line);
    expect(drawn).toContainEqual({ text: t('history.reconstructed'), face: 'italics' });
    expect(drawn).toContainEqual({ text: t('history.markerBadge'), face: 'italics' });
    expect(drawn).toContainEqual({ text: t('history.export.before'), face: 'bold' });
    expect(drawn).toContainEqual({ text: 'Stranica 3 od 3', face: 'normal' });

    for (const { text, face } of drawn) expect(missingIn(face, text), `${face}: ${text}`).toEqual([]);
  });

  it('holds every history word the export can draw, and its status lines, in every face', () => {
    const words = stringsOf(resources.history, 'history').filter(([key]) => !SCREEN_ONLY.has(key));

    expect(words.length).toBeGreaterThan(100);
    for (const [key, value] of words) {
      for (const face of Object.keys(FACES) as Face[]) expect(missingIn(face, value), `${face}: ${key}`).toEqual([]);
    }
    // The two the export leaves out are left out for their arrow alone.
    for (const key of SCREEN_ONLY) {
      expect(missingIn('normal', stringsOf(resources.history, 'history').find(([path]) => path === key)?.[1] ?? '')).toEqual(['→']);
    }
  });
});

describe('the one writer module', () => {
  it('is the only source that imports pdfmake, and only by import()', () => {
    const src = fileURLToPath(new URL('../../..', import.meta.url));
    const sources = (readdirSync(src, { recursive: true }) as string[])
      .filter((path) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts') && !path.endsWith('.test.ts'))
      .map((path) => join(src, path));
    const importers = sources
      .filter((path) => /['"]pdfmake(\/[^'"]*)?['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(src, path).split('\\').join('/'));
    const writer = readFileSync(join(src, 'features', 'history', 'services', 'pdf.ts'), 'utf8');

    expect(sources.length).toBeGreaterThan(100);
    expect(importers).toEqual(['features/history/services/pdf.ts']);
    expect(writer).toMatch(/import\('pdfmake\/build\/pdfmake'\)/);
    expect(writer).toMatch(/import\('pdfmake\/build\/vfs_fonts'\)/);
    expect(writer).not.toMatch(/^import[^;]*from\s*'pdfmake/m);
  });
});
