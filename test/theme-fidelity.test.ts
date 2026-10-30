import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatHex, parse, rgb } from 'culori';
import { describe, expect, it } from 'vitest';

import { BASE_TOKENS, GLASS_COLOUR_TOKENS, GLASS_EFFECT_TOKENS, GLASS_TOKENS, rawToken, type Theme } from './theme-css.js';

/**
 * The OKLCH conversion round-trips to DESIGN.md's hex (story 1.1b, UX-DR3).
 *
 * Contrast catches lightness drift and nothing else: a hue or chroma slip
 * leaves every ratio intact while shipping the wrong colour. DESIGN.md is the
 * source of truth, so the check is mechanical — convert each shipped value back
 * and compare it to the front matter it came from.
 *
 * One value is expected to differ: LIGHT `--shift-nonworking-foreground`, which
 * was lightness-shifted by human decision because DESIGN.md's own value
 * measured 2.58:1 against its fill. It is named here so the deviation stays
 * deliberate: a second divergence fails. The dark one carried the same kind of
 * shift until story 7.1 re-tuned the dark ramp (decision 4); DESIGN.md now
 * declares the shipped dark value, so it round-trips like any other.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const DESIGN = join(
  repoRoot,
  '_bmad-output',
  'planning-artifacts',
  'ux-designs',
  'ux-shift-2026-09-02',
  'DESIGN.md',
);

/** Approved divergences: `theme:token` → the reason it may differ. */
const APPROVED = new Map([
  ['light:shift-nonworking-foreground', 'lightness-shifted to clear 4.5:1; see the spec change log'],
]);

/** DESIGN.md's `colors:` front matter, as declared. */
function designTokens(): Map<string, string> {
  const md = readFileSync(DESIGN, 'utf8');
  const block = md.split(/^colors:\s*$/m)[1]?.split(/^\w[\w-]*:\s*$/m)[0] ?? '';
  const tokens = new Map<string, string>();

  for (const line of block.split('\n')) {
    const found = /^\s{2}([a-z0-9-]+):\s*'([^']+)'/.exec(line);
    if (found?.[1] !== undefined && found[2] !== undefined) tokens.set(found[1], found[2]);
  }

  return tokens;
}

/** DESIGN.md suffixes dark values with `-dark`; the stylesheet puts them in the
 *  dark media block under the base name. */
function designKey(theme: Theme, token: string): string {
  return theme === 'light' ? token : `${token}-dark`;
}

const THEMES = ['light', 'dark'] as const;

/** Lazy and memoised. Read at module scope, a moved or renamed DESIGN.md would
 *  surface as an unnamed collection error instead of the assertion below. */
let cached: Map<string, string> | null = null;
function tokens(): Map<string, string> {
  cached ??= designTokens();

  return cached;
}

/** The 24 brand names, derived rather than hard-coded so a DESIGN.md rename
 *  changes the case list instead of silently skipping a token.
 *
 *  A key is a DARK VALUE only when the name it suffixes is itself declared:
 *  story 15.2's `band-dark` ends in `-dark` and is a light value (its dark
 *  value is `band-dark-dark`), so stripping the suffix blindly would read it
 *  as the dark value of a `band` that does not exist. */
function tokenNames(): string[] {
  const keys = new Set(tokens().keys());

  return [...keys].filter((key) => !(key.endsWith('-dark') && keys.has(key.slice(0, -'-dark'.length))));
}

describe('DESIGN.md is readable and complete', () => {
  // Without this, an unparsed front matter would make every case below vacuous.
  // STORY 15.2: 48 and 24, with the hour band's `band-dark` pair.
  it('parses all 48 declared colour values', () => {
    expect(tokens().size).toBe(48);
  });

  it('yields the 24 token names the rest of the suite expects', () => {
    expect(tokenNames()).toHaveLength(24);
  });
});

describe('every shipped value round-trips to the hex DESIGN.md declares', () => {
  // `it.each` needs its list at collection time, so this cannot be deferred
  // into a test body — but it must not throw there either, or the readability
  // assertions written to explain the failure never run. An unreadable
  // DESIGN.md yields no cases and fails loudly in the describe above.
  const names = ((): string[] => {
    try {
      return tokenNames();
    } catch {
      return [];
    }
  })();
  const cases = THEMES.flatMap((theme) => names.map((token) => ({ theme, token })));

  it.each(cases)('$token in $theme', ({ theme, token }) => {
    const declared = tokens().get(designKey(theme, token));
    expect(
      declared,
      `DESIGN.md declares no ${designKey(theme, token)} — a rename would otherwise disable this check silently`,
    ).toBeDefined();
    if (declared === undefined) return;

    const shipped = rawToken(theme, token);
    expect(shipped, `--${token} is not declared in the ${theme} theme`).not.toBeNull();

    const expected = rgb(parse(declared));
    const actual = rgb(parse(shipped ?? ''));
    expect(expected, `DESIGN.md's ${designKey(theme, token)} is unparseable`).toBeDefined();
    expect(actual, `--${token} (${theme}) is unparseable`).toBeDefined();
    if (expected === undefined || actual === undefined) return;

    const drift = Math.max(
      Math.abs(expected.r - actual.r),
      Math.abs(expected.g - actual.g),
      Math.abs(expected.b - actual.b),
    ) * 255;

    if (APPROVED.has(`${theme}:${token}`)) {
      // A deviation must stay a deviation: if it silently reverts to DESIGN.md,
      // the contrast fix has been undone and this test should say so.
      expect(
        drift,
        `--${token} (${theme}) now matches DESIGN.md again — the approved contrast fix was reverted`,
      ).toBeGreaterThan(1);

      return;
    }

    expect(
      drift,
      `--${token} (${theme}) is ${formatHex(actual)}, DESIGN.md declares ${formatHex(expected)}`,
    ).toBeLessThan(0.5);
  });

  it.each(THEMES)('preserves alpha on the uncovered overlay and the non-working border in %s', (theme) => {
    // `shift-nonworking-border` (story 7.1) is alpha-only: transparent in
    // light, a 7% white hairline in dark. Dropped alpha would paint it opaque.
    for (const token of ['modifier-uncovered', 'shift-nonworking-border']) {
      const declared = parse(tokens().get(designKey(theme, token)) ?? '');
      const shipped = parse(rawToken(theme, token) ?? '');

      expect(shipped?.alpha, `--${token} (${theme}) lost its alpha`).toBeCloseTo(
        declared?.alpha ?? 1,
        3,
      );
    }
  });
});

/**
 * The base palette, round-tripped the same way (visual refresh A).
 *
 * The surfaces — page, card, muted, border, input, ring, sidebar — stopped
 * being stock shadcn when the slate/navy retheme landed, so their source of
 * truth moved into DESIGN.md's `base-palette:` key, one map per theme. Without
 * this block that claim would be prose: a surface could drift off its declared
 * hex with every contrast ratio still green.
 *
 * NO EXEMPTIONS. The accessibility deviations recorded in `index.css`'s header
 * (muted-foreground, input, ring, sidebar-ring) are deviations from the plain
 * slate STEP, not from DESIGN.md: the declared hex already is the measured
 * value, so each round-trips like any other.
 */
function basePalette(): Record<Theme, Map<string, string>> {
  const md = readFileSync(DESIGN, 'utf8');
  const block = md.split(/^base-palette:\s*$/m)[1]?.split(/^\w[\w-]*:\s*$/m)[0] ?? '';
  const themes: Record<Theme, Map<string, string>> = { light: new Map(), dark: new Map() };
  let current: Theme | null = null;

  for (const line of block.split('\n')) {
    const heading = /^\s{2}(light|dark):\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      current = heading[1] as Theme;
      continue;
    }
    const found = /^\s{4}([a-z0-9-]+):\s*'([^']+)'/.exec(line);
    if (current !== null && found?.[1] !== undefined && found[2] !== undefined) {
      themes[current].set(found[1], found[2]);
    }
  }

  return themes;
}

describe('every base token round-trips to the hex base-palette declares', () => {
  it.each(THEMES)('declares every one of the 28 base tokens for %s', (theme) => {
    expect([...basePalette()[theme].keys()].sort()).toEqual([...BASE_TOKENS].sort());
  });

  const cases = THEMES.flatMap((theme) => BASE_TOKENS.map((token) => ({ theme, token })));

  it.each(cases)('$token in $theme', ({ theme, token }) => {
    const declared = basePalette()[theme].get(token);
    expect(declared, `base-palette.${theme} declares no ${token}`).toBeDefined();

    const shipped = rawToken(theme, token);
    expect(shipped, `--${token} is not declared in the ${theme} theme`).not.toBeNull();

    const expected = rgb(parse(declared ?? ''));
    const actual = rgb(parse(shipped ?? ''));
    expect(expected, `base-palette.${theme}.${token} is unparseable`).toBeDefined();
    expect(actual, `--${token} (${theme}) is unparseable`).toBeDefined();
    if (expected === undefined || actual === undefined) return;

    const drift =
      Math.max(
        Math.abs(expected.r - actual.r),
        Math.abs(expected.g - actual.g),
        Math.abs(expected.b - actual.b),
      ) * 255;

    expect(
      drift,
      `--${token} (${theme}) is ${formatHex(actual)}, DESIGN.md declares ${formatHex(expected)}`,
    ).toBeLessThan(0.5);
    expect(actual.alpha ?? 1, `--${token} (${theme}) alpha differs from DESIGN.md`).toBeCloseTo(
      expected.alpha ?? 1,
      3,
    );
  });
});

/**
 * The glass set, round-tripped the same way (story 15.1, direction G).
 *
 * DESIGN.md's `glass:` key holds one map per theme: eleven colours (story 15.2
 * added the Dialog's `glass-scrim`) and three effects. The COLOURS round-trip as every other colour does, alpha included,
 * because a glass alpha IS the design (.58 beside content, .80 over it). The
 * EFFECTS are not colours: the blur and the saturate must be the same text,
 * and the shadow the same geometry with its colour round-tripped, since the
 * stylesheet writes that colour in OKLCH where DESIGN.md writes rgba.
 */
function glassBlock(): Record<Theme, Map<string, string>> {
  const md = readFileSync(DESIGN, 'utf8');
  const block = md.split(/^glass:\s*$/m)[1]?.split(/^\w[\w-]*:\s*$/m)[0] ?? '';
  const themes: Record<Theme, Map<string, string>> = { light: new Map(), dark: new Map() };
  let current: Theme | null = null;

  for (const line of block.split('\n')) {
    const heading = /^\s{2}(light|dark):\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      current = heading[1] as Theme;
      continue;
    }
    const found = /^\s{4}([a-z0-9-]+):\s*'([^']+)'/.exec(line);
    if (current !== null && found?.[1] !== undefined && found[2] !== undefined) {
      themes[current].set(found[1], found[2]);
    }
  }

  return themes;
}

/** The largest channel difference between two colours, on the 0–255 scale. */
function driftOf(declared: string, shipped: string): { drift: number; alpha: [number, number] } | null {
  const expected = rgb(parse(declared));
  const actual = rgb(parse(shipped));
  if (expected === undefined || actual === undefined) return null;

  return {
    drift:
      Math.max(
        Math.abs(expected.r - actual.r),
        Math.abs(expected.g - actual.g),
        Math.abs(expected.b - actual.b),
      ) * 255,
    alpha: [expected.alpha ?? 1, actual.alpha ?? 1],
  };
}

describe('every glass token round-trips to the value glass: declares (story 15.1)', () => {
  it.each(THEMES)('declares every one of the 14 glass tokens for %s', (theme) => {
    expect([...glassBlock()[theme].keys()].sort()).toEqual([...GLASS_TOKENS].sort());
  });

  const colours = THEMES.flatMap((theme) => GLASS_COLOUR_TOKENS.map((token) => ({ theme, token })));

  it.each(colours)('$token in $theme', ({ theme, token }) => {
    const declared = glassBlock()[theme].get(token);
    const shipped = rawToken(theme, token);
    expect(declared, `glass.${theme} declares no ${token}`).toBeDefined();
    expect(shipped, `--${token} is not declared in the ${theme} theme`).not.toBeNull();

    const measured = driftOf(declared ?? '', shipped ?? '');
    expect(measured, `--${token} (${theme}) or its DESIGN.md value is unparseable`).not.toBeNull();
    if (measured === null) return;

    expect(measured.drift, `--${token} (${theme}) drifts from DESIGN.md`).toBeLessThan(0.5);
    expect(measured.alpha[1], `--${token} (${theme}) alpha differs from DESIGN.md`).toBeCloseTo(measured.alpha[0], 3);
  });

  const effects = THEMES.flatMap((theme) =>
    GLASS_EFFECT_TOKENS.filter((token) => token !== 'glass-shadow').map((token) => ({ theme, token })),
  );

  it.each(effects)('$token in $theme is the same text', ({ theme, token }) => {
    expect(rawToken(theme, token)).toBe(glassBlock()[theme].get(token));
  });

  it.each(THEMES)('glass-shadow in %s has the same geometry and colour', (theme) => {
    const split = (value: string): [string, string] => {
      const at = value.search(/(rgba?|oklch)\(/);

      return [value.slice(0, at).trim(), value.slice(at).trim()];
    };
    const [declaredGeometry, declaredColour] = split(glassBlock()[theme].get('glass-shadow') ?? '');
    const [shippedGeometry, shippedColour] = split(rawToken(theme, 'glass-shadow') ?? '');

    expect(shippedGeometry).toBe(declaredGeometry);
    expect(shippedColour, '--glass-shadow does not draw in OKLCH').toMatch(/^oklch\(/);

    const measured = driftOf(declaredColour, shippedColour);
    expect(measured).not.toBeNull();
    expect(measured?.drift ?? Infinity).toBeLessThan(0.5);
    expect(measured?.alpha[1]).toBeCloseTo(measured?.alpha[0] ?? -1, 3);
  });
});
