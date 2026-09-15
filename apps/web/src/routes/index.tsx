import { createRoute, redirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';

import { t } from '@/i18n';
import { rootRoute } from '@/routes/__root';
import { SESSION_UNRESOLVED } from '@/supabase/client';

/**
 * The deployed root: a redirect while signed out, a screen while signed in.
 *
 * Story 1.1d made `/` throw a redirect unconditionally and left a note naming
 * this as the one seam story 1.3 turns conditional, together with the invariant
 * that survives the change: `/` must keep resolving to SOMETHING. A conditional
 * that falls through to no redirect and no component is the blank page 1.1d
 * removed. Both branches below resolve — one throws, the other renders — and
 * `router.test.ts` asserts each separately for that reason.
 *
 * `search: true` and `hash: true` stay on the redirecting branch. AD-14 has the
 * host answer every path with `index.html` at 200, so `/?invite=…#section` is a
 * shape a real link can take, and a redirect that discarded them would make
 * those parameters unrecoverable — silently, since the user lands on a working
 * screen either way.
 *
 * The session is read through the router context rather than from a client
 * imported here (see `__root.tsx`), which is what keeps both branches
 * executable in the node suite without a browser or a running stack.
 *
 * `home.heading` is a PLACEHOLDER and is labelled one on purpose: it is the
 * smallest thing that proves a session reaches a screen. The navigation shell
 * replaces it wholesale, so nothing here should be built on — no destinations,
 * no sign-out affordance (`Odjava` stays reserved), no shell.
 */
export function SignedInScreen() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <h1 className="text-xl font-semibold leading-none tracking-tight">{t('home.heading')}</h1>
    </main>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    // THREE outcomes reach this line, not two, and the third is why the read is
    // wrapped. `currentSession` can REJECT: the client throws its stable code on
    // a build with no environment, and `getSession` rejects wherever storage is
    // blocked — Safari's private mode, a locked-down enterprise profile. An
    // escaping rejection resolves `/` to neither a redirect nor a component,
    // which is the blank page at HTTP 200 the branch invariant exists to
    // prevent, and there is no `errorComponent` to catch it (`__root.tsx`).
    //
    // Failing CLOSED, and with no new copy: a session that cannot be read is
    // not a session, so the visitor goes to the sign-in path like any other
    // signed-out visitor. Reading it as a session would put a signed-out person
    // on a screen every later query fails against.
    let session: Session | null = null;

    try {
      session = await context.currentSession();
    } catch (cause) {
      // `session` stays `null`, which IS the decision — naming a different
      // outcome here would be the third branch this comment block exists to
      // rule out. What is NOT silent is the reason: this catch swallowed
      // `SUPABASE_ENVIRONMENT_MISSING` whole, so a deployment with no
      // environment redirected every visitor to the sign-in form with an empty
      // console and nothing anywhere to say why. `client.ts` exists to stop a
      // misconfiguration reading as an outage; logging is what keeps that
      // promise once the throw is caught. Same shape as `i18n/boot.ts`.
      console.error(SESSION_UNRESOLVED, cause);
    }

    if (session !== null) return;

    throw redirect({ to: '/prijava', search: true, hash: true });
  },
  component: SignedInScreen,
});
