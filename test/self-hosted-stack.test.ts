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
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { authEmailTemplates } from '../apps/web/src/lib/auth-email.ts';
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

/**
 * The services that take a role's key and map it to its JWT (story 19.1 split
 * the auth catch-all into AD-22's allow-list; the admin API takes the secret
 * key alone and is checked beside these).
 */
const KEYED_SERVICES = [
  'auth-v1-mail',
  'auth-v1-token',
  'auth-v1-verify',
  'auth-v1-user',
  'auth-v1-logout',
  'auth-v1-health',
  'rest-v1-create-organization',
  'rest-v1',
  'graphql-v1',
];

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

interface KongRoute {
  name?: string;
  strip_path?: boolean;
  methods?: string[];
  paths?: string[];
}

interface KongService {
  name: string;
  url: string;
  routes?: KongRoute[];
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
const logRedaction = boundContent('supabase-kong', '/home/kong/log-redaction.conf');

/** The `FROM` of the `shift-functions` image (story 20.2). */
const FUNCTIONS_BASE =
  /^FROM\s+(\S+)\s*$/m.exec(readFileSync(join(deployRoot, 'functions', 'Dockerfile'), 'utf8'))?.[1] ?? '';

/**
 * nginx's `map` in `log-redaction.conf`, applied as nginx applies it: the
 * regex rules in order (`~*` case-insensitive), the first match wins, its
 * named captures substituted into the value as `$name`; otherwise `default`.
 * PCRE's and JavaScript's syntax agree on every construct the rules use; the
 * rules were also run in the pinned Kong (spec, Verification).
 */
function loggedUri(requestUri: string): string {
  const body = /map \$request_uri \$shift_logged_uri \{([^}]*)\}/.exec(logRedaction)?.[1];
  expect(body, 'log-redaction.conf has no map of $request_uri').toBeDefined();
  for (const line of (body ?? '').split('\n').map((text) => text.trim())) {
    const rule = /^"(~\*?)(.*)" "(.*)";$/.exec(line);
    if (rule === null) continue;
    const match = new RegExp(rule[2] ?? '', rule[1] === '~*' ? 'i' : '').exec(requestUri);
    if (match === null) continue;
    return (rule[3] ?? '').replace(/\$([a-z_]+)/g, (_, name: string) => match.groups?.[name] ?? '');
  }
  expect(body).toMatch(/^\s*default \$request_uri;$/m);
  return requestUri;
}
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

/**
 * The per-IP limits' staging values (AD-21 as amended by story 19.1), which
 * are the compose's defaults and both templates' values until D-S5.
 */
const STAGING_LIMITS = {
  SHIFT_LIMIT_MAIL_HOUR: '5',
  SHIFT_LIMIT_MAIL_DAY: '20',
  SHIFT_LIMIT_TOKEN_MINUTE: '60',
  SHIFT_LIMIT_TOKEN_HOUR: '1440',
  SHIFT_LIMIT_VERIFY_MINUTE: '15',
  SHIFT_LIMIT_VERIFY_HOUR: '360',
  SHIFT_LIMIT_CREATE_ORGANIZATION_HOUR: '10',
} as const;

/** Fixed fake values for running Kong's entrypoint: none is a real key, and the network is TEST-NET-1. */
const FAKE = {
  SUPABASE_ANON_KEY: 'eyJfake.anon.sig',
  SUPABASE_SERVICE_KEY: 'eyJfake.service.sig',
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(64)}`,
  SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(32)}`,
  SHIFT_APP_URL: 'https://app.example.test',
  KONG_TRUSTED_IPS: '192.0.2.0/24',
  ...STAGING_LIMITS,
} as const;

/** A made-up password for the mail-route bodies, joined so no secret scanner reads it as a credential. */
const FAKE_PASSWORD = ['lozinka', '1234'].join('-');

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
      // Story 20.2: the functions run a CI-built image whose BASE is the pin.
      if (name === 'supabase-edge-functions') {
        expect(service(name).image, 'the functions image is not the per-environment reference').toBe(
          '${SHIFT_FUNCTIONS_IMAGE:?}',
        );
        expect(FUNCTIONS_BASE, `the functions image's base is not at CLI ${CLI_VERSION}'s version`).toBe(image);
        continue;
      }
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
    for (const name of [...KEYED_SERVICES, 'auth-v1-admin']) {
      const plugins = kong.services.find((candidate) => candidate.name === name)?.plugins ?? [];
      const keyAuth = plugins.find((plugin) => plugin.name === 'key-auth');
      expect(keyAuth, `${name} has no key-auth`).toBeDefined();
      // The mapping reads `headers.apikey`; a query-string key would also be
      // written to Kong's access log.
      expect(keyAuth?.config?.['key_in_query'], `${name} accepts a key in the query`).toBe(false);
      const acl = plugins.find((plugin) => plugin.name === 'acl');
      // Story 19.1: the admin API answers the secret key alone.
      expect(acl?.config?.['allow'], `${name} ACL`).toEqual(name === 'auth-v1-admin' ? ['admin'] : ['admin', 'anon']);
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
    for (const name of [...KEYED_SERVICES, 'auth-v1-admin', 'storage-v1']) {
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

    for (const name of [...KEYED_SERVICES, 'auth-v1-admin', 'storage-v1']) {
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
      // The router's own (story 20.2): GoTrue on the stack's network.
      SHIFT_AUTH_URL: /^http:\/\/supabase-auth:9999$/,
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

describe('the self-hosted stack (story 20.2): the functions route, its CORS and the access log', () => {
  const functionsRoute = (config: KongConfig): KongService | undefined =>
    config.services.find((candidate) => candidate.name === 'functions-v1');

  it('runs the shift-functions image with the router as its main service, after GoTrue', () => {
    const definition = service('supabase-edge-functions') as Service & {
      command?: string[];
      depends_on?: Record<string, { condition?: string }>;
      healthcheck?: { test?: string[] };
    };
    expect(definition.command).toEqual(['start', '--main-service', '/home/deno/functions/main']);
    // The router asks GoTrue for every `verify_jwt` call.
    expect(definition.depends_on?.['supabase-auth']?.condition).toBe('service_healthy');
    expect(definition.depends_on?.['supabase-kong']?.condition).toBe('service_healthy');
    // A real probe (the main service listens), no longer the template's `echo`.
    expect(definition.healthcheck?.test).toEqual(['CMD', 'bash', '-c', 'exec 3<>/dev/tcp/127.0.0.1/9000']);
  });

  it('forwards /functions/v1/ with no key-auth, and answers CORS for the app’s origin alone', () => {
    const route = functionsRoute(kong);
    expect(route?.url).toBe('http://supabase-edge-functions:9000/');
    // The router reads the function's name from the first path segment, so
    // Kong must strip `/functions/v1/` before forwarding.
    expect(route?.routes).toEqual([{ name: 'functions-v1-all', strip_path: true, paths: ['/functions/v1/'] }]);
    const plugins = route?.plugins ?? [];
    // The router is the gate: the invoke secret and a feed token are not keys.
    expect(plugins.map((plugin) => plugin.name)).toEqual(['cors']);
    expect(plugins[0]?.config).toEqual({
      origins: ['$SHIFT_APP_URL'],
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
      max_age: 3600,
    });
    expect(environment('supabase-kong').get('SHIFT_APP_URL')).toBe('${SHIFT_APP_URL:?}');

    // Rendered by the compose's own entrypoint: the origin itself, nothing wider.
    const { status, stderr, rendered } = runKongEntrypoint(FAKE);
    expect(status, stderr).toBe(0);
    expect(functionsRoute(parse(rendered) as KongConfig)?.plugins?.[0]?.config?.['origins']).toEqual([
      FAKE.SHIFT_APP_URL,
    ]);
  });

  it('refuses to start Kong with an app origin that is not a plain http(s) origin', () => {
    // Kong 2.8's cors plugin reads an origin with any character outside
    // [A-Za-z0-9.:/-] as a REGEX; a path never equals a browser's Origin.
    const cases = [
      '',
      'app.example.test',
      'ftp://app.example.test',
      'https://',
      'https://app.example.test/',
      'https://app.example.test/x',
      'https://*.example.test',
      'https://app.example.test,https://other.test',
      "https://app.example.test'",
      'https://app.example.test x',
      'https://:443',
      'https://App.Example.test',
      'https://app.example.test:',
      'https://app.example.test:443',
      'http://app.example.test:80',
    ];
    for (const shell of BUSYBOX === null ? (['host'] as const) : (['host', 'busybox'] as const)) {
      for (const origin of cases) {
        const { status, rendered } = runKongEntrypoint({ ...FAKE, SHIFT_APP_URL: origin }, shell);
        expect(status, `${shell} ${JSON.stringify(origin)}`).not.toBe(0);
        expect(rendered).toBe('');
      }
      const { status } = runKongEntrypoint({ ...FAKE, SHIFT_APP_URL: 'http://127.0.0.1:5173' }, shell);
      expect(status, `${shell} a local origin with a port`).toBe(0);
    }
  });

  it('writes the access log in the redacting format, which never logs a query, a token path or a referer', () => {
    const env = environment('supabase-kong');
    expect(env.get('KONG_PROXY_ACCESS_LOG')).toBe('/dev/stdout shift_redacted');
    expect(env.get('KONG_NGINX_HTTP_INCLUDE')).toBe('/home/kong/log-redaction.conf');

    const format = /^log_format shift_redacted '(.*)';$/m.exec(logRedaction)?.[1];
    expect(format, 'no shift_redacted log_format').toBeDefined();
    expect(format).toContain('$shift_logged_uri');
    // Nothing that carries the raw URI, the query or the referer.
    for (const variable of ['$request ', '$request"', '$request_uri', '$uri', '$args', '$query_string', '$arg_', '$http_referer', '$http_authorization', '$http_apikey']) {
      expect(format, variable).not.toContain(variable);
    }
    // No brace form, which Coolify would read as its own variable.
    expect(logRedaction).not.toMatch(/\$\{/);
  });

  it('redacts a function’s path after its name, and every query string', () => {
    const cases: [string, string][] = [
      // NFR-27: v2's calendar feed, however the path is spelled.
      ['/functions/v1/calendar-feed/SECRET', '/functions/v1/calendar-feed[redacted]'],
      ['/functions/v1/calendar-feed/SECRET/x.ics?y=1', '/functions/v1/calendar-feed[redacted]'],
      ['/functions/v1/calendar-feed%2FSECRET', '/functions/v1/calendar-feed[redacted]'],
      ['//functions/v1/calendar-feed/SECRET', '//functions/v1/calendar-feed[redacted]'],
      ['/FUNCTIONS/V1/Calendar-Feed/SECRET', '/FUNCTIONS/V1/Calendar-Feed[redacted]'],
      ['/functions/v1/notify?token=SECRET', '/functions/v1/notify[redacted]'],
      ['/functions/v1/notify', '/functions/v1/notify'],
      ['/functions/v1/admin-auth', '/functions/v1/admin-auth'],
      // Storage's signed URL, and any other query.
      ['/storage/v1/object/sign/organization-logos/a.png?token=SECRET', '/storage/v1/object/sign/organization-logos/a.png?[redacted]'],
      ['/rest/v1/members?select=id', '/rest/v1/members?[redacted]'],
      ['/rest/v1/x?next=/functions/v1/calendar-feed/SECRET', '/rest/v1/x?[redacted]'],
      ['/auth/v1/user', '/auth/v1/user'],
    ];
    for (const [sent, logged] of cases) {
      expect(loggedUri(sent), sent).toBe(logged);
      expect(loggedUri(sent), sent).not.toContain('SECRET');
    }
  });

  it('names the functions image per environment, as a placeholder in both templates', () => {
    // Story 20.6: the environment's channel tag, which the pipeline moves to
    // the probed digest; the owner stays a placeholder (public repository).
    for (const [file, environment] of [
      ['staging.env.example', 'staging'],
      ['production.env.example', 'production'],
    ] as const) {
      expect(envTemplate(file).get('SHIFT_FUNCTIONS_IMAGE'), file).toBe(
        `ghcr.io/<owner>/shift-functions:${environment}`,
      );
    }
  });

  it('pulls the functions image on every start, so a moved channel tag is never stale (story 20.6)', () => {
    const pullPolicy = (name: string): unknown => (service(name) as Service & { pull_policy?: string }).pull_policy;
    expect(pullPolicy('supabase-edge-functions')).toBe('always');
    // Every other image is pinned by version: pulling it again changes nothing.
    expect(Object.keys(compose.services).filter((name) => pullPolicy(name) !== undefined)).toEqual([
      'supabase-edge-functions',
    ]);
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

// ------------------------------------------------------- story 19.1: the door

/** AD-12's vectors, shared by every home of the predicate. */
const ADDRESS_VECTORS = (
  JSON.parse(readFileSync(join(repoRoot, 'test', 'fixtures', 'synthesized-addresses.json'), 'utf8')) as {
    vectors: { address: string; kind: 'synthesized' | 'email' | 'malformed' }[];
  }
).vectors;

/** The subset of fengari (Lua 5.3 in JavaScript) this file uses. */
interface Fengari {
  lua: {
    LUA_OK: number;
    lua_pcall(state: unknown, args: number, results: number, handler: number): number;
    lua_setglobal(state: unknown, name: Uint8Array): void;
    lua_getglobal(state: unknown, name: Uint8Array): number;
    lua_pushstring(state: unknown, value: Uint8Array): void;
    lua_pushnil(state: unknown): void;
    lua_pushinteger(state: unknown, value: number): void;
    lua_tostring(state: unknown, index: number): Uint8Array;
    lua_pop(state: unknown, count: number): void;
  };
  lauxlib: {
    luaL_newstate(): unknown;
    luaL_loadstring(state: unknown, code: Uint8Array): number;
  };
  lualib: { luaL_openlibs(state: unknown): void };
  to_luastring(value: string): Uint8Array;
  to_jsstring(value: Uint8Array): string;
}

const fengari = createRequire(import.meta.url)('fengari') as Fengari;

/** A fresh Lua state with the standard libraries, as Kong's sandbox has them. */
function luaState(): unknown {
  const state = fengari.lauxlib.luaL_newstate();
  fengari.lualib.luaL_openlibs(state);
  return state;
}

/** Whether a chunk compiles; the error message when it does not. */
function luaCompiles(code: string): string | null {
  const state = luaState();
  const status = fengari.lauxlib.luaL_loadstring(state, fengari.to_luastring(code));
  return status === fengari.lua.LUA_OK ? null : fengari.to_jsstring(fengari.lua.lua_tostring(state, -1));
}

/** The rendered config, by the compose's own entrypoint with the fake inputs. */
function renderedKong(): KongConfig {
  const { status, stderr, rendered } = runKongEntrypoint(FAKE);
  expect(status, stderr).toBe(0);
  return parse(rendered) as KongConfig;
}

function kongService(config: KongConfig, name: string): KongService {
  const found = config.services.find((candidate) => candidate.name === name);
  expect(found, `Kong has no ${name}`).toBeDefined();
  return found ?? { name, url: '' };
}

function pluginOf(definition: KongService, name: string): Record<string, unknown> | undefined {
  return definition.plugins?.find((plugin) => plugin.name === name)?.config;
}

/** Every access-phase chunk of a service's `pre-function` or `post-function`, in order. */
function phaseChunks(definition: KongService, plugin: 'pre-function' | 'post-function'): string[] {
  return (pluginOf(definition, plugin)?.['access'] as string[] | undefined) ?? [];
}

/** Every Lua chunk a service runs in the access phase, the pre-function's first, as Kong orders them. */
function accessChunks(definition: KongService): string[] {
  return [...phaseChunks(definition, 'pre-function'), ...phaseChunks(definition, 'post-function')];
}

/** The service's own access-phase Lua: the post-function's last chunk. */
function accessLua(definition: KongService): string {
  const access = phaseChunks(definition, 'post-function');
  expect(access.length, `${definition.name} has no post-function`).toBeGreaterThan(0);
  return access.at(-1) ?? '';
}

/**
 * The raw paths a service's pre-function lets through (story 19.1's
 * rehearsal: Kong 2.8 matches a regex route on the normalized path, so each
 * route refuses any spelling but its own, before any other plugin), or
 * `null` when it has no such table.
 */
function guardedPaths(definition: KongService): string[] | null {
  const first = phaseChunks(definition, 'pre-function')[0] ?? '';
  const table = /^\s*local allowed = \{ (.*) \}$/m.exec(first)?.[1];
  if (table === undefined) return null;
  expect(first).toContain('if not allowed[kong.request.get_path()] then');
  expect(first).toContain(`return kong.response.exit(404, '{"message":"no Route matched with those values"}'`);
  return [...table.matchAll(/\["([^"]+)"\] = true/g)].map((match) => match[1] ?? '');
}

/**
 * A stand-in for Kong's PDK, ngx and the two modules the sandbox may require,
 * in Lua, so the rendered chunks RUN here: `kong.response.exit` records the
 * answer and stops the chunk (as ngx.exit does), `ngx.timer.at` records the
 * callback, which runs after the chunks, and `resty.http` records each relay.
 * `cjson.safe` is a small JSON reader and writer (the writer sorts keys).
 * fengari is Lua 5.3 and Kong runs LuaJIT: only the rehearsal (spec,
 * Verification) proves the chunks run on the pinned image.
 */
const KONG_STAND_IN = String.raw`
local json = { null = setmetatable({}, { __tostring = function() return "null" end }) }
local function skip(s, i) return (s:find("[^ \t\r\n]", i)) or (#s + 1) end
local value_at
local function string_at(s, i)
  local out, j = {}, i + 1
  while true do
    local c = s:sub(j, j)
    if c == "" then error("unterminated string") end
    if c == '"' then return table.concat(out), j + 1 end
    if c == "\\" then
      local e = s:sub(j + 1, j + 1)
      local map = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
      if map[e] then out[#out + 1] = map[e]; j = j + 2
      elseif e == "u" then
        local code = tonumber(s:sub(j + 2, j + 5), 16)
        if not code then error("bad escape") end
        out[#out + 1] = utf8.char(code); j = j + 6
      else error("bad escape") end
    else out[#out + 1] = c; j = j + 1 end
  end
end
value_at = function(s, i)
  i = skip(s, i)
  local c = s:sub(i, i)
  if c == "{" then
    local object = {}
    i = skip(s, i + 1)
    if s:sub(i, i) == "}" then return object, i + 1 end
    while true do
      if s:sub(i, i) ~= '"' then error("expected a key") end
      local key; key, i = string_at(s, i)
      i = skip(s, i)
      if s:sub(i, i) ~= ":" then error("expected a colon") end
      local value; value, i = value_at(s, i + 1)
      object[key] = value
      i = skip(s, i)
      local d = s:sub(i, i)
      if d == "}" then return object, i + 1 end
      if d ~= "," then error("expected a comma") end
      i = skip(s, i + 1)
    end
  elseif c == "[" then
    local array = {}
    i = skip(s, i + 1)
    if s:sub(i, i) == "]" then return array, i + 1 end
    while true do
      local value; value, i = value_at(s, i)
      array[#array + 1] = value
      i = skip(s, i)
      local d = s:sub(i, i)
      if d == "]" then return array, i + 1 end
      if d ~= "," then error("expected a comma") end
      i = i + 1
    end
  elseif c == '"' then return string_at(s, i)
  elseif s:sub(i, i + 3) == "true" then return true, i + 4
  elseif s:sub(i, i + 4) == "false" then return false, i + 5
  elseif s:sub(i, i + 3) == "null" then return json.null, i + 4
  end
  local number = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
  if number == nil or number == "" then error("expected a value") end
  return tonumber(number), i + #number
end
function json.decode(s)
  local value, i = value_at(s, 1)
  if skip(s, i) <= #s then error("trailing characters") end
  return value
end
function json.encode(v)
  if v == nil or v == json.null then return "null" end
  local t = type(v)
  if t == "boolean" or t == "number" then return tostring(v) end
  if t == "string" then
    return '"' .. (v:gsub('[%c"\\]', function(c) return string.format("\\u%04x", c:byte()) end)) .. '"'
  end
  if t == "table" then
    if #v > 0 then
      local items = {}
      for _, item in ipairs(v) do items[#items + 1] = json.encode(item) end
      return "[" .. table.concat(items, ",") .. "]"
    end
    local keys = {}
    for key in pairs(v) do keys[#keys + 1] = tostring(key) end
    table.sort(keys)
    local items = {}
    for _, key in ipairs(keys) do items[#items + 1] = json.encode(key) .. ":" .. json.encode(v[key]) end
    return "{" .. table.concat(items, ",") .. "}"
  end
  return json.encode(tostring(v))
end

local EXIT = {}
function run(chunks_json, request_json)
  local chunks = json.decode(chunks_json)
  local request = json.decode(request_json)
  local body = request.body
  if body == json.null then body = nil end
  local record = { relays = {}, logs = {}, timers = 0 }
  local timers = {}
  local cjson = {
    decode = function(s) local ok, value = pcall(json.decode, s); if ok then return value end return nil end,
    encode = json.encode,
    null = json.null,
  }
  local http = {
    new = function()
      return {
        set_timeout = function() end,
        request_uri = function(_, url, options)
          record.relays[#record.relays + 1] = { url = url, method = options.method, body = options.body, headers = options.headers }
          return { status = request.relay_status or 202 }
        end,
      }
    end,
  }
  local env = setmetatable({
    kong = {
      request = {
        get_path = function() return request.path end,
        get_method = function() return request.method end,
        get_raw_body = function() return body end,
      },
      response = {
        exit = function(status, answer, headers)
          record.exit = { status = status, body = answer, headers = headers }
          error(EXIT, 0)
        end,
      },
      client = { get_forwarded_ip = function() return "203.0.113.7" end },
      service = { request = { set_raw_body = function(raw) record.forwarded = raw end } },
    },
    ngx = {
      ERR = "ERR",
      log = function(_, ...)
        local parts = {}
        for _, part in ipairs({ ... }) do parts[#parts + 1] = tostring(part) end
        record.logs[#record.logs + 1] = table.concat(parts)
      end,
      timer = { at = function(_, callback) timers[#timers + 1] = callback; record.timers = record.timers + 1; return true end },
      unescape_uri = function(s) return (s:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end)) end,
    },
    require = function(name)
      if name == "cjson.safe" then return cjson end
      if name == "resty.http" then return http end
      error("the sandbox may not require " .. name)
    end,
  }, { __index = _G })
  for _, code in ipairs(chunks) do
    local chunk, problem = load(code, "chunk", "t", env)
    if not chunk then record.error = problem; break end
    local ok, failure = pcall(chunk)
    if not ok then
      if failure ~= EXIT then record.error = tostring(failure) end
      break
    end
  end
  for _, callback in ipairs(timers) do callback(false) end
  return json.encode(record)
end
`;

interface KongRelay {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

interface KongRun {
  exit?: { status: number; body: string; headers?: Record<string, string> };
  relays: KongRelay[];
  logs: string[];
  timers: number;
  forwarded?: string;
  error?: string;
}

interface KongRequest {
  path: string;
  method: string;
  /** The raw body; `null` is a body Kong could not read. */
  body: string | null;
  /** What the stand-in GoTrue answers a relay with (default 202). */
  relay_status?: number;
}

let standIn: unknown = null;

/** Runs a service's rendered access-phase Lua, pre-function first, against one request. */
function runKongLua(definition: KongService, request: KongRequest): KongRun {
  if (standIn === null) {
    standIn = luaState();
    expect(fengari.lauxlib.luaL_loadstring(standIn, fengari.to_luastring(KONG_STAND_IN))).toBe(fengari.lua.LUA_OK);
    expect(fengari.lua.lua_pcall(standIn, 0, 0, 0)).toBe(fengari.lua.LUA_OK);
  }
  const state = standIn;
  fengari.lua.lua_getglobal(state, fengari.to_luastring('run'));
  fengari.lua.lua_pushstring(state, fengari.to_luastring(JSON.stringify(accessChunks(definition))));
  fengari.lua.lua_pushstring(state, fengari.to_luastring(JSON.stringify(request)));
  const status = fengari.lua.lua_pcall(state, 2, 1, 0);
  const answer = fengari.to_jsstring(fengari.lua.lua_tostring(state, -1));
  fengari.lua.lua_pop(state, 1);
  expect(status, answer).toBe(fengari.lua.LUA_OK);
  // The writer cannot tell an empty list from an empty object.
  const parsed = JSON.parse(answer) as Omit<KongRun, 'relays' | 'logs'> & { relays: unknown; logs: unknown };
  const relays = Array.isArray(parsed.relays) ? (parsed.relays as KongRelay[]) : [];
  const logs = Array.isArray(parsed.logs) ? (parsed.logs as string[]) : [];
  expect(parsed.error, `${definition.name} failed in Lua: ${parsed.error ?? ''}`).toBeUndefined();
  return { ...parsed, relays, logs };
}

/** Lua with its comments and string literals removed: what a syntax check may read. */
function luaWithoutStringsAndComments(code: string): string {
  let out = '';
  let at = 0;
  while (at < code.length) {
    if (code.startsWith('--[[', at)) {
      const end = code.indexOf(']]', at + 4);
      at = end < 0 ? code.length : end + 2;
    } else if (code.startsWith('--', at)) {
      const end = code.indexOf('\n', at);
      at = end < 0 ? code.length : end;
    } else if (code.startsWith('[[', at)) {
      const end = code.indexOf(']]', at + 2);
      at = end < 0 ? code.length : end + 2;
      out += '""';
    } else if (code[at] === '"' || code[at] === "'") {
      const quote = code[at];
      let end = at + 1;
      while (end < code.length && code[end] !== quote) end += code[end] === '\\' ? 2 : 1;
      at = end + 1;
      out += '""';
    } else {
      out += code[at];
      at += 1;
    }
  }
  return out;
}

/** The Lua 5.3 syntax LuaJIT (Kong's) does not have, in code with no strings or comments. */
const LUA_53_ONLY: readonly (readonly [string, RegExp])[] = [
  ['integer division //', /\/\//],
  ['bitwise &', /&/],
  ['bitwise |', /\|/],
  ['bitwise ~', /~(?!=)/],
  ['shift <<', /<</],
  ['shift >>', />>/],
  ['the utf8 library', /\butf8\./],
];

function lua53Only(code: string): string[] {
  const plain = luaWithoutStringsAndComments(code);
  return LUA_53_ONLY.filter(([, pattern]) => pattern.test(plain)).map(([name]) => name);
}

/** The predicate as Kong runs it: cut from the rendered mail post-function. */
function renderedPredicate(config: KongConfig): string {
  const lua = accessLua(kongService(config, 'auth-v1-mail'));
  const start = lua.indexOf('local function address_kind(');
  const end = lua.indexOf('-- end address_kind');
  expect(start, 'the mail route has no address_kind').toBeGreaterThanOrEqual(0);
  expect(end, 'the mail route has no end of address_kind').toBeGreaterThan(start);
  return lua.slice(start, end);
}

/** Runs the predicate on one address in a Lua state that holds it. */
function luaAddressKind(state: unknown, address: string | null): string {
  fengari.lua.lua_getglobal(state, fengari.to_luastring('address_kind'));
  if (address === null) fengari.lua.lua_pushnil(state);
  else fengari.lua.lua_pushstring(state, fengari.to_luastring(address));
  const status = fengari.lua.lua_pcall(state, 1, 1, 0);
  const answer = fengari.to_jsstring(fengari.lua.lua_tostring(state, -1));
  fengari.lua.lua_pop(state, 1);
  expect(status, answer).toBe(fengari.lua.LUA_OK);
  return answer;
}

/**
 * Kong 2.8's answer for a raw path, as far as these routes need it. The
 * router (modelled here in JavaScript) matches the NORMALIZED path
 * (percent-decoded, `//` collapsed: what the spec's rehearsal found on the
 * pinned image): a route path with a regex character is a regex anchored at
 * the start (the `$` anchors the end), any other is a prefix, and regex
 * routes are tried first. Then the matched route's own rendered Lua decides,
 * run in fengari: a 404 from its pre-function or post-function is no route.
 * The rehearsal (spec, Verification) runs the real router.
 */
function kongRouteFor(config: KongConfig, method: string, raw: string): string | null {
  const normalized = (() => {
    try {
      return decodeURIComponent(raw).replace(/\/{2,}/g, '/');
    } catch {
      return raw.replace(/\/{2,}/g, '/');
    }
  })();
  const matched = kongRouteForNormalized(config, method, normalized);
  if (matched === null) return null;
  const answered = runKongLua(kongService(config, matched), { path: raw, method, body: '{}' });
  return answered.exit?.status === 404 ? null : matched;
}

function kongRouteForNormalized(config: KongConfig, method: string, path: string): string | null {
  const candidates = config.services.flatMap((definition) =>
    (definition.routes ?? []).flatMap((route) =>
      (route.paths ?? []).map((routePath) => ({ name: definition.name, methods: route.methods, routePath })),
    ),
  );
  const regex = (routePath: string): boolean => /[^A-Za-z0-9._~/%-]/.test(routePath);
  const fits = (methods: string[] | undefined): boolean => methods === undefined || methods.includes(method);
  for (const candidate of candidates.filter(({ routePath }) => regex(routePath))) {
    if (fits(candidate.methods) && new RegExp(`^${candidate.routePath}`).test(path)) return candidate.name;
  }
  const prefixes = candidates
    .filter(({ routePath }) => !regex(routePath))
    .sort((a, b) => b.routePath.length - a.routePath.length);
  for (const candidate of prefixes) {
    if (fits(candidate.methods) && path.startsWith(candidate.routePath)) return candidate.name;
  }
  return null;
}

/** The auth service's environment, its `${…}` resolved from a template and the fake inputs. */
function resolvedAuthEnvironment(template: Map<string, string>, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  const inputs: Record<string, string> = { ...Object.fromEntries(template), SHIFT_APP_URL: FAKE.SHIFT_APP_URL, ...extra };
  const resolved: Record<string, string> = {};
  for (const [key, value] of environment('supabase-auth')) {
    resolved[key] = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*)|:\?)?\}/g, (_, name: string, fallback?: string) => {
      const given = inputs[name];
      return given !== undefined && given !== '' ? given : (fallback ?? '');
    });
  }
  return resolved;
}

/**
 * Runs the compose's own auth wrapper under `sh` (or busybox's), with `wget`
 * answering from `served` (URL → body; a missing URL fails as a 404 does),
 * each URL failing its first `failFirst` fetches, `sleep` recorded rather than
 * slept, and `auth` standing in for GoTrue. Returns the status, stderr,
 * whether GoTrue was started, and how many fetches and sleeps there were.
 */
function runAuthEntrypoint(
  env: Readonly<Record<string, string>>,
  served: Readonly<Record<string, string>> = {},
  shell: 'host' | 'busybox' = 'host',
  failFirst = 0,
): { status: number; stderr: string; started: boolean; fetches?: number; sleeps?: number } {
  const directory = mkdtempSync(join(tmpdir(), 'shift-auth-'));
  try {
    const bin = join(directory, 'bin');
    const pages = join(directory, 'pages');
    mkdirSync(bin);
    mkdirSync(pages);
    const script = join(directory, 'auth-entrypoint.sh');
    writeFileSync(script, boundContent('supabase-auth', '/usr/local/etc/auth-entrypoint.sh'));
    const named = Object.entries(served).map(([url, body], index) => ({ url, file: join(pages, String(index)), body }));
    for (const { file, body } of named) writeFileSync(file, body);
    const cases = named
      .map(({ url, file }) => `  '${url}') [ "$(wc -l < '${file}.tries')" -gt ${String(failFirst)} ] || exit 8; cat '${file}' ;;`)
      .join('\n');
    for (const { file } of named) writeFileSync(`${file}.tries`, '');
    const counter = join(directory, 'counts');
    writeFileSync(
      join(bin, 'wget'),
      `#!/bin/sh\nfor last; do :; done\necho fetch >> '${counter}'\ncase "$last" in\n${named
        .map(({ url, file }) => `  '${url}') echo x >> '${file}.tries' ;;`)
        .join('\n')}\nesac\ncase "$last" in\n${cases}\n  *) exit 8 ;;\nesac\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(bin, 'sleep'), `#!/bin/sh\necho sleep >> '${counter}'\n`, { mode: 0o755 });
    writeFileSync(counter, '');
    writeFileSync(join(bin, 'auth'), '#!/bin/sh\necho AUTH_STARTED\n', { mode: 0o755 });
    const counted = (): { fetches: number; sleeps: number } => {
      const lines = readFileSync(counter, 'utf8').split('\n');
      return { fetches: lines.filter((line) => line === 'fetch').length, sleeps: lines.filter((line) => line === 'sleep').length };
    };
    let path = `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`;
    if (shell === 'busybox' && BUSYBOX !== null) {
      for (const applet of ['sh', '[', 'cat']) symlinkSync(BUSYBOX, join(bin, applet));
      path = `${bin}:/nonexistent`;
    }
    try {
      const stdout = execFileSync(shell === 'busybox' && BUSYBOX !== null ? BUSYBOX : 'sh', shell === 'busybox' ? ['sh', script] : [script], {
        env: { ...env, PATH: path },
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
      const result = { status: 0, stderr: '', started: stdout.includes('AUTH_STARTED') };
      return failFirst > 0 ? { ...result, ...counted() } : result;
    } catch (error) {
      const failed = error as { status?: number; stderr?: string; stdout?: string };
      const result = { status: failed.status ?? -1, stderr: String(failed.stderr ?? ''), started: String(failed.stdout ?? '').includes('AUTH_STARTED') };
      return failFirst > 0 ? { ...result, ...counted() } : result;
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The three templates GoTrue would fetch, as the web build emits them, at the fake origin. */
function servedTemplates(): Record<string, string> {
  const resource = JSON.parse(
    readFileSync(join(repoRoot, 'apps', 'web', 'src', 'lib', 'i18n', 'locales', 'hr.json'), 'utf8'),
  ) as unknown;
  return Object.fromEntries(
    authEmailTemplates(resource).map(({ file, html }) => [`${FAKE.SHIFT_APP_URL}/auth-email/${file}`, html]),
  );
}

describe('the self-hosted stack (story 19.1): the signup door in GoTrue (AD-21)', () => {
  const staging = envTemplate('staging.env.example');
  const production = envTemplate('production.env.example');
  /** A staging stack with every guard met: the key is a fake, never a real one. */
  const open = (): Record<string, string> => resolvedAuthEnvironment(staging, { GOTRUE_SMTP_PASS: 'not-a-real-key' });

  it('shuts the door by default, keeps it shut in production and opens it on staging alone', () => {
    const env = environment('supabase-auth');
    expect(env.get('GOTRUE_DISABLE_SIGNUP')).toBe('${SHIFT_DISABLE_SIGNUP:-true}');
    expect(env.get('GOTRUE_MAILER_AUTOCONFIRM')).toBe('${SHIFT_MAILER_AUTOCONFIRM:-true}');
    expect(production.get('SHIFT_DISABLE_SIGNUP'), 'production.env.example opens the door').toBe('true');
    expect(production.get('SHIFT_MAILER_AUTOCONFIRM'), 'production.env.example turns confirmations off').toBe('true');
    expect(staging.get('SHIFT_DISABLE_SIGNUP')).toBe('false');
    expect(staging.get('SHIFT_MAILER_AUTOCONFIRM')).toBe('false');
  });

  it('runs GoTrue through the wrapper, which ends by starting the image’s own command', () => {
    expect(service('supabase-auth').entrypoint).toEqual(['sh', '/usr/local/etc/auth-entrypoint.sh']);
    const wrapper = boundContent('supabase-auth', '/usr/local/etc/auth-entrypoint.sh');
    expect(wrapper.trimEnd().split('\n').at(-1)).toBe('exec auth');
    expect(wrapper).not.toMatch(/^\s*eval\b/m);
    // Coolify reads `${…}` as its own variables: the wrapper uses none.
    expect(wrapper).not.toContain('${');
    // The key is tested for presence, never printed: twice, the open door's
    // guard and the mail checks' condition.
    expect([...wrapper.matchAll(/\$GOTRUE_SMTP_PASS\b/g)].length).toBe(2);
    expect(wrapper).toContain('[ -n "$GOTRUE_SMTP_PASS" ] || refuse');
    expect(wrapper).toContain('if [ "$GOTRUE_DISABLE_SIGNUP" = false ] || [ -n "$GOTRUE_SMTP_PASS" ]; then');
  });

  it('starts a shut stack with no SMTP key, and staging’s open door with every guard met', () => {
    // busybox's sh runs its own `wget` applet whatever PATH says, so the
    // template fetch is stubbed under the host's sh only; busybox runs every
    // guard before it (GoTrue's image is Alpine, its sh busybox's).
    if (BUSYBOX !== null) {
      expect(runAuthEntrypoint(resolvedAuthEnvironment(production), {}, 'busybox'), 'busybox production').toEqual({
        status: 0,
        stderr: '',
        started: true,
      });
    }
    expect(runAuthEntrypoint(resolvedAuthEnvironment(production)), 'production').toEqual({ status: 0, stderr: '', started: true });
    expect(runAuthEntrypoint(open(), servedTemplates()), 'staging').toEqual({ status: 0, stderr: '', started: true });
    // The compose default with no environment at all is a shut door.
    const bare = resolvedAuthEnvironment(new Map());
    expect(bare['GOTRUE_DISABLE_SIGNUP']).toBe('true');
    expect(runAuthEntrypoint(bare).started).toBe(true);
  });

  it('refuses any boolean that is not exactly true or false, as Go’s ParseBool would read it', () => {
    const booleans = [...environment('supabase-auth').entries()]
      .filter(([, value]) => value === 'true' || value === 'false' || /:-(true|false)\}$/.test(value))
      .map(([key]) => key);
    expect(booleans.length, 'too few booleans were read').toBeGreaterThanOrEqual(10);
    for (const name of booleans) {
      for (const odd of ['0', '1', 'f', 't', 'False', 'TRUE', '', ' true']) {
        const result = runAuthEntrypoint({ ...resolvedAuthEnvironment(production), [name]: odd });
        expect(result.status, `${name}=${JSON.stringify(odd)}`).not.toBe(0);
        expect(result.started).toBe(false);
        expect(result.stderr).toContain(`${name} is not exactly true or false`);
      }
    }
  });

  it('refuses a half-built open door and names the guard', () => {
    const urls = servedTemplates();
    const recovery = `${FAKE.SHIFT_APP_URL}/auth-email/recovery.html`;
    const cases: [Record<string, string>, Record<string, string>, string][] = [
      [{ GOTRUE_MAILER_AUTOCONFIRM: 'true' }, urls, 'GOTRUE_MAILER_AUTOCONFIRM'],
      [{ GOTRUE_SMTP_PASS: '' }, urls, 'GOTRUE_SMTP_PASS'],
      [{ GOTRUE_SMTP_HOST: '' }, urls, 'GOTRUE_SMTP_HOST'],
      [{ GOTRUE_SMTP_USER: '' }, urls, 'GOTRUE_SMTP_USER'],
      [{ GOTRUE_SMTP_ADMIN_EMAIL: '' }, urls, 'GOTRUE_SMTP_ADMIN_EMAIL'],
      [{ GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: 'false' }, urls, 'before-user-created hook off'],
      [{ GOTRUE_HOOK_BEFORE_USER_CREATED_URI: 'pg-functions://postgres/public/custom_access_token_hook' }, urls, 'GOTRUE_HOOK_BEFORE_USER_CREATED_URI'],
      [{ GOTRUE_RATE_LIMIT_HEADER: '' }, urls, 'GOTRUE_RATE_LIMIT_HEADER'],
      [{ GOTRUE_MAILER_OTP_EXP: '3601' }, urls, 'GOTRUE_MAILER_OTP_EXP'],
      [{ GOTRUE_MAILER_OTP_EXP: '86400' }, urls, 'GOTRUE_MAILER_OTP_EXP'],
      [{ GOTRUE_MAILER_OTP_EXP: '0' }, urls, 'GOTRUE_MAILER_OTP_EXP'],
      [{ GOTRUE_MAILER_OTP_EXP: '' }, urls, 'GOTRUE_MAILER_OTP_EXP'],
      [{ GOTRUE_MAILER_OTP_EXP: '1h' }, urls, 'GOTRUE_MAILER_OTP_EXP'],
      [{ GOTRUE_MAILER_OTP_LENGTH: '6' }, urls, 'GOTRUE_MAILER_OTP_LENGTH'],
      [{ GOTRUE_MAILER_OTP_LENGTH: '' }, urls, 'GOTRUE_MAILER_OTP_LENGTH'],
      [{ GOTRUE_MAILER_TEMPLATES_RECOVERY: recovery.replace('https:', 'http:') }, urls, 'GOTRUE_MAILER_TEMPLATES_RECOVERY is not an https URL'],
      [{}, Object.fromEntries(Object.entries(urls).filter(([url]) => url !== recovery)), 'GOTRUE_MAILER_TEMPLATES_RECOVERY does not answer 200'],
      [{}, { ...urls, [recovery]: '<p>{{ .ConfirmationURL }}</p>' }, 'GOTRUE_MAILER_TEMPLATES_RECOVERY serves no token_hash link'],
    ];
    for (const shell of BUSYBOX === null ? (['host'] as const) : (['host', 'busybox'] as const)) {
      for (const [override, served, named] of cases) {
        // Under busybox, only the guards before the fetch (see above).
        if (shell === 'busybox' && named.startsWith('GOTRUE_MAILER_TEMPLATES_')) continue;
        const result = runAuthEntrypoint({ ...open(), ...override }, served, shell);
        expect(result.status, `${shell} ${JSON.stringify(override)} ${named}`).not.toBe(0);
        expect(result.started, named).toBe(false);
        expect(result.stderr, named).toContain(named);
      }
    }
    // Every guard the open door needs is one the shut door does not: the same
    // overrides on production's environment all start.
    for (const [override] of cases) {
      expect(runAuthEntrypoint({ ...resolvedAuthEnvironment(production), ...override }).started, JSON.stringify(override)).toBe(true);
    }
  });

  it('retries a template fetch 6 times, 5 s apart, before refusing, so a slow web origin does not crash-loop sign-in', () => {
    // COUPLED TO THE APP ORIGIN (DEPLOY.md §9.9). Each URL fails its first
    // five fetches and then answers: the start goes on.
    const late = runAuthEntrypoint(open(), servedTemplates(), 'host', 5);
    expect(late.started, late.stderr).toBe(true);
    expect(late.fetches).toBe(18);
    expect(late.sleeps).toBe(15);
    // Six failures each: refused after the sixth try, five sleeps.
    const down = runAuthEntrypoint(open(), servedTemplates(), 'host', 6);
    expect(down.started).toBe(false);
    expect(down.stderr).toContain('GOTRUE_MAILER_TEMPLATES_CONFIRMATION does not answer 200');
    expect(down.fetches).toBe(6);
    expect(down.sleeps).toBe(5);
  });

  it('checks the OTP and the templates whenever GoTrue can send mail, on a shut stack too', () => {
    // Production with a key set: recovery and resend still reach GoTrue.
    const shutWithKey = (): Record<string, string> => resolvedAuthEnvironment(production, { GOTRUE_SMTP_PASS: 'not-a-real-key' });
    expect(runAuthEntrypoint(shutWithKey(), servedTemplates()).started).toBe(true);
    const recovery = `${FAKE.SHIFT_APP_URL}/auth-email/recovery.html`;
    for (const [override, served, named] of [
      [{ GOTRUE_MAILER_OTP_LENGTH: '6' }, servedTemplates(), 'GOTRUE_MAILER_OTP_LENGTH is not 10'],
      [{ GOTRUE_MAILER_OTP_EXP: '86400' }, servedTemplates(), 'GOTRUE_MAILER_OTP_EXP'],
      [{}, { ...servedTemplates(), [recovery]: '<p>{{ .ConfirmationURL }}</p>' }, 'GOTRUE_MAILER_TEMPLATES_RECOVERY serves no token_hash link'],
      [{}, {}, 'GOTRUE_MAILER_TEMPLATES_CONFIRMATION does not answer 200'],
    ] as const) {
      const result = runAuthEntrypoint({ ...shutWithKey(), ...override }, served);
      expect(result.started, named).toBe(false);
      expect(result.stderr, named).toContain(named);
    }
    // With no key, a shut stack sends nothing and checks none of it.
    expect(runAuthEntrypoint({ ...resolvedAuthEnvironment(production), GOTRUE_MAILER_OTP_LENGTH: '6' }).started).toBe(true);
  });

  it('builds every link on the site URL, which is the app origin', () => {
    expect(environment('supabase-auth').get('GOTRUE_SITE_URL')).toBe('${SHIFT_APP_URL:?}');
    for (const html of Object.values(servedTemplates())) {
      const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link.startsWith('{{ .SiteURL }}/potvrda?token_hash={{ .TokenHash }}&amp;type='), link).toBe(true);
    }
  });

  it('sets the OTP bound, the client-address header and GoTrue’s own limits', () => {
    const env = environment('supabase-auth');
    expect(env.get('GOTRUE_MAILER_OTP_EXP')).toBe('3600');
    expect(env.get('GOTRUE_MAILER_OTP_LENGTH')).toBe('10');
    expect(env.get('GOTRUE_RATE_LIMIT_HEADER')).toBe('X-Real-IP');
    expect(env.get('GOTRUE_RATE_LIMIT_EMAIL_SENT')).toBe('${SHIFT_AUTH_EMAIL_PER_HOUR:-10}');
    expect(staging.get('SHIFT_AUTH_EMAIL_PER_HOUR')).toBe('10');
    expect(env.get('GOTRUE_RATE_LIMIT_VERIFY')).toBe('30');
    expect(env.get('GOTRUE_RATE_LIMIT_TOKEN_REFRESH')).toBe('150');
    expect(env.get('GOTRUE_SMTP_MAX_FREQUENCY')).toBe('60s');
    // Resend's SMTP (AD-17 as amended); the key is GoTrue's own.
    expect(env.get('GOTRUE_SMTP_HOST')).toBe('smtp.resend.com');
    expect(env.get('GOTRUE_SMTP_PORT')).toBe('465');
    expect(env.get('GOTRUE_SMTP_USER')).toBe('resend');
    expect(env.get('GOTRUE_SMTP_PASS')).toBe('${GOTRUE_SMTP_PASS:-}');
    expect(env.get('GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED')).toBe('true');
    expect(env.get('GOTRUE_HOOK_BEFORE_USER_CREATED_URI')).toBe('pg-functions://postgres/public/before_user_created_hook');
    for (const [variable, file] of [
      ['GOTRUE_MAILER_TEMPLATES_CONFIRMATION', 'confirmation.html'],
      ['GOTRUE_MAILER_TEMPLATES_RECOVERY', 'recovery.html'],
      ['GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE', 'email-change.html'],
    ] as const) {
      expect(env.get(variable)).toBe(`\${SHIFT_APP_URL:?}/auth-email/${file}`);
    }
  });
});

describe('the self-hosted stack (story 19.1): Kong is the anti-enumeration boundary (AD-22)', () => {
  const staging = envTemplate('staging.env.example');
  const production = envTemplate('production.env.example');

  it('loads rate-limiting and a sandbox that may require resty.http and cjson.safe alone, and hides its headers', () => {
    const env = environment('supabase-kong');
    expect(env.get('KONG_PLUGINS')?.split(',').sort()).toEqual(
      ['acl', 'cors', 'key-auth', 'pre-function', 'post-function', 'rate-limiting', 'request-transformer'].sort(),
    );
    expect(env.get('KONG_UNTRUSTED_LUA')).toBe('sandbox');
    expect(env.get('KONG_UNTRUSTED_LUA_SANDBOX_REQUIRES')).toBe('resty.http,cjson.safe');
    expect(env.get('KONG_HEADERS')).toBe('off');
    expect(env.get('KONG_TRUSTED_IPS')).toBe('${SHIFT_PROXY_CIDR:?}');
    expect(env.get('KONG_REAL_IP_HEADER')).toBe('X-Forwarded-For');
    expect(env.get('KONG_REAL_IP_RECURSIVE')).toBe('on');
    for (const [file, template] of [
      ['staging.env.example', staging],
      ['production.env.example', production],
    ] as const) {
      expect(template.get('SHIFT_PROXY_CIDR'), `${file} names a network`).toBe('<proxy-cidr>');
    }
  });

  it('refuses to start Kong trusting every address, or no list at all', () => {
    const refused = [
      '',
      '0.0.0.0/0',
      '::/0',
      '192.0.2.0/24,0.0.0.0/0',
      '0.0.0.0/00',
      '192.0.2.0/24,',
      ',192.0.2.0/24',
      '192.0.2.0/24 ',
      '192.0.2.0/24;x',
      '*',
      // Wider than an IPv4 /8 or an IPv6 /32 trusts strangers too.
      '10.0.0.0/7',
      '128.0.0.0/1',
      '2001:db8::/31',
      '2000::/3',
      '192.0.2.0/24/8',
      '192.0.2.0/abc',
      '192.0.2.0/1000',
    ];
    for (const shell of BUSYBOX === null ? (['host'] as const) : (['host', 'busybox'] as const)) {
      for (const trusted of refused) {
        const { status, rendered } = runKongEntrypoint({ ...FAKE, KONG_TRUSTED_IPS: trusted }, shell);
        expect(status, `${shell} ${JSON.stringify(trusted)}`).not.toBe(0);
        expect(rendered).toBe('');
      }
      for (const accepted of ['192.0.2.0/24,2001:db8::/32', '10.0.0.0/8', '192.0.2.7', '2001:db8::/128', '172.16.0.0/12,fd00::/48']) {
        expect(runKongEntrypoint({ ...FAKE, KONG_TRUSTED_IPS: accepted }, shell).status, `${shell} ${accepted}`).toBe(0);
      }
    }
    const { KONG_TRUSTED_IPS: _unset, ...withoutTrusted } = FAKE;
    expect(runKongEntrypoint(withoutTrusted).status).not.toBe(0);
  });

  it('is an allow-list under /auth/v1/: each route anchored, every other path and method Kong’s 404', () => {
    const config = renderedKong();
    const auth = config.services
      .map((definition) => ({
        name: definition.name,
        routes: (definition.routes ?? []).filter((route) => (route.paths ?? []).some((path) => path.startsWith('/auth/v1/'))),
      }))
      .filter(({ routes }) => routes.length > 0)
      .map(({ name, routes }) => ({ name, methods: routes[0]?.methods ?? null, paths: routes.flatMap((route) => route.paths ?? []) }));
    expect(auth).toEqual([
      { name: 'auth-v1-mail', methods: ['POST', 'OPTIONS'], paths: ['/auth/v1/signup$', '/auth/v1/recover$', '/auth/v1/resend$'] },
      { name: 'auth-v1-token', methods: ['POST', 'OPTIONS'], paths: ['/auth/v1/token$'] },
      { name: 'auth-v1-verify', methods: ['POST', 'OPTIONS'], paths: ['/auth/v1/verify$'] },
      { name: 'auth-v1-user', methods: ['GET', 'PUT', 'OPTIONS'], paths: ['/auth/v1/user$'] },
      { name: 'auth-v1-logout', methods: ['POST', 'OPTIONS'], paths: ['/auth/v1/logout$'] },
      { name: 'auth-v1-health', methods: ['GET', 'OPTIONS'], paths: ['/auth/v1/health$'] },
      { name: 'auth-v1-open-jwks', methods: ['GET', 'OPTIONS'], paths: ['/auth/v1/\\.well-known/jwks\\.json$'] },
      { name: 'auth-v1-admin', methods: ['GET', 'POST', 'PUT', 'DELETE'], paths: ['/auth/v1/admin/'] },
    ]);
    // No catch-all is left, under any name.
    expect(config.services.map(({ name }) => name)).not.toContain('auth-v1');
    expect(config.services.map(({ name }) => name)).not.toContain('auth-v1-open');

    const allowed: [string, string, string][] = [
      ['POST', '/auth/v1/signup', 'auth-v1-mail'],
      ['POST', '/auth/v1/recover', 'auth-v1-mail'],
      ['POST', '/auth/v1/resend', 'auth-v1-mail'],
      ['OPTIONS', '/auth/v1/signup', 'auth-v1-mail'],
      ['POST', '/auth/v1/token', 'auth-v1-token'],
      ['POST', '/auth/v1/verify', 'auth-v1-verify'],
      ['GET', '/auth/v1/user', 'auth-v1-user'],
      ['PUT', '/auth/v1/user', 'auth-v1-user'],
      ['POST', '/auth/v1/logout', 'auth-v1-logout'],
      ['GET', '/auth/v1/health', 'auth-v1-health'],
      ['GET', '/auth/v1/.well-known/jwks.json', 'auth-v1-open-jwks'],
      ['POST', '/auth/v1/admin/users', 'auth-v1-admin'],
      ['GET', '/auth/v1/admin/users/8d0f1a3c-5e7b-4d1f-9a3c-5e7b9d1f3a5c', 'auth-v1-admin'],
      ['PUT', '/auth/v1/admin/users/x', 'auth-v1-admin'],
      ['DELETE', '/auth/v1/admin/users/x', 'auth-v1-admin'],
      ['POST', '/rest/v1/rpc/create_organization', 'rest-v1-create-organization'],
    ];
    for (const [method, path, name] of allowed) expect(kongRouteFor(config, method, path), `${method} ${path}`).toBe(name);

    const closed = [
      '/auth/v1/otp',
      '/auth/v1/magiclink',
      '/auth/v1/reauthenticate',
      '/auth/v1/invite',
      '/auth/v1/authorize',
      '/auth/v1/callback',
      '/auth/v1/factors',
      '/auth/v1/sso',
      '/auth/v1/settings',
      '/auth/v1/signup/',
      '/auth/v1//signup',
      '//auth/v1/signup',
      '/auth/v1/signup;x',
      '/auth/v1/sign%75p',
      '/auth/v1/SIGNUP',
      '/auth/v1/token/',
      '/auth/v1/verify/x',
      '/auth/v1/userx',
      '/auth/v1/xwell-known/jwksxjson',
      '/auth/v1/',
      '/auth/v1',
      '/auth/v1/recover%2f',
      '/rest/v1/rpc/create%5Forganization',
      '/rest/v1/rpc//create_organization',
      '//rest/v1/rpc/create_organization',
      '/auth/v1/admin//users',
      '/auth/v1/admin/users;x',
      '/auth/v1/admin/%75sers',
      '/auth/v1/admin/../token',
      '/auth/v1/admin/./users',
    ];
    for (const path of closed) {
      for (const method of ['GET', 'POST', 'PUT']) {
        expect(kongRouteFor(config, method, path), `${method} ${path}`).toBeNull();
      }
    }
    // Every regex route's pre-function guards its raw path: exactly its own
    // paths pass, and each variant of them is the 404, run in the Lua.
    for (const definition of config.services) {
      const regexPaths = (definition.routes ?? []).flatMap((route) => route.paths ?? []).filter((path) => path.endsWith('$'));
      if (regexPaths.length === 0) {
        expect(guardedPaths(definition), `${definition.name} guards a prefix route`).toBeNull();
        continue;
      }
      const own = regexPaths.map((path) => path.slice(0, -1).replaceAll('\\.', '.'));
      expect(guardedPaths(definition), definition.name).toEqual(own);
      for (const path of own) {
        const segments = path.split('/');
        const last = segments.at(-1) ?? '';
        const variants = [
          `${path}/`,
          path.replace('/v1/', '/v1//'),
          `/${path}`,
          `${path};x`,
          path.toUpperCase(),
          [...segments.slice(0, -1), `%${last.charCodeAt(0).toString(16)}${last.slice(1)}`].join('/'),
        ];
        const guard: KongService = { ...definition, plugins: (definition.plugins ?? []).filter((plugin) => plugin.name === 'pre-function') };
        expect(runKongLua(guard, { path, method: 'POST', body: '{}' }).exit, `${path} is refused by its own guard`).toBeUndefined();
        for (const variant of variants) {
          expect(runKongLua(guard, { path: variant, method: 'POST', body: '{}' }).exit?.status, `${definition.name} ${variant}`).toBe(404);
        }
      }
    }
    // The admin API is a prefix, guarded by its own rule: no cors (no browser
    // calls it) and its pre-function first, before key-auth.
    const admin = kongService(config, 'auth-v1-admin');
    expect(admin.plugins?.map((plugin) => plugin.name)).toEqual(['pre-function', 'key-auth', 'request-transformer', 'acl']);
    // A GET on verify consumes nothing: no route takes it.
    expect(kongRouteFor(config, 'GET', '/auth/v1/verify')).toBeNull();
    expect(kongRouteFor(config, 'GET', '/auth/v1/signup')).toBeNull();
  });

  it('limits the mail routes, the token and verify routes and create_organization per IP, from the compose’s variables', () => {
    const config = renderedKong();
    const expected: Record<string, Record<string, number>> = {
      'auth-v1-mail': { hour: 5, day: 20 },
      'auth-v1-token': { minute: 60, hour: 1440 },
      'auth-v1-verify': { minute: 15, hour: 360 },
      'rest-v1-create-organization': { hour: 10 },
    };
    const limited = config.services.filter((definition) => pluginOf(definition, 'rate-limiting') !== undefined).map(({ name }) => name);
    expect(limited.sort()).toEqual(Object.keys(expected).sort());
    for (const [name, windows] of Object.entries(expected)) {
      expect(pluginOf(kongService(config, name), 'rate-limiting'), name).toEqual({
        ...windows,
        limit_by: 'ip',
        policy: 'local',
        hide_client_headers: true,
      });
    }
    // Each limit is a compose variable defaulting to staging's value, which
    // both templates carry until D-S5 sets production's.
    const env = environment('supabase-kong');
    for (const [name, value] of Object.entries(STAGING_LIMITS)) {
      expect(env.get(name), name).toBe(`\${${name}:-${value}}`);
      expect(kongTemplate, name).toContain(`$${name}\n`);
      expect(staging.get(name), `staging ${name}`).toBe(value);
      expect(production.get(name), `production ${name}`).toMatch(/^[1-9][0-9]*$/);
    }
  });

  it('refuses to start Kong with a limit that is not a positive integer, or a window wider than the next', () => {
    const cases: Record<string, string>[] = [
      ...Object.keys(STAGING_LIMITS).flatMap((name) => ['', '0', '-1', '1.5', '5x', '012', '99999999', '5\n  x: 1'].map((value) => ({ [name]: value }))),
      { SHIFT_LIMIT_MAIL_HOUR: '21' },
      { SHIFT_LIMIT_TOKEN_MINUTE: '1441' },
      { SHIFT_LIMIT_VERIFY_MINUTE: '361' },
    ];
    for (const override of cases) {
      const { status, rendered } = runKongEntrypoint({ ...FAKE, ...override });
      expect(status, JSON.stringify(override)).not.toBe(0);
      expect(rendered).toBe('');
    }
  });

  it('compiles every rendered Lua chunk, uses no Lua 5.3-only syntax, and writes no `$` name Kong’s awk would substitute', () => {
    // fengari is Lua 5.3, Kong runs LuaJIT (5.1 with extensions): a chunk that
    // compiles here could still use what LuaJIT lacks, so that syntax is
    // refused outright. Only the rehearsal proves the chunks run on the image.
    const config = renderedKong();
    const functions = config.services.flatMap((definition) => accessChunks(definition).map((code) => ({ name: definition.name, code })));
    expect([...new Set(functions.map(({ name }) => name))].sort()).toEqual([
      'auth-v1-admin',
      'auth-v1-health',
      'auth-v1-logout',
      'auth-v1-mail',
      'auth-v1-open-jwks',
      'auth-v1-token',
      'auth-v1-user',
      'auth-v1-verify',
      'rest-v1',
      'rest-v1-create-organization',
      'storage-v1',
    ]);
    for (const { name, code } of functions) {
      expect(luaCompiles(code), name).toBeNull();
      expect(lua53Only(code), name).toEqual([]);
    }
    expect(luaCompiles('local x = ('), 'the compiler accepts anything').not.toBeNull();
    // The check itself, both polarities: strings and comments are not code.
    expect(lua53Only('local a = 7 // 2 local b = 1 & 2 local c = 1 | 2 local d = ~1 local e = 1 << 2 local f = 1 >> 2 local g = utf8.char(1)')).toEqual(
      LUA_53_ONLY.map(([name]) => name),
    );
    expect(lua53Only('local url = "http://x" -- a // comment | &\nif a ~= b then end local s = \'a & b\'')).toEqual([]);
    // The template, before substitution: no Lua may carry `$name`.
    for (const definition of kong.services) {
      for (const code of accessChunks(definition)) {
        expect(code, definition.name).not.toMatch(/\$[A-Za-z_]/);
        expect(code, definition.name).not.toContain('${');
      }
    }
  });

  it('decides an address’s kind in the rendered Lua exactly as the vector file does (AD-12)', () => {
    const state = luaState();
    const loaded = fengari.lauxlib.luaL_loadstring(state, fengari.to_luastring(`${renderedPredicate(renderedKong())}\nreturn address_kind`));
    expect(loaded, 'the rendered predicate does not compile').toBe(fengari.lua.LUA_OK);
    expect(fengari.lua.lua_pcall(state, 0, 1, 0)).toBe(fengari.lua.LUA_OK);
    fengari.lua.lua_setglobal(state, fengari.to_luastring('address_kind'));

    expect(ADDRESS_VECTORS.length).toBeGreaterThan(30);
    for (const kind of ['synthesized', 'email', 'malformed']) {
      expect(ADDRESS_VECTORS.some((vector) => vector.kind === kind), kind).toBe(true);
    }
    for (const { address, kind } of ADDRESS_VECTORS) {
      expect(luaAddressKind(state, address), JSON.stringify(address)).toBe(kind);
    }
    // A body with no address at all is malformed, never relayed.
    expect(luaAddressKind(state, null)).toBe('malformed');
  });

  it('answers the mail routes itself, relays an email identity only, from a timer, with the client’s address and its route’s fields', () => {
    const mail = kongService(renderedKong(), 'auth-v1-mail');
    const post = (path: string, body: string | null, relay_status?: number): KongRun =>
      runKongLua(mail, { path, method: 'POST', body, ...(relay_status === undefined ? {} : { relay_status }) });
    const answeredAtOnce = (run: KongRun): void => {
      expect(run.exit?.status).toBe(200);
      expect(run.exit?.body).toBe('{}');
      expect(run.exit?.headers).toEqual({ 'Content-Type': 'application/json' });
    };

    const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
      [
        '/auth/v1/signup',
        { email: 'Nova.Osoba@Example.com', password: FAKE_PASSWORD, data: { x: 1 }, gotrue_meta_security: {}, code_challenge: 'c' },
        { email: 'Nova.Osoba@Example.com', password: FAKE_PASSWORD },
      ],
      ['/auth/v1/recover', { email: 'stara@example.com', gotrue_meta_security: {} }, { email: 'stara@example.com' }],
      ['/auth/v1/resend', { email: 'stara@example.com', type: 'email_change' }, { email: 'stara@example.com', type: 'signup' }],
      // Review 2: the address is relayed as the predicate judged it, ASCII
      // white space trimmed (GoTrue's format check refuses a padded one).
      ['/auth/v1/recover', { email: ' \tstara@example.com\r\n' }, { email: 'stara@example.com' }],
    ];
    for (const [path, sent, relayed] of cases) {
      const run = post(path, JSON.stringify(sent));
      answeredAtOnce(run);
      expect(run.timers, path).toBe(1);
      expect(run.relays.map(({ url, method }) => [url, method]), path).toEqual([[`http://supabase-auth:9999/${path.slice(9)}`, 'POST']]);
      expect(JSON.parse(run.relays[0]?.body ?? 'null'), path).toEqual(relayed);
      expect(run.relays[0]?.headers, path).toEqual({ 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.7' });
      expect(run.logs, path).toEqual([]);
    }

    // No relay, the same answer: synthesized, malformed, unreadable, no
    // password, no address, not an object.
    const unrelayed: (string | null)[] = [
      JSON.stringify({ email: 'ana@dvd.SHIFT.invalid.', password: FAKE_PASSWORD }),
      JSON.stringify({ email: 'a@@example.com', password: FAKE_PASSWORD }),
      JSON.stringify({ email: "o'brien@example.com", password: FAKE_PASSWORD }),
      // Review 2: not printable ASCII, never relayed. GoTrue's ToLower folds
      // U+0130 to `i` and U+212A to `k`, so these would name a synthesized
      // address there; a no-break space is not trimmed by the predicate.
      JSON.stringify({ email: 'ana@dvd.sh\u0130ft.invalid', password: FAKE_PASSWORD }),
      JSON.stringify({ email: 'ana@\u212Aastel.shift.invalid', password: FAKE_PASSWORD }),
      JSON.stringify({ email: 'ana@shift.invalid\u00a0', password: FAKE_PASSWORD }),
      JSON.stringify({ email: 'nova@example.com\u00a0', password: FAKE_PASSWORD }),
      JSON.stringify({ email: 'nova@ex\u00e4mple.com', password: FAKE_PASSWORD }),
      JSON.stringify({ email: 'nova@example.com' }),
      JSON.stringify({ password: FAKE_PASSWORD }),
      JSON.stringify(['nova@example.com']),
      'not json',
      '',
      null,
    ];
    for (const body of unrelayed) {
      const run = post('/auth/v1/signup', body);
      answeredAtOnce(run);
      expect(run.timers, String(body)).toBe(0);
      expect(run.relays, String(body)).toEqual([]);
    }
    // D8 and the unread body: a fixed code, never the address.
    expect(post('/auth/v1/recover', null).logs).toEqual(['AUTH_MAIL_RELAY recover UNREAD']);
    const failed = post('/auth/v1/signup', JSON.stringify({ email: 'nova@example.com', password: FAKE_PASSWORD }), 500);
    expect(failed.logs).toEqual(['AUTH_MAIL_RELAY signup 500']);
    for (const line of failed.logs) expect(line).not.toContain('@');
  });

  it('passes verify only as a rebuilt {token_hash, type}, and refuses every other body with 400 {}', () => {
    const verify = kongService(renderedKong(), 'auth-v1-verify');
    const send = (body: string | null, method = 'POST'): KongRun => runKongLua(verify, { path: '/auth/v1/verify', method, body });
    const hash = 'a'.repeat(56);

    const passed = send(JSON.stringify({ token_hash: hash, type: 'signup', gotrue_meta_security: { captcha_token: null } }));
    expect(passed.exit).toBeUndefined();
    expect(JSON.parse(passed.forwarded ?? 'null')).toEqual({ token_hash: hash, type: 'signup' });
    for (const type of ['recovery', 'email_change']) {
      expect(JSON.parse(send(JSON.stringify({ token_hash: hash, type })).forwarded ?? 'null')).toEqual({ token_hash: hash, type });
    }

    for (const body of [
      JSON.stringify({ token_hash: hash, type: 'signup', email: 'x@example.com' }),
      JSON.stringify({ email: 'x@example.com', token: '1234567890', type: 'signup' }),
      JSON.stringify({ token_hash: 'a'.repeat(129), type: 'signup' }),
      JSON.stringify({ token_hash: 'pkce_abc', type: 'signup' }),
      JSON.stringify({ token_hash: 'zz11', type: 'signup' }),
      JSON.stringify({ token_hash: '', type: 'signup' }),
      JSON.stringify({ token_hash: 12345, type: 'signup' }),
      JSON.stringify({ token_hash: [hash], type: 'signup' }),
      JSON.stringify({ token_hash: hash, type: 'magiclink' }),
      JSON.stringify({ token_hash: hash }),
      JSON.stringify([hash, 'signup']),
      'not json',
      null,
    ]) {
      const run = send(body);
      expect(run.exit, String(body)).toEqual({ status: 400, body: '{}', headers: { 'Content-Type': 'application/json' } });
      expect(run.forwarded, String(body)).toBeUndefined();
    }
    expect(send(JSON.stringify({ token_hash: hash, type: 'signup' }), 'OPTIONS').exit?.status).toBe(400);
  });

  it('refuses a PUT /user naming email or phone in any case, or unreadable, and passes a password change', () => {
    const user = kongService(renderedKong(), 'auth-v1-user');
    const put = (body: string | null, method = 'PUT'): KongRun => runKongLua(user, { path: '/auth/v1/user', method, body });
    for (const body of [
      JSON.stringify({ email: 'nova@example.com' }),
      JSON.stringify({ EMAIL: 'nova@example.com' }),
      JSON.stringify({ Email: 'nova@example.com', password: 'nova-lozinka-1' }),
      JSON.stringify({ phone: '+385' }),
      JSON.stringify({ PHONE: '+385' }),
      'not json',
      '',
      null,
    ]) {
      expect(put(body).exit, String(body)).toEqual({ status: 422, body: '{}', headers: { 'Content-Type': 'application/json' } });
    }
    expect(put(JSON.stringify({ password: 'nova-lozinka-1' })).exit).toBeUndefined();
    expect(put(JSON.stringify({ data: { theme: 'dark' } })).exit).toBeUndefined();
    expect(put(null, 'GET').exit, 'a read is no change').toBeUndefined();
  });

  it('refuses every other REST spelling of create_organization, and passes the route’s own path and other RPCs', () => {
    const config = renderedKong();
    const rest = kongService(config, 'rest-v1');
    const own = kongService(config, 'rest-v1-create-organization');
    // Review 2: the guard runs first of all, before cors and key-auth, so a
    // variant is 404 with or without a key, as on the allow-listed routes.
    expect(rest.plugins?.[0]?.name).toBe('pre-function');
    expect(phaseChunks(rest, 'post-function')).toEqual([]);
    for (const path of [
      '/rest/v1/rpc/create%255Forganization',
      '/rest/v1/rpc/create%5Forganization',
      '/rest/v1/rpc/CREATE_ORGANIZATION',
      '/rest/v1//rpc/create_organization',
      '/rest/v1/rpc/create_organization/',
      '/rest/v1/rpc/create_organization',
    ]) {
      expect(runKongLua(rest, { path, method: 'POST', body: '{}' }).exit?.status, path).toBe(404);
    }
    for (const path of ['/rest/v1/rpc/current_member_access', '/rest/v1/members', '/rest/v1/rpc/team_roster']) {
      expect(runKongLua(rest, { path, method: 'POST', body: '{}' }).exit, path).toBeUndefined();
    }
    expect(runKongLua(own, { path: '/rest/v1/rpc/create_organization', method: 'POST', body: '{}' }).exit).toBeUndefined();
    expect(runKongLua(own, { path: '/rest/v1/rpc/create%5Forganization', method: 'POST', body: '{}' }).exit?.status).toBe(404);
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
      // The loopback network, as 20.4's firewall drops it (`127.0.0.0/8`).
      '127.0.0.0',
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
