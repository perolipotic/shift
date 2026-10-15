/**
 * The exit: a session ended, or one stable code out (the navigation shell, part B).
 *
 * THE COUNTERPART TO `@/features/auth/services/sign-in`, and deliberately its mirror image.
 * The application shipped with no sign-out affordance at all, recorded in prose
 * as a deliberate omission and nowhere else — and prose is what an omission
 * looks like right up until somebody needs it: on a shared shift-work device the
 * only way to end a session was to close the browser, which ends nothing the
 * next person cannot reopen.
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
 * is nothing to retype: when the code is returned the session is still on this
 * device, the only action is to try again, and the only thing that must not
 * happen is for the interface to claim the person is signed out when they are
 * not. So the partition that would cost an action elsewhere would buy none
 * here.
 *
 * THE DEVICE DECIDES, NOT THE SERVER'S ANSWER (E786). supabase-js removes the
 * session from this device even when GoTrue REFUSES the global revocation (any
 * refusal but 401/403/404, which it already counts as signed out), and answers
 * with the refusal anyway. Reading that answer alone said "Odjava trenutačno
 * nije moguća" to a person this device had in fact signed out, and kept them on
 * a chrome whose next navigation bounced them to the sign-in form. So after a
 * refusal or a rejection the device is asked whether it still holds a session:
 *
 *   - it does not (and says so without an error): the device is signed out,
 *     and that is the success. It is a DEVICE-ONLY sign-out — the server may
 *     still hold the refresh token until it expires — which is accepted on
 *     purpose: the device is what a shared-device sign-out has to clear, the
 *     token left behind lives nowhere on this device, and forcing a server
 *     revocation first would take a workaround inside the auth client. It is
 *     logged as {@link SIGN_OUT_DEVICE_ONLY}, a warning rather than an error.
 *   - it does, or the question cannot be answered: {@link SIGN_OUT_FAILED}, and
 *     the session is genuinely live. That is the path where supabase-js could
 *     not read the session to begin with (a refresh that failed offline, a
 *     storage lock that timed out), and the caller says so and leaves the
 *     person where they are, rather than navigating them to a sign-in screen a
 *     still-valid session would bounce straight back off.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — `@/features/navigation/utils/messages` is that edge, because the chrome
 * is the one surface that shows this and it shows exactly one message region.
 */

/** The sign-out did not happen: the session is still on this device. */
export const SIGN_OUT_FAILED = 'SIGN_OUT_FAILED';

/**
 * Logged, never returned: the device is signed out but the server refused (or
 * never heard) the revocation. The caller sees an ordinary success.
 */
export const SIGN_OUT_DEVICE_ONLY = 'SIGN_OUT_DEVICE_ONLY';

export type SignOutFailure = typeof SIGN_OUT_FAILED;

export type SignOutOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SignOutFailure };

/** As much of an `AuthError` as this module reads — which is whether it is there. */
export interface SignOutFailureShape {
  // `| undefined` spelled out on every member, for the reason
  // `@/features/auth/services/sign-in`'s `AuthFailure` records: `exactOptionalPropertyTypes`
  // is on and supabase-js declares these as present-and-possibly-undefined
  // rather than optional, so `message?: string` would NOT be a supertype of it
  // and the real client would not satisfy this interface at all.
  readonly name?: string | undefined;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The two calls this module makes, named structurally so they can be stubbed. */
export interface SessionAuth {
  signOut(): Promise<{ error: SignOutFailureShape | null }>;
  /** Asked only after a failure: whether this device still holds a session. */
  getSession(): Promise<{
    data: { session: unknown };
    error: SignOutFailureShape | null;
  }>;
}

/**
 * Whether the device is signed out after a failed sign-out: no session AND no
 * error. An error, a session, or a read that rejects all count as still held,
 * because a session this module cannot see is not one it may call ended.
 */
async function signedOutHere(auth: SessionAuth): Promise<boolean> {
  try {
    const { data, error } = await auth.getSession();

    return error === null && data.session === null;
  } catch {
    return false;
  }
}

/** A failure, or the device-only success when this device no longer holds the session. */
async function settledFailure(auth: SessionAuth, cause: unknown): Promise<SignOutOutcome> {
  if (await signedOutHere(auth)) {
    console.warn(SIGN_OUT_DEVICE_ONLY, cause);

    return { ok: true };
  }

  console.error(SIGN_OUT_FAILED, cause);

  return { ok: false, code: SIGN_OUT_FAILED };
}

/**
 * Ends the session on this device, or answers with the one code.
 *
 * A REJECTED PROMISE IS NOT A SUCCESS BY ITSELF, which is the whole of the
 * `catch`. The transport can fail outside supabase-js's own error mapping — a
 * blocked request, an aborted navigation, a DNS failure — and an escaping
 * rejection would leave the chrome's handler in its `catch` with no outcome to
 * read, which is the shape that navigates somebody to a sign-in screen their
 * still-live session bounces them off. Settled exactly as a refusal is — the
 * device is asked whether it still holds a session — so the caller has exactly
 * two branches and both are written.
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
    return settledFailure(auth, cause);
  }

  // `error: null` IS THE SUCCESS, and there is nothing else to read: GoTrue
  // answers a successful revocation with no payload. A truthiness check would be
  // the same claim written less precisely, and `null` is what supabase-js
  // actually returns. Any error is settled against the device (see the module
  // comment), because supabase-js may already have removed the session here.
  //
  // The error OBJECT goes to the console for the reason the throw above does.
  // One message reaches the person — there is one thing to do — but "GoTrue
  // refused the token" and "the gateway returned 502" are different things to
  // fix, and the code alone cannot tell them apart.
  if (answered.error !== null) return settledFailure(auth, answered.error);

  return { ok: true };
}
