import { Outlet, createRootRouteWithContext } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';

import { UpdateNotice } from '@/components/update-notice';
import type { MemberRoleReader } from '@/features/navigation/services/role';
import { ErrorScreen } from '@/pages/error';
import { NotFoundScreen } from '@/pages/not-found';

/**
 * The application shell: structure, plus the update notice.
 *
 * Its only words are the update notice's (story 8.1): `UpdateNotice` sits above
 * the outlet because a new version concerns every route, sign-in included, and
 * it renders nothing until a waiting version exists. Otherwise the shell stays
 * text-free, and deliberately so. The two-layout / one-architecture
 * navigation (bottom tabs on mobile, sidebar on desktop) needs a role-keyed
 * destination table and nine `nav.*` labels, and its destinations are
 * role-dependent — so it is its own spec rather than part of this one, and the
 * shell holds nothing but the outlet until it lands. What it does own is the
 * not-found case: AD-14 has the host answer every path with `index.html` at 200,
 * so the client decides a path is unknown, and `notFoundComponent` here is the
 * only shape that decides it without adding a route (see `not-found.tsx`). It
 * also owns the FAILED case (A148): `errorComponent` here catches whatever a
 * route below lets escape, in `hr.json`'s words rather than TanStack's English
 * default with the error's text (see `error.tsx`).
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
  /**
   * The signed-in member's own permission level, or a code — story 1.5a.
   *
   * THE SECOND MEMBER, and it arrives for the reason the first one did rather
   * than as a convenience. `/ljudi` is the first route in the tree that refuses
   * a permission level, and the two other ways of telling it were both worse:
   * importing the Supabase client into the route module makes the decision
   * unassertable from the node suite (AD-15) AND makes `beforeLoad` throw
   * `SUPABASE_ENVIRONMENT_MISSING` on a clone with no `.env.local`, and seeding
   * a plain role value into the router makes it a snapshot that is stale by the
   * time a demoted admin navigates. A reader is neither: it is injectable, so
   * both branches of the guard are executable, and it is read at resolution
   * time, so it cannot be stale.
   *
   * It is READ FRESH on every resolution of a guarded route, which is the whole
   * of `@/features/navigation/services/role`'s argument: `custom_access_token_hook` deliberately
   * puts no level in the token, so a demoted admin loses the destination on
   * their next navigation rather than at token expiry.
   *
   * `reuse` (E878) is the one exception, and only for a route that STAYS: a
   * search-only navigation serves the chrome's cached answer instead of reading
   * the level per keystroke (`@/features/navigation/services/admin-guard`).
   */
  readonly currentMemberRole: MemberRoleReader;
  /**
   * Whether the route tree has a screen for a pathname (C512, E853).
   *
   * The guards that FOLLOW a return target — a signed-in visitor on a sign-in
   * route, a session done with the set-password step — validate it through
   * `returnTargetOf`, which asks the tree whether the path is one of its own.
   * The tree imports the pages, so a page cannot import it back: the question
   * arrives here instead, bound to the real router in `router.ts`.
   */
  readonly isKnownPath: (pathname: string) => boolean;
}

function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <UpdateNotice />
      <Outlet />
    </div>
  );
}

export const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: AppShell,
  notFoundComponent: NotFoundScreen,
  errorComponent: ErrorScreen,
});
