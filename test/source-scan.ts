import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The comment-stripping patterns and the directory walker the root source
 * scans share, written once.
 *
 * They had been copied into each scan that needed them. This module is the
 * home for the ROOT `test/` suite. `apps/web` and `packages/domain` keep their
 * own copies on purpose — `apps/web/src/lib/i18n/format.test.ts` and
 * `packages/domain/test/purity.test.ts` — because each workspace's Vitest
 * project runs on its own and does not import from the root `test/` tree;
 * both copies name this file, so a change here is a change to look for there.
 */

/** `/* … *\/`, across lines. */
export const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `//` to end of line. The leading class keeps `http://` in a string intact,
 *  so a replacement must put group 1 back (`'$1'`). */
export const LINE_SLASH = /(^|[\s;,{}()[\]])\/\/[^\n]*/g;
/** `--` to end of line. SQL only: in TypeScript this is the decrement operator. */
export const LINE_DASH = /(^|[\s;,()])--[^\n]*/g;
/** `#` to end of line, for the configuration formats that use it. */
export const LINE_HASH = /(^|[\s])#[^\n]*/g;
export const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/**
 * A TypeScript or JavaScript source with its comments removed — the two-pass
 * idiom: block comments first, then line comments, keeping the character that
 * preceded each `//`.
 */
export function stripScriptComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_SLASH, '$1');
}

/** A stylesheet with its comments removed. CSS has block comments only. */
export function stripCssComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '');
}

/** Directories that are never this repository's own source. */
export const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.temp',
  '.branches',
  // Vendored BMAD tooling: not our source, and not shipped.
  '_bmad',
]);

/**
 * Every file under `directory`, recursively, that `keep` accepts — skipping
 * {@link SKIP_DIRECTORIES} at any depth. A missing directory yields nothing
 * rather than throwing; each caller asserts its own non-empty result.
 */
export function collectFiles(directory: string, keep: (file: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectFiles(absolute, keep));
    } else if (keep(absolute)) {
      found.push(absolute);
    }
  }
  return found;
}
