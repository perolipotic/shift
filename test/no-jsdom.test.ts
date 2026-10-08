import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-15's gate, in a form that can fail: jsdom is not in the install graph.
 *
 * The earlier check, `pnpm ls --recursive jsdom || echo NO-JSDOM`, exits 0
 * whether or not it matches, so the `||` never fires and it passes identically
 * with jsdom present or absent (and `pnpm ls` stops at depth 0 by default, so a
 * transitive install escapes it as well). This reads `pnpm-lock.yaml` instead:
 * it needs no build, no install and no `pnpm ls`.
 *
 * Three places can put jsdom on disk, and each is checked:
 *
 *   - `importers`: a workspace package depends on it directly.
 *   - `packages`: a `jsdom@x` entry exists, which means something resolved it.
 *   - `snapshots`: a `jsdom@x` entry exists, or any snapshot lists `jsdom`
 *     under `dependencies` / `optionalDependencies` — the transitive route.
 *
 * What stays allowed is vitest's `peerDependencies: jsdom: '*'` (optional, so
 * pnpm does not install it) and `transitivePeerDependencies` lists, which
 * only record that a peer went unmet. Neither installs anything.
 *
 * The lockfile is a regular, machine-written, two-space-indented document, so
 * it is scanned by line rather than parsed: the repository has no YAML parser
 * and a new dependency for one test would itself be a lockfile change.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN = 'jsdom';

/** `jsdom` or `'jsdom'` as a mapping key, with whatever follows the colon. */
const KEY = /^(\s*)'?(jsdom)(@[^':]*)?'?:(.*)$/;

/**
 * Every place a lockfile's text installs jsdom, as `line N: <what>` strings.
 * Empty means the invariant holds.
 */
function jsdomInstallSites(lockfile: string): string[] {
  const sites: string[] = [];
  let section = '';
  let block = '';

  lockfile.split('\n').forEach((line, index) => {
    const indent = /^ */.exec(line)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) return;
    if (indent === 0) {
      section = trimmed.replace(/:$/, '');
      block = '';

      return;
    }

    const match = KEY.exec(line);
    const at = `line ${index + 1}`;

    if (section === 'importers') {
      // Any `jsdom:` key in an importer is a dependency declaration, in whichever
      // of dependencies / devDependencies / optionalDependencies it sits.
      if (match) sites.push(`${at}: an importer declares ${FORBIDDEN}`);

      return;
    }

    if (section !== 'packages' && section !== 'snapshots') return;

    if (indent === 2) {
      block = trimmed;
      // A `jsdom@x` entry. A bare `jsdom:` here is not a lockfile shape.
      if (match?.[3] !== undefined) sites.push(`${at}: ${section} entry ${trimmed}`);

      return;
    }

    if (section === 'snapshots' && indent === 6 && match) {
      // Under a snapshot's `dependencies` / `optionalDependencies`, one key per
      // resolved dependency. `transitivePeerDependencies` items are `- name`
      // lines, not keys, and do not match.
      sites.push(`${at}: snapshot ${block} depends on ${FORBIDDEN}`);
    }
  });

  return sites;
}

/** A minimal lockfile in the real one's shape, with jsdom absent. */
const CLEAN = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      vitest:
        specifier: 4.1.11
        version: 4.1.11(jsdom@29.0.0)

packages:

  vitest@4.1.11:
    peerDependencies:
      jsdom: '*'
    peerDependenciesMeta:
      jsdom:
        optional: true

snapshots:

  vitest@4.1.11:
    dependencies:
      tinyexec: 1.0.0
    transitivePeerDependencies:
      - jsdom

  tinyexec@1.0.0: {}
`;

describe('AD-15: jsdom is absent from the install graph', () => {
  it('pnpm-lock.yaml installs jsdom nowhere', () => {
    const lockfile = readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');

    // Non-vacuous: the file was read and has the three sections this scans.
    expect(lockfile).toContain('\nimporters:');
    expect(lockfile).toContain('\npackages:');
    expect(lockfile).toContain('\nsnapshots:');

    expect(
      jsdomInstallSites(lockfile),
      'jsdom is in the lockfile — AD-15 bans a DOM environment; assert in the node suite instead',
    ).toEqual([]);
  });

  // The proof the gate can fail: each way jsdom can arrive, applied to a copy.
  describe('the scan itself', () => {
    it('accepts optional peer declarations and unmet-peer lists', () => {
      expect(jsdomInstallSites(CLEAN)).toEqual([]);
    });

    it('catches a direct importer dependency', () => {
      const mutated = CLEAN.replace(
        '    devDependencies:\n',
        "    devDependencies:\n      jsdom:\n        specifier: 29.0.0\n        version: 29.0.0\n",
      );

      expect(jsdomInstallSites(mutated)).toHaveLength(1);
    });

    it('catches a resolved package entry, quoted or not', () => {
      expect(jsdomInstallSites(CLEAN.replace('packages:', "packages:\n\n  'jsdom@29.0.0':\n    resolution: {}"))).toHaveLength(1);
      expect(jsdomInstallSites(CLEAN.replace('snapshots:', 'snapshots:\n\n  jsdom@29.0.0(x@1.0.0): {}'))).toHaveLength(1);
    });

    it('catches a transitive dependency on it, which `pnpm ls` at depth 0 misses', () => {
      const mutated = CLEAN.replace(
        '      tinyexec: 1.0.0\n',
        '      tinyexec: 1.0.0\n      jsdom: 29.0.0\n',
      );

      expect(jsdomInstallSites(mutated)).toEqual([expect.stringContaining('depends on jsdom')]);
    });

    it('catches the optional-dependency route and quoted keys', () => {
      const mutated = CLEAN.replace(
        '    transitivePeerDependencies:',
        "    optionalDependencies:\n      'jsdom': 29.0.0\n    transitivePeerDependencies:",
      );

      expect(jsdomInstallSites(mutated)).toHaveLength(1);
    });
  });
});
