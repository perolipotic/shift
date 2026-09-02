import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-14 — a static SPA with no server. A deep link therefore cannot be routed
 * server-side, so the host must answer every unmatched path with index.html at
 * HTTP 200. A redirect status would break client-side routing instead of
 * fixing it, which is the failure this asserts against.
 *
 * The two build-output assertions need a build. They use `it.skipIf` rather
 * than an early `return`, so a clean checkout reports them as skipped instead
 * of reporting green having asserted nothing.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const dist = join(repoRoot, 'apps', 'web', 'dist');
const SPA_FALLBACK = /^\/\*\s+\/index\.html\s+(\d{3})\s*$/m;

const notBuilt = !existsSync(dist);

/**
 * Everything a static SPA build is allowed to emit.
 *
 * An allowlist, not a denylist: a denylist of known SSR artifact names passes
 * for any artifact named something else, which is precisely the case that
 * matters — the first framework or plugin to emit a server bundle will not be
 * one of the four names we thought to write down.
 */
const PERMITTED_DIST_ENTRIES = new Set([
  'index.html', // the SPA shell
  'assets', // hashed js/css/media
  '_redirects', // the Cloudflare Pages SPA fallback, copied from public/
]);

describe('static host SPA fallback', () => {
  it('serves every client route from index.html with status 200', () => {
    const redirects = readFileSync(join(repoRoot, 'apps', 'web', 'public', '_redirects'), 'utf8');
    const match = SPA_FALLBACK.exec(redirects);

    expect(match, `_redirects has no SPA fallback rule:\n${redirects}`).not.toBeNull();
    expect(match?.[1]).toBe('200');
  });

  it.skipIf(notBuilt)('ships the fallback rule into the build output', () => {
    // Vite copies public/ verbatim, so this catches a publicDir misconfiguration.
    const built = join(dist, '_redirects');

    expect(existsSync(built), `${built} is missing from the build output`).toBe(true);
    expect(SPA_FALLBACK.test(readFileSync(built, 'utf8'))).toBe(true);
  });

  it.skipIf(notBuilt)('emits nothing but the static shell, its assets and the fallback', () => {
    const emitted = readdirSync(dist).sort();

    expect(emitted).toContain('index.html');
    expect(emitted.filter((entry) => !PERMITTED_DIST_ENTRIES.has(entry))).toEqual([]);
  });
});
