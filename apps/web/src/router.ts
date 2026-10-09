import { createRouter } from '@tanstack/react-router';

import { appLayoutRoute } from '@/pages/_app';
import { danasRoute } from '@/pages/danas';
import { godisnjiRoute } from '@/pages/godisnji';
import { indexRoute } from '@/pages/index';
import { kalendarRoute } from '@/pages/kalendar';
import { ljudiMemberRoute } from '@/pages/ljudi.$id';
import { ljudiNoviRoute } from '@/pages/ljudi.novi';
import { ljudiSmjenaRoute } from '@/pages/ljudi.smjene.$id';
import { ljudiSmjeneRoute } from '@/pages/ljudi.smjene';
import { ljudiRoute } from '@/pages/ljudi';
import { organizacijaRoute } from '@/pages/organizacija';
import { organizacijaSatniPojasRoute } from '@/pages/organizacija.satni-pojasi.$id';
import { organizacijaSatniPojasiRoute } from '@/pages/organizacija.satni-pojasi';
import { postaviLozinkuRoute } from '@/pages/postavi-lozinku';
import { postavkeRotacijeRoute } from '@/pages/postavke-rotacije';
import { postavkeRotacijeTipSmjeneRoute } from '@/pages/postavke-rotacije.tipovi-smjena.$id';
import { prijavaBareRoute, prijavaRoute } from '@/pages/prijava';
import { rasporedKonfliktRoute } from '@/pages/raspored.$memberId.$date.$teamId';
import { rasporedRoute } from '@/pages/raspored';
import { rootRoute } from '@/pages/__root';
import { satiRoute } from '@/pages/sati';
import { smjenaRoute } from '@/pages/smjene.$id';
import { currentMemberRole } from '@/features/navigation/services/role';
import { currentSession } from '@/lib/supabase/client';

/**
 * The eight destinations, all of them nested under the pathless `_app` layout.
 *
 * Nesting is what registers the session guard for every one of them at once
 * (`pages/_app.tsx`): a route added to this array and not to the layout would
 * be a destination a signed-out visitor reaches, and the guard is not something
 * eight files should each be trusted to remember.
 *
 * Order here is registration, not navigation. What a member or an admin sees,
 * and in which order, is `@/features/navigation/utils/destinations` — data a test executes
 * rather than a shape a reader infers from an array in a wiring module.
 */
const appDestinations = appLayoutRoute.addChildren([
  danasRoute,
  kalendarRoute,
  satiRoute,
  godisnjiRoute,
  rasporedRoute,
  // STORY 5.4b: one conflict's resolution screen, on 1.7a's terms — nested
  // under the layout, absent from the destinations (the `Raspored` tab lights
  // for it), with the admin guard `/raspored` carries.
  rasporedKonfliktRoute,
  ljudiRoute,
  // TWO ROUTES THAT ARE NOT DESTINATIONS (story 1.5b). `/ljudi/novi` and
  // `/ljudi/$id` nest under the same layout — so the session guard covers them
  // exactly as it covers the eight — and they are deliberately absent from
  // `@/features/navigation/utils/destinations`: the chrome offers places, and these two are
  // reached from the member list rather than from the navigation. Each carries
  // its own role guard, because the layout's is session-only. `/ljudi/novi`
  // renders nothing since story 7.13b: past its guard it redirects to the add
  // dialog on Ljudi, `/ljudi?dodaj=1`, so an old link still opens it.
  //
  // The STATIC one is registered before the parameterized one. TanStack ranks
  // matches rather than taking source order, so this is legibility rather than
  // behaviour — but `router.test.ts` pins `/ljudi/novi` resolving to the static
  // route, because the day that ranking changes, `novi` becomes an id.
  ljudiNoviRoute,
  // STORY 1.7a's two, on the same terms: nested under the layout, absent from
  // the destinations (the `Ljudi` tab lights for them), each with its own role
  // guard. `/ljudi/smjene` is static and must win over `/ljudi/$id`, which
  // `router.test.ts` pins for the reason it pins `/ljudi/novi`.
  ljudiSmjeneRoute,
  ljudiSmjenaRoute,
  ljudiMemberRoute,
  postavkeRotacijeRoute,
  // STORY 2.2b: one shift type, on 1.7a's terms — nested under the layout,
  // absent from the destinations (the `Postavke rotacije` tab lights for it),
  // with its own role guard, as `/postavke-rotacije` now carries too.
  postavkeRotacijeTipSmjeneRoute,
  organizacijaRoute,
  // STORY 2.1b's two, on 1.7a's terms: nested under the layout, absent from
  // the destinations (the `Organizacija` tab lights for them), each with its
  // own role guard.
  organizacijaSatniPojasiRoute,
  organizacijaSatniPojasRoute,
  // STORY 1.8. One team's roster, for EVERY role: nested under the layout, so
  // the session guard covers it, and absent from the destinations — it is
  // reached from the Danas line only. No role guard of its own, because the
  // database decides what a session reads (`team_roster`, `0011`).
  smjenaRoute,
]);

/**
 * `/` and both sign-in routes stay OUTSIDE the layout, deliberately.
 *
 * All three are reachable signed out, and `/` carries its own guard already
 * (`pages/index.tsx`). Nesting them would change their match chains and force
 * `router.test.ts`'s deployed-root block to be re-derived against a layout for
 * no behaviour this story gains — so all three staying flat here is the evidence
 * that the scope boundary held.
 */
const routeTree = rootRoute.addChildren([
  indexRoute,
  prijavaRoute,
  prijavaBareRoute,
  // STORY 7.8. The first sign-in's set-password step: outside the layout,
  // because the layout's guard is what sends a flagged session here, and with
  // no chrome, because no destination is open to it yet.
  postaviLozinkuRoute,
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
 * `/` and `/prijava`. `@/lib/supabase/client` builds it from an injected source and
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
