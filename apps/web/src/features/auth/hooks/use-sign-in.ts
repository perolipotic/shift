import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import {
  SIGN_IN_UNAVAILABLE,
  signIn,
  type SignInFailure,
} from '@/features/auth/services/sign-in';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The sign-in screen's state and its one exchange (story 1.1d, wired by 1.3b):
 * the two uncontrolled fields' refs, the in-flight ref, the refusal and the
 * pending flag, and `submit`.
 *
 * THE SLUG COMES IN FROM THE PAGE, which reads it off the route: AD-12
 * authenticates against an address namespaced by it, and at the moment of
 * sign-in there is no session to read it from (see `pages/prijava.tsx`).
 *
 * Values are read from the fields through refs rather than held in state, and
 * that is the shape UX-DR34's "a refused save keeps every entered value" asks
 * for: uncontrolled inputs keep what was typed because nothing re-renders them
 * away. It also keeps every string in the screen's parts a `t()` key —
 * `prijava.test.ts` makes any other literal an offence, and reading the form's
 * `elements.namedItem('username')` would be one.
 *
 * Every rule is in `@/features/auth/services/sign-in`, which the node suite
 * executes; this hook holds state and wiring only.
 */
export function useSignIn(slug: string) {
  const navigate = useNavigate();
  const usernameField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  // The in-flight flag is a REF as well as state, and the two are not
  // redundant. State drives the disabled button, and state is stale inside a
  // handler that has already been called once this tick — a second submit
  // (double click, Enter while the click lands) reads `false` and fires a
  // second concurrent exchange. The ref is written synchronously, so it is what
  // the guard reads; the state exists only to re-render.
  const exchanging = useRef(false);
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const username = usernameField.current;
    const password = passwordField.current;

    if (username === null || password === null || exchanging.current) return;

    exchanging.current = true;
    setFailure(null);
    setPending(true);

    try {
      const outcome = await signIn(supabaseClient().auth, {
        username: username.value,
        password: password.value,
        slug,
      });

      if (!outcome.ok) {
        setFailure(outcome.code);

        return;
      }

      // `/` reads the session itself, so nothing is handed to it: the session
      // is established inside the client by the time the call above resolves.
      await navigate({ to: '/' });
    } catch (cause) {
      // Everything `signIn` does not already map: the client throwing its
      // stable code on a build with no environment, and a navigation that
      // rejects. Both used to escape as an unhandled rejection, leaving a
      // screen with no message and — before the `finally` below — a button
      // disabled forever.
      //
      // A misconfiguration reading as an outage is a real cost, and it is the
      // smaller one ONLY because the cause is logged: the stable code and the
      // cause always reach the console, so a deployment with no environment
      // never shows "try again" with an empty console — the failure
      // `client.ts` was written to prevent. `lib/i18n/boot.ts` sets the shape.
      console.error(SIGN_IN_UNAVAILABLE, cause);
      setFailure(SIGN_IN_UNAVAILABLE);
    } finally {
      // On EVERY path, including the successful one. Clearing it only on
      // failure left the button permanently disabled the moment `navigate`
      // stopped resolving, with nothing on screen to say why.
      exchanging.current = false;
      setPending(false);
    }
  }

  return { usernameField, passwordField, failure, pending, submit };
}

/** What the sign-in form is drawn from. */
export type SignInScreenState = ReturnType<typeof useSignIn>;
