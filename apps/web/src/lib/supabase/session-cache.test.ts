import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_UNRESOLVED } from '@/lib/supabase/client';
import {
  resetOnSessionChange,
  sessionEndMark,
  type AuthEventSource,
  type Defer,
  type KeptSnapshot,
  type SessionEndMark,
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

/** The device's kept copy (story 8.2), as a log of what the rule asked of it. */
interface StubDevice extends KeptSnapshot {
  readonly calls: string[];
}

function keptSnapshot(restored: string | null = null, calls: string[] = []): StubDevice {
  let owner = restored;

  return {
    calls,
    owner: () => owner,
    persistFor: (userId) => {
      owner = userId;
      calls.push(`persist ${userId}`);
    },
    forget: () => {
      owner = null;
      calls.push('forget');

      return Promise.resolve();
    },
  };
}

interface Installed {
  readonly emit: Listener;
  readonly device: StubDevice;
  readonly ended: SessionEndMark;
  readonly invalidate: ReturnType<typeof vi.fn>;
  /** Runs what the rule deferred, as the next macrotask would. */
  readonly flush: () => void;
  readonly unsubscribed: () => boolean;
  readonly unsubscribe: () => void;
}

/** No stored session: online, or none on the device. */
const NOBODY_STORED = (): Promise<string | null> => Promise.resolve(null);

function install(
  cache: { clear(): void; resetQueries(): Promise<void> },
  device: StubDevice = keptSnapshot(),
  offlineUser: () => Promise<string | null> = NOBODY_STORED,
): Installed {
  const auth = stubAuth();
  const invalidate = vi.fn(() => Promise.resolve());
  const queued: (() => void)[] = [];
  const defer: Defer = (task) => {
    queued.push(task);
  };
  const ended = sessionEndMark();
  const unsubscribe = resetOnSessionChange(
    () => auth.source,
    { cache, router: { invalidate }, ended, device, offlineUser },
    defer,
  );

  return {
    emit: auth.emit,
    device,
    ended,
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
      // The guards ran for the restored user: they run again, with no deep link.
      expect(rule.invalidate).not.toHaveBeenCalled();
      rule.flush();
      expect(rule.invalidate).toHaveBeenCalledTimes(1);
      expect(rule.ended.take()).toBe(true);
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
      ended: sessionEndMark(),
      device: keptSnapshot(),
      offlineUser: NOBODY_STORED,
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
          ended: sessionEndMark(),
          device: keptSnapshot(),
          offlineUser: NOBODY_STORED,
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
          ended: sessionEndMark(),
          device: keptSnapshot(),
          offlineUser: NOBODY_STORED,
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

describe('a re-guard raised by a session change forgets the deep link (C516)', () => {
  const NOTHING = { clear: () => undefined, resetQueries: () => Promise.resolve() };

  it('marks a sign-out or an expiry elsewhere before the re-guard runs', () => {
    const rule = install(NOTHING);
    let markedWhenGuarded: boolean | undefined;

    rule.invalidate.mockImplementation(() => {
      markedWhenGuarded = rule.ended.take();

      return Promise.resolve();
    });
    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    rule.emit('SIGNED_OUT', null);
    rule.flush();

    expect(markedWhenGuarded, 'the guard the re-guard ran could not tell').toBe(true);
  });

  it('marks another account taking the tab over', () => {
    const rule = install(NOTHING);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    rule.emit('SIGNED_IN', sessionOf('member-b'));

    expect(rule.ended.take()).toBe(true);
  });

  it('leaves a token refresh, the first event and a re-announced user unmarked', () => {
    const rule = install(NOTHING);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    rule.emit('TOKEN_REFRESHED', sessionOf('member-a'));
    rule.emit('SIGNED_IN', sessionOf('member-a'));

    expect(rule.ended.take()).toBe(false);
  });

  it('clears the mark on a sign-in, so a later bounce in the tab keeps its target', () => {
    const rule = install(NOTHING);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    rule.emit('SIGNED_OUT', null);
    rule.emit('SIGNED_IN', sessionOf('member-b'));

    expect(rule.ended.take()).toBe(false);
  });

  it('is taken once: one change drops one target', () => {
    const mark = sessionEndMark();

    mark.mark();

    expect(mark.take()).toBe(true);
    expect(mark.take()).toBe(false);
  });
});

describe('the device\'s kept copy follows the user (story 8.2)', () => {
  /** A cache that logs into the device's log, so the order is one list. */
  function loggingCache(calls: string[]) {
    return {
      clear: () => {
        calls.push('clear');
      },
      resetQueries: () => {
        calls.push('reset');

        return Promise.resolve();
      },
    };
  }

  it('deletes the copy on a sign-out, BEFORE the cache is cleared, and keeps nothing after', () => {
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    device.calls.length = 0;
    rule.emit('SIGNED_OUT', null);

    expect(device.calls).toEqual(['forget', 'clear']);
    expect(device.owner()).toBeNull();
  });

  it('deletes the previous user\'s copy when another takes the tab over, then keeps it for them', () => {
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    device.calls.length = 0;
    rule.emit('SIGNED_IN', sessionOf('member-b'));

    expect(device.calls).toEqual(['forget', 'reset', 'persist member-b']);
    expect(device.owner()).toBe('member-b');
  });

  it('keeps the cache for whoever signs in, with nothing to delete', () => {
    const device = keptSnapshot();
    const rule = install(loggingCache(device.calls), device);

    rule.emit('INITIAL_SESSION', null);
    rule.emit('SIGNED_IN', sessionOf('member-a'));

    expect(device.calls).toEqual(['clear', 'persist member-a']);
  });

  it('changes nothing on a token refresh or a re-announced user', () => {
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));
    device.calls.length = 0;
    rule.emit('TOKEN_REFRESHED', sessionOf('member-a'));
    rule.emit('SIGNED_IN', sessionOf('member-a'));

    expect(device.calls).toEqual([]);
  });

  it('keeps what main.tsx restored when the first event names the same user', () => {
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device);

    rule.emit('INITIAL_SESSION', sessionOf('member-a'));

    expect(device.calls).toEqual(['persist member-a']);
  });

  it('drops a copy restored for somebody else, and a mounted screen stops showing it', async () => {
    // The session changed between `main.tsx`'s restore and the first event.
    const screen = await mountScreen('member-a');
    const device = keptSnapshot('member-a');
    const rule = install(screen.client, device);

    try {
      screen.signedIn = 'member-b';
      rule.emit('INITIAL_SESSION', sessionOf('member-b'));

      expect(device.calls).toEqual(['forget', 'persist member-b']);
      expect(screen.observer.getCurrentResult().data, 'the restored user\'s answer is still drawn').not.toBe(
        'calendar of member-a',
      );
      await vi.waitFor(() => {
        expect(screen.observer.getCurrentResult().data).toBe('calendar of member-b');
      });
    } finally {
      screen.stop();
    }
  });

  it('drops a copy restored for a session that is gone by the first event', async () => {
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device);

    rule.emit('INITIAL_SESSION', null);

    await vi.waitFor(() => {
      expect(device.calls).toEqual(['forget', 'clear']);
    });
    expect(device.owner()).toBeNull();
    // The tab is on a destination the restored user opened: the guards run again.
    rule.flush();
    expect(rule.invalidate).toHaveBeenCalledTimes(1);
    expect(rule.ended.take()).toBe(true);
  });

  it('offline with an expired token, a null first event over the stored user keeps the copy and the cache', async () => {
    // auth-js announces INITIAL_SESSION as `null` when the refresh fails
    // retryably, and keeps the session in storage (human decision 2026-10-20 a).
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device, () => Promise.resolve('member-a'));

    rule.emit('INITIAL_SESSION', null);
    await new Promise((done) => setTimeout(done, 5));

    expect(device.calls, 'an unresolved session was read as a sign-out').toEqual([]);
    expect(device.owner()).toBe('member-a');

    // On reconnect the refresh lands for the same user: nothing changes.
    rule.emit('TOKEN_REFRESHED', sessionOf('member-a'));
    rule.flush();
    expect(device.calls).toEqual([]);
    expect(rule.invalidate).not.toHaveBeenCalled();

    // A refresh that fails for good signs out: the copy goes, as always.
    rule.emit('SIGNED_OUT', null);
    expect(device.calls).toEqual(['forget', 'clear']);
  });

  it('a real sign-out arriving before the stored-user check answers wins', async () => {
    const device = keptSnapshot('member-a');
    let answer: (user: string | null) => void = () => undefined;
    const rule = install(
      loggingCache(device.calls),
      device,
      () =>
        new Promise((done) => {
          answer = done;
        }),
    );

    rule.emit('INITIAL_SESSION', null);
    rule.emit('SIGNED_OUT', null);
    expect(device.calls).toEqual(['forget', 'clear']);
    answer('member-a');
    await new Promise((done) => setTimeout(done, 5));

    expect(device.calls, 'the late check acted again').toEqual(['forget', 'clear']);
  });

  it('a stored user who is somebody else keeps nothing of the restored one', async () => {
    const device = keptSnapshot('member-a');
    const rule = install(loggingCache(device.calls), device, () => Promise.resolve('member-b'));

    rule.emit('INITIAL_SESSION', null);

    await vi.waitFor(() => {
      expect(device.calls).toEqual(['forget', 'clear']);
    });
    rule.flush();
    expect(rule.invalidate).toHaveBeenCalledTimes(1);
    expect(rule.ended.take()).toBe(true);
  });
});
