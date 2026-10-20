import { createStore, del, get, set, type UseStore } from 'idb-keyval';

import { deviceSnapshot, type PageLifecycle, type SnapshotStorage } from '@/lib/offline/persistence';
import { queryClient } from '@/lib/query-client';

/**
 * The browser binding of story 8.2's device snapshot: the page's one
 * snapshot, over the one query cache and IndexedDB. The rules are
 * `./persistence`'s, which the node suite executes with injected storage
 * (AD-15); nothing here decides anything.
 */

/** The IndexedDB database and object store the snapshot lives in. */
const DATABASE = 'shift';
const OBJECT_STORE = 'query-cache';

let store: UseStore | null = null;

/** IndexedDB, opened on first use, never at import: the node suite imports this module's dependents. */
function indexedDbStorage(): SnapshotStorage {
  store ??= createStore(DATABASE, OBJECT_STORE);
  const opened = store;

  return {
    get: (key) => get(key, opened),
    set: (key, value) => set(key, value, opened),
    del: (key) => del(key, opened),
  };
}

/** The page's device snapshot, over the one query cache. */
/** The page hidden (a phone locked, a tab switched) or left (the app swiped away). */
const pageLifecycle: PageLifecycle = {
  subscribe: (onHidden) => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') onHidden();
    };

    window.addEventListener('pagehide', onHidden);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', onHidden);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  },
};

const device = deviceSnapshot(queryClient, indexedDbStorage, { lifecycle: pageLifecycle });

/** `main.tsx`'s gated restore: the snapshot is restored only for the local session's own user. */
export const restoreForSession = device.restoreForSession;

/** Deletes the kept snapshot and stops keeping one: every sign-out path calls it. */
export const forgetDeviceSnapshot = device.forget;

/** The page's device snapshot, for `resetOnSessionChange`. */
export const pageDeviceSnapshot = device;

