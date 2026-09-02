import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-17 — the secret key exists in exactly one place: the admin-auth Edge
 * Function's per-environment env.
 *
 * The dist scan below only fires once something has been built, so the
 * load-bearing assertion is the source one: nothing in the client tree can
 * reference the secret at all, which is what makes a leak into the bundle
 * impossible rather than merely absent today.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The one directory permitted to name the secret key. */
const PRIVILEGED_DIRECTORY = join(repoRoot, 'supabase', 'functions');

/**
 * Strip comments before scanning. The invariant is that no *code* names the
 * secret key; prose that documents its absence — as `vite-env.d.ts` does — is
 * exactly what we want to keep writing, so matching it would punish the fix.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[\s;,{}()])\/\/[^\n]*/g, '$1')
    .replace(/(^|\s)--[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function collectFiles(directory: string, extensions: readonly string[]): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...collectFiles(absolute, extensions));
    } else if (extensions.some((extension) => entry.endsWith(extension))) {
      found.push(absolute);
    }
  }
  return found;
}

describe('secret key hygiene', () => {
  it('is named nowhere in the client tree', () => {
    const clientFiles = [
      ...collectFiles(join(repoRoot, 'apps'), ['.ts', '.tsx', '.js', '.html', '.css']),
      ...collectFiles(join(repoRoot, 'packages'), ['.ts', '.tsx']),
    ].filter((file) => !file.includes(`${join('apps', 'web', 'dist')}`));

    expect(clientFiles.length).toBeGreaterThan(0);

    const offences = clientFiles.filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'));
      return source.includes('sb_secret_') || source.includes('SHIFT_SECRET_KEY');
    });

    expect(offences.map((file) => file.slice(repoRoot.length))).toEqual([]);
  });

  it('is read only inside the privileged Edge Function', () => {
    const readers = collectFiles(join(repoRoot, 'supabase'), ['.ts']).filter((file) =>
      stripComments(readFileSync(file, 'utf8')).includes('SHIFT_SECRET_KEY'),
    );

    expect(readers.length).toBeGreaterThan(0);
    for (const reader of readers) {
      expect(reader.startsWith(PRIVILEGED_DIRECTORY)).toBe(true);
    }
  });

  it('exposes no build-time variable that could carry it', () => {
    // Vite inlines every VITE_* variable into the bundle. A secret reaching the
    // client would have to arrive through one, so none may be shaped like one.
    const example = readFileSync(join(repoRoot, 'apps', 'web', '.env.example'), 'utf8');
    const declared = [...example.matchAll(/^(VITE_[A-Z0-9_]+)=(.*)$/gm)];

    expect(declared.length).toBeGreaterThan(0);
    for (const [, name, value] of declared) {
      expect(name).not.toMatch(/SECRET/);
      expect(value ?? '').not.toContain('sb_secret_');
    }
  });

  it('still detects a secret that is actually referenced in code', () => {
    // Guards the scanner itself: comment-stripping that swallowed everything
    // would make every assertion above pass vacuously.
    expect(stripComments("const k = 'sb_secret_leak'; // note")).toContain('sb_secret_leak');
    expect(stripComments('/* sb_secret_prose */')).not.toContain('sb_secret_prose');
    expect(stripComments('// sb_secret_prose')).not.toContain('sb_secret_prose');
  });

  it('is absent from the built bundle', () => {
    const dist = join(repoRoot, 'apps', 'web', 'dist');
    const built = collectFiles(dist, ['.js', '.css', '.html', '.map']);

    // A clean checkout has not built yet; the gate builds before it tests, and
    // the source assertions above hold either way.
    if (built.length === 0) {
      expect(existsSync(dist)).toBe(false);
      return;
    }

    const offences = built.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return contents.includes('sb_secret_') || contents.includes('SHIFT_SECRET_KEY');
    });

    expect(offences.map((file) => file.slice(repoRoot.length))).toEqual([]);
  });
});
