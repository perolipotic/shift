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
  '_headers', // the Cloudflare Pages security headers, copied from public/
  'favicon.svg', // the tab icon `index.html` links, copied from public/
  'site.webmanifest', // the web manifest `index.html` links, copied from public/
]);

/**
 * The security headers every path must carry, as `name: value` pairs.
 *
 * NO CONTENT-SECURITY-POLICY, on purpose: its `connect-src` needs the deployed
 * Supabase origin, and a policy nothing can verify against a real host is one
 * that can silently break every request the SPA makes. The entry stays open in
 * `deferred-work.md` as "CSP pending a deployed origin to verify against".
 */
const SECURITY_HEADERS: Readonly<Record<string, RegExp>> = {
  'X-Content-Type-Options': /^nosniff$/,
  'Referrer-Policy': /^strict-origin-when-cross-origin$/,
  'X-Frame-Options': /^DENY$/,
  // RESTRICTIVE: every feature it names is switched off, and the powerful
  // ones the SPA never uses are named.
  'Permissions-Policy': /^(?=.*\bcamera=\(\))(?=.*\bmicrophone=\(\))(?=.*\bgeolocation=\(\))(?=.*\bpayment=\(\))(?=.*\busb=\(\))[a-z-]+=\(\)(, [a-z-]+=\(\))*$/,
};

/** The headers of the `/*` block in a `_headers` file, keyed by lowercase name. */
function headersForAllPaths(file: string): Map<string, string> {
  const headers = new Map<string, string>();
  let inAllPaths = false;

  for (const line of file.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === '/*';
      continue;
    }
    if (!inAllPaths) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  return headers;
}

/**
 * Every header line outside the `/*` block, and every `! Name` detach anywhere.
 *
 * Cloudflare Pages applies EVERY matching block, so a later `/app/*` block
 * that sets `X-Frame-Options: SAMEORIGIN`, or detaches it with
 * `! X-Frame-Options`, silently weakens the rule for those paths. Nothing may
 * touch a security header except the `/*` block.
 */
function securityOverrides(file: string): string[] {
  const guarded = new Set(Object.keys(SECURITY_HEADERS).map((name) => name.toLowerCase()));
  const found: string[] = [];
  let block = '';

  for (const line of file.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      block = line.trim();
      continue;
    }
    const entry = line.trim();
    const detached = entry.startsWith('!');
    const name = (detached ? entry.slice(1) : entry.split(':')[0] ?? '').trim().toLowerCase();

    if (detached || (block !== '/*' && guarded.has(name))) found.push(`${block}: ${entry}`);
  }

  return found;
}

function assertSecurityHeaders(file: string): void {
  const headers = headersForAllPaths(file);

  expect(securityOverrides(file), 'a block removes or overrides a security header').toEqual([]);

  for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
    const value = headers.get(name.toLowerCase());

    expect(value, `${name} is missing from the /* block`).toBeDefined();
    expect(value, `${name} has the wrong value`).toMatch(expected);
  }
}

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

  it('carries every security header on every path', () => {
    const file = join(repoRoot, 'apps', 'web', 'public', '_headers');

    expect(existsSync(file), `${file} is missing`).toBe(true);
    assertSecurityHeaders(readFileSync(file, 'utf8'));
  });

  it('catches a block that removes or overrides a security header', () => {
    const base = readFileSync(join(repoRoot, 'apps', 'web', 'public', '_headers'), 'utf8');

    expect(securityOverrides(base)).toEqual([]);
    expect(securityOverrides(`${base}\n/app/*\n  ! X-Frame-Options\n`)).toHaveLength(1);
    expect(securityOverrides(`${base}\n/app/*\n  X-Frame-Options: SAMEORIGIN\n`)).toHaveLength(1);
    expect(securityOverrides(`${base}\n/assets/*\n  Cache-Control: max-age=31536000\n`)).toEqual([]);
  });

  it.skipIf(notBuilt)('ships the security headers into the build output', () => {
    const built = join(dist, '_headers');

    expect(existsSync(built), `${built} is missing from the build output`).toBe(true);
    assertSecurityHeaders(readFileSync(built, 'utf8'));
  });

  it.skipIf(notBuilt)('emits nothing but the static shell, its assets and the fallback', () => {
    const emitted = readdirSync(dist).sort();

    expect(emitted).toContain('index.html');
    expect(emitted.filter((entry) => !PERMITTED_DIST_ENTRIES.has(entry))).toEqual([]);
  });
});
