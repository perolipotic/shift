// Points `[auth] site_url` and `[auth] additional_redirect_urls` at one
// environment's origins, in the RUNNER'S copy of `supabase/config.toml`, just
// before `supabase config push` (DEPLOY.md §5.2b). The committed file keeps its
// local values; a deploy job's checkout is thrown away with the runner.
//
//   node scripts/ci/set-auth-urls.mjs <origin>[,<origin>...] [config.toml]
//
// The origins are parsed by `origins.mjs` (https only). The first becomes
// `site_url`, where a recovery link returns to; all of them become
// `additional_redirect_urls`. Every other line is left byte for byte as it was,
// and the rewrite refuses rather than guesses when either key is not found
// exactly once, on one line, inside the top-level `[auth]` table.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeOrigins } from './origins.mjs';

/**
 * The line without a trailing `#` comment. Quote-aware, so a `#` or a `]`
 * inside a string survives and a `]` inside the comment is not counted.
 *
 * @param {string} line
 * @returns {string}
 */
export function stripComment(line) {
  /** @type {string | null} */
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

/**
 * `[` minus `]` outside strings, comment excluded: non-zero means the value
 * continues on the next line.
 *
 * @param {string} line
 * @returns {number}
 */
function bracketBalance(line) {
  let balance = 0;
  /** @type {string | null} */
  let quote = null;
  const code = stripComment(line);
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (quote !== null) {
      if (char === '\\' && quote === '"') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[') balance += 1;
    else if (char === ']') balance -= 1;
  }
  return balance;
}

/**
 * A table header, `[name]` or an array-of-tables `[[name]]`, as the section
 * name it opens (`[[x]]` → `[[x]]`, so it never equals `auth`); else null.
 *
 * @param {string} line
 * @returns {string | null}
 */
function sectionOf(line) {
  const code = stripComment(line).trim();
  const arrayTable = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(code);
  if (arrayTable !== null) return `[[${arrayTable[1] ?? ''}]]`;
  const table = /^\[\s*([^\]]+?)\s*\]$/.exec(code);
  return table === null ? null : (table[1] ?? '');
}

/**
 * Rewrites the two keys inside the top-level `[auth]` table only — `[auth.email]`
 * and every other table are separate sections and are not touched.
 *
 * @param {string} toml
 * @param {readonly string[]} origins
 * @returns {string}
 */
export function rewriteAuthUrls(toml, origins) {
  const [siteUrl] = origins;
  if (siteUrl === undefined) throw new Error('no origin given');

  /** @type {Record<string, number>} */
  const replaced = { site_url: 0, additional_redirect_urls: 0 };
  let section = '';

  const rewritten = toml.split('\n').map((line) => {
    const header = sectionOf(line);
    if (header !== null) {
      section = header;
      return line;
    }
    if (section !== 'auth') return line;

    const assignment = /^(\s*)(site_url|additional_redirect_urls)\s*=/.exec(line);
    if (assignment === null) return line;

    const [, indent = '', key = ''] = assignment;
    // A multi-line array would leave its continuation lines behind.
    if (bracketBalance(line) !== 0) {
      throw new Error(`[auth] ${key}: a multi-line value cannot be rewritten; keep it on one line`);
    }
    replaced[key] = (replaced[key] ?? 0) + 1;
    return key === 'site_url'
      ? `${indent}site_url = ${JSON.stringify(siteUrl)}`
      : `${indent}additional_redirect_urls = [${origins.map((origin) => JSON.stringify(origin)).join(', ')}]`;
  });

  for (const [key, count] of Object.entries(replaced)) {
    if (count !== 1) {
      throw new Error(`[auth] ${key}: expected exactly one single-line assignment, found ${String(count)}`);
    }
  }
  return rewritten.join('\n');
}

/** @param {readonly string[]} argv */
function main(argv) {
  const [list, file = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url))] = argv;
  if (list === undefined) {
    console.error('usage: node scripts/ci/set-auth-urls.mjs <origin>[,<origin>...] [config.toml]');
    process.exit(2);
  }

  const origins = normalizeOrigins(list);
  writeFileSync(file, rewriteAuthUrls(readFileSync(file, 'utf8'), origins));
  console.warn(`[auth] site_url = ${origins[0] ?? ''}; additional_redirect_urls = ${origins.join(', ')}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
