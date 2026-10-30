import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { stripCssComments } from './source-scan.ts';
import { coverage, difference, filled, fillRatio } from './svg-raster.ts';

/**
 * Glyph coverage in the shipped faces (story 1.1b, UX-DR40; two faces since
 * visual refresh A, ONE since story 15.1: Outfit, D1).
 *
 * The risk is the subset, not the face. A `@fontsource-variable` package splits
 * into subsets, and every Croatian diacritic sits in latin-ext — the latin
 * subset carries none of them. Importing a narrower entry point still compiles,
 * still renders, and falls back mid-word on exactly the strings that matter:
 * `Noć`, `Godišnji`, `Izmijenjeno`, and members' own names.
 *
 * EVERY FACE, ONE GATE. Visual refresh A replaced Geist with DM Sans for body
 * text and Syne for headings, and the first version of this file read only the
 * FIRST `@fontsource` import, so a heading face with no latin-ext subset would
 * have shipped with every assertion here green. Every assertion below runs once
 * per import — since story 15.1 that is Outfit alone, which both stacks name,
 * and a second face added later joins `FACES` and every sweep with it.
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
const FACES = [{ specifier: '@fontsource-variable/outfit', family: 'Outfit Variable' }] as const;

/** Both stacks, and the face each leads with: Outfit for words and digits alike. */
const STACKS = [
  { token: '--font-sans', family: 'Outfit Variable' },
  { token: '--font-heading', family: 'Outfit Variable' },
] as const;

/**
 * UX-DR8's leave `◷` (U+25F7) and uncovered `◌` (U+25CC) marks are in no
 * subset of the face, so as text both would fall back to whatever face the
 * OS supplies. Story 5.3c resolved that by drawing them as icons — `Clock`
 * and `CircleDashed` (human), Phosphor `fill` through `@/components/ui/icon`
 * since story 15.1 — so neither character is rendered at all. The block at
 * the end pins that: no source the application ships holds either character,
 * so a regression to the uncovered text glyph fails here.
 */
const UNCOVERED_MARKS = ['◷', '◌'] as const;

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

describe('the application imports its one face', () => {
  it('imports exactly the expected @fontsource stylesheets', () => {
    expect(importedSpecifiers()).toEqual(FACES.map((face) => face.specifier));
  });

  it('ships none of the faces Outfit replaced (story 15.1, D1)', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(dependencies).toContain('@fontsource-variable/outfit');
    for (const retired of ['@fontsource-variable/dm-sans', '@fontsource-variable/syne']) {
      expect(dependencies, `${retired} is still a dependency`).not.toContain(retired);
    }
    expect(stripCssComments(appCss())).not.toMatch(/@font-face|Shift Figures|DM Sans|Syne/);
    expect(existsSync(join(repoRoot, 'scripts', 'fonts', 'build-figures.py')), 'the figure build script is back').toBe(false);
    expect(existsSync(join(repoRoot, 'apps', 'web', 'src', 'assets', 'fonts')), 'the figure files are back').toBe(false);
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
  // font, so coverage alone is not the guarantee. Story 15.1: Outfit LEADS
  // both stacks, words and digits alike; no figure face sits in front of it.
  it.each(STACKS)('binds $family to $token, first', ({ family, token }) => {
    const stack = new RegExp(`${token}:\\s*([^;]+);`).exec(stripCssComments(appCss()))?.[1] ?? '';

    expect(stack.split(',').map((name) => name.trim())[0]).toBe(`'${family}'`);
  });

  it('paints every heading level in the heading face', () => {
    // ORDER-INDEPENDENT: every rule is read as a selector list and a body, and
    // one rule must name all six levels (in any order, among any other
    // selectors) with the heading family anywhere in its body. Comments are
    // stripped first so a commented-out rule cannot satisfy it.
    const rules = [...stripCssComments(appCss()).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
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

describe('every digit is an Outfit tabular figure (story 15.1, D1, UX-DR40)', () => {
  // Outfit has a real `tnum` feature: under it all ten digits share one
  // advance (590 units) at every weight in use, so ONE
  // `font-variant-numeric: tabular-nums` on the document makes every digit
  // tabular by construction, and a column that mixes weights still aligns.
  // The e2e `layout/numerals.spec.ts` measures the advances in a browser;
  // these pin the rule, the feature and the slots that must not route a
  // number into the heading slot.
  const sourceRoot = join(repoRoot, 'apps', 'web', 'src');

  it('sets tabular-nums once, on html, in @layer base', () => {
    const css = stripCssComments(appCss());
    const layer = css.slice(css.indexOf('@layer base'));
    const html = /\bhtml\s*\{([\s\S]*?)\n {2}\}/.exec(layer)?.[1] ?? '';

    expect(html).toMatch(/font-variant-numeric:\s*tabular-nums;/);
    expect(css.match(/font-variant-numeric:\s*tabular-nums/g), 'tabular-nums is set in more than one rule').toHaveLength(1);
  });

  /**
   * The OpenType feature tags in a WOFF2 file's GSUB table.
   *
   * WOFF2 stores its tables as ONE Brotli stream after a table directory; GSUB
   * is never transformed, so it is a plain slice of that stream. Read here
   * rather than trusted, because the whole of D1 rests on Outfit having a real
   * `tnum`: DM Sans looked tabular by its class names and was not.
   */
  function gsubFeatures(file: string): string[] {
    const bytes = readFileSync(file);
    let at = 48;
    const readBase128 = (): number => {
      let value = 0;
      for (let index = 0; index < 5; index += 1) {
        const byte = bytes[at] ?? 0;
        at += 1;
        value = value * 128 + (byte & 0x7f);
        if ((byte & 0x80) === 0) return value;
      }
      throw new Error('WOFF2_BASE128');
    };

    expect(bytes.toString('latin1', 0, 4), 'not a WOFF2 file').toBe('wOF2');
    const tableCount = bytes.readUInt16BE(12);
    const compressedSize = bytes.readUInt32BE(20);
    // The WOFF2 known-tag table, up to GSUB (index 28).
    const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB'];
    const tables: { tag: string; length: number }[] = [];

    for (let index = 0; index < tableCount; index += 1) {
      const flags = bytes[at] ?? 0;
      at += 1;
      let tag = KNOWN[flags & 0x3f] ?? '';
      if ((flags & 0x3f) === 0x3f) {
        tag = bytes.toString('latin1', at, at + 4);
        at += 4;
      }
      const original = readBase128();
      const version = (flags >> 6) & 3;
      const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
      tables.push({ tag, length: transformed ? readBase128() : original });
    }

    const stream = brotliDecompressSync(bytes.subarray(at, at + compressedSize));
    let offset = 0;
    for (const table of tables) {
      if (table.tag === 'GSUB') {
        const gsub = stream.subarray(offset, offset + table.length);
        const features = gsub.readUInt16BE(6);
        const count = gsub.readUInt16BE(features);

        return Array.from({ length: count }, (_, index) =>
          gsub.toString('latin1', features + 2 + index * 6, features + 6 + index * 6),
        );
      }
      offset += table.length;
    }

    return [];
  }

  it('ships a real tnum feature in the subset that holds the digits', () => {
    const files = join(repoRoot, 'apps', 'web', 'node_modules', '@fontsource-variable', 'outfit', 'files');
    const features = gsubFeatures(join(files, 'outfit-latin-wght-normal.woff2'));

    // Non-vacuity: a misread table yields no tags at all.
    expect(features.length, 'no GSUB features read from the Outfit file').toBeGreaterThan(0);
    expect(features).toContain('tnum');
  });

  // The numeric slots that used to be Syne. Each is read as its own
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

  it.each(NUMERIC_SLOTS)('$slot is not set in the heading slot', ({ file, block }) => {
    const definition = block.exec(readFileSync(join(sourceRoot, file), 'utf8'))?.[0] ?? '';

    expect(definition, `no definition found in ${file}`).not.toBe('');
    expect(definition).toMatch(/\btabular-nums\b/);
    expect(definition).not.toMatch(/\bfont-heading\b/);
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

  it('uses no font weight outside the 400-700 direction G draws', () => {
    // `font-extrabold` is mapped to 700 in `@theme inline`; a lighter or a
    // heavier class would ask Outfit's variable axis for a weight the design
    // does not use.
    const offenders = quotedStrings()
      .filter(({ text }) => /(?:^|\s|:)font-(?:thin|extralight|light|black|\[\d+\])(?=\s|$)/.test(text))
      .map(({ file, text }) => `${file}: ${text}`);

    expect(offenders).toEqual([]);
    expect(stripCssComments(appCss())).toMatch(/--font-weight-extrabold:\s*700;/);
  });

  it('uses no italic class, since Outfit ships no italic', () => {
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

  it('draws them with the facade\'s bold Clock and CircleDashed (story 15.1)', () => {
    const vocabulary = readFileSync(join(sourceRoot, 'features', 'calendar', 'utils', 'modifiers.ts'), 'utf8');

    expect(vocabulary).toMatch(/import \{ CircleDashedBold, ClockBold, type IconComponent \} from '@\/components\/ui\/icon';/);
    expect(vocabulary).toMatch(/glyph: \{ kind: GLYPH_ICON, icon: ClockBold \}/);
    expect(vocabulary).toMatch(/glyph: \{ kind: GLYPH_ICON, icon: CircleDashedBold \}/);
  });

});

/**
 * THE STATUS MARKS DIFFER BY WHAT IS DRAWN, at the size they are drawn (story
 * 15.1, review loop 1, human decision 2026-10-30).
 *
 * Phosphor's `fill` clock and dashed circle are both solid discs whose
 * knockouts are 16/256 units — under a pixel at 12 px — so the leave and the
 * uncovered mark drew as the same dot while a test on their SOURCE TEXT
 * passed. These rasterize the very files the facade imports
 * (`./svg-raster.ts`, the nonzero rule on a 4×4-supersampled grid) at the
 * cell's 12 px and at 24 px (12 px at device pixel ratio 2), threshold each
 * pixel at half coverage, and compare the masks. Each case is also run
 * against the `fill` files, which must FAIL it, so the thresholds are not
 * vacuous.
 */
describe('the small status marks are told apart by drawn shape (story 15.1)', () => {
  const core = join(repoRoot, 'apps', 'web', 'node_modules', '@phosphor-icons', 'core', 'assets');
  const facade = (): string => readFileSync(join(repoRoot, 'apps', 'web', 'src', 'components', 'ui', 'icon.tsx'), 'utf8');
  const pathsIn = (file: string): string[] =>
    [...readFileSync(join(core, file), 'utf8').matchAll(/<path d="([^"]+)"\/>/g)].map((match) => match[1] ?? '');
  const mask = (file: string, size: number): boolean[] => filled(coverage(pathsIn(file), size));
  /** A solid disc of the marks' own 108-unit radius: what "a dot" is. */
  const disc = (size: number): boolean[] =>
    filled(coverage(['M128,20A108,108,0,1,0,236,128,108,108,0,0,0,128,20Z'], size));
  const SIZES = [12, 24] as const;
  /** At least this share of the inked pixels differs between two marks. */
  const DISTINCT = 0.3;
  /** A mark fills at most this share of what a solid disc fills. */
  const NOT_A_DOT = 0.7; // record-bold (a ring around a dot) is 0.60–0.62; the fill clock 0.84–0.94

  it('imports the bold files for the leave mark, the uncovered mark and the three duty legs', () => {
    for (const [name, file] of [
      ['clockBold', 'clock-bold'],
      ['circleDashedBold', 'circle-dashed-bold'],
      ['checkCircleBold', 'check-circle-bold'],
      ['recordBold', 'record-bold'],
    ] as const) {
      expect(facade()).toContain(`import ${name} from "@phosphor-icons/core/bold/${file}.svg?raw"`);
    }
    const legs = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'features', 'today', 'components', 'duty-block.tsx'), 'utf8');

    expect(legs).toMatch(/done: CheckCircleBold,\s*running: RecordBold,\s*upcoming: CircleDashedBold,/);
  });

  it.each(SIZES)('the leave and uncovered marks differ by shape at %i px', (size) => {
    const leave = mask('bold/clock-bold.svg', size);
    const uncovered = mask('bold/circle-dashed-bold.svg', size);

    expect(difference(leave, uncovered), `leave and uncovered differ in too few pixels at ${String(size)} px`).toBeGreaterThanOrEqual(
      DISTINCT,
    );
    // The fill marks this replaced: too alike, which is the defect.
    expect(difference(mask('fill/clock-fill.svg', size), mask('fill/circle-dashed-fill.svg', size))).toBeLessThan(DISTINCT);
  });

  it.each(SIZES)('no status mark is a near-solid disc at %i px', (size) => {
    const dot = fillRatio(disc(size));

    for (const file of ['bold/clock-bold.svg', 'bold/circle-dashed-bold.svg', 'bold/check-circle-bold.svg', 'bold/record-bold.svg']) {
      expect(fillRatio(mask(file, size)) / dot, `${file} draws as a dot at ${String(size)} px`).toBeLessThan(NOT_A_DOT);
    }
    expect(fillRatio(mask('fill/clock-fill.svg', size)) / dot, 'the fill clock no longer measures as a dot').toBeGreaterThan(
      NOT_A_DOT,
    );
  });

  it.each(SIZES)('the duty block\'s done, running and upcoming legs differ by shape at %i px', (size) => {
    const legs = {
      done: mask('bold/check-circle-bold.svg', size),
      running: mask('bold/record-bold.svg', size),
      upcoming: mask('bold/circle-dashed-bold.svg', size),
    };

    for (const [one, other] of [
      ['done', 'running'],
      ['done', 'upcoming'],
      ['running', 'upcoming'],
    ] as const) {
      expect(difference(legs[one], legs[other]), `${one} and ${other} are too alike at ${String(size)} px`).toBeGreaterThanOrEqual(
        DISTINCT,
      );
    }
  });
});

describe('every icon comes from the one facade, in Phosphor fill or, for status marks, bold (story 15.1, D2)', () => {
  const sourceRoot = join(repoRoot, 'apps', 'web', 'src');
  const FACADE = join(sourceRoot, 'components', 'ui', 'icon.tsx');
  const sources = readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(tsx?|css)$/.test(name))
    .map((name) => join(sourceRoot, name));

  it('sweeps the sources it means to', () => {
    expect(sources).toContain(FACADE);
    expect(sources.length).toBeGreaterThan(100);
  });

  it('imports no icon library anywhere but the facade', () => {
    const offenders = sources
      .filter((file) => file !== FACADE)
      .filter((file) => /from\s+['"](?:lucide-react|@phosphor-icons\/[^'"]+)['"]/.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('draws only Phosphor fill files, and bold for the four status marks, and depends on no other icon package', () => {
    const facade = readFileSync(FACADE, 'utf8');
    const imports = [...facade.matchAll(/from\s+"(@phosphor-icons\/[^"]+)"/g)].map((match) => match[1] ?? '');
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'apps', 'web', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(imports.length, 'the facade imports no icon at all').toBeGreaterThan(40);
    expect(imports.filter((specifier) => !/^@phosphor-icons\/core\/(fill|bold)\/[a-z-]+-\1\.svg\?raw$/.test(specifier))).toEqual([]);
    expect(imports.filter((specifier) => specifier.includes('/bold/')).sort()).toEqual(
      ['check-circle', 'circle-dashed', 'clock', 'record'].map((name) => `@phosphor-icons/core/bold/${name}-bold.svg?raw`),
    );
    for (const specifier of imports) {
      const file = specifier.replace(/^@phosphor-icons\/core\//, '').replace(/\?raw$/, '');

      expect(
        existsSync(join(repoRoot, 'apps', 'web', 'node_modules', '@phosphor-icons', 'core', 'assets', file)),
        `${file} is not in the installed Phosphor core`,
      ).toBe(true);
    }
    expect(Object.keys(manifest.dependencies ?? {}).filter((name) => /lucide|phosphor/.test(name))).toEqual([
      '@phosphor-icons/core',
    ]);
  });

  it('marks every icon with its name, and hides it unless named', () => {
    const facade = readFileSync(FACADE, 'utf8');

    expect(facade).toContain('data-icon={name}');
    expect(facade).toMatch(/aria-hidden=\{named \? undefined : true\}/);
    // Every export is drawn by the one factory, under its kebab name.
    const exports = [...facade.matchAll(/export const (\w+) = glyph\((\w+), "([a-z-]+)"\)/g)];

    expect(exports.length).toBe(facade.match(/^export const /gm)?.length);
    for (const [, name = '', , kebab = ''] of exports) {
      const expected = name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
        .toLowerCase();

      expect(kebab, `${name} is not marked by its own name`).toBe(expected);
    }
  });
});
