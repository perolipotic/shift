import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * UX-DR8's leave `◷` (U+25F7) and uncovered `◌` (U+25CC) marks are in no
 * subset of either face, so as text both would fall back to whatever face the
 * OS supplies. Story 5.3c resolved that by drawing them as lucide icons —
 * `Clock` and `CircleDashed` (human) — so neither character is rendered at
 * all. The block at the end pins that: no source the application ships holds
 * either character, so a regression to the uncovered text glyph fails here.
 */
const UNCOVERED_MARKS = ['◷', '◌'] as const;

/**
 * Shift Figures (story 7.2): DM Sans's own digits on one advance per weight,
 * derived by `scripts/fonts/build-figures.py` and declared inline in
 * `index.css` — not an `@fontsource` import, so `FACES` does not list it. It
 * leads both stacks and covers U+0030-0039 only.
 */
const FIGURES = 'Shift Figures';
const FIGURE_WEIGHTS = [400, 500, 600, 700, 800] as const;

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
});

describe('each face is actually bound to its stack', () => {
  // A covered subset that nothing references still falls back to the system
  // font, so coverage alone is not the guarantee.
  // Shift Figures leads both stacks (story 7.2); it covers digits only, so the
  // face named second is still the one every letter is drawn in.
  it.each(FACES)('binds $family to $token', ({ family, token }) => {
    expect(appCss()).toMatch(new RegExp(`${token}:\\s*'${FIGURES}',\\s*'${family}'`));
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

describe('every digit is a DM Sans tabular figure (story 7.2, UX-DR40)', () => {
  // DM Sans ships no `tnum`, so `tabular-nums` does nothing on its own. Shift
  // Figures (`scripts/fonts/build-figures.py`) is DM Sans's digits on one
  // advance per weight; these pin the rules that bind it and the slots that
  // must not route a number back through Syne.
  const sourceRoot = join(repoRoot, 'apps', 'web', 'src');

  /** Every `@font-face` body that names Shift Figures, comments stripped. */
  function figureRules(): string[] {
    return [...appCss().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{([^{}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .filter((body) => new RegExp(`font-family:\\s*'${FIGURES}'`).test(body));
  }

  it('declares one rule per weight in use, and no other', () => {
    const weights = figureRules().map((body) => Number(/font-weight:\s*(\d+)/.exec(body)?.[1]));

    expect(weights).toEqual([...FIGURE_WEIGHTS]);
  });

  it('limits every rule to exactly the ten digits', () => {
    for (const body of figureRules()) {
      expect(/unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim()).toBe('U+0030-0039');
    }
  });

  it('swaps rather than blocks while a figure file loads', () => {
    for (const body of figureRules()) expect(body).toMatch(/font-display:\s*swap/);
  });

  it('references only self-hosted woff2 files that exist', () => {
    const urls = figureRules().flatMap((body) =>
      [...body.matchAll(/url\(([^)]+)\)/g)].map((match) => (match[1] ?? '').replace(/^['"]|['"]$/g, '')),
    );

    expect(urls.map((url) => /shift-figures-(\d+)\.woff2$/.exec(url)?.[1])).toEqual(FIGURE_WEIGHTS.map(String));
    expect(urls.filter((url) => !url.startsWith('./')), 'a figure file is not a relative, bundled path').toEqual([]);
    expect(urls.filter((url) => !existsSync(join(sourceRoot, url))), 'a figure file is not on disk').toEqual([]);
  });

  it.each(FACES)('$token starts with Shift Figures, then $family', ({ family, token }) => {
    const stack = new RegExp(`${token}:\\s*([^;]+);`).exec(appCss())?.[1] ?? '';
    const names = stack.split(',').map((name) => name.trim());

    expect(names.slice(0, 2)).toEqual([`'${FIGURES}'`, `'${family}'`]);
  });

  // The four numeric slots that used to be Syne. Each is read as its own
  // definition, so `font-heading` elsewhere in the same file does not count.
  const NUMERIC_SLOTS = [
    { slot: 'StatValue', file: 'components/ui/stat-card.tsx', block: /const StatValue[\s\S]*?StatValue\.displayName/ },
    {
      slot: 'StatTileValue',
      file: 'components/ui/stat-tile.tsx',
      block: /const StatTileValue[\s\S]*?StatTileValue\.displayName/,
    },
    { slot: 'SectionNumber', file: 'components/ui/section-number.tsx', block: /function SectionNumber[\s\S]*?\n\}/ },
    {
      slot: 'the leave figure',
      file: 'features/leave/components/member-leave-card.tsx',
      block: /function renderFigure\([\s\S]*?\n {2}\}/,
    },
  ] as const;

  it.each(NUMERIC_SLOTS)('$slot is not set in the heading face', ({ file, block }) => {
    const definition = block.exec(readFileSync(join(sourceRoot, file), 'utf8'))?.[0] ?? '';

    expect(definition, `no definition found in ${file}`).not.toBe('');
    expect(definition).toMatch(/\btabular-nums\b/);
    expect(definition).not.toMatch(/\bfont-heading\b/);
  });

  it('was derived from the DM Sans file installed now', () => {
    // The script records the sha256 of the Fontsource file it derived the
    // figures from. A Fontsource bump without a regeneration would ship digits
    // that no longer match the DM Sans letters around them.
    const script = readFileSync(join(repoRoot, 'scripts', 'fonts', 'build-figures.py'), 'utf8');
    const expected = /^SOURCE_SHA256 = "([0-9a-f]{64})"$/m.exec(script)?.[1];
    const source = join(
      repoRoot,
      'apps',
      'web',
      'node_modules',
      '@fontsource-variable',
      'dm-sans',
      'files',
      'dm-sans-latin-wght-normal.woff2',
    );
    const actual = createHash('sha256').update(readFileSync(source)).digest('hex');

    expect(expected, 'no SOURCE_SHA256 in build-figures.py').toMatch(/^[0-9a-f]{64}$/);
    expect(
      actual,
      'the DM Sans source changed: update SOURCE_SHA256 and run `uv run scripts/fonts/build-figures.py`',
    ).toBe(expected);
  });

  /** Every quoted string in every .ts/.tsx under src — the class lists among them. */
  function quotedStrings(): { file: string; text: string }[] {
    return readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.tsx?$/.test(name))
      .flatMap((file) =>
        [...readFileSync(join(sourceRoot, file), 'utf8').matchAll(/["'`]([^"'`\n]*)["'`]/g)].map(([, text = '']) => ({
          file,
          text,
        })),
      );
  }

  it('uses no font weight that has no figure file', () => {
    // Shift Figures ships 400-800 only; a lighter or heavier weight would get
    // the nearest file's digits beside synthesized or mismatched letters.
    const offenders = quotedStrings()
      .filter(({ text }) => /(?:^|\s|:)font-(?:thin|extralight|light|black|\[\d+\])(?=\s|$)/.test(text))
      .map(({ file, text }) => `${file}: ${text}`);

    expect(offenders).toEqual([]);
  });

  it('uses no italic class, since there is no italic figure file', () => {
    const offenders = quotedStrings()
      .filter(({ text }) => /(?:^|\s|:)italic(?=\s|$)/.test(text))
      .map(({ file, text }) => `${file}: ${text}`);

    expect(offenders).toEqual([]);
  });

  it('no .tsx pairs font-heading with tabular-nums in one class list', () => {
    const offenders = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.tsx'))
      .filter((name) =>
        [...readFileSync(join(sourceRoot, name), 'utf8').matchAll(/["'`]([^"'`\n]*)["'`]/g)].some(
          ([, classes = '']) => /\bfont-heading\b/.test(classes) && /\btabular-nums\b/.test(classes),
        ),
      );

    expect(offenders).toEqual([]);
  });
});

describe('the calendar draws leave and uncovered as icons, never as uncovered text (story 5.3c)', () => {
  const sourceRoot = join(repoRoot, 'apps', 'web', 'src');
  const sources = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(tsx?|css|json)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(sourceRoot, name));

  it('sweeps the sources it means to', () => {
    expect(sources).toContain(join(sourceRoot, 'features', 'calendar', 'utils', 'modifiers.ts'));
  });

  it.each(UNCOVERED_MARKS)('no shipped source holds %s', (mark) => {
    expect(sources.filter((file) => readFileSync(file, 'utf8').includes(mark))).toEqual([]);
  });

  it.each(UNCOVERED_MARKS)('%s is still outside every subset, which is why it is an icon', (mark) => {
    for (const { specifier } of FACES) expect(covers(specifier, mark), `${label(mark)} in ${specifier}`).toBe(false);
  });

  it('draws them with lucide Clock and CircleDashed', () => {
    const vocabulary = readFileSync(join(sourceRoot, 'features', 'calendar', 'utils', 'modifiers.ts'), 'utf8');

    expect(vocabulary).toMatch(/import \{ CircleDashed, Clock, type LucideIcon \} from 'lucide-react';/);
    expect(vocabulary).toMatch(/glyph: \{ kind: GLYPH_ICON, icon: Clock \}/);
    expect(vocabulary).toMatch(/glyph: \{ kind: GLYPH_ICON, icon: CircleDashed \}/);
  });
});
