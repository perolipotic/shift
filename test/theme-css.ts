import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, type Color } from 'culori';

/**
 * One reading of the theme stylesheet, shared by every theme test (story 1.1b).
 *
 * The first derivation had two tests each slicing the CSS themselves, and they
 * disagreed: one stripped comments, the other did not, so the same token could
 * be read two different ways. Worse, both did it at module scope, where a
 * missing dark block surfaces as an unnamed collection error instead of the
 * assertion written to explain it. Everything here is lazy and total — it
 * returns values or throws named errors; it never asserts.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export const STYLESHEET = join(repoRoot, 'apps', 'web', 'src', 'index.css');
export const DARK_QUERY = '@media (prefers-color-scheme: dark)';

/** The 23 brand token names from DESIGN.md's `colors:` front matter. */
export const BRAND_TOKENS: string[] = [
  'primary',
  'destructive',
  'shift-slot-1',
  'shift-slot-2',
  'shift-slot-3',
  'shift-slot-4',
  'shift-slot-5',
  'shift-slot-6',
  'shift-nonworking',
  'modifier-leave',
  'modifier-uncovered',
].flatMap((name) => [name, `${name}-foreground`]).concat('modifier-overridden');

/** The 28 shadcn/ui neutral base names, less `primary` and `destructive`,
 *  which the brand delta supplies instead. */
export const BASE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const;

export type Theme = 'light' | 'dark';

function source(): string {
  return readFileSync(STYLESHEET, 'utf8');
}

/**
 * Comment-blind view. The forbidden-construct scans look for `.dark`,
 * `data-theme` and named ramp tokens, all of which this stylesheet's own
 * comments legitimately mention while explaining their absence — and the
 * header now quotes DESIGN.md hex values too, which a raw hex scan would trip
 * over. Follows the two-pass idiom in `key-hygiene.test.ts`.
 */
export function stripped(): string {
  return source().replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The span of a brace-delimited block starting at `from`, as [open, close). */
function blockAt(css: string, from: number, what: string): [number, number] {
  const open = css.indexOf('{', from);
  if (open === -1) throw new Error(`${what}_UNOPENED`);

  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return [open, i];
    }
  }
  throw new Error(`${what}_UNBALANCED`);
}

function darkStart(css: string): number {
  const start = css.indexOf(DARK_QUERY);
  if (start === -1) throw new Error('DARK_BLOCK_MISSING');
  // Two dark blocks would mean later overrides invisible to every sweep below.
  if (css.indexOf(DARK_QUERY, start + 1) !== -1) throw new Error('MULTIPLE_DARK_BLOCKS');

  return start;
}

/** The dark media block's body, brace-matched so a later top-level rule — the
 *  `@theme inline` and `@layer base` blocks both follow it — cannot be read as
 *  part of it. */
export function darkScope(): string {
  const css = stripped();
  const [open, close] = blockAt(css, darkStart(css), 'DARK_BLOCK');

  return css.slice(open, close);
}

/**
 * Everything that is not the dark block.
 *
 * Not "the text before it": a `:root` declaration placed *after* the media
 * query is still a light-theme declaration and still what the browser applies,
 * and defining the light scope positionally would leave it unread while the
 * earlier, overridden value was tested instead.
 */
export function lightScope(): string {
  const css = stripped();
  const [, close] = blockAt(css, darkStart(css), 'DARK_BLOCK');

  return css.slice(0, darkStart(css)) + css.slice(close + 1);
}

export function scope(theme: Theme): string {
  return theme === 'light' ? lightScope() : darkScope();
}

/**
 * Every declaration of one token in one theme, in source order.
 *
 * The name is boundary-anchored. The light scope is everything outside the dark
 * block, which includes `@theme inline` — and there `--color-background:
 * var(--background);` would otherwise satisfy a search for `--background:`,
 * making the mapping masquerade as the token it maps.
 */
export function allDeclarations(theme: Theme, name: string): string[] {
  return [...scope(theme).matchAll(new RegExp(`(?<![\\w-])--${name}:\\s*([^;]+);`, 'g'))].map(
    (match) => match[1]?.trim() ?? '',
  );
}

/**
 * The raw declared value of one token in one theme, or null if undeclared.
 *
 * Takes the LAST declaration, which is the one CSS applies. Light and dark are
 * ~51 near-identical lines each, so a badly resolved merge conflict duplicating
 * a token is a realistic shape for this file — reading the first match would
 * test the shadowed value. `theme-tokens.test.ts` separately asserts that no
 * token is declared twice.
 */
export function rawToken(theme: Theme, name: string): string | null {
  return allDeclarations(theme, name).at(-1) ?? null;
}

/** The parsed colour, or null if the token is absent or unparseable. */
export function readToken(theme: Theme, name: string): Color | null {
  const raw = rawToken(theme, name);

  return raw === null ? null : (parse(raw) ?? null);
}
