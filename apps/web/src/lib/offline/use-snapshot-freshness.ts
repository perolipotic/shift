import { hashKey, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';

import { appFreshness } from '@/lib/offline/app-freshness';
import {
  snapshotAnswerOf,
  snapshotFreshnessOf,
  type FreshnessClock,
  type ReadAnswer,
  type SnapshotFreshness,
  type SnapshotRead,
} from '@/lib/offline/freshness';

/** A surface's freshness, and the way its derivations see each read under it. */
export interface SurfaceFreshness {
  readonly freshness: SnapshotFreshness;
  readonly clock: FreshnessClock;
  /** One read OF THE SURFACE as its derivations should see it (`snapshotAnswerOf`). */
  readonly answerOf: <Data>(answer: ReadAnswer<Data>) => ReadAnswer<Data>;
  /**
   * The read under `key` as the derivations should see it: through
   * {@link SurfaceFreshness.answerOf} when the key is one of the surface's,
   * and RAW otherwise — a read the surface's freshness did not decide over is
   * never reshaped by it.
   */
  readonly answerFor: <Data>(key: QueryKey, answer: ReadAnswer<Data>) => ReadAnswer<Data>;
}

/** One observed read: its key and the observer's result. */
export type ObservedRead = readonly [QueryKey, SnapshotRead];

/** The read under `key` as the cache holds it now; a query never created has no data and time 0. */
function cachedReadOf(client: QueryClient, key: QueryKey): SnapshotRead {
  const state = client.getQueryState(key);

  return {
    data: state?.data,
    dataUpdatedAt: state?.dataUpdatedAt ?? 0,
    isError: state?.status === 'error',
    fetchStatus: state?.fetchStatus ?? 'idle',
  };
}

/** The parts of a cached read freshness looks at, as one text. */
function cachedSignatureOf(client: QueryClient, keys: readonly QueryKey[]): string {
  return keys
    .map((key) => {
      const read = cachedReadOf(client, key);

      return `${String(read.dataUpdatedAt)}:${String(read.data !== undefined)}:${String(read.isError)}:${read.fetchStatus}`;
    })
    .join('|');
}

/** No clock on a server: nothing is offline there. */
const SERVER_CLOCK: FreshnessClock = { online: true, freshAfter: 0, reconnected: false };

/**
 * The freshness of a surface that reads `keys` (story 8.2), WIRING ONLY: the
 * rule is `snapshotFreshnessOf`'s, re-derived on every render.
 *
 * ONE SOURCE PER READ, THE SAME ONE THE DERIVATIONS USE. A read this hook
 * observes is decided from its OBSERVER RESULT (`observed`) — the very answer
 * `answerOf` then reshapes — so the decision and the derivations cannot
 * disagree within a render. A key the surface reads through ANOTHER hook of
 * the same screen (*Danas*'s admin body and its header each observe some of
 * the other's) is decided from the cache's entry, and this hook re-renders
 * when that entry or the clock changes.
 */
export function useSnapshotFreshness(
  keys: readonly QueryKey[],
  observed: readonly ObservedRead[] = [],
): SurfaceFreshness {
  const client = useQueryClient();
  const clock = useSyncExternalStore(appFreshness.subscribe, appFreshness.current, () => SERVER_CLOCK);
  const byHash = new Map(observed.map(([key, read]) => [hashKey(key), read]));
  const unobserved = keys.filter((key) => !byHash.has(hashKey(key)));
  const [cacheStore] = useState(() => ({
    subscribe: (onChange: () => void) => client.getQueryCache().subscribe(onChange),
  }));

  // Re-renders when a read observed elsewhere changes; its value is the cache's.
  useSyncExternalStore(
    cacheStore.subscribe,
    () => cachedSignatureOf(client, unobserved),
    () => '',
  );

  const reads = keys.map((key) => byHash.get(hashKey(key)) ?? cachedReadOf(client, key));
  const freshness = snapshotFreshnessOf(reads, clock.freshAfter, clock.online, clock.reconnected);
  const surface = new Set(keys.map((key) => hashKey(key)));

  return {
    freshness,
    clock,
    answerOf: (answer) => snapshotAnswerOf(answer, freshness, clock),
    answerFor: (key, answer) => (surface.has(hashKey(key)) ? snapshotAnswerOf(answer, freshness, clock) : answer),
  };
}
