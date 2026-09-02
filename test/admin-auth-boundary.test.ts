import { describe, expect, it, vi } from 'vitest';

import {
  OPERATIONS,
  createHandler,
  readConfiguration,
} from '../supabase/functions/admin-auth/handler.ts';

/**
 * AD-16 / AD-17 — the privileged boundary refuses to act, and fails fast when
 * misconfigured. Both are asserted here in the node environment, with no
 * deployed function and no browser (AD-15).
 */

const VALID_ENV = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SHIFT_SECRET_KEY: 'sb_secret_test_value',
  SHIFT_PUBLISHABLE_KEY: 'sb_publishable_test_value',
  SHIFT_ALLOWED_ORIGINS: 'https://shift.example',
} as const;

const ALLOWED_ORIGIN = VALID_ENV.SHIFT_ALLOWED_ORIGINS;
const UNLISTED_ORIGIN = 'https://attacker.example';

function envFrom(overrides: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  return (name: string): string | undefined => merged[name];
}

function deps() {
  return {
    makePrivilegedClient: vi.fn(() => ({ privileged: true })),
    makeCallerClient: vi.fn((_authorization: string) => ({ caller: true })),
  };
}

function post(operation: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/admin-auth', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ operation }),
  });
}

/** Every `Access-Control-Allow-*` header on a response, as a plain object. */
function allowHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    [...response.headers].filter(([name]) => name.startsWith('access-control-allow-')),
  );
}

describe('admin-auth: every operation refuses to act', () => {
  it.each(OPERATIONS)('returns 501 NOT_IMPLEMENTED for %s', async (operation) => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post(operation));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ code: 'NOT_IMPLEMENTED', operation });
  });

  it('constructs both clients on a real request, proving the two-client wiring', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    await handle(post('createUser'));

    expect(dependencies.makePrivilegedClient).toHaveBeenCalledOnce();
    expect(dependencies.makeCallerClient).toHaveBeenCalledExactlyOnceWith('Bearer caller-jwt');
  });

  it('exposes exactly the four operations AD-16 permits, and nothing else', async () => {
    expect([...OPERATIONS]).toEqual(['createUser', 'updateUserById', 'ban', 'unban']);

    const handle = createHandler(readConfiguration(envFrom()), deps());
    const response = await handle(post('deleteUser'));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'OPERATION_UNKNOWN' });
  });

  it('refuses a request carrying no Authorization header', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'createUser' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'AUTHORIZATION_MISSING' });
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
  });
});

describe('admin-auth: transport refusals', () => {
  it('refuses a method other than POST, naming the method it refused', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'GET',
        headers: { Authorization: 'Bearer caller-jwt' },
      }),
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ code: 'METHOD_NOT_ALLOWED', method: 'GET' });
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
        body: '{ not json',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'BODY_NOT_JSON' });
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
  });

  // Valid JSON that is not an object reaches the operation lookup, where it must
  // be refused as an unknown operation rather than throwing on property access
  // — a throw would surface as a 500 with no code at all.
  it.each([
    ['a string', '"createUser"'],
    ['null', 'null'],
    ['an array', '["createUser"]'],
    ['a number', '7'],
  ])('refuses %s body as an unknown operation rather than throwing', async (_label, body) => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'OPERATION_UNKNOWN' });
  });
});

describe('admin-auth: CORS is an allowlist, not a wildcard', () => {
  it('parses the allowlist into trimmed entries', () => {
    const result = readConfiguration(
      envFrom({ SHIFT_ALLOWED_ORIGINS: ' https://a.example ,https://b.example , ' }),
    );

    expect(result).toMatchObject({
      ok: true,
      configuration: { allowedOrigins: ['https://a.example', 'https://b.example'] },
    });
  });

  it('echoes an allowed origin back, and varies on Origin', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post('createUser', { Origin: ALLOWED_ORIGIN }));

    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('vary')).toBe('Origin');
  });

  // The inversion this guards against: an allowlist check written the wrong way
  // round keeps every other test in this file green while turning CORS into `*`.
  it('grants an unlisted origin no Access-Control-Allow header at all', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post('createUser', { Origin: UNLISTED_ORIGIN }));

    expect(allowHeaders(response)).toEqual({});
    // Still varies, so a cache cannot replay this reply to an allowed origin.
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('grants a request with no Origin no Access-Control-Allow header either', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post('createUser'));

    expect(allowHeaders(response)).toEqual({});
    expect(response.headers.get('vary')).toBe('Origin');
  });
});

describe('admin-auth: the CORS preflight', () => {
  const preflight = (origin: string): Request =>
    new Request('http://localhost/admin-auth', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });

  it('answers an allowed origin with 204 and the negotiated method and headers', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(preflight(ALLOWED_ORIGIN));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
  });

  it('answers an unlisted origin with 204 but grants it nothing', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(preflight(UNLISTED_ORIGIN));

    expect(response.status).toBe(204);
    expect(allowHeaders(response)).toEqual({});
  });

  // Deliberate precedence: the preflight is answered before the configuration
  // check, so a misconfigured function still lets the browser reach the POST
  // and read the real 500 code instead of reporting an opaque CORS failure.
  it('still answers 204 when the function is misconfigured, not the 500 code', async () => {
    const handle = createHandler(
      readConfiguration(envFrom({ SHIFT_SECRET_KEY: undefined })),
      deps(),
    );

    const response = await handle(preflight(ALLOWED_ORIGIN));

    expect(response.status).toBe(204);
    // No allowlist survives a failed configuration read, so nothing is granted.
    expect(allowHeaders(response)).toEqual({});
  });
});

describe('admin-auth: fails fast when misconfigured, and never falls back', () => {
  it.each([
    ['secret key absent', { SHIFT_SECRET_KEY: undefined }, 'SECRET_KEY_MISSING'],
    ['secret key blank', { SHIFT_SECRET_KEY: '   ' }, 'SECRET_KEY_MISSING'],
    ['secret slot holds a publishable key', { SHIFT_SECRET_KEY: 'sb_publishable_oops' }, 'SECRET_KEY_INVALID'],
    ['publishable key absent', { SHIFT_PUBLISHABLE_KEY: undefined }, 'PUBLISHABLE_KEY_MISSING'],
    ['publishable slot holds a secret key', { SHIFT_PUBLISHABLE_KEY: 'sb_secret_oops' }, 'PUBLISHABLE_KEY_INVALID'],
    ['project url absent', { SUPABASE_URL: undefined }, 'PROJECT_URL_MISSING'],
    ['project url is not a url', { SUPABASE_URL: 'not-a-url' }, 'PROJECT_URL_INVALID'],
    ['project url is not http(s)', { SUPABASE_URL: 'postgres://db.example:5432' }, 'PROJECT_URL_INVALID'],
  ])('reports %s as %s', (_label, overrides, code) => {
    const result = readConfiguration(envFrom(overrides));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code });
  });

  // A dashboard paste or a heredoc leaves a trailing newline. Untrimmed it
  // passes `startsWith` and then fails opaquely at the real auth call.
  it('accepts values carrying surrounding whitespace, and stores them trimmed', () => {
    const result = readConfiguration(
      envFrom({
        SUPABASE_URL: ' http://127.0.0.1:54321\n',
        SHIFT_SECRET_KEY: 'sb_secret_test_value\n',
        SHIFT_PUBLISHABLE_KEY: '\tsb_publishable_test_value ',
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      configuration: {
        projectUrl: 'http://127.0.0.1:54321',
        secretKey: 'sb_secret_test_value',
        publishableKey: 'sb_publishable_test_value',
      },
    });
  });

  it('answers 500 with the stable code and never reaches the 501 path', async () => {
    const dependencies = deps();
    const configuration = readConfiguration(envFrom({ SHIFT_SECRET_KEY: undefined }));
    const handle = createHandler(configuration, dependencies);

    const response = await handle(post('createUser'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'SECRET_KEY_MISSING' });
    // The fallback AD-17 forbids: downgrading to the publishable key and
    // acting anyway would show up here as a constructed client.
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
    expect(dependencies.makeCallerClient).not.toHaveBeenCalled();
  });

  it('reports CLIENT_CONSTRUCTION_FAILED rather than acting when a client cannot be built', async () => {
    const handle = createHandler(readConfiguration(envFrom()), {
      makePrivilegedClient: () => {
        throw new Error('SECRET_KEY_MISSING');
      },
      makeCallerClient: () => ({ caller: true }),
    });

    const response = await handle(post('createUser'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'CLIENT_CONSTRUCTION_FAILED' });
  });

  it('leaks no key material in any response, configured or not', async () => {
    for (const configuration of [
      readConfiguration(envFrom()),
      readConfiguration(envFrom({ SHIFT_SECRET_KEY: undefined })),
    ]) {
      const handle = createHandler(configuration, deps());
      const response = await handle(post('createUser', { Origin: ALLOWED_ORIGIN }));
      const serialized = `${await response.text()}${JSON.stringify([...response.headers])}`;

      expect(serialized).not.toContain('sb_secret_');
      expect(serialized).not.toContain(VALID_ENV.SHIFT_SECRET_KEY);
    }
  });
});
