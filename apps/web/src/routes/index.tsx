import { createRoute, redirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';

import { DESTINATIONS } from '@/navigation/destinations';
import { rootRoute } from '@/routes/__root';
import { SESSION_UNRESOLVED } from '@/supabase/client';

/**
 * The deployed root: a DECISION, never a screen. Both ways out are redirects.
 *
 * `/` must resolve to SOMETHING. A branch that falls through to no redirect and
 * no component is a blank page at HTTP 200, and `__root.tsx` registers no
 * `errorComponent` to catch what escapes — so every path out of here throws,
 * and `router.test.ts` asserts each separately for that reason.
 *
 * SIGNED IN it forwards to the first destination rather than rendering. `/` sits
 * outside the `_app` layout (`router.ts` records why), so a screen here is a
 * signed-in screen with no navigation and no sign-out — which is what it was.
 * The alternative was moving `/` inside the layout: that changes this route's id
 * and its match chain, and leaves a signed-in screen that is not one of the
 * eight destinations — a ninth place to be, with no entry in
 * `@/navigation/destinations` and so no way for the chrome to say you are on
 * it. Forwarding costs no route and changes no id.
 *
 * There is therefore NO COMPONENT here, and there must not be one: a
 * redirect-only route that registers one is a screen nobody can reach.
 *
 * SEARCH AND HASH RIDE THE SIGNED-OUT REDIRECT ONLY, and the asymmetry is the
 * decision. AD-14 has the host answer every path with `index.html` at 200, so
 * `/?invite=…#section` is a shape a real link takes; `/prijava` is where that
 * link's owner carries on, and dropping them there would make them
 * unrecoverable — silently, since the visitor lands on a working screen either
 * way. The forward carries neither, because a destination knows nothing about
 * parameters addressed to `/`: passing them on would invent a meaning for them
 * rather than preserve one.
 *
 * BOTH REPLACE. `/` is a decision, and a decision has no business in the
 * history stack: left there, Back from wherever the visitor landed returns to
 * `/`, which decides again and sends them straight back. That is a dead Back
 * button and everything before `/` unreachable — a failure that could not
 * happen while `/` rendered a screen, because a screen is somewhere Back can
 * legitimately return to.
 *
 * The session is read through the router context rather than from a client
 * imported here (see `__root.tsx`), which is what keeps every branch executable
 * in the node suite without a browser or a running stack.
 */

/**
 * Where a signed-in visitor goes: the FIRST destination, in binding order.
 *
 * READ FROM THE TABLE, never written as a path here. `@/navigation/destinations`
 * is the single source of both the order and the roles; a literal path in this
 * file is a second answer to "where does a person belong first", and it is the
 * one that goes stale silently the day the table's first row changes. The table
 * types itself non-empty so this needs no fallback for a case it rules out.
 *
 * The first row is reachable by EVERY role, which is what lets `/` stay
 * session-only and name no role at all, exactly as `_app.tsx` does. A first row
 * that became admin-only would send every member to a destination the chrome
 * never offers them, and `router.test.ts` pins the property here rather than
 * leaving it to be rediscovered.
 */
const FIRST_DESTINATION = DESTINATIONS[0];

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    // THREE outcomes reach this line, not two, and the third is why the read is
    // wrapped. `currentSession` can REJECT: the client throws its stable code on
    // a build with no environment, and `getSession` rejects wherever storage is
    // blocked — Safari's private mode, a locked-down enterprise profile. An
    // escaping rejection resolves `/` to neither redirect, which is the blank
    // page at HTTP 200 the header exists to rule out.
    //
    // Failing CLOSED, and with no new copy: a session that cannot be read is
    // not a session, so the visitor goes to the sign-in path like any other
    // signed-out visitor. Reading it as a session would forward a signed-out
    // person into the layout, whose own guard would send them back out again.
    let session: Session | null = null;

    try {
      session = await context.currentSession();
    } catch (cause) {
      // `session` stays `null`, which IS the decision — naming a different
      // outcome here would be the third branch this block exists to rule out.
      // What is NOT silent is the reason: this catch swallowed
      // `SUPABASE_ENVIRONMENT_MISSING` whole, so a deployment with no
      // environment redirected every visitor to the sign-in form with an empty
      // console and nothing anywhere to say why. `client.ts` exists to stop a
      // misconfiguration reading as an outage; logging is what keeps that
      // promise once the throw is caught. Same shape as `i18n/boot.ts`.
      console.error(SESSION_UNRESOLVED, cause);
    }

    // ONE FURTHER HOP on the ordinary paths, and they end here. Both sign-in
    // routes send a signed-in visitor to `/`, and this line sends them on to a
    // destination whose layout guard finds the same session and lets them
    // through — so the longest ordinary chain is two redirects and the last one
    // renders.
    //
    // THAT IS A CLAIM ABOUT THE READ SUCCEEDING, not about every path. If the
    // layout's own read throws where this one did not, the layout sends the
    // visitor to `/prijava`, which fails OPEN and renders the form — so the
    // chain still ends. It would only cycle if the reader alternated between
    // succeeding here and throwing there on every attempt, which is a flapping
    // storage API rather than a state the application can be in; `router.test.ts`
    // pins the ordinary path instead of pretending the pathological one away.
    if (session !== null) throw redirect({ to: FIRST_DESTINATION.path, replace: true });

    throw redirect({ to: '/prijava', search: true, hash: true, replace: true });
  },
});
