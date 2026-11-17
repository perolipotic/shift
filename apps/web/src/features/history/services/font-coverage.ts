/**
 * The code points a TrueType font can draw, read from its own `cmap` (epic 14
 * retro A9). *Povijest promjena*'s PDF is drawn in pdfmake's bundled Roboto,
 * which lacks emoji, CJK, most arrows and symbols: a missing glyph prints as
 * an empty box, silently. `./pdf` reads the faces it registers through this,
 * so what the export substitutes (`./history-pdf-text`) is decided by the
 * font's real coverage, never by a list kept beside it; `pdf.test.ts` proves
 * the build's own words against the same reading.
 *
 * Only the Unicode subtables are read (3,1 format 4; 3,10 and 0,x format 12),
 * with no dependency, on bytes — so the same code runs in the browser and in
 * the node suite.
 */

/** A face's Unicode subtables, decoded into the set of code points it maps to a real glyph. */
export function codePointsOf(font: Uint8Array): ReadonlySet<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = view.getUint16(4);
  let cmap = -1;

  for (let index = 0; index < tables; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(...font.subarray(record, record + 4));

    if (tag === 'cmap') cmap = view.getUint32(record + 8);
  }
  if (cmap < 0) throw new Error('no cmap table');

  const points = new Set<number>();
  const subtables = view.getUint16(cmap + 2);

  for (let index = 0; index < subtables; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const at = cmap + view.getUint32(record + 4);
    const format = view.getUint16(at);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));

    if (!unicode) continue;

    if (format === 4) {
      const segments = view.getUint16(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const offsets = deltas + segments * 2;

      for (let segment = 0; segment < segments; segment += 1) {
        const end = view.getUint16(ends + segment * 2);
        const start = view.getUint16(starts + segment * 2);
        const delta = view.getInt16(deltas + segment * 2);
        const offsetAt = offsets + segment * 2;
        const offset = view.getUint16(offsetAt);

        for (let point = start; point <= end && point !== 0xffff; point += 1) {
          const glyph = offset === 0 ? (point + delta) & 0xffff : view.getUint16(offsetAt + offset + (point - start) * 2);

          if (glyph !== 0) points.add(point);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(at + 12);

      for (let group = 0; group < groups; group += 1) {
        const groupAt = at + 16 + group * 12;
        const start = view.getUint32(groupAt);
        const end = view.getUint32(groupAt + 4);
        const glyph = view.getUint32(groupAt + 8);

        for (let point = start; point <= end; point += 1) if (glyph + (point - start) !== 0) points.add(point);
      }
    }
  }

  return points;
}

/** A base64 font file (pdfmake's `vfs_fonts` form) as bytes: `atob`, which the browser and node both have. */
export function bytesOfBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  return bytes;
}

/** The code points EVERY face in `faces` can draw: a string drawn in any of them never prints a box. */
export function sharedCoverageOf(faces: readonly Uint8Array[]): ReadonlySet<number> {
  const [first, ...rest] = faces.map(codePointsOf);
  const shared = new Set<number>();

  if (first === undefined) return shared;
  for (const point of first) if (rest.every((face) => face.has(point))) shared.add(point);

  return shared;
}
