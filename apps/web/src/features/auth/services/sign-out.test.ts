import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SIGN_OUT_DEVICE_ONLY,
  SIGN_OUT_FAILED,
  SIGN_OUT_LOCAL,
  SIGN_OUT_LOCAL_UNAVAILABLE,
  SIGN_OUT_OFFLINE,
  signOut,
  type SessionAuth,
  type SignOutFailureShape,
} from '@/features/auth/services/sign-out';
import type { LocalFallback } from '@/lib/supabase/local-sign-out';

/**
 * The exit's outcomes, executed (the navigation shell, part B).
 *
 * The auth client is the first parameter for the reason `signIn`'s is, so every
 * row runs against a stub with nothing running. The revocation happened; or
 * GoTrue refused it, or the request never landed — and for those two the DEVICE
 * decides (E786): still holding the session is the one failure, and no longer
 * holding it is a device-only sign-out, which is a success.
 */

/** What the device answers when asked, after a failure, whether it still holds a session. */
type Device = 'held' | 'cleared' | 'unreadable' | 'rejects';

/** `getSession` as the device would answer it. */
function device(state: Device): SessionAuth['getSession'] {
  return () => {
    if (state === 'rejects') return Promise.reject(new Error('SecurityError'));
    if (state === 'unreadable') {
      return Promise.resolve({ data: { session: null }, error: { message: 'Failed to fetch' } });
    }

    return Promise.resolve({
      data: { session: state === 'held' ? { access_token: 'token' } : null },
      error: null,
    });
  };
}

/** An auth client that answers with whatever GoTrue would have answered. */
function answering(error: SignOutFailureShape | null, state: Device = 'held'): SessionAuth {
  return { signOut: () => Promise.resolve({ error }), getSession: device(state) };
}

/** An auth client whose call never completes — the offline case. */
function throwing(state: Device = 'held'): SessionAuth {
  return {
    signOut: () => Promise.reject(new TypeError('Failed to fetch')),
    getSession: device(state),
  };
}

/** Every failure below logs its cause; the spy is what keeps the run readable
 *  and is also what the logging assertions are made through. */
const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
  silenced.mockClear();
  warned.mockClear();
});

describe('a revoked session is the success', () => {
  it('answers ok when GoTrue reports no error', async () => {
    expect(await signOut(answering(null))).toEqual({ ok: true });
  });

  it('calls the client exactly once and hands it nothing', async () => {
    // The session to end is the one the client holds; passing an identifier
    // would be a second source of truth for who is signed in, and the client's
    // own is the one that decides.
    let calls = 0;
    let asked = 0;
    const auth: SessionAuth = {
      signOut: () => {
        calls += 1;

        return Promise.resolve({ error: null });
      },
      getSession: () => {
        asked += 1;

        return Promise.resolve({ data: { session: null }, error: null });
      },
    };

    await signOut(auth);

    expect(calls).toBe(1);
    // The device is asked only after a failure: a clean revocation needs no
    // second opinion.
    expect(asked).toBe(0);
  });

  it('carries nothing but the flag, so nothing downstream can branch on a payload', async () => {
    // Deep equality rather than `outcome.ok`: a passed-through `error` or
    // `session` here would be a field the chrome could render, and this module's
    // whole vocabulary is "it happened or it did not".
    expect(JSON.stringify(await signOut(answering(null)))).toBe(JSON.stringify({ ok: true }));
  });
});

describe('a refusal and a rejection are one answer while the device still holds the session', () => {
  it.each([
    {
      row: 'a refusal from GoTrue',
      error: { name: 'AuthApiError', status: 403, code: 'invalid_token', message: 'Invalid token' },
    },
    {
      row: 'a fetch that never completed',
      error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
    },
    { row: 'an error carrying no status at all', error: { message: 'Failed to fetch' } },
    {
      row: 'a rate limit, which says not now rather than not you',
      error: { name: 'AuthApiError', status: 429, message: 'Too many requests' },
    },
  ])('maps $row to the single failure code', async ({ error }) => {
    expect(await signOut(answering(error))).toEqual({ ok: false, code: SIGN_OUT_FAILED });
  });

  it('maps a rejected call to the same code rather than letting it escape', async () => {
    // An escaping rejection would leave the chrome's handler with no outcome to
    // read — and the branch that navigates to a sign-in route is the one that
    // must not run, since a still-valid session bounces straight off it.
    expect(await signOut(throwing())).toEqual({ ok: false, code: SIGN_OUT_FAILED });
  });

  it('returns byte-identical outcomes for a refusal and a rejection', async () => {
    // Each row above passing individually still permits a fourth field — a
    // passed-through `message`, an operand naming the upstream code — that the
    // chrome could then branch on, which is how one message region quietly
    // becomes two.
    const refused = await signOut(
      answering({ name: 'AuthApiError', status: 403, message: 'Invalid token' }),
    );
    const rejected = await signOut(throwing());

    expect(refused).toEqual(rejected);
    expect(JSON.stringify(refused)).toBe(JSON.stringify(rejected));
  });

  it('logs the cause, since this module is the only place that sees it', async () => {
    // The chrome wraps its own call in a `try`/`catch` that logs — and this
    // function does not rethrow, so that catch never sees a transport failure at
    // all. Before this, a sign-out that never left the device was recorded
    // nowhere: one code to the screen and nothing anywhere to say whether GoTrue
    // refused the token or the request never landed.
    const refused = { name: 'AuthApiError', status: 403, message: 'Invalid token' };

    await signOut(answering(refused));
    expect(silenced, 'a refused revocation is discarded').toHaveBeenCalledWith(
      SIGN_OUT_FAILED,
      refused,
    );

    silenced.mockClear();
    await signOut(throwing());
    expect(silenced, 'a rejected revocation is discarded').toHaveBeenCalledWith(
      SIGN_OUT_FAILED,
      expect.anything(),
    );

    silenced.mockClear();
    await signOut(answering(null));
    expect(silenced, 'the ordinary successful path writes to the console').not.toHaveBeenCalled();
  });

  it.each<Device>(['held', 'unreadable', 'rejects'])(
    'fails when the device answers %s, since a session it cannot rule out is not ended',
    async (state) => {
      expect(await signOut(answering({ message: 'nope' }, state))).toEqual({
        ok: false,
        code: SIGN_OUT_FAILED,
      });
      expect(await signOut(throwing(state))).toEqual({ ok: false, code: SIGN_OUT_FAILED });
    },
  );

  it('never reports a failure as a success, which is the whole security claim', async () => {
    // Vacuous-pass guard AND the claim: on a shared device, an interface that
    // says somebody signed out while the session is live hands the next person a
    // working session. The success and the failure must not be equal.
    const succeeded = await signOut(answering(null));
    const failed = await signOut(answering({ message: 'nope' }));

    expect(succeeded).not.toEqual(failed);
    expect(succeeded.ok).toBe(true);
    expect(failed.ok).toBe(false);
  });
});

describe('a refused revocation that cleared the device is a device-only sign-out (E786)', () => {
  /**
   * supabase-js removes the session from the device even when GoTrue refuses
   * the global revocation, and still answers with the refusal. Reading the
   * answer alone told a person this device had signed out that the sign-out
   * failed, and left them on a chrome whose next navigation bounced them to the
   * form. The device is what a shared-device sign-out has to clear, so it is
   * the device that decides.
   */
  it.each([
    { row: 'a refusal from GoTrue', auth: answering({ status: 500, message: 'boom' }, 'cleared') },
    { row: 'a rejected call', auth: throwing('cleared') },
  ])('answers ok after $row when the device holds no session', async ({ auth }) => {
    expect(await signOut(auth)).toEqual({ ok: true });
  });

  it('warns under its own code rather than reporting a failure', async () => {
    const refused = { name: 'AuthApiError', status: 500, message: 'boom' };

    await signOut(answering(refused, 'cleared'));

    expect(warned).toHaveBeenCalledWith(SIGN_OUT_DEVICE_ONLY, refused);
    expect(silenced, 'a device-only sign-out was logged as a failure').not.toHaveBeenCalled();
  });

  it('is byte-identical to a clean revocation, so the caller has one success branch', async () => {
    expect(JSON.stringify(await signOut(throwing('cleared')))).toBe(
      JSON.stringify(await signOut(answering(null))),
    );
  });
});

describe('a sign-out the global revocation cannot finish falls back to a local one (story 8.3a)', () => {
  const KEY = 'sb-127-auth-token';

  /**
   * auth-js 2.113.0 as it behaves offline with an expired token: the session
   * cannot be loaded (its refresh fails retryably), so every `signOut` —
   * global or local — answers that error and keeps the session, until the
   * stored session is dropped; then a local `signOut` finds none and succeeds.
   */
  function expiredOffline(): { auth: SessionAuth; fallback: (online: boolean) => LocalFallback; scopes: string[]; removed: string[] } {
    const stored = new Map<string, string>([[KEY, '{"access_token":"t"}']]);
    const scopes: string[] = [];
    const removed: string[] = [];
    const retryable = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
    const auth: SessionAuth = {
      signOut: (options) => {
        scopes.push(options?.scope ?? 'global');

        return Promise.resolve({ error: stored.has(KEY) ? retryable : null });
      },
      getSession: () =>
        Promise.resolve(
          stored.has(KEY)
            ? { data: { session: null }, error: retryable }
            : { data: { session: null }, error: null },
        ),
    };
    const fallback = (online: boolean): LocalFallback => ({
      online: () => online,
      store: () => ({
        storageKey: KEY,
        storage: {
          removeItem: (key) => {
            removed.push(key);
            stored.delete(key);
          },
        },
      }),
    });

    return { auth, fallback, scopes, removed };
  }

  it('signs out locally after a retryable failure that kept the session', async () => {
    const { auth, fallback, scopes, removed } = expiredOffline();

    expect(await signOut(auth, fallback(true))).toEqual({ ok: true });
    expect(scopes).toEqual(['global', 'local']);
    expect(removed).toEqual([KEY, `${KEY}-code-verifier`, `${KEY}-user`]);
    // ONE LOG: the warning, never an error before it.
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(SIGN_OUT_LOCAL, expect.objectContaining({ status: 0 }));
    expect(silenced).not.toHaveBeenCalled();
  });

  it('offline, signs out locally at once, with no global revocation attempted', async () => {
    const { auth, fallback, scopes, removed } = expiredOffline();

    expect(await signOut(auth, fallback(false))).toEqual({ ok: true });
    expect(scopes).toEqual(['local']);
    expect(removed).toEqual([KEY, `${KEY}-code-verifier`, `${KEY}-user`]);
    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(SIGN_OUT_LOCAL, SIGN_OUT_OFFLINE);
    expect(silenced).not.toHaveBeenCalled();
  });

  it('signs out locally after a rejected call (the request never landed)', async () => {
    const { fallback, scopes } = expiredOffline();
    let held = true;
    const auth: SessionAuth = {
      signOut: (options) => {
        scopes.push(options?.scope ?? 'global');
        if (options?.scope !== 'local') return Promise.reject(new TypeError('Failed to fetch'));
        held = false;

        return Promise.resolve({ error: null });
      },
      getSession: () => Promise.resolve({ data: { session: held ? { access_token: 't' } : null }, error: null }),
    };

    expect(await signOut(auth, fallback(true))).toEqual({ ok: true });
    expect(scopes).toEqual(['global', 'local']);
  });

  it('keeps the failure for a refusal that is not retryable: the fallback is for the network', async () => {
    const { fallback, scopes } = expiredOffline();
    const refused = { name: 'AuthApiError', status: 500, message: 'boom' };
    const auth: SessionAuth = {
      signOut: (options) => {
        scopes.push(options?.scope ?? 'global');

        return Promise.resolve({ error: refused });
      },
      getSession: device('held'),
    };

    expect(await signOut(auth, fallback(true))).toEqual({ ok: false, code: SIGN_OUT_FAILED });
    expect(scopes).toEqual(['global']);
  });

  it('fails when the device still holds a session after the local sign-out', async () => {
    const auth: SessionAuth = {
      signOut: () => Promise.resolve({ error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } }),
      getSession: device('held'),
    };
    const fallback: LocalFallback = {
      online: () => true,
      store: () => ({ storageKey: KEY, storage: { removeItem: () => undefined } }),
    };

    expect(await signOut(auth, fallback)).toEqual({ ok: false, code: SIGN_OUT_FAILED });
  });

  it.each([502, 503, 504])(
    'online, keeps the failure code for a %i the server answered: only a transport failure goes local',
    async (status) => {
      const { fallback, scopes, removed } = expiredOffline();
      const auth: SessionAuth = {
        signOut: (options) => {
          scopes.push(options?.scope ?? 'global');

          return Promise.resolve({ error: { name: 'AuthRetryableFetchError', status, message: 'Bad gateway' } });
        },
        getSession: device('held'),
      };

      expect(await signOut(auth, fallback(true))).toEqual({ ok: false, code: SIGN_OUT_FAILED });
      expect(scopes).toEqual(['global']);
      expect(removed).toEqual([]);
    },
  );

  it('never waits on a local sign-out held up past its budget: the removal is the outcome', async () => {
    const { fallback, removed } = expiredOffline();
    const auth: SessionAuth = {
      // A refresh lock the local call would wait on: it never settles.
      signOut: (options) =>
        options?.scope === 'local' ? new Promise(() => undefined) : Promise.reject(new TypeError('Failed to fetch')),
      getSession: device('held'),
    };

    expect(await signOut(auth, { ...fallback(false), budgetMs: 20 })).toEqual({ ok: true });
    expect(removed).toEqual([KEY, `${KEY}-code-verifier`, `${KEY}-user`]);
  });

  it.each([
    { row: 'no key', store: { storage: { removeItem: () => undefined } } },
    { row: 'an empty key', store: { storageKey: '', storage: { removeItem: () => undefined } } },
    { row: 'no removeItem', store: { storageKey: KEY, storage: {} } },
    { row: 'no storage', store: { storageKey: KEY } },
  ])('fails with its own logged code when the client storage has $row', async ({ store }) => {
    const { auth } = expiredOffline();
    const fallback = { online: () => false, store: () => store } as unknown as LocalFallback;

    expect(await signOut(auth, fallback)).toEqual({ ok: false, code: SIGN_OUT_FAILED });
    expect(silenced).toHaveBeenCalledWith(SIGN_OUT_LOCAL_UNAVAILABLE, SIGN_OUT_OFFLINE);
    expect(warned).not.toHaveBeenCalled();
  });

  it('without a fallback, a retryable failure stays the one failure code, as before', async () => {
    const { auth } = expiredOffline();

    expect(await signOut(auth)).toEqual({ ok: false, code: SIGN_OUT_FAILED });
  });
});
