import { createRouter } from '@tanstack/react-router';

import { indexRoute } from '@/routes/index';
import { prijavaOrganizacijaRoute } from '@/routes/prijava-organizacija';
import { prijavaRoute } from '@/routes/prijava';
import { rootRoute } from '@/routes/__root';
import { currentSession } from '@/supabase/client';

const routeTree = rootRoute.addChildren([indexRoute, prijavaRoute, prijavaOrganizacijaRoute]);

/**
 * The router, and the one place the session reader is bound into the context.
 *
 * `currentSession` is the whole of the router context (`__root.tsx`). It is
 * declared outside the route module so `/`'s decision stays assertable from the
 * node suite: `router.test.ts` calls `beforeLoad` with a context of its own and
 * gets both branches, which is impossible if the route reaches for the client
 * itself.
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
  context: { currentSession },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
