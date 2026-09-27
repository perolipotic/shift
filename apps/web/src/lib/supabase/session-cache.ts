import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { SESSION_UNRESOLVED } from '@/lib/supabase/client';

/**
 * Nothing a session read outlives a change of who is signed in.
 *
 * `main.tsx` builds ONE query cache for the page load, and every cached answer
 * in it (`CALENDAR_KEY`, `MEMBER_ROLE_KEY`, `OWN_TEAM_KEY`, the organization
 * snapshot and the rest) belongs to the session that read it. None of those
 * keys names a user. The chrome's sign-out clears the cache, but that is only
 * the in-tab sign-out: an account switch in another tab, a session that expires
 * and a sign-in over a stale cache all change the user with no click here.
 *
 * `clear()` ALONE IS NOT ENOUGH, and that is why this rule does more. In
 * TanStack Query 5, `QueryCache.clear()` removes every query WITHOUT notifying
 * the observers mounted on it: a screen that is showing the previous user's
 * data keeps showing it, and the orphaned query is out of reach of focus,
 * invalidation and refetch. And the route guards ran for the previous user, so
 * a tab switched to a member in another tab would stay on an admin screen. So
 * each change does two things: the CACHE forgets the previous user in a way
 * the mounted screens see, and the ROUTER re-runs every `beforeLoad` for the
 * new one.
 *
 * THREE TRANSITIONS, and each is handled for what is on screen at the time:
 *
 *   - ONE USER TO ANOTHER (an account switch in another tab): the screen stays
 *     mounted, so the queries are RESET — every observer is told, drops the
 *     previous user's data and the active ones refetch as the new user — and
 *     the router is invalidated so the guards decide again.
 *   - A USER TO NOBODY (a sign-out here or elsewhere, an expiry): the cache is
 *     cleared and the router is invalidated, and `_app`'s session guard then
 *     sends the tab to `/prijava`, which unmounts every observer the clear
 *     orphaned. A reset here would refetch every active query as nobody, and
 *     the screen would flash a skeleton and a refusal on its way out. In the
 *     in-tab sign-out the chrome clears and navigates to `/prijava` itself;
 *     the invalidation is DEFERRED to a macrotask so it runs after that
 *     navigation has started, and it then only re-checks the sign-in route
 *     the tab is already on, so there is no second navigation.
 *   - NOBODY TO A USER (a sign-in): the cache is cleared and the router is
 *     LEFT ALONE. `SIGNED_IN` fires inside `signInWithPassword`, before the
 *     sign-in hook navigates to `/`; invalidating here would re-run the
 *     sign-in route's guard, which redirects a signed-in visitor, and race the
 *     hook's own navigation. Nothing the previous state rendered belongs to a
 *     user, so there is no mounted screen to reset, and a reset would refetch
 *     the sign-in screen's own reads under the person typing.
 *
 * WHAT DOES NOTHING:
 *
 *   - the FIRST event (`INITIAL_SESSION`) only records who is signed in. The
 *     cache is new with the page, so anything in it was read for that same
 *     session.
 *   - a token refresh, or a `SIGNED_IN` that re-announces the same user (the
 *     client emits one when a tab regains focus), keeps the id, so the cache
 *     and the routes stay as they are.
 *
 * The source is a THUNK and its failure is caught here, because building the
 * client throws `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment
 * and `main.tsx` holds no failure handling of its own (`localization-applied`
 * pins that). Not silent: the cause is logged under `SESSION_UNRESOLVED`, the
 * code the route guards log for the same misconfiguration.
 *
 * Executed by `session-cache.test.ts` against a real `QueryClient` and a
 * subscribed `QueryObserver`, with a stub auth client and no browser (AD-15).
 */

/** As much of `supabase.auth` as watching the session needs. */
export interface AuthEventSource {
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

/** As much of the query client as forgetting a user needs. */
export interface SessionCache {
  clear(): void;
  resetQueries(): Promise<void>;
}

/** As much of the router as re-running every guard needs. */
export interface GuardedRouter {
  invalidate(): Promise<void>;
}

/** Runs a task after the current one, so an in-flight navigation starts first. */
export type Defer = (task: () => void) => void;

const nextMacrotask: Defer = (task) => {
  setTimeout(task, 0);
};

/**
 * Resets the cache and re-runs the route guards whenever the signed-in user
 * changes or signs out. Returns the unsubscribe.
 */
export function resetOnSessionChange(
  source: () => AuthEventSource,
  targets: { readonly cache: SessionCache; readonly router: GuardedRouter },
  defer: Defer = nextMacrotask,
): () => void {
  const { cache, router } = targets;
  // `undefined` until the first event: "nobody seen yet" is a different fact
  // from "seen, and signed out".
  let seen: string | null | undefined;

  const reguard = (): void => {
    defer(() => {
      router.invalidate().catch((cause: unknown) => {
        console.error(SESSION_UNRESOLVED, cause);
      });
    });
  };

  try {
    const { data } = source().onAuthStateChange((_event, session) => {
      const user = session?.user.id ?? null;
      const previous = seen;

      seen = user;

      if (previous === undefined || user === previous) return;

      if (previous === null) {
        cache.clear();

        return;
      }

      if (user === null) {
        cache.clear();
      } else {
        void cache.resetQueries();
      }

      reguard();
    });

    return () => {
      data.subscription.unsubscribe();
    };
  } catch (cause) {
    console.error(SESSION_UNRESOLVED, cause);

    return () => undefined;
  }
}
