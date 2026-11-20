import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { collectFiles } from './source-scan.ts';

/**
 * Story 20.1: the self-hosted Supabase stack Coolify runs for staging and
 * production, `deploy/coolify/supabase/docker-compose.yml`.
 *
 * Structural assertions over the real file, parsed as YAML (and Kong's
 * declarative config parsed out of it): which services run, at which images,
 * what is published and where, which routes Kong has, where each secret goes,
 * and the limits. Whether the stack actually starts, applies every migration
 * and signs a member in is the rehearsal in DEPLOY.md, which needs Docker and
 * is story 20.5's first act (deferred-work.md).
 *
 * GoTrue's and PostgREST's parity with `supabase/config.toml` lives in
 * `test/supabase-scaffold.test.ts`, beside the config reader it shares.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const deployRoot = join(repoRoot, 'deploy');
const stackRoot = join(deployRoot, 'coolify', 'supabase');

/** Coolify's Supabase template the compose is derived from. */
const TEMPLATE_COOLIFY_VERSION = 'v4.7.6';
const TEMPLATE_COMMIT = 'b7cbdb480faa1a124423e3c3c886481848c96cf9';

/**
 * The images Supabase CLI 2.116.0 runs locally, from its
 * `apps/cli-go/pkg/config/templates/Dockerfile` at v2.116.0. Keyed by the CLI
 * version so a bump of the `supabase` devDependency fails here until someone
 * re-reads that Dockerfile and updates the table and the compose together.
 */
const CLI_VERSION = '2.116.0';
const CLI_IMAGES: Readonly<Record<string, string>> = {
  'supabase-db': 'supabase/postgres:17.6.1.165',
  'supabase-kong': 'kong:2.8.1',
  'supabase-auth': 'supabase/gotrue:v2.196.0',
  'supabase-rest': 'postgrest/postgrest:v16.1',
  'supabase-storage': 'supabase/storage-api:v1.70.3',
  'supabase-meta': 'supabase/postgres-meta:v0.98.0',
  'supabase-studio': 'supabase/studio:2026.08.17-sha-0c1da8f',
  'supabase-edge-functions': 'supabase/edge-runtime:v1.74.3',
};

/** The only services that publish a port, and the container port each publishes. */
const PUBLISHED: Readonly<Record<string, string>> = {
  'supabase-db': '5432',
  'supabase-studio': '3000',
};

/** The services that hold the JWT signing secret (AD-17 as amended, clause 2). */
const JWT_SECRET_HOLDERS = ['supabase-auth', 'supabase-rest', 'supabase-storage'];

/** The documents beside `deploy/` that the public-repository scans also read. */
const SPEC_FILE = join(
  repoRoot,
  '_bmad-output',
  'implementation-artifacts',
  'spec-20-1-the-self-hosted-stack-is-defined-in-the-repository.md',
);
const DEPLOY_DOC = join(repoRoot, 'DEPLOY.md');

/** The secrets no generator can make: operator-set in Coolify, never defaulted. */
const OPERATOR_SECRETS = ['RESEND_API_KEY', 'VAPID_PRIVATE_KEY'];

/** Kong's route prefixes: auth, REST, GraphQL, Storage, Functions. Nothing else. */
const KONG_ROUTE_PREFIXES = ['/auth/v1/', '/rest/v1/', '/graphql/v1', '/storage/v1/', '/functions/v1/'];

// ------------------------------------------------------------------ the reads

interface Bind {
  type?: string;
  source?: string;
  target?: string;
  content?: string;
}

interface Service {
  image?: string;
  entrypoint?: string | string[];
  ports?: unknown[];
  expose?: unknown[];
  network_mode?: string;
  mem_limit?: string;
  cpus?: string | number;
  environment?: string[] | Record<string, string>;
  volumes?: (string | Bind)[];
}

interface Compose {
  services: Record<string, Service>;
}

interface KongService {
  name: string;
  url: string;
  routes?: { paths?: string[] }[];
  plugins?: { name: string; config?: Record<string, unknown> }[];
}

interface KongConfig {
  consumers: { username: string; keyauth_credentials?: { key: string }[] }[];
  services: KongService[];
}

const composeText = readFileSync(join(stackRoot, 'docker-compose.yml'), 'utf8');
const compose = parse(composeText) as Compose;

function service(name: string): Service {
  const found = compose.services[name];
  expect(found, `the compose has no ${name}`).toBeDefined();
  return found ?? {};
}

/** A service's environment as `name → raw value` (a bare `NAME` maps to ''). */
function environment(name: string): Map<string, string> {
  const raw = service(name).environment ?? [];
  const entries = Array.isArray(raw)
    ? raw.map((entry): [string, string] => {
        const at = entry.indexOf('=');
        return at === -1 ? [entry, ''] : [entry.slice(0, at), entry.slice(at + 1)];
      })
    : Object.entries(raw).map(([key, value]): [string, string] => [key, String(value)]);
  return new Map(entries);
}

/** The `content:` of the bind mounted at `target`. */
function boundContent(name: string, target: string): string {
  const bind = (service(name).volumes ?? []).find(
    (volume): volume is Bind => typeof volume === 'object' && volume.target === target,
  );
  expect(bind?.content, `${name} mounts nothing at ${target}`).toBeTypeOf('string');
  return bind?.content ?? '';
}

const kongTemplate = boundContent('supabase-kong', '/home/kong/temp.yml');
const kongEntrypoint = boundContent('supabase-kong', '/home/kong/kong-entrypoint.sh');
const kong = parse(kongTemplate) as KongConfig;

/**
 * `KEY=value` lines of an env template, comments and blanks skipped, one pair
 * of surrounding double quotes removed. A line with no `=` is a malformed
 * template, not something to skip.
 */
function parseEnvTemplate(text: string): Map<string, string> {
  const pairs = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line): [string, string] => {
      const at = line.indexOf('=');
      if (at <= 0) throw new Error(`not a KEY=value line: ${line}`);
      return [line.slice(0, at), line.slice(at + 1).replace(/^"(.*)"$/, '$1')];
    });
  return new Map(pairs);
}

function envTemplate(file: string): Map<string, string> {
  return parseEnvTemplate(readFileSync(join(stackRoot, file), 'utf8'));
}

/** busybox, when the host has it: Kong's entrypoint is also run under its sh and awk. */
const BUSYBOX = ['/usr/bin/busybox', '/bin/busybox'].find((candidate) => existsSync(candidate)) ?? null;

/** Fixed fake values for running Kong's entrypoint: none is a real key. */
const FAKE = {
  SUPABASE_ANON_KEY: 'eyJfake.anon.sig',
  SUPABASE_SERVICE_KEY: 'eyJfake.service.sig',
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(64)}`,
  SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(32)}`,
} as const;

/**
 * Runs the compose's own Kong entrypoint under `sh`, minus its final `exec`,
 * with awk reading and writing temp files. Returns the exit status, stderr and
 * the rendered declarative config.
 */
function runKongEntrypoint(
  env: Readonly<Record<string, string>>,
  shell: 'host' | 'busybox' = 'host',
): {
  status: number;
  stderr: string;
  rendered: string;
} {
  const directory = mkdtempSync(join(tmpdir(), 'shift-kong-'));
  try {
    const input = join(directory, 'temp.yml');
    const output = join(directory, 'kong.yml');
    const script = join(directory, 'entrypoint.sh');
    writeFileSync(input, kongTemplate);
    const lines = kongEntrypoint.split('\n');
    const execLine = lines.findIndex((line) => line.startsWith('exec /docker-entrypoint.sh'));
    expect(execLine, 'the entrypoint no longer starts Kong').toBeGreaterThan(0);
    writeFileSync(
      script,
      lines
        .filter((_, index) => index !== execLine)
        .join('\n')
        .replace('/home/kong/temp.yml', input),
    );
    // Under busybox, its own applets (awk, cut) come first on PATH:
    // the tools of an Alpine-based image, not the host's.
    let path = process.env['PATH'] ?? '/usr/bin:/bin';
    if (shell === 'busybox' && BUSYBOX !== null) {
      const bin = join(directory, 'bin');
      mkdirSync(bin);
      for (const applet of ['awk', 'cut', 'printf', 'sh', '[']) symlinkSync(BUSYBOX, join(bin, applet));
      path = `${bin}:${path}`;
    }
    try {
      execFileSync(shell === 'busybox' && BUSYBOX !== null ? BUSYBOX : 'sh', shell === 'busybox' ? ['sh', script] : [script], {
        env: { PATH: path, KONG_DECLARATIVE_CONFIG: output, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failed = error as { status?: number; stderr?: Buffer };
      return { status: failed.status ?? -1, stderr: String(failed.stderr ?? ''), rendered: '' };
    }
    return { status: 0, stderr: '', rendered: readFileSync(output, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the checkers
// Each rule is a function so it can be proved on both polarities below.

/** A `ports:` entry is acceptable only as `127.0.0.1:${VAR:?}:<containerPort>`. */
function loopbackPublish(entry: unknown): string | null {
  if (typeof entry !== 'string') return null;
  const match = /^127\.0\.0\.1:\$\{[A-Z][A-Z0-9_]*:\?\}:(\d+)$/.exec(entry);
  return match?.[1] ?? null;
}

/** An image is pinned: a name, a tag, and the tag is not `latest`. */
function pinned(image: string | undefined): boolean {
  if (image === undefined) return false;
  const match = /^[a-z0-9./_-]+:([A-Za-z0-9._-]+)$/.exec(image);
  return match !== null && match[1] !== 'latest';
}

/** Every `${NAME…}` reference in a text, with what follows the name. */
function references(text: string): { name: string; modifier: string }[] {
  return [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}/g)].map((match) => ({
    name: match[1] ?? '',
    modifier: match[2] ?? '',
  }));
}

/** A secret may be referenced bare, or as required (`:?`), never with a default. */
const GENERATED_SECRET = /^SERVICE_(PASSWORD_\w+|SUPABASEANON_KEY|SUPABASESERVICE_KEY)$/;

function defaultedSecrets(text: string): string[] {
  return references(text)
    .filter(({ name }) => GENERATED_SECRET.test(name) || OPERATOR_SECRETS.includes(name))
    .filter(({ modifier }) => modifier !== '' && !/^:?\?/.test(modifier))
    .map(({ name, modifier }) => `\${${name}${modifier}}`);
}

/** `512m`, `1g`, `1.5G` → MiB. */
function mebibytes(size: string): number {
  const match = /^(\d+(?:\.\d+)?)([kmg])$/i.exec(size);
  expect(match, `${size} is not a memory size`).not.toBeNull();
  const amount = Number(match?.[1]);
  const unit = (match?.[2] ?? '').toLowerCase();
  return unit === 'g' ? amount * 1024 : unit === 'k' ? amount / 1024 : amount;
}

/** `${NAME:-default}` → [NAME, default]; anything else → null. */
function defaulted(value: unknown): [string, string] | null {
  const match = /^\$\{([A-Z][A-Z0-9_]*):-([^}]+)\}$/.exec(String(value));
  return match === null ? null : [match[1] ?? '', match[2] ?? ''];
}

/** IPv4-shaped literals in a text. */
function ipv4Literals(text: string): string[] {
  return [...text.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g)].map((match) => match[1] ?? '');
}

// ------------------------------------------------------------------- the tests

describe('the self-hosted stack (story 20.1): what runs', () => {
  it('runs exactly the eight services, and records the template it was derived from', () => {
    expect(Object.keys(compose.services).sort()).toEqual(Object.keys(CLI_IMAGES).sort());

    expect(composeText).toContain(TEMPLATE_COMMIT);
    expect(composeText).toContain(`Coolify ${TEMPLATE_COOLIFY_VERSION}`);
  });

  it("pins every image at the version Supabase CLI 2.116.0 runs locally", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(
      manifest.devDependencies['supabase'],
      'the CLI moved: re-read its Dockerfile at the new tag, then update CLI_IMAGES and the compose together',
    ).toBe(CLI_VERSION);

    for (const [name, image] of Object.entries(CLI_IMAGES)) {
      expect(pinned(service(name).image), `${name} is not pinned`).toBe(true);
      expect(service(name).image, `${name} is not at CLI ${CLI_VERSION}'s version`).toBe(image);
    }
  });

  it('runs Postgres at config.toml’s major version', () => {
    const config = readFileSync(join(repoRoot, 'supabase', 'config.toml'), 'utf8');
    const major = /^\[db\][^[]*?^major_version\s*=\s*(\d+)/m.exec(config)?.[1];

    expect(major, 'config.toml has no [db] major_version').toBeDefined();
    expect(service('supabase-db').image).toMatch(new RegExp(`^supabase/postgres:${major ?? 'none'}\\.`));
  });

  it('keeps the two init scripts it names and none it dropped', () => {
    const targets = (service('supabase-db').volumes ?? []).map((volume) =>
      typeof volume === 'string' ? volume : (volume.target ?? ''),
    );

    expect(targets.filter((target) => target.startsWith('/docker-entrypoint-initdb.d/'))).toEqual([
      '/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql',
      '/docker-entrypoint-initdb.d/init-scripts/99-roles.sql',
    ]);
  });

  it('gives Storage the file backend on a named volume', () => {
    const env = environment('supabase-storage');

    expect(env.get('STORAGE_BACKEND')).toBe('file');
    expect(env.get('FILE_STORAGE_BACKEND_PATH')).toBe('/var/lib/storage');
    expect(service('supabase-storage').volumes).toContain('supabase-storage-data:/var/lib/storage');
  });

  it("caps Storage's uploads at the logo bucket's own limit from 0005", () => {
    const migration = readFileSync(
      join(repoRoot, 'supabase', 'migrations', '0005_organization_logo.sql'),
      'utf8',
    );
    // `insert into storage.buckets (id, name, public, file_size_limit, …) values ('…', '…', <bool>, <limit>, …)`
    const bucketLimit = /insert into storage\.buckets \(id, name, public, file_size_limit[^)]*\)\s*values \(\s*'[^']+',\s*'[^']+',\s*(?:true|false),\s*(\d+)/i.exec(
      migration,
    )?.[1];

    expect(bucketLimit, '0005 no longer states the bucket limit where this reads it').toBeDefined();
    expect(environment('supabase-storage').get('FILE_SIZE_LIMIT')).toBe(bucketLimit);
  });

  it('restarts every service unless stopped', () => {
    for (const [name, definition] of Object.entries(compose.services)) {
      expect((definition as { restart?: string }).restart, name).toBe('unless-stopped');
    }
  });

  it('rotates every service’s logs', () => {
    for (const [name, definition] of Object.entries(compose.services)) {
      expect(
        (definition as Service & { logging?: unknown }).logging,
        `${name} has no log rotation`,
      ).toEqual({ driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } });
    }
  });
});

describe('the self-hosted stack (story 20.1): exposure', () => {
  it('publishes only Postgres and Studio, both on 127.0.0.1 behind a variable port', () => {
    for (const [name, definition] of Object.entries(compose.services)) {
      expect(definition.network_mode, `${name} shares the host's network`).toBeUndefined();
      const ports = definition.ports ?? [];
      if (PUBLISHED[name] === undefined) {
        expect(ports, `${name} publishes a port`).toEqual([]);
        continue;
      }
      expect(ports.length, `${name} publishes nothing`).toBeGreaterThan(0);
      for (const entry of ports) {
        expect(loopbackPublish(entry), `${name} publishes ${String(entry)}`).toBe(PUBLISHED[name]);
      }
    }
  });

  it('gives a Coolify domain to Kong alone', () => {
    // `SERVICE_URL_<NAME>_<PORT>` / `SERVICE_FQDN_…` declared on a service is
    // what makes Coolify put that service behind Traefik on a public domain.
    // Any such variable, declared or referenced, must name Kong's own.
    const DOMAIN_VARIABLE = /^SERVICE_(URL|FQDN)_/;
    const declaring = Object.keys(compose.services).filter((name) =>
      [...environment(name).keys()].some((key) => DOMAIN_VARIABLE.test(key)),
    );
    expect(declaring).toEqual(['supabase-kong']);
    const named = references(composeText)
      .map(({ name }) => name)
      .concat([...environment('supabase-kong').keys()])
      .filter((name) => DOMAIN_VARIABLE.test(name));
    for (const name of named) expect(name, 'a Coolify domain for another service').toMatch(/^SERVICE_(URL|FQDN)_SUPABASEKONG(_\d+)?$/);

    // Nor a hand-written Traefik label, nor an `expose:`.
    for (const [name, definition] of Object.entries(compose.services)) {
      expect((definition as { labels?: unknown }).labels, `${name} carries labels`).toBeUndefined();
      expect(definition.expose, `${name} exposes a port`).toBeUndefined();
    }
  });

  it('routes Kong to auth, REST, GraphQL, Storage and Functions only: no Studio, no pg-meta, no catch-all', () => {
    expect(kong.services.length).toBeGreaterThan(0);

    for (const kongService of kong.services) {
      expect(kongService.url, `${kongService.name} reaches Studio`).not.toMatch(/supabase-studio/);
      expect(kongService.url, `${kongService.name} reaches pg-meta`).not.toMatch(/supabase-meta/);
      const paths = (kongService.routes ?? []).flatMap((route) => route.paths ?? []);
      expect(paths.length, `${kongService.name} has no path`).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path, `${kongService.name} is a catch-all`).not.toBe('/');
        expect(
          KONG_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix)),
          `${kongService.name} routes ${path}`,
        ).toBe(true);
      }
    }

    // The plugins a Studio route needs are not even loaded.
    expect(environment('supabase-kong').get('KONG_PLUGINS')).not.toMatch(/basic-auth/);
  });

  it('keeps key-auth, header-only, and the role ACL on the auth, REST and GraphQL routes', () => {
    for (const name of ['auth-v1', 'rest-v1', 'graphql-v1']) {
      const plugins = kong.services.find((candidate) => candidate.name === name)?.plugins ?? [];
      const keyAuth = plugins.find((plugin) => plugin.name === 'key-auth');
      expect(keyAuth, `${name} has no key-auth`).toBeDefined();
      // The mapping reads `headers.apikey`; a query-string key would also be
      // written to Kong's access log.
      expect(keyAuth?.config?.['key_in_query'], `${name} accepts a key in the query`).toBe(false);
      const acl = plugins.find((plugin) => plugin.name === 'acl');
      expect(acl?.config?.['allow'], `${name} ACL`).toEqual(['admin', 'anon']);
      // Kong orders plugins by priority, not by this list: key-auth (1250)
      // and acl (950) run before request-transformer (801), so an unknown key
      // is refused before any mapping.
      expect(plugins.some((plugin) => plugin.name === 'request-transformer'), name).toBe(true);
    }
  });
});

describe('the self-hosted stack (story 20.1): keys and secrets (AD-17)', () => {
  it('maps each opaque key to its role JWT at the gateway, as the CLI does', () => {
    const env = environment('supabase-kong');

    expect(env.get('SUPABASE_PUBLISHABLE_KEY')).toBe('sb_publishable_${SERVICE_PASSWORD_64_PUBLISHABLEKEY}');
    expect(env.get('SUPABASE_SECRET_KEY')).toBe('sb_secret_${SERVICE_PASSWORD_64_SECRETKEY}');
    expect(env.get('SUPABASE_ANON_KEY')).toBe('${SERVICE_SUPABASEANON_KEY}');
    expect(env.get('SUPABASE_SERVICE_KEY')).toBe('${SERVICE_SUPABASESERVICE_KEY}');

    // The CLI's mapping, term for term: a caller's own non-`sb_` bearer passes,
    // the secret key becomes service_role, the publishable key anon.
    expect(kongEntrypoint).toContain("headers.authorization:sub(1, 10) ~= 'Bearer sb_'");
    expect(kongEntrypoint).toContain("(headers.apikey == '$SUPABASE_SECRET_KEY' and 'Bearer $SUPABASE_SERVICE_KEY')");
    expect(kongEntrypoint).toContain(
      "(headers.apikey == '$SUPABASE_PUBLISHABLE_KEY' and 'Bearer $SUPABASE_ANON_KEY')",
    );
    // Substituted by awk, never by `eval`: the Lua `$(…)` must not run as shell.
    expect(kongEntrypoint).toContain('ENVIRON[varname]');
    expect(kongEntrypoint).not.toMatch(/^\s*eval\b/m);
    expect(kongEntrypoint).toContain('exec /docker-entrypoint.sh kong docker-start');
    expect(service('supabase-kong').entrypoint).toEqual(['sh', '/home/kong/kong-entrypoint.sh']);

    const keysOf = (username: string): string[] =>
      (kong.consumers.find((consumer) => consumer.username === username)?.keyauth_credentials ?? []).map(
        (credential) => credential.key,
      );
    expect(keysOf('anon').sort()).toEqual(['$SUPABASE_ANON_KEY', '$SUPABASE_PUBLISHABLE_KEY']);
    expect(keysOf('service_role').sort()).toEqual(['$SUPABASE_SECRET_KEY', '$SUPABASE_SERVICE_KEY']);

    // Every route that forwards a key to a service maps it first.
    for (const name of ['auth-v1', 'rest-v1', 'graphql-v1', 'storage-v1']) {
      const block = kongTemplate.slice(kongTemplate.indexOf(`- name: ${name}\n`));
      const next = block.indexOf('\n            - name: ', 1);
      expect(block.slice(0, next === -1 ? undefined : next), `${name} forwards an unmapped key`).toContain(
        'Authorization: $LUA_AUTH_EXPR',
      );
    }
  });

  it('renders Kong’s config with every key substituted and each opaque key paired with its own role JWT', () => {
    // The compose's own entrypoint, run under `sh` against the compose's own
    // declarative template: what Kong would load, not a reading of the script.
    const { status, stderr, rendered } = runKongEntrypoint(FAKE);
    expect(status, stderr).toBe(0);

    // The same render under busybox's sh and awk, the tools of an Alpine-based
    // Kong image, when the host has busybox (the live rehearsal is the proof).
    if (BUSYBOX !== null) expect(runKongEntrypoint(FAKE, 'busybox')).toEqual({ status: 0, stderr: '', rendered });

    const config = parse(rendered) as KongConfig;

    // No `$NAME` placeholder survives anywhere in what Kong loads.
    expect(rendered).not.toMatch(/\$[A-Za-z_][A-Za-z0-9_]*/);

    const keysOf = (username: string): string[] =>
      (config.consumers.find((consumer) => consumer.username === username)?.keyauth_credentials ?? []).map(
        (credential) => credential.key,
      );
    expect(keysOf('anon').sort()).toEqual([FAKE.SUPABASE_ANON_KEY, FAKE.SUPABASE_PUBLISHABLE_KEY].sort());
    expect(keysOf('service_role').sort()).toEqual([FAKE.SUPABASE_SECRET_KEY, FAKE.SUPABASE_SERVICE_KEY].sort());

    // The whole expression, in order: a caller's own non-`sb_` bearer first,
    // then the SECRET key paired with the SERVICE JWT, then the PUBLISHABLE key
    // paired with the ANON JWT, then the apikey itself. `$((` is literal Lua
    // template syntax for Kong, never run by a shell.
    const expected =
      "$((headers.authorization ~= nil and headers.authorization:sub(1, 10) ~= 'Bearer sb_' and headers.authorization)" +
      ` or (headers.apikey == '${FAKE.SUPABASE_SECRET_KEY}' and 'Bearer ${FAKE.SUPABASE_SERVICE_KEY}')` +
      ` or (headers.apikey == '${FAKE.SUPABASE_PUBLISHABLE_KEY}' and 'Bearer ${FAKE.SUPABASE_ANON_KEY}')` +
      ' or headers.apikey)';

    for (const name of ['auth-v1', 'rest-v1', 'graphql-v1', 'storage-v1']) {
      const route = config.services.find((candidate) => candidate.name === name);
      const transformer = route?.plugins?.find((plugin) => plugin.name === 'request-transformer')?.config as
        | { add?: { headers?: string[] }; replace?: { headers?: string[] } }
        | undefined;
      for (const phase of ['add', 'replace'] as const) {
        const authorization = (transformer?.[phase]?.headers ?? []).filter((header) =>
          header.startsWith('Authorization:'),
        );
        expect(authorization, `${name} ${phase}`).toEqual([`Authorization: ${expected}`]);
      }
    }
  });

  it('refuses to start Kong with an empty or prefix-only opaque key, or an empty role JWT', () => {
    const cases: Record<string, string>[] = [
      { SUPABASE_SECRET_KEY: 'sb_secret_' },
      { SUPABASE_SECRET_KEY: '' },
      { SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(31)}` },
      { SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' },
      { SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(31)}` },
      { SUPABASE_SECRET_KEY: `${'s'.repeat(42)}` },
      { SUPABASE_ANON_KEY: '' },
      { SUPABASE_SERVICE_KEY: '' },
      // A character that would break out of the Lua string or the YAML.
      { SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(32)}'or'1` },
      { SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(32)} x` },
      { SUPABASE_SERVICE_KEY: "eyJfake.service.sig'" },
      { SUPABASE_ANON_KEY: 'eyJfake.anon\\sig' },
      // One credential for two roles.
      { SUPABASE_SECRET_KEY: `sb_secret_${'p'.repeat(64)}` },
      { SUPABASE_SERVICE_KEY: FAKE.SUPABASE_ANON_KEY },
    ];
    for (const shell of BUSYBOX === null ? (['host'] as const) : (['host', 'busybox'] as const)) {
      for (const override of cases) {
        const { status, rendered } = runKongEntrypoint({ ...FAKE, ...override }, shell);
        expect(status, `${shell} ${JSON.stringify(override)}`).not.toBe(0);
        expect(rendered).toBe('');
      }
    }

    // And an unset one, not merely an empty one.
    const { SUPABASE_SECRET_KEY: _unset, ...withoutSecret } = FAKE;
    expect(runKongEntrypoint(withoutSecret).status).not.toBe(0);
  });

  it('gives the functions the same opaque keys Kong maps, and no JWT, signing secret or database password', () => {
    const functions = environment('supabase-edge-functions');
    const gateway = environment('supabase-kong');

    expect(functions.get('SHIFT_SECRET_KEY')).toBe(gateway.get('SUPABASE_SECRET_KEY'));
    expect(functions.get('SHIFT_PUBLISHABLE_KEY')).toBe(gateway.get('SUPABASE_PUBLISHABLE_KEY'));
    expect(functions.get('SUPABASE_URL'), 'the functions call the internal gateway').toBe('http://supabase-kong:8000');

    const values = [...functions.values()].join('\n');
    expect(values).not.toMatch(/SERVICE_PASSWORD_JWT|SERVICE_SUPABASE(ANON|SERVICE)_KEY|SERVICE_PASSWORD_POSTGRES/);
  });

  it('gives the functions every variable their configuration reads, from the right source', () => {
    // The names `readConfiguration` reads in both handlers
    // (`supabase/functions/{admin-auth,notify}/handler.ts`), and where each
    // comes from on this stack.
    const functions = environment('supabase-edge-functions');
    const expected: Readonly<Record<string, RegExp>> = {
      SUPABASE_URL: /^http:\/\/supabase-kong:8000$/,
      SHIFT_SECRET_KEY: /^sb_secret_\$\{SERVICE_PASSWORD_64_SECRETKEY\}$/,
      SHIFT_PUBLISHABLE_KEY: /^sb_publishable_\$\{SERVICE_PASSWORD_64_PUBLISHABLEKEY\}$/,
      SHIFT_ALLOWED_ORIGINS: /^\$\{SHIFT_APP_URL:\?\}$/,
      SHIFT_APP_URL: /^\$\{SHIFT_APP_URL:\?\}$/,
      // 64 generated alphanumerics: `notify`'s /^[A-Za-z0-9_-]{32,}$/.
      NOTIFY_INVOKE_SECRET: /^\$\{SERVICE_PASSWORD_64_[A-Z]+\}$/,
      NOTIFY_EMAIL_FROM: /^\$\{NOTIFY_EMAIL_FROM:\?\}$/,
      RESEND_API_KEY: /^\$\{RESEND_API_KEY:\?\}$/,
      VAPID_PUBLIC_KEY: /^\$\{VAPID_PUBLIC_KEY:\?\}$/,
      VAPID_PRIVATE_KEY: /^\$\{VAPID_PRIVATE_KEY:\?\}$/,
      VAPID_SUBJECT: /^\$\{VAPID_SUBJECT:\?\}$/,
    };
    for (const [name, source] of Object.entries(expected)) {
      expect(functions.get(name), `supabase-edge-functions ${name}`).toMatch(source);
    }

    // And the handlers still read exactly these names, so a rename on either
    // side fails here.
    const read = new Set<string>();
    for (const handler of ['admin-auth', 'notify']) {
      const text = readFileSync(join(repoRoot, 'supabase', 'functions', handler, 'handler.ts'), 'utf8');
      for (const match of text.matchAll(/\b(?:read|getEnv)\('([A-Z][A-Z0-9_]*)'\)/g)) read.add(match[1] ?? '');
    }
    expect(read.size, 'the handlers read no variable').toBeGreaterThan(10);
    for (const name of read) expect(Object.keys(expected), `${name} is read but not supplied`).toContain(name);
  });

  it('puts only the generated Postgres password in every connection URL', () => {
    for (const name of Object.keys(compose.services)) {
      for (const [key, value] of environment(name)) {
        const userinfo = /^[a-z]+:\/\/[^:/@]+:([^@]*)@/.exec(value);
        if (userinfo === null) continue;
        expect(userinfo[1], `${name} ${key}`).toBe('${SERVICE_PASSWORD_POSTGRES}');
      }
    }
  });

  it('gives the JWT signing secret to GoTrue, PostgREST and Storage only: never Kong, Studio or edge-runtime', () => {
    // By name, with any modifier and in either `$X` or `${X…}` form.
    const holders = Object.keys(compose.services).filter((name) =>
      [...environment(name).values()].some(
        (value) =>
          references(value).some((reference) => reference.name === 'SERVICE_PASSWORD_JWT') ||
          /\$SERVICE_PASSWORD_JWT\b/.test(value),
      ),
    );

    expect(holders.sort()).toEqual([...JWT_SECRET_HOLDERS].sort());
  });

  it('defaults no secret, generated or operator-set', () => {
    expect(defaultedSecrets(composeText)).toEqual([]);

    // Each operator secret is required, so the stack refuses to start without it.
    for (const name of OPERATOR_SECRETS) {
      expect(composeText, `${name} is not required`).toContain(`\${${name}:?}`);
    }
  });

  it('takes every secret-named variable from Coolify’s generator or an operator secret', () => {
    // `PASSWORD` at the end: `GOTRUE_PASSWORD_MIN_LENGTH` is a setting.
    const SECRET_NAME = /PASSWORD$|SECRET|_KEY$/;
    const operator = new RegExp(`^\\$\\{(${OPERATOR_SECRETS.join('|')}):\\?\\}$`);

    for (const name of Object.keys(compose.services)) {
      for (const [key, value] of environment(name)) {
        if (!SECRET_NAME.test(key) || key === 'VAPID_PUBLIC_KEY') continue;
        const generated = references(value).some((reference) => GENERATED_SECRET.test(reference.name));
        expect(generated || operator.test(value), `${name} ${key}=${value}`).toBe(true);
      }
    }
  });
});

describe('the self-hosted stack (story 20.1): limits and environment templates', () => {
  const staging = envTemplate('staging.env.example');
  const production = envTemplate('production.env.example');

  it('limits every service’s memory and CPU, staging (the defaults) below production', () => {
    let stagingMemory = 0;
    let productionMemory = 0;
    let stagingCpus = 0;

    for (const [name, definition] of Object.entries(compose.services)) {
      const memory = defaulted(definition.mem_limit);
      const cpus = defaulted(definition.cpus);
      expect(memory, `${name} has no defaulted mem_limit`).not.toBeNull();
      expect(cpus, `${name} has no defaulted cpus`).not.toBeNull();
      const [memoryName = '', memoryDefault = ''] = memory ?? [];
      const [cpusName = '', cpusDefault = ''] = cpus ?? [];

      // The compose default IS staging's value, so a missing variable fails low.
      expect(staging.get(memoryName), `staging ${memoryName}`).toBe(memoryDefault);
      expect(staging.get(cpusName), `staging ${cpusName}`).toBe(cpusDefault);

      const productionMemoryValue = production.get(memoryName) ?? '';
      const productionCpusValue = production.get(cpusName) ?? '';
      // Strictly lower, per service: staging can never match production's share.
      expect(mebibytes(memoryDefault), `${name}: staging memory not below production`).toBeLessThan(
        mebibytes(productionMemoryValue),
      );
      expect(Number(cpusDefault), `${name}: staging CPU not below production`).toBeLessThan(
        Number(productionCpusValue),
      );

      stagingMemory += mebibytes(memoryDefault);
      productionMemory += mebibytes(productionMemoryValue);
      stagingCpus += Number(cpusDefault);
    }

    expect(stagingMemory, 'staging is not below production').toBeLessThan(productionMemory);
    expect(stagingMemory / 1024, 'staging ≈ 2.2 GiB').toBeGreaterThanOrEqual(2.0);
    expect(stagingMemory / 1024, 'staging ≈ 2.2 GiB').toBeLessThanOrEqual(2.3);
    expect(productionMemory / 1024, 'production ≈ 2.9 GiB').toBeGreaterThanOrEqual(2.8);
    expect(productionMemory / 1024, 'production ≈ 2.9 GiB').toBeLessThanOrEqual(3.0);
    expect(stagingCpus, 'staging ≈ 1.0 CPU in all').toBeLessThanOrEqual(1.0 + 1e-9);
  });

  it('names every operator input in both templates, and nothing Coolify generates', () => {
    const operatorInputs = new Set(
      references(composeText)
        .map(({ name }) => name)
        .filter((name) => !name.startsWith('SERVICE_')),
    );

    expect([...staging.keys()].sort()).toEqual([...production.keys()].sort());
    expect([...operatorInputs].filter((name) => !staging.has(name)), 'missing from the templates').toEqual([]);
    expect([...staging.keys()].filter((name) => !operatorInputs.has(name)), 'unused by the compose').toEqual([]);
    expect([...staging.keys()].filter((name) => name.startsWith('SERVICE_'))).toEqual([]);
  });

  it('holds placeholders only: no secret value, no address, no port', () => {
    for (const [file, template] of [
      ['staging.env.example', staging],
      ['production.env.example', production],
    ] as const) {
      for (const name of OPERATOR_SECRETS) {
        expect(template.get(name), `${file} carries a ${name} value`).toBe('');
      }
      expect(template.get('VAPID_PUBLIC_KEY'), `${file} carries a VAPID public key`).toBe('');
      for (const name of ['POSTGRES_LOOPBACK_PORT', 'STUDIO_LOOPBACK_PORT']) {
        expect(template.get(name), `${file} ${name}`).toBe('<loopback-port>');
      }
      expect(template.get('SHIFT_APP_URL'), `${file} SHIFT_APP_URL`).toMatch(/^https:\/\/[a-z.]*<domain>$/);
    }
  });
});

describe('the self-hosted stack (story 20.1): the public repository', () => {
  const deployFiles = collectFiles(deployRoot, (file) => statSync(file).isFile());

  it('has files to read', () => {
    expect(readdirSync(stackRoot).sort()).toEqual([
      'docker-compose.yml',
      'production.env.example',
      'staging.env.example',
    ]);
    expect(deployFiles.length).toBeGreaterThan(0);
  });

  it('holds no IPv4 address under deploy/, in DEPLOY.md or in the 20.1 spec but the loopback and the in-container wildcard', () => {
    // `0.0.0.0` is allowed as an in-container bind address (GoTrue, Studio) and
    // nowhere in `ports:`, which the exposure test holds. An image tag can look
    // like an address (`supabase/postgres:17.6.1.165`), so the pinned tags are
    // not addresses either.
    const allowed = new Set([
      '127.0.0.1',
      '0.0.0.0',
      ...Object.values(CLI_IMAGES).map((image) => image.slice(image.lastIndexOf(':') + 1)),
    ]);
    const offences: string[] = [];
    for (const file of [...deployFiles, DEPLOY_DOC, SPEC_FILE]) {
      for (const literal of ipv4Literals(readFileSync(file, 'utf8'))) {
        if (!allowed.has(literal)) offences.push(`${relative(repoRoot, file)}: ${literal}`);
      }
    }

    expect(offences).toEqual([]);
  });

  it('names no host but the stack’s own services, the loopback and placeholders', () => {
    const services = new Set(Object.keys(compose.services));
    // DEPLOY.md's own self-hosting section only: the hosted sections before it
    // name hosted platforms until 20.9 rewrites them.
    const deployText = readFileSync(DEPLOY_DOC, 'utf8');
    const at = deployText.indexOf('## 9. Self-hosted stack');
    expect(at, 'DEPLOY.md has no self-hosted section').toBeGreaterThan(0);
    const selfHosted = deployText.slice(at);

    // The compose's HEADER may cite the upstream template (github.com), and the
    // spec its upstream sources; nothing else may name an outside host.
    const composeHeader = composeText.slice(0, composeText.indexOf('\nservices:'));
    const texts: [string, string, readonly string[]][] = [
      ...deployFiles
        .filter((file) => !file.endsWith('docker-compose.yml'))
        .map((file): [string, string, readonly string[]] => [file, readFileSync(file, 'utf8'), []]),
      ['docker-compose.yml (header)', composeHeader, ['github.com']],
      ['docker-compose.yml (body)', composeText.slice(composeHeader.length), []],
      ['DEPLOY.md §9', selfHosted, []],
      [SPEC_FILE, readFileSync(SPEC_FILE, 'utf8'), ['github.com']],
    ];

    const offences: string[] = [];
    for (const [label, text, outside] of texts) {
      const where = label.startsWith('/') ? relative(repoRoot, label) : label;
      if (/\.ts\.net\b/.test(text)) offences.push(`${where}: a tailnet name`);
      // `scheme://[userinfo@]host`; `pg-functions://postgres/…` names a database, not a host.
      for (const match of text.matchAll(/\b([a-z][a-z0-9+.-]*):\/\/(?:[^@\s/]*@)?([^/\s:'"`)]+)/g)) {
        const [, scheme = '', host = ''] = match;
        if (scheme === 'pg-functions') continue;
        if (services.has(host) || host === '127.0.0.1' || host.includes('<') || host.startsWith('$')) continue;
        if (outside.includes(host)) continue;
        offences.push(`${where}: ${host}`);
      }
    }

    expect(offences).toEqual([]);
  });
});

describe('the self-hosted stack (story 20.1): the checkers themselves', () => {
  it('accepts a loopback publish behind a required variable, and nothing else', () => {
    expect(loopbackPublish('127.0.0.1:${POSTGRES_LOOPBACK_PORT:?}:5432')).toBe('5432');
    expect(loopbackPublish('5432:5432')).toBeNull();
    expect(loopbackPublish('0.0.0.0:5432:5432')).toBeNull();
    expect(loopbackPublish('[::]:5432:5432')).toBeNull();
    expect(loopbackPublish('127.0.0.1:54322:5432'), 'a literal host port').toBeNull();
    expect(loopbackPublish('${PORT}:5432')).toBeNull();
    expect(loopbackPublish({ target: 5432, published: 5432 })).toBeNull();
  });

  it('refuses an unpinned or latest image', () => {
    expect(pinned('kong:2.8.1')).toBe(true);
    expect(pinned('kong')).toBe(false);
    expect(pinned('kong:latest')).toBe(false);
    expect(pinned(undefined)).toBe(false);
  });

  it('refuses a defaulted secret, both forms, and allows a bare or required one', () => {
    expect(defaultedSecrets('X=${SERVICE_PASSWORD_X:-abc}')).toEqual(['${SERVICE_PASSWORD_X:-abc}']);
    expect(defaultedSecrets('X=${SERVICE_PASSWORD_X-abc}')).toEqual(['${SERVICE_PASSWORD_X-abc}']);
    expect(defaultedSecrets('X=${RESEND_API_KEY:-re_x}')).toEqual(['${RESEND_API_KEY:-re_x}']);
    expect(defaultedSecrets('X=${SERVICE_PASSWORD_X}')).toEqual([]);
    expect(defaultedSecrets('X=${RESEND_API_KEY:?}')).toEqual([]);
    expect(defaultedSecrets('X=${DB_MEM_LIMIT:-512m}'), 'a limit is not a secret').toEqual([]);
  });

  it('finds an address but not a version, and parses sizes', () => {
    expect(ipv4Literals('host 10.1.2.3 here')).toEqual(['10.1.2.3']);
    expect(ipv4Literals('v1.70.3 and 2.8.1')).toEqual([]);
    expect(mebibytes('1g')).toBe(1024);
    expect(mebibytes('384m')).toBe(384);
    expect(defaulted('${DB_CPUS:-0.25}')).toEqual(['DB_CPUS', '0.25']);
    expect(defaulted('512m')).toBeNull();
  });

  it('reads an env template’s quoted values and refuses a line with no `=`', () => {
    const parsed = parseEnvTemplate('# note\n\nA=1\nB="Shift <x@<domain>>"\nC=\n');
    expect([...parsed.entries()]).toEqual([
      ['A', '1'],
      ['B', 'Shift <x@<domain>>'],
      ['C', ''],
    ]);
    expect(() => parseEnvTemplate('A=1\nnot a pair\n')).toThrow(/not a KEY=value line/);
    expect(() => parseEnvTemplate('=value\n')).toThrow(/not a KEY=value line/);
  });
});
