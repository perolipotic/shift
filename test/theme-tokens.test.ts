import { describe, expect, it } from 'vitest';

import {
  allDeclarations,
  BASE_TOKENS,
  BRAND_TOKENS,
  DARK_QUERY,
  rawToken,
  stripped,
} from './theme-css.js';

/**
 * The theme layer's shape, asserted against the stylesheet itself (story 1.1b).
 *
 * The colour layer is CSS, so there is no module to import and no component to
 * render — what can silently break is the file. A half-finished hex-to-OKLCH
 * conversion, a token defined in light but forgotten in dark, a dark block
 * copy-pasted from light, or a theme toggle smuggled in as a `.dark` class
 * would all ship green without these.
 *
 * Both halves are covered. The first derivation asserted only the 23 brand
 * names and left the 28 shadcn base names — the ones every primitive actually
 * resolves first — untested; deleting `--border` and `--ring` from the dark
 * block kept the suite green.
 */

const ALL_TOKENS = [...BASE_TOKENS, ...BRAND_TOKENS];
const THEMES = ['light', 'dark'] as const;

describe('the token lists are the size everything else assumes', () => {
  // The spec, the change log and three test headers all reason about "23 brand"
  // and "28 base". Dropping a name would silently shrink every sweep that
  // consumes these lists while the suite stayed green.
  it('has 23 brand tokens', () => {
    expect(BRAND_TOKENS).toHaveLength(23);
  });

  it('has 28 shadcn base tokens', () => {
    expect(BASE_TOKENS).toHaveLength(28);
  });
});

describe('each token is declared exactly once per theme', () => {
  // A duplicate is invisible to a value assertion but changes what CSS applies.
  const cases = THEMES.flatMap((theme) => ALL_TOKENS.map((token) => ({ theme, token })));

  it.each(cases)('--$token appears once in $theme', ({ theme, token }) => {
    expect(allDeclarations(theme, token)).toHaveLength(1);
  });
});

describe('every token is defined in both themes', () => {
  const cases = THEMES.flatMap((theme) => ALL_TOKENS.map((token) => ({ theme, token })));

  it.each(cases)('--$token is declared in $theme', ({ theme, token }) => {
    expect(rawToken(theme, token)).not.toBeNull();
  });
});

describe('the dark theme is a real theme, not a copy of the light one', () => {
  /**
   * A dark block transcribed from light passes presence, OKLCH-ness and even
   * contrast — the fill is copied alongside its foreground, so every ratio
   * holds. Only comparing the two values catches it.
   *
   * Six stock shadcn tokens are identical across themes by design: the five
   * neutral chart greys and `sidebar-primary-foreground`. They are asserted
   * equal rather than skipped, so if a future shadcn release starts varying
   * them this test reports the change instead of quietly widening.
   */
  const PARITY = [
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
    'sidebar-primary-foreground',
  ];

  it.each(ALL_TOKENS.filter((token) => !PARITY.includes(token)))(
    '--%s differs between the themes',
    (token) => {
      expect(rawToken('dark', token)).not.toBe(rawToken('light', token));
    },
  );

  it.each(PARITY)('--%s is deliberately identical in both themes', (token) => {
    expect(rawToken('dark', token)).toBe(rawToken('light', token));
  });
});

describe('the conversion to OKLCH is complete', () => {
  it('declares every colour in oklch()', () => {
    const colours = [...stripped().matchAll(/^\s*--[a-z0-9-]+:\s*([^;]+);/gm)]
      .map((match) => match[1]?.trim() ?? '')
      .filter((value) => value.startsWith('oklch(') || /^(#|rgb|hsl|[a-z]+\()/i.test(value))
      .filter((value) => !value.startsWith('calc(') && !value.startsWith('var('));

    // Guard against a vacuous pass if the regex ever stops matching.
    expect(colours.length).toBeGreaterThanOrEqual(ALL_TOKENS.length * 2);
    expect(colours.filter((value) => !value.startsWith('oklch('))).toEqual([]);
  });

  it('leaves no hex value behind in the CSS itself', () => {
    expect(stripped().match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });
});

describe('every token is exposed as a Tailwind utility', () => {
  // `@theme inline` is what turns a custom property into `bg-shift-slot-3`.
  // It sits outside both theme scopes, so the assertions above cannot see it —
  // dropping a mapping left the whole suite green while the utility vanished.
  const inlineBlock = (): string => {
    const css = stripped();
    const start = css.indexOf('@theme inline');
    expect(start, 'no @theme inline block — no token reaches a utility').toBeGreaterThan(-1);

    // Brace-matched, as darkScope() is. `indexOf('}')` would truncate at the
    // first nested rule and let dropped mappings pass unseen.
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(open, i);
      }
    }
    throw new Error('THEME_INLINE_UNBALANCED');
  };

  it.each(ALL_TOKENS)('--color-%s maps to its custom property', (token) => {
    expect(inlineBlock()).toContain(`--color-${token}: var(--${token});`);
  });
});

describe('the theme is chosen by the operating system alone', () => {
  // UX-DR2: both themes ship driven entirely by prefers-color-scheme. No
  // toggle, no setting, nothing persisted — so no surface may exist for one.
  it.each(['.dark', '[data-theme', 'data-theme='])('carries no %s hook', (hook) => {
    expect(stripped().toLowerCase()).not.toContain(hook.toLowerCase());
  });
});

describe('ramp slots are numbered, never named', () => {
  // UX-DR6: Shift Types are Organization data assigned to slots in creation
  // order. A named token would encode one Organization's naming into the theme.
  it('defines no semantically-named shift token', () => {
    expect(stripped().toLowerCase()).not.toMatch(
      /--shift-(day|night|morning|evening|afternoon)\b/,
    );
  });
});

describe('there is exactly one dark mechanism', () => {
  // Asserted against the whole file, not against a scope defined as "the text
  // outside the dark block" — that phrasing cannot fail.
  it('declares prefers-color-scheme exactly once', () => {
    expect(stripped().match(/prefers-color-scheme/g)).toHaveLength(1);
  });

  it('writes the media query in the canonical form the helper matches', () => {
    // Every theme test resolves its scopes by matching this string. A reformat
    // would fail all three files with a bare DARK_BLOCK_MISSING and no named
    // invariant to explain why.
    expect(stripped()).toContain(DARK_QUERY);
  });
});

describe('the tokens are actually applied to the document', () => {
  /**
   * The source-level half of the loopback guard.
   *
   * `theme-applied.test.ts` proves the BUILT stylesheet consumes the tokens,
   * but it needs a build to do so — and `pnpm test` does not run one. This
   * assertion needs nothing but the source, so the regression that caused
   * review loopback 1 cannot recur unnoticed on a clean checkout.
   */
  it('paints the page from the tokens in @layer base', () => {
    const css = stripped();
    const layer = css.slice(css.indexOf('@layer base'));

    expect(css).toContain('@layer base');
    expect(layer).toMatch(/background-color:\s*var\(--background\)/);
    expect(layer).toMatch(/color:\s*var\(--foreground\)/);
  });

  it('tells the user agent to follow the theme', () => {
    expect(stripped()).toMatch(/color-scheme:\s*light dark/);
  });
});
