// Fails when local and remote migration history disagree after `db push`
// (DEPLOY.md §5.2: "local vs remote, must agree").
//
//   pnpm exec supabase migration list --output-format json > list.json
//   node scripts/ci/check-migrations.mjs list.json
//
// Reads the CLI's JSON (`{"migrations":[{"local","remote","time"}]}`, Supabase
// CLI 2.116.0 `--output-format json`), and falls back to the text table
// (`  \`0001\` | \`0001\` | …`) when the input is not JSON. Either way it FAILS
// when it recognises no migration row at all: this repository always has
// migrations, so an empty or unparseable listing means the check read nothing,
// and passing on nothing is what the old table-scraping did.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{ local: string, remote: string }} MigrationRow
 */

const VERSION = /^\d+$/;

/**
 * @param {string} text
 * @returns {MigrationRow[]}
 */
export function parseMigrationList(text) {
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (json !== undefined) {
    const list =
      typeof json === 'object' && json !== null && 'migrations' in json ? json.migrations : undefined;
    if (!Array.isArray(list)) return [];
    return list
      .map((row) => ({
        local: typeof row?.local === 'string' ? row.local.trim() : '',
        remote: typeof row?.remote === 'string' ? row.remote.trim() : '',
      }))
      .filter(({ local, remote }) => VERSION.test(local) || VERSION.test(remote));
  }

  /** @type {MigrationRow[]} */
  const rows = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|');
    if (cells.length < 3) continue;
    const [local = '', remote = ''] = cells.map((cell) => cell.replace(/[`\s]/g, ''));
    if (VERSION.test(local) || VERSION.test(remote)) rows.push({ local, remote });
  }
  return rows;
}

/**
 * @param {readonly MigrationRow[]} rows
 * @returns {{ ok: boolean, message: string, drift: MigrationRow[] }}
 */
export function checkMigrations(rows) {
  if (rows.length === 0) {
    return { ok: false, message: 'no migration rows recognised in the listing', drift: [] };
  }
  const drift = rows.filter(({ local, remote }) => local !== remote);
  if (drift.length > 0) {
    return {
      ok: false,
      message: `${String(drift.length)} migration(s) differ between local and remote`,
      drift,
    };
  }
  return { ok: true, message: `${String(rows.length)} migrations, local and remote agree`, drift };
}

/** @param {readonly string[]} argv */
function main(argv) {
  const [file] = argv;
  if (file === undefined) {
    console.error('usage: node scripts/ci/check-migrations.mjs <migration-list-output>');
    process.exit(2);
  }

  const result = checkMigrations(parseMigrationList(readFileSync(file, 'utf8')));
  if (result.ok) {
    console.warn(result.message);
    return;
  }
  process.stdout.write(`::error title=Migration drift::${result.message}\n`);
  for (const { local, remote } of result.drift) {
    console.error(`  local=${local || '(none)'} remote=${remote || '(none)'}`);
  }
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
