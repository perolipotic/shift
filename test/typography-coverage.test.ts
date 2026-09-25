import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Glyph coverage in the shipped faces (story 1.1b, UX-DR40; two faces since
 * visual refresh A).
 *
 * The risk is the subset, not the face. A `@fontsource-variable` package splits
 * into subsets, and every Croatian diacritic sits in latin-ext — the latin
 * subset carries none of them. Importing a narrower entry point still compiles,
 * still renders, and falls back mid-word on exactly the strings that matter:
 * `Noć`, `Godišnji`, `Izmijenjeno`, and members' own names.
 *
 * TWO FACES, ONE GATE. Visual refresh A replaced Geist with DM Sans for body
 * text and Syne for headings. The first version of this file read only the
 * FIRST `@fontsource` import, so a heading face with no latin-ext subset would
 * have shipped with every assertion here green — every `<h1>` a person reads
 * first falling back on `č`. Every assertion below now runs once per import.
 *
 * UX-DR8's two state glyphs are measured but NOT required here — neither is in
 * any subset of either face, and the fix belongs to Epic 3's `shift-cell`. See
 * the block above `CROATIAN` and the deferred-work entry.
 *
 * Everything reads lazily: a module-scope `readFileSync` would throw during
 * collection and the guard assertions below would never report.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** č ć ž š đ and their capitals — the set DESIGN.md names as mandatory. */
const CROATIAN = [...'čćžšđČĆŽĐŠ'];

/**
 * The faces the application is expected to import, in the order it imports
 * them: the body face first, because it is the one `--font-sans` names.
 * Hard-coded rather than derived, so dropping an import fails here instead of
 * silently shrinking the sweep.
 */
const FACES = [
  { specifier: '@fontsource-variable/dm-sans', family: 'DM Sans Variable', token: '--font-sans' },
  { specifier: '@fontsource-variable/syne', family: 'Syne Variable', token: '--font-heading' },
] as const;

/**
 * UX-DR8's leave `◷` (U+25F7) and uncovered `◌` (U+25CC) marks are deliberately
 * NOT asserted here.
 *
 * Measured: neither is in any subset of either face, so both fall back to
 * whatever face the OS supplies. That is a real finding, recorded in
 * deferred-work.md — but UX-DR40 scopes this check to Latin Extended-A, nothing
 * renders a glyph until Epic 3's `shift-cell`, and the fix is a choice between
 * lucide icons (already installed, and what `components.json` declares) and
 * covered alternatives. Asserting it here would gate the token layer on a
 * decision belonging to a component that does not exist.
 */

function appCss(): string {
  return readFileSync(join(repoRoot, 'apps', 'web', 'src', 'index.css'), 'utf8');
}

/** Every `@fontsource` specifier the application actually imports, in order.
 *  Asserting coverage of a stylesheet nobody imports would pass while the app
 *  fell back. */
function importedSpecifiers(): string[] {
  return [...appCss().matchAll(/@import\s+['"](@fontsource[^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

/** The package root a specifier resolves to, e.g. `@fontsource-variable/syne`. */
function packageOf(specifier: string): string {
  return specifier.split('/').slice(0, 2).join('/');
}

/**
 * Resolved from `apps/web/node_modules`, not the workspace root: `.npmrc` pins
 * `node-linker=isolated`, so a dependency declared by `apps/web` is linked only
 * there. Reading from the root would throw on a correct install, and would
 * start passing if hoisting were ever switched on — the very thing the 1.1a
 * purity guard exists to prevent.
 */
function fontStylesheet(specifier: string): string {
  const bare = packageOf(specifier);
  const subpath = specifier.slice(bare.length).replace(/^\//, '');
  // A subpath may already name a file (`/wght.css`); appending unconditionally
  // would look for `wght.css.css`.
  const file = subpath === '' ? 'index.css' : subpath.endsWith('.css') ? subpath : `${subpath}.css`;

  return readFileSync(join(repoRoot, 'apps', 'web', 'node_modules', bare, file), 'utf8');
}

/** Every `unicode-range` in one imported stylesheet, flattened to the set of
 *  codepoints the face may render. CSS wildcards (`U+01??`) expand to bounds. */
function declaredRanges(specifier: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];

  for (const declaration of fontStylesheet(specifier).matchAll(/unicode-range:\s*([^;]+);/g)) {
    for (const entry of (declaration[1] ?? '').split(',')) {
      const span = /U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/.exec(entry.trim());
      if (span === null) continue;

      const low = span[1] ?? '';
      if (low.includes('?')) {
        ranges.push({
          start: Number.parseInt(low.replaceAll('?', '0'), 16),
          end: Number.parseInt(low.replaceAll('?', 'F'), 16),
        });
        continue;
      }

      const start = Number.parseInt(low, 16);
      ranges.push({ start, end: span[2] === undefined ? start : Number.parseInt(span[2], 16) });
    }
  }

  return ranges;
}

function covers(specifier: string, character: string): boolean {
  const codepoint = character.codePointAt(0) ?? 0;

  return declaredRanges(specifier).some((range) => codepoint >= range.start && codepoint <= range.end);
}

const label = (character: string): string =>
  `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

describe('the application imports both faces', () => {
  it('imports exactly the expected @fontsource stylesheets, body face first', () => {
    expect(importedSpecifiers()).toEqual(FACES.map((face) => face.specifier));
  });
});

describe.each(FACES)('the $family entry point', ({ specifier }) => {
  it('resolves to a stylesheet that exists on disk', () => {
    expect(() => fontStylesheet(specifier)).not.toThrow();
  });

  // Guard against a vacuous pass: an unparsed stylesheet yields no ranges, and
  // every coverage assertion would then fail for the wrong reason.
  it('parses at least one unicode-range from it', () => {
    expect(declaredRanges(specifier).length).toBeGreaterThan(0);
  });

  it('ships the latin-ext subset file the diacritics need', () => {
    const root = join(repoRoot, 'apps', 'web', 'node_modules', packageOf(specifier));
    // Quotes and any ?query are stripped: upstream is free to change either,
    // and neither bears on whether the face ships.
    const referenced = [...fontStylesheet(specifier).matchAll(/url\(([^)]+)\)/g)]
      .map((match) => (match[1] ?? '').replace(/^['"]|['"]$/g, '').split('?')[0] ?? '')
      .map((path) => path.replace(/^\.\//, ''))
      .filter((path) => path.includes('latin-ext'));

    expect(referenced.length, 'no latin-ext face referenced').toBeGreaterThan(0);
    expect(
      referenced.filter((path) => !existsSync(join(root, path))),
      'a referenced latin-ext face is not on disk',
    ).toEqual([]);
  });

  it.each(CROATIAN)('declares a unicode-range covering %s', (character) => {
    expect(covers(specifier, character), `${character} (${label(character)}) is in no declared range`).toBe(true);
  });

  // Locks the measurement that sent this to Epic 3. If a future release of
  // either face adds these codepoints, this test fails and the deferred entry
  // can close.
  it.each(['◷', '◌'])('%s is still outside every subset', (glyph) => {
    expect(
      covers(specifier, glyph),
      `${glyph} (${label(glyph)}) is now covered — the Epic 3 deferral can be revisited`,
    ).toBe(false);
  });
});

describe('each face is actually bound to its stack', () => {
  // A covered subset that nothing references still falls back to the system
  // font, so coverage alone is not the guarantee.
  it.each(FACES)('binds $family to $token', ({ family, token }) => {
    expect(appCss()).toMatch(new RegExp(`${token}:\\s*'${family}'`));
  });

  it('paints every heading level in the heading face', () => {
    // ORDER-INDEPENDENT: every rule is read as a selector list and a body, and
    // one rule must name all six levels (in any order, among any other
    // selectors) with the heading family anywhere in its body. Comments are
    // stripped first so a commented-out rule cannot satisfy it.
    const rules = [...appCss().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const headingRule = rules.find(([, selectors = '', body = '']) => {
      const list = selectors.split(',').map((selector) => selector.trim());

      return (
        ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].every((level) => list.includes(level)) &&
        /(?:^|;)\s*font-family:\s*var\(--font-heading\)/.test(body.trim())
      );
    });

    expect(headingRule, 'no rule gives h1-h6 the heading face').not.toBeUndefined();
  });

  it('gives CardTitle the heading face in the primitive', () => {
    const card = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'components', 'ui', 'card.tsx'), 'utf8');
    const title = /const CardTitle[\s\S]*?CardTitle\.displayName/.exec(card)?.[0] ?? '';

    expect(title, 'no CardTitle in card.tsx').not.toBe('');
    expect(title).toMatch(/\bfont-heading\b/);
  });
});
