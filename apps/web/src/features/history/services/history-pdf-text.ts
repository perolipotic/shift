import type { HistoryExport, HistoryExportRow } from '@/features/history/services/history-export';
import { graphemesOf } from '@/lib/i18n/format';

/**
 * What the PDF can print of a user's text (epic 14 retro A9). The writer's
 * Roboto has no emoji, no CJK, no arrows: such a character printed as an
 * empty box, silently. Each string is now read grapheme by grapheme against
 * the code points the registered faces really map (`./font-coverage`), and a
 * character they lack is replaced before pdfmake sees it:
 *
 * - an arrow is TRANSLITERATED (`→` reads `->`), the words around it still
 *   reading as written;
 * - a compatibility form whose NFKC form the font has is drawn as that
 *   (a full-width `Ａ` as `A`, a ligature `ﬁ` as `fi`);
 * - a space the font lacks is a plain space, and an invisible format
 *   character (a zero-width joiner, a variation selector) is dropped — neither
 *   draws anything, so nothing is lost;
 * - anything else, an emoji or a CJK character, is one `U+FFFD` per grapheme
 *   (a family emoji is one, not four).
 *
 * When any VISIBLE character was replaced, the document says so once, under
 * its header (`history.export.glyphNote`). The screen keeps the original.
 */

/** Arrows written in free text, as the ASCII that reads the same. */
const TRANSLITERATIONS: Readonly<Record<string, string>> = {
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '⇒': '=>',
  '⇐': '<=',
  '⇔': '<=>',
  '⟶': '->',
  '⟵': '<-',
  '⟷': '<->',
  '⟹': '=>',
  '⟸': '<=',
  '➔': '->',
  '➜': '->',
  '➡': '->',
  '⬅': '<-',
};

/** What stands for a character the font cannot draw: the Unicode replacement character, which every Roboto face has (`pdf.test.ts`). */
export const REPLACEMENT = '�';

/**
 * A character that draws nothing: a format character (a zero-width joiner, a
 * tag) or a variation selector, the supplement's included. The prepended
 * concatenation marks are format characters that DO draw (the Arabic number
 * sign): they are replaced, never dropped.
 */
const INVISIBLE = /^[\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u;
const DRAWN_FORMAT = /^[\u0600-\u0605\u06DD\u070F\u0890\u0891\u08E2\u{110BD}\u{110CD}]$/u;

function invisible(character: string): boolean {
  return INVISIBLE.test(character) && !DRAWN_FORMAT.test(character);
}

/** Whether the font draws a code point. */
export type Covers = (point: number) => boolean;

function coveredAll(text: string, covers: Covers): boolean {
  for (const character of text) if (character !== '\n' && !covers(character.codePointAt(0) ?? 0)) return false;

  return true;
}

/** `text` as the font can draw it, and whether a visible character was replaced. */
export function drawableText(text: string, covers: Covers): { readonly text: string; readonly replaced: boolean } {
  // A CR LF, a lone CR and Unicode's line and paragraph separators are line breaks.
  const normalized = text.normalize('NFC').replace(/\r\n?|[\u2028\u2029]/g, '\n');

  if (coveredAll(normalized, covers)) return { text: normalized, replaced: false };

  let out = '';
  let replaced = false;

  for (const grapheme of graphemesOf(normalized)) {
    if (coveredAll(grapheme, covers)) {
      out += grapheme;
      continue;
    }

    // Invisible either way: a format character or a variation selector the font lacks.
    const segment = [...grapheme].filter((character) => covers(character.codePointAt(0) ?? 0) || !invisible(character)).join('');

    if (coveredAll(segment, covers)) {
      out += segment;
      continue;
    }

    const arrow = TRANSLITERATIONS[segment];
    const compatible = segment.normalize('NFKC');

    if (arrow !== undefined && coveredAll(arrow, covers)) {
      out += arrow;
      replaced = true;
    } else if (/^\s+$/u.test(segment)) {
      out += ' ';
    } else if (compatible !== segment && coveredAll(compatible, covers)) {
      out += compatible;
      replaced = true;
    } else if (covers(segment.codePointAt(0) ?? 0) && !/^\p{M}/u.test(segment)) {
      // A base the font draws (a letter, a digit, a sign), with a mark it lacks:
      // the base stays and each missing mark is replaced, in place.
      out += [...segment].map((character) => (covers(character.codePointAt(0) ?? 0) ? character : REPLACEMENT)).join('');
      replaced = true;
    } else {
      out += REPLACEMENT;
      replaced = true;
    }
  }

  return { text: out, replaced };
}

/**
 * `model` with every string the PDF draws made drawable, and the note line
 * added under the header when a visible character was replaced. The file's
 * name is not drawn, and the page footer is the build's own words.
 */
export function drawableExport(model: HistoryExport, covers: Covers): HistoryExport {
  let replaced = false;
  const draw = (text: string): string => {
    const drawn = drawableText(text, covers);

    replaced ||= drawn.replaced;

    return drawn.text;
  };
  const drawRow = (row: HistoryExportRow): HistoryExportRow => ({
    time: draw(row.time),
    author: draw(row.author),
    kind: draw(row.kind),
    badge: row.badge === null ? null : draw(row.badge),
    subject: draw(row.subject),
    changes: row.changes.map((change) => ({ before: draw(change.before), after: draw(change.after) })),
    none: row.none === null ? null : draw(row.none),
  });
  const title = draw(model.title);
  const lines = model.lines.map(draw);
  const columns = model.columns.map(draw);
  const rows = model.rows.map(drawRow);

  return {
    ...model,
    title,
    lines: replaced ? [...lines, model.glyphNote] : lines,
    columns,
    rows,
  };
}
