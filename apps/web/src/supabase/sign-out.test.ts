import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SIGN_OUT_FAILED,
  signOut,
  type SessionAuth,
  type SignOutFailureShape,
} from '@/supabase/sign-out';

/**
 * The exit's outcomes, executed (the navigation shell, part B).
 *
 * The auth client is the first parameter for the reason `signIn`'s is, so every
 * row runs against a stub with nothing running. Three rows: the revocation
 * happened, GoTrue refused it, and the request never landed — and the last two
 * must be the same answer, because the only thing the caller does with either is
 * say so and leave the person signed in.
 */

/** An auth client that answers with whatever GoTrue would have answered. */
function answering(error: SignOutFailureShape | null): SessionAuth {
  return { signOut: () => Promise.resolve({ error }) };
}

/** An auth client whose call never completes — the offline case. */
function throwing(): SessionAuth {
  return { signOut: () => Promise.reject(new TypeError('Failed to fetch')) };
}

/** Every failure below logs its cause; the spy is what keeps the run readable
 *  and is also what the logging assertions are made through. */
const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  silenced.mockClear();
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
    const auth: SessionAuth = {
      signOut: () => {
        calls += 1;

        return Promise.resolve({ error: null });
      },
    };

    await signOut(auth);

    expect(calls).toBe(1);
  });

  it('carries nothing but the flag, so nothing downstream can branch on a payload', async () => {
    // Deep equality rather than `outcome.ok`: a passed-through `error` or
    // `session` here would be a field the chrome could render, and this module's
    // whole vocabulary is "it happened or it did not".
    expect(JSON.stringify(await signOut(answering(null)))).toBe(JSON.stringify({ ok: true }));
  });
});

describe('a refusal and a rejection are one answer, because the session survived both', () => {
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
