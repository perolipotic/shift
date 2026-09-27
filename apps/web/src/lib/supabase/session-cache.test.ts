import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_UNRESOLVED } from '@/lib/supabase/client';
import {
  resetOnSessionChange,
  type AuthEventSource,
  type Defer,
} from '@/lib/supabase/session-cache';

/**
 * The session rule, executed with no browser (AD-15): a stub auth client that
 * lets each case emit the events a real one would, a REAL `QueryClient` with a
 * subscribed `QueryObserver` standing in for a mounted screen, and a stub
 * router whose `invalidate` stands in for every `beforeLoad` re-running.
 *
 * The observer is the point. `clear()` alone passes every assertion a stub
 * cache can make and still leaves a mounted screen showing the previous user's
 * data, because TanStack Query 5 removes the queries without telling their
 * observers. Only a real observer can see that.
 */

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

function stubAuth(): { source: AuthEventSource; emit: Listener; unsubscribed: () => boolean } {
  let listener: Listener | null = null;
  let unsubscribed = false;

  return {
    source: {
      onAuthStateChange(callback) {
        listener = callback;

        return {
          data: {
            subscription: {
              unsubscribe: () => {
                unsubscribed = true;
              },
            },
          },
        };
      },
    },
    emit: (event, session) => {
      if (listener === null) throw new Error('the rule never subscribed to the auth client');
      listener(event, session);
    },
    unsubscribed: () => unsubscribed,
  };
}

/** Enough of a session for the rule to read its user. */
const sessionOf = (id: string, token = 'token'): Session =>
  ({ access_token: token, user: { id } }) as unknown as Session;

interface Mounted {
  /** Who the next read answers for, as the database would. */
  signedIn: string;
  readonly client: QueryClient;
  readonly observer: QueryObserver<string>;
  readonly reads: () => number;
  stop: () => void;
}

/** A real cache with one screen mounted on it, showing `signedIn`'s answer. */
async function mountScreen(signedIn: string): Promise<Mounted> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let reads = 0;
  const mounted: Mounted = {
    signedIn,
    client,
    observer: new QueryObserver<string>(client, {
      queryKey: ['calendar'],
      queryFn: () => {
        reads += 1;

        return Promise.resolve(`calendar of ${mounted.signedIn}`);
      },
    }),
    reads: () => reads,
    stop: () => undefined,
  };
  mounted.stop = mounted.observer.subscribe(() => undefined);

  await vi.waitFor(() => {
    expect(mounted.observer.getCurrentResult().data).toBe(`calendar of ${signedIn}`);
  });

  return mounted;
}

interface Installed {
  readonly emit: Listener;
  readonly invalidate: ReturnType<typeof vi.fn>;
  /** Runs what the rule deferred, as the next macrotask would. */
  readonly flush: () => void;
  readonly unsubscribed: () => boolean;
  readonly unsubscribe: () => void;
}

function install(cache: { clear(): void; resetQueries(): Promise<void> }): Installed {
  const auth = stubAuth();
  const invalidate = vi.fn(() => Promise.resolve());
  const queued: (() => void)[] = [];
  const defer: Defer = (task) => {
    queued.push(task);
  };
  const unsubscribe = resetOnSessionChange(() => auth.source, { cache, router: { invalidate } }, defer);

  return {
    emit: auth.emit,
    invalidate,
    flush: () => {
      for (const task of queued.splice(0)) task();
    },
    unsubscribed: auth.unsubscribed,
    unsubscribe,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a session change resets every cached answer and re-runs the guards', () => {
  it('a mounted screen stops showing the previous user when another signs in over them', async () => {
    const screen = await mountScreen('member-a');
    const rule = install(screen.client);

    try {
      rule.emit('INITIAL_SESSION', sessionOf('member-a'));
      screen.signedIn = 'member-b';
      rule.emit('SIGNED_IN', sessionOf('member-b'));

      // AT ONCE, not after a refetch: the observer is told, and the previous
      // user's answer is gone from what the screen reads.
      expect(
        screen.observer.getCurrentResult().data,
        'the mounted screen still shows the previous user — the cache was cleared without telling it',
      ).not.toBe('calendar of member-a');

      // And the screen reads again, as the new user.
      await vi.waitFor(() => {
        expect(screen.observer.getCurrentResult().data).toBe('calendar of member-b');
      });
    } finally {
      screen.stop();
    }
  });

  it('re-runs every route guard for the new user, after the current task', async () => {
    const screen = await mountScreen('member-a');
    const rule = install(screen.client);

    try {
      rule.emit('INITIAL_SESSION', sessionOf('member-a'));
      rule.emit('SIGNED_IN', sessionOf('member-b'));

      expect(rule.invalidate, 'the router was invalidated inside the auth event').not.toHaveBeenCalled();
      rule.flush();
      expect(rule.invalidate, 'the guards never re-ran for the new user').toHaveBeenCalledTimes(1);
    } finally {
      screen.stop();
    }
  });

  it('on a sign-out empties the cache and re-runs the guards, which send the tab to sign in', async () => {
    const screen = await mountScreen('member-a');
    const rule = install(screen.client);

    try {
      rule.emit('INITIAL_SESSION', sessionOf('member-a'));
      rule.emit('SIGNED_OUT', null);

      expect(
        screen.client.getQueryCache().getAll(),
        'a sign-out left the previous session in the cache',
      ).toEqual([]);
      rule.flush();
      expect(rule.invalidate, 'nothing re-ran `_app`\'s session guard').toHaveBeenCalledTimes(1);
      // Not refetched as nobody: the screen is on its way out, and a refetch
      // would flash a skeleton and a refusal first.
      expect(screen.reads()).toBe(1);
    } finally {
      screen.stop();
    }
  });

  it('on a sign-in clears the cache and leaves the router to the sign-in hook', async () => {
    // `SIGNED_IN` fires inside `signInWithPassword`, before the hook navigates
    // to `/`. Re-running the sign-in route's guard here would race it.
    const screen = await mountScreen('nobody');
    const rule = install(screen.client);

    try {
      rule.emit('INITIAL_SESSION', null);
      rule.emit('SIGNED_IN', sessionOf('member-a'));
      rule.flush();

      expect(screen.client.getQueryCache().getAll()).toEqual([]);
      expect(rule.invalidate, 'a sign-in re-ran the guards under the sign-in hook').not.toHaveBeenCalled();
      expect(screen.reads(), 'a sign-in refetched the sign-in screen under the person typing').toBe(1);
    } finally {
      screen.stop();
    }
  });

  it('keeps the cache and the routes on a token refresh for the same user', async () => {
    const screen = await mountScreen('member-a');
    const rule = install(screen.client);

    try {
      rule.emit('INITIAL_SESSION', sessionOf('member-a', 'first'));
      rule.emit('TOKEN_REFRESHED', sessionOf('member-a', 'second'));
      // The client re-announces the same user when a tab regains focus.
      rule.emit('SIGNED_IN', sessionOf('member-a', 'second'));
      rule.flush();

      expect(screen.observer.getCurrentResult().data).toBe('calendar of member-a');
      expect(screen.reads(), 'a token refresh for the same user refetched the screen').toBe(1);
      expect(rule.invalidate, 'a token refresh re-ran the guards').not.toHaveBeenCalled();
    } finally {
      screen.stop();
    }
  });

  it('only records the first event, so the page load does not refetch what a guard warmed', async () => {
    const screen = await mountScreen('member-a');
    const rule = install(screen.client);

    try {
      rule.emit('INITIAL_SESSION', sessionOf('member-a'));
      rule.flush();

      expect(screen.observer.getCurrentResult().data).toBe('calendar of member-a');
      expect(screen.reads()).toBe(1);
      expect(rule.invalidate).not.toHaveBeenCalled();
    } finally {
      screen.stop();
    }
  });

  it('does nothing more for a sign-out that is announced twice', () => {
    const clear = vi.fn();
    const rule = install({ clear, resetQueries: () => Promise.resolve() });

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    rule.emit('SIGNED_OUT', null);
    rule.emit('SIGNED_OUT', null);
    rule.flush();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(rule.invalidate).toHaveBeenCalledTimes(1);
  });

  it('defers to the next macrotask by default', () => {
    vi.useFakeTimers();
    const auth = stubAuth();
    const invalidate = vi.fn(() => Promise.resolve());

    resetOnSessionChange(() => auth.source, {
      cache: { clear: () => undefined, resetQueries: () => Promise.resolve() },
      router: { invalidate },
    });
    auth.emit('INITIAL_SESSION', sessionOf('member-a'));
    auth.emit('SIGNED_OUT', null);

    expect(invalidate).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('logs a router invalidation that rejects rather than leaving it unhandled', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const auth = stubAuth();
    const failure = new Error('navigation failed');

    try {
      resetOnSessionChange(
        () => auth.source,
        {
          cache: { clear: () => undefined, resetQueries: () => Promise.resolve() },
          router: { invalidate: () => Promise.reject(failure) },
        },
        (task) => {
          task();
        },
      );
      auth.emit('INITIAL_SESSION', sessionOf('member-a'));
      auth.emit('SIGNED_OUT', null);

      await vi.waitFor(() => {
        expect(logged).toHaveBeenCalledWith(SESSION_UNRESOLVED, failure);
      });
    } finally {
      logged.mockRestore();
    }
  });

  it('returns the unsubscribe', () => {
    const rule = install({ clear: () => undefined, resetQueries: () => Promise.resolve() });

    rule.unsubscribe();

    expect(rule.unsubscribed(), 'the returned function does not end the subscription').toBe(true);
  });

  it('logs and carries on when the client cannot be built', () => {
    // `supabaseClient()` throws on a build with no environment; `main.tsx`
    // installs this at boot and holds no `catch`, so an escaping throw would
    // stop the application from mounting at all.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const stop = resetOnSessionChange(
        () => {
          throw new Error('SUPABASE_ENVIRONMENT_MISSING');
        },
        {
          cache: { clear: vi.fn(), resetQueries: () => Promise.resolve() },
          router: { invalidate: () => Promise.resolve() },
        },
      );

      expect(stop).toBeTypeOf('function');
      expect(() => stop()).not.toThrow();
      expect(logged).toHaveBeenCalledWith(SESSION_UNRESOLVED, expect.anything());
    } finally {
      logged.mockRestore();
    }
  });
});
