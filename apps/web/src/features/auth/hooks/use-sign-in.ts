import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { organizationDestination } from '@/features/auth/services/address';
import * as lastOrganization from '@/features/auth/services/last-organization';
import { knownPathOf, returnTargetOf } from '@/features/auth/services/return-target';
import {
  SIGN_IN_UNAVAILABLE,
  signIn,
  type SignInFailure,
} from '@/features/auth/services/sign-in';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The sign-in screen's state and its one exchange (story 1.1d, wired by 1.3b,
 * made one form by 7.7): the three uncontrolled fields' refs, the in-flight
 * ref, the refusal, the pending flag, whether the organization is being edited
 * and whether the password is shown, and `submit`.
 *
 * THE ORGANIZATION COMES FROM ONE OF TWO PLACES. AD-12 authenticates against an
 * address namespaced by the slug, and at the moment of sign-in there is no
 * session to read it from (see `pages/prijava.tsx`). With `/prijava/$slug` the
 * page hands the URL slug in, and the form shows it as a row until `Promijeni`
 * swaps in the field. With bare `/prijava` there is no slug, and the field is
 * prefilled from the last organization signed into on this device
 * (`@/features/auth/services/last-organization`), or empty. Either way the
 * value goes to the one unchanged `signIn()`, which refuses a malformed slug
 * locally with the ordinary refusal, so a wrong organization reads exactly like
 * a wrong password.
 *
 * Values are read from the fields through refs rather than held in state, and
 * that is the shape UX-DR34's "a refused save keeps every entered value" asks
 * for: uncontrolled inputs keep what was typed because nothing re-renders them
 * away. It also keeps every string in the screen's parts a `t()` key —
 * `prijava.test.ts` makes any other literal an offence, and reading the form's
 * `elements.namedItem('username')` would be one.
 *
 * THE RETURN TARGET COMES IN ON THE URL. The signed-out redirect put the
 * location the visitor asked for into `povratak`, on either sign-in route; a successful sign-in navigates there through
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
export function useSignIn(slug: string | undefined) {
  const navigate = useNavigate();
  const router = useRouter();
  // NOT STRICT, so no route id is spelt here (`prijava.test.ts` refuses the
  // literal): this hook runs on both `/prijava` and `/prijava/$slug`, and both
  // shape `povratak` through the same `validateSearch`.
  const { povratak } = useSearch({ strict: false });
  const organizationField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  // Read ONCE, at mount: the prefill is a default value for an uncontrolled
  // field, and with a URL slug there is nothing to prefill.
  const [remembered] = useState(() =>
    slug === undefined
      ? lastOrganization.read(lastOrganization.deviceStorage())
      : lastOrganization.NOTHING_REMEMBERED,
  );
  // THE URL SLUG AS IT WILL BE SENT. The route's guard lets a capitalized or
  // padded segment through (`/prijava/DVD-Demo`), and `signIn` and the memory
  // both normalize it, so the row and the `Promijeni` prefill show the
  // normalized slug too: what is shown is what is sent and remembered.
  const shownSlug = slug === undefined ? undefined : (organizationDestination(slug) ?? slug);
  // `Promijeni` swaps the URL slug's row for the field. The URL does not change.
  const [editing, setEditing] = useState(false);
  // Whether the field still holds what this device remembered. Once the
  // person edits it, `Zapamćeno na ovom uređaju.` would no longer be true, so
  // only the how-to hint stays. Tracked from the field's own input event, not
  // an effect.
  const [stillRemembered, setStillRemembered] = useState(true);
  const [passwordShown, setPasswordShown] = useState(false);
  // `Zaboravljena lozinka?` opens its panel in place.
  const [forgotOpen, setForgotOpen] = useState(false);
  // The in-flight flag is a REF as well as state, and the two are not
  // redundant. State drives the button's `aria-disabled`, and state is stale
  // inside a handler that has already been called once this tick — a second
  // submit (double click, Enter while the click lands) reads `false` and fires
  // a second concurrent exchange. The ref is written synchronously, so it is what
  // the guard reads; the state exists only to re-render.
  const exchanging = useRef(false);
  const [failure, setFailure] = useState<SignInFailure | null>(null);
  const [pending, setPending] = useState(false);
  // The field is on screen unless the URL slug's row stands in for it.
  const organizationEditable = slug === undefined || editing;

  function changeOrganization(): void {
    // Committed first, so the field exists to be focused.
    flushSync(() => {
      setEditing(true);
    });
    organizationField.current?.focus();
  }

  function organizationInput(event: FormEvent<HTMLInputElement>): void {
    setStillRemembered(event.currentTarget.value === remembered);
  }

  function togglePassword(): void {
    setPasswordShown((shown) => !shown);
  }

  function toggleForgot(): void {
    setForgotOpen((open) => !open);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const username = usernameField.current;
    const password = passwordField.current;
    // The row's slug, or what the field holds. `signIn` normalizes and judges
    // it, exactly as it judges the other two values.
    const organization = organizationEditable ? organizationField.current?.value : shownSlug;

    if (username === null || password === null || organization === undefined || exchanging.current) {
      return;
    }

    // RE-MASKED FIRST, committed before anything else: a refusal then never
    // focuses a password shown as plain text, and a credential manager sees a
    // `type="password"` field on the submit it offers to save.
    flushSync(() => {
      setPasswordShown(false);
    });

    exchanging.current = true;
    setFailure(null);
    setPending(true);

    try {
      const outcome = await signIn(supabaseClient().auth, {
        username: username.value,
        password: password.value,
        slug: organization,
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

      // REMEMBERED ONLY NOW, after the service accepted it, so a typo is never
      // stored. Only the normalized slug: nothing about the person.
      lastOrganization.remember(lastOrganization.deviceStorage(), organization);

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

  return {
    shownSlug,
    organizationField,
    usernameField,
    passwordField,
    // What the field opens with: the URL slug after `Promijeni`, otherwise
    // what this device remembered, otherwise nothing.
    organizationDefault: shownSlug ?? remembered,
    // Whether the field holds what this device remembered, which the hint says.
    rememberedHere:
      slug === undefined && remembered !== lastOrganization.NOTHING_REMEMBERED && stillRemembered,
    // FOCUS OPENS WHERE THE FIRST EMPTY VALUE IS: the organization field when
    // nothing fills it, otherwise the username. `autoFocus` rather than an
    // effect, so it happens once, as the field mounts — and `prijavaRoute`'s
    // `remountDeps` remounts the screen when the slug changes, which a
    // params-only navigation would not do on its own.
    organizationFirst: slug === undefined && remembered === lastOrganization.NOTHING_REMEMBERED,
    organizationEditable,
    passwordShown,
    forgotOpen,
    failure,
    pending,
    changeOrganization,
    organizationInput,
    togglePassword,
    toggleForgot,
    submit,
  };
}

/** What the sign-in form is drawn from. */
export type SignInScreenState = ReturnType<typeof useSignIn>;
