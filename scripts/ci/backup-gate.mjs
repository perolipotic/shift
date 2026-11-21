// Story 20.6 (H-12): no production migration without a backup taken just
// before it.
//
//   supabase migration list --db-url … --output-format json > before.json
//   node scripts/ci/backup-gate.mjs --environment production before.json
//
// Reads the listing taken BEFORE `db push` and counts the pending migrations
// (local, not yet remote). With none pending, nothing changes the schema and
// the gate passes. With some pending in production, it passes only when
// `PRE_MIGRATION_BACKUP_AT` (the production Environment variable the operator
// sets after taking a backup in Coolify, DEPLOY.md §8.2) is a UTC timestamp no
// older than 24 hours and not in the future. Staging never needs one: it holds
// no personal data and is rebuilt from migrations (DEPLOY.md §5.4).
//
// This is the hook story 20.7 replaces with an automated backup. Exit codes:
// 0 pass, 1 refused, 2 usage error (including a listing with no migration).

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMigrationList } from './check-migrations.mjs';

/** How old a recorded backup may be when the migration runs. */
export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {readonly { local: string, remote: string }[]} rows
 * @returns {string[]} the versions present locally and not yet remotely
 */
export function pendingMigrations(rows) {
  return rows.filter(({ local, remote }) => local !== '' && remote === '').map(({ local }) => local);
}

/**
 * @param {{ environment: string, pending: readonly string[], backupAt: string | undefined, now: number }} input
 * @returns {{ ok: boolean, message: string }}
 */
export function backupGate({ environment, pending, backupAt, now }) {
  if (pending.length === 0) return { ok: true, message: 'no pending migration: no backup needed' };
  const what = `${String(pending.length)} pending migration(s) (${pending.join(', ')})`;
  if (environment !== 'production') return { ok: true, message: `${what}; ${environment} needs no pre-migration backup` };

  const how =
    'Take a backup of the production database in Coolify (DEPLOY.md §8.2), set the production ' +
    'Environment variable PRE_MIGRATION_BACKUP_AT to its UTC time (YYYY-MM-DDTHH:MMZ), then re-run this job.';
  const value = (backupAt ?? '').trim();
  if (value === '') return { ok: false, message: `${what} and PRE_MIGRATION_BACKUP_AT is not set. ${how}` };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    return { ok: false, message: `${what} and PRE_MIGRATION_BACKUP_AT is not a UTC timestamp. ${how}` };
  }
  const age = now - Date.parse(value);
  if (age < -5 * 60 * 1000) {
    return { ok: false, message: `${what} and PRE_MIGRATION_BACKUP_AT is in the future. ${how}` };
  }
  if (age > MAX_BACKUP_AGE_MS) {
    return { ok: false, message: `${what} and the backup recorded at ${value} is older than 24 hours. ${how}` };
  }
  return { ok: true, message: `${what}; backup recorded at ${value}` };
}

/** @param {readonly string[]} argv */
function main(argv) {
  const at = argv.indexOf('--environment');
  const environment = at === -1 ? undefined : argv[at + 1];
  const files = at === -1 ? argv : argv.filter((_, index) => index !== at && index !== at + 1);
  if (environment === undefined || files.length !== 1) {
    console.error('usage: node scripts/ci/backup-gate.mjs --environment <name> <migration-list-output>');
    process.exit(2);
  }

  const rows = parseMigrationList(readFileSync(files[0] ?? '', 'utf8'));
  if (rows.length === 0) {
    process.stdout.write('::error title=Backup gate::no migration rows recognised in the listing\n');
    process.exit(2);
  }
  const pending = pendingMigrations(rows);
  const result = backupGate({ environment, pending, backupAt: process.env['PRE_MIGRATION_BACKUP_AT'], now: Date.now() });

  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output !== '') appendFileSync(output, `pending=${String(pending.length)}\n`);
  if (result.ok) {
    console.warn(result.message);
    return;
  }
  process.stdout.write(`::error title=No backup before the migration::${result.message}\n`);
  process.exit(1);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
