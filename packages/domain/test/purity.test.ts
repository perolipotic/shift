import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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
 *
 * The specifier check is an ALLOWLIST, not a denylist. The invariant is "zero
 * runtime dependencies", and a list of forbidden names can only ever ban what
 * someone thought to write down: `npm:@supabase/supabase-js@2.113.0`,
 * `https://esm.sh/react`, `jsr:@std/datetime` and `date-fns` all slip past a
 * denylist naming react and Supabase, while each one is exactly the violation
 * this exists to prevent.
 */

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const testRoot = join(packageRoot, 'test');

/**
 * What the shipped engine may import: nothing but its own files.
 *
 * Stricter than the test allowlist below, and deliberately so — `src/` is
 * bundled into the browser SPA, where a `node:` builtin has nowhere to resolve.
 */
const SOURCE_ALLOWS_BARE: readonly RegExp[] = [];

/**
 * What the engine's tests may import: node builtins to read fixtures from disk,
 * and the runner. Tests never ship.
 */
const TEST_ALLOWS_BARE: readonly RegExp[] = [/^node:/, /^vitest$/];

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

/**
 * Every specifier imported, re-exported or required by a source file, paired
 * with whether it is relative. A specifier is relative only when it starts with
 * `.` — everything else reaches outside this package, whatever its scheme.
 */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /(?:^|[\s;}])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push(specifier);
    }
  }
  return found;
}

const isRelative = (specifier: string): boolean => specifier.startsWith('.');

function violations(files: readonly string[], allowed: readonly RegExp[]): string[] {
  const offences: string[] = [];
  for (const file of files) {
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (isRelative(specifier)) continue;
      if (allowed.some((pattern) => pattern.test(specifier))) continue;
      offences.push(`${relative(packageRoot, file)} imports '${specifier}'`);
    }
  }
  return offences;
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

  it('imports nothing but its own files from src', () => {
    const files = collectSourceFiles(sourceRoot);

    // Non-empty guard: with no files to scan the assertion below would pass
    // vacuously, and a package that had stopped existing would look pure.
    expect(files.length).toBeGreaterThan(0);
    expect(violations(files, SOURCE_ALLOWS_BARE)).toEqual([]);
  });

  it('imports nothing beyond node builtins and the runner from test', () => {
    const files = collectSourceFiles(testRoot);

    expect(files.length).toBeGreaterThan(0);
    expect(violations(files, TEST_ALLOWS_BARE)).toEqual([]);
  });

  it('detects every shape of outside import, not just the ones named react', () => {
    // Guards the detector itself: a matcher that matched nothing would let the
    // assertions above pass while the package rotted. Every entry below is a
    // real way to reach outside the package that a react/@supabase denylist
    // misses entirely.
    //
    // The statement keywords are assembled at runtime rather than written out,
    // because this file is itself scanned by the assertion above — a literal
    // `import x from 'react'` here would, correctly, be reported as a violation
    // of this very package.
    const IMPORT = `im${'port'}`;
    const REQUIRE = `req${'uire'}`;

    const outside = [
      'react',
      'react-dom/client',
      '@supabase/supabase-js',
      'npm:@supabase/supabase-js@2.113.0',
      'https://esm.sh/react@19.2.8',
      'jsr:@std/datetime',
      'date-fns',
      'lodash-es',
      '@tanstack/react-router',
      'node:fs',
    ];

    for (const specifier of outside) {
      for (const statement of [
        `${IMPORT} x from "${specifier}"`,
        `${IMPORT} "${specifier}"`,
        `export { x } from "${specifier}"`,
        `const m = ${REQUIRE}("${specifier}")`,
        `const m = await ${IMPORT}("${specifier}")`,
      ]) {
        expect(violationsIn(statement), statement).toEqual([specifier]);
      }
    }

    // Relative specifiers are the one thing that is always fine.
    expect(violationsIn(`export { x } from "./local"`)).toEqual([]);
    expect(violationsIn(`${IMPORT} { y } from "../sibling/y.ts"`)).toEqual([]);
  });
});

/** The same check as {@link violations}, against a source string. */
function violationsIn(source: string): string[] {
  return specifiers(source).filter(
    (specifier) => !isRelative(specifier) && !SOURCE_ALLOWS_BARE.some((p) => p.test(specifier)),
  );
}
