import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MUST_SET_PASSWORD,
  PASSWORD_MIN_LENGTH,
  SET_PASSWORD_MISMATCH,
  SET_PASSWORD_NOT_CONTINUED,
  SET_PASSWORD_SAME,
  SET_PASSWORD_SIGN_IN_AGAIN,
  SET_PASSWORD_TOO_SHORT,
  SET_PASSWORD_UNAVAILABLE,
  NOTHING_TYPED,
  failureDescribes,
  mustSetPassword,
  ruleStateMessageKey,
  savePassword,
  setPasswordFailureField,
  setPasswordMessageKey,
  setPasswordRefusalOf,
  typedStateOf,
  type SetPasswordAuthFailure,
  type SetPasswordClient,
} from '@/features/auth/services/set-password';

/**
 * The first sign-in's rules and its three-step save, executed (story 7.8).
 *
 * Every client is a stub, so each row of the story's matrix runs with nothing
 * running: the flag the guard reads, the local refusals, `same_password`, and
 * the retry that repeats only the clear once the password has landed.
 */

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));

const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  silenced.mockClear();
});

interface Calls {
  readonly updates: string[];
  readonly invokes: { name: string; body: Readonly<Record<string, unknown>> }[];
  refreshes: number;
}

interface Plan {
  readonly update?: SetPasswordAuthFailure | null | Error;
  readonly clear?: readonly ({ data: unknown; status?: number } | Error)[];
  readonly refresh?: SetPasswordAuthFailure | null;
  /** The refreshed session's `app_metadata`; by default the flag is cleared. */
  readonly refreshed?: Readonly<Record<string, unknown>>;
}

/** A client that answers each call as planned, and records every call. */
function clientThat(plan: Plan = {}): { client: SetPasswordClient; calls: Calls } {
  const calls: Calls = { updates: [], invokes: [], refreshes: 0 };
  let clearIndex = 0;

  return {
    calls,
    client: {
      auth: {
        updateUser: ({ password }) => {
          calls.updates.push(password);
          if (plan.update instanceof Error) return Promise.reject(plan.update);

          return Promise.resolve({ error: plan.update ?? null });
        },
        refreshSession: () => {
          calls.refreshes += 1;

          const error = plan.refresh ?? null;

          return Promise.resolve({
            data: {
              session:
                error === null
                  ? { user: { app_metadata: plan.refreshed ?? { [MUST_SET_PASSWORD]: false } } }
                  : null,
            },
            error,
          });
        },
      },
      functions: {
        invoke: (name, { body }) => {
          calls.invokes.push({ name, body });
          const answer = plan.clear?.[clearIndex] ?? { data: { code: 'PASSWORD_FLAG_CLEARED' } };
          clearIndex += 1;

          if (answer instanceof Error) return Promise.reject(answer);
          // A non-2xx: supabase-js leaves `data` null and hides the body on a
          // real `Response`, whose `json` is brand-checked.
          if (answer.status !== undefined && answer.status >= 300) {
            return Promise.resolve({
              data: null,
              error: {
                context: new Response(JSON.stringify(answer.data), { status: answer.status }),
              },
            });
          }

          return Promise.resolve({ data: answer.data, error: null });
        },
      },
    },
  };
}

const GOOD = 'mirna-zora-12';

describe('the guard holds a flagged session, and only a flagged one', () => {
  it('holds a session whose app_metadata says true', () => {
    expect(mustSetPassword({ user: { app_metadata: { [MUST_SET_PASSWORD]: true } } })).toBe(true);
  });

  it.each([
    ['false', { [MUST_SET_PASSWORD]: false }],
    ['absent (an account issued before 7.8, or a seeded one)', {}],
    ['a string', { [MUST_SET_PASSWORD]: 'true' }],
  ])('lets through a flag that is %s', (_label, metadata) => {
    expect(mustSetPassword({ user: { app_metadata: metadata } })).toBe(false);
  });

  it('lets through no app_metadata at all, and holds no session', () => {
    expect(mustSetPassword({ user: {} })).toBe(false);
    expect(mustSetPassword(null)).toBe(false);
  });

  it('reads the key admin-auth writes, spelled the way the function spells it', () => {
    const operations = readFileSync(
      `${repoRoot}supabase/functions/admin-auth/operations.ts`,
      'utf8',
    );

    expect(operations).toContain(`export const MUST_SET_PASSWORD = '${MUST_SET_PASSWORD}';`);
  });

  it('refuses locally at the floor GoTrue is configured with', () => {
    const config = readFileSync(`${repoRoot}supabase/config.toml`, 'utf8');

    expect(config).toMatch(new RegExp(`\\nminimum_password_length = ${PASSWORD_MIN_LENGTH}\\n`));
  });
});

describe('the two fields are refused before any request', () => {
  it('refuses one character under the floor and admits the floor', () => {
    const under = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const floor = 'a'.repeat(PASSWORD_MIN_LENGTH);

    expect(setPasswordRefusalOf(under, under)).toBe(SET_PASSWORD_TOO_SHORT);
    expect(setPasswordRefusalOf(floor, floor)).toBeNull();
  });

  it('refuses a repeat that differs, and says the length first', () => {
    expect(setPasswordRefusalOf(GOOD, `${GOOD}x`)).toBe(SET_PASSWORD_MISMATCH);
    expect(setPasswordRefusalOf('short', 'other')).toBe(SET_PASSWORD_TOO_SHORT);
  });

  it('binds each refusal to the field it is about', () => {
    expect(setPasswordFailureField(SET_PASSWORD_TOO_SHORT)).toBe('new');
    expect(setPasswordFailureField(SET_PASSWORD_SAME)).toBe('new');
    expect(setPasswordFailureField(SET_PASSWORD_MISMATCH)).toBe('repeat');
    expect(setPasswordFailureField(SET_PASSWORD_UNAVAILABLE)).toBe('both');
    expect(setPasswordFailureField(SET_PASSWORD_NOT_CONTINUED)).toBe('both');
  });

  it('describes the new password, the repeat, both or neither', () => {
    expect(failureDescribes(null)).toEqual({ password: false, repeat: false });
    expect(failureDescribes(SET_PASSWORD_TOO_SHORT)).toEqual({ password: true, repeat: false });
    expect(failureDescribes(SET_PASSWORD_MISMATCH)).toEqual({ password: false, repeat: true });
    expect(failureDescribes(SET_PASSWORD_NOT_CONTINUED)).toEqual({ password: true, repeat: true });
  });

  it('counts what is typed for the live checks, and never reads nothing as a match', () => {
    expect(NOTHING_TYPED).toEqual({ typed: 0, longEnough: false, matches: false });
    expect(typedStateOf('a'.repeat(PASSWORD_MIN_LENGTH - 1), 'a'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      typed: PASSWORD_MIN_LENGTH - 1,
      longEnough: false,
      matches: true,
    });
    expect(typedStateOf(GOOD, `${GOOD}x`)).toEqual({ typed: GOOD.length, longEnough: true, matches: false });
  });

  it('gives every failure its own message, and the checks their state in words', () => {
    const keys = ([
      SET_PASSWORD_TOO_SHORT,
      SET_PASSWORD_MISMATCH,
      SET_PASSWORD_SAME,
      SET_PASSWORD_UNAVAILABLE,
      SET_PASSWORD_NOT_CONTINUED,
      SET_PASSWORD_SIGN_IN_AGAIN,
    ] as const).map((failure) => setPasswordMessageKey(failure));

    expect(new Set(keys).size).toBe(keys.length);
    expect(ruleStateMessageKey(true)).not.toBe(ruleStateMessageKey(false));
  });
});

describe('the save is three steps, in order', () => {
  it('saves the password, clears the flag for the caller, then refreshes', async () => {
    const { client, calls } = clientThat();

    expect(await savePassword(client, GOOD, false)).toEqual({ ok: true });
    expect(calls.updates).toEqual([GOOD]);
    // THE OPERATION AND NOTHING ELSE: the function names its target by the
    // caller's token, and a body id would be a claim it ignores anyway.
    expect(calls.invokes).toEqual([
      { name: 'admin-auth', body: { operation: 'clearMustSetPassword' } },
    ]);
    expect(calls.refreshes).toBe(1);
  });

  it('answers GoTrue\'s same_password as its own refusal, and clears nothing', async () => {
    const { client, calls } = clientThat({ update: { code: 'same_password', status: 422 } });

    expect(await savePassword(client, GOOD, false)).toEqual({
      ok: false,
      code: SET_PASSWORD_SAME,
      passwordSaved: false,
    });
    expect(calls.invokes).toHaveLength(0);
    expect(calls.refreshes).toBe(0);
  });

  it('answers a refused or unanswered update as not saved', async () => {
    for (const update of [{ code: 'unexpected_failure', status: 500 }, new TypeError('Failed to fetch')]) {
      const { client, calls } = clientThat({ update });

      expect(await savePassword(client, GOOD, false)).toEqual({
        ok: false,
        code: SET_PASSWORD_UNAVAILABLE,
        passwordSaved: false,
      });
      expect(calls.invokes).toHaveLength(0);
    }
  });

  it('never logs the password, on any path', async () => {
    const { client } = clientThat({ update: { code: 'unexpected_failure', status: 500 } });

    await savePassword(client, GOOD, false);
    await savePassword(clientThat({ clear: [{ data: { code: 'PASSWORD_FLAG_NOT_CLEARED' }, status: 502 }] }).client, GOOD, false);

    expect(JSON.stringify(silenced.mock.calls)).not.toContain(GOOD);
  });
});

describe('a failed clear after a saved password retries only the clear', () => {
  it('reports the password saved when the function answers 502', async () => {
    const { client, calls } = clientThat({
      clear: [{ data: { code: 'PASSWORD_FLAG_NOT_CLEARED' }, status: 502 }],
    });

    expect(await savePassword(client, GOOD, false)).toEqual({
      ok: false,
      code: SET_PASSWORD_NOT_CONTINUED,
      passwordSaved: true,
    });
    expect(calls.refreshes).toBe(0);
  });

  it('repeats only steps 2 and 3 on the retry', async () => {
    const { client, calls } = clientThat({
      clear: [{ data: { code: 'PASSWORD_FLAG_NOT_CLEARED' }, status: 502 }, { data: { code: 'PASSWORD_FLAG_CLEARED' } }],
    });

    const first = await savePassword(client, GOOD, false);

    expect(first.ok).toBe(false);
    expect(await savePassword(client, GOOD, !first.ok && first.passwordSaved)).toEqual({ ok: true });
    expect(calls.updates, 'the retry set the password a second time').toEqual([GOOD]);
    expect(calls.invokes).toHaveLength(2);
    expect(calls.refreshes).toBe(1);
  });

  it('treats any other reply, a rejected call and a failed refresh as not continued', async () => {
    for (const plan of [
      { clear: [{ data: { code: 'OPERATION_FAILED' } }] },
      { clear: [{ data: null }] },
      { clear: [new TypeError('Failed to fetch')] },
      { refresh: { code: 'refresh_token_not_found', status: 400 } },
    ] satisfies Plan[]) {
      expect(await savePassword(clientThat(plan).client, GOOD, false)).toEqual({
        ok: false,
        code: SET_PASSWORD_NOT_CONTINUED,
        passwordSaved: true,
      });
    }
  });

  it('tells the member to sign in again when the function refuses the token', async () => {
    const { client, calls } = clientThat({
      clear: [{ data: { code: 'AUTHORIZATION_MISSING' }, status: 401 }],
    });

    expect(await savePassword(client, GOOD, false)).toEqual({
      ok: false,
      code: SET_PASSWORD_SIGN_IN_AGAIN,
      passwordSaved: true,
    });
    expect(calls.refreshes).toBe(0);
    expect(setPasswordMessageKey(SET_PASSWORD_SIGN_IN_AGAIN)).toBe('auth.setPassword.error.signInAgain');
  });

  it('is not a success while the refreshed session still carries the flag', async () => {
    const { client, calls } = clientThat({ refreshed: { [MUST_SET_PASSWORD]: true } });

    expect(await savePassword(client, GOOD, false)).toEqual({
      ok: false,
      code: SET_PASSWORD_NOT_CONTINUED,
      passwordSaved: true,
    });
    expect(calls.refreshes).toBe(1);
  });
});
