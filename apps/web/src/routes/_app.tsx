import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';

import { AppChrome } from '@/navigation/chrome';
import { rootRoute } from '@/routes/__root';
import { SESSION_UNRESOLVED } from '@/supabase/client';

/**
 * The signed-in layout: one session guard for every destination.
 *
 * PATHLESS — it declares an `id` and no `path`, so it adds a level to the tree
 * without adding a segment to any URL. That is not a stylistic choice. A
 * catch-all (`/$`) would satisfy every unknown path as well, and `router.test.ts`
 * refuses it twice over: the deep-link assertions pin `_notFound` on the ROOT
 * match, at index 0, which a catch-all inverts by satisfying the URL, and a
 * second assertion names `/$` outright. A pathless layout leaves both intact,
 * because it matches nothing on its own — it appears in an unmatched path's
 * chain only where a real child route matched a prefix, behind a root that is
 * already marked not-found.
 *
 * WHY A LAYOUT AT ALL. Eight destinations need the identical guard, and eight
 * copies of it is eight places for the next reviewer to check and one place for
 * the next author to forget. `beforeLoad` on a parent runs before every child's,
 * so registering the guard once here is what makes "signed out reaches no
 * destination" a property of the TREE rather than of eight files that currently
 * agree.
 *
 * `/` AND BOTH SIGN-IN ROUTES STAY OUTSIDE IT, deliberately. Nesting `/` would
 * change its match chain from `['__root__', '/']` to one with the layout in it
 * and force the whole deployed-root block — the redirect cases, `search`/`hash`
 * preservation — to be re-derived against a layout, for nothing gained. `/`
 * carries the equivalent guard itself (`index.tsx`) and is redirect-only, so it
 * renders nothing this chrome would need to wrap: a signed-in visitor reaches
 * the chrome by being forwarded INTO a destination. The duplicated guard is two
 * call sites of a four-line check, which is the cheaper of the two prices.
 *
 * SESSION ONLY, NEVER ROLE, and that is a decision rather than an omission. A
 * signed-in member who types `/organizacija` reaches the admin destination's
 * heading, and today that is correct: AD-10 puts isolation and role enforcement
 * in the DATABASE — a `SECURITY DEFINER STABLE` helper re-read on every policy
 * evaluation — never in the interface, and these eight screens hold no data at
 * all, so there is nothing here for a role check to protect. What decides that a
 * member never SEES the destination is `@/navigation/destinations`, which part B
 * renders from.
 *
 * The moment a destination loads organization data, the data is what refuses —
 * and if a route-level check is ever wanted on top, it is a NEW decision made
 * against a screen that has something to hide. `router.test.ts` pins the guard
 * as session-only so that story has to change a test rather than discover this
 * paragraph.
 *
 * THAT MOMENT ARRIVED IN STORY 1.5a, and this guard did not move. `/ljudi`
 * renders every colleague's address and leave allowance, so it carries a check
 * of its own — registered on that route, reading its own reader out of the
 * router context, and argued for in `routes/ljudi.tsx`. What changed in
 * `router.test.ts` is the assertion that NO destination carries a guard, which
 * now names the ones that do and still refuses every other; what did not change
 * is this file, which names no level and must go on naming none. Eight
 * destinations sharing one session guard and one of them adding a second
 * decision of its own are two separate claims, and keeping them in two files is
 * what stops the next reviewer having to hold both at once.
 *
 * The session is read through the router CONTEXT rather than from a client
 * imported here (`__root.tsx` explains the shape), which is what keeps both
 * branches executable in the node suite with no browser and no running stack.
 *
 * It renders the chrome around the outlet, and NOTHING ELSE. The tab bar, the
 * sidebar, the icons, the active-destination treatment and the exit all live in
 * `@/navigation/chrome`, which is also the only thing that reads the member's
 * permission level — so the guard registered here stays session-only, and this
 * file mentions no level at all. `router.test.ts` asserts exactly that, by
 * sweeping this source for the words, which is what keeps the two decisions from
 * quietly merging into one.
 *
 * The chrome is the OUTER element and the outlet its child, unconditionally: a
 * conditional outlet is a destination that resolves, guards, and paints nothing.
 */
export function AppLayout() {
  return (
    <AppChrome>
      <Outlet />
    </AppChrome>
  );
}

export const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  // `id`, never `path`: see the header. The underscore is the file-based
  // convention for a pathless route, kept here so the id reads the same way in
  // `routesById` as the file does on disk.
  id: '_app',
  beforeLoad: async ({ context }) => {
    // THREE outcomes, not two, and the third is why the read is wrapped.
    // `currentSession` can REJECT: the client throws its stable code on a build
    // with no environment, and `getSession` rejects wherever storage is blocked
    // — Safari's private mode, a locked-down enterprise profile. A rejection
    // escaping from here resolves the destination to neither a redirect nor a
    // component, which is the blank page at HTTP 200 that `__root.tsx`
    // registers no `errorComponent` to catch. Same shape as `index.tsx`, and
    // deliberately so: two guards that differ are two guards to reason about.
    let session: Session | null = null;

    try {
      session = await context.currentSession();
    } catch (cause) {
      // `session` stays `null`, which IS the decision: a session that cannot be
      // read is not a session, so the visitor is treated as signed out and
      // fails CLOSED. What is not silent is the reason — swallowing it is how a
      // deployment with no environment redirects every visitor to the sign-in
      // form with an empty console and nothing anywhere to say why.
      console.error(SESSION_UNRESOLVED, cause);
    }

    if (session !== null) return;

    // `search: true` / `hash: true` are TanStack's "retain the current values".
    // AD-14 has the host answer every path with `index.html` at 200, so
    // `/kalendar?tim=2#tjedan` is a shape a real link takes, and a redirect that
    // discarded them would make those parameters unrecoverable — silently,
    // since the visitor lands on a working screen either way.
    throw redirect({ to: '/prijava', search: true, hash: true });
  },
  component: AppLayout,
});
