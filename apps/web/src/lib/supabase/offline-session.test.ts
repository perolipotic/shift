import { AuthApiError, AuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SESSION_UNREADABLE } from '@/lib/supabase/client';
import {
  SESSION_KNOWN,
  SESSION_NONE,
  SESSION_UNRESOLVED_STATE,
  TOKEN_EXPIRY_MARGIN_MS,
  restoreForBoot,
  sessionStateForReads,
  accessTokenExpired,
  offlineStoredUser,
  sessionForReads,
  storedSessionOf,
  type LiveSessionSource,
  type StoredSessionStore,
} from '@/lib/supabase/offline-session';

/**
 * Story 8.2's session for offline reading (human decision 2026-10-20 a),
 * executed with stub auth clients and no browser (AD-15). auth-js 2.113.0's
 * `__loadSession` answers `session: null` with a retryable error when an
 * expired token cannot be refreshed, and keeps the session in storage: offline,
 * that is the stored session's user, never a sign-out.
 */

const NOW = Date.parse('2026-10-20T10:00:00Z');
const KEY = 'sb-127-auth-token';

/** A stored session whose access token expires at `expiresAt` (epoch ms). */
function sessionOf(user: string, expiresAt: number): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_at: Math.floor(expiresAt / 1000),
    user: { id: user },
  } as unknown as Session;
}

const EXPIRED = sessionOf('member-a', NOW - 60 * 60 * 1000);
const VALID = sessionOf('member-a', NOW + 60 * 60 * 1000);

function storeOf(value: string | null): StoredSessionStore {
  return { storageKey: KEY, storage: { getItem: (key) => (key === KEY ? value : null) } };
}

function liveAnswering(answer: () => Promise<{ data: { session: Session | null }; error: unknown }>) {
  const getSession = vi.fn(answer);

  return { source: { getSession } as LiveSessionSource, getSession };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the stored session, behind its seam', () => {
  it('reads the client\'s own key and answers the session with its user', async () => {
    expect(await storedSessionOf(() => storeOf(JSON.stringify(EXPIRED)))).toEqual(EXPIRED);
  });

  it('answers null for none, an unparsable value, or a session with no user id, and never rejects', async () => {
    expect(await storedSessionOf(() => storeOf(null))).toBeNull();
    expect(await storedSessionOf(() => storeOf('{not json'))).toBeNull();
    expect(await storedSessionOf(() => storeOf(JSON.stringify({ access_token: 'x' })))).toBeNull();
    expect(
      await storedSessionOf(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    ).toBeNull();
  });

  it('reads an asynchronous storage too', async () => {
    const store: StoredSessionStore = { storageKey: KEY, storage: { getItem: () => Promise.resolve(JSON.stringify(VALID)) } };

    expect(await storedSessionOf(() => store)).toEqual(VALID);
  });

  it('counts a token within auth-js\'s refresh margin as expired', () => {
    expect(accessTokenExpired(EXPIRED, NOW)).toBe(true);
    expect(accessTokenExpired(sessionOf('a', NOW + TOKEN_EXPIRY_MARGIN_MS - 1_000), NOW)).toBe(true);
    expect(accessTokenExpired(VALID, NOW)).toBe(false);
  });
});

describe('the session for reading', () => {
  it('offline, with an expired stored token, answers the stored session at once — no refresh to wait out', async () => {
    const live = liveAnswering(() => new Promise(() => undefined));
    const read = sessionForReads({
      live: () => live.source,
      stored: () => storeOf(JSON.stringify(EXPIRED)),
      online: () => false,
      now: () => NOW,
    });

    expect((await read())?.user.id).toBe('member-a');
    expect(live.getSession).not.toHaveBeenCalled();
  });

  it('offline, a retryable failure is unresolved: the stored session\'s user', async () => {
    const live = liveAnswering(() =>
      Promise.resolve({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }),
    );
    const read = sessionForReads({
      live: () => live.source,
      stored: () => storeOf(JSON.stringify(VALID)),
      online: () => false,
      now: () => NOW,
    });

    expect((await read())?.user.id).toBe('member-a');
  });

  it('offline, a read that rejects (the time budget) is unresolved too', async () => {
    const live = liveAnswering(() => Promise.reject(new Error('READ_TIMED_OUT')));
    const read = sessionForReads({
      live: () => live.source,
      stored: () => storeOf(JSON.stringify(VALID)),
      online: () => false,
      now: () => NOW,
    });

    expect((await read())?.user.id).toBe('member-a');
  });

  it('offline, a CONFIRMED nobody stays nobody', async () => {
    const live = liveAnswering(() => Promise.resolve({ data: { session: null }, error: null }));
    const read = sessionForReads({
      live: () => live.source,
      stored: () => storeOf(null),
      online: () => false,
      now: () => NOW,
    });

    expect(await read()).toBeNull();
  });

  it('offline, a non-retryable failure is not unresolved: nobody, logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const refused = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
    const live = liveAnswering(() => Promise.resolve({ data: { session: null }, error: refused }));
    const read = sessionForReads({
      live: () => live.source,
      stored: () => storeOf(JSON.stringify(VALID)),
      online: () => false,
      now: () => NOW,
    });

    expect(await read()).toBeNull();
    expect(logged).toHaveBeenCalledWith(SESSION_UNREADABLE, refused);
  });

  it('online, the refresh decides: a retryable failure or a time-out is unresolved, so the guard fails closed', async () => {
    const stored = () => storeOf(JSON.stringify(EXPIRED));
    const retryableError = new AuthRetryableFetchError('Failed to fetch', 0);
    const retryable = liveAnswering(() => Promise.resolve({ data: { session: null }, error: retryableError }));

    await expect(
      sessionForReads({ live: () => retryable.source, stored, online: () => true, now: () => NOW })(),
    ).rejects.toBe(retryableError);
    expect(retryable.getSession).toHaveBeenCalledTimes(1);

    const rejecting = liveAnswering(() => Promise.reject(new Error('READ_TIMED_OUT')));

    await expect(
      sessionForReads({ live: () => rejecting.source, stored, online: () => true, now: () => NOW })(),
    ).rejects.toThrow('READ_TIMED_OUT');
  });

  it('a live session is the session, online or not', async () => {
    const live = liveAnswering(() => Promise.resolve({ data: { session: VALID }, error: null }));

    for (const online of [true, false]) {
      const read = sessionForReads({ live: () => live.source, stored: () => storeOf(null), online: () => online, now: () => NOW });

      expect(await read()).toBe(VALID);
    }
  });
});

describe('the stored user for a null first event', () => {
  it('is the stored user offline, and nobody online', async () => {
    const stored = () => storeOf(JSON.stringify(EXPIRED));

    expect(await offlineStoredUser({ stored, online: () => false })()).toBe('member-a');
    expect(await offlineStoredUser({ stored, online: () => true })()).toBeNull();
    expect(await offlineStoredUser({ stored: () => storeOf(null), online: () => false })()).toBeNull();
  });
});

describe('the boot: only a confirmed nobody deletes the copy', () => {
  const sourcesOf = (getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>, online: boolean) => ({
    live: () => ({ getSession }) as LiveSessionSource,
    stored: () => storeOf(JSON.stringify(VALID)),
    online: () => online,
    now: () => NOW,
  });

  it('restores for a known session, deletes for a confirmed nobody, and does neither when unresolved', async () => {
    const restore = vi.fn((_user: string | null) => Promise.resolve());
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await restoreForBoot(sessionStateForReads(sourcesOf(() => Promise.resolve({ data: { session: VALID }, error: null }), true)), restore);
    expect(restore).toHaveBeenLastCalledWith('member-a');

    await restoreForBoot(sessionStateForReads(sourcesOf(() => Promise.resolve({ data: { session: null }, error: null }), true)), restore);
    expect(restore).toHaveBeenLastCalledWith(null);

    restore.mockClear();
    const retryable = () =>
      Promise.resolve({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });

    await restoreForBoot(sessionStateForReads(sourcesOf(retryable, true)), restore);
    expect(restore, 'an unresolved read restored or deleted').not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
  });

  it('answers within its budget: an online cold start waiting on a refresh renders without restoring', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const restore = vi.fn((_user: string | null) => Promise.resolve());
    const started = Date.now();
    const read = sessionStateForReads(sourcesOf(() => new Promise(() => undefined), true), 20);

    expect((await read()).kind).toBe(SESSION_UNRESOLVED_STATE);
    expect(Date.now() - started).toBeLessThan(1_000);

    await restoreForBoot(read, restore);
    expect(restore).not.toHaveBeenCalled();
  });

  it('offline, a time-out is the stored session, or nobody when nothing is stored', async () => {
    const hang = () => new Promise<never>(() => undefined);

    expect((await sessionStateForReads(sourcesOf(hang, false), 20)()).kind).toBe(SESSION_KNOWN);
    expect(
      (
        await sessionStateForReads({ ...sourcesOf(hang, false), stored: () => storeOf(null) }, 20)()
      ).kind,
    ).toBe(SESSION_NONE);
  });
});
