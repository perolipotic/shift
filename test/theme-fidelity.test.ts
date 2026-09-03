import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatHex, parse, rgb } from 'culori';
import { describe, expect, it } from 'vitest';

import { rawToken, type Theme } from './theme-css.js';

/**
 * The OKLCH conversion round-trips to DESIGN.md's hex (story 1.1b, UX-DR3).
 *
 * Contrast catches lightness drift and nothing else: a hue or chroma slip
 * leaves every ratio intact while shipping the wrong colour. DESIGN.md is the
 * source of truth, so the check is mechanical — convert each shipped value back
 * and compare it to the front matter it came from.
 *
 * Two values are expected to differ. `--shift-nonworking-foreground` was
 * lightness-shifted in both themes by human decision, because DESIGN.md's own
 * values measured 2.58:1 and 3.76:1 against their fill. Those are named here so
 * the deviation stays deliberate: a third divergence fails.
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

/** Approved divergences: token name → the reason it may differ. */
const APPROVED = new Map([
  ['shift-nonworking-foreground', 'lightness-shifted to clear 4.5:1; see the spec change log'],
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

/** The 23 base names, derived rather than hard-coded so a DESIGN.md rename
 *  changes the case list instead of silently skipping a token. */
function tokenNames(): string[] {
  return [...new Set([...tokens().keys()].map((key) => key.replace(/-dark$/, '')))];
}

describe('DESIGN.md is readable and complete', () => {
  // Without this, an unparsed front matter would make every case below vacuous.
  it('parses all 46 declared colour values', () => {
    expect(tokens().size).toBe(46);
  });

  it('yields the 23 token names the rest of the suite expects', () => {
    expect(tokenNames()).toHaveLength(23);
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

    if (APPROVED.has(token)) {
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

  it.each(THEMES)('preserves alpha on the overlay modifiers in %s', (theme) => {
    for (const token of ['modifier-leave', 'modifier-uncovered']) {
      const declared = parse(tokens().get(designKey(theme, token)) ?? '');
      const shipped = parse(rawToken(theme, token) ?? '');

      expect(shipped?.alpha, `--${token} (${theme}) lost its alpha`).toBeCloseTo(
        declared?.alpha ?? 1,
        3,
      );
    }
  });
});
