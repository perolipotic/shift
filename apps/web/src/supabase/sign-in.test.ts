import type { Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  SIGN_IN_REFUSED,
  SIGN_IN_UNAVAILABLE,
  signIn,
  signInMessageKey,
  type AuthFailure,
  type PasswordAuth,
  type SignInFailure,
} from '@/supabase/sign-in';

/**
 * The story's I/O matrix, executed (story 1.3b).
 *
 * AD-15 bans jsdom and rules out driving a real navigation, so what is asserted
 * here is the mapping itself — which is where the security property lives. The
 * auth client is a parameter, so every row runs against a stub with nothing
 * running: no stack, no environment, no network.
 *
 * The claim that matters is a NEGATIVE one, and negatives are what a
 * row-by-row suite tends to miss: it is not enough that each refusal maps to
 * `SIGN_IN_REFUSED`, it must be impossible to tell the three refusals apart
 * from anything this function returns. So the three are also compared to each
 * other, deeply, in one assertion — the shape a fourth failure code, an added
 * operand or a `message` passed through would break.
 */

/** Enough of a session to be the one the caller gets back. */
const SESSION = { access_token: 'token', user: { id: 'member' } } as unknown as Session;

const CREDENTIALS = { username: 'ivan.maric', password: 'local-fixture-password', slug: 'dvd-kastel-novi' };

/** An auth client that answers with whatever GoTrue would have answered. */
function answering(answer: { session: Session | null; error: AuthFailure | null }): PasswordAuth {
  return {
    signInWithPassword: () => Promise.resolve({ data: { session: answer.session }, error: answer.error }),
  };
}

/** An auth client whose call never completes — the offline case. */
function throwing(): PasswordAuth {
  return {
    signInWithPassword: () => Promise.reject(new TypeError('Failed to fetch')),
  };
}

/** What supabase-js reports for each upstream refusal, verbatim in shape. */
const WRONG_PASSWORD: AuthFailure = {
  name: 'AuthApiError',
  status: 400,
  code: 'invalid_credentials',
  message: 'Invalid login credentials',
};
const UNKNOWN_USERNAME: AuthFailure = {
  name: 'AuthApiError',
  status: 400,
  code: 'invalid_credentials',
  message: 'Invalid login credentials',
};
const DEACTIVATED_ACCOUNT: AuthFailure = {
  name: 'AuthApiError',
  status: 400,
  code: 'user_banned',
  message: 'User is banned',
};

describe('valid credentials establish a session', () => {
  it('returns the session GoTrue answered with', async () => {
    const outcome = await signIn(answering({ session: SESSION, error: null }), CREDENTIALS);

    expect(outcome).toEqual({ ok: true, session: SESSION });
  });

  it('sends AD-12 address and the typed password, and nothing else', async () => {
    // The username never reaches the wire as a username: what authenticates is
    // the synthesized address, and getting that wrong fails every correct
    // credential in the system at once.
    const sent: { email: string; password: string }[] = [];
    const auth: PasswordAuth = {
      signInWithPassword: (credentials) => {
        sent.push(credentials);

        return Promise.resolve({ data: { session: SESSION }, error: null });
      },
    };

    await signIn(auth, CREDENTIALS);

    expect(sent).toEqual([
      { email: 'ivan.maric@dvd-kastel-novi.shift.invalid', password: 'local-fixture-password' },
    ]);
  });
});

describe('three different refusals are one answer', () => {
  it.each([
    { row: 'a wrong password', error: WRONG_PASSWORD },
    { row: 'a username no member holds', error: UNKNOWN_USERNAME },
    { row: 'an account whose banned_until is in the future', error: DEACTIVATED_ACCOUNT },
  ])('maps $row to the single refusal code', async ({ error }) => {
    const outcome = await signIn(answering({ session: null, error }), CREDENTIALS);

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_REFUSED });
  });

  it('returns byte-identical outcomes for all three, which is the security claim', async () => {
    // THE assertion of this file. Each row above passing individually still
    // permits a fourth field — a passed-through `message`, an operand naming
    // the upstream code — that tells an anonymous caller which usernames exist
    // in this organization. Comparing the outcomes to EACH OTHER is what
    // refuses that, and it keeps refusing it for a field nobody has added yet.
    const [wrong, unknown, deactivated] = await Promise.all([
      signIn(answering({ session: null, error: WRONG_PASSWORD }), CREDENTIALS),
      signIn(answering({ session: null, error: UNKNOWN_USERNAME }), CREDENTIALS),
      signIn(answering({ session: null, error: DEACTIVATED_ACCOUNT }), CREDENTIALS),
    ]);

    expect(wrong).toEqual(unknown);
    expect(wrong).toEqual(deactivated);
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(deactivated));
  });

  it('discloses nothing about an unknown organization either', async () => {
    // A slug that names no organization reaches GoTrue as an address no account
    // has, so the answer is the ordinary refusal — the URL is not a probe for
    // which organizations exist.
    const outcome = await signIn(answering({ session: null, error: UNKNOWN_USERNAME }), {
      ...CREDENTIALS,
      slug: 'no-such-org',
    });

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_REFUSED });
  });

  it.each([
    ['a capitalized URL segment, which a phone or a shared link produces', 'DVD-Kastel-Novi'],
    ['a segment with stray whitespace', ' dvd-kastel-novi '],
  ])('normalizes %s instead of refusing it', async (_case, slug) => {
    // The defect this row exists for: `/prijava/DVD-Kastel-Novi` used to render
    // a working form that refused every correct credential forever, saying the
    // password was wrong. Format validity is not an existence question, so
    // normalizing discloses nothing — it happens before anything is asked.
    const sent: { email: string }[] = [];
    const auth: PasswordAuth = {
      signInWithPassword: (credentials) => {
        sent.push(credentials);

        return Promise.resolve({ data: { session: SESSION }, error: null });
      },
    };

    const outcome = await signIn(auth, { ...CREDENTIALS, slug });

    expect(outcome).toEqual({ ok: true, session: SESSION });
    expect(sent[0]?.email).toBe('ivan.maric@dvd-kastel-novi.shift.invalid');
  });

  it.each([
    ['a capital, which a phone keyboard adds unasked', 'Ivan.Maric'],
    ['surrounding whitespace from a paste', '  ivan.maric  '],
  ])('normalizes %s in the username half too', async (_case, username) => {
    // The half a PERSON types, and the half that was normalized nowhere. An
    // address no account holds returns the ordinary refusal, which is
    // indistinguishable from a wrong password — so the mistake is
    // unrecoverable by the person making it.
    const sent: { email: string }[] = [];
    const auth: PasswordAuth = {
      signInWithPassword: (credentials) => {
        sent.push(credentials);

        return Promise.resolve({ data: { session: SESSION }, error: null });
      },
    };

    await signIn(auth, { ...CREDENTIALS, username });

    expect(sent[0]?.email).toBe('ivan.maric@dvd-kastel-novi.shift.invalid');
  });

  it.each([
    ['a username that is only whitespace', { username: '   ' }],
    ['a username carrying an at sign', { username: 'ivan@example.com' }],
  ])('refuses %s locally, with the ordinary refusal', async (_case, overrides) => {
    let called = false;
    const auth: PasswordAuth = {
      signInWithPassword: () => {
        called = true;

        return Promise.resolve({ data: { session: null }, error: null });
      },
    };

    const outcome = await signIn(auth, { ...CREDENTIALS, ...overrides });

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_REFUSED });
    expect(called, 'an unbuildable username still reached the auth service').toBe(false);
  });

  it('refuses a slug the database could not hold without asking the service', async () => {
    // An unbuildable address is refused locally, and with the SAME code: a
    // distinct one would make a malformed URL segment distinguishable from a
    // well-formed unknown one.
    let called = false;
    const auth: PasswordAuth = {
      signInWithPassword: () => {
        called = true;

        return Promise.resolve({ data: { session: null }, error: null });
      },
    };

    const outcome = await signIn(auth, { ...CREDENTIALS, slug: 'Not A Slug' });

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_REFUSED });
    expect(called, 'a malformed slug still reached the auth service').toBe(false);
  });

  it('maps an answer carrying neither an error nor a session to a refusal', async () => {
    // Not a shape GoTrue produces; mapped rather than trusted, because `ok:
    // true` with nothing behind it lands on `/` and redirects straight back.
    const outcome = await signIn(answering({ session: null, error: null }), CREDENTIALS);

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_REFUSED });
  });
});

describe('a service failure is the one distinction worth drawing', () => {
  it.each([
    { row: 'a fetch that never completed', error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } },
    { row: 'an error carrying no status at all', error: { message: 'Failed to fetch' } },
    { row: 'a gateway failure', error: { name: 'AuthApiError', status: 503, message: 'Service Unavailable' } },
    { row: 'a rate limit, which says not now rather than not you', error: { name: 'AuthApiError', status: 429, message: 'Too many requests' } },
  ])('maps $row to the try-again code', async ({ error }) => {
    const outcome = await signIn(answering({ session: null, error }), CREDENTIALS);

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_UNAVAILABLE });
  });

  it('maps a rejected call to the try-again code rather than letting it escape', async () => {
    // The offline row of the matrix. An escaping rejection would leave the
    // screen with no message at all and both entered values discarded by the
    // unhandled error, which is the opposite of UX-DR34.
    const outcome = await signIn(throwing(), CREDENTIALS);

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_UNAVAILABLE });
  });

  it('keeps the two codes distinct, so the mapping is not a constant', async () => {
    // Vacuous-pass guard on the whole file: a `signIn` that always returned one
    // code would satisfy every collapse assertion above.
    const refused = await signIn(answering({ session: null, error: WRONG_PASSWORD }), CREDENTIALS);
    const unavailable = await signIn(throwing(), CREDENTIALS);

    expect(refused).not.toEqual(unavailable);
    expect(SIGN_IN_REFUSED).not.toBe(SIGN_IN_UNAVAILABLE);
  });

  it('does not read a 4xx refusal as a service failure', async () => {
    // The boundary from the other side. Widening `isServiceFailure` to every
    // error would tell a typing user to try again forever.
    const outcome = await signIn(
      answering({ session: null, error: { name: 'AuthApiError', status: 400, message: 'x' } }),
      CREDENTIALS,
    );

    expect(outcome).toEqual({ ok: false, code: SIGN_IN_REFUSED });
  });
});

describe('each failure names its own message, and the pairing is executed', () => {
  /**
   * The mapping used to be a ternary inside `prijava.tsx`, where AD-15 leaves
   * nothing to run it: swapping its two branches passed every source-level
   * assertion while a wrong password reported a service outage and a real
   * outage reported wrong credentials. Both are directly actionable, and both
   * would send somebody down the wrong path.
   */
  it.each<{ code: SignInFailure; key: string }>([
    { code: SIGN_IN_REFUSED, key: 'auth.error.credentials' },
    { code: SIGN_IN_UNAVAILABLE, key: 'auth.error.unavailable' },
  ])('renders $code as $key', ({ code, key }) => {
    expect(signInMessageKey(code)).toBe(key);
  });

  it('gives the two codes two different keys', () => {
    // Vacuous-pass guard: a mapping that returned one key for everything would
    // satisfy neither row above, but a mapping that returned its ARGUMENT
    // would satisfy both if the keys were ever renamed to match the codes.
    expect(signInMessageKey(SIGN_IN_REFUSED)).not.toBe(signInMessageKey(SIGN_IN_UNAVAILABLE));
  });

  it('keeps the three collapsed refusals collapsed at the message too', async () => {
    // The security claim, followed one layer further out than the outcome
    // comparison above: the same code in means the same KEY out, so the screen
    // cannot re-open the oracle by branching on something else.
    const outcomes = await Promise.all([
      signIn(answering({ session: null, error: WRONG_PASSWORD }), CREDENTIALS),
      signIn(answering({ session: null, error: UNKNOWN_USERNAME }), CREDENTIALS),
      signIn(answering({ session: null, error: DEACTIVATED_ACCOUNT }), CREDENTIALS),
    ]);
    const keys = outcomes.map((outcome) => (outcome.ok ? null : signInMessageKey(outcome.code)));

    expect(new Set(keys).size, 'the three refusals render more than one message').toBe(1);
    expect(keys[0]).toBe('auth.error.credentials');
  });
});
