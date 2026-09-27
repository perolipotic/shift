import { createRoute, redirect } from '@tanstack/react-router';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignInForm } from '@/features/auth/components/sign-in-form';
import { useSignIn } from '@/features/auth/hooks/use-sign-in';
import { organizationDestination } from '@/features/auth/services/address';
import { t } from '@/lib/i18n';
import { resolvedSession } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';

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
 * why the form still has exactly two fields and why the slug arrives as a route
 * param rather than as an input.
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
  const { slug } = prijavaRoute.useParams();
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
  // A slug that cannot be one never reaches the form (review decision,
  // 2026-09-08). Normalization already closed the case a URL creates most
  // often — `/prijava/DVD-Kastel-Novi`, shared, typed or autocapitalized by a
  // phone — but a segment no normalization can rescue, `/prijava/under_score`,
  // rendered a perfectly ordinary form that refused every correct credential
  // forever with the message that says the password is wrong. Unrecoverable,
  // because the screen may not say which.
  //
  // Sent to the organization prompt rather than answered, and that discloses
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
  // the organization prompt whether or not anybody is signed in, which keeps the
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
  beforeLoad: async ({ context, params }) => {
    if (organizationDestination(params.slug) === null) throw redirect({ to: '/prijava' });

    // ONE HELPER, TWO ROUTES. The read, the `catch` and the logging were copied
    // verbatim into both sign-in routes, which is the same hand-copied block
    // `router.test.ts` argues against two files away — and the failure mode is
    // the one this story is fixing: a fix applied to one copy and not the other,
    // on a pair of routes nobody looks at together. What is NOT shared is what
    // `null` means, because that genuinely differs (see `@/lib/supabase/client`):
    // this route fails OPEN.
    if ((await resolvedSession(context.currentSession)) === null) return;

    throw redirect({ to: '/' });
  },
  component: SignInScreen,
});
