import { createRequire } from 'node:module';

import { beforeAll, describe, expect, it } from 'vitest';

import { historyExportOf, type HistoryExport } from '@/features/history/services/history-export';
import { REPLACEMENT, drawableExport, drawableText, type Covers } from '@/features/history/services/history-pdf-text';
import { historyPdfCoverageOf } from '@/features/history/services/pdf';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Epic 14 retro A9: what the PDF prints of a user's text, decided against the
 * real coverage of the Roboto faces the writer registers.
 */

const vfs = createRequire(import.meta.url)('pdfmake/build/vfs_fonts.js') as Readonly<Record<string, string>>;
const coverage = historyPdfCoverageOf(vfs);
const covers: Covers = (point) => coverage.has(point);

beforeAll(async () => {
  await initLocalization();
});

describe('a string', () => {
  it('the font draws is left as it is, Croatian included, and nothing is said', () => {
    expect(drawableText('Đurđa Šoštarić – smjena Č (12,5 h) · ž', covers)).toEqual({
      text: 'Đurđa Šoštarić – smjena Č (12,5 h) · ž',
      replaced: false,
    });
    // A decomposed č is the same letter, composed.
    expect(drawableText('čakovec', covers)).toEqual({ text: 'čakovec', replaced: false });
    expect(drawableText('dva\nretka', covers)).toEqual({ text: 'dva\nretka', replaced: false });
  });

  it('reads an arrow as the ASCII that says the same', () => {
    expect(drawableText('A → B ← C ↔ D ⇒ E', covers)).toEqual({ text: 'A -> B <- C <-> D => E', replaced: true });
    // The heavy and emoji-styled arrows people type, and the long double ones.
    expect(drawableText('A ➡️ B ⬅ C ⟹ D', covers)).toEqual({ text: 'A -> B <- C => D', replaced: true });
  });

  it('replaces an emoji with one replacement character per grapheme, a family or a flag included', () => {
    expect(drawableText('OK 👍', covers)).toEqual({ text: `OK ${REPLACEMENT}`, replaced: true });
    expect(drawableText('👩‍👩‍👧 i 🇭🇷 i ❤️', covers)).toEqual({
      text: `${REPLACEMENT} i ${REPLACEMENT} i ${REPLACEMENT}`,
      replaced: true,
    });
  });

  it('replaces CJK and symbols the font lacks, and keeps raw JSON readable', () => {
    expect(drawableText('张伟 ✓ ★', covers)).toEqual({
      text: `${REPLACEMENT}${REPLACEMENT} ${REPLACEMENT} ${REPLACEMENT}`,
      replaced: true,
    });
    expect(drawableText('{"a":"→","b":[1,2]}', covers)).toEqual({ text: '{"a":"->","b":[1,2]}', replaced: true });
  });

  it('keeps a line break written as CR LF, CR or a Unicode separator', () => {
    expect(drawableText('a\r\nb\rc\u2028d\u2029e', covers)).toEqual({ text: 'a\nb\nc\nd\ne', replaced: false });
  });

  it('keeps a letter whose mark the font lacks, replacing only the mark', () => {
    expect(drawableText('a\u20DD', covers)).toEqual({ text: `a${REPLACEMENT}`, replaced: true });
  });

  it('keeps a digit or a sign whose mark the font lacks, and every missing mark in its place', () => {
    expect(covers('\u20DD'.codePointAt(0) ?? 0)).toBe(false);
    expect(covers('\u20E3'.codePointAt(0) ?? 0)).toBe(false);
    expect(drawableText('5\u20DD', covers)).toEqual({ text: `5${REPLACEMENT}`, replaced: true });
    expect(drawableText('#\u20E3', covers)).toEqual({ text: `#${REPLACEMENT}`, replaced: true });
    expect(drawableText('a\u20DD\u20E3', covers)).toEqual({ text: `a${REPLACEMENT}${REPLACEMENT}`, replaced: true });
  });

  it('drops a supplementary variation selector, but replaces a format character that draws', () => {
    expect(drawableText('a\u{E0100}b', covers)).toEqual({ text: 'ab', replaced: false });
    // The Arabic number sign is a format character with a glyph: dropping it would hide it.
    expect(covers(0x0600)).toBe(false);
    expect(drawableText('\u0600', covers)).toEqual({ text: REPLACEMENT, replaced: true });
  });

  it('draws a compatibility form as its plain letters', () => {
    expect(drawableText('ＡＢＣ', covers)).toEqual({ text: 'ABC', replaced: true });
  });

  it('turns a space the font lacks into a space and drops an invisible character, saying nothing', () => {
    expect(drawableText('a\tb', covers)).toEqual({ text: 'a b', replaced: false });
    expect(drawableText('a‍b⁠c', covers)).toEqual({ text: 'abc', replaced: false });
  });

  it('only ever answers characters the font draws', () => {
    const wild = 'Zoë 👩‍👩‍👧 张伟 → ✓ \t ＡＢ 🇭🇷 ❤️ ‍ Ω Д ﬁ';
    const { text } = drawableText(wild, covers);

    expect([...text].filter((character) => character !== '\n' && !covers(character.codePointAt(0) ?? 0))).toEqual([]);
  });
});

function model(author: string): HistoryExport {
  return historyExportOf({
    view: {
      rows: [
        {
          id: '1',
          time: '16.11.2026 09:05',
          author,
          kind: 'Smjena · promijenjeno',
          subject: 'Smjena A',
          reconstructed: false,
          marker: false,
          changes: [{ column: 'note', field: 'Napomena', before: 'staro', after: 'Zamjena 👍 → 张伟' }],
        },
      ],
      shown: 1,
      total: 1,
      members: [],
      teams: [],
      begins: null,
      period: { from: '2026-11-01', to: '2026-11-30' },
      organizationName: 'JVP 🚒 Grad',
      zone: 'Europe/Zagreb',
    },
    filters: { period: '2026-11', member: null, team: null, kind: null },
    generatedAt: new Date('2026-11-16T13:42:00Z'),
  });
}

describe('the document', () => {
  it('is drawn with every string substituted, and says so once, last under the header', () => {
    const source = model('Ana 🙂');
    const drawn = drawableExport(source, covers);

    expect(drawn.rows[0]?.author).toBe(`Ana ${REPLACEMENT}`);
    expect(drawn.rows[0]?.changes).toEqual([
      { before: 'Napomena: staro', after: `Napomena: Zamjena ${REPLACEMENT} -> ${REPLACEMENT}${REPLACEMENT}` },
    ]);
    expect(drawn.lines[0]).toBe(`Organizacija: JVP ${REPLACEMENT} Grad`);
    expect(drawn.lines).toEqual([...source.lines.map((line) => drawableText(line, covers).text), t('history.export.glyphNote')]);
    expect(drawn.lines.filter((line) => line === t('history.export.glyphNote'))).toHaveLength(1);
    // The file keeps its name; the screen's rows are not touched.
    expect(drawn.fileName).toBe(source.fileName);
    expect(source.rows[0]?.author).toBe('Ana 🙂');
  });

  it('adds no note when nothing visible was replaced', () => {
    const source = historyExportOf({
      view: {
        rows: [],
        shown: 0,
        total: 0,
        members: [],
        teams: [],
        begins: null,
        period: { from: '2026-11-01', to: '2026-11-30' },
        organizationName: 'JVP Čakovec',
        zone: 'Europe/Zagreb',
      },
      filters: { period: '2026-11', member: null, team: null, kind: null },
      generatedAt: new Date('2026-11-16T13:42:00Z'),
    });

    expect(drawableExport(source, covers).lines).toEqual(source.lines);
  });

  it('words its note in characters the font draws', () => {
    expect(drawableText(t('history.export.glyphNote'), covers).replaced).toBe(false);
    expect(t('history.export.glyphNote')).toContain(REPLACEMENT);
  });
});
