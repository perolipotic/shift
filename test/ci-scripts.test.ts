import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { skippedTests } from '../scripts/ci/assert-no-skipped.mjs';
import { checkMigrations, parseMigrationList } from '../scripts/ci/check-migrations.mjs';
import { normalizeOrigins } from '../scripts/ci/origins.mjs';
import {
  describe as describeProblems,
  missing,
  parseRequirements,
  problems,
} from '../scripts/ci/require-config.mjs';
import { rewriteAuthUrls, stripComment } from '../scripts/ci/set-auth-urls.mjs';
import { LOCAL_APP_ORIGIN, renderEnvFiles } from '../scripts/ci/write-local-env.mjs';

/**
 * The pipeline's helpers (`scripts/ci/`). Each one guards a step whose failure
 * would otherwise be silent or would surface far from its cause: a
 * `config push` carrying the wrong redirect URLs, a deploy that starts with a
 * secret missing, a migration listing nobody actually read, a CI run that
 * skipped the DB-gated cases and reported green.
 *
 * Two layers per script: the exported functions, and the CLI entry point run
 * as the workflow runs it (a child `node` process), because an exit code or an
 * annotation that never reaches the runner is the failure that matters.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const configToml = readFileSync(join(repoRoot, 'supabase', 'config.toml'), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'shift-ci-scripts-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs one script the way the workflow does, with a controlled environment. */
function run(script: string, args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'ci', script), ...args], {
    encoding: 'utf8',
    // PATH only: nothing from the developer's shell leaks into the case.
    env: { PATH: process.env['PATH'] ?? '', ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function scratchFile(name: string, contents: string): string {
  const path = join(scratch, name);
  writeFileSync(path, contents);
  return path;
}

// ------------------------------------------------------------------- origins

describe('origins: the one parser for APP_ORIGINS', () => {
  const staging = 'https://staging.shift.pages.dev';
  const production = 'https://shift.pages.dev';

  it('trims around entries and keeps the order, primary first', () => {
    expect(normalizeOrigins(` ${staging} ,\t${production} `)).toEqual([staging, production]);
  });

  it('refuses empty entries, newlines, paths, trailing slashes and non-URLs', () => {
    expect(() => normalizeOrigins('')).toThrow(/no origin/);
    expect(() => normalizeOrigins(' ')).toThrow(/no origin/);
    expect(() => normalizeOrigins(`${staging},,${production}`)).toThrow(/entry 2 is empty/);
    expect(() => normalizeOrigins(`${staging},`)).toThrow(/entry 2 is empty/);
    expect(() => normalizeOrigins(`${staging}\n${production}`)).toThrow(/newline/);
    expect(() => normalizeOrigins(`${staging}/`)).toThrow(/bare origin/);
    expect(() => normalizeOrigins(`${staging}/prijava`)).toThrow(/bare origin/);
    expect(() => normalizeOrigins('staging.shift.pages.dev')).toThrow(/not a URL/);
    expect(() => normalizeOrigins('https://sta ging.pages.dev')).toThrow(/whitespace/);
  });

  it('requires https unless told the target is local', () => {
    expect(() => normalizeOrigins('http://shift.pages.dev')).toThrow(/must be https/);
    expect(normalizeOrigins(LOCAL_APP_ORIGIN, { allowHttp: true })).toEqual([LOCAL_APP_ORIGIN]);
    expect(() => normalizeOrigins('ftp://shift.pages.dev', { allowHttp: true })).toThrow(/http\(s\)/);
  });

  it('writes origins and app-origin to $GITHUB_OUTPUT from the CLI', () => {
    const output = scratchFile('github-output', '');
    const result = run('origins.mjs', [` ${production} , https://shift.example.hr `], { GITHUB_OUTPUT: output });

    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(
      `origins=${production},https://shift.example.hr\napp-origin=${production}\n`,
    );
  });

  it('fails from the CLI with an annotation on a bad list, and writes no output', () => {
    const output = scratchFile('github-output-bad', '');
    const result = run('origins.mjs', ['http://shift.pages.dev'], { GITHUB_OUTPUT: output });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error title=APP_ORIGINS::/);
    expect(readFileSync(output, 'utf8')).toBe('');
    expect(run('origins.mjs', []).status).toBe(2);
  });
});

// ------------------------------------------------------------- set-auth-urls

describe('set-auth-urls: the runner copy of config.toml', () => {
  const staging = 'https://staging.shift.pages.dev';
  const production = 'https://shift.pages.dev';

  it('rewrites [auth] site_url and additional_redirect_urls and nothing else', () => {
    const rewritten = rewriteAuthUrls(configToml, [staging]);

    const before = configToml.split('\n');
    const after = rewritten.split('\n');
    expect(after).toHaveLength(before.length);

    const changed = after.filter((line, index) => line !== before[index]);
    expect(changed).toEqual([`site_url = "${staging}"`, `additional_redirect_urls = ["${staging}"]`]);
  });

  it('makes the first origin the site URL and every origin a redirect URL', () => {
    const rewritten = rewriteAuthUrls(configToml, [production, 'https://shift.example.hr']);

    expect(rewritten).toContain(`site_url = "${production}"`);
    expect(rewritten).toContain(`additional_redirect_urls = ["${production}", "https://shift.example.hr"]`);
    expect(rewritten).not.toContain('127.0.0.1:5173');
  });

  it('leaves both enable_signup keys exactly as committed', () => {
    // The two switches DEPLOY.md §5.2a warns are not one switch; a rewrite that
    // touched either would change what `config push` does to signup.
    const signupLines = (text: string) => text.split('\n').filter((line) => line.startsWith('enable_signup'));
    expect(signupLines(rewriteAuthUrls(configToml, [staging]))).toEqual(signupLines(configToml));
  });

  it('refuses rather than guesses when a key is missing, repeated or multi-line', () => {
    expect(() => rewriteAuthUrls('[auth]\nsite_url = "x"\n', [staging])).toThrow(/additional_redirect_urls/);
    expect(() =>
      rewriteAuthUrls('[auth]\nsite_url = "x"\nsite_url = "y"\nadditional_redirect_urls = []\n', [staging]),
    ).toThrow(/site_url.*found 2/);
    expect(() =>
      rewriteAuthUrls('[auth]\nsite_url = "x"\nadditional_redirect_urls = [\n  "x",\n]\n', [staging]),
    ).toThrow(/multi-line/);
    // Outside `[auth]` the keys are not the ones meant.
    expect(() => rewriteAuthUrls('[studio]\nsite_url = "x"\nadditional_redirect_urls = []\n', [staging])).toThrow(
      /site_url/,
    );
  });

  it('does not count a ] inside a trailing comment as closing a multi-line array', () => {
    const toml = '[auth]\nsite_url = "x"\nadditional_redirect_urls = [ # local only]\n  "x",\n]\n';
    expect(() => rewriteAuthUrls(toml, [staging])).toThrow(/multi-line/);
  });

  it('keeps a # or ] inside a string, and drops a trailing comment on a single-line array', () => {
    expect(stripComment('a = "x#y" # note')).toBe('a = "x#y" ');
    expect(stripComment("a = ['x]'] # ]")).toBe("a = ['x]'] ");

    const toml = '[auth]\nsite_url = "x" # was local\nadditional_redirect_urls = ["x"] # local ]\n';
    expect(rewriteAuthUrls(toml, [staging])).toBe(
      `[auth]\nsite_url = "${staging}"\nadditional_redirect_urls = ["${staging}"]\n`,
    );
  });

  it('ends the [auth] table at an array-of-tables header', () => {
    const toml = [
      '[auth]',
      'site_url = "x"',
      'additional_redirect_urls = ["x"]',
      '[[auth.hook_list]]',
      'site_url = "must stay"',
      '',
    ].join('\n');

    const rewritten = rewriteAuthUrls(toml, [staging]);
    expect(rewritten).toContain('site_url = "must stay"');
    expect(rewritten).toContain(`site_url = "${staging}"`);
  });

  it('rewrites a file from the CLI and refuses a non-https origin', () => {
    const file = scratchFile('config.toml', configToml);

    expect(run('set-auth-urls.mjs', [staging, file]).status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(rewriteAuthUrls(configToml, [staging]));

    const refused = run('set-auth-urls.mjs', ['http://staging.shift.pages.dev', file]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/must be https/);
  });
});

// ------------------------------------------------------------ write-local-env

describe('write-local-env: the E2E env files from supabase status', () => {
  const status = {
    API_URL: 'http://127.0.0.1:54321',
    PUBLISHABLE_KEY: 'sb_publishable_local',
    SECRET_KEY: 'sb_secret_local',
  };

  it('writes the web pair and the function triple, with the local app origin', () => {
    const files = renderEnvFiles(status);

    expect(files.web).toBe(
      'VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_local\n',
    );
    expect(files.functions.split('\n')).toEqual([
      'SHIFT_SECRET_KEY=sb_secret_local',
      'SHIFT_PUBLISHABLE_KEY=sb_publishable_local',
      `SHIFT_ALLOWED_ORIGINS=${LOCAL_APP_ORIGIN}`,
      '',
    ]);
    expect(LOCAL_APP_ORIGIN).toBe('http://127.0.0.1:5173');
  });

  it('never puts the secret key into the web file (AD-17)', () => {
    expect(renderEnvFiles(status).web).not.toContain('sb_secret_');
  });

  it('refuses a status with a missing key, naming the key and not any value', () => {
    expect(() => renderEnvFiles({ ...status, SECRET_KEY: '' })).toThrow(/SECRET_KEY is missing/);
    expect(() => renderEnvFiles({ API_URL: status.API_URL })).toThrow(/PUBLISHABLE_KEY is missing/);
  });

  it('refuses keys of the wrong kind, so a swapped pair never reaches a bundle', () => {
    expect(() =>
      renderEnvFiles({ ...status, PUBLISHABLE_KEY: status.SECRET_KEY, SECRET_KEY: status.PUBLISHABLE_KEY }),
    ).toThrow(/PUBLISHABLE_KEY is not an sb_publishable_ key/);
    expect(() => renderEnvFiles({ ...status, API_URL: '127.0.0.1:54321' })).toThrow(/API_URL/);
  });

  it('keeps an existing file, and --force replaces it with mode 0600 even when it was wider', () => {
    const root = join(scratch, 'checkout');
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    mkdirSync(join(root, 'supabase', 'functions'), { recursive: true });
    const web = join(root, 'apps', 'web', '.env.local');
    const functions = join(root, 'supabase', 'functions', '.env');
    writeFileSync(web, 'KEEP=1\n', { mode: 0o644 });
    const statusFile = scratchFile('status.json', JSON.stringify(status));

    const kept = run('write-local-env.mjs', ['--status-file', statusFile, '--root', root]);
    expect(kept.status).toBe(0);
    expect(readFileSync(web, 'utf8')).toBe('KEEP=1\n');
    expect(statSync(functions).mode & 0o777).toBe(0o600);

    const forced = run('write-local-env.mjs', ['--force', '--status-file', statusFile, '--root', root]);
    expect(forced.status).toBe(0);
    expect(readFileSync(web, 'utf8')).toBe(renderEnvFiles(status).web);
    expect(statSync(web).mode & 0o777).toBe(0o600);
    // The log names files, never a value.
    expect(forced.stdout + forced.stderr).not.toContain('sb_secret_local');
  });
});

// ------------------------------------------------------------- require-config

describe('require-config: a deploy names what it is missing', () => {
  const requirements = parseRequirements(['secret:SUPABASE_ACCESS_TOKEN', 'var:SUPABASE_PROJECT_REF']);

  it('parses kind:NAME[:format] and refuses anything else', () => {
    expect(requirements).toEqual([
      { kind: 'secret', name: 'SUPABASE_ACCESS_TOKEN', format: null },
      { kind: 'var', name: 'SUPABASE_PROJECT_REF', format: null },
    ]);
    expect(parseRequirements(['var:SUPABASE_PUBLISHABLE_KEY:publishable'])).toEqual([
      { kind: 'var', name: 'SUPABASE_PUBLISHABLE_KEY', format: 'publishable' },
    ]);
    expect(() => parseRequirements(['SUPABASE_ACCESS_TOKEN'])).toThrow(/secret:NAME/);
    expect(() => parseRequirements(['env:X'])).toThrow(/secret:NAME/);
    expect(() => parseRequirements(['var:X:nonsense'])).toThrow(/unknown format/);
  });

  it('treats an absent and a whitespace-only value alike', () => {
    expect(missing(requirements, { SUPABASE_ACCESS_TOKEN: 'set', SUPABASE_PROJECT_REF: 'set' })).toEqual([]);
    expect(missing(requirements, { SUPABASE_ACCESS_TOKEN: '  ' })).toEqual(requirements);
  });

  it('refuses leading or trailing whitespace, which a dashboard paste leaves', () => {
    const found = problems(requirements, { SUPABASE_ACCESS_TOKEN: 'sbp_x\n', SUPABASE_PROJECT_REF: ' x' });
    expect(found.map(({ requirement, reason }) => `${requirement.name} ${reason}`)).toEqual([
      'SUPABASE_ACCESS_TOKEN has leading or trailing whitespace',
      'SUPABASE_PROJECT_REF has leading or trailing whitespace',
    ]);
  });

  it('checks the shape of a project ref, a publishable key and a secret key', () => {
    const typed = parseRequirements([
      'var:SUPABASE_PROJECT_REF:project-ref',
      'var:SUPABASE_PUBLISHABLE_KEY:publishable',
      'secret:SUPABASE_SECRET_KEY:secret',
    ]);
    const good = {
      SUPABASE_PROJECT_REF: 'abcdefghij0123456789',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      SUPABASE_SECRET_KEY: 'sb_secret_x',
    };
    expect(problems(typed, good)).toEqual([]);

    const reasons = problems(typed, {
      SUPABASE_PROJECT_REF: 'https://abcdefghij0123456789.supabase.co',
      // The swap AD-17 fears: a secret key in the slot that is inlined into the bundle.
      SUPABASE_PUBLISHABLE_KEY: good.SUPABASE_SECRET_KEY,
      SUPABASE_SECRET_KEY: good.SUPABASE_PUBLISHABLE_KEY,
    }).map(({ requirement, reason }) => `${requirement.name} ${reason}`);
    expect(reasons).toEqual([
      'SUPABASE_PROJECT_REF is not a Supabase project ref (20 lowercase letters and digits)',
      'SUPABASE_PUBLISHABLE_KEY is not a publishable key (sb_publishable_…)',
      'SUPABASE_SECRET_KEY is not a secret key (sb_secret_…)',
    ]);
  });

  it('names the item, its kind and the environment, and never a value', () => {
    const [line] = describeProblems([{ kind: 'secret', name: 'SUPABASE_DB_PASSWORD', format: null }], 'staging');

    expect(line).toMatch(/^::error title=Missing secret::SUPABASE_DB_PASSWORD is not set/);
    expect(line).toContain('"staging"');
  });

  it('exits non-zero from the CLI naming the unset item, and 0 when all are set', () => {
    const args = ['--environment', 'staging', 'secret:SUPABASE_ACCESS_TOKEN', 'var:SUPABASE_PROJECT_REF'];

    const failed = run('require-config.mjs', args, { SUPABASE_ACCESS_TOKEN: 'sbp_value_never_printed' });
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('::error title=Missing variable::SUPABASE_PROJECT_REF is not set');
    expect(failed.stdout).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(failed.stdout + failed.stderr).not.toContain('sbp_value_never_printed');

    const passed = run('require-config.mjs', args, {
      SUPABASE_ACCESS_TOKEN: 'sbp_x',
      SUPABASE_PROJECT_REF: 'abcdefghij0123456789',
    });
    expect(passed.status).toBe(0);
  });

  it('exits 2 when given nothing to check, or a malformed requirement', () => {
    expect(run('require-config.mjs', []).status).toBe(2);
    expect(run('require-config.mjs', ['--environment', 'staging']).status).toBe(2);
    expect(run('require-config.mjs', ['SUPABASE_ACCESS_TOKEN']).status).toBe(2);
  });
});

// ----------------------------------------------------------- check-migrations

describe('check-migrations: local and remote history must agree', () => {
  // Captured from `supabase migration list` (CLI 2.116.0): the JSON of
  // `--output-format json`, and the text table, which quotes versions in
  // backticks — which is exactly what a digits-only table scraper misses.
  const json = (rows: readonly (readonly [string, string])[]) =>
    JSON.stringify({
      migrations: rows.map(([local, remote]) => ({ local, remote, time: remote || local })),
      message: 'Migrations listed',
    });
  const table = [
    '   Local  | Remote | Time (UTC) ',
    '  --------|--------|------------',
    '   `0001` | `0001` | `0001`     ',
    '   `0002` | `0002` | `0002`     ',
    '   ` `    | `0003` | `0003`     ',
    '',
  ].join('\n');

  it('passes when every migration is on both sides', () => {
    const result = checkMigrations(parseMigrationList(json([['0001', '0001'], ['0002', '0002']])));
    expect(result).toMatchObject({ ok: true, drift: [] });
  });

  it('fails on a migration that is local only or remote only', () => {
    const localOnly = checkMigrations(parseMigrationList(json([['0001', '0001'], ['0002', '']])));
    expect(localOnly.ok).toBe(false);
    expect(localOnly.drift).toEqual([{ local: '0002', remote: '' }]);

    const remoteOnly = checkMigrations(parseMigrationList(json([['0001', '0001'], ['', '0002']])));
    expect(remoteOnly.drift).toEqual([{ local: '', remote: '0002' }]);
  });

  it('reads the backtick-quoted text table too', () => {
    const rows = parseMigrationList(table);
    expect(rows).toEqual([
      { local: '0001', remote: '0001' },
      { local: '0002', remote: '0002' },
      { local: '', remote: '0003' },
    ]);
    expect(checkMigrations(rows).ok).toBe(false);
  });

  it('fails when it recognises no migration row at all', () => {
    for (const input of ['', 'Connecting to remote database...', '{"migrations":[]}', '{"message":"x"}', '| a | b |']) {
      const result = checkMigrations(parseMigrationList(input));
      expect(result, JSON.stringify(input)).toMatchObject({ ok: false, message: /no migration rows/ });
    }
  });

  it('exits from the CLI: 0 agreeing, 1 with an annotation on drift or on nothing read', () => {
    expect(run('check-migrations.mjs', [scratchFile('agree.json', json([['0001', '0001']]))]).status).toBe(0);

    const drift = run('check-migrations.mjs', [scratchFile('drift.json', json([['0001', '']]))]);
    expect(drift.status).toBe(1);
    expect(drift.stdout).toMatch(/^::error title=Migration drift::/);

    expect(run('check-migrations.mjs', [scratchFile('empty.txt', '')]).status).toBe(1);
    expect(run('check-migrations.mjs', []).status).toBe(2);
  });
});

// --------------------------------------------------------- assert-no-skipped

describe('assert-no-skipped: a CI run that skipped is not green', () => {
  const report = (...statuses: string[]) => ({
    testResults: [
      {
        name: '/repo/test/static-hosting.test.ts',
        assertionResults: statuses.map((status, index) => ({ fullName: `case ${String(index)}`, status })),
      },
    ],
  });

  it('passes a run in which every test ran', () => {
    expect(skippedTests(report('passed', 'failed'), '/repo/')).toEqual({ total: 2, skipped: [] });
  });

  it('reports every status that means the body never ran', () => {
    const { skipped } = skippedTests(report('passed', 'skipped', 'pending', 'todo', 'disabled'), '/repo/');

    expect(skipped).toEqual([
      'test/static-hosting.test.ts › case 1 (skipped)',
      'test/static-hosting.test.ts › case 2 (pending)',
      'test/static-hosting.test.ts › case 3 (todo)',
      'test/static-hosting.test.ts › case 4 (disabled)',
    ]);
  });

  it('counts an empty report as nothing having run', () => {
    expect(skippedTests({})).toEqual({ total: 0, skipped: [] });
  });

  it('exits from the CLI: 0 when all ran, 1 with an annotation on a skip or on zero tests', () => {
    expect(run('assert-no-skipped.mjs', [scratchFile('ran.json', JSON.stringify(report('passed')))]).status).toBe(0);

    const skipped = run('assert-no-skipped.mjs', [scratchFile('skipped.json', JSON.stringify(report('passed', 'skipped')))]);
    expect(skipped.status).toBe(1);
    expect(skipped.stdout).toMatch(/^::error title=Skipped tests::1 of 2/);
    expect(skipped.stderr).toContain('case 1 (skipped)');

    const none = run('assert-no-skipped.mjs', [scratchFile('none.json', JSON.stringify({ testResults: [] }))]);
    expect(none.status).toBe(1);
    expect(none.stdout).toMatch(/^::error title=No tests ran::/);

    expect(run('assert-no-skipped.mjs', []).status).toBe(2);
  });
});
