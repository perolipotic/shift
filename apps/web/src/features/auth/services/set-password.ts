/**
 * A member's first sign-in (story 7.8): the rule that holds a session at
 * `/postavi-lozinku`, the local checks on the two fields, and the three-step
 * save that lets the member go.
 *
 * THE FLAG LIVES IN `app_metadata.must_set_password`. admin-auth sets it on
 * every account it issues or resets, and only admin-auth can clear it — a
 * member's own `updateUser` cannot write `app_metadata` (AD-16). So the save is
 * three calls in a fixed order:
 *
 *   1. `auth.updateUser({ password })` — the member's own password, as the
 *      member, through GoTrue;
 *   2. admin-auth's `clearMustSetPassword` — the flag, for the caller only;
 *   3. `auth.refreshSession()` — a session whose user no longer carries the
 *      flag, so the route guard lets it through.
 *
 * IF STEP 2 FAILS AFTER STEP 1 LANDED, the password IS saved. A retry that
 * repeated step 1 would set the same password again — GoTrue refuses that as
 * `same_password`, which would read as "choose a different password" to
 * somebody who did nothing wrong. So the outcome carries `passwordSaved`, the
 * hook keeps it, and the next save starts at step 2.
 *
 * Every client is a PARAMETER, the shape `signIn(auth, …)` set: each row of the
 * story's matrix runs in the node suite against a stub (AD-15). Nothing here
 * logs a password.
 */

/**
 * THE WIRE, the auth feature's own copy. This module is a LEAF — it imports
 * nothing — so `test/admin-auth-boundary.test.ts` can import it beside the
 * function's tree and bind each value to the function's own, the way it binds
 * `@/features/members/services/wire`. Misspelt here and nowhere else, the
 * clear would arrive as an unknown operation and the member would retry for
 * ever.
 */
/** The Edge Function, by the name it is deployed under. */
export const SET_PASSWORD_FUNCTION = 'admin-auth';
/** The operation, by the name the function dispatches on. Sent with nothing
 *  but itself: the function names its target by the caller's token. */
export const CLEAR_MUST_SET_PASSWORD_OPERATION = 'clearMustSetPassword';
/** The success gate: only this value lets the member leave the step. */
export const PASSWORD_FLAG_CLEARED = 'PASSWORD_FLAG_CLEARED';

/** The flag's key in `app_metadata`. admin-auth's `MUST_SET_PASSWORD`, bound
 *  by `set-password.test.ts` reading the function's source. */
export const MUST_SET_PASSWORD = 'must_set_password';

/** GoTrue's own floor (`supabase/config.toml` `minimum_password_length`), and
 *  the local check's. Refused here first, so the short case costs no request. */
export const PASSWORD_MIN_LENGTH = 10;

/** As much of a session as the guard reads. */
export interface FlaggedSession {
  readonly user: { readonly app_metadata?: Readonly<Record<string, unknown>> | undefined };
}

/**
 * Whether a session is held at the set-password step.
 *
 * `=== true` AND NOTHING LOOSER. An account issued before story 7.8 carries no
 * flag at all, and a fixture or seed inserts `auth.users` directly with none:
 * both are ordinary sessions, never held.
 */
export function mustSetPassword(session: FlaggedSession | null): boolean {
  return session?.user.app_metadata?.[MUST_SET_PASSWORD] === true;
}

// ------------------------------------------------------------------ the codes

/** Fewer than {@link PASSWORD_MIN_LENGTH} characters. Refused locally. */
export const SET_PASSWORD_TOO_SHORT = 'SET_PASSWORD_TOO_SHORT';
/** The repeat differs from the new password. Refused locally. */
export const SET_PASSWORD_MISMATCH = 'SET_PASSWORD_MISMATCH';
/** GoTrue's `same_password`: the new one is the one the admin issued. */
export const SET_PASSWORD_SAME = 'SET_PASSWORD_SAME';
/** The password was not saved: GoTrue refused for another reason, or never
 *  answered. Nothing changed. */
export const SET_PASSWORD_UNAVAILABLE = 'SET_PASSWORD_UNAVAILABLE';
/** The password IS saved and the step could not be left: the clear or the
 *  refresh failed. A retry repeats only those. */
export const SET_PASSWORD_NOT_CONTINUED = 'SET_PASSWORD_NOT_CONTINUED';
/** The password IS saved and the function refused the token: the session went
 *  away under the step. The way on is signing in with the new password. */
export const SET_PASSWORD_SIGN_IN_AGAIN = 'SET_PASSWORD_SIGN_IN_AGAIN';

export type SetPasswordFailure =
  | typeof SET_PASSWORD_TOO_SHORT
  | typeof SET_PASSWORD_MISMATCH
  | typeof SET_PASSWORD_SAME
  | typeof SET_PASSWORD_UNAVAILABLE
  | typeof SET_PASSWORD_NOT_CONTINUED
  | typeof SET_PASSWORD_SIGN_IN_AGAIN;

/**
 * What the two fields refuse before any request, or `null`.
 *
 * LENGTH FIRST: a short password that also differs from its repeat is short,
 * and correcting it changes the repeat anyway.
 */
export function setPasswordRefusalOf(password: string, repeat: string): SetPasswordFailure | null {
  if (password.length < PASSWORD_MIN_LENGTH) return SET_PASSWORD_TOO_SHORT;
  if (password !== repeat) return SET_PASSWORD_MISMATCH;

  return null;
}

/** Which field a refusal is about, so it is bound to that field. `both` for
 *  the ones about neither field in particular. */
export function setPasswordFailureField(failure: SetPasswordFailure): 'new' | 'repeat' | 'both' {
  if (failure === SET_PASSWORD_TOO_SHORT || failure === SET_PASSWORD_SAME) return 'new';
  if (failure === SET_PASSWORD_MISMATCH) return 'repeat';

  return 'both';
}

/** Which of the two fields a refusal (or none) describes, for each field's
 *  `aria-describedby`. */
export function failureDescribes(failure: SetPasswordFailure | null): {
  readonly password: boolean;
  readonly repeat: boolean;
} {
  if (failure === null) return { password: false, repeat: false };

  const field = setPasswordFailureField(failure);

  return { password: field !== 'repeat', repeat: field !== 'new' };
}

/** What the live checks show: how much is typed, and whether each rule holds. */
export interface TypedState {
  readonly typed: number;
  readonly longEnough: boolean;
  readonly matches: boolean;
}

/** The live checks' state for the two fields' current values. An empty repeat
 *  never "matches" an empty password: nothing typed is not agreement. */
export function typedStateOf(password: string, repeat: string): TypedState {
  return {
    typed: password.length,
    longEnough: password.length >= PASSWORD_MIN_LENGTH,
    matches: password !== '' && password === repeat,
  };
}

/** Before anything is typed. */
export const NOTHING_TYPED: TypedState = typedStateOf('', '');

/** The message key each failure renders as. Exhaustive, `never` at the end. */
export function setPasswordMessageKey(
  failure: SetPasswordFailure,
):
  | 'auth.setPassword.error.tooShort'
  | 'auth.setPassword.error.mismatch'
  | 'auth.setPassword.error.same'
  | 'auth.setPassword.error.unavailable'
  | 'auth.setPassword.error.notContinued'
  | 'auth.setPassword.error.signInAgain' {
  if (failure === SET_PASSWORD_TOO_SHORT) return 'auth.setPassword.error.tooShort';
  if (failure === SET_PASSWORD_MISMATCH) return 'auth.setPassword.error.mismatch';
  if (failure === SET_PASSWORD_SAME) return 'auth.setPassword.error.same';
  if (failure === SET_PASSWORD_UNAVAILABLE) return 'auth.setPassword.error.unavailable';
  if (failure === SET_PASSWORD_NOT_CONTINUED) return 'auth.setPassword.error.notContinued';
  if (failure === SET_PASSWORD_SIGN_IN_AGAIN) return 'auth.setPassword.error.signInAgain';

  const unhandled: never = failure;

  return unhandled;
}

/** The live checks' state: met, or not yet. Two keys, so the state is said in
 *  words beside the icon and never by its colour alone. */
export function ruleStateMessageKey(
  met: boolean,
): 'auth.setPassword.ruleMet' | 'auth.setPassword.ruleUnmet' {
  return met ? 'auth.setPassword.ruleMet' : 'auth.setPassword.ruleUnmet';
}

// ------------------------------------------------------------------ the seams

/** As much of an `AuthError` as the mapping reads. `| undefined` spelled out,
 *  for the reason `sign-in.ts`'s `AuthFailure` records. */
export interface SetPasswordAuthFailure {
  readonly name?: string | undefined;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** The two `supabase.auth` calls the save makes. */
export interface SetPasswordAuth {
  updateUser(attributes: { password: string }): Promise<{ error: SetPasswordAuthFailure | null }>;
  refreshSession(): Promise<{
    data: { session: FlaggedSession | null };
    error: SetPasswordAuthFailure | null;
  }>;
}

/** As much of a `FunctionsError` as the reply reader reads: the raw `Response`
 *  supabase-js hides on `context` for a non-2xx. */
export interface SetPasswordFunctionsError {
  readonly context?: { json?: () => PromiseLike<unknown> } | undefined;
}

/** The injected `functions.invoke`. */
export interface SetPasswordFunctions {
  invoke(
    name: string,
    options: { readonly body: Readonly<Record<string, unknown>> },
  ): PromiseLike<{ readonly data: unknown; readonly error: SetPasswordFunctionsError | null }>;
}

export interface SetPasswordClient {
  readonly auth: SetPasswordAuth;
  readonly functions: SetPasswordFunctions;
}

/** The transport's refusal of a token: the session is gone. */
const AUTHORIZATION_MISSING = 'AUTHORIZATION_MISSING';

/** GoTrue's codes for a password it will not take. */
const SAME_PASSWORD = 'same_password';
const WEAK_PASSWORD = 'weak_password';

export type SetPasswordOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: SetPasswordFailure;
      /** Whether step 1 has landed, so the next save starts at step 2. */
      readonly passwordSaved: boolean;
    };

/** The `code` a function reply carries, whichever half of the answer holds it,
 *  or `null`. The body is read ONCE, on its receiver — see
 *  `@/features/members/services/write`'s `replyBodyOf` for why both matter. */
async function replyCodeOf(answer: {
  readonly data: unknown;
  readonly error: SetPasswordFunctionsError | null;
}): Promise<string | null> {
  let body: unknown = answer.data;

  if (body === null || body === undefined) {
    const context = answer.error?.context;

    if (context === undefined || context === null || typeof context.json !== 'function') return null;

    try {
      body = await context.json();
    } catch {
      return null;
    }
  }

  if (typeof body !== 'object' || body === null) return null;

  const code = (body as Record<string, unknown>)['code'];

  return typeof code === 'string' && code !== '' ? code : null;
}

const NOT_CONTINUED: SetPasswordOutcome = {
  ok: false,
  code: SET_PASSWORD_NOT_CONTINUED,
  passwordSaved: true,
};

/**
 * Steps 2 and 3: clear the caller's flag, then refresh the session. Both are
 * safe to repeat — the clear writes `false` over `false` — which is what makes
 * them the retry.
 */
async function continueAfterSave(client: SetPasswordClient): Promise<SetPasswordOutcome> {
  let code: string | null;

  try {
    code = await replyCodeOf(
      await client.functions.invoke(SET_PASSWORD_FUNCTION, {
        body: { operation: CLEAR_MUST_SET_PASSWORD_OPERATION },
      }),
    );
  } catch (cause) {
    console.error(SET_PASSWORD_NOT_CONTINUED, cause);

    return NOT_CONTINUED;
  }

  // THE TOKEN WAS REFUSED: retrying sends the same token. The password is
  // saved, so the member signs in again with it — and the flag still holds
  // them at this step, where the retry then clears it.
  if (code === AUTHORIZATION_MISSING) {
    console.error(SET_PASSWORD_SIGN_IN_AGAIN, code);

    return { ok: false, code: SET_PASSWORD_SIGN_IN_AGAIN, passwordSaved: true };
  }

  // THE SUCCESS GATE IS THE VALUE, never the status: anything but
  // `PASSWORD_FLAG_CLEARED` leaves the flag where it was.
  if (code !== PASSWORD_FLAG_CLEARED) {
    console.error(SET_PASSWORD_NOT_CONTINUED, code);

    return NOT_CONTINUED;
  }

  try {
    const refreshed = await client.auth.refreshSession();

    if (refreshed.error !== null) {
      console.error(SET_PASSWORD_NOT_CONTINUED, refreshed.error.code, refreshed.error.status);

      return NOT_CONTINUED;
    }

    // THE REFRESHED SESSION IS WHAT THE GUARD READS. Still flagged, leaving
    // here would bounce straight back to the step, so it is not a success.
    if (mustSetPassword(refreshed.data.session)) {
      console.error(SET_PASSWORD_NOT_CONTINUED, MUST_SET_PASSWORD);

      return NOT_CONTINUED;
    }
  } catch (cause) {
    console.error(SET_PASSWORD_NOT_CONTINUED, cause);

    return NOT_CONTINUED;
  }

  return { ok: true };
}

/**
 * Save the member's own password and leave the step, or say which step failed.
 *
 * `passwordSaved` is what an earlier attempt answered: `true` skips step 1.
 * The local checks are the HOOK's, run before this on a first attempt only —
 * a retry after the password landed has nothing left to check.
 */
export async function savePassword(
  client: SetPasswordClient,
  password: string,
  passwordSaved: boolean,
): Promise<SetPasswordOutcome> {
  if (passwordSaved) return continueAfterSave(client);

  let answered;

  try {
    answered = await client.auth.updateUser({ password });
  } catch (cause) {
    console.error(SET_PASSWORD_UNAVAILABLE, cause);

    return { ok: false, code: SET_PASSWORD_UNAVAILABLE, passwordSaved: false };
  }

  if (answered.error !== null) {
    if (answered.error.code === SAME_PASSWORD) {
      return { ok: false, code: SET_PASSWORD_SAME, passwordSaved: false };
    }
    // The server's floor, met only if the local one drifted below it.
    if (answered.error.code === WEAK_PASSWORD) {
      return { ok: false, code: SET_PASSWORD_TOO_SHORT, passwordSaved: false };
    }

    // THE CODE AND THE STATUS, never the error object: its message can echo
    // what was sent.
    console.error(SET_PASSWORD_UNAVAILABLE, answered.error.code, answered.error.status);

    return { ok: false, code: SET_PASSWORD_UNAVAILABLE, passwordSaved: false };
  }

  return continueAfterSave(client);
}
