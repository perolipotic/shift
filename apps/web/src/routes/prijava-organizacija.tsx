import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useRef, type FormEvent } from 'react';

import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { rootRoute } from '@/routes/__root';
import { ORGANIZATION_NAVIGATION_FAILED, organizationDestination } from '@/supabase/address';
import { resolvedSession } from '@/supabase/client';

/**
 * Which organization (story 1.3b), at bare `/prijava`.
 *
 * The credential form lives at `/prijava/$slug` because AD-12's address is
 * namespaced by the organization and there is no session to read the
 * organization from before signing in. That leaves three places with no slug in
 * scope — `/`'s redirect target, a typed `/prijava`, and `not-found.tsx`'s link
 * back — so bare `/prijava` needs a screen of its own rather than a 404, and
 * this is the smallest one that gets a person to theirs: one field, then on.
 *
 * It is NOT a third field on the credential form. That form is frozen at two
 * (human decision, 2026-09-07), and this screen is the reason it can stay that
 * way.
 *
 * It resolves nothing and asks nothing. The slug is checked against the same
 * DNS-label rule the `organizations` table applies and then simply navigated
 * to — no lookup, no "does this organization exist" answer, because any such
 * answer is an enumeration oracle exposed to an anonymous caller. An unknown
 * slug therefore produces a perfectly ordinary sign-in screen whose refusal
 * discloses nothing, which is the same shape as a wrong password.
 *
 * A value that cannot be a slug is refused INERTLY: `required` lets the
 * browser's own validation stop an empty submission in the user's language, and
 * a malformed one simply does not navigate. Neither case gets a message,
 * because a message here would be the beginning of the same oracle.
 *
 * `autoComplete="off"` rather than `organization`, which is what this field
 * carried first: the WHATWG token names the organization's NAME — "DVD Kaštel
 * Novi" — and this field takes its slug. Autofill therefore supplied a value
 * `isOrganizationSlug` can never accept, and because the screen is deliberately
 * inert, the button then visibly did nothing. A wrong hint that drives a person
 * into the one silent failure state is worse than no hint.
 */
export function OrganizationPromptScreen() {
  const navigate = useNavigate();
  const organizationField = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const field = organizationField.current;

    if (field === null) return;

    // The decision itself lives in `@/supabase/address` so a node test can run
    // it: this file is a `.tsx` and is collected by nothing (AD-15).
    const slug = organizationDestination(field.value);

    if (slug === null) return;

    // The rejection is caught rather than discarded: `void` on a promise that
    // rejects — an aborted navigation, a router error — is an unhandled
    // rejection, and the sign-in screen's equivalent call sits inside a
    // `try`/`catch` for the same reason. There is nothing to say to the person
    // here (a message would begin the oracle this screen refuses to be), so the
    // console carries it and the prompt stays put.
    navigate({ to: '/prijava/$slug', params: { slug } }).catch((cause: unknown) => {
      console.error(ORGANIZATION_NAVIGATION_FAILED, cause);
    });
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle asChild>
            <h1>{t('auth.organization.heading')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form method="post" onSubmit={submit} className="grid gap-6">
            <div className="grid gap-2">
              <Label htmlFor="organization">{t('auth.organization.label')}</Label>
              <Input
                ref={organizationField}
                id="organization"
                name="organization"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                className="h-11"
              />
            </div>
            <Button className="h-11 w-full" type="submit">
              {t('auth.organization.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export const prijavaOrganizacijaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prijava',
  // THE ROUTE THAT HAD NO GUARD AT ALL, and the one a signed-in visitor is most
  // likely to reach: it is where `/`'s redirect, a typed `/prijava` and
  // `not-found.tsx`'s link back all land. Offered to a session that already
  // exists, this screen asks which organization somebody belongs to when the
  // answer is already signed into the browser — and on a shared device the
  // person reading it may not be the person signed in, which is exactly the
  // state the exit shipping alongside makes reachable.
  //
  // FAIL OPEN, the opposite of `routes/_app.tsx` and for the reason recorded on
  // `/prijava/$slug`: an unreadable session must render this prompt, because
  // redirecting on a failed read would put the one path that can repair a
  // session behind the session working.
  beforeLoad: async ({ context }) => {
    // The same read `/prijava/$slug` makes, through the same helper — see the
    // note there, and `@/supabase/client` for why only the read is shared.
    if ((await resolvedSession(context.currentSession)) === null) return;

    throw redirect({ to: '/' });
  },
  component: OrganizationPromptScreen,
});
