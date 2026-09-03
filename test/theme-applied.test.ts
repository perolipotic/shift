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
  it.skipIf(notBuilt)('declares color-scheme as a property, not only a media query', () => {
    const withoutQueries = builtCss().replaceAll('prefers-color-scheme', '');

    // `color-scheme: light` alone would satisfy a bare `color-scheme\s*:` and
    // reintroduce exactly the UA-painted wrong-theme surfaces this guards.
    expect(withoutQueries).toMatch(/color-scheme\s*:\s*light dark/);
  });
});
