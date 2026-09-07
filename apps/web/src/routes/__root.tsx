import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';

import { NotFoundScreen } from '@/routes/not-found';

/**
 * The application shell: structure only.
 *
 * It stays text-free, and deliberately so. The two-layout / one-architecture
 * navigation (bottom tabs on mobile, sidebar on desktop) needs a role-keyed
 * destination table and nine `nav.*` labels, and its destinations are
 * role-dependent — so it is its own spec rather than part of this one, and the
 * shell holds nothing but the outlet until it lands. What it does own is the
 * not-found case: AD-14 has the host answer every path with `index.html` at 200,
 * so the client decides a path is unknown, and `notFoundComponent` here is the
 * only shape that decides it without adding a route (see `not-found.tsx`).
 *
 * The root gained a typed CONTEXT in story 1.3b, and it holds exactly one
 * member. `/`'s `beforeLoad` has to know whether anyone is signed in, and the
 * two other ways of telling it were both worse: importing the Supabase client
 * into the route module makes the decision unassertable from the node suite
 * (AD-15 — nothing can stand in for the client), and seeding a plain `session`
 * value into the router makes it a snapshot that goes stale the moment a session
 * is established, which is exactly when the redirect is asked to change its
 * mind. A reader is neither: it is injectable, so the signed-out and signed-in
 * branches are both executable, and it is read at resolution time, so it cannot
 * be stale.
 */

/** What every route's `beforeLoad` and loader receives. */
export interface AppRouterContext {
  /** The live session, or `null`. Asynchronous: it is read from the client's
   *  own storage rather than held here, so nothing has to be kept in step. */
  readonly currentSession: () => Promise<Session | null>;
}

function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: AppShell,
  notFoundComponent: NotFoundScreen,
});
