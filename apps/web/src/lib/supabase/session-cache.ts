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
 *     sign-in hook navigates to its return target (the carried deep link, or
 *     `/`); invalidating here would re-run the sign-in route's guard, which
 *     redirects a signed-in visitor to `/`, and race the hook's own
 *     navigation — dropping the deep link. Nothing the previous state rendered belongs to a
 *     user, so there is no mounted screen to reset, and a reset would refetch
 *     the sign-in screen's own reads under the person typing.
 *
 * A RE-GUARD RAISED BY A SESSION CHANGE FORGETS THE DEEP LINK (C516). The
 * guard that bounces a signed-out tab to `/prijava` carries the location in
 * `povratak`, so the next sign-in returns there. When the bounce is the
 * re-guard for a sign-out or expiry ELSEWHERE, or for another account taking
 * the tab over, the next person to sign in on a shared device is very likely
 * not the one who opened that location, and following it would hand them the
 * previous person's place. So both changes MARK {@link sessionEnded} before the
 * re-guard, and the session guards (`pages/_app.tsx`,
 * `pages/postavi-lozinku.tsx`) take the mark on their next run and carry no
 * `povratak` when they redirect. A sign-in clears the mark, and a bounce the
 * tab raises itself — a navigation that finds the session already gone — keeps
 * its target as before.
 *
 * THE DEVICE'S COPY FOLLOWS THE SAME CHANGES (story 8.2). The cache is
 * also kept in IndexedDB for offline reading (`@/lib/offline/persistence`),
 * tagged with its owner. A user who signs out or is replaced has that copy
 * DELETED, before the cache is cleared or reset, so nothing of theirs is
 * saved again; a user who signs in, or takes the tab over, has the cache
 * kept for them from then on.
 *
 * THE FIRST EVENT (`INITIAL_SESSION`) RECONCILES. The cache is no longer new
 * with the page: `main.tsx` restored the device's copy before the first
 * render, for the local session's user alone. So the first event checks that
 * user against the one the copy was restored for. The same user — the
 * ordinary case — changes nothing but keeping the cache for them. Anybody
 * else (the session changed between the restore and the event) deletes the
 * copy and drops what it restored: reset for another user, so a mounted
 * screen refetches as them; cleared for a CONFIRMED nobody, whom the guards
 * send to `/prijava`. A `null` that is only an unresolved session offline —
 * an expired token auth-js cannot refresh — is not a nobody (story 8.2,
 * human decision 2026-10-20 a; `reconcile` below).
 *
 * WHAT DOES NOTHING:
 *
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

/** As much of the device snapshot (`@/lib/offline/persistence`) as following the user needs. */
export interface KeptSnapshot {
  /** Whose cache is kept on the device, or `null` for nobody. */
  owner(): string | null;
  /** Keeps the cache for `userId` from now on. */
  persistFor(userId: string): void;
  /** Stops keeping the cache and deletes the device's copy. Never rejects. */
  forget(): Promise<void>;
}

/** As much of the router as re-running every guard needs. */
export interface GuardedRouter {
  invalidate(): Promise<void>;
}

/**
 * Whether the session changed under the tab since a session guard last ran.
 * Set by {@link resetOnSessionChange}, taken by the guards.
 */
export interface SessionEndMark {
  /** The session ended or changed hands: the next guard drops the deep link. */
  mark(): void;
  /** A sign-in: whatever the previous session left marked is moot. */
  clear(): void;
  /** Whether the mark was set, clearing it — so one change drops one target. */
  take(): boolean;
}

/** A fresh mark, unset. */
export function sessionEndMark(): SessionEndMark {
  let marked = false;

  return {
    mark: () => {
      marked = true;
    },
    clear: () => {
      marked = false;
    },
    take: () => {
      const was = marked;

      marked = false;

      return was;
    },
  };
}

/**
 * The page's one mark: `main.tsx` hands it to {@link resetOnSessionChange},
 * and the session guards take it.
 */
export const sessionEnded = sessionEndMark();

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
  targets: {
    readonly cache: SessionCache;
    readonly router: GuardedRouter;
    readonly ended: SessionEndMark;
    readonly device: KeptSnapshot;
    /**
     * The user a `null` first event still is for reading — offline, the
     * stored session's — or `null` (`@/lib/supabase/offline-session`).
     * Never rejects.
     */
    readonly offlineUser: () => Promise<string | null>;
  },
  defer: Defer = nextMacrotask,
): () => void {
  const { cache, router, ended, device, offlineUser } = targets;
  // `undefined` until the first event: "nobody seen yet" is a different fact
  // from "seen, and signed out".
  let seen: string | null | undefined;

  // Counts the events, so a first-event check that answers late knows
  // whether a later event has decided since.
  let events = 0;

  /**
   * Deletes the device's copy, then runs `then` IN THE SAME TASK: the delete
   * is asynchronous, but `forget` stops saving and drops the owner before it
   * returns its promise, so nothing of the previous user is written between
   * the two, and the mounted screens see the cache change at once. The
   * delete itself completes with the clear's task queue (`forget` never
   * rejects).
   */
  const forgetThen = (then: () => void): void => {
    const forgetting = device.forget();

    then();
    void forgetting;
  };

  /**
   * THE FIRST EVENT against what `main.tsx` restored. The same user, or a copy
   * restored for nobody, keeps the cache, kept from now on for that user.
   * Somebody else drops it: reset, so a mounted screen refetches as them.
   *
   * NOBODY, OVER A RESTORED COPY, IS ASKED AGAIN (story 8.2, human decision
   * 2026-10-20 a): offline with an expired token, auth-js announces the first
   * event as `null` while it keeps the session in storage. If the stored
   * session is the restored user's, the copy and the cache stay, and that
   * user is the one SEEN, so a refresh on reconnect changes nothing and a
   * real sign-out then deletes the copy as always. Otherwise — no stored
   * session, online, another user — the copy is deleted and the cache
   * cleared, as for any confirmed nobody.
   */
  const reconcile = (user: string | null): void => {
    const restored = device.owner();

    if (user !== null) {
      if (restored !== null && restored !== user) {
        // The copy was another user's: the guards ran for them, so they run again.
        ended.mark();
        forgetThen(() => {
          void cache.resetQueries();
        });
        reguard();
      }

      device.persistFor(user);

      return;
    }

    if (restored === null) return;

    // Provisionally still the restored user: a later event is judged against them.
    seen = restored;
    const asked = events;

    void offlineUser().then((stored) => {
      if (events !== asked || stored === restored) return;

      // A confirmed nobody, or somebody else: the restored user's session
      // has ended under the tab, which the guards must see.
      seen = null;
      ended.mark();
      forgetThen(() => {
        cache.clear();
      });
      reguard();
    });
  };

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
      events += 1;

      if (previous === undefined) {
        reconcile(user);

        return;
      }

      if (user === previous) return;

      // A USER TO NOBODY. Marked BEFORE the re-guard is scheduled, so the
      // guard it runs sees it; the copy is deleted BEFORE the clear.
      if (user === null) {
        ended.mark();
        forgetThen(() => {
          cache.clear();
        });
        reguard();

        return;
      }

      // NOBODY TO A USER: a sign-in.
      if (previous === null) {
        ended.clear();
        cache.clear();
        device.persistFor(user);

        return;
      }

      // ONE USER TO ANOTHER.
      ended.mark();
      forgetThen(() => {
        void cache.resetQueries();
      });
      device.persistFor(user);
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
