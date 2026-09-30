import { strFromU8, unzipSync } from 'fflate';

import { fill, hr } from './i18n.ts';

/**
 * A reader for the one `.xlsx` the suite downloads (story 4.3): the hours
 * export. Just enough of SpreadsheetML to read back what the writer wrote —
 * the first sheet's name, and each cell's type, value and number format
 * (a boolean or an error cell is refused: the export writes neither) — so
 * the test compares the FILE with the table, not the writer's input with
 * itself. No xlsx library: fflate unzips, and the XML is read by pattern,
 * which is sound for the flat, generated markup a writer emits.
 */

export type XlsxCell =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'number'; readonly value: number; readonly format: string | null };

export interface XlsxSheet {
  readonly name: string;
  /** Row by row, cell by cell, in column order; a missing cell is `null`. */
  readonly rows: readonly (readonly (XlsxCell | null)[])[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decoded(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));

    return ENTITIES[name] ?? whole;
  });
}

function attribute(attributes: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;
}

/** The text of every `<t>` inside `xml`, joined: a rich string's runs read as one. */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((found) => decoded(found[1] ?? '')).join('');
}

/** `B` → 1: a cell reference's column, zero-based. */
function columnOf(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? '';

  return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function file(files: Record<string, Uint8Array>, path: string): string {
  const found = files[path];

  if (found === undefined) throw new Error(`E2E: the workbook has no ${path}`);

  return strFromU8(found);
}

/** The number format of each cell style, by its index in `cellXfs`. */
function formatsOf(styles: string | null): readonly (string | null)[] {
  if (styles === null) return [];

  const custom = new Map(
    [...styles.matchAll(/<numFmt\b([^>]*)\/?>/g)].map((found) => [
      attribute(found[1] ?? '', 'numFmtId'),
      decoded(attribute(found[1] ?? '', 'formatCode') ?? ''),
    ]),
  );
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';

  return [...xfs.matchAll(/<xf\b([^>]*)>/g)].map((found) => {
    const id = attribute(found[1] ?? '', 'numFmtId');

    return id === null || id === '0' ? null : (custom.get(id) ?? `builtin:${id}`);
  });
}

/** The first sheet of the workbook `bytes` holds. */
export function readXlsx(bytes: Uint8Array): XlsxSheet {
  const files = unzipSync(bytes);
  const workbook = file(files, 'xl/workbook.xml');
  const name = decoded(attribute(/<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? '', 'name') ?? '');
  const shared =
    files['xl/sharedStrings.xml'] === undefined
      ? []
      : // An `<si>` may carry attributes, or be empty and self-closing.
        [...file(files, 'xl/sharedStrings.xml').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((found) =>
          textOf(found[1] ?? ''),
        );
  const formats = formatsOf(files['xl/styles.xml'] === undefined ? null : file(files, 'xl/styles.xml'));
  const sheet = file(files, 'xl/worksheets/sheet1.xml');
  // A row with no cells may be self-closing.
  const rows = [...sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)].map((row) => {
    const cells: (XlsxCell | null)[] = [];

    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1] ?? '';
      const body = cell[2] ?? '';
      const type = attribute(attributes, 't');
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null;
      const reference = attribute(attributes, 'r');
      // A cell without a reference is the next one along.
      const index = reference === null ? cells.length : columnOf(reference);
      const style = Number(attribute(attributes, 's') ?? '0');

      if (type === 'b' || type === 'e') throw new Error(`E2E: an unexpected ${type} cell at ${reference ?? String(index)}`);
      while (cells.length < index) cells.push(null);
      if (type === 's') cells[index] = { type: 'text', value: shared[Number(value)] ?? '' };
      else if (type === 'inlineStr' || type === 'str') cells[index] = { type: 'text', value: type === 'str' ? decoded(value ?? '') : textOf(body) };
      else if (value === null) cells[index] = null;
      else cells[index] = { type: 'number', value: Number(value), format: formats[style] ?? null };
    }

    return cells;
  });

  return { name, rows };
}

/** The longest the organization's part of an export's file name may be. */
const FILE_NAME_ORGANIZATION_MAX = 100;

/**
 * The file name the hours export gives `month` (`YYYY-MM`) of `organization`.
 *
 * A REPLICA, ON PURPOSE, of `fileNameSafeOf` and `hoursExportOf` in
 * `apps/web/src/features/hours/services/hours-export.ts`: the E2E suite
 * imports nothing from the app's source, so the rule is written again here
 * whole and the download is held to it. Change both together. The
 * organization's unsafe characters (`\ / : * ? " < > |`) and control
 * characters (U+0000–U+001F) removed, its spacing closed up, trailing dots
 * and spaces dropped, at most 100 characters; a name with nothing left is
 * omitted with its gap. The month is lowercase, as `formatIsoMonthName` says it.
 */
export function hoursExportFileName(organization: string, month: string): string {
  const trailing = /[. ]+$/;
  const visible = [...organization.replace(/[\\/:*?"<>|]/g, '')]
    .filter((character) => character.charCodeAt(0) > 0x1f)
    .join('');
  const spaced = visible.replace(/\s+/g, ' ').trim().replace(trailing, '');
  const safe = [...spaced].slice(0, FILE_NAME_ORGANIZATION_MAX).join('').trim().replace(trailing, '');
  const monthName = new Intl.DateTimeFormat('hr', { month: 'long', timeZone: 'UTC' })
    .format(new Date(`${month}-15T12:00:00Z`))
    .toLocaleLowerCase('hr');
  const name = fill(hr.sati.organization.export.fileName, { organization: safe, month: monthName, year: month.slice(0, 4) });

  return `${name.replace(/ {2,}/g, ' ').trim()}.xlsx`;
}
