import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Glyph coverage in the shipped face (story 1.1b, UX-DR40).
 *
 * The risk is the subset, not the face. `@fontsource-variable/geist` splits
 * into five subsets, and every Croatian diacritic sits in latin-ext — the latin
 * subset carries none of them. Importing a narrower entry point still compiles,
 * still renders, and falls back mid-word on exactly the strings that matter:
 * `Noć`, `Godišnji`, `Izmijenjeno`, and members' own names.
 *
 * UX-DR8's two state glyphs are measured but NOT required here — neither is in
 * any Geist subset, and the fix belongs to Epic 3's `shift-cell`. See the block
 * above `CROATIAN` and the deferred-work entry.
 *
 * Everything reads lazily: a module-scope `readFileSync` would throw during
 * collection and the guard assertions below would never report.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** č ć ž š đ and their capitals — the set DESIGN.md names as mandatory. */
const CROATIAN = [...'čćžšđČĆŽĐŠ'];

/**
 * UX-DR8's leave `◷` (U+25F7) and uncovered `◌` (U+25CC) marks are deliberately
 * NOT asserted here.
 *
 * Measured: neither is in any Geist subset, so both fall back to whatever face
 * the OS supplies. That is a real finding, recorded in deferred-work.md — but
 * UX-DR40 scopes this check to Latin Extended-A, nothing renders a glyph until
 * Epic 3's `shift-cell`, and the fix is a choice between lucide icons (already
 * installed, and what `components.json` declares) and Geist-covered
 * alternatives. Asserting it here would gate the token layer on a decision
 * belonging to a component that does not exist.
 */

function appCss(): string {
  return readFileSync(join(repoRoot, 'apps', 'web', 'src', 'index.css'), 'utf8');
}

/** The `@fontsource` specifier the application actually imports. Asserting
 *  coverage of a stylesheet nobody imports would pass while the app fell back. */
function importedSpecifier(): string | null {
  return /@import\s+['"](@fontsource[^'"]+)['"]/.exec(appCss())?.[1] ?? null;
}

/**
 * Resolved from `apps/web/node_modules`, not the workspace root: `.npmrc` pins
 * `node-linker=isolated`, so a dependency declared by `apps/web` is linked only
 * there. Reading from the root would throw on a correct install, and would
 * start passing if hoisting were ever switched on — the very thing the 1.1a
 * purity guard exists to prevent.
 */
function fontStylesheet(): string {
  const specifier = importedSpecifier();
  if (specifier === null) throw new Error('NO_FONTSOURCE_IMPORT');

  const scoped = specifier.startsWith('@');
  const bare = scoped ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const subpath = specifier.slice(bare?.length ?? 0).replace(/^\//, '');
  // A subpath may already name a file (`/wght.css`); appending unconditionally
  // would look for `wght.css.css`.
  const file = subpath === '' ? 'index.css' : subpath.endsWith('.css') ? subpath : `${subpath}.css`;

  return readFileSync(join(repoRoot, 'apps', 'web', 'node_modules', bare ?? '', file), 'utf8');
}

/** Every `unicode-range` in the imported stylesheet, flattened to the set of
 *  codepoints the face may render. CSS wildcards (`U+01??`) expand to bounds. */
function declaredRanges(): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];

  for (const declaration of fontStylesheet().matchAll(/unicode-range:\s*([^;]+);/g)) {
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

function covers(character: string): boolean {
  const codepoint = character.codePointAt(0) ?? 0;

  return declaredRanges().some((range) => codepoint >= range.start && codepoint <= range.end);
}

const label = (character: string): string =>
  `U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

describe('the application imports a Geist entry point', () => {
  it('imports a @fontsource stylesheet at all', () => {
    expect(importedSpecifier()).not.toBeNull();
  });

  it('resolves to a stylesheet that exists on disk', () => {
    expect(() => fontStylesheet()).not.toThrow();
  });

  // Guard against a vacuous pass: an unparsed stylesheet yields no ranges, and
  // every coverage assertion would then fail for the wrong reason.
  it('parses at least one unicode-range from it', () => {
    expect(declaredRanges().length).toBeGreaterThan(0);
  });

  it('ships the latin-ext subset file the diacritics need', () => {
    const specifier = importedSpecifier() ?? '';
    const bare = specifier.split('/').slice(0, 2).join('/');
    const root = join(repoRoot, 'apps', 'web', 'node_modules', bare);
    // Quotes and any ?query are stripped: upstream is free to change either,
    // and neither bears on whether the face ships.
    const referenced = [...fontStylesheet().matchAll(/url\(([^)]+)\)/g)]
      .map((match) => (match[1] ?? '').replace(/^['"]|['"]$/g, '').split('?')[0] ?? '')
      .map((path) => path.replace(/^\.\//, ''))
      .filter((path) => path.includes('latin-ext'));

    expect(referenced.length, 'no latin-ext face referenced').toBeGreaterThan(0);
    expect(
      referenced.filter((path) => !existsSync(join(root, path))),
      'a referenced latin-ext face is not on disk',
    ).toEqual([]);
  });
});

describe('the shipped face may render every Croatian diacritic', () => {
  it.each(CROATIAN)('declares a unicode-range covering %s', (character) => {
    expect(covers(character), `${character} (${label(character)}) is in no declared range`).toBe(true);
  });
});

describe('the state glyphs are known not to be covered', () => {
  // Locks the measurement that sent this to Epic 3. If a future Geist release
  // adds these codepoints, this test fails and the deferred entry can close.
  it.each(['◷', '◌'])('%s is still outside every Geist subset', (glyph) => {
    expect(
      covers(glyph),
      `${glyph} (${label(glyph)}) is now covered — the Epic 3 deferral can be revisited`,
    ).toBe(false);
  });
});

describe('the face is actually bound as the sans stack', () => {
  // A covered subset that nothing references still falls back to the system
  // font, so coverage alone is not the guarantee.
  it('binds Geist to --font-sans', () => {
    expect(appCss()).toMatch(/--font-sans:\s*'Geist Variable'/);
  });
});
