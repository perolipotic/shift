// Writes the two local env files the E2E suite needs (`e2e/README.md`) from
// `supabase status -o json`:
//
//   apps/web/.env.local       VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
//   supabase/functions/.env   the function's keys and its allowed origin
//
// Both files are gitignored. Nothing is echoed: the keys go from the CLI's
// stdout straight into files created with mode 0600, and the log names the
// files only. An existing file is kept unless `--force` is passed, so running
// this in a developer checkout cannot silently replace keys someone set.
//
//   node scripts/ci/write-local-env.mjs [--force]
//
// For tests only: `--status-file <json>` reads the status from a file instead
// of running the CLI, and `--root <dir>` writes under another directory.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one origin the local admin-auth CORS admits (`playwright.config.ts`). */
export const LOCAL_APP_ORIGIN = 'http://127.0.0.1:5173';

/**
 * The two files' contents, from the parsed status JSON.
 *
 * @param {Record<string, unknown>} status
 * @returns {{ web: string, functions: string }}
 */
export function renderEnvFiles(status) {
  const apiUrl = required(status, 'API_URL');
  const publishable = required(status, 'PUBLISHABLE_KEY');
  const secret = required(status, 'SECRET_KEY');

  if (!/^https?:\/\//.test(apiUrl)) throw new Error('supabase status: API_URL is not an http(s) URL');
  if (!publishable.startsWith('sb_publishable_')) {
    throw new Error('supabase status: PUBLISHABLE_KEY is not an sb_publishable_ key');
  }
  if (!secret.startsWith('sb_secret_')) {
    throw new Error('supabase status: SECRET_KEY is not an sb_secret_ key');
  }

  return {
    web: [`VITE_SUPABASE_URL=${apiUrl}`, `VITE_SUPABASE_PUBLISHABLE_KEY=${publishable}`, ''].join('\n'),
    functions: [
      `SHIFT_SECRET_KEY=${secret}`,
      `SHIFT_PUBLISHABLE_KEY=${publishable}`,
      `SHIFT_ALLOWED_ORIGINS=${LOCAL_APP_ORIGIN}`,
      '',
    ].join('\n'),
  };
}

/**
 * @param {Record<string, unknown>} status
 * @param {string} key
 * @returns {string}
 */
function required(status, key) {
  const value = status[key];
  if (typeof value !== 'string' || value.trim() === '') {
    // The key name only: the value, when there is one, is a credential.
    throw new Error(`supabase status: ${key} is missing — is the local stack running (\`supabase start\`)?`);
  }
  return value.trim();
}

/** @param {readonly string[]} argv */
function main(argv) {
  const force = argv.includes('--force');
  const option = (/** @type {string} */ name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const root = option('--root') ?? repoRoot;
  const statusFile = option('--status-file');

  const raw =
    statusFile === undefined
      ? execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
        })
      : readFileSync(statusFile, 'utf8');
  const files = renderEnvFiles(JSON.parse(raw));

  const targets = [
    { path: join(root, 'apps', 'web', '.env.local'), contents: files.web },
    { path: join(root, 'supabase', 'functions', '.env'), contents: files.functions },
  ];

  for (const { path, contents } of targets) {
    if (existsSync(path) && !force) {
      console.warn(`kept ${path} (exists; pass --force to replace it)`);
      continue;
    }
    writeFileSync(path, contents, { mode: 0o600 });
    // `mode` applies only when the file is CREATED; a `--force` over an
    // existing, wider file would otherwise keep its old permissions.
    chmodSync(path, 0o600);
    console.warn(`wrote ${path}`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
