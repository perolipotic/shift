import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { knownPathOf, returnTargetOf } from '@/features/auth/services/return-target';
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
 * THE RETURN TARGET COMES IN ON THE URL. The signed-out redirect put the
 * location the visitor asked for into `povratak`, and the organization prompt
 * handed it on; a successful sign-in navigates there through
 * `returnTargetOf`, which refuses anything that is not a same-app path this
 * tree knows and falls back to `/`. The route tree is asked through the router
 * this hook already runs under, so nothing here imports it.
 *
 * FOCUS NEVER DROPS TO `<body>`. The button used to carry `disabled={pending}`,
 * and disabling the element that has just been activated takes it out of the
 * tab order mid-flow. The form marks it `aria-disabled` instead, and the
 * in-flight ref below is what actually refuses a second submit. On a refusal
 * focus moves to the password field, which the refusal describes and which is
 * what a person corrects next — in this handler, not an effect, and only after
 * `flushSync` has committed the refusal, so the field is announced with it.
 *
 * Every rule is in `@/features/auth/services/sign-in`, which the node suite
 * executes; this hook holds state and wiring only.
 */
export function useSignIn(slug: string) {
  const navigate = useNavigate();
  const router = useRouter();
  // NOT STRICT, so no route id is spelt here (`prijava.test.ts` refuses the
  // literal): this hook runs only on `/prijava/$slug`, whose `validateSearch`
  // is what shapes `povratak`.
  const { povratak } = useSearch({ strict: false });
  const usernameField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  // The in-flight flag is a REF as well as state, and the two are not
  // redundant. State drives the button's `aria-disabled`, and state is stale
  // inside a handler that has already been called once this tick — a second
  // submit (double click, Enter while the click lands) reads `false` and fires
  // a second concurrent exchange. The ref is written synchronously, so it is what
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
        // COMMITTED FIRST, then focused: `flushSync` renders the refusal and
        // the field's `aria-describedby` pointing at it before focus lands, so
        // the field is announced WITH its error rather than without it.
        flushSync(() => {
          setFailure(outcome.code);
        });
        password.focus();

        return;
      }

      // The return target, or `/` when there is none that is safe. Neither is
      // handed the session: it is established inside the client by the time
      // the call above resolves, and `@/lib/supabase/session-cache` leaves the
      // router alone on a sign-in so this navigation is the only one.
      //
      // REPLACING, so Back from the returned destination does not land on the
      // credential form, whose guard would only forward a signed-in visitor to
      // `/` and on to the first destination.
      await navigate({ href: returnTargetOf(povratak, knownPathOf(router)), replace: true });
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
      flushSync(() => {
        setFailure(SIGN_IN_UNAVAILABLE);
      });
      password.focus();
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
