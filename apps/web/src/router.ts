import { createRouter } from '@tanstack/react-router';

import { appLayoutRoute } from '@/routes/_app';
import { danasRoute } from '@/routes/danas';
import { godisnjiRoute } from '@/routes/godisnji';
import { indexRoute } from '@/routes/index';
import { kalendarRoute } from '@/routes/kalendar';
import { ljudiRoute } from '@/routes/ljudi';
import { organizacijaRoute } from '@/routes/organizacija';
import { postavkeRotacijeRoute } from '@/routes/postavke-rotacije';
import { prijavaOrganizacijaRoute } from '@/routes/prijava-organizacija';
import { prijavaRoute } from '@/routes/prijava';
import { rasporedRoute } from '@/routes/raspored';
import { rootRoute } from '@/routes/__root';
import { satiRoute } from '@/routes/sati';
import { currentMemberRole } from '@/navigation/role';
import { currentSession } from '@/supabase/client';

/**
 * The eight destinations, all of them nested under the pathless `_app` layout.
 *
 * Nesting is what registers the session guard for every one of them at once
 * (`routes/_app.tsx`): a route added to this array and not to the layout would
 * be a destination a signed-out visitor reaches, and the guard is not something
 * eight files should each be trusted to remember.
 *
 * Order here is registration, not navigation. What a member or an admin sees,
 * and in which order, is `@/navigation/destinations` — data a test executes
 * rather than a shape a reader infers from an array in a wiring module.
 */
const appDestinations = appLayoutRoute.addChildren([
  danasRoute,
  kalendarRoute,
  satiRoute,
  godisnjiRoute,
  rasporedRoute,
  ljudiRoute,
  postavkeRotacijeRoute,
  organizacijaRoute,
]);

/**
 * `/` and both sign-in routes stay OUTSIDE the layout, deliberately.
 *
 * All three are reachable signed out, and `/` carries its own guard already
 * (`routes/index.tsx`). Nesting them would change their match chains and force
 * `router.test.ts`'s deployed-root block to be re-derived against a layout for
 * no behaviour this story gains — so all three staying flat here is the evidence
 * that the scope boundary held.
 */
const routeTree = rootRoute.addChildren([
  indexRoute,
  prijavaRoute,
  prijavaOrganizacijaRoute,
  appDestinations,
]);

/**
 * The router, and the one place the session reader is bound into the context.
 *
 * `currentSession` and `currentMemberRole` are the whole of the router context
 * (`__root.tsx`). Both are declared outside the route modules so `/`'s decision
 * and `/ljudi`'s guard stay assertable from the node suite: `router.test.ts`
 * calls each `beforeLoad` with a context of its own and gets both branches,
 * which is impossible if a route reaches for the client itself.
 *
 * `currentMemberRole` joined in story 1.5a, and it is the second reader for the
 * same reason the first one is a reader rather than a value: it is read at
 * resolution time, so a demoted admin loses `/ljudi` on their next navigation
 * rather than at token expiry.
 *
 * The reader is IMPORTED rather than written here as an arrow, because an arrow
 * here is executed by no test at all: `router.test.ts` supplies its own context
 * and never touches this one, so `async () => null` in this position kept the
 * entire suite green while every signed-in visitor bounced endlessly between
 * `/` and `/prijava`. `@/supabase/client` builds it from an injected source and
 * asserts the behaviour; this file only has to name it, and `router.test.ts`
 * pins that naming by identity.
 *
 * It is called on every resolution of `/` rather than read once into a value.
 * The session is established by `signInWithPassword` inside the client, and the
 * navigation to `/` happens immediately after — a snapshot taken at boot would
 * still say "signed out" at exactly that moment and bounce the person who just
 * signed in straight back to the form.
 */
export const router = createRouter({
  routeTree,
  context: { currentSession, currentMemberRole },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
