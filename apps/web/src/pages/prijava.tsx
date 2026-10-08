import { createRoute, redirect, useParams } from '@tanstack/react-router';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInForm } from '@/features/auth/components/sign-in-form';
import { useSignIn } from '@/features/auth/hooks/use-sign-in';
import { organizationDestination } from '@/features/auth/services/address';
import { returnSearchOf } from '@/features/auth/services/return-target';
import { t } from '@/lib/i18n';
import { resolvedSession } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';

/**
 * The sign-in screen (story 1.1d, wired by 1.3b, made one form by 7.7), on
 * BOTH `/prijava` and `/prijava/$slug`.
 *
 * AD-12 authenticates against a synthesized address namespaced by the
 * organization's slug, so the slug has to be in scope at the moment of sign-in
 * — and at that moment there is no session to read it from. Until 7.7 the URL
 * carried it and bare `/prijava` was a separate prompt that asked for it first:
 * two screens for one task. Story 7.7 (redesign decisions 12 and 12a) made it
 * one form with three values. The slug comes from the URL, shown read-only with
 * `Promijeni`; or from the last organization signed into on this device; or
 * from what the person types. The security surface did not change: nothing is
 * looked up before sign-in, every value goes to the one `signIn()`, and a wrong
 * organization fails exactly like a wrong password.
 *
 * Every string resolves through the module-level `t` (L1/L2). `useTranslation`
 * is deliberately not used: with one locale, no language switch and no lazily
 * loaded namespace, nothing on this screen re-renders on a language change.
 *
 * THIS FILE COMPOSES (source structure B7). The refs, the in-flight ref, the
 * refusal and `submit` are `useSignIn`; the form is
 * `@/features/auth/components/sign-in-form`; every rule is in
 * `@/features/auth/services/sign-in`, which the node suite executes.
 */
export function SignInScreen() {
  // NOT STRICT, so one component serves both routes: bare `/prijava` has no
  // `slug`, and the form then offers the field instead of the row.
  const { slug } = useParams({ strict: false });
  const screen = useSignIn(slug);

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* An `<h1>` carrying `CardTitle`'s styling through `asChild`: the
              primitive renders a `div` by default, and this screen's name is
              the document's only heading. No type classes of its own — the
              heading looks like every other card title. */}
          <CardTitle asChild>
            <h1>{t('auth.heading')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SignInForm screen={screen} />
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export const prijavaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prijava/$slug',
  // THE RETURN TARGET, carried and nothing more: `useSignIn` validates it at
  // the moment it is followed (`@/features/auth/services/return-target`).
  validateSearch: returnSearchOf,
  // A slug that cannot be one never reaches the form (review decision,
  // 2026-09-08). Normalization already closed the case a URL creates most
  // often — `/prijava/DVD-Kastel-Novi`, shared, typed or autocapitalized by a
  // phone — but a segment no normalization can rescue, `/prijava/under_score`,
  // rendered a perfectly ordinary form that refused every correct credential
  // forever with the message that says the password is wrong. Unrecoverable,
  // because the screen may not say which.
  //
  // Sent to bare `/prijava` rather than answered, and that discloses
  // NOTHING: well-formedness is the DNS-label rule in
  // `0002_organizations_and_members.sql`, computable by anyone without asking
  // this application anything. Existence is the question that stays unanswered
  // — an unknown but well-formed slug still renders the form and still fails
  // with the ordinary refusal, exactly as the I/O matrix specifies.
  //
  // AND A SIGNED-IN VISITOR NEVER REACHES IT EITHER. The credential form was
  // offered to a session that already had one, which is not merely redundant: it
  // is a form whose only outcome is to replace a working session with the same
  // one, on a shared device where the person reading it may not be the person
  // signed in. The exit is what makes that reachable rather than theoretical, so
  // the guard ships in the same commit as the affordance.
  //
  // THE SLUG IS JUDGED FIRST, and the order matters: a malformed segment goes to
  // bare `/prijava` whether or not anybody is signed in, which keeps the
  // 2026-09-08 decision exactly as it was rather than making it conditional on a
  // session read that can fail.
  //
  // FAIL OPEN, which is the OPPOSITE of the layout's guard and deliberately so.
  // `pages/_app.tsx` treats an unreadable session as no session because letting
  // someone through would put them on a screen every query refuses; here the
  // same unreadable session must render the FORM, because bouncing somebody to
  // `/` on a failed read would leave the one screen that could fix their session
  // unreachable. Same read, opposite default, because the cost of being wrong
  // points the other way. `resolvedSession` is the read; the default is here.
  // REMOUNTED PER SLUG. TanStack Router keeps a route's component mounted
  // across a params-only navigation, so `/prijava/a` to `/prijava/b` would keep
  // the first slug's uncontrolled fields, `Promijeni` state and focus. Keyed
  // on the slug, the screen mounts afresh and opens as the new link says.
  remountDeps: ({ params }) => params.slug,
  beforeLoad: async ({ context, params }) => {
    // `search: true` keeps the return target on the way to bare `/prijava`, so a
    // malformed segment costs the visitor the slug and never the destination.
    if (organizationDestination(params.slug) === null) {
      throw redirect({ to: '/prijava', search: true });
    }

    // ONE HELPER, TWO ROUTES. The read, the `catch` and the logging were once
    // copied verbatim into both sign-in routes — and the failure mode of a copy
    // is a fix applied to one and not the other. What is NOT shared is what
    // `null` means, because that genuinely differs (see `@/lib/supabase/client`):
    // both sign-in routes fail OPEN.
    if ((await resolvedSession(context.currentSession)) === null) return;

    throw redirect({ to: '/' });
  },
  component: SignInScreen,
});

/**
 * Bare `/prijava`: the same screen with no slug in the URL (story 7.7).
 *
 * It is where `/`'s redirect, a typed `/prijava`, a malformed slug, sign-out
 * and `not-found.tsx`'s link back all land. The form shows the organization
 * field, prefilled from this device when it has signed in before.
 */
export const prijavaBareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prijava',
  // The return target the signed-out redirect carries, and nothing else.
  validateSearch: returnSearchOf,
  // A SIGNED-IN VISITOR GOES TO `/`, for the reason recorded on
  // `/prijava/$slug`: on a shared device the person reading the form may not
  // be the person signed in.
  //
  // FAIL OPEN, the opposite of `pages/_app.tsx` and for the reason recorded
  // there too: an unreadable session must render the form, because redirecting
  // on a failed read would put the one path that can repair a session behind
  // the session working.
  beforeLoad: async ({ context }) => {
    if ((await resolvedSession(context.currentSession)) === null) return;

    throw redirect({ to: '/' });
  },
  component: SignInScreen,
});
