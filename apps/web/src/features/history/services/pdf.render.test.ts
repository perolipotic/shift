import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { historyExportOf, type HistoryExport } from '@/features/history/services/history-export';
import type { HistoryRow, HistoryRowChange } from '@/features/history/services/history-rows';
import {
  HISTORY_PDF_FACES,
  HISTORY_PDF_FONT,
  historyPdfCoverageOf,
  historyPdfDefinitionOf,
} from '@/features/history/services/pdf';
import { initLocalization } from '@/lib/i18n';

/**
 * Epic 14 retro A9: the document is LAID OUT AND RENDERED by the real
 * pdfmake 0.3.13 (its node build, with the same `vfs_fonts` faces the browser
 * writer registers), not only defined. Every string pdfmake draws passes
 * through its `PDFDocument.text`, recorded here, and each text node of the
 * table must be among them. A node's `positions` would not do: a row taller
 * than a page under `dontBreakRows` is positioned and then silently left out
 * of the file (seen: without the chunking, the 90-change entry was absent
 * from the rasterized PDF while every one of its nodes had a position).
 *
 * `HISTORY_PDF_OUT=<dir>` also writes the files, to rasterize and look at
 * (`pdftoppm -png`): the spec's Verification records what was seen.
 */

interface PdfMakeNode {
  readonly virtualfs: { writeFileSync(name: string, data: Buffer): void };
  setFonts(fonts: object): void;
  setUrlAccessPolicy(policy: (url: string) => boolean): void;
  setLocalAccessPolicy(policy: (path: string) => boolean): void;
  createPdf(definition: object): { getBuffer(): Promise<Buffer> };
}

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as PdfMakeNode;
const vfs = require('pdfmake/build/vfs_fonts.js') as Readonly<Record<string, string>>;
const coverage = historyPdfCoverageOf(vfs);

/** What pdfmake drew, in order: each string it hands to the PDF. */
let drawn: string[] = [];
// pdfmake's internal class, by path: pinned to 0.3.13 (`apps/web/package.json`); restored after the suite.
const PdfDocument = (require('pdfmake/js/PDFDocument') as { default: { prototype: { text: (...args: unknown[]) => unknown } } })
  .default;
const drawText = PdfDocument.prototype.text;

PdfDocument.prototype.text = function text(this: unknown, ...args: unknown[]) {
  drawn.push(String(args[0]));

  return drawText.apply(this, args);
};

/** Text without its spaces and line breaks: pdfmake draws a wrapped string as several pieces. */
function squeezed(text: string): string {
  return text.replace(/\s+/g, '');
}

const LONGEST_NAME = 'Đurđica-Magdalena Šoštarić-Krčelić Vukovarsko-Srijemska Županijska Vatrogasna Zajednica Čakovec!!'
  .padEnd(100, 'ž')
  .slice(0, 100);
const UNBROKEN = 'vrlo.dugacka.adresa.bez.razmaka@vatrogasna-zajednica-medimurske-zupanije-cakovec.example.hr';

function change(index: number, overrides: Partial<HistoryRowChange> = {}): HistoryRowChange {
  return { column: `c${index}`, field: `Polje ${index}`, before: `stara ${index}`, after: `nova ${index}`, ...overrides };
}

function row(id: number, overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: String(id),
    time: '16.11.2026 09:05',
    author: 'Ana Anić',
    kind: 'Smjena · promijenjeno',
    subject: 'Ćiril Žužić, Smjena Č',
    reconstructed: false,
    marker: false,
    changes: [change(1)],
    ...overrides,
  };
}

/**
 * Sixty entries: the longest names, an unbroken address, a 90-change entry
 * that starts low on a page, a 3000-character note, emoji, CJK and an arrow,
 * a reconstructed row and the start of history.
 */
function realisticRows(): HistoryRow[] {
  const rows: HistoryRow[] = [];

  for (let index = 0; index < 60; index += 1) {
    if (index === 3) {
      rows.push(row(index, { author: LONGEST_NAME, subject: `${LONGEST_NAME}, ${LONGEST_NAME}` }));
    } else if (index === 5) {
      rows.push(row(index, { changes: [change(1, { field: 'E-pošta', before: UNBROKEN, after: `${UNBROKEN}.novo` })] }));
    } else if (index === 22) {
      rows.push(
        row(index, {
          author: 'Đurđa Šoštarić',
          kind: 'Raspored · promijenjeno',
          subject: 'Ljiljana Kovačević, 1.–31.12.2026',
          changes: Array.from({ length: 90 }, (_, at) => change(at + 1, { field: `Dan ${at + 1}.12.` })),
        }),
      );
    } else if (index === 30) {
      rows.push(
        row(index, {
          kind: 'Odsutnost · izmijenjeno',
          changes: [
            change(1, {
              field: 'Napomena',
              before: null,
              after: Array.from({ length: 300 }, (_, at) => `riječ${at}`).join(' ').padEnd(3000, ' kraj'),
            }),
          ],
        }),
      );
    } else if (index === 31) {
      rows.push(
        row(index, {
          author: 'Zoë 👩‍👩‍👧 Anić',
          subject: '张伟 → Smjena B',
          changes: [
            change(1, { field: 'Napomena', before: 'Zamjena 👍 → 张伟', after: 'OK ✓ ★ ⇒ gotovo' }),
            change(2, { field: 'meta', before: '{"a":"→","b":[1,2]}', after: '{"a":"←"}' }),
          ],
        }),
      );
    } else {
      rows.push(row(index, { reconstructed: index === 40, changes: [change(1), change(2)].slice(0, 1 + (index % 2)) }));
    }
  }
  rows.push(row(60, { kind: 'Organizacija · početak', subject: 'Početak bilježenja povijesti', marker: true, changes: [] }));

  return rows;
}

function exportOf(rows: HistoryRow[]): HistoryExport {
  return historyExportOf({
    view: {
      rows,
      shown: rows.length - 1,
      total: rows.length - 1,
      members: [],
      teams: [],
      begins: null,
      period: { from: '2026-11-01', to: '2026-11-30' },
      organizationName: 'JVP Čakovec–Međimurje',
      zone: 'Europe/Zagreb',
    },
    filters: { period: '2026-11', member: null, team: null, kind: null },
    generatedAt: new Date('2026-11-17T09:00:00Z'),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every `{ text }` node under `node`. */
function textNodesOf(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const child of node) textNodesOf(child, out);
  } else if (isRecord(node)) {
    if (typeof node['text'] === 'string') out.push(node);
    for (const key of ['stack', 'table', 'body'] as const) if (key in node) textNodesOf(node[key], out);
  }

  return out;
}

/** Lays `model` out with pdfmake and answers the file, the table's text nodes (now positioned) and the page count. */
async function render(model: HistoryExport, name: string) {
  // The writer's own composition: substitution, then layout.
  const definition = historyPdfDefinitionOf(model, (point) => coverage.has(point));
  let pages = 0;
  const footer = definition.footer;
  const counted = {
    ...definition,
    footer: (page: number, total: number) => {
      pages = total;

      return footer(page, total);
    },
  };
  drawn = [];
  const file = await pdfmake.createPdf(counted).getBuffer();
  const ink = squeezed(drawn.join(''));
  const out = process.env['HISTORY_PDF_OUT'];

  if (out !== undefined && out !== '') {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${name}.pdf`), file);
  }

  const nodes = textNodesOf(definition.content.at(-1));
  // Each node's text, found in what was drawn, in the table's order.
  let from = 0;
  const missing = nodes.flatMap((node) => {
    const text = squeezed(node['text'] as string);

    if (text === '') return [];
    const at = ink.indexOf(text, from);

    if (at < 0) return [node['text'] as string];
    from = at + text.length;

    return [];
  });

  return { file, nodes, pages, definition, missing, ink: [...drawn] };
}

beforeAll(async () => {
  await initLocalization();
  for (const file of Object.values(HISTORY_PDF_FACES)) {
    pdfmake.virtualfs.writeFileSync(file, Buffer.from(vfs[file] ?? '', 'base64'));
  }
  pdfmake.setFonts({ [HISTORY_PDF_FONT]: HISTORY_PDF_FACES });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);
});

afterAll(() => {
  PdfDocument.prototype.text = drawText;
});

describe('the rendered PDF', () => {
  it('places every cell of a realistic export, the 90-change entry and the 3000-character note included', async () => {
    const model = exportOf(realisticRows());
    const { file, nodes, pages, missing } = await render(model, 'history-realistic');

    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pages).toBeGreaterThan(3);
    expect(nodes.length).toBeGreaterThan(300);
    expect(missing).toEqual([]);
    // Every change of the 90-change entry is drawn, once, in order.
    const days = nodes
      .map((node) => node['text'])
      .filter((text): text is string => typeof text === 'string' && /^Dan \d+\.12\.: stara/.test(text));

    expect(days).toEqual(Array.from({ length: 90 }, (_, at) => `Dan ${at + 1}.12.: stara ${at + 1}`));
    // Each of its continuations repeats the author and is marked.
    expect(nodes.filter((node) => node['text'] === '(nastavak)').length).toBeGreaterThanOrEqual(3);
  });

  it('draws only characters the faces have, and says once that some were replaced', async () => {
    const { nodes, definition, ink } = await render(exportOf(realisticRows()), 'history-glyphs');
    const header = definition.content.slice(0, -1).map((node) => (node as { text: string }).text);

    // Everything pdfmake drew — title, header lines, columns, cells, footers.
    expect(ink.length).toBeGreaterThan(nodes.length);
    for (const text of ink) {
      expect([...text].filter((character) => character !== '\n' && !coverage.has(character.codePointAt(0) ?? 0)), text).toEqual(
        [],
      );
    }
    expect(nodes.map((node) => node['text'])).toContain('Napomena: Zamjena � -> ��');
    expect(header.filter((line) => line.startsWith('Napomena: znakovi'))).toHaveLength(1);
  });

  it('keeps an entry that is not tall whole, and needs no note for Croatian text alone', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => row(index, { changes: [change(1), change(2), change(3)] }));
    const { nodes, pages, definition, missing } = await render(exportOf(rows), 'history-plain');
    const header = definition.content.slice(0, -1).map((node) => (node as { text: string }).text);

    expect(pages).toBeGreaterThan(1);
    expect(missing).toEqual([]);
    expect(nodes.filter((node) => node['text'] === '(nastavak)')).toEqual([]);
    expect(header.some((line) => line.startsWith('Napomena'))).toBe(false);
  });
});
