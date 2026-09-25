// The one parser for an environment's `APP_ORIGINS` (DEPLOY.md §8.2).
//
//   node scripts/ci/origins.mjs [--allow-http] "<origin>[,<origin>...]"
//
// Prints, and appends to $GITHUB_OUTPUT when it is set:
//
//   origins=<normalized comma-separated list>
//   app-origin=<the first origin>
//
// Normalized means: whitespace around each entry removed, and each entry a bare
// origin exactly as `new URL(entry).origin` spells it. It refuses rather than
// repairs: an empty entry (`a,,b`, a trailing comma), a newline, a path, a
// trailing slash, and — unless `--allow-http` — anything that is not https.
// Hosted environments are https only; plain http exists for the local stack.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} list
 * @param {{ allowHttp?: boolean }} [options]
 * @returns {string[]}
 */
export function normalizeOrigins(list, options = {}) {
  if (/[\r\n]/.test(list)) throw new Error('origins: a newline is not allowed; separate origins with commas');

  const entries = list.split(',').map((entry) => entry.trim());
  if (entries.length === 1 && entries[0] === '') throw new Error('origins: no origin given');

  const protocols = options.allowHttp === true ? ['https:', 'http:'] : ['https:'];

  return entries.map((entry, index) => {
    if (entry === '') throw new Error(`origins: entry ${String(index + 1)} is empty (a doubled or trailing comma?)`);
    if (/\s/.test(entry)) throw new Error(`origins: whitespace inside an origin: ${entry}`);

    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(`origins: not a URL: ${entry}`);
    }
    if (!protocols.includes(parsed.protocol)) {
      throw new Error(`origins: ${entry} must be ${options.allowHttp === true ? 'http(s)' : 'https'}`);
    }
    if (parsed.origin !== entry) {
      throw new Error(`origins: not a bare origin (no path, no trailing slash): ${entry}`);
    }
    return entry;
  });
}

/** @param {readonly string[]} argv */
function main(argv) {
  const allowHttp = argv.includes('--allow-http');
  const lists = argv.filter((arg) => arg !== '--allow-http');
  if (lists.length !== 1) {
    console.error('usage: node scripts/ci/origins.mjs [--allow-http] "<origin>[,<origin>...]"');
    process.exit(2);
  }

  let origins;
  try {
    origins = normalizeOrigins(lists[0] ?? '', { allowHttp });
  } catch (error) {
    process.stdout.write(`::error title=APP_ORIGINS::${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  // Origins are public; printing them is how a wrong one gets noticed.
  const lines = [`origins=${origins.join(',')}`, `app-origin=${origins[0] ?? ''}`];
  for (const line of lines) process.stdout.write(`${line}\n`);
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output !== '') appendFileSync(output, `${lines.join('\n')}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
