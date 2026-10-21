import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { ERASURE_CHECK_KEY_PART as FEATURE_ERASURE_CHECK_KEY_PART } from '@/features/conflicts/hooks/use-erasure-reads';
import { ACTING_ADMINS_KEY } from '@/features/conflicts/services/resolved-conflicts';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_OVERVIEW_RECORDS_KEY,
  LEAVE_RECORDS_KEY,
  MY_LEAVE_RECORDS_KEY,
  ORGANIZATION_LEAVE_RECORDS_KEY,
} from '@/features/leave/services/leave-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { SESSION_SUBJECT_KEY } from '@/features/members/services/write';
import { MEMBER_NAME_KEY } from '@/features/navigation/services/profile';
import { MEMBER_ROLE_KEY } from '@/features/navigation/services/role';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { organizationLogoKey } from '@/features/organization/services/logo';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { OWN_TEAM_KEY, TEAM_ROSTER_KEY } from '@/features/teams/services/roster';
import { queryClient } from '@/lib/query-client';
import {
  DEVICE_SNAPSHOT_FAILED,
  DEVICE_SNAPSHOT_GC_TIME_MS,
  DEVICE_SNAPSHOT_KEY,
  DEVICE_SNAPSHOT_MAX_AGE_MS,
  DEVICE_SNAPSHOT_FORGET_TIMED_OUT,
  DEVICE_SNAPSHOT_RESTORE_TIMED_OUT,
  ERASURE_CHECK_KEY_PART,
  PERSISTED_KEY_ROOTS,
  PERSISTED_PARAMETERISED_KEY_ROOTS,
  deviceSnapshot,
  persistsKey,
  persistsQuery,
  type SnapshotStorage,
} from '@/lib/offline/persistence';

/**
 * Story 8.2's device snapshot, executed with no IndexedDB (AD-15): an
 * in-memory store behind the same get/set/del, and real query clients — one
 * page load that saves, another that restores.
 */

/** An in-memory store, with every write it was asked to make. */
function memoryStorage(): SnapshotStorage & { readonly entries: Map<string, string>; readonly writes: string[] } {
  const entries = new Map<string, string>();
  const writes: string[] = [];

  return {
    entries,
    writes,
    get: (key) => Promise.resolve(entries.get(key)),
    set: (key, value) => {
      writes.push(value);
      entries.set(key, value);

      return Promise.resolve();
    },
    del: (key) => {
      entries.delete(key);

      return Promise.resolve();
    },
  };
}

const client = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** What the stored blob holds: its owner and the keys it kept. */
function stored(storage: ReturnType<typeof memoryStorage>): { owner: string; keys: unknown[] } | null {
  const raw = storage.entries.get(DEVICE_SNAPSHOT_KEY);

  if (raw === undefined) return null;

  const parsed = JSON.parse(raw) as { buster: string; clientState: { queries: { queryKey: unknown[] }[] } };

  return { owner: parsed.buster, keys: parsed.clientState.queries.map((query) => query.queryKey) };
}

/** A page load that read `calendar` and `member-role` as `owner`, and saved them. */
async function savedBy(owner: string, storage: ReturnType<typeof memoryStorage>): Promise<void> {
  const page = client();
  const device = deviceSnapshot(page, () => storage, { throttleTime: 0 });

  await device.restoreForSession(owner);
  await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: owner }) });
  await page.fetchQuery({ queryKey: MEMBER_ROLE_KEY, queryFn: () => Promise.resolve({ ok: true, role: 'member' }) });
  await vi.waitFor(() => {
    expect(stored(storage)?.keys).toEqual(expect.arrayContaining([[...CALENDAR_KEY], [...MEMBER_ROLE_KEY]]));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is kept on the device', () => {
  const success = (data: unknown = { rows: [] }) => ({ status: 'success' as const, data });

  it('names each kept key as the feature spells it, so the two cannot drift apart', () => {
    expect(PERSISTED_KEY_ROOTS).toEqual(
      [
        CALENDAR_KEY,
        MY_LEAVE_RECORDS_KEY,
        ORGANIZATION_LEAVE_RECORDS_KEY,
        MY_CONFLICT_RESOLUTIONS_KEY,
        ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
        MEMBERS_LIST_KEY,
        ORGANIZATION_SNAPSHOT_KEY,
        MEMBER_ROLE_KEY,
        MEMBER_NAME_KEY,
        SESSION_SUBJECT_KEY,
        LEAVE_OVERVIEW_RECORDS_KEY,
        TEAMS_LIST_KEY,
        OWN_TEAM_KEY,
        ACTING_ADMINS_KEY,
      ].map((key) => {
        expect(key).toHaveLength(1);

        return key[0];
      }),
    );
    expect(PERSISTED_PARAMETERISED_KEY_ROOTS).toEqual([TEAM_ROSTER_KEY('t')[0], LEAVE_RECORDS_KEY('m')[0]]);
  });

  it('keeps a parameterised read only in the exact shape [root, string id] (stories 8.2b, 8.2c)', () => {
    expect(persistsQuery({ queryKey: TEAM_ROSTER_KEY('team-1'), state: success() } as never)).toBe(true);
    // Story 8.2c: one member's leave, read by the member page.
    expect(persistsQuery({ queryKey: LEAVE_RECORDS_KEY('member-1'), state: success() } as never)).toBe(true);
    expect(persistsKey(LEAVE_RECORDS_KEY(''))).toBe(false);
    expect(persistsKey([...LEAVE_RECORDS_KEY('member-1'), 'more'])).toBe(false);
    expect(persistsKey([...LEAVE_RECORDS_KEY('member-1'), ERASURE_CHECK_KEY_PART])).toBe(false);
    expect(persistsKey([LEAVE_RECORDS_KEY('m')[0], ERASURE_CHECK_KEY_PART])).toBe(false);
    expect(persistsKey([LEAVE_RECORDS_KEY('m')[0]])).toBe(false);
    // A one-segment root takes no id.
    expect(persistsKey([...ACTING_ADMINS_KEY, 'admin-1'])).toBe(false);
    expect(persistsKey(TEAM_ROSTER_KEY(''))).toBe(false);
    expect(persistsKey([...TEAM_ROSTER_KEY('team-1'), 'more'])).toBe(false);
    expect(persistsKey([TEAM_ROSTER_KEY('t')[0], 7])).toBe(false);
    expect(persistsKey([TEAM_ROSTER_KEY('t')[0]])).toBe(false);
    expect(persistsKey([...TEAM_ROSTER_KEY('team-1'), ERASURE_CHECK_KEY_PART])).toBe(false);
    expect(persistsKey([TEAM_ROSTER_KEY('t')[0], ERASURE_CHECK_KEY_PART])).toBe(false);
    // A one-segment root takes no id.
    expect(persistsKey([...TEAMS_LIST_KEY, 'team-1'])).toBe(false);
  });

  it('never keeps the erasure check, by the feature\'s own key part', () => {
    expect(ERASURE_CHECK_KEY_PART).toBe(FEATURE_ERASURE_CHECK_KEY_PART);
    expect(persistsKey(['calendar', 'erasure-check'])).toBe(false);
    expect(persistsKey([...CALENDAR_KEY, ERASURE_CHECK_KEY_PART])).toBe(false);
  });

  it('keeps a successful read under an allowed key', () => {
    for (const root of PERSISTED_KEY_ROOTS) {
      expect(persistsQuery({ queryKey: [root], state: success() } as never), root).toBe(true);
    }
  });

  it('never keeps the erasure guard\'s fresh reads, the logo URL, or a key off the list', () => {
    expect(persistsQuery({ queryKey: [...CALENDAR_KEY, ERASURE_CHECK_KEY_PART], state: success() } as never)).toBe(false);
    expect(persistsQuery({ queryKey: organizationLogoKey('org/logo'), state: success() } as never)).toBe(false);
    expect(persistsQuery({ queryKey: ['shiftTypes'], state: success() } as never)).toBe(false);
  });

  it('never keeps a failed or pending read, or a read that resolved with its own failure', () => {
    expect(persistsQuery({ queryKey: CALENDAR_KEY, state: { status: 'error', data: { rows: [] } } } as never)).toBe(false);
    expect(persistsQuery({ queryKey: CALENDAR_KEY, state: { status: 'pending', data: undefined } } as never)).toBe(false);
    expect(persistsQuery({ queryKey: ORGANIZATION_SNAPSHOT_KEY, state: success({ ok: false, code: 'X' }) } as never)).toBe(
      false,
    );
  });

  it('saves only the kept reads, tagged with their owner', async () => {
    const storage = memoryStorage();
    const page = client();
    const device = deviceSnapshot(page, () => storage, { throttleTime: 0 });

    await device.restoreForSession('member-a');
    await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'a' }) });
    await page.fetchQuery({ queryKey: ['shiftTypes'], queryFn: () => Promise.resolve([]) });
    await page
      .fetchQuery({ queryKey: MEMBERS_LIST_KEY, queryFn: () => Promise.reject(new Error('UNAVAILABLE')) })
      .catch(() => undefined);

    await vi.waitFor(() => {
      expect(stored(storage)).toEqual({ owner: 'member-a', keys: [[...CALENDAR_KEY]] });
    });
  });
});

describe('a kept snapshot is restored for its owner alone', () => {
  it('restores it for the same user, marked stale so the first observer reads again', async () => {
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const reloaded = client();

    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a');

    expect(reloaded.getQueryData(CALENDAR_KEY)).toEqual({ of: 'member-a' });
    expect(reloaded.getQueryState(CALENDAR_KEY)?.isInvalidated, 'a restored answer counts as fresh').toBe(true);
  });

  it('keeps a restored answer through the kept keys\' gcTime, which a timer can hold', async () => {
    // 30 days overflows `setTimeout`, which then fires at once: every
    // restored entry was collected before any screen could observe it.
    expect(DEVICE_SNAPSHOT_GC_TIME_MS).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(DEVICE_SNAPSHOT_GC_TIME_MS).toBeLessThanOrEqual(DEVICE_SNAPSHOT_MAX_AGE_MS);
    // Scoped to the kept keys: every other query keeps TanStack's default.
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBeUndefined();
    for (const root of PERSISTED_KEY_ROOTS) {
      expect(queryClient.getQueryDefaults([root]).gcTime, root).toBe(DEVICE_SNAPSHOT_GC_TIME_MS);
    }
    for (const root of PERSISTED_PARAMETERISED_KEY_ROOTS) {
      expect(queryClient.getQueryDefaults([root, 'id']).gcTime, root).toBe(DEVICE_SNAPSHOT_GC_TIME_MS);
    }
    expect(queryClient.getQueryDefaults(['shiftTypes']).gcTime).toBeUndefined();

    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const reloaded = client();

    reloaded.setQueryDefaults([...CALENDAR_KEY], { gcTime: DEVICE_SNAPSHOT_GC_TIME_MS });

    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a');
    await new Promise((done) => setTimeout(done, 20));

    expect(reloaded.getQueryData(CALENDAR_KEY), 'the restored answer was collected before it was observed').toEqual({
      of: 'member-a',
    });
    reloaded.clear();
  });

  it('restores nothing for another user, and deletes the copy', async () => {
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const reloaded = client();

    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-b');

    expect(reloaded.getQueryData(CALENDAR_KEY)).toBeUndefined();
    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
  });

  it('restores nothing with no session, and deletes the copy', async () => {
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const reloaded = client();
    const device = deviceSnapshot(reloaded, () => storage, { throttleTime: 0 });

    await device.restoreForSession(null);

    expect(reloaded.getQueryData(CALENDAR_KEY)).toBeUndefined();
    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
    expect(device.owner()).toBeNull();
  });

  it('restores nothing older than 30 days, and deletes it', async () => {
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const blob = JSON.parse(storage.entries.get(DEVICE_SNAPSHOT_KEY) ?? '{}') as { timestamp: number };

    blob.timestamp = Date.now() - DEVICE_SNAPSHOT_MAX_AGE_MS - 1;
    storage.entries.set(DEVICE_SNAPSHOT_KEY, JSON.stringify(blob));
    const reloaded = client();

    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a');

    expect(reloaded.getQueryData(CALENDAR_KEY)).toBeUndefined();
    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
  });

  it('deletes a copy it cannot read, logs it, and never rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = memoryStorage();

    storage.entries.set(DEVICE_SNAPSHOT_KEY, '{not json');
    const reloaded = client();

    await expect(deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a')).resolves.toBeUndefined();

    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
    expect(logged).toHaveBeenCalledWith(DEVICE_SNAPSHOT_FAILED, expect.anything());
  });
});

describe('a hung store never holds the first render or a sign-out', () => {
  /** A store whose every call never settles, as a blocked IndexedDB upgrade. */
  const hung: SnapshotStorage = {
    get: () => new Promise(() => undefined),
    set: () => new Promise(() => undefined),
    del: () => new Promise(() => undefined),
  };

  it('settles the restore within its budget, keeps the cache for the user, and logs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const page = client();
    const device = deviceSnapshot(page, () => hung, { throttleTime: 0, restoreBudget: 30 });
    const started = Date.now();

    await device.restoreForSession('member-a');

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(device.owner()).toBe('member-a');
    expect(logged).toHaveBeenCalledWith(DEVICE_SNAPSHOT_FAILED, DEVICE_SNAPSHOT_RESTORE_TIMED_OUT);
  });

  it('drops a restore that answers after its budget, rather than hydrating under a drawn screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const slow: SnapshotStorage = {
      ...storage,
      get: (key) => new Promise((done) => setTimeout(() => done(storage.get(key)), 60)),
    };
    const reloaded = client();

    await deviceSnapshot(reloaded, () => slow, { throttleTime: 0, restoreBudget: 20 }).restoreForSession('member-a');
    await new Promise((done) => setTimeout(done, 100));

    expect(reloaded.getQueryData(CALENDAR_KEY)).toBeUndefined();
  });

  it('settles a forget within the budget too, under its own code', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const device = deviceSnapshot(client(), () => hung, { throttleTime: 0, restoreBudget: 30 });

    device.persistFor('member-a');
    await device.forget();

    expect(device.owner()).toBeNull();
    expect(logged).toHaveBeenCalledWith(DEVICE_SNAPSHOT_FAILED, DEVICE_SNAPSHOT_FORGET_TIMED_OUT);
  });

  it('saves nothing while the restore\'s read is out: a slow store keeps its fuller copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const before = storage.entries.get(DEVICE_SNAPSHOT_KEY);
    // The read never answers; writes would.
    const stuck: SnapshotStorage = { ...storage, get: () => new Promise(() => undefined) };
    const reloaded = client();

    const device = deviceSnapshot(reloaded, () => stuck, { throttleTime: 0, restoreBudget: 20 });

    await device.restoreForSession('member-a');
    // The session rule's first event asks to keep the cache for the same user.
    device.persistFor('member-a');
    await reloaded.fetchQuery({ queryKey: MEMBER_NAME_KEY, queryFn: () => Promise.resolve('Ana') });
    await new Promise((done) => setTimeout(done, 30));

    expect(storage.entries.get(DEVICE_SNAPSHOT_KEY), 'a save replaced the copy it never read').toBe(before);
  });

  it('removes another user\'s copy that answers after the budget, hydrates nothing, then saves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const slow: SnapshotStorage = {
      ...storage,
      get: (key) => new Promise((done) => setTimeout(() => done(storage.get(key)), 50)),
    };
    const reloaded = client();

    await deviceSnapshot(reloaded, () => slow, { throttleTime: 0, restoreBudget: 10 }).restoreForSession('member-b');
    await vi.waitFor(() => {
      expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
    });
    expect(reloaded.getQueryData(CALENDAR_KEY)).toBeUndefined();

    // Once the read settled, this user's reads are kept.
    await reloaded.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'b' }) });
    await vi.waitFor(() => {
      expect(stored(storage)?.owner).toBe('member-b');
    });
  });
});

describe('each entry has its own age', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('never saves an entry older than maxAge', async () => {
    const storage = memoryStorage();
    const page = client();
    // The clock thirty-one days on: everything read now is out of its life.
    const later = () => Date.now() + 31 * DAY;
    const device = deviceSnapshot(page, () => storage, { throttleTime: 0, now: later });

    await device.restoreForSession('member-a');
    await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'a' }) });
    await vi.waitFor(() => {
      expect(stored(storage)).toEqual({ owner: 'member-a', keys: [] });
    });
  });

  it('drops an entry older than maxAge on restore, keeping the rest', async () => {
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const blob = JSON.parse(storage.entries.get(DEVICE_SNAPSHOT_KEY) ?? '{}') as {
      clientState: { queries: { queryKey: unknown[]; state: { dataUpdatedAt: number } }[] };
    };

    for (const query of blob.clientState.queries) {
      if (query.queryKey[0] === CALENDAR_KEY[0]) query.state.dataUpdatedAt = Date.now() - 31 * DAY;
    }
    storage.entries.set(DEVICE_SNAPSHOT_KEY, JSON.stringify(blob));
    const reloaded = client();

    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a');

    expect(reloaded.getQueryData(CALENDAR_KEY), 'a months-old entry was restored').toBeUndefined();
    expect(reloaded.getQueryData(MEMBER_ROLE_KEY)).toEqual({ ok: true, role: 'member' });
  });

  it('counts a copy stamped in the future (a clock moved back) as expired', async () => {
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const blob = JSON.parse(storage.entries.get(DEVICE_SNAPSHOT_KEY) ?? '{}') as { timestamp: number };

    blob.timestamp = Date.now() + DAY;
    storage.entries.set(DEVICE_SNAPSHOT_KEY, JSON.stringify(blob));
    const reloaded = client();

    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a');

    expect(reloaded.getQueryData(CALENDAR_KEY)).toBeUndefined();
    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
  });
});

describe('a restore that fails halfway, and a page hidden mid-throttle', () => {
  it('removes what it hydrated, and the copy, when marking it stale fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storage = memoryStorage();

    await savedBy('member-a', storage);
    const reloaded = client();

    vi.spyOn(reloaded, 'invalidateQueries').mockRejectedValueOnce(new Error('broken'));
    await deviceSnapshot(reloaded, () => storage, { throttleTime: 0 }).restoreForSession('member-a');

    expect(reloaded.getQueryData(CALENDAR_KEY), 'a half-restored answer stayed in the cache').toBeUndefined();
    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
  });

  it('writes a save waiting in the throttle at once when the page is hidden', async () => {
    const storage = memoryStorage();
    const page = client();
    let hide: () => void = () => undefined;
    const device = deviceSnapshot(page, () => storage, {
      throttleTime: 60_000,
      lifecycle: {
        subscribe: (onHidden) => {
          hide = onHidden;

          return () => undefined;
        },
      },
    });

    await device.restoreForSession('member-a');
    // The first save runs at once, on the query being added, with nothing
    // in it yet; every later one waits a minute in the throttle.
    await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'a' }) });
    await page.fetchQuery({ queryKey: MEMBER_ROLE_KEY, queryFn: () => Promise.resolve({ ok: true, role: 'member' }) });
    await new Promise((done) => setTimeout(done, 10));
    expect(stored(storage)?.keys, 'the throttle let a later save through').toEqual([]);

    hide();

    await vi.waitFor(() => {
      expect(stored(storage)?.keys).toEqual(expect.arrayContaining([[...CALENDAR_KEY], [...MEMBER_ROLE_KEY]]));
    });
    // After a sign-out, hiding writes nothing.
    await device.forget();
    hide();
    await new Promise((done) => setTimeout(done, 10));
    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
  });
});

describe('forgetting the device', () => {
  it('deletes the copy and keeps nothing afterwards', async () => {
    const storage = memoryStorage();
    const page = client();
    const device = deviceSnapshot(page, () => storage, { throttleTime: 0 });

    await device.restoreForSession('member-a');
    await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'a' }) });
    await vi.waitFor(() => {
      expect(stored(storage)).not.toBeNull();
    });

    await device.forget();
    await page.fetchQuery({ queryKey: MEMBER_ROLE_KEY, queryFn: () => Promise.resolve({ ok: true, role: 'member' }) });
    // Long enough for any save still in the throttle to have run.
    await new Promise((done) => setTimeout(done, 20));

    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY)).toBe(false);
    expect(device.owner()).toBeNull();
  });

  it('drops a save dehydrated before the sign-out that lands after it', async () => {
    const storage = memoryStorage();
    const page = client();
    // A long throttle: the second save waits while the first one runs.
    const device = deviceSnapshot(page, () => storage, { throttleTime: 50 });

    await device.restoreForSession('member-a');
    await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'a' }) });
    await page.fetchQuery({ queryKey: MEMBER_ROLE_KEY, queryFn: () => Promise.resolve({ ok: true, role: 'member' }) });
    await device.forget();
    await new Promise((done) => setTimeout(done, 120));

    expect(storage.entries.has(DEVICE_SNAPSHOT_KEY), 'a save outlived the sign-out').toBe(false);
  });

  it('keeps the next user\'s reads under their own name, never the previous one\'s', async () => {
    const storage = memoryStorage();
    const page = client();
    const device = deviceSnapshot(page, () => storage, { throttleTime: 0 });

    await device.restoreForSession('member-a');
    await device.forget();
    page.clear();
    device.persistFor('member-b');
    await page.fetchQuery({ queryKey: CALENDAR_KEY, queryFn: () => Promise.resolve({ of: 'b' }) });

    await vi.waitFor(() => {
      expect(stored(storage)?.owner).toBe('member-b');
    });
    for (const write of storage.writes) expect(write).not.toContain('"buster":"member-a"');
  });
});
