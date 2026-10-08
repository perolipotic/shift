import { createRoute, redirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';

import { AuthLayout } from '@/components/layout/auth-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SetPasswordForm } from '@/features/auth/components/set-password-form';
import { useSetPassword } from '@/features/auth/hooks/use-set-password';
import { returnSearchFor } from '@/features/auth/services/return-target';
import { mustSetPassword } from '@/features/auth/services/set-password';
import { t } from '@/lib/i18n';
import { SESSION_UNRESOLVED } from '@/lib/supabase/client';
import { rootRoute } from '@/pages/__root';

/**
 * The first sign-in's one step (story 7.8): a member signed in with the
 * password an admin read out to them sets their own before anything else.
 *
 * A ROOT ROUTE WITH THE SIGN-IN FRAME AND NO CHROME. The signed-in layout's
 * guard sends every flagged session here, so this route cannot nest under it
 * — it would redirect to itself — and a chrome would offer eight destinations
 * the guard refuses. The way out that is not saving is `Odjava`, on the form.
 *
 * THIS FILE COMPOSES (source structure B7). The refs, the in-flight ref, the
 * refusal and `submit` are `useSetPassword`; the form is
 * `@/features/auth/components/set-password-form`; every rule is in
 * `@/features/auth/services/set-password`, which the node suite executes.
 */
export function SetPasswordScreen() {
  const screen = useSetPassword();

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle asChild>
            <h1>{t('auth.setPassword.heading')}</h1>
          </CardTitle>
          <CardDescription>{t('auth.setPassword.lede')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm screen={screen} />
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export const postaviLozinkuRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/postavi-lozinku',
  beforeLoad: async ({ context, location }) => {
    // FAIL CLOSED, as `pages/_app.tsx` does and for its reason: a session that
    // cannot be read is not a session, and this screen's save needs one.
    let session: Session | null = null;

    try {
      session = await context.currentSession();
    } catch (cause) {
      console.error(SESSION_UNRESOLVED, cause);
    }

    // NOBODY SIGNED IN: the sign-in form, carrying this location so a sign-in
    // comes back here (and the layout's guard would send it here anyway).
    if (session === null) {
      throw redirect({ to: '/prijava', search: returnSearchFor(location.href) });
    }

    // NOT HELD: there is nothing to set, so the step is `/`'s forward like any
    // other visit — a bookmark of this URL must not be a second way to change
    // a password.
    if (!mustSetPassword(session)) throw redirect({ to: '/' });
  },
  component: SetPasswordScreen,
});
