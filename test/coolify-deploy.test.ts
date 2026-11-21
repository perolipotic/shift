import { spawn, spawnSync } from 'node:child_process';
import { createECDH, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { backupGate, MAX_BACKUP_AGE_MS, pendingMigrations } from '../scripts/ci/backup-gate.mjs';
import { checkBundle, findSecrets, jwtRole } from '../scripts/ci/check-bundle.mjs';
import { deployApplication, messageOf, restartService } from '../scripts/ci/coolify.mjs';
import { parseRequirements, problems } from '../scripts/ci/require-config.mjs';
import { headerProblems, headersForAllPaths, waitForBuild } from '../scripts/ci/wait-for-web.mjs';

/**
 * Story 20.6: the pipeline deploys through Coolify. Every helper the deploy
 * action calls, against fakes (no registry, no Coolify, no network, no
 * container: a stand-in `docker` on PATH answers `registry.sh`), and the
 * workflow's shape: who holds a secret, who may push, and in what order the
 * action does its remote steps. DB-free.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'shift-coolify-deploy-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function run(command: string, args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const node = (script: string, args: readonly string[], env: Record<string, string> = {}) =>
  run(process.execPath, [join(repoRoot, 'scripts', 'ci', script), ...args], env);

const repeat = (character: string, times: number): string => character.repeat(times);
/** A shape-valid fake, built at run time so no committed file holds a key-shaped literal. */
const fakeSecretKey = `sb_secret_${repeat('k', 40)}`;
const fakeResendKey = `re_${repeat('a', 8)}_${repeat('B', 24)}`;
const jwt = (claims: Record<string, unknown>): string =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    repeat('s', 43),
  ].join('.');

/** A P-256 pair whose private key is a full 32 bytes (Node drops leading zero bytes). */
function vapidPair(): ReturnType<typeof createECDH> {
  for (;;) {
    const pair = createECDH('prime256v1');
    pair.generateKeys();
    if (pair.getPrivateKey().length === 32) return pair;
  }
}

// ------------------------------------------------------------- require-config

describe('require-config: the self-hosted configuration set (story 20.6)', () => {
  const typed = parseRequirements([
    'var:SUPABASE_API_URL:https-origin',
    'var:DB_HOST:tailnet-host',
    'var:DB_PORT:port',
    'var:COOLIFY_API_URL:tailnet-url',
    'var:COOLIFY_WEB_UUID:coolify-uuid',
    'secret:COOLIFY_API_TOKEN:coolify-token',
    'secret:TS_OAUTH_SECRET:ts-oauth-secret',
  ]);
  const good = {
    SUPABASE_API_URL: 'https://api.example.org',
    DB_HOST: 'host-name.example.ts.net',
    DB_PORT: '5432',
    COOLIFY_API_URL: 'http://host-name.example.ts.net:8000',
    COOLIFY_WEB_UUID: 'abcdefgh0123456789xyzabc',
    COOLIFY_API_TOKEN: `7|${repeat('t', 48)}`,
    TS_OAUTH_SECRET: `tskey-client-${repeat('c', 20)}-${repeat('d', 20)}`,
  };
  const reasons = (env: Record<string, string>): string[] =>
    problems(typed, env).map(({ requirement, reason }) => `${requirement.name} ${reason}`);

  it('accepts the shapes it should', () => {
    expect(reasons(good)).toEqual([]);
    expect(reasons({ ...good, COOLIFY_API_URL: 'https://host-name.example.ts.net', DB_HOST: '100.101.102.103' })).toEqual([]);
  });

  it('refuses the slips a paste makes, naming each item and never its value', () => {
    const found = reasons({
      SUPABASE_API_URL: 'https://api.example.org/',
      DB_HOST: 'postgresql://postgres@host:5432',
      DB_PORT: '65536',
      // A public http address: the API is reached over the tailnet only.
      COOLIFY_API_URL: 'http://coolify.example.org:8000',
      COOLIFY_WEB_UUID: 'Not-A-Uuid',
      COOLIFY_API_TOKEN: repeat('t', 48),
      TS_OAUTH_SECRET: 'tskey-auth-xyz',
    });
    expect(found.map((line) => line.split(' ')[0])).toEqual([
      'SUPABASE_API_URL',
      'DB_HOST',
      'DB_PORT',
      'COOLIFY_API_URL',
      'COOLIFY_WEB_UUID',
      'COOLIFY_API_TOKEN',
      'TS_OAUTH_SECRET',
    ]);
    expect(found.join('\n')).not.toContain(repeat('t', 48));
    // The superuser password goes to DB_HOST: a public name is refused, and
    // so is any host but a tailnet one for Coolify's token, over https too.
    // A bare label is refused too: the runner's own search domain could
    // answer it if MagicDNS does not. So is an address outside 100.64.0.0/10
    // or with an octet above 255.
    for (const host of ['db.example.org', 'localhost', 'Host-Name', 'host-name', 'ts.net', '100.64.999.1', '100.128.0.1']) {
      expect(reasons({ ...good, DB_HOST: host }), host).toHaveLength(1);
    }
    expect(reasons({ ...good, COOLIFY_API_URL: 'https://coolify.example.org' })).toHaveLength(1);
    expect(reasons({ ...good, COOLIFY_API_URL: 'http://localhost:8000' })).toHaveLength(1);
    expect(reasons({ ...good, COOLIFY_API_URL: 'http://host-name:8000' })).toHaveLength(1);
    expect(reasons({ ...good, SUPABASE_API_URL: 'http://api.example.org' })).toHaveLength(1);
    expect(reasons({ ...good, DB_PORT: '0' })).toHaveLength(1);
  });
});

// --------------------------------------------------------------- check-bundle

describe('check-bundle: the bundle carries no secret-shaped value', () => {
  const pair = vapidPair();
  const publicKey = pair.getPublicKey('base64url');
  const privateKey = pair.getPrivateKey('base64url');

  it('passes a bundle with only public values: the publishable key, an anon JWT, the VAPID public key', () => {
    const text = `const a="sb_publishable_${repeat('p', 40)}";const b="${jwt({ role: 'anon' })}";const c="${publicKey}";`;
    expect(findSecrets(text, publicKey)).toEqual([]);
    // A quoted 43-character token that is not this key's private half is no finding.
    expect(findSecrets(`"${repeat('Q', 43)}"`, publicKey)).toEqual([]);
    expect(findSecrets(`"${repeat('Q', 43)}"`, '')).toEqual([]);
  });

  it('refuses each kind of secret, by kind and never by value', () => {
    expect(findSecrets(`x="${fakeSecretKey}"`)).toEqual(['an sb_secret_ key']);
    expect(findSecrets(`x="${fakeResendKey}"`)).toEqual(['a Resend API key']);
    expect(findSecrets(`x="${jwt({ role: 'service_role' })}"`)).toEqual([
      'a JWT whose role is "service_role", not "anon"',
    ]);
    // A JWT-shaped string with no role (a library's example) is no key of ours.
    expect(findSecrets(`x="${jwt({ sub: 'u' })}"`)).toEqual([]);
    const vapid = ['the VAPID private key of this environment'];
    expect(findSecrets(`x='${privateKey}'`, publicKey)).toEqual(vapid);
    // Unquoted, and as padded standard base64: found all the same.
    expect(findSecrets(`k:${privateKey},`, publicKey)).toEqual(vapid);
    expect(findSecrets(`k=${pair.getPrivateKey('base64')};`, publicKey)).toEqual(vapid);
    // Inside a longer run it is not a key on its own.
    expect(findSecrets(`"${privateKey}x"`, publicKey)).toEqual([]);
    expect(jwtRole('not json')).toBeNull();
  });

  it('scans every file under the dist from the CLI, and refuses to check nothing', () => {
    const dist = join(scratch, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(join(dist, 'assets', 'index-abc.js'), `const k="${publicKey}";`);
    expect(node('check-bundle.mjs', [dist, publicKey]).status).toBe(0);

    writeFileSync(join(dist, 'assets', 'leak-abc.js'), `const s="${fakeSecretKey}";`);
    const failed = node('check-bundle.mjs', [dist, publicKey]);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain('::error title=Secret in bundle::assets/leak-abc.js: an sb_secret_ key');
    expect(failed.stdout + failed.stderr).not.toContain(fakeSecretKey);
    expect(checkBundle(dist, publicKey)).toEqual(['assets/leak-abc.js: an sb_secret_ key']);

    const empty = join(scratch, 'empty-dist');
    mkdirSync(empty);
    expect(node('check-bundle.mjs', [empty]).status).toBe(2);
    expect(node('check-bundle.mjs', []).status).toBe(2);
  });
});

// ---------------------------------------------------------------- backup-gate

describe('backup-gate: no production migration without a backup (H-12)', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const rows = [
    { local: '0064', remote: '0064' },
    { local: '0065', remote: '' },
    { local: '0066', remote: '' },
  ];

  it('counts the pending migrations: local, not yet remote', () => {
    expect(pendingMigrations(rows)).toEqual(['0065', '0066']);
    expect(pendingMigrations([{ local: '', remote: '0099' }])).toEqual([]);
  });

  it('passes with nothing pending, and in staging whatever is pending', () => {
    expect(backupGate({ environment: 'production', pending: [], backupAt: undefined, now }).ok).toBe(true);
    expect(backupGate({ environment: 'staging', pending: ['0065'], backupAt: undefined, now }).ok).toBe(true);
  });

  it('refuses production with pending migrations and no, a malformed, a future or an old backup time', () => {
    const gate = (backupAt: string | undefined) =>
      backupGate({ environment: 'production', pending: ['0065'], backupAt, now });
    expect(gate(undefined).message).toMatch(/PRE_MIGRATION_BACKUP_AT is not set/);
    expect(gate('yesterday').message).toMatch(/not a UTC timestamp/);
    expect(gate('2026-11-21T13:00Z').message).toMatch(/in the future/);
    expect(gate(new Date(now - MAX_BACKUP_AGE_MS - 60_000).toISOString().replace(/\.\d+Z$/, 'Z')).message).toMatch(
      /older than 24 hours/,
    );
    for (const value of [undefined, 'yesterday', '2026-11-21T13:00Z']) expect(gate(value).ok).toBe(false);
    expect(gate('2026-11-21T11:40Z')).toEqual({
      ok: true,
      message: '1 pending migration(s) (0065); backup recorded at 2026-11-21T11:40Z',
    });
  });

  it('runs from the CLI on a migration listing, with the backup time from the environment', () => {
    const listing = join(scratch, 'before.json');
    writeFileSync(
      listing,
      JSON.stringify({ migrations: rows.map(({ local, remote }) => ({ local, remote, time: '' })) }),
    );
    const refused = node('backup-gate.mjs', ['--environment', 'production', listing]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toMatch(/^::error title=No backup before the migration::2 pending migration/);

    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    expect(node('backup-gate.mjs', ['--environment', 'production', listing], { PRE_MIGRATION_BACKUP_AT: recent }).status).toBe(0);
    expect(node('backup-gate.mjs', ['--environment', 'staging', listing]).status).toBe(0);

    writeFileSync(join(scratch, 'nothing.json'), '{"migrations":[]}');
    expect(node('backup-gate.mjs', ['--environment', 'production', join(scratch, 'nothing.json')]).status).toBe(2);
    expect(node('backup-gate.mjs', [listing]).status).toBe(2);
  });
});

// -------------------------------------------------------------------- coolify

describe('coolify: two calls, with a deploy-only token (H-9)', () => {
  const token = `7|${repeat('t', 48)}`;
  type Call = { url: string; method: string; headers: Record<string, string> };

  function fakeFetch(status: number, body: unknown) {
    const calls: Call[] = [];
    const fetch = (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify(body)) });
    };
    return { calls, client: { apiUrl: 'http://coolify-host:8000/', token, fetch } };
  }

  it('queues the web application’s deployment and returns its id', async () => {
    const uuid = 'webapp0123456789abcdefgh';
    const { calls, client } = fakeFetch(200, {
      deployments: [{ message: 'queued', resource_uuid: uuid, deployment_uuid: 'dep0123456789' }],
    });

    await expect(deployApplication(client, uuid)).resolves.toBe('dep0123456789');
    expect(calls).toEqual([
      {
        url: `http://coolify-host:8000/api/v1/deploy?uuid=${uuid}&force=false`,
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      },
    ]);
  });

  it('fails when Coolify queued nothing, or refused, naming the status and never the token', async () => {
    const uuid = 'webapp0123456789abcdefgh';
    const nothing = fakeFetch(200, { deployments: [{ message: 'Unauthorized to deploy this application.', resource_uuid: uuid }] });
    await expect(deployApplication(nothing.client, uuid)).rejects.toThrow(/queued no deployment.*Unauthorized/);

    const refused = fakeFetch(401, { message: `Unauthenticated ${token}` });
    const error = await deployApplication(refused.client, uuid).catch((caught: unknown) => caught);
    expect(String(error)).toMatch(/HTTP 401 Unauthenticated \[token\]/);
    expect(String(error)).not.toContain(token);

    await expect(deployApplication(nothing.client, 'bad uuid')).rejects.toThrow(/not a Coolify resource uuid/);
    expect(messageOf({ message: 'a\nb' }, token)).toBe('a b');
  });

  it('restarts the stack with its images pulled again', async () => {
    const uuid = 'stack0123456789abcdefghi';
    const { calls, client } = fakeFetch(200, { message: 'Service restarting request queued.' });

    await expect(restartService(client, uuid)).resolves.toBe('Service restarting request queued.');
    expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual([
      `POST http://coolify-host:8000/api/v1/services/${uuid}/restart?latest=true`,
    ]);

    // A 2xx that queued nothing is a failure, not ten minutes of waiting.
    const refused = fakeFetch(200, { message: 'Service not found.' });
    await expect(restartService(refused.client, uuid)).rejects.toThrow(/queued no restart.*Service not found/);
  });

  it('refuses to run from the CLI without its configuration', () => {
    expect(node('coolify.mjs', ['deploy-application', 'abcdefgh']).status).toBe(2);
    expect(node('coolify.mjs', ['delete', 'abcdefgh'], { COOLIFY_API_URL: 'http://x:1', COOLIFY_API_TOKEN: token }).status).toBe(2);
  });
});

// --------------------------------------------------------------- wait-for-web

describe('wait-for-web: the origin serves this build, with its headers', () => {
  const headersFile = [
    '# comment',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    "  Content-Security-Policy-Report-Only: default-src 'self'",
    '/assets/*',
    '  Cache-Control: public',
  ].join('\n');
  const expected = headersForAllPaths(headersFile);
  const page = '<!doctype html><script type="module" src="/assets/index-new.js"></script>';
  const good = new Headers([...expected, ['cache-control', 'no-cache']]);

  it('reads the /* block only', () => {
    expect(expected).toEqual([
      ['X-Content-Type-Options', 'nosniff'],
      ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
      ['Content-Security-Policy-Report-Only', "default-src 'self'"],
    ]);
  });

  it('expects a header the block names twice as one joined value, and leaves Cache-Control to its own rule', () => {
    const twice = headersForAllPaths('/*\n  Link: <a>\n  Link: <b>\n  Cache-Control: max-age=5\n');
    expect(headerProblems(twice, new Headers([['Link', '<a>'], ['Link', '<b>'], ['cache-control', 'no-cache']]))).toEqual([]);
  });

  it('names a missing, a changed or a doubled header, and a cached page', () => {
    expect(headerProblems(expected, good)).toEqual([]);
    const bad = new Headers([
      ['X-Content-Type-Options', 'nosniff'],
      ['X-Content-Type-Options', 'nosniff'],
      ['Content-Security-Policy-Report-Only', "default-src *"],
      ['cache-control', 'max-age=60'],
    ]);
    expect(headerProblems(expected, bad).map((problem) => problem.split(' ')[0])).toEqual([
      'X-Content-Type-Options',
      'Strict-Transport-Security',
      'Content-Security-Policy-Report-Only',
      'Cache-Control',
    ]);
  });

  /** Answers the old page until the third request, then the new one. */
  function rolling(newHeaders: Headers) {
    let requests = 0;
    let clock = 0;
    const fetch = () => {
      requests += 1;
      const body = requests < 3 ? '<!doctype html>old' : page;
      return Promise.resolve(new Response(body, { status: 200, headers: requests < 3 ? good : newHeaders }));
    };
    return {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock,
      wait: (ms: number) => {
        clock += ms;
        return Promise.resolve();
      },
      requests: () => requests,
    };
  }

  it('waits through the old build, then passes on this one', async () => {
    const fake = rolling(good);
    const result = await waitForBuild({ origin: 'https://app.example.org', indexHtml: page, expected, timeoutMs: 60_000, ...fake });
    expect(result).toEqual({ ok: true, message: 'https://app.example.org serves this build with its 3 headers' });
    expect(fake.requests()).toBe(3);
  });

  it('fails when this build is live with a wrong header, or never goes live', async () => {
    const wrong = await waitForBuild({
      origin: 'https://app.example.org',
      indexHtml: page,
      expected,
      timeoutMs: 60_000,
      ...rolling(new Headers([['cache-control', 'no-cache']])),
    });
    // Waited out (the old container may still be the one answering), then named.
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toMatch(/in time; last: this build's page, but: X-Content-Type-Options is missing/);

    const never = await waitForBuild({
      origin: 'https://app.example.org',
      indexHtml: 'a page no fake serves',
      expected,
      timeoutMs: 15_000,
      ...rolling(good),
    });
    expect(never).toEqual({
      ok: false,
      message: 'https://app.example.org did not serve this build in time; last: HTTP 200 with another build',
    });
  });

  it('refuses a non-https origin from the CLI', () => {
    expect(node('wait-for-web.mjs', ['http://app.example.org', scratch]).status).toBe(2);
  });
});

// --------------------------------------------- stand-ins for docker and psql

const bin = join(scratch, 'bin');
const digestA = `sha256:${repeat('a', 64)}`;
const digestB = `sha256:${repeat('b', 64)}`;
const digestC = `sha256:${repeat('c', 64)}`;
mkdirSync(bin, { recursive: true });
// docker: `push` reports $PUSH_DIGEST and records it for the tag; `imagetools
// inspect` answers from the record ("not found" for an unknown tag or digest;
// $REGISTRY_ERROR makes every read fail another way, with $REGISTRY_ERROR_TEXT;
// $MISSING_SAYS replaces "not found"); `imagetools create`
// copies the source's digest to the new tag unless $CREATE_DIGEST says
// otherwise; a build exits $BUILD_STATUS (0); anything else is refused.
writeFileSync(
  join(bin, 'docker'),
  [
    '#!/usr/bin/env bash',
    'echo "$*" >> "$DOCKER_LOG"',
    'lookup() { grep -F "$1 " "$STATE" 2> /dev/null | tail -n 1 | cut -d" " -f2; }',
    'case "$1 $2 $3" in',
    '  "tag "*) exit 0 ;;',
    '  "build "*) exit "${BUILD_STATUS:-0}" ;;',
    '  "push "*) echo "$2 $PUSH_DIGEST" >> "$STATE"; echo "latest: digest: $PUSH_DIGEST size: 1234" ;;',
    '  "buildx imagetools inspect")',
    '    [ -z "${REGISTRY_ERROR:-}" ] || { echo "ERROR: ${REGISTRY_ERROR_TEXT:-unauthorized: authentication required}" >&2; exit 1; }',
    '    ref="${!#}"',
    '    case "$ref" in',
    '      *@sha256:*) d="${ref#*@}"; grep -qF " $d" "$STATE" 2> /dev/null || d="" ;;',
    '      *) d="$(lookup "$ref")" ;;',
    '    esac',
    '    [ -n "$d" ] || { echo "ERROR: $ref: ${MISSING_SAYS:-not found}" >&2; exit 1; }',
    '    printf \'{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"%s","size":1}\\n\' "$d" ;;',
    '  "buildx imagetools create")',
    '    src="${!#}"; tag=""',
    '    while [ "$#" -gt 0 ]; do [ "$1" = "--tag" ] && tag="$2"; shift; done',
    '    echo "$tag ${CREATE_DIGEST:-${src#*@}}" >> "$STATE" ;;',
    '  *) exit 3 ;;',
    'esac',
    '',
  ].join('\n'),
);
// psql: the request time, then whether Postgres has restarted since ($RESTARTED).
writeFileSync(
  join(bin, 'psql'),
  [
    '#!/usr/bin/env bash',
    'echo "psql $*" >> "$DOCKER_LOG"',
    'case "$*" in',
    '  *pg_postmaster_start_time*) echo "${RESTARTED:-f}" ;;',
    "  *'select now()'*) echo '2026-11-21 12:00:00+00' ;;",
    '  *) echo 1 ;;',
    'esac',
    '',
  ].join('\n'),
);
chmodSync(join(bin, 'docker'), 0o755);
chmodSync(join(bin, 'psql'), 0o755);

/** A fresh registry record and log per case. */
function stand(name: string, seed: readonly string[] = []) {
  const state = join(scratch, `${name}-state`);
  const log = join(scratch, `${name}-log`);
  writeFileSync(state, seed.map((line) => `${line}\n`).join(''));
  writeFileSync(log, '');
  const env = { PATH: `${bin}:${process.env['PATH'] ?? ''}`, STATE: state, DOCKER_LOG: log };
  return {
    env,
    log: () => readFileSync(log, 'utf8'),
    digest: (ref: string) =>
      run('bash', [join(repoRoot, 'scripts', 'ci', 'registry.sh'), 'digest', ref], env).stdout.trim(),
  };
}

// ---------------------------------------------------------------- registry.sh

describe('registry.sh: what is pushed and pointed at is the probed digest', () => {
  const repository = 'ghcr.io/owner/shift-functions';
  const registry = (env: Record<string, string>, args: readonly string[], extra: Record<string, string> = {}) =>
    run('bash', [join(repoRoot, 'scripts', 'ci', 'registry.sh'), ...args], { ...env, ...extra });

  it('pushes the local image under every tag and prints it by digest', () => {
    const fake = stand('push');
    const pushed = registry(fake.env, ['push', 'shift-functions:deploy-1', repository, 'abc123', 'src-0011'], {
      PUSH_DIGEST: digestA,
    });
    expect(pushed.status).toBe(0);
    expect(pushed.stdout.trim()).toBe(`${repository}@${digestA}`);
    expect(fake.log()).toContain(`tag shift-functions:deploy-1 ${repository}:abc123`);
    expect(fake.digest(`${repository}:src-0011`)).toBe(digestA);
    expect(fake.digest(`${repository}:missing`)).toBe('');
  });

  it('fails a read the registry did not answer, rather than calling the tag absent', () => {
    const fake = stand('error', [`${repository}:staging ${digestA}`]);
    const failed = registry(fake.env, ['digest', `${repository}:staging`], { REGISTRY_ERROR: '1' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('cannot read');
    // A network failure that happens to say "not found" is still a failure.
    const network = registry(fake.env, ['digest', `${repository}:staging`], {
      REGISTRY_ERROR: '1',
      REGISTRY_ERROR_TEXT: 'failed to do request: dial tcp: lookup ghcr.io: no such host (host not found)',
    });
    expect(network.status).toBe(1);
  });

  it('points a channel tag at a digest as a carbon copy, and verifies it', () => {
    const fake = stand('point', [`${repository}:abc123 ${digestA}`]);
    expect(registry(fake.env, ['point', `${repository}@${digestA}`, 'staging']).status).toBe(0);
    expect(fake.log()).toContain(
      `buildx imagetools create --prefer-index=false --tag ${repository}:staging ${repository}@${digestA}`,
    );
    expect(fake.digest(`${repository}:staging`)).toBe(digestA);

    // The registry ends up naming another digest: refused.
    const drifted = registry(fake.env, ['point', `${repository}@${digestA}`, 'production'], { CREATE_DIGEST: digestB });
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain(`resolves to ${digestB}, not ${digestA}`);
  });

  it('refuses a malformed repository, tag or reference before calling docker', () => {
    const fake = stand('malformed');
    expect(registry(fake.env, ['push', 'local', 'GHCR.io/Owner/x', 'tag']).status).toBe(2);
    expect(registry(fake.env, ['push', 'local', repository, 'bad tag']).status).toBe(2);
    expect(registry(fake.env, ['point', `${repository}:staging`, 'production']).status).toBe(2);
    expect(registry(fake.env, ['nothing']).status).toBe(2);
    expect(fake.log()).toBe('');
  });
});

// ----------------------------------------------------------- deploy-images.sh

/** Runs deploy-images.sh asynchronously, so an in-process fake Coolify can answer it. */
function deployImages(args: readonly string[], env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn('bash', [join(repoRoot, 'scripts', 'ci', 'deploy-images.sh'), ...args], {
      cwd: repoRoot,
      env: { GITHUB_SHA: repeat('9', 40), RESTART_TRIES: '2', RESTART_INTERVAL: '0', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => {
      done({ status, stdout, stderr });
    });
  });
}

/**
 * A fake Coolify API on the loopback: answers each API request with `reply`
 * and records it. It also stands in for the stack's public API: `notify`
 * answers `notifyReply` (by default the refusal the probe expects).
 */
async function fakeCoolify(
  reply: readonly [number, unknown],
  notifyReply: readonly [number, unknown] = [401, { code: 'INVOKE_SECRET_REFUSED' }],
) {
  const calls: string[] = [];
  const notifyCalls: string[] = [];
  const server = createServer((request, response) => {
    const line = `${request.method ?? ''} ${request.url ?? ''} ${request.headers.authorization ?? ''}`;
    const answer = request.url === '/functions/v1/notify' ? notifyReply : reply;
    (request.url === '/functions/v1/notify' ? notifyCalls : calls).push(line);
    response.writeHead(answer[0], { 'content-type': 'application/json' }).end(JSON.stringify(answer[1]));
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    calls,
    notifyCalls,
    close: () => {
      server.close();
    },
  };
}

describe('deploy-images.sh: the image half of a deploy (story 20.6)', () => {
  const repository = 'ghcr.io/owner/shift-functions';
  const web = 'ghcr.io/owner/shift-web';
  const token = `7|${repeat('t', 48)}`;
  const stack = 'stack0123456789abcdefghi';
  const webUuid = 'webapp0123456789abcdefgh';
  const restarting = [200, { message: 'Service restarting request queued.' }] as const;
  const script = read('scripts', 'ci', 'deploy-images.sh');
  const sources = /FUNCTIONS_SOURCES=\(([^)]*)\)/.exec(script)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  const sourceHash = (): string => {
    const tree = spawnSync('git', ['ls-tree', '-r', 'HEAD', '--', ...sources], { cwd: repoRoot, encoding: 'utf8' });
    return createHash('sha256').update(tree.stdout).digest('hex').slice(0, 16);
  };
  const functionsEnv = (fake: ReturnType<typeof stand>, url: string, ref: string) => ({
    ...fake.env,
    ENVIRONMENT: 'staging',
    REF: ref,
    COOLIFY_API_URL: url,
    COOLIFY_API_TOKEN: token,
    STACK_UUID: stack,
    SUPABASE_URL: url,
    NOTIFY_TRIES: '2',
    NOTIFY_INTERVAL: '0',
    DB_URL: 'postgresql://postgres@host-name.example.ts.net:1/postgres',
  });

  it('hashes every source the functions Dockerfile copies, and the probe that passed it', () => {
    const copied = [...read('deploy', 'functions', 'Dockerfile').matchAll(/^COPY\s+(?:--\S+\s+)*(.+)\s+\S+$/gm)].flatMap(
      (match) => (match[1] ?? '').split(/\s+/),
    );
    expect(copied.length).toBeGreaterThan(2);
    for (const path of copied) {
      expect(
        sources.some((source) => path === source || path.startsWith(`${source.replace(/\/$/, '')}/`)),
        `${path} is not in FUNCTIONS_SOURCES`,
      ).toBe(true);
    }
    expect(sources).toEqual(expect.arrayContaining(['.dockerignore', 'scripts/ci/probe-functions-image.sh']));
  });

  it('hashes the domain package the server projections run, and what builds it, never its dist (AD-7, story 16.2)', () => {
    expect(sources).toEqual(
      expect.arrayContaining([
        'packages/domain/src',
        'packages/domain/package.json',
        'packages/domain/tsconfig.json',
        'packages/domain/tsconfig.test.json',
        'tsconfig.base.json',
        'pnpm-lock.yaml',
      ]),
    );
    expect(sources.filter((source) => /(^|\/)dist(\/|$)/.test(source))).toEqual([]);
    // Every source exists in the checkout (a renamed or removed path would hash nothing).
    for (const source of sources) expect(existsSync(join(repoRoot, source)), source).toBe(true);
  });

  it('deploys a given digest as it is, and refuses one of another repository, not by digest, or not in the registry', async () => {
    const fake = stand('given', [`${repository}:abc ${digestA}`]);
    const env = { ...fake.env, REPOSITORY: repository };
    const ok = await deployImages(['functions-image'], { ...env, GIVEN: `${repository}@${digestA}` });
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.trim()).toBe(`${repository}@${digestA}`);
    for (const given of [`ghcr.io/other/shift-functions@${digestA}`, `${repository}:abc`, `${repository}@${digestB}`]) {
      const refused = await deployImages(['functions-image'], { ...env, GIVEN: given });
      expect(refused.status, given).toBe(1);
    }
    expect(fake.log()).not.toMatch(/^build /m);
  });

  it('refuses to build in production: it deploys the digest staging handed over, or nothing', async () => {
    const fake = stand('production-empty');
    const result = await deployImages(['functions-image'], { ...fake.env, REPOSITORY: repository, ENVIRONMENT: 'production' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('none was handed over');
    expect(fake.log()).toBe('');
  });

  it('builds, probes, then pushes under the commit and source tags when no probed build of these sources exists', async () => {
    const probe = join(scratch, 'probe-stand-in.sh');
    writeFileSync(probe, '#!/usr/bin/env bash\necho "probe $1" >> "$DOCKER_LOG"\nexit "${PROBE_STATUS:-0}"\n');
    // GHCR may say "denied" rather than "not found" before the package exists:
    // the reuse lookup then builds rather than failing the first deploy.
    for (const missingSays of ['not found', 'denied: permission_denied']) {
      const fake = stand(`build-${missingSays.slice(0, 6)}`);
      const result = await deployImages(['functions-image'], {
        ...fake.env,
        REPOSITORY: repository,
        ENVIRONMENT: 'staging',
        FUNCTIONS_PROBE: probe,
        PUSH_DIGEST: digestC,
        MISSING_SAYS: missingSays,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(`${repository}@${digestC}`);
      const log = fake.log();
      const build = log.indexOf('build --pull -f deploy/functions/Dockerfile');
      const probed = log.indexOf(`probe shift-functions:deploy-${repeat('9', 40)}`);
      const push = log.indexOf('push ');
      expect(build).toBeGreaterThan(-1);
      expect(probed).toBeGreaterThan(build);
      expect(push).toBeGreaterThan(probed);
      expect(fake.digest(`${repository}:${repeat('9', 40)}`)).toBe(digestC);
      expect(fake.digest(`${repository}:src-${sourceHash()}`)).toBe(digestC);
    }

    const failing = stand('build-probe-fails');
    const refused = await deployImages(['functions-image'], {
      ...failing.env,
      REPOSITORY: repository,
      ENVIRONMENT: 'staging',
      FUNCTIONS_PROBE: probe,
      PUSH_DIGEST: digestC,
      PROBE_STATUS: '1',
    });
    expect(refused.status).not.toBe(0);
    expect(failing.log()).not.toMatch(/^push /m);
  });

  it('reuses the probed build of the same sources without building, and tags it with this commit', async () => {
    const fake = stand('reuse', [`${repository}:src-${sourceHash()} ${digestB}`]);
    const result = await deployImages(['functions-image'], { ...fake.env, REPOSITORY: repository });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`${repository}@${digestB}`);
    expect(fake.log()).not.toMatch(/^build /m);
    expect(fake.digest(`${repository}:${repeat('9', 40)}`)).toBe(digestB);
  });

  it('does not restart the stack when the digest is the one last verified', async () => {
    const fake = stand('unchanged', [`${repository}:staging-live ${digestA}`, `${repository}:staging ${digestA}`]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], functionsEnv(fake, coolify.url, `${repository}@${digestA}`));
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('unchanged');
      expect(coolify.calls).toEqual([]);
      // The notify probe still runs.
      expect(coolify.notifyCalls).toEqual(['POST /functions/v1/notify ']);
    } finally {
      coolify.close();
    }
  });

  it('restarts when the channel tag names another digest than the verified one, even if -live matches', async () => {
    const fake = stand('channel-drift', [`${repository}:staging-live ${digestA}`, `${repository}:staging ${digestB}`]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestA}`),
        RESTARTED: 't',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain('unchanged');
      expect(coolify.calls).toEqual([`POST /api/v1/services/${stack}/restart?latest=true Bearer ${token}`]);
      expect(fake.digest(`${repository}:staging`)).toBe(digestA);
    } finally {
      coolify.close();
    }
  });

  it('takes the time, moves the tag, restarts, and passes once Postgres started after the request', async () => {
    const fake = stand('changed', [
      `${repository}:staging-live ${digestA}`,
      `${repository}:staging ${digestA}`,
      `${repository}:x ${digestB}`,
    ]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestB}`),
        RESTARTED: 't',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(coolify.calls).toEqual([`POST /api/v1/services/${stack}/restart?latest=true Bearer ${token}`]);
      const log = fake.log();
      expect(log.indexOf('select now()')).toBeGreaterThan(-1);
      expect(log.indexOf('select now()')).toBeLessThan(log.indexOf('imagetools create'));
      expect(fake.digest(`${repository}:staging`)).toBe(digestB);
      // Probed, then recorded as verified: the very tag the skip reads.
      expect(coolify.notifyCalls.length).toBeGreaterThan(0);
      expect(fake.digest(`${repository}:staging-live`)).toBe(digestB);
    } finally {
      coolify.close();
    }
  });

  it('fails when Postgres never restarts, and puts the channel tag back', async () => {
    const fake = stand('stuck', [`${repository}:staging ${digestA}`, `${repository}:x ${digestB}`]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestB}`),
        RESTARTED: 'f',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('did not restart in time');
      expect(fake.digest(`${repository}:staging`)).toBe(digestA);
      expect(result.stderr).toContain('may already be the new image');
    } finally {
      coolify.close();
    }
  });

  it('puts the channel tag back and records nothing as verified when notify fails after the restart', async () => {
    const fake = stand('probe-fails', [
      `${repository}:staging-live ${digestA}`,
      `${repository}:staging ${digestA}`,
      `${repository}:x ${digestB}`,
    ]);
    const coolify = await fakeCoolify(restarting, [502, { message: 'bad gateway' }]);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestB}`),
        RESTARTED: 't',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('expected 401 INVOKE_SECRET_REFUSED, last got 502');
      expect(fake.digest(`${repository}:staging`)).toBe(digestA);
      expect(fake.digest(`${repository}:staging-live`)).toBe(digestA);
    } finally {
      coolify.close();
    }
  });

  it('says there is nothing to put back when a first deploy fails', async () => {
    const fake = stand('first', [`${repository}:x ${digestB}`]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestB}`),
        RESTARTED: 'f',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('nothing to put back');
    } finally {
      coolify.close();
    }
  });

  it('puts the channel tag back when the move itself is not verified', async () => {
    const fake = stand('drift', [`${repository}:staging ${digestA}`, `${repository}:x ${digestB}`]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestB}`),
        CREATE_DIGEST: digestC,
      });
      expect(result.status).not.toBe(0);
      expect(coolify.calls).toEqual([]);
      // The restore is itself a move, which the stand-in also drifts: the
      // failure to put it back is an error, never silent.
      expect(result.stderr).toMatch(/putting .*:staging back on/);
    } finally {
      coolify.close();
    }
  });

  it('fails, neither skipping nor restarting, when the registry cannot say what was verified', async () => {
    const fake = stand('unreadable', [`${repository}:staging-live ${digestA}`]);
    const coolify = await fakeCoolify(restarting);
    try {
      const result = await deployImages(['deploy-functions'], {
        ...functionsEnv(fake, coolify.url, `${repository}@${digestA}`),
        REGISTRY_ERROR: '1',
      });
      // The unreadable registry fails the step; it is never read as "unchanged".
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('unchanged');
      expect(coolify.calls).toEqual([]);
    } finally {
      coolify.close();
    }
  });

  it('puts the web channel tag back when the deploy is refused or never goes live', async () => {
    const cases = [
      ['refused', [200, { deployments: [{ message: 'Unauthorized to deploy this application.', resource_uuid: webUuid }] }]],
      // Queued, but the origin given here is not https: the wait refuses it.
      ['not-live', [200, { deployments: [{ message: 'queued', resource_uuid: webUuid, deployment_uuid: 'd1' }] }]],
    ] as const;
    for (const [name, reply] of cases) {
      const fake = stand(`web-${name}`, [`${web}:production ${digestA}`, `${web}:production-x ${digestC}`]);
      const coolify = await fakeCoolify(reply);
      try {
        const result = await deployImages(['deploy-web'], {
          ...fake.env,
          ENVIRONMENT: 'production',
          REF: `${web}@${digestC}`,
          COOLIFY_API_URL: coolify.url,
          COOLIFY_API_TOKEN: token,
          WEB_UUID: webUuid,
          APP_ORIGIN: 'http://app.example.org',
          DIST: scratch,
        });
        expect(result.status, name).not.toBe(0);
        expect(coolify.calls, name).toEqual([`POST /api/v1/deploy?uuid=${webUuid}&force=false Bearer ${token}`]);
        expect(fake.digest(`${web}:production`), name).toBe(digestA);
      } finally {
        coolify.close();
      }
    }
  });
});

// ------------------------------------------------------- the workflow's shape

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, unknown>;
  readonly if?: string;
}
interface Job {
  readonly needs?: string | string[];
  readonly if?: string;
  readonly steps?: Step[];
  readonly environment?: unknown;
  readonly permissions?: Record<string, string>;
  readonly outputs?: Record<string, string>;
}

describe('the pipeline deploys through Coolify (story 20.6)', () => {
  const pipelineText = read('.github', 'workflows', 'pipeline.yml');
  const pipeline = parse(pipelineText) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Job> };
  const actionText = read('.github', 'actions', 'deploy', 'action.yml');
  const action = parse(actionText) as { runs: { steps: Step[] }; inputs: Record<string, unknown> };
  const deployJobs = ['deploy-staging', 'deploy-production'];
  const MAIN_ONLY = "github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.DEPLOY_ENABLED == 'true'";

  it('runs on pull requests and pushes to main only, never pull_request_target, read-only by default', () => {
    expect(Object.keys(pipeline.on).sort()).toEqual(['pull_request', 'push']);
    expect(pipelineText).not.toContain('pull_request_target');
    expect(pipeline.permissions).toEqual({ contents: 'read' });
  });

  it('gives packages: write to the two deploy jobs alone, which run only on main with deploys enabled', () => {
    const writers = Object.entries(pipeline.jobs)
      .filter(([, job]) => JSON.stringify(job.permissions ?? {}).includes('write'))
      .map(([name]) => name);
    expect(writers).toEqual(deployJobs);
    for (const name of deployJobs) {
      expect(pipeline.jobs[name]?.permissions, name).toEqual({ contents: 'read', packages: 'write' });
    }
    expect(pipeline.jobs['deploy-staging']?.if).toBe(MAIN_ONLY);
    // Production follows staging's smoke, which follows staging's deploy.
    expect(pipeline.jobs['deploy-production']?.needs).toEqual(['deploy-staging', 'smoke-staging']);
    expect(pipeline.jobs['smoke-staging']?.needs).toBe('deploy-staging');
  });

  it('reads secrets only in jobs bound to an Environment, besides the optional Slack hook', () => {
    for (const [name, job] of Object.entries(pipeline.jobs)) {
      const text = JSON.stringify(job).replace('${{ secrets.SLACK_WEBHOOK_URL }}', '');
      if (text.includes('secrets.')) expect(job.environment, `${name} reads a secret`).toBeDefined();
    }
  });

  it('pins every third-party action by a full commit SHA', () => {
    const uses = [...`${pipelineText}\n${actionText}`.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1] ?? '');
    expect(uses.length).toBeGreaterThan(5);
    for (const reference of uses) {
      if (reference.startsWith('./')) continue;
      expect(reference, reference).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
    expect(actionText).toContain('tailscale/github-action@064b10558093f38325e838ddea35486bdc6b1d5c # v4.4.0');
  });

  it('checks the new configuration set, the same in both environments', () => {
    const checks = deployJobs.map(
      (name) => pipeline.jobs[name]?.steps?.find((step) => step.name === 'Check configuration')?.run ?? '',
    );
    const items = (run: string) => run.split(/\s+/).filter((word) => /^(secret|var):/.test(word));
    expect(items(checks[0] ?? '')).toEqual([
      'var:APP_ORIGINS',
      'var:SUPABASE_API_URL:https-origin',
      'var:SUPABASE_PUBLISHABLE_KEY:publishable',
      'var:VAPID_PUBLIC_KEY:vapid-public',
      'var:DB_HOST:tailnet-host',
      'var:DB_PORT:port',
      'secret:SUPABASE_DB_PASSWORD',
      'var:COOLIFY_API_URL:tailnet-url',
      'secret:COOLIFY_API_TOKEN:coolify-token',
      'var:COOLIFY_WEB_UUID:coolify-uuid',
      'var:COOLIFY_FUNCTIONS_UUID:coolify-uuid',
      'secret:TS_OAUTH_CLIENT_ID',
      'secret:TS_OAUTH_SECRET:ts-oauth-secret',
    ]);
    expect(items(checks[1] ?? '')).toEqual(items(checks[0] ?? ''));
    // Every name it checks is mapped into the step, and the skipped-deploys
    // summary and DEPLOY.md name it too.
    const summary = pipeline.jobs['build']?.steps?.find((step) => step.name === 'Deploys are not configured')?.run ?? '';
    const deploy = read('DEPLOY.md');
    for (const item of items(checks[0] ?? '')) {
      const name = item.split(':')[1] ?? '';
      for (const job of deployJobs) {
        const step = pipeline.jobs[job]?.steps?.find((candidate) => candidate.name === 'Check configuration');
        expect(Object.keys(step?.env ?? {}), `${job} ${name}`).toContain(name);
      }
      expect(summary, name).toContain(`\\\`${name}\\\``);
      expect(deploy, name).toContain(`\`${name}\``);
    }
  });

  it('reads no hosted-platform credential and no runtime secret from GitHub (AD-17 as amended)', () => {
    for (const forbidden of [
      'supabase link',
      'config push',
      'secrets set',
      'functions deploy',
      'wrangler',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_PROJECT_REF',
      'CLOUDFLARE_',
      'SUPABASE_SECRET_KEY',
      'RESEND_API_KEY',
      'NOTIFY_INVOKE_SECRET',
      'VAPID_PRIVATE_KEY',
    ]) {
      expect(actionText, forbidden).not.toContain(forbidden);
      expect(pipelineText, forbidden).not.toContain(forbidden);
    }
  });

  it('passes every secret through the environment or stdin, never as an argument', () => {
    for (const step of action.runs.steps) {
      expect(step.run ?? '', step.name).not.toMatch(/\$\{\{\s*inputs\./);
    }
    // The database URL carries no password: the CLI reads PGPASSWORD.
    for (const url of actionText.matchAll(/postgresql:\/\/[^"\s]*/g)) {
      expect(url[0]).toBe('postgresql://postgres@$DB_HOST:$DB_PORT/postgres');
    }
    expect(actionText).toContain('docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin');
  });

  it('does the remote steps in the order the epic gives, after every local refusal', () => {
    const names = action.runs.steps.map((step) => step.name ?? step.uses ?? '');
    const at = (name: string): number => {
      const index = names.findIndex((candidate) => candidate.startsWith(name));
      expect(index, name).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      'Resolve origins',
      'Build apps/web',
      'The bundle carries no secret',
      'No source map is published',
      'Build shift-web and probe it offline',
      'Log in to GHCR',
      'shift-functions (build and probe, or reuse)',
      'Push shift-web',
      'Join the tailnet',
      'supabase migration list (before)',
      'A backup precedes a production migration',
      'supabase db push',
      'supabase migration list (local and remote must agree)',
      'Deploy shift-functions',
      'Deploy shift-web',
      'Log out of GHCR',
      'Summary',
    ];
    const indices = order.map(at);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(names).toHaveLength(order.length);

    const tailnet = action.runs.steps[at('Join the tailnet')];
    expect(tailnet?.with).toMatchObject({ tags: 'tag:ci', 'use-cache': 'false' });
    expect(action.runs.steps[at('Log out of GHCR')]?.if).toBe('always()');
  });

  it('deploys the images it probed: production takes staging’s functions digest, each builds its own web', () => {
    const deploy = (name: string) => pipeline.jobs[name]?.steps?.find((step) => step.uses === './.github/actions/deploy');
    expect(deploy('deploy-staging')?.with?.['functions-image']).toBeUndefined();
    expect(deploy('deploy-production')?.with?.['functions-image']).toBe(
      '${{ needs.deploy-staging.outputs.functions-image }}',
    );
    expect(deploy('deploy-production')?.with?.['pre-migration-backup-at']).toBe('${{ vars.PRE_MIGRATION_BACKUP_AT }}');
    expect(pipeline.jobs['deploy-staging']?.outputs?.['functions-image']).toBe(
      '${{ steps.deploy.outputs.functions-image }}',
    );
    for (const name of deployJobs) expect(deploy(name)?.with?.['registry-token']).toBe('${{ github.token }}');

    const steps = action.runs.steps;
    const runOf = (name: string) => steps.find((step) => step.name === name)?.run ?? '';
    expect(runOf('Build shift-web and probe it offline')).toContain(
      'bash scripts/ci/probe-web-image.sh "shift-web:deploy-$GITHUB_SHA" apps/web/dist',
    );
    expect(runOf('shift-functions (build and probe, or reuse)')).toContain(
      'bash scripts/ci/deploy-images.sh functions-image',
    );
    // The build branch runs above with a stand-in probe; in CI it is the real
    // one, which nothing in the action or the pipeline replaces.
    expect(read('scripts', 'ci', 'deploy-images.sh')).toContain(
      'FUNCTIONS_PROBE="${FUNCTIONS_PROBE:-$here/probe-functions-image.sh}"',
    );
    expect(`${actionText}\n${pipelineText}`).not.toContain('FUNCTIONS_PROBE');
    expect(runOf('Push shift-web (probed, not yet deployed)')).toContain(
      'bash scripts/ci/registry.sh push "shift-web:deploy-$GITHUB_SHA"',
    );
    // The two deploys are deploy-images.sh, exercised above with stand-ins.
    expect(runOf('Deploy shift-web')).toBe('bash scripts/ci/deploy-images.sh deploy-web');
    expect(runOf('Deploy shift-functions')).toBe(
      'DB_URL="postgresql://postgres@$DB_HOST:$DB_PORT/postgres" bash scripts/ci/deploy-images.sh deploy-functions',
    );
    // psql and a connection are checked before the migration, never after it.
    expect(runOf('supabase migration list (before)')).toContain('command -v psql');
    for (const name of [
      'supabase migration list (before)',
      'supabase db push',
      'supabase migration list (local and remote must agree)',
      'Deploy shift-functions',
    ]) {
      expect(steps.find((step) => step.name === name)?.env?.['PGCONNECT_TIMEOUT'], name).toBe('10');
    }
    expect(steps.find((step) => step.name === 'Summary')?.if).toBe('always()');
  });

  it('keeps the gates: CI passed, the smoke jobs and the notify job see the deploy jobs as before', () => {
    expect(pipeline.jobs['ci-passed']?.needs).toEqual([
      'quality',
      'build',
      'test',
      'functions-image',
      'runtime-parity',
      'web-image',
      'changes',
      'e2e',
    ]);
    expect(pipeline.jobs['notify']?.needs).toEqual(expect.arrayContaining([...deployJobs, 'smoke-staging', 'smoke-production']));
    expect(pipeline.jobs['smoke-production']?.needs).toBe('deploy-production');
    // The build-only image jobs still push nothing (stories 20.2, 20.3).
    for (const name of ['functions-image', 'web-image']) {
      expect(JSON.stringify(pipeline.jobs[name]), name).not.toMatch(/docker push|registry\.sh|packages/);
    }
    // ShellCheck covers the new script.
    expect(pipeline.jobs['quality']?.steps?.find((step) => step.name === 'ShellCheck')?.run).toContain(
      'scripts/ci/registry.sh',
    );
  });
});
