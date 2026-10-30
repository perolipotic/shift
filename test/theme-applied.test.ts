import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STYLESHEET } from './theme-css.js';

/**
 * The theme is not only defined but actually painted (story 1.1b).
 *
 * This is the assertion whose absence let the first derivation ship: every
 * token was declared, every ratio measured, and the built CSS contained zero
 * `var(--background)` consumers. Tailwind 4's preflight paints no page
 * background, so shadcn's `@layer base` block is load-bearing — without it the
 * shell renders browser-default white in both themes and nothing notices.
 *
 * Source-only assertions cannot see this: the question is whether the shipped
 * stylesheet references the tokens, which is a property of the build.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const assets = join(repoRoot, 'apps', 'web', 'dist', 'assets');
// `dist` can exist while `assets` does not, after a partial or cleaned build.
const notBuilt = !existsSync(assets);

/** The built stylesheet, whose name carries a content hash. */
function builtSheet(): string {
  const sheets = readdirSync(assets).filter((name) => name.endsWith('.css'));
  expect(sheets.length, 'expected exactly one built stylesheet').toBe(1);

  return join(assets, sheets[0] ?? '');
}

function builtCss(): string {
  return readFileSync(builtSheet(), 'utf8');
}

/**
 * Freshness, asserted before content.
 *
 * `pnpm test` does not build (`package.json`: `pnpm -r test && vitest run`,
 * no `pretest`), `dist/` is gitignored, and there is no CI. So without this,
 * a `dist` produced before the last edit to `index.css` satisfies every
 * assertion below — demonstrated in review: deleting the whole `@layer base`
 * block and running vitest without rebuilding left all 443 tests green.
 *
 * This FAILS rather than skips, because a stale build is a wrong answer while
 * an absent one is merely no answer. The source-level companion in
 * `theme-tokens.test.ts` covers the clean-checkout case, where these skip.
 */
describe('the build being read reflects the current source', () => {
  it.skipIf(notBuilt)('is newer than the stylesheet it was built from', () => {
    const built = statSync(builtSheet()).mtimeMs;
    const source = statSync(STYLESHEET).mtimeMs;

    expect(
      built,
      `dist is older than index.css — run \`pnpm build\`; these assertions would otherwise pass against stale output`,
    ).toBeGreaterThan(source);
  });
});

// `it.skipIf` rather than an early return, so a clean checkout reports these as
// skipped instead of green having asserted nothing (test/static-hosting.test.ts).
describe('the built stylesheet consumes the tokens it defines', () => {
  it.skipIf(notBuilt)('paints the page background from --background', () => {
    expect(builtCss()).toContain('var(--background)');
  });

  it.skipIf(notBuilt)('paints the page text from --foreground', () => {
    expect(builtCss()).toContain('var(--foreground)');
  });

  it.skipIf(notBuilt)('applies the default border colour from --border', () => {
    expect(builtCss()).toContain('var(--border)');
  });

  /**
   * The input boundary, and this is 1.1b's original loopback in a new place.
   *
   * Story 1.1d raised `--input` to clear WCAG 1.4.11 and measured the token in
   * `theme-contrast.test.ts`. A review mutation then changed one class in
   * `components/ui/input.tsx` from `border-input` to `border-border`, and all
   * 900 tests stayed green: the accessibility deliverable was a token value
   * that no rendered pixel consumed. Exactly the shape of the defect that made
   * this file exist — every token defined, the built stylesheet consuming
   * none.
   *
   * `var(--input)` alone is not enough to assert: `@theme inline` emits
   * `--color-input: var(--input)` unconditionally, so the reference is in the
   * sheet whether or not anything draws with it. The `.border-input` RULE only
   * exists if a class in the source tree asks for it, which is the claim.
   */
  it.skipIf(notBuilt)('emits a border-input utility resolving to --input', () => {
    const rule = /\.border-input\s*\{[^}]*border-color:\s*var\(--input\)/.exec(builtCss());

    expect(
      rule,
      'no .border-input rule in the built sheet — nothing on screen draws the boundary --input was raised for (WCAG 1.4.11)',
    ).not.toBeNull();
  });

  /**
   * The curated accents, as RULES rather than as declarations (story 1.4c).
   *
   * THE SAME LOOPBACK `.border-input` closed, in a new place and with a wider
   * blast radius. Every accent's colour is authored in `index.css` and measured
   * in `theme-contrast.test.ts`, and none of that says a single pixel is
   * painted: a utility class only exists in the built sheet if some source file
   * asks for it by its WHOLE NAME. Tailwind resolves classes by scanning source
   * text, so the obvious review simplification — replacing
   * `@/features/organization/utils/accent`'s hand-written table with
   * `` `bg-brand-${key}` `` — emits no `.bg-brand-*` rule at all while every
   * source-level assertion in the repository keeps passing, and no accent
   * paints for anybody.
   *
   * ONE OF EACH OF THE THREE SHAPES the accent uses, bound to the custom
   * property it must resolve to: a fill, a border and a foreground. The
   * foreground is the one the contrast measurement is actually about — a fill
   * that ships without its text colour is a mark whose letter is whatever the
   * page inherited.
   *
   * THE CLASS NAMES LIVE IN THIS FILE, which is outside `apps/web` and so
   * outside what Tailwind scans — and that placement is load-bearing rather
   * than incidental. The scanner is TEXT-based and reads comments too, so a
   * whole class name written in prose anywhere under `apps/web/src` emits that
   * rule into the built sheet whether or not anything renders it: one such
   * comment in `pages/prijava.test.ts` kept `.bg-brand-blue` alive through a
   * mutation that had stopped the accent module producing any class at all,
   * which is this guard passing on evidence it manufactured itself.
   */
  it.skipIf(notBuilt).each([
    { utility: 'bg-brand-blue', property: 'background-color', token: 'brand-blue' },
    { utility: 'border-brand-violet', property: 'border-color', token: 'brand-violet' },
    { utility: 'text-brand-amber-foreground', property: 'color', token: 'brand-amber-foreground' },
    // The working-shift ramp (UX-DR3): every slot the shift-type chips paint,
    // so a mapping typo surfaces here rather than as an unstyled cell.
    ...[1, 2, 3, 4, 5, 6].map((slot) => ({
      utility: `bg-shift-slot-${slot}`,
      property: 'background-color',
      token: `shift-slot-${slot}`,
    })),
    // One modifier text utility: the hour band bar's uncovered flag.
    { utility: 'text-modifier-uncovered-foreground', property: 'color', token: 'modifier-uncovered-foreground' },
    // Story 15.1 (D3): the ink default button, fill and text.
    { utility: 'bg-ink', property: 'background-color', token: 'ink' },
    { utility: 'text-ink-foreground', property: 'color', token: 'ink-foreground' },
  ])('emits a $utility rule resolving to --$token', ({ utility, property, token }) => {
    const rule = new RegExp(`\\.${utility}\\s*\\{[^}]*${property}:\\s*var\\(--${token}\\)`).exec(
      builtCss(),
    );

    expect(
      rule,
      `no .${utility} rule in the built sheet — the accent is defined, measured, and painted by nothing`,
    ).not.toBeNull();
  });

  // Counting all `var(--…)` would be vacuous: Tailwind's own preflight already
  // emits eight (--spacing, --text-sm, --font-mono and friends), so deleting
  // the entire @layer base block still cleared a bare `> 2`. Only theme tokens
  // count here.
  it.skipIf(notBuilt)('references the theme tokens specifically', () => {
    const themeRefs = (builtCss().match(/var\(--[a-z0-9-]+\)/g) ?? []).filter((ref) =>
      /var\(--(background|foreground|border|input|ring|card|popover|secondary|muted|accent|primary|destructive|chart-|shift-|modifier-|sidebar)/.test(
        ref,
      ),
    );

    expect(themeRefs.length, 'no theme token is consumed by the built CSS').toBeGreaterThan(0);
  });
});

describe('the user agent follows the theme too', () => {
  // Without `color-scheme`, the UA paints scrollbars, form controls and the
  // canvas behind the root light in dark mode — the other half of a flash of
  // the wrong theme, and invisible to any token assertion.
  it.skipIf(notBuilt)('declares color-scheme for both themes', () => {
    // Each theme names its own scheme: `light` on :root, `dark` on the
    // attribute. Only one of the two would leave the other theme's scrollbars
    // and form controls in the wrong colours.
    expect(builtCss()).toMatch(/color-scheme\s*:\s*light\b/);
    expect(builtCss()).toMatch(/color-scheme\s*:\s*dark\b/);
  });
});

// Story 15.1 (D1). Outfit replaced DM Sans, Syne and the five Shift Figures
// files: the built stylesheet links Outfit's two subsets as files — latin and
// latin-ext, where every Croatian diacritic lives — and nothing of the faces
// it replaced. `vite.config.ts` keeps any woff2 out of the CSS as a data URI,
// so a subset is fetched only when a character in its range renders.
describe('the built stylesheet links the Outfit files rather than inlining them', () => {
  it.skipIf(notBuilt)('references both Outfit subsets, each on disk', () => {
    const files = [...new Set([...builtCss().matchAll(/outfit-(latin|latin-ext)-wght-normal-[\w-]+\.woff2/g)].map((match) => match[0]))];

    expect(files.map((file) => /outfit-(latin(?:-ext)?)-/.exec(file)?.[1]).sort()).toEqual(['latin', 'latin-ext']);
    expect(files.filter((file) => !existsSync(join(assets, file))), 'a referenced Outfit file is missing').toEqual([]);
  });

  it.skipIf(notBuilt)('ships nothing of the faces Outfit replaced', () => {
    expect(builtCss()).not.toMatch(/dm-sans|syne|shift-figures|Shift Figures/i);
    expect(readdirSync(assets).filter((name) => /dm-sans|syne|shift-figures/.test(name))).toEqual([]);
  });

  it.skipIf(notBuilt)('inlines no woff2 as a data URI', () => {
    expect(builtCss()).not.toContain('data:font/woff2');
  });
});

// Story 15.1: glass reaches the build, with its fallbacks, and the digits are
// tabular on the document.
describe('the built stylesheet carries the glass and the tabular figures', () => {
  it.skipIf(notBuilt)('emits both glass treatments with the prefixed and standard backdrop filter', () => {
    const css = builtCss();

    for (const name of ['glass-chrome', 'glass-over-content']) {
      const rule = new RegExp(`\\.${name}\\{[^}]*-webkit-backdrop-filter:blur\\(var\\(--glass-blur\\)\\)[^}]*;backdrop-filter:blur`).exec(css);

      expect(rule, `no .${name} rule with both backdrop filters in the built sheet`).not.toBeNull();
    }
    expect(css).toMatch(/@supports not \(/);
    expect(css).toContain('prefers-reduced-transparency:reduce');
  });

  it.skipIf(notBuilt)('sets tabular figures on the document', () => {
    expect(builtCss()).toMatch(/html\{[^}]*font-variant-numeric:tabular-nums/);
  });

  it.skipIf(notBuilt)('emits the phone head\'s over-content glass, under its breakpoint variant', () => {
    // `StickyHead` asks for `max-sm:glass-over-content`; a class Tailwind
    // cannot resolve would leave the phone's month head transparent.
    expect(builtCss()).toMatch(/\.max-sm\\:glass-over-content\{[^}]*backdrop-filter:blur\(var\(--glass-blur\)\)/);
  });

  it.skipIf(notBuilt)('emits rounded-cell at 10 px or less', () => {
    // `@theme inline` writes the value into the rule rather than a var(), so
    // the rule itself is what is read.
    const value = /\.rounded-cell\{border-radius:([^;}]+)[;}]/.exec(builtCss())?.[1] ?? '';
    const found = /^(\d*\.?\d+)(rem|px)$/.exec(value.trim());

    expect(found, `.rounded-cell draws ${value || 'nothing'}`).not.toBeNull();
    const px = Number(found?.[1]) * (found?.[2] === 'rem' ? 16 : 1);

    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThanOrEqual(10);
  });

  it.skipIf(notBuilt)('lets the opaque menu and sheet override the glass pill', () => {
    expect(builtCss()).toMatch(
      /\.shell-entries-opaque \.shell-entry:hover,\.shell-entries-opaque \.shell-entry\[aria-current=page\]\{background-color:var\(--accent\)/,
    );
  });
});
