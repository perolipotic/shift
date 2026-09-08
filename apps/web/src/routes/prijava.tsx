import { createRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { rootRoute } from '@/routes/__root';
import { supabaseClient } from '@/supabase/client';
import {
  SIGN_IN_UNAVAILABLE,
  signIn,
  signInMessageKey,
  type SignInFailure,
} from '@/supabase/sign-in';

/**
 * The sign-in screen (story 1.1d, wired by 1.3b).
 *
 * PER TENANT, at `/prijava/$slug`. AD-12 authenticates against a synthesized
 * address namespaced by the organization's slug, so the slug has to be in scope
 * at the moment of sign-in — and at that moment there is no session to read it
 * from. Three ways out were weighed on 2026-09-07: globally-unique usernames
 * (loses per-tenant namespacing and rewrites every issued address), a third form
 * field (changes 1.1d's frozen two-field form), and an anonymous
 * username-resolution RPC (an enumeration oracle exposed to `anon`). The URL was
 * chosen because it changes neither the form nor the security surface, which is
 * why the form below still has exactly two fields and why the slug arrives as a
 * route param rather than as an input.
 *
 * The `<form>` element is what makes the browser's own credential manager fill
 * and offer to save this pair — `autoComplete` on a field outside a form is
 * ignored. `method="post"` stays even though the handler now runs: if the
 * handler ever does NOT run — a bundle that failed to load, a script error — the
 * browser submits the form itself, and the default method is GET, which would
 * put whatever was typed into the password field into the URL, the browser
 * history and the CDN's request log.
 *
 * Values are read from the fields through refs rather than held in state, and
 * that is the shape UX-DR34's "a refused save keeps every entered value" asks
 * for: uncontrolled inputs keep what was typed because nothing re-renders them
 * away. It also keeps every string in this file a `t()` key — `prijava.test.ts`
 * makes any other literal an offence, and `elements.namedItem('username')` would
 * be one.
 *
 * ONE error message for three different refusals, and that is the point rather
 * than an economy: see `@/supabase/sign-in`. `destructive` is not used for it —
 * UX-DR4 reserves that token exclusively for an unresolved conflict, and
 * `theme-contrast.test.ts` measures it only against shift fills, so there is no
 * contrast evidence for it on a form.
 *
 * Every string resolves through the module-level `t` (L1/L2). `useTranslation`
 * is deliberately not used: with one locale, no language switch and no lazily
 * loaded namespace, nothing on this screen re-renders on a language change.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, and both fields
 * and the button carry it — the inherited shadcn primitives are `h-9`.
 */
export function SignInScreen() {
  const { slug } = prijavaRoute.useParams();
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
    } catch {
      // Everything `signIn` does not already map: the client throwing its
      // stable code on a build with no environment, and a navigation that
      // rejects. Both used to escape as an unhandled rejection, leaving a
      // screen with no message and — before the `finally` below — a button
      // disabled forever. A misconfiguration reading as an outage is a real
      // cost, and it is the smaller one: `/` still fails loudly, and the
      // console still carries the stable code.
      setFailure(SIGN_IN_UNAVAILABLE);
    } finally {
      // On EVERY path, including the successful one. Clearing it only on
      // failure left the button permanently disabled the moment `navigate`
      // stopped resolving, with nothing on screen to say why.
      exchanging.current = false;
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* An `<h1>`, not `CardTitle`: that primitive renders a `div`, and
              this screen's name is the document's only heading. */}
          <h1 className="text-xl font-semibold leading-none tracking-tight">{t('auth.heading')}</h1>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            onSubmit={(event) => {
              void submit(event);
            }}
            className="grid gap-6"
          >
            <div className="grid gap-2">
              <Label htmlFor="username">{t('auth.username')}</Label>
              {/* A username is admin-issued and never an email, so none of the
                  three text conveniences a phone keyboard applies by default
                  are wanted: a capitalized first letter, an autocorrected
                  surname-shaped string, and a red spelling underline under a
                  perfectly valid credential. */}
              <Input
                ref={usernameField}
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby={failure === null ? undefined : 'sign-in-error'}
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
                {/* Two descriptions, in the order they are useful: what just went
                  wrong, then what to do about a forgotten password. A token
                  list is how `aria-describedby` carries both — the refusal
                  concerns the pair of fields, not the password alone, so it is
                  bound to each of them.

                  CONDITIONAL, because the element it names exists only while
                  there is a failure. A reference to an absent id is not an
                  error, it is simply ignored — which is worse: the attribute is
                  there, a source-level assertion resolves it against the file,
                  and the common case is a control announcing a description that
                  is not on the page. */}
              <Input
                ref={passwordField}
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-describedby={
                  failure === null ? 'password-reset' : 'sign-in-error password-reset'
                }
                className="h-11"
              />
            </div>
            {/* Rendered only once there is something to say. `role="alert"` is
                what announces it to a screen-reader user on insertion; nothing
                in the tab order passes through it, and the fields point at it
                so it is also reachable by moving between them. */}
            {failure === null ? null : (
              <p
                id="sign-in-error"
                role="alert"
                className="rounded-md border border-input px-3 py-2 text-sm font-medium"
              >
                {t(signInMessageKey(failure))}
              </p>
            )}
            <Button className="h-11 w-full" type="submit" disabled={pending}>
              {t('auth.submit')}
            </Button>
            {/* States the fact rather than hiding the affordance (UX-DR34):
                these accounts have no self-service reset, so there is nothing
                to link to. `aria-describedby` from the password field is what
                gets it to a screen-reader user, who would otherwise never meet
                it — it is static text after the last control, so nothing in
                the tab order passes through it. */}
            <p id="password-reset" className="text-sm text-muted-foreground">
              {t('auth.passwordReset')}
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export const prijavaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prijava/$slug',
  component: SignInScreen,
});
