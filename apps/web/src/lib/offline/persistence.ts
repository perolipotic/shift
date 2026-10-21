import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { dehydrate, hydrate, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { persistQueryClientSubscribe, type PersistedClient } from '@tanstack/react-query-persist-client';

/**
 * THE DEVICE SNAPSHOT (story 8.2): the allowlisted part of the query cache,
 * kept in IndexedDB so a surface read online can be read again with no
 * connection. What a surface may DO with a restored answer is
 * `./freshness`'s rule; this module decides only what is kept, for whom, and
 * for how long.
 *
 * WHAT IS KEPT. Only a query that SUCCEEDED, whose key is exactly one of
 * {@link PERSISTED_KEY_ROOTS}, or one of {@link PERSISTED_PARAMETERISED_KEY_ROOTS}
 * with one string id: the reads the offline-readable surfaces stand on, and
 * the chrome's role, name and account id they need around them. A longer key
 * under an allowed root is a different read and is never kept: the erasure
 * guard's fresh reads (`[...key, 'erasure-check']`) and the organization's
 * logo URL (`['organization', 'logo', path]`, a signed URL that expires). A
 * read that resolved with its own failure (`{ ok: false }`, the organization
 * and members reads) is not a snapshot either. No mutation is ever kept:
 * nothing is queued (story 8.3).
 *
 * WHOSE IT IS. The blob carries the signed-in auth user's id as TanStack's
 * `buster`, so a restore for anybody else discards it. `main.tsx` restores
 * before the first render, and only for the local session's user; no session,
 * another user and an expired blob all delete it. A save is refused unless
 * its owner is still the one being persisted for, so a write dehydrated for a
 * user who has since signed out never lands after the delete.
 *
 * FOR HOW LONG. {@link DEVICE_SNAPSHOT_MAX_AGE_MS}, 30 days, for the blob
 * and for every entry in it (by its own `dataUpdatedAt`). In memory, each
 * kept key's `gcTime` (`setQueryDefaults` in `@/lib/query-client`, per
 * persisted root) is as long as a timer can hold,
 * {@link DEVICE_SNAPSHOT_GC_TIME_MS} (about 24.8 days), so an entry restored
 * from the device, or one no screen observes right now, is not collected —
 * and so dropped from the next save — while it could still be read offline.
 *
 * GONE ON SIGN-OUT. {@link DeviceSnapshot.forget} stops saving and deletes the
 * blob. Every path that clears or resets the cache on a session change calls
 * it: `resetOnSessionChange`, the chrome's *Odjava* and the set-password
 * step's sign-out.
 *
 * The storage is injected behind {@link SnapshotStorage}, so the node suite
 * runs every rule here with no IndexedDB (AD-15); `./device-snapshot` binds
 * the browser's.
 */

/** As much of a key-value store as the snapshot needs: `idb-keyval`'s `get`/`set`/`del`. */
export interface SnapshotStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

/** The one entry the snapshot is stored under. */
export const DEVICE_SNAPSHOT_KEY = 'shift-query-cache';

/** How long a kept snapshot may be restored: 30 days. */
export const DEVICE_SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The kept keys' `gcTime` (`setQueryDefaults` per root, `@/lib/query-client`): the snapshot's
 * `maxAge`, as near as a browser timer can hold it. TanStack schedules the
 * collection with `setTimeout`, whose delay is a signed 32-bit number of
 * milliseconds (about 24.8 days); 30 days overflows it, and the browser then
 * fires the timer AT ONCE — every restored entry was collected the moment it
 * was invalidated, before any screen could observe it. So the longest delay a
 * timer holds, which no page stays open for.
 */
export const DEVICE_SNAPSHOT_GC_TIME_MS = Math.min(DEVICE_SNAPSHOT_MAX_AGE_MS, 2 ** 31 - 1);

/** How often, at most, the cache is written to the device. */
export const DEVICE_SNAPSHOT_THROTTLE_MS = 1000;

/**
 * The query keys that are kept, each a one-segment key written as the
 * feature's own constant spells it (`persistence.test.ts` pins every one to
 * its constant, so they cannot drift apart):
 *
 *   - `calendar` — `CALENDAR_KEY`, the unwindowed calendar snapshot;
 *   - `my-leave-records`, `organization-leave-records` — the own and the
 *     organization's live leave;
 *   - `my-conflict-resolutions`, `organization-conflict-resolutions` — the
 *     own and the organization's live resolutions;
 *   - `members` — `MEMBERS_LIST_KEY`, *Danas*'s leave tile;
 *   - `organization` — `ORGANIZATION_SNAPSHOT_KEY`, the leave year;
 *   - `member-role`, `member-name` — the chrome's role and name;
 *   - `session-subject` — `SESSION_SUBJECT_KEY`, the caller's account id;
 *   - `leave-overview-records` — `LEAVE_OVERVIEW_RECORDS_KEY`, *Godišnji*'s
 *     admin overview (story 8.2b);
 *   - `teams`, `own-team` — `TEAMS_LIST_KEY` and `OWN_TEAM_KEY`, the member
 *     directory's team list and the caller's own team (story 8.2b);
 *   - `acting-admin-names` — `ACTING_ADMINS_KEY`, the names of whoever
 *     decided, on *Raspored*'s *Riješeni* tab (story 8.2c);
 *   - `hourBands` — `HOUR_BANDS_LIST_KEY`, *Satni pojasi* and *Organizacija*'s
 *     hour band card (story 8.2d);
 *   - `shiftTypes`, `rotation` — `SHIFT_TYPES_LIST_KEY` and `ROTATION_KEY`,
 *     *Postavke rotacije*'s shift types and rotation builder (story 8.2d).
 */
export const PERSISTED_KEY_ROOTS: readonly string[] = [
  'calendar',
  'my-leave-records',
  'organization-leave-records',
  'my-conflict-resolutions',
  'organization-conflict-resolutions',
  'members',
  'organization',
  'member-role',
  'member-name',
  'session-subject',
  'leave-overview-records',
  'teams',
  'own-team',
  'acting-admin-names',
  'hourBands',
  'shiftTypes',
  'rotation',
];

/**
 * The PARAMETERISED keys that are kept (story 8.2b), each only in the exact
 * shape `[root, id]` with a NON-EMPTY string id, as the feature's own key
 * function spells it:
 *
 *   - `team-roster` — `TEAM_ROSTER_KEY(id)`, one team's roster, read by
 *     `/smjene/$id` and by the member directory for every active team;
 *   - `leave-records` — `LEAVE_RECORDS_KEY(id)`, one member's live leave,
 *     read by the member page `/ljudi/$id` (story 8.2c).
 *
 * A longer key under one of them, or a second segment that is not a
 * non-empty string, is a different read and is never kept.
 */
export const PERSISTED_PARAMETERISED_KEY_ROOTS: readonly string[] = ['team-roster', 'leave-records'];

/**
 * The key part the erasure guard appends to a screen's key for its own fresh
 * reads (`ERASURE_CHECK_KEY_PART` in `@/features/conflicts/hooks/use-erasure-reads`;
 * `persistence.test.ts` pins the two equal). Spelled here rather than
 * imported, so this module keeps no import of a feature's hook. Never kept,
 * in any position: a check's read is a fresh read for one dialog, not a
 * surface's snapshot.
 */
export const ERASURE_CHECK_KEY_PART = 'erasure-check';

const KEPT = new Set(PERSISTED_KEY_ROOTS);
const KEPT_PARAMETERISED = new Set(PERSISTED_PARAMETERISED_KEY_ROOTS);

/** Whether an answer is a read's own failure, resolved rather than thrown (`{ ok: false }`). */
function resolvedFailure(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { ok?: unknown }).ok === false;
}

/**
 * Whether a query key is one of the kept ones: EXACTLY an allowed one-segment
 * key, or an allowed parameterised root with one string id — never a longer
 * key under either, and never a key naming the erasure check.
 */
export function persistsKey(queryKey: QueryKey): boolean {
  const [root, ...rest] = queryKey;

  if (typeof root !== 'string' || queryKey.includes(ERASURE_CHECK_KEY_PART)) return false;
  if (rest.length === 0) return KEPT.has(root);

  const [id] = rest;

  return rest.length === 1 && typeof id === 'string' && id !== '' && KEPT_PARAMETERISED.has(root);
}

/** Whether a query is kept on the device: succeeded, a kept key, and not its own failure. */
export function persistsQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  return query.state.status === 'success' && persistsKey(query.queryKey) && !resolvedFailure(query.state.data);
}

/** Thrown inside the save when its owner is no longer the one persisted for; the save is dropped. */
const SAVE_OUTLIVED_OWNER = 'SAVE_OUTLIVED_OWNER';

/** The device snapshot of one query client. */
export interface DeviceSnapshot {
  /**
   * Before the first render: restores the kept snapshot when its owner is
   * `userId`, deletes it otherwise (no session, another user, expired,
   * unreadable), and from then on keeps the cache for `userId`. Restored
   * answers are marked stale, so the first observer of each reads again.
   * Settles within {@link DEVICE_SNAPSHOT_RESTORE_BUDGET_MS} whatever the
   * store does. Never rejects: a snapshot that cannot be restored is not the
   * app's failure.
   */
  restoreForSession(userId: string | null): Promise<void>;
  /** Keeps the cache for `userId` from now on; nothing changes when it already is. */
  persistFor(userId: string): void;
  /**
   * Stops keeping the cache — at once, before it returns its promise — and
   * deletes the kept snapshot. Settles within the restore's budget; never
   * rejects.
   */
  forget(): Promise<void>;
  /** Whose cache is being kept, or `null` for nobody. */
  owner(): string | null;
}

/**
 * How long the first render waits for the restore: a hung IndexedDB (a
 * blocked upgrade, a stalled browser profile) must never hold the app.
 * Past it the app renders without the snapshot, and a restore that answers
 * later is dropped rather than hydrated under a screen already drawn.
 */
export const DEVICE_SNAPSHOT_RESTORE_BUDGET_MS = 1500;

/** Logged, with {@link DEVICE_SNAPSHOT_FAILED}, when the restore outlived its budget. */
export const DEVICE_SNAPSHOT_RESTORE_TIMED_OUT = 'DEVICE_SNAPSHOT_RESTORE_TIMED_OUT';

/** Whether `work` settled within `ms`; it is never rejected (the restore catches its own failures). */
async function settledWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((done) => {
    timer = setTimeout(() => {
      done(false);
    }, ms);
  });

  try {
    return await Promise.race([work.then(() => true as const), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Logged when the device store fails. Never rendered: the app works without it. */
export const DEVICE_SNAPSHOT_FAILED = 'DEVICE_SNAPSHOT_FAILED';

/** Logged, with {@link DEVICE_SNAPSHOT_FAILED}, when a forget's delete outlived its budget. */
export const DEVICE_SNAPSHOT_FORGET_TIMED_OUT = 'DEVICE_SNAPSHOT_FORGET_TIMED_OUT';

/** Whether a time stamp is out of the snapshot's life at `now`: older than `maxAge`, or in the future (a clock moved back). */
export function outOfLife(stamp: number, now: number): boolean {
  return stamp > now || now - stamp > DEVICE_SNAPSHOT_MAX_AGE_MS;
}

/** The page's lifecycle, as far as the snapshot listens: the page being hidden or left. */
export interface PageLifecycle {
  /** Calls `onHidden` when the page is hidden or left. Returns the unsubscribe. */
  subscribe(onHidden: () => void): () => void;
}

/** How the snapshot is built: injected so the node suite can drive each rule. */
export interface DeviceSnapshotOptions {
  readonly throttleTime?: number;
  readonly restoreBudget?: number;
  readonly now?: () => number;
  readonly lifecycle?: PageLifecycle;
}

/**
 * The device snapshot of `client` over `storage` (a thunk, so nothing opens
 * IndexedDB until the snapshot is first used).
 *
 * NOTHING IS SAVED BEFORE THE KEPT COPY HAS BEEN READ. A save writes the
 * whole cache, so one made while the restore is still reading would replace
 * a fuller copy with whatever this page load has read so far. Saving starts
 * once the restore's read has SETTLED — in time, or after the first render
 * has gone ahead without it, when it is checked for its owner and its age
 * and removed if it is not this user's, but never hydrated. A read that
 * never settles means nothing is saved this page load.
 *
 * EACH ENTRY HAS ITS OWN AGE. The blob's time stamp is rewritten on every
 * save, so it says when the copy was written, not how old what it holds is.
 * An entry whose `dataUpdatedAt` is out of the snapshot's life is never saved
 * and dropped on restore, so an entry no screen observes cannot live on, and
 * no note can state a date older than `maxAge`.
 *
 * A HIDDEN PAGE IS SAVED AT ONCE. A save waiting in the throttle is written
 * straight away when the page is hidden or left (`lifecycle`), so the last
 * reads before a phone locks or the app is swiped away are on the device.
 */
export function deviceSnapshot(
  client: QueryClient,
  storage: () => SnapshotStorage,
  options: DeviceSnapshotOptions = {},
): DeviceSnapshot {
  const throttleTime = options.throttleTime ?? DEVICE_SNAPSHOT_THROTTLE_MS;
  const restoreBudget = options.restoreBudget ?? DEVICE_SNAPSHOT_RESTORE_BUDGET_MS;
  const now = options.now ?? Date.now;
  let owner: string | null = null;
  // Whose save was serialized last: the write that follows checks it again.
  let serializedFor: string | null = null;
  let unsubscribe: (() => void) | null = null;
  // Whether a restore's read is still out: no save may start until it settles.
  let reading = false;
  let stopHidden: (() => void) | null = null;

  /** Kept, and within its life: what a save may write. */
  const savable = (query: Pick<Query, 'queryKey' | 'state'>): boolean =>
    persistsQuery(query) && !outOfLife(query.state.dataUpdatedAt, now());
  const dehydrateOptions = { shouldDehydrateQuery: savable, shouldDehydrateMutation: () => false };

  const serialized = (persisted: PersistedClient): string => {
    if (owner === null || persisted.buster !== owner) throw new Error(SAVE_OUTLIVED_OWNER);

    serializedFor = owner;

    return JSON.stringify(persisted);
  };

  const persister = createAsyncStoragePersister({
    storage: {
      getItem: async (key) => {
        const value = await storage().get(key);

        return typeof value === 'string' ? value : null;
      },
      // Checked again at the write, so a sign-out between the serialize and
      // the write still wins.
      setItem: async (key, value) => {
        if (owner === null || owner !== serializedFor) throw new Error(SAVE_OUTLIVED_OWNER);

        await storage().set(key, value);
      },
      removeItem: (key) => storage().del(key),
    },
    key: DEVICE_SNAPSHOT_KEY,
    throttleTime,
    // Runs when the throttled save is finally written, so a save dehydrated
    // for an owner who has since gone is refused here, never written.
    serialize: serialized,
  });

  const stop = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  const remove = async (): Promise<void> => {
    try {
      await persister.removeClient();
    } catch (cause) {
      console.error(DEVICE_SNAPSHOT_FAILED, cause);
    }
  };

  /** Writes the cache now, past the throttle: the page is being hidden or left. */
  const flush = (): void => {
    if (owner === null || unsubscribe === null) return;

    const persisted: PersistedClient = { buster: owner, timestamp: now(), clientState: dehydrate(client, dehydrateOptions) };

    try {
      const value = serialized(persisted);

      void storage()
        .set(DEVICE_SNAPSHOT_KEY, value)
        .catch((cause: unknown) => {
          console.error(DEVICE_SNAPSHOT_FAILED, cause);
        });
    } catch {
      // The owner has gone: nothing to write.
    }
  };

  /** Starts saving for the current owner, unless a restore's read is still out. */
  const startSaving = (): void => {
    if (owner === null || reading || unsubscribe !== null) return;

    unsubscribe = persistQueryClientSubscribe({ queryClient: client, persister, buster: owner, dehydrateOptions });
    stopHidden ??= options.lifecycle?.subscribe(flush) ?? null;
  };

  const persistFor = (userId: string): void => {
    if (owner === userId && unsubscribe !== null) return;

    stop();
    owner = userId;
    startSaving();
  };

  /** The kept copy with every entry out of its life dropped. */
  const withinLife = (persisted: PersistedClient): PersistedClient => ({
    ...persisted,
    clientState: {
      ...persisted.clientState,
      queries: persisted.clientState.queries.filter((query) => !outOfLife(query.state.dataUpdatedAt, now())),
    },
  });

  return {
    restoreForSession: async (userId) => {
      let abandoned = false;
      const restore = async (): Promise<void> => {
        if (userId === null) {
          stop();
          owner = null;
          await remove();

          return;
        }

        let persisted: PersistedClient | undefined;

        try {
          persisted = await persister.restoreClient();
        } catch (cause) {
          // Unreadable: deleted, never trusted.
          console.error(DEVICE_SNAPSHOT_FAILED, cause);
          await remove();

          return;
        }

        if (persisted === undefined) return;

        // Checked even when the first render has gone ahead without it.
        if (!persisted.timestamp || outOfLife(persisted.timestamp, now()) || persisted.buster !== userId) {
          await remove();

          return;
        }

        // Too late to draw: never hydrated under a screen already drawn.
        if (abandoned) return;

        try {
          hydrate(client, withinLife(persisted).clientState);
          // A restored answer is never fresh: the first observer reads again.
          await client.invalidateQueries({ predicate: persistsQuery, refetchType: 'none' });
        } catch (cause) {
          console.error(DEVICE_SNAPSHOT_FAILED, cause);
          // Nothing half-restored stays in the cache, nor on the device.
          client.removeQueries({ predicate: (query) => persistsKey(query.queryKey) });
          await remove();
        }
      };

      if (userId !== null) {
        stop();
        owner = userId;
        reading = true;
      }

      const work = restore().finally(() => {
        reading = false;
        // Saving starts once the read has settled, in time or late.
        startSaving();
      });

      if (!(await settledWithin(work, restoreBudget))) {
        abandoned = true;
        console.error(DEVICE_SNAPSHOT_FAILED, DEVICE_SNAPSHOT_RESTORE_TIMED_OUT);
      }
    },
    persistFor,
    forget: async () => {
      stop();
      owner = null;
      // Bounded like the restore: a hung store never holds a sign-out. Nothing
      // is saved meanwhile (no owner), and the delete still lands when it can.
      if (!(await settledWithin(remove(), restoreBudget))) {
        console.error(DEVICE_SNAPSHOT_FAILED, DEVICE_SNAPSHOT_FORGET_TIMED_OUT);
      }
    },
    owner: () => owner,
  };
}
