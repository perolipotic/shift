import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The domain-purity guard itself.
 *
 * `packages/domain` declaring no `dependencies` only prevents anything when the
 * package manager refuses to link what the package did not ask for. That is
 * pnpm's isolated linker, and it is a one-line setting. Flip `.npmrc` to
 * `node-linker=hoisted` and `import 'react'` inside the domain resolves against
 * the root store, the build goes green, and the guard named in three separate
 * places is gone with nothing failing. So the setting is asserted, and so is
 * its effect on the installed tree.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** `.npmrc` as key/value pairs, with `#` comments removed. */
function npmrc(): Map<string, string> {
  const settings = new Map<string, string>();
  const source = readFileSync(join(repoRoot, '.npmrc'), 'utf8');
  for (const line of source.split('\n')) {
    // Comments matter here: this file's own comment names the forbidden values
    // in order to forbid them, so a scan that read comments would fail on the
    // documentation rather than on a real setting.
    const statement = line.split('#')[0]?.trim() ?? '';
    if (statement === '') continue;
    const separator = statement.indexOf('=');
    if (separator === -1) continue;
    // pnpm writes list settings as `key[]=value`; normalise so a guard on
    // `hoist-pattern` is not bypassed by writing `hoist-pattern[]`.
    const key = statement.slice(0, separator).trim().toLowerCase().replace(/\[\]$/, '');
    settings.set(key, statement.slice(separator + 1).trim());
  }
  return settings;
}

const domainModules = join(repoRoot, 'packages', 'domain', 'node_modules');
const notInstalled = !existsSync(domainModules);

describe('pnpm keeps packages isolated, which is what makes the domain pure', () => {
  it('pins the isolated linker', () => {
    expect(npmrc().get('node-linker')).toBe('isolated');
  });

  it('turns on nothing that would hoist a dependency into reach', () => {
    const settings = npmrc();

    expect(settings.get('shamefully-hoist')).not.toBe('true');
    expect(settings.get('node-linker')).not.toBe('hoisted');
    // `hoist-pattern` / `public-hoist-pattern` reach into the virtual store and
    // can republish an arbitrary package at the root, defeating the linker.
    expect(settings.has('hoist-pattern')).toBe(false);
    expect(settings.has('public-hoist-pattern')).toBe(false);
  });

  // The setting is the cause; this is the effect. Asserting only the setting
  // would miss an override arriving from a user-level or environment config.
  it.skipIf(notInstalled)('links nothing into the domain but what it declared', () => {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, 'packages', 'domain', 'package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> };

    const declared = new Set(Object.keys(manifest.devDependencies ?? {}));
    const linked = readdirSync(domainModules).filter((entry) => !entry.startsWith('.'));

    // Scoped packages appear as their scope directory, so `@types/node` links
    // as `@types`. Compare on that basis rather than inventing a flattening.
    const expected = new Set([...declared].map((name) => name.split('/')[0]));

    expect(linked.filter((entry) => !expected.has(entry)).sort()).toEqual([]);
    expect(existsSync(join(domainModules, 'react'))).toBe(false);
    expect(existsSync(join(domainModules, '@supabase'))).toBe(false);
  });
});
