import { describe, expect, it, vi } from 'vitest';

import {
  FRESHNESS_FRESH,
  FRESHNESS_LOADING,
  FRESHNESS_OFFLINE,
  FRESHNESS_UNAVAILABLE,
  freshnessTracker,
  snapshotAnswerOf,
  snapshotFreshnessOf,
  type OnlineSource,
  type ReadAnswer,
} from '@/lib/offline/freshness';

/**
 * Story 8.2's freshness rule, executed with no browser (AD-15): every row of
 * the spec's matrix as the surface's state, each read as the derivations see
 * it, and the clock that moves `freshAfter` on a reconnect.
 */

const STARTED = 1_000;
const BEFORE = 500;
const AFTER = 1_500;

/** A settled read that landed at `at`. */
function read(at: number, data: unknown = { rows: at }): ReadAnswer<unknown> {
  return { data, dataUpdatedAt: at, isError: false, isPending: false, fetchStatus: 'idle' };
}

/** A first read still in flight. */
const PENDING: ReadAnswer<unknown> = { data: undefined, dataUpdatedAt: 0, isError: false, isPending: true, fetchStatus: 'fetching' };
/** A first read paused offline. */
const PAUSED_EMPTY: ReadAnswer<unknown> = { ...PENDING, fetchStatus: 'paused' };

describe('a surface decides from all of its reads together', () => {
  it('online, fresh: every read landed this session — the surface renders, with no note', () => {
    expect(snapshotFreshnessOf([read(AFTER), read(AFTER + 1)], STARTED, true)).toEqual({ kind: FRESHNESS_FRESH });
  });

  it('online, restored: any read older than freshAfter is the skeleton, never the old data', () => {
    expect(snapshotFreshnessOf([read(AFTER), read(BEFORE)], STARTED, true)).toEqual({ kind: FRESHNESS_LOADING });
    // A first read in flight has time 0: older too.
    expect(snapshotFreshnessOf([read(AFTER), PENDING], STARTED, true)).toEqual({ kind: FRESHNESS_LOADING });
  });

  it('online, restored, the refetch failed: the existing unavailable state', () => {
    const failed = { ...read(BEFORE), isError: true };

    expect(snapshotFreshnessOf([read(AFTER), failed], STARTED, true)).toEqual({ kind: FRESHNESS_UNAVAILABLE });
    // Being read again is still loading.
    expect(snapshotFreshnessOf([{ ...failed, fetchStatus: 'fetching' }], STARTED, true)).toEqual({ kind: FRESHNESS_LOADING });
  });

  it('offline, whole: the whole snapshot, as of the OLDEST read', () => {
    expect(snapshotFreshnessOf([read(AFTER), read(BEFORE), read(STARTED)], STARTED, false)).toEqual({
      kind: FRESHNESS_OFFLINE,
      asOf: BEFORE,
    });
  });

  it('offline, partial: any read with no data is unavailable — no note, no figure beside a missing one', () => {
    expect(snapshotFreshnessOf([read(AFTER), PAUSED_EMPTY], STARTED, false)).toEqual({ kind: FRESHNESS_UNAVAILABLE });
    expect(snapshotFreshnessOf([], STARTED, false)).toEqual({ kind: FRESHNESS_UNAVAILABLE });
  });

  it('offline, a refetch that failed over old data: unavailable, never the old data under a note', () => {
    const failed = { ...read(BEFORE), isError: true };

    expect(snapshotFreshnessOf([failed, read(AFTER)], STARTED, false)).toEqual({ kind: FRESHNESS_UNAVAILABLE });
    // A failed read being read again is not a settled failure — but offline nothing is read again.
    expect(snapshotFreshnessOf([read(BEFORE), read(AFTER)], STARTED, false).kind).toBe(FRESHNESS_OFFLINE);
  });

  it('reconnect, whole: the cached snapshot stays under its note until every read is newer, then fresh all at once', () => {
    const reconnected = AFTER + 100;
    const cached = [read(AFTER), read(AFTER + 10)];

    // No skeleton: the whole cached snapshot, as of its oldest read.
    expect(snapshotFreshnessOf(cached, reconnected, true, true)).toEqual({ kind: FRESHNESS_OFFLINE, asOf: AFTER });
    // One read in, the other not yet: still the cached snapshot, never mixed.
    expect(snapshotFreshnessOf([read(reconnected + 5), read(AFTER + 10)], reconnected, true, true)).toEqual({
      kind: FRESHNESS_OFFLINE,
      asOf: AFTER + 10,
    });
    // A refetch in flight over the cached data changes nothing.
    expect(
      snapshotFreshnessOf([{ ...read(AFTER), fetchStatus: 'fetching' }, read(AFTER + 10)], reconnected, true, true).kind,
    ).toBe(FRESHNESS_OFFLINE);
    expect(snapshotFreshnessOf([read(reconnected + 5), read(reconnected)], reconnected, true, true)).toEqual({
      kind: FRESHNESS_FRESH,
    });
  });

  it('reconnect, partial: any read with no data is the skeleton', () => {
    const reconnected = AFTER + 100;

    expect(snapshotFreshnessOf([read(AFTER), PENDING], reconnected, true, true)).toEqual({ kind: FRESHNESS_LOADING });
  });

  it('reconnect, the refetch failed: the existing unavailable state, not the cached snapshot', () => {
    const reconnected = AFTER + 100;
    const failed = { ...read(AFTER), isError: true };

    expect(snapshotFreshnessOf([failed, read(AFTER + 10)], reconnected, true, true)).toEqual({ kind: FRESHNESS_UNAVAILABLE });
  });

  it('app start: a restored cache is the skeleton however whole it is — only a reconnect keeps it drawn', () => {
    expect(snapshotFreshnessOf([read(BEFORE), read(BEFORE + 1)], STARTED, true, false)).toEqual({ kind: FRESHNESS_LOADING });
    expect(snapshotFreshnessOf([read(BEFORE), read(BEFORE + 1)], STARTED, true)).toEqual({ kind: FRESHNESS_LOADING });
  });
});

describe('each read is shown to the derivations as the surface decided', () => {
  const online = { online: true, freshAfter: STARTED };
  const offline = { online: false, freshAfter: STARTED };

  it('reconnected, whole: a refetch in flight over cached data is settled too, so nothing pulses or closes', () => {
    const refetching = { ...read(BEFORE), fetchStatus: 'fetching' };
    const shown = snapshotAnswerOf(
      refetching,
      { kind: FRESHNESS_OFFLINE, asOf: BEFORE },
      { online: true, freshAfter: AFTER, reconnected: true },
    );

    expect(shown).toEqual({ data: refetching.data, dataUpdatedAt: BEFORE, isError: false, isPending: false, fetchStatus: 'idle' });
  });

  it('offline, whole: a paused refetch over cached data is settled, its data kept', () => {
    const paused = { ...read(BEFORE), fetchStatus: 'paused' };
    const shown = snapshotAnswerOf(paused, { kind: FRESHNESS_OFFLINE, asOf: BEFORE }, offline);

    expect(shown).toEqual({ data: paused.data, dataUpdatedAt: BEFORE, isError: false, isPending: false, fetchStatus: 'idle' });
  });

  it('offline, not whole: every read is failed with no data, even one that has data', () => {
    const shown = snapshotAnswerOf(read(BEFORE), { kind: FRESHNESS_UNAVAILABLE }, offline);

    expect(shown.data).toBeUndefined();
    expect(shown.isError).toBe(true);
    expect(shown.isPending).toBe(false);
  });

  it('online and loading (app start, or a reconnect with a read missing): an old read is pending with no data, never its old figure', () => {
    const shown = snapshotAnswerOf(read(BEFORE), { kind: FRESHNESS_LOADING }, online);

    expect(shown).toEqual({ data: undefined, dataUpdatedAt: BEFORE, isError: false, isPending: true, fetchStatus: 'fetching' });
  });

  it('online: a fresh read, a failed one and a first read in flight are left as they are', () => {
    const fresh = read(AFTER);
    const failed = { ...read(BEFORE), isError: true };

    expect(snapshotAnswerOf(fresh, { kind: FRESHNESS_LOADING }, online)).toBe(fresh);
    expect(snapshotAnswerOf(failed, { kind: FRESHNESS_UNAVAILABLE }, online)).toBe(failed);
    expect(snapshotAnswerOf(PENDING, { kind: FRESHNESS_LOADING }, online)).toBe(PENDING);
  });
});

/** An online source a test switches by hand, as `onlineManager` is by the browser's events. */
function switchable(initial: boolean): OnlineSource & { set(online: boolean): void } {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();

  return {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    set: (next) => {
      online = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe('the clock moves freshAfter on every offline→online transition', () => {
  it('starts at the app start, and moves — marked as a reconnect\'s — only when the connection comes back', () => {
    const source = switchable(true);
    let now = STARTED;
    const tracker = freshnessTracker(source, () => now);
    const reconnected = vi.fn();
    const changed = vi.fn();

    tracker.subscribe(changed);
    const stop = tracker.start(reconnected);

    expect(tracker.current()).toEqual({ online: true, freshAfter: STARTED, reconnected: false });

    now = 2_000;
    source.set(false);
    expect(tracker.current()).toEqual({ online: false, freshAfter: STARTED, reconnected: false });
    expect(reconnected).not.toHaveBeenCalled();

    now = 3_000;
    source.set(true);
    // Marked as a reconnect's, so a whole cached snapshot stays drawn.
    expect(tracker.current()).toEqual({ online: true, freshAfter: 3_000, reconnected: true });
    expect(reconnected).toHaveBeenCalledWith(3_000);
    expect(changed).toHaveBeenCalledTimes(2);

    // The same state announced again changes nothing.
    source.set(true);
    expect(changed).toHaveBeenCalledTimes(2);

    // Dropping again keeps the reconnect's mark: the cached snapshot is offline anyway.
    now = 4_000;
    source.set(false);
    expect(tracker.current()).toEqual({ online: false, freshAfter: 3_000, reconnected: true });
    source.set(true);
    expect(tracker.current()).toEqual({ online: true, freshAfter: 4_000, reconnected: true });

    stop();
    source.set(false);
    expect(tracker.current().online, 'the clock still follows after its stop').toBe(true);
  });

  it('reads the source again at the start, so a seeded offline start is offline', () => {
    const source = switchable(true);
    const tracker = freshnessTracker(source, () => STARTED);

    // `main.tsx` seeds `onlineManager` from `navigator.onLine` after import.
    source.set(false);
    tracker.start();

    expect(tracker.current()).toEqual({ online: false, freshAfter: STARTED, reconnected: false });
  });

  it('starts once: a second start follows nothing twice and hands back the same stop', () => {
    const source = switchable(true);
    let now = STARTED;
    const tracker = freshnessTracker(source, () => now);
    const first = vi.fn();
    const second = vi.fn();
    const changed = vi.fn();

    tracker.subscribe(changed);
    const stop = tracker.start(first);

    expect(tracker.start(second)).toBe(stop);
    source.set(false);
    now = 2_000;
    source.set(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(2);

    stop();
    expect(tracker.start(second), 'a stopped tracker could not start again').not.toBe(stop);
  });

  it('returns the same clock until it changes, as useSyncExternalStore needs', () => {
    const source = switchable(true);
    const tracker = freshnessTracker(source, () => STARTED);

    tracker.start();

    expect(tracker.current()).toBe(tracker.current());
  });
});
