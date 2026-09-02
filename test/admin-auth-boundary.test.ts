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

const VALID_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SHIFT_SECRET_KEY: 'sb_secret_test_value',
  SHIFT_PUBLISHABLE_KEY: 'sb_publishable_test_value',
  SHIFT_ALLOWED_ORIGINS: 'https://shift.example',
};

function envFrom(overrides: Record<string, string | undefined> = {}) {
  const merged = { ...VALID_ENV, ...overrides };
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

describe('admin-auth: fails fast when misconfigured, and never falls back', () => {
  it.each([
    ['secret key absent', { SHIFT_SECRET_KEY: undefined }, 'SECRET_KEY_MISSING'],
    ['secret slot holds a publishable key', { SHIFT_SECRET_KEY: 'sb_publishable_oops' }, 'SECRET_KEY_INVALID'],
    ['publishable key absent', { SHIFT_PUBLISHABLE_KEY: undefined }, 'PUBLISHABLE_KEY_MISSING'],
    ['publishable slot holds a secret key', { SHIFT_PUBLISHABLE_KEY: 'sb_secret_oops' }, 'PUBLISHABLE_KEY_INVALID'],
    ['project url absent', { SUPABASE_URL: undefined }, 'PROJECT_URL_MISSING'],
  ])('reports %s as %s', (_label, overrides, code) => {
    const result = readConfiguration(envFrom(overrides));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code });
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
      const response = await handle(post('createUser'));
      const serialized = `${await response.text()}${JSON.stringify([...response.headers])}`;

      expect(serialized).not.toContain('sb_secret_');
      expect(serialized).not.toContain(VALID_ENV.SHIFT_SECRET_KEY);
    }
  });
});
