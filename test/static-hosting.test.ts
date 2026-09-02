import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AD-14 — a static SPA with no server. A deep link therefore cannot be routed
 * server-side, so the host must answer every unmatched path with index.html at
 * HTTP 200. A redirect status would break client-side routing instead of
 * fixing it, which is the failure this asserts against.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SPA_FALLBACK = /^\/\*\s+\/index\.html\s+(\d{3})\s*$/m;

describe('static host SPA fallback', () => {
  it('serves every client route from index.html with status 200', () => {
    const redirects = readFileSync(join(repoRoot, 'apps', 'web', 'public', '_redirects'), 'utf8');
    const match = SPA_FALLBACK.exec(redirects);

    expect(match, `_redirects has no SPA fallback rule:\n${redirects}`).not.toBeNull();
    expect(match?.[1]).toBe('200');
  });

  it('ships the fallback rule into the build output', () => {
    const built = join(repoRoot, 'apps', 'web', 'dist', '_redirects');

    // A clean checkout has not built yet; Vite copies public/ verbatim.
    if (!existsSync(built)) return;

    expect(SPA_FALLBACK.test(readFileSync(built, 'utf8'))).toBe(true);
  });

  it('emits no server runtime or SSR output alongside the bundle', () => {
    const dist = join(repoRoot, 'apps', 'web', 'dist');
    if (!existsSync(dist)) return;

    expect(existsSync(join(dist, 'index.html'))).toBe(true);
    for (const serverArtifact of ['server', 'functions', '_worker.js', 'entry-server.js']) {
      expect(existsSync(join(dist, serverArtifact))).toBe(false);
    }
  });
});
