import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripScriptComments } from './source-scan';

/**
 * Epic 11 retro A2, R2: `calendar/utils/month.ts` imports no module that
 * imports it back, directly or transitively. Story 11.3 made it import
 * `staffing/services/short-staffed`, which imported `month.ts` again (and
 * reached it through `conflicts/services/conflicts-queue` too) — the hazard
 * `eslint.config.js` names beside `FEATURE_PUBLIC`: a cycle puts a top-level
 * value in TDZ reach the day one is used at load time.
 *
 * The walk follows every `@/` and relative (`./`, `../`) specifier that
 * survives compilation — static `import … from`, `export … from`, side-effect
 * `import '…'` and dynamic `import('…')` — `@/` resolved as Vite resolves it,
 * a relative one against the importing file's directory. One that resolves to
 * no source file throws, unless it is an asset (css, svg, png, json, `?raw`,
 * `?url`), so no edge is dropped silently. A wholly type-only statement
 * (`import type …`, `export type …`) is erased and loads nothing, so it is no
 * edge: `calendar/utils/modifiers.ts` names `month.ts`'s `CalendarDay` and
 * `CalendarMonth` that way, and that is not a load-order hazard. A mixed
 * `import { x, type Y }` still loads its module and stays an edge.
 */

const webSrc = fileURLToPath(new URL('../apps/web/src/', import.meta.url));
const MONTH = `${webSrc}features/calendar/utils/month.ts`;

/** Every `@/` and relative (`./`, `../`) specifier a source loads, comments and wholly type-only statements stripped. */
function localSpecifiersOf(source: string): string[] {
  const code = stripScriptComments(source).replace(/\b(?:import|export)\s+type\s+[^;]*?\bfrom\s+['"][^'"]+['"]/g, '');
  const specifiers = new Set<string>();
  const local = String.raw`(?:@\/|\.\.?\/)[^'"]+`;
  const patterns = [
    new RegExp(String.raw`\bfrom\s+['"](${local})['"]`, 'g'),
    new RegExp(String.raw`\bimport\s+['"](${local})['"]`, 'g'),
    new RegExp(String.raw`\bimport\(\s*['"](${local})['"]\s*\)`, 'g'),
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1] as string);
  }

  return [...specifiers];
}

/** An asset import: loads no module of ours, so it is no edge. */
const ASSET = /(?:\.(?:css|svg|png|json)|\?(?:raw|url))$/;

/**
 * The source file a local specifier names, from the importing `file`: `@/` as
 * Vite resolves it, a relative one against `file`'s directory. `null` for an
 * asset. THROWS on a specifier that resolves to nothing, so an edge is never
 * dropped silently.
 */
function resolveLocal(file: string, specifier: string): string | null {
  if (ASSET.test(specifier)) return null;

  const base = specifier.startsWith('@/') ? `${webSrc}${specifier.slice(2)}` : resolve(dirname(file), specifier);

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }

  throw new Error(`${file}: '${specifier}' resolves to no source file`);
}

/**
 * The import paths from `start` that lead back to `start`, each as the chain
 * of files, through `importsOf`; every module is walked once. `[]` when none.
 */
function cyclesThrough(start: string, importsOf: (file: string) => readonly string[]): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const walk = (file: string, path: readonly string[]): void => {
    for (const next of importsOf(file)) {
      if (next === start) {
        cycles.push([...path, next]);
        continue;
      }
      if (visited.has(next)) continue;
      visited.add(next);
      walk(next, [...path, next]);
    }
  };

  walk(start, [start]);

  return cycles;
}

const graph = new Map<string, readonly string[]>();

function sourceImportsOf(file: string): readonly string[] {
  let imports = graph.get(file);

  if (imports === undefined) {
    imports = localSpecifiersOf(readFileSync(file, 'utf8'))
      .map((specifier) => resolveLocal(file, specifier))
      .filter((resolved): resolved is string => resolved !== null);
    graph.set(file, imports);
  }

  return imports;
}

const relative = (file: string): string => file.slice(webSrc.length);

describe('import cycles (Epic 11 retro A2, R2)', () => {
  it('no import path from calendar/utils/month.ts returns to it', () => {
    const cycles = cyclesThrough(MONTH, sourceImportsOf).map((cycle) => cycle.map(relative).join(' → '));

    expect(cycles).toEqual([]);
    // Non-vacuity: the walk reached what month.ts imports directly, and a
    // module only `calendar/services/snapshot.ts` imports — so it went beyond.
    const role = `${webSrc}features/navigation/services/role.ts`;

    expect(graph.size).toBeGreaterThan(5);
    expect(sourceImportsOf(MONTH).map(relative)).toContain('features/calendar/services/snapshot.ts');
    expect(sourceImportsOf(MONTH)).not.toContain(role);
    expect(sourceImportsOf(`${webSrc}features/calendar/services/snapshot.ts`)).toContain(role);
    expect(graph.has(role)).toBe(true);
  });

  it('the walk finds a cycle when there is one, and reads each kind of specifier that loads a module', () => {
    const fixture = new Map<string, readonly string[]>([
      ['a', ['b']],
      ['b', ['c', 'd']],
      ['c', ['a']],
      ['d', []],
    ]);
    const importsOf = (file: string): readonly string[] => fixture.get(file) ?? [];

    expect(cyclesThrough('a', importsOf)).toEqual([['a', 'b', 'c', 'a']]);
    expect(cyclesThrough('d', importsOf)).toEqual([]);

    const source = [
      "import { x } from '@/features/a/x';",
      "import type { Gone } from '@/features/a/type-only';",
      "export type { Erased } from '@/features/a/type-export';",
      "import { y, type Y } from '@/features/a/y';",
      "export { z } from '@/features/a/z';",
      "import '@/features/a/side';",
      "const lazy = () => import('@/features/a/lazy');",
      "// import { gone } from '@/features/a/commented';",
      "import { domain } from '@shift/domain';",
      "import { near } from './near';",
      "export * from '../far/away';",
      "import icon from '@/assets/icon.svg?raw';",
    ].join('\n');

    expect(localSpecifiersOf(source).sort()).toEqual(
      [
        '../far/away',
        './near',
        '@/assets/icon.svg?raw',
        '@/features/a/lazy',
        '@/features/a/side',
        '@/features/a/x',
        '@/features/a/y',
        '@/features/a/z',
      ].sort(),
    );
  });

  it('resolves @/ and relative specifiers, skips assets, and throws on one that resolves to nothing', () => {
    const snapshot = `${webSrc}features/calendar/services/snapshot.ts`;

    expect(resolveLocal(MONTH, '@/features/calendar/services/snapshot')).toBe(snapshot);
    expect(resolveLocal(MONTH, '../services/snapshot')).toBe(snapshot);
    expect(resolveLocal(MONTH, './modifiers')).toBe(`${webSrc}features/calendar/utils/modifiers.ts`);
    expect(resolveLocal(MONTH, '@/index.css')).toBeNull();
    expect(resolveLocal(MONTH, '@/assets/icon.svg?raw')).toBeNull();
    expect(resolveLocal(MONTH, './data.json')).toBeNull();
    expect(() => resolveLocal(MONTH, '@/features/calendar/services/missing')).toThrow(/resolves to no source file/);
    expect(() => resolveLocal(MONTH, './missing')).toThrow(/resolves to no source file/);
  });

  it('the old shape — month.ts importing the staffing service — would be a cycle', () => {
    const shortStaffed = `${webSrc}features/staffing/services/short-staffed.ts`;
    const withOldImport = (file: string): readonly string[] =>
      file === MONTH ? [...sourceImportsOf(MONTH), shortStaffed] : sourceImportsOf(file);

    expect(cyclesThrough(MONTH, withOldImport).length).toBeGreaterThan(0);
  });
});
