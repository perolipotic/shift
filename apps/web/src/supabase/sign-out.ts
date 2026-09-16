/**
 * The exit: a session ended, or one stable code out (the navigation shell, part B).
 *
 * THE COUNTERPART TO `@/supabase/sign-in`, and deliberately its mirror image.
 * `routes/index.tsx` recorded the omission in prose — "no sign-out affordance,
 * `Odjava` stays reserved" — and prose is what an omission looks like right up
 * until somebody needs it: on a shared shift-work device the only way to end a
 * session was to close the browser, which ends nothing the next person cannot
 * reopen.
 *
 * THE AUTH CLIENT IS THE FIRST PARAMETER, exactly as `signIn(auth, …)` takes
 * it, and for exactly the reason recorded there: every row of the story's I/O
 * matrix is then executable from the node suite (AD-15) against a stub — no
 * browser, no stack, no environment. The interface is structural and narrow on
 * purpose: it names the ONE call this module makes and the one field the
 * mapping reads, so the real `supabase.auth` satisfies it and a stub does not
 * have to impersonate the rest of GoTrue.
 *
 * ONE FAILURE CODE, where `signIn` has two, and the asymmetry is a claim rather
 * than an economy. `signIn`'s two exist because a wrong password and an outage
 * are different things for the person to DO next — retype, or wait. Here there
 * is nothing to retype: whether GoTrue refused the revocation or the request
 * never arrived, the session is still live, the only action is to try again,
 * and the only thing that must not happen is for the interface to claim the
 * person is signed out when they are not. So the partition that would cost an
 * action elsewhere would buy none here.
 *
 * WHAT A FAILURE MEANS IS THAT THE SESSION SURVIVED. supabase-js clears its own
 * storage before the network call in some paths and after it in others, so
 * "refused" cannot be read as "nothing changed locally" — what the CALLER must
 * do is identical either way: say so, and leave the person where they are
 * rather than navigating them to a sign-in screen that a still-valid session
 * would bounce straight back off.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — `@/navigation/messages` is that edge, because the chrome
 * is the one surface that shows this and it shows exactly one message region.
 */

/** The revocation did not happen: refused, or never answered. The session lives. */
export const SIGN_OUT_FAILED = 'SIGN_OUT_FAILED';

export type SignOutFailure = typeof SIGN_OUT_FAILED;

export type SignOutOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SignOutFailure };

/** As much of an `AuthError` as this module reads — which is whether it is there. */
export interface SignOutFailureShape {
  // `| undefined` spelled out on every member, for the reason
  // `@/supabase/sign-in`'s `AuthFailure` records: `exactOptionalPropertyTypes`
  // is on and supabase-js declares these as present-and-possibly-undefined
  // rather than optional, so `message?: string` would NOT be a supertype of it
  // and the real client would not satisfy this interface at all.
  readonly name?: string | undefined;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface SessionAuth {
  signOut(): Promise<{ error: SignOutFailureShape | null }>;
}

/**
 * Ends the session, or answers with the one code.
 *
 * A REJECTED PROMISE IS A FAILURE AND NOT A SUCCESS, which is the whole of the
 * `catch`. The transport can fail outside supabase-js's own error mapping — a
 * blocked request, an aborted navigation, a DNS failure — and an escaping
 * rejection would leave the chrome's handler in its `catch` with no outcome to
 * read, which is the shape that navigates somebody to a sign-in screen their
 * still-live session bounces them off. Folded into `{ ok: false }` instead, so
 * the caller has exactly two branches and both are written.
 */
export async function signOut(auth: SessionAuth): Promise<SignOutOutcome> {
  let answered;

  try {
    answered = await auth.signOut();
  } catch (cause) {
    // LOGGED HERE, and it has to be here rather than left to the caller. The
    // chrome wraps its own call in a `try`/`catch` that logs — but this function
    // does not rethrow, so that catch never sees a transport failure at all and
    // a sign-out that never left the device was recorded nowhere. One code out,
    // one cause in the console, and the caller's catch keeps the two failures it
    // can actually see: a client that threw before this was reached, and a
    // navigation that rejected after it succeeded.
    console.error(SIGN_OUT_FAILED, cause);

    return { ok: false, code: SIGN_OUT_FAILED };
  }

  // `error` DECIDES, and there is nothing else to read: GoTrue answers a
  // successful revocation with `{ error: null }` and carries no payload. A
  // truthiness check would be the same claim written less precisely, and `null`
  // is what supabase-js actually returns.
  //
  // The error OBJECT goes to the console for the reason the throw above does.
  // One message reaches the person — there is one thing to do — but "GoTrue
  // refused the token" and "the gateway returned 502" are different things to
  // fix, and the code alone cannot tell them apart.
  if (answered.error !== null) {
    console.error(SIGN_OUT_FAILED, answered.error);

    return { ok: false, code: SIGN_OUT_FAILED };
  }

  return { ok: true };
}
