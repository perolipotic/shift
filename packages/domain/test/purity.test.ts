import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-7 — the domain engine is pure.
 *
 * The primary guard is module resolution: `packages/domain/package.json`
 * declares no `dependencies`, so with pnpm's isolated linker an import of
 * `react` or `@supabase/supabase-js` here cannot resolve and `pnpm build`
 * fails. That guard only fires on a build, so these assertions restate it as a
 * test — a regression is caught by `pnpm test` without waiting for a red build.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');

/** Bare specifiers no file in this package may import, matching the ESLint override. */
const BANNED_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /^react$/,
  /^react-/,
  /^react\//,
  /^@supabase\//,
];

function collectSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectSourceFiles(absolute));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      found.push(absolute);
    }
  }
  return found;
}

/** Every bare (non-relative) specifier imported, re-exported or required by a source file. */
function bareSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined && !specifier.startsWith('.')) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

describe('domain purity', () => {
  it('declares no runtime dependencies', () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(Object.hasOwn(manifest, 'dependencies')).toBe(false);
    expect(Object.hasOwn(manifest, 'peerDependencies')).toBe(false);
    expect(Object.hasOwn(manifest, 'optionalDependencies')).toBe(false);
  });

  it('imports no banned specifier from any source file', () => {
    const offences: string[] = [];

    for (const file of collectSourceFiles(sourceRoot)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of bareSpecifiers(source)) {
        if (BANNED_SPECIFIER_PATTERNS.some((pattern) => pattern.test(specifier))) {
          offences.push(`${file.slice(packageRoot.length)} imports '${specifier}'`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('detects a banned specifier when one is present', () => {
    // Guards the detector itself: a matcher that matches nothing would let the
    // assertion above pass while the package rots.
    expect(bareSpecifiers("import 'react'\n")).toContain('react');
    expect(bareSpecifiers("import { createClient } from '@supabase/supabase-js'")).toContain(
      '@supabase/supabase-js',
    );
    expect(bareSpecifiers("export { x } from './local'")).toEqual([]);
  });
});
