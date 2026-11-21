import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUTHORIZATION_MISSING,
  AUTHORIZATION_UNVERIFIED,
  createRouter,
  FUNCTION_NOT_FOUND,
  FUNCTION_UNAVAILABLE,
  FUNCTIONS,
  functionNameOf,
  type FunctionEntry,
  type RouterDependencies,
} from '../deploy/functions/main/router.ts';
import {
  createForward,
  FUNCTIONS_ROOT,
  WORKER_TIMEOUT_MS,
  type Worker,
  type WorkerOptions,
} from '../deploy/functions/main/workers.ts';
import { AUTHORIZATION_MISSING as ADMIN_AUTH_AUTHORIZATION_MISSING } from '../supabase/functions/admin-auth/handler.ts';
import { WIRE_CODES } from '../apps/web/src/features/members/services/wire.ts';

/**
 * Story 20.2: the functions router (`deploy/functions/main`), the
 * `edge-runtime` main service of the self-hosted stack, and the
 * `shift-functions` image it ships in.
 *
 * The router's decisions are asserted here against fakes of GoTrue and of the
 * worker (AD-15). The same matrix was run against the pinned `edge-runtime`
 * with both functions bundled, offline (spec, Verification), and CI's
 * `functions-image` job probes the built image the same way.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (...path: string[]): string => readFileSync(join(repoRoot, ...path), 'utf8');

const GOTRUE = 'http://supabase-auth:9999';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A router over a fake GoTrue (answering `gotrue`) and a fake worker that echoes what it got. */
function harness(
  gotrue: number | 'throw' | 'hang' = 200,
  overrides: Partial<RouterDependencies> = {},
): {
  route: (request: Request) => Promise<Response>;
  calls: Call[];
  forwarded: { name: string; entry: FunctionEntry; request: Request }[];
  logged: string[];
} {
  const calls: Call[] = [];
  const forwarded: { name: string; entry: FunctionEntry; request: Request }[] = [];
  const logged: string[] = [];
  const route = createRouter({
    authUrl: GOTRUE,
    fetch: (url, init) => {
      calls.push({ url, init });
      if (gotrue === 'throw') return Promise.reject(new TypeError('connection refused'));
      if (gotrue === 'hang') {
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
        });
      }
      return Promise.resolve(new Response('{"id":"user"}', { status: gotrue }));
    },
    forward: (name, entry, request) => {
      forwarded.push({ name, entry, request });
      return Promise.resolve(new Response(`worker:${name}`, { status: 299 }));
    },
    log: (code) => logged.push(code),
    ...overrides,
  });
  return { route, calls, forwarded, logged };
}

const request = (path: string, headers: Record<string, string> = {}, init: RequestInit = {}): Request =>
  new Request(`http://supabase-edge-functions:9000${path}`, { method: 'POST', headers, ...init });

async function codeOf(response: Response): Promise<string> {
  return ((await response.json()) as { code: string }).code;
}

// --------------------------------------------------------------- the matrix

describe('the functions router (story 20.2): which functions exist', () => {
  it('answers 404 FUNCTION_NOT_FOUND for any name not in the table, and asks GoTrue nothing', async () => {
    for (const path of ['/nope', '/', '', '/_internal/health', '/admin%2Dauth', '/Admin-Auth', '/__proto__', '/constructor', '/main', '/notify%20', '/%6Eotify']) {
      const { route, calls, forwarded } = harness();
      const response = await route(request(path, { authorization: 'Bearer good' }));
      expect(response.status, path).toBe(404);
      expect(await codeOf(response), path).toBe(FUNCTION_NOT_FOUND);
      expect(calls, path).toEqual([]);
      expect(forwarded, path).toEqual([]);
    }
  });

  it('reads the name from the first path segment, undecoded, and allows a sub-path', async () => {
    expect(functionNameOf('http://x:9000/notify')).toBe('notify');
    expect(functionNameOf('http://x:9000/notify/a/b?c=d')).toBe('notify');
    expect(functionNameOf('http://x:9000/admin%2Dauth')).toBe('admin%2Dauth');
    expect(functionNameOf('http://x:9000/')).toBe('');

    const { route, forwarded } = harness();
    const response = await route(request('/notify/anything?x=1'));
    expect(response.status).toBe(299);
    expect(forwarded.map(({ name }) => name)).toEqual(['notify']);
  });
});

describe('the functions router (story 20.2): verify_jwt', () => {
  it('forwards a function with verify_jwt = false untouched, token or not, and asks GoTrue nothing', async () => {
    for (const headers of [{}, { authorization: 'Bearer the-invoke-secret' }, { authorization: 'Basic x' }]) {
      const { route, calls, forwarded } = harness(401);
      const sent = request('/notify', headers, { body: '{}' });
      const response = await route(sent);
      expect(response.status).toBe(299);
      expect(await response.text()).toBe('worker:notify');
      expect(calls).toEqual([]);
      // The ORIGINAL request object: the runtime's tag and the body ride with it.
      expect(forwarded[0]?.request).toBe(sent);
      expect(forwarded[0]?.entry).toBe(FUNCTIONS.get('notify'));
    }
  });

  it('refuses a gated function with no bearer token 401 AUTHORIZATION_MISSING, before GoTrue and before the worker', async () => {
    for (const headers of [{}, { authorization: '' }, { authorization: 'Basic abc' }, { authorization: 'Bearer' }, { authorization: 'Bearer ' }, { authorization: 'Bearer a b' }, { authorization: 'token abc' }]) {
      const { route, calls, forwarded } = harness();
      const response = await route(request('/admin-auth', headers));
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(await codeOf(response)).toBe(AUTHORIZATION_MISSING);
      expect(calls).toEqual([]);
      expect(forwarded).toEqual([]);
    }
  });

  it('asks GoTrue GET /user with the caller’s bearer token alone, and forwards the original request on 200', async () => {
    const { route, calls, forwarded } = harness(200);
    const sent = request('/admin-auth', { authorization: 'bearer the.user.jwt', apikey: 'sb_publishable_x', 'content-type': 'application/json' }, { body: '{"operation":"resetPassword"}' });
    const response = await route(sent);

    expect(response.status).toBe(299);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${GOTRUE}/user`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    // Only the token: no apikey, no body, nothing else of the caller's.
    expect(calls[0]?.init.headers).toEqual({ authorization: 'Bearer the.user.jwt' });
    expect(calls[0]?.init.body).toBeUndefined();

    expect(forwarded[0]?.request).toBe(sent);
    expect(forwarded[0]?.request.bodyUsed, 'the router read the body').toBe(false);
    expect(await forwarded[0]?.request.text()).toBe('{"operation":"resetPassword"}');
  });

  it('refuses 401 AUTHORIZATION_MISSING when GoTrue refuses the token', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const { route, forwarded, logged } = harness(status);
      const response = await route(request('/admin-auth', { authorization: 'Bearer expired' }));
      expect(response.status, String(status)).toBe(401);
      expect(await codeOf(response)).toBe(AUTHORIZATION_MISSING);
      expect(forwarded).toEqual([]);
      expect(logged).toEqual([]);
    }
  });

  it('fails closed 503 AUTHORIZATION_UNVERIFIED when GoTrue cannot be asked, never with the sign-out code', async () => {
    for (const gotrue of [500, 502, 503, 429, 302, 201, 'throw', 'hang'] as const) {
      const { route, forwarded, logged } = harness(gotrue);
      const response = await route(request('/admin-auth', { authorization: 'Bearer good' }));
      expect(response.status, String(gotrue)).toBe(503);
      expect(await codeOf(response)).toBe(AUTHORIZATION_UNVERIFIED);
      expect(forwarded).toEqual([]);
      expect(logged).toEqual([AUTHORIZATION_UNVERIFIED]);
    }
  }, 20_000);

  it('fails closed when SHIFT_AUTH_URL is unset or blank, and trims a trailing slash', async () => {
    for (const authUrl of [null, '', '   ']) {
      const { route, calls, forwarded } = harness(200, { authUrl });
      const response = await route(request('/admin-auth', { authorization: 'Bearer good' }));
      expect(response.status).toBe(503);
      expect(await codeOf(response)).toBe(AUTHORIZATION_UNVERIFIED);
      expect(calls).toEqual([]);
      expect(forwarded).toEqual([]);
    }
    const { route, calls } = harness(200, { authUrl: `${GOTRUE}/` });
    await route(request('/admin-auth', { authorization: 'Bearer good' }));
    expect(calls[0]?.url).toBe(`${GOTRUE}/user`);
  });

  it('answers 500 FUNCTION_UNAVAILABLE when no worker can be started, and logs only the code', async () => {
    const { route, logged } = harness(200, {
      forward: () => Promise.reject(new Error('readfile /home/deno/functions/notify/bundle.eszip: secret-looking detail')),
    });
    const response = await route(request('/notify'));
    expect(response.status).toBe(500);
    expect(await codeOf(response)).toBe(FUNCTION_UNAVAILABLE);
    expect(logged).toEqual([FUNCTION_UNAVAILABLE]);
  });

  it('answers every refusal as JSON with a stable code', async () => {
    const { route } = harness(401);
    const response = await route(request('/admin-auth'));
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ code: AUTHORIZATION_MISSING });
  });

  it('refuses a session with the code admin-auth and the SPA already share', () => {
    expect(AUTHORIZATION_MISSING).toBe(ADMIN_AUTH_AUTHORIZATION_MISSING);
    expect(WIRE_CODES).toContain(AUTHORIZATION_MISSING);
  });
});

// ------------------------------------------------- the table and its sources

/** `[functions.<name>]` tables of config.toml, with `verify_jwt` and `enabled`. */
function configFunctions(): Map<string, { verifyJwt: boolean; enabled: boolean }> {
  const config = read('supabase', 'config.toml');
  const found = new Map<string, { verifyJwt: boolean; enabled: boolean }>();
  for (const match of config.matchAll(/^\[functions\.([^\]]+)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
    const body = match[2] ?? '';
    const flag = (key: string): boolean | undefined => {
      const value = new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, 'm').exec(body)?.[1];
      return value === undefined ? undefined : value === 'true';
    };
    found.set(match[1] ?? '', { verifyJwt: flag('verify_jwt') ?? true, enabled: flag('enabled') ?? true });
  }
  return found;
}

describe('the functions router (story 20.2): the table is config.toml’s', () => {
  it('routes exactly the [functions.*] tables of config.toml, each with its verify_jwt', () => {
    const config = configFunctions();
    expect(config.size, 'config.toml names no function').toBeGreaterThanOrEqual(2);
    expect([...FUNCTIONS.keys()].sort()).toEqual([...config.keys()].sort());
    for (const [name, { verifyJwt, enabled }] of config) {
      expect(enabled, `${name} is disabled in config.toml`).toBe(true);
      expect(FUNCTIONS.get(name)?.verifyJwt, `${name} verify_jwt`).toBe(verifyJwt);
    }
    // The epic's two, as AD-14 counts them.
    expect(FUNCTIONS.get('admin-auth')?.verifyJwt).toBe(true);
    expect(FUNCTIONS.get('notify')?.verifyJwt).toBe(false);
  });

  it('gives each worker exactly the variables its own handler reads, and nothing of the other’s', () => {
    for (const [name, entry] of FUNCTIONS) {
      const handler = read('supabase', 'functions', name, 'handler.ts');
      const reads = new Set([...handler.matchAll(/\b(?:read|getEnv)\('([A-Z][A-Z0-9_]*)'\)/g)].map((match) => match[1] ?? ''));
      expect(reads.size, `${name} reads no variable`).toBeGreaterThan(0);
      expect([...entry.environment].sort(), name).toEqual([...reads].sort());
      // And nothing else in the function's tree reads the environment directly.
      expect(read('supabase', 'functions', name, 'index.ts'), name).not.toMatch(/env\.get\('|Deno\.env\.toObject/);
    }
    expect(FUNCTIONS.get('admin-auth')?.environment).not.toContain('RESEND_API_KEY');
    expect(FUNCTIONS.get('admin-auth')?.environment).not.toContain('NOTIFY_INVOKE_SECRET');
    expect(FUNCTIONS.get('admin-auth')?.environment).not.toContain('VAPID_PRIVATE_KEY');
    expect(FUNCTIONS.get('notify')?.environment).not.toContain('SHIFT_PUBLISHABLE_KEY');
  });
});

// --------------------------------------------------------------- the image

describe('the shift-functions image (story 20.2)', () => {
  const dockerfile = read('deploy', 'functions', 'Dockerfile');
  const instructions = dockerfile
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  it('is the edge-runtime the compose pinned, and nothing else as a base', () => {
    expect(instructions.filter((line) => line.startsWith('FROM '))).toEqual(['FROM supabase/edge-runtime:v1.74.3']);
  });

  it('copies the router and exactly the routed functions, and bundles each at build time', () => {
    const copies = instructions.filter((line) => line.startsWith('COPY '));
    expect(copies).toEqual([
      'COPY deploy/functions/main/router.ts deploy/functions/main/workers.ts deploy/functions/main/index.ts /home/deno/functions/main/',
      ...[...FUNCTIONS.keys()].map((name) => `COPY supabase/functions/${name}/ /home/deno/functions/${name}/`),
    ]);
    const run = instructions.filter((line) => line.startsWith('RUN '));
    expect(run).toHaveLength(1);
    const bundles = [...(run[0] ?? '').matchAll(/edge-runtime bundle\s+--entrypoint\s+(\S+)\s+--output\s+(\S+)/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(bundles).toEqual(
      [...FUNCTIONS.keys()].map((name) => [
        `/home/deno/functions/${name}/index.ts`,
        // Where `index.ts` reads it from.
        `/home/deno/functions/${name}/bundle.eszip`,
      ]),
    );
    expect(FUNCTIONS_ROOT).toBe('file:///home/deno/functions/');
    expect(instructions.at(-1)).toBe('CMD ["start", "--main-service", "/home/deno/functions/main"]');
  });

  it('builds from a context that leaves local secrets and bulk out', () => {
    const ignored = read('.dockerignore').split('\n').map((line) => line.trim());
    for (const entry of ['.git', '**/node_modules', '**/.env', '**/.env.*']) expect(ignored).toContain(entry);
  });

  it('takes no secret, argument or variable at build time', () => {
    expect(instructions.filter((line) => /^(ARG|ENV|ADD) /.test(line))).toEqual([]);
    expect(dockerfile).not.toMatch(/sb_secret_|sb_publishable_[A-Za-z0-9]|re_[A-Za-z0-9]{8}|--secret/);
  });
});

// ----------------------------------------------- the router may not think

describe('the functions router (story 20.2): plumbing, not a function (AD-14, AD-16)', () => {
  const router = read('deploy', 'functions', 'main', 'router.ts');
  const wiring = read('deploy', 'functions', 'main', 'index.ts');
  const workers = read('deploy', 'functions', 'main', 'workers.ts');
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('imports nothing but its own decisions', () => {
    expect(code(router)).not.toMatch(/\bimport\b/);
    expect([...code(wiring).matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1])).toEqual(['./router.ts', './workers.ts']);
    expect([...code(workers).matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1])).toEqual(['./router.ts']);
    expect(code(workers)).toMatch(/import type \{ FunctionEntry \} from '\.\/router\.ts'/);
    for (const text of [code(wiring), code(workers)]) expect(text).not.toMatch(/\bimport\s*\(/);
  });

  it('holds no key, no signing secret, no client and no table', () => {
    for (const [file, text] of [['router.ts', code(router)], ['index.ts', code(wiring)], ['workers.ts', code(workers)]] as const) {
      expect(text, file).not.toMatch(/sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{10,}/);
      expect(text, file).not.toMatch(/JWT_SECRET|SERVICE_PASSWORD|createClient|\/rest\/v1|\.from\(|\.rpc\(|jose|crypto\.subtle/);
    }
    // The only variable the wiring reads for itself is GoTrue's address; the
    // functions' variables are passed by the names in the table.
    expect([...code(wiring).matchAll(/env\.get\('([A-Z_]+)'\)/g)].map((match) => match[1])).toEqual(['SHIFT_AUTH_URL']);
    expect(code(wiring)).not.toMatch(/toObject\(\)/);
  });

  it('logs fixed codes only, never a URL, a header or a token', () => {
    for (const [file, text] of [['router.ts', code(router)], ['index.ts', code(wiring)], ['workers.ts', code(workers)]] as const) {
      // A literal, or the one template that prints a router code: no value
      // that came from a request or the environment can reach the log.
      for (const call of text.matchAll(/console\.\w+\(([^()]*)\)/g)) {
        expect(call[1], `${file}: ${call[0]}`).toMatch(/^'[A-Za-z :_]*'$|^`router: \$\{code\}`$/);
      }
    }
    expect(code(router), 'router.ts logs directly').not.toMatch(/console\./);
    expect(code(workers), 'workers.ts logs directly').not.toMatch(/console\./);
    expect([...code(wiring).matchAll(/console\.\w+\(/g)].length, 'the scan found no log call').toBe(2);
  });

  it('passes no option that would load source or fetch a module', () => {
    expect(code(workers)).not.toMatch(/maybeModuleCode|maybeEntrypoint|noModuleCache|forceCreate: true/);
  });
});

// ------------------------------------------------------- the worker wiring

describe('the functions router (story 20.2): starting a worker', () => {
  const ESZIP = new Uint8Array([1, 2, 3]);
  const ENV: Record<string, string> = {
    SUPABASE_URL: 'http://supabase-kong:8000',
    SHIFT_SECRET_KEY: 'secret-placeholder',
    SHIFT_PUBLISHABLE_KEY: 'publishable-placeholder',
    RESEND_API_KEY: 'resend-placeholder',
    NOTIFY_INVOKE_SECRET: 'invoke-placeholder',
  };

  function wiring(options: {
    readFile?: (path: URL) => Promise<Uint8Array>;
    fetches?: ((request: Request) => Promise<Response>)[];
  } = {}): { forward: ReturnType<typeof createForward>; created: WorkerOptions[]; reads: string[] } {
    const created: WorkerOptions[] = [];
    const reads: string[] = [];
    const fetches = [...(options.fetches ?? [])];
    const forward = createForward({
      readFile: (path) => {
        reads.push(path.href);
        return options.readFile?.(path) ?? Promise.resolve(ESZIP);
      },
      createWorker: (workerOptions): Promise<Worker> => {
        created.push(workerOptions);
        const next = fetches.shift() ?? ((): Promise<Response> => Promise.resolve(new Response('ok')));
        return Promise.resolve({ fetch: next });
      },
      getEnv: (name) => ENV[name],
    });
    return { forward, created, reads };
  }

  const entry = (name: string): FunctionEntry => FUNCTIONS.get(name) as FunctionEntry;

  it('starts the worker from its bundle, remote modules off, with only its own variables that are set', async () => {
    const { forward, created, reads } = wiring();
    await forward('admin-auth', entry('admin-auth'), request('/admin-auth'));

    expect(reads).toEqual(['file:///home/deno/functions/admin-auth/bundle.eszip']);
    expect(created).toEqual([
      {
        servicePath: '/home/deno/functions/admin-auth/',
        maybeEszip: ESZIP,
        // SHIFT_ALLOWED_ORIGINS is in its table but unset here: left out, not ''.
        envVars: [
          ['SUPABASE_URL', ENV['SUPABASE_URL']],
          ['SHIFT_SECRET_KEY', ENV['SHIFT_SECRET_KEY']],
          ['SHIFT_PUBLISHABLE_KEY', ENV['SHIFT_PUBLISHABLE_KEY']],
        ],
        allowRemoteModules: false,
        forceCreate: false,
        memoryLimitMb: 150,
        workerTimeoutMs: WORKER_TIMEOUT_MS,
      },
    ]);
    // Never the other function's secrets.
    expect(created[0]?.envVars.map(([name]) => name)).not.toContain('RESEND_API_KEY');
    // Under Kong's 150 s read timeout, so the worker's limit answers first.
    expect(WORKER_TIMEOUT_MS).toBeLessThan(150_000);
  });

  it('reads each bundle once, and reads it again after a failed read', async () => {
    let failures = 1;
    const { forward, reads } = wiring({
      readFile: () => (failures-- > 0 ? Promise.reject(new Error('missing')) : Promise.resolve(ESZIP)),
    });
    await expect(forward('notify', entry('notify'), request('/notify'))).rejects.toThrow('missing');
    await forward('notify', entry('notify'), request('/notify'));
    await forward('notify', entry('notify'), request('/notify'));
    expect(reads).toHaveLength(2);
  });

  it('starts a fresh worker once when the pooled one retired, and never for any other failure', async () => {
    const retired = (): Promise<Response> =>
      Promise.reject(Object.assign(new Error('retired'), { name: 'WorkerAlreadyRetired' }));
    const answered = (): Promise<Response> => Promise.resolve(new Response('second'));

    const once = wiring({ fetches: [retired, answered] });
    const response = await once.forward('notify', entry('notify'), request('/notify'));
    expect(await response.text()).toBe('second');
    expect(once.created).toHaveLength(2);

    const twice = wiring({ fetches: [retired, retired] });
    await expect(twice.forward('notify', entry('notify'), request('/notify'))).rejects.toThrow('retired');
    expect(twice.created).toHaveLength(2);

    const other = wiring({ fetches: [(): Promise<Response> => Promise.reject(new Error('boom'))] });
    await expect(other.forward('notify', entry('notify'), request('/notify'))).rejects.toThrow('boom');
    expect(other.created).toHaveLength(1);
  });

  it('does not retry once the body has been read: the second worker would get an empty request', async () => {
    const consumed = async (sent: Request): Promise<Response> => {
      await sent.text();
      throw Object.assign(new Error('retired'), { name: 'WorkerAlreadyRetired' });
    };
    const { forward, created } = wiring({ fetches: [consumed] });
    await expect(forward('notify', entry('notify'), request('/notify', {}, { body: '{}' }))).rejects.toThrow('retired');
    expect(created).toHaveLength(1);
  });
});
