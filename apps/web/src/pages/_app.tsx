import { Outlet, createRoute, redirect } from '@tanstack/react-router';
import { useEffect } from 'react';

import { AppChrome } from '@/features/navigation/components/chrome';
import { reconcileThisPushDevice } from '@/features/notifications/services/page-push';
import { returnSearchFor } from '@/features/auth/services/return-target';
import { mustSetPassword } from '@/features/auth/services/set-password';
import { rootRoute } from '@/pages/__root';
import { readsOffline } from '@/lib/offline/readable-paths';
import { resolvedSession } from '@/lib/supabase/client';
import { sessionEnded } from '@/lib/supabase/session-cache';

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
 * and force the whole deployed-root block — the redirect cases, the carried
 * location — to be re-derived against a layout, for nothing gained. `/`
 * carries the equivalent guard itself (`index.tsx`) and is redirect-only, so it
 * renders nothing this chrome would need to wrap: a signed-in visitor reaches
 * the chrome by being forwarded INTO a destination. The READ is shared
 * (`resolvedSession`, which `index.tsx` and both sign-in routes call too); the
 * branches after it are each route's own.
 *
 * SESSION ONLY, NEVER ROLE, and that is a decision rather than an omission.
 * When this layout was written, a signed-in member who typed `/organizacija`
 * reached the admin destination's heading, and that was correct: AD-10 puts
 * isolation and role enforcement in the DATABASE — a `SECURITY DEFINER STABLE`
 * helper re-read on every policy evaluation — never in the interface, and these
 * eight screens held no data at all, so there was nothing here for a role check
 * to protect. What decides that a
 * member never SEES the destination is `@/features/navigation/utils/destinations`, which part B
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
 * router context, and argued for in `pages/ljudi.tsx`. What changed in
 * `router.test.ts` is the assertion that NO destination carries a guard, which
 * now names the ones that do and still refuses every other; what did not change
 * is this file, which names no level and must go on naming none. Since the
 * admin route guard fix, every admin-only destination carries that check of its
 * own, `/za-odluku` and `/organizacija` included. Eight
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
 * `@/features/navigation/components/chrome`, which is also the only thing that reads the member's
 * permission level — so the guard registered here stays session-only, and this
 * file mentions no level at all. `router.test.ts` asserts exactly that, by
 * sweeping this source for the words, which is what keeps the two decisions from
 * quietly merging into one.
 *
 * The chrome is the OUTER element and the outlet its child, unconditionally: a
 * conditional outlet is a destination that resolves, guards, and paints nothing.
 */
export function AppLayout() {
  // STORY 10.4, in one place for every signed-in screen: a session that ended
  // without Odjava (an expiry, a revocation, a local sign-out) left this
  // device's push subscription behind. On a signed-in load, a subscription
  // the member does not own is unsubscribed, silently and best-effort.
  useEffect(() => {
    void reconcileThisPushDevice();
  }, []);

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
  beforeLoad: async ({ context, location }) => {
    // THREE outcomes, not two, and the third is why the read goes through
    // `resolvedSession`. `currentSession` can REJECT: the client throws its
    // stable code on a build with no environment, `getSession` rejects
    // wherever storage is blocked — Safari's private mode, a locked-down
    // enterprise profile — and a read over its time budget rejects too. The
    // shared read logs `SESSION_UNRESOLVED` with the cause and answers `null`,
    // which IS the decision here: a session that cannot be read is not a
    // session, so the visitor is treated as signed out and fails CLOSED.
    //
    // OFFLINE-READABLE DESTINATIONS read the session FOR READING (story 8.2,
    // human decision 2026-10-20 a): offline, an expired token that cannot be
    // refreshed is not a sign-out, so the destinations that read offline
    // (`OFFLINE_READABLE_PATHS`, route patterns: *Danas*, *Kalendar*, *Sati*,
    // *Godišnji*, *Ljudi* and a team's roster, story 8.2b) still open on the
    // device's snapshot (`@/lib/supabase/offline-session`). Every other
    // destination reads the live session alone, as before.
    const reader =
      readsOffline(location.pathname) && context.sessionForReads !== undefined
        ? context.sessionForReads
        : context.currentSession;
    const session = await resolvedSession(reader);
    // TAKEN ON EVERY RUN, so the mark never outlives the guard run it was
    // raised for: set when this run is the re-guard for a session that ended
    // or changed hands outside this tab (`@/lib/supabase/session-cache`, C516),
    // and then no redirect below carries the location — the next person to
    // sign in on this device is not sent to the previous one's deep link.
    const changedHands = sessionEnded.take();
    const carried = changedHands ? {} : returnSearchFor(location.href);

    if (session !== null) {
      // THE FIRST SIGN-IN (story 7.8). A session admin-auth flagged — a new
      // account, or one an admin reset — reaches no destination until the
      // member has set their own password. Every destination nests here, so
      // one check holds them all; `/postavi-lozinku` sits OUTSIDE this layout
      // or it would redirect to itself. The flag is read off the session the
      // guard already holds: who the person is, never what they may do.
      //
      // The location travels with it (E853), in the same `povratak` the
      // sign-in routes carry, so saving the password lands where the link
      // pointed rather than on `/`.
      if (mustSetPassword(session)) throw redirect({ to: '/postavi-lozinku', search: carried });

      return;
    }

    // THE WHOLE LOCATION TRAVELS, path included. AD-14 has the host answer every
    // path with `index.html` at 200, so `/kalendar?tim=2#tjedan` is a shape a
    // real link takes. This redirect used to keep only the search and the hash
    // (`search: true` / `hash: true`) on the prompt, where nothing used them
    // and the next hop dropped them — and the path never travelled at all.
    // Now the href rides `povratak` through both sign-in routes and the
    // sign-in hook returns there, through the validator in
    // `@/features/auth/services/return-target` — unless this run is the
    // re-guard for a session change, which carries nothing (above).
    throw redirect({ to: '/prijava', search: carried });
  },
  component: AppLayout,
});
