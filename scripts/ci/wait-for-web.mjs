// Story 20.6: the deployed origin serves THIS build, with its headers.
//
//   node scripts/ci/wait-for-web.mjs <app origin> <dist> [<timeout seconds>]
//
// Coolify answers a deploy request at once and replaces the container later,
// so the deploy is not done when the API call returns. This polls
// `<origin>/` until its body is byte-for-byte the built `<dist>/index.html`
// (which names this build's hashed chunks and carries this build's inline
// script, so no other build matches it), then checks the live answer against
// the same build's `<dist>/_headers` `/*` block: every header present once,
// with its exact value, and `Cache-Control: no-cache` on the page. Traefik
// terminates TLS in front of the image, so this is where HSTS is first seen
// over HTTPS.
//
// Exit codes: 0 live and correct, 1 not live in time or a header wrong, 2
// usage error.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The `/*` block of a Cloudflare-style `_headers` file, as `[name, value]`
 * pairs, the way `scripts/ci/probe-web-image.sh` reads it.
 *
 * @param {string} text
 * @returns {[string, string][]}
 */
export function headersForAllPaths(text) {
  /** @type {[string, string][]} */
  const headers = [];
  let block = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    if (!/^[ \t]/.test(line)) {
      block = line.trim();
      continue;
    }
    if (block !== '/*') continue;
    const entry = line.trim();
    const at = entry.indexOf(':');
    if (at <= 0) continue;
    headers.push([entry.slice(0, at).trim(), entry.slice(at + 1).trim()]);
  }
  return headers;
}

/**
 * Every way the live answer differs from the build's headers.
 *
 * @param {readonly [string, string][]} expected
 * @param {Headers} actual
 * @returns {string[]}
 */
export function headerProblems(expected, actual) {
  /** @type {string[]} */
  const problems = [];
  // A name the block gives twice is expected the way Headers joins it, ", ";
  // Cache-Control is checked on its own below.
  /** @type {Map<string, string[]>} */
  const byName = new Map();
  for (const [name, value] of expected) {
    if (name.toLowerCase() === 'cache-control') continue;
    byName.set(name, [...(byName.get(name) ?? []), value]);
  }
  for (const [name, values] of byName) {
    const got = actual.get(name);
    const want = values.join(', ');
    if (got === null) problems.push(`${name} is missing`);
    // Headers joins a repeated header with ", ": a second copy shows here.
    else if (got !== want) problems.push(`${name} is not the build's value (got ${JSON.stringify(got.slice(0, 120))})`);
  }
  if (actual.get('cache-control') !== 'no-cache') problems.push('Cache-Control on / is not no-cache');
  return problems;
}

/**
 * @param {{ origin: string, indexHtml: string, expected: readonly [string, string][], timeoutMs: number,
 *   intervalMs?: number, fetch?: typeof globalThis.fetch, now?: () => number, wait?: (ms: number) => Promise<unknown> }} input
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function waitForBuild(input) {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const now = input.now ?? Date.now;
  const wait = input.wait ?? sleep;
  const deadline = now() + input.timeoutMs;
  let last;
  for (;;) {
    try {
      const response = await fetchImpl(`${input.origin}/`, {
        headers: { 'cache-control': 'no-cache' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      if (response.status === 200 && body === input.indexHtml) {
        const problems = headerProblems(input.expected, response.headers);
        if (problems.length === 0) {
          return { ok: true, message: `${input.origin} serves this build with its ${String(input.expected.length)} headers` };
        }
        // The old container may serve the same page with the old headers (a
        // release that changed only headers) until Coolify swaps it: keep
        // waiting, and report the difference if it never goes away.
        last = `this build's page, but: ${problems.join('; ')}`;
      } else {
        last = response.status === 200 ? 'HTTP 200 with another build' : `HTTP ${String(response.status)}`;
      }
    } catch (error) {
      last = `no answer (${error instanceof Error ? error.name : 'error'})`;
    }
    if (now() >= deadline) {
      return { ok: false, message: `${input.origin} did not serve this build in time; last: ${last}` };
    }
    await wait(input.intervalMs ?? 10_000);
  }
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const [origin = '', dist = '', seconds = '600'] = argv;
  if (argv.length < 2 || argv.length > 3 || !/^https:\/\/[^/]+$/.test(origin) || !/^[1-9][0-9]*$/.test(seconds)) {
    console.error('usage: node scripts/ci/wait-for-web.mjs <https origin> <dist> [<timeout seconds>]');
    process.exit(2);
  }
  const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');
  const expected = headersForAllPaths(readFileSync(join(dist, '_headers'), 'utf8'));
  if (expected.length === 0) {
    console.error(`wait-for-web: ${dist}/_headers has no /* block`);
    process.exit(2);
  }
  const result = await waitForBuild({ origin, indexHtml, expected, timeoutMs: Number(seconds) * 1000 });
  if (result.ok) {
    console.warn(result.message);
    return;
  }
  process.stdout.write(`::error title=shift-web not live::${result.message}\n`);
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
