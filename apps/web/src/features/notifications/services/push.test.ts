import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEVICE_UNAVAILABLE,
  FORGET_PUSH_BUDGET_MS,
  FORGET_REMOVE_BUDGET_MS,
  FORGET_WORKER_BUDGET_MS,
  PUSH_CONTROL,
  PUSH_DENIED,
  PUSH_DENIED_VIEW,
  PUSH_DISMISSED,
  PUSH_FAILED,
  PUSH_IOS_INSTALL,
  PUSH_LOADING,
  PUSH_NOT_CONFIGURED,
  PUSH_UNAVAILABLE,
  PUSH_UNSUPPORTED,
  applicationServerKeyOf,
  deviceAfter,
  forgetPushDevice,
  madeUnderKey,
  pagePushSources,
  pushConfigured,
  pushOf,
  pushStatusMessageKey,
  pushValue,
  pushViewOf,
  readPushDevice,
  reconcilePushDevice,
  subscriptionKeysOf,
  switchableOn,
  turnPushOff,
  turnPushOn,
  whenVisibleAgain,
  type PushBackend,
  type PushManagerLike,
  type PushPermission,
  type PushSources,
  type PushSubscriptionLike,
} from '@/features/notifications/services/push';

/**
 * Story 10.4: this device's push on `/obavijesti`, executed against fake
 * sources and a fake backend (AD-15). The browser asks permission only after
 * the press; a device another member registered reads as off here.
 */

/** A public key's shape: 65 bytes, an uncompressed P-256 point (0x04 first), unpadded base64url. */
const PUBLIC_KEY = 'BO8VM-jYeQGhMl_-cXpeQll7R16J-dxBA0BgLyaSQbtkHe5omXOEkIGtO8uODlxq2pm20O_bYx4fExhSE-wXTfw';
const ENDPOINT = 'https://push.example.org/send/device';
const KEYS = { p256dh: `B${'k'.repeat(86)}`, auth: 'a'.repeat(22) };

function subscription(
  endpoint = ENDPOINT,
  applicationServerKey?: ArrayBuffer,
): PushSubscriptionLike & { unsubscribe: ReturnType<typeof vi.fn> } {
  return {
    endpoint,
    ...(applicationServerKey === undefined ? {} : { options: { applicationServerKey } }),
    toJSON: () => ({ endpoint, keys: KEYS }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

function manager(held: PushSubscriptionLike | null): PushManagerLike & {
  subscribe: ReturnType<typeof vi.fn>;
} {
  const created = subscription();
  return {
    getSubscription: () => Promise.resolve(held),
    subscribe: vi.fn(() => Promise.resolve(created)),
  };
}

function sources(
  overrides: Partial<{ supported: boolean; permission: PushPermission; answer: PushPermission; manager: PushManagerLike | null }> = {},
): PushSources & { requestPermission: ReturnType<typeof vi.fn> } {
  let permission = overrides.permission ?? 'granted';
  return {
    supported: () => overrides.supported ?? true,
    permission: () => permission,
    requestPermission: vi.fn(() => {
      permission = overrides.answer ?? 'granted';
      return Promise.resolve(permission);
    }),
    pushManager: () => Promise.resolve(overrides.manager === undefined ? manager(null) : overrides.manager),
  };
}

function backend(overrides: Partial<{ owns: boolean | undefined; register: boolean; remove: number | null }> = {}): PushBackend & {
  register: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    owns: () => Promise.resolve('owns' in overrides ? overrides.owns : true),
    register: vi.fn(() => Promise.resolve(overrides.register ?? true)),
    remove: vi.fn(() => Promise.resolve('remove' in overrides ? (overrides.remove ?? null) : 1)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the push section draws what this device can do', () => {
  it('says the installed app is needed on iOS in a browser tab, before anything is read', () => {
    expect(pushViewOf({ configured: true, iosInstall: true, device: undefined })).toEqual({ kind: PUSH_IOS_INSTALL });
    expect(pushViewOf({ configured: true, iosInstall: true, device: deviceAfter(true) })).toEqual({ kind: PUSH_IOS_INSTALL });
  });

  it('loads, then says unsupported, blocked, unavailable, or offers the on/off', () => {
    expect(pushViewOf({ configured: true, iosInstall: false, device: undefined })).toEqual({ kind: PUSH_LOADING });
    expect(pushViewOf({ configured: true, iosInstall: false, device: { kind: 'unsupported' } })).toEqual({ kind: PUSH_UNSUPPORTED });
    expect(pushViewOf({ configured: true, iosInstall: false, device: { kind: 'denied' } })).toEqual({ kind: PUSH_DENIED_VIEW });
    expect(pushViewOf({ configured: true, iosInstall: false, device: DEVICE_UNAVAILABLE })).toEqual({ kind: PUSH_UNAVAILABLE });
    expect(pushViewOf({ configured: true, iosInstall: false, device: deviceAfter(false) })).toEqual({ kind: PUSH_CONTROL, on: false });
    expect(pushViewOf({ configured: true, iosInstall: false, device: deviceAfter(true) })).toEqual({ kind: PUSH_CONTROL, on: true });
  });

  it('says push is unavailable first when the build carries no VAPID public key', () => {
    expect(pushViewOf({ configured: false, iosInstall: true, device: deviceAfter(true) })).toEqual({ kind: PUSH_NOT_CONFIGURED });
    expect(pushViewOf({ configured: false, iosInstall: false, device: undefined })).toEqual({ kind: PUSH_NOT_CONFIGURED });
    expect(pushConfigured(undefined)).toBe(false);
    expect(pushConfigured('')).toBe(false);
    expect(pushConfigured(PUBLIC_KEY)).toBe(true);
  });

  it('speaks the radio values of its own', () => {
    expect(pushValue(true)).toBe('on');
    expect(pushValue(false)).toBe('off');
    expect(pushOf('on', false)).toBe(true);
    expect(pushOf('off', true)).toBe(false);
    expect(pushOf('else', true)).toBe(true);
  });

  it('switches only a device that offers the control', () => {
    expect(switchableOn(deviceAfter(true))).toBe(true);
    expect(switchableOn(deviceAfter(false))).toBe(false);
    expect(switchableOn(DEVICE_UNAVAILABLE)).toBeNull();
    expect(switchableOn({ kind: 'denied' })).toBeNull();
    expect(switchableOn(undefined)).toBeNull();
  });

  it('says the saved state', () => {
    expect(pushStatusMessageKey(true)).toBe('postavkeObavijesti.pushStatusOn');
    expect(pushStatusMessageKey(false)).toBe('postavkeObavijesti.pushStatusOff');
  });
});

describe("this device's state", () => {
  it('is unsupported without a service worker, PushManager or Notification, or with no worker registered', async () => {
    expect(await readPushDevice(sources({ supported: false }), backend())).toEqual({ kind: 'unsupported' });
    expect(await readPushDevice(sources({ manager: null }), backend())).toEqual({ kind: 'unsupported' });
  });

  it('is unavailable, and worth a retry, when a registered worker does not become ready in time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const late = { ...sources(), pushManager: () => Promise.reject(new Error('PUSH_WORKER_NOT_READY')) };

    expect(await readPushDevice(late, backend())).toEqual(DEVICE_UNAVAILABLE);
  });

  it('is blocked when the permission is denied, and asks nothing', async () => {
    const page = sources({ permission: 'denied' });

    expect(await readPushDevice(page, backend())).toEqual({ kind: 'denied' });
    expect(await readPushDevice({ ...page, pushManager: () => Promise.reject(new Error('late')) }, backend())).toEqual({
      kind: 'denied',
    });
    expect(page.requestPermission).not.toHaveBeenCalled();
  });

  it.each(['denied', 'default'] as const)(
    'drops a subscription the permission (%s) no longer covers: its own row deleted, the browser unsubscribed',
    async (permission) => {
      const held = subscription();
      const rows = backend({ owns: true });

      const device = await readPushDevice(sources({ permission, manager: manager(held) }), rows);

      expect(device).toEqual(permission === 'denied' ? { kind: 'denied' } : deviceAfter(false));
      expect(rows.remove).toHaveBeenCalledWith(ENDPOINT);
      expect(held.unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it("drops an uncovered subscription without deleting another member's row", async () => {
    const held = subscription();
    const rows = backend({ owns: false });

    await readPushDevice(sources({ permission: 'default', manager: manager(held) }), rows);

    expect(rows.remove).not.toHaveBeenCalled();
    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('is off with no browser subscription', async () => {
    expect(await readPushDevice(sources({ manager: manager(null) }), backend())).toEqual(deviceAfter(false));
  });

  it("is on only when the signed-in member owns the subscription's row: another member's reads as off", async () => {
    expect(await readPushDevice(sources({ manager: manager(subscription()) }), backend({ owns: true }))).toEqual(deviceAfter(true));
    expect(await readPushDevice(sources({ manager: manager(subscription()) }), backend({ owns: false }))).toEqual(deviceAfter(false));
  });

  it('is unavailable when the row cannot be read', async () => {
    expect(await readPushDevice(sources({ manager: manager(subscription()) }), backend({ owns: undefined }))).toEqual(
      DEVICE_UNAVAILABLE,
    );
  });
});

describe('turning push on', () => {
  it('asks permission after the press, subscribes under the VAPID key, and registers the endpoint and keys', async () => {
    const held = manager(null);
    const page = sources({ permission: 'default', answer: 'granted', manager: held });
    const rows = backend();

    expect(await turnPushOn(page, rows, PUBLIC_KEY)).toEqual({ ok: true, on: true });
    expect(page.requestPermission).toHaveBeenCalledTimes(1);
    expect(held.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: applicationServerKeyOf(PUBLIC_KEY) });
    expect(rows.register).toHaveBeenCalledWith({ endpoint: ENDPOINT, ...KEYS });
  });

  it('reuses the subscription the browser already holds (another member registered it here) and asks nothing when granted', async () => {
    const shared = subscription('https://push.example.org/send/shared');
    const held = manager(shared);
    const page = sources({ manager: held });
    const rows = backend();

    expect(await turnPushOn(page, rows, PUBLIC_KEY)).toEqual({ ok: true, on: true });
    expect(page.requestPermission).not.toHaveBeenCalled();
    expect(held.subscribe).not.toHaveBeenCalled();
    expect(rows.register).toHaveBeenCalledWith({ endpoint: 'https://push.example.org/send/shared', ...KEYS });
  });

  it('replaces a subscription made under another VAPID key (a rotation), and keeps one made under this one', async () => {
    const key = applicationServerKeyOf(PUBLIC_KEY);
    const other = new Uint8Array(65);
    other[0] = 4;
    const stale = subscription(ENDPOINT, other.buffer);
    const current = subscription(ENDPOINT, key?.slice().buffer);
    const rotated = manager(stale);
    const kept = manager(current);

    expect(await turnPushOn(sources({ manager: rotated }), backend(), PUBLIC_KEY)).toEqual({ ok: true, on: true });
    expect(await turnPushOn(sources({ manager: kept }), backend(), PUBLIC_KEY)).toEqual({ ok: true, on: true });

    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(rotated.subscribe).toHaveBeenCalledTimes(1);
    expect(current.unsubscribe).not.toHaveBeenCalled();
    expect(kept.subscribe).not.toHaveBeenCalled();
    expect(madeUnderKey(subscription(), key ?? new Uint8Array()), 'a browser that does not say is taken at its word').toBe(true);
  });

  it('answers denied or dismissed from the prompt, and registers nothing', async () => {
    const denied = backend();
    const dismissed = backend();

    expect(await turnPushOn(sources({ permission: 'default', answer: 'denied' }), denied, PUBLIC_KEY)).toEqual({
      ok: false,
      code: PUSH_DENIED,
    });
    expect(await turnPushOn(sources({ permission: 'default', answer: 'default' }), dismissed, PUBLIC_KEY)).toEqual({
      ok: false,
      code: PUSH_DISMISSED,
    });
    expect(denied.register).not.toHaveBeenCalled();
    expect(dismissed.register).not.toHaveBeenCalled();
  });

  it('fails when the subscribe throws, the register is refused, the key is missing, or no worker runs', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing = manager(null);
    throwing.subscribe.mockImplementation(() => Promise.reject(new DOMException('no', 'AbortError')));
    const page = sources({ permission: 'default' });

    expect(await turnPushOn(sources({ manager: throwing }), backend(), PUBLIC_KEY)).toEqual({ ok: false, code: PUSH_FAILED });
    expect(await turnPushOn(sources(), backend({ register: false }), PUBLIC_KEY)).toEqual({ ok: false, code: PUSH_FAILED });
    expect(await turnPushOn(page, backend(), undefined)).toEqual({ ok: false, code: PUSH_FAILED });
    expect(await turnPushOn(sources({ manager: null }), backend(), PUBLIC_KEY)).toEqual({ ok: false, code: PUSH_FAILED });
    // A build with no key fails before the browser is asked anything.
    expect(page.requestPermission).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith('PUSH_KEY_MISSING');
  });
});

describe('turning push off', () => {
  it('deletes the row, then unsubscribes the browser', async () => {
    const held = subscription();
    const rows = backend();

    expect(await turnPushOff(sources({ manager: manager(held) }), rows)).toEqual({ ok: true, on: false });
    expect(rows.remove).toHaveBeenCalledWith(ENDPOINT);
    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("is off for this member, and leaves the browser subscribed, when the row is someone else's (0 deleted)", async () => {
    const held = subscription();

    expect(await turnPushOff(sources({ manager: manager(held) }), backend({ remove: 0 }))).toEqual({ ok: true, on: false });
    expect(held.unsubscribe).not.toHaveBeenCalled();
  });

  it('fails, keeping push on and the browser subscribed, when the row cannot be deleted', async () => {
    const held = subscription();

    expect(await turnPushOff(sources({ manager: manager(held) }), backend({ remove: null }))).toEqual({ ok: false, code: PUSH_FAILED });
    expect(held.unsubscribe).not.toHaveBeenCalled();
  });

  it('fails with no worker: nothing is known about the subscription', async () => {
    expect(await turnPushOff(sources({ manager: null }), backend())).toEqual({ ok: false, code: PUSH_FAILED });
  });

  it('is off once the row is gone, even when the unsubscribe fails', async () => {
    const held = subscription();
    held.unsubscribe.mockImplementation(() => Promise.reject(new Error('offline')));

    expect(await turnPushOff(sources({ manager: manager(held) }), backend())).toEqual({ ok: true, on: false });
  });
});

/** A wait that never ends: the budgets play no part. */
const never = (): Promise<void> => new Promise(() => undefined);

describe("sign-out forgets this device's push, best-effort", () => {
  it('deletes the row and unsubscribes, asking a worker for less than its whole budget', async () => {
    const held = subscription();
    const rows = backend();
    const budgets: (number | undefined)[] = [];
    const page = sources({ manager: manager(held) });

    await forgetPushDevice({ ...page, pushManager: (budget) => (budgets.push(budget), page.pushManager(budget)) }, rows, never);

    expect(rows.remove).toHaveBeenCalledWith(ENDPOINT);
    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
    expect(budgets).toEqual([FORGET_WORKER_BUDGET_MS]);
    expect(FORGET_WORKER_BUDGET_MS + FORGET_REMOVE_BUDGET_MS).toBeLessThan(FORGET_PUSH_BUDGET_MS);
  });

  it.each([
    ['fails', () => Promise.reject(new Error('offline'))],
    ['answers a failure', () => Promise.resolve(null)],
    ['never answers', () => new Promise<number | null>(() => undefined)],
  ] as const)('always unsubscribes the browser, even when the delete %s', async (_label, remove) => {
    const held = subscription();
    const rows = { ...backend(), remove: vi.fn(remove) };

    await forgetPushDevice(sources({ manager: manager(held) }), rows, (ms) =>
      ms === FORGET_REMOVE_BUDGET_MS ? Promise.resolve() : never(),
    );

    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing without support or a subscription, and never throws', async () => {
    const rows = backend();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await forgetPushDevice(sources({ supported: false }), rows, never);
    await forgetPushDevice(sources({ manager: manager(null) }), rows, never);
    await expect(
      forgetPushDevice({ ...sources(), pushManager: () => Promise.reject(new Error('no')) }, rows, never),
    ).resolves.toBeUndefined();
    expect(rows.remove).not.toHaveBeenCalled();
  });

  it('goes on after its budget when the device never answers', async () => {
    const waits: number[] = [];
    const stuck = { ...sources(), pushManager: () => new Promise<PushManagerLike | null>(() => undefined) };

    await forgetPushDevice(stuck, backend(), (ms) => {
      waits.push(ms);
      return ms === FORGET_PUSH_BUDGET_MS ? Promise.resolve() : never();
    });

    expect(waits).toEqual([FORGET_PUSH_BUDGET_MS]);
  });
});

describe('a signed-in load drops what an ended session left behind', () => {
  it("unsubscribes a subscription the member does not own (the last person's), deleting no row", async () => {
    const held = subscription();
    const rows = backend({ owns: false });

    await reconcilePushDevice(sources({ manager: manager(held) }), rows);

    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
    expect(rows.remove).not.toHaveBeenCalled();
  });

  it("keeps the member's own subscription, and changes nothing when the row cannot be read", async () => {
    const own = subscription();
    const unread = subscription();

    await reconcilePushDevice(sources({ manager: manager(own) }), backend({ owns: true }));
    await reconcilePushDevice(sources({ manager: manager(unread) }), backend({ owns: undefined }));

    expect(own.unsubscribe).not.toHaveBeenCalled();
    expect(unread.unsubscribe).not.toHaveBeenCalled();
  });

  it('drops a subscription the permission no longer covers, with its own row', async () => {
    const held = subscription();
    const rows = backend({ owns: true });

    await reconcilePushDevice(sources({ permission: 'denied', manager: manager(held) }), rows);

    expect(rows.remove).toHaveBeenCalledWith(ENDPOINT);
    expect(held.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('is silent: no support, no worker, no subscription, or a failure, and it never throws', async () => {
    const errors = vi.spyOn(console, 'error');
    await reconcilePushDevice(sources({ supported: false }), backend());
    await reconcilePushDevice(sources({ manager: null }), backend());
    await reconcilePushDevice(sources({ manager: manager(null) }), backend());
    await expect(
      reconcilePushDevice({ ...sources(), pushManager: () => Promise.reject(new Error('late')) }, backend()),
    ).resolves.toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('the keys', () => {
  it('reads a VAPID public key as its 65 bytes, and refuses anything else', () => {
    const bytes = applicationServerKeyOf(PUBLIC_KEY);

    expect(bytes?.length).toBe(65);
    expect(bytes?.[0]).toBe(4);
    expect(applicationServerKeyOf(undefined)).toBeNull();
    expect(applicationServerKeyOf('')).toBeNull();
    expect(applicationServerKeyOf('p'.repeat(43))).toBeNull();
    // 65 bytes that are not an uncompressed point.
    expect(applicationServerKeyOf(`A${PUBLIC_KEY.slice(1)}`)).toBeNull();
  });

  it("reads a subscription's endpoint and keys, or refuses one without them", () => {
    expect(subscriptionKeysOf(subscription())).toEqual({ endpoint: ENDPOINT, ...KEYS });
    expect(
      subscriptionKeysOf({ endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT }), unsubscribe: () => Promise.resolve(true) }),
    ).toBeNull();
  });
});

describe("the page's sources", () => {
  function page(overrides: Partial<{ serviceWorker: unknown; PushManager: unknown; Notification: unknown }> = {}) {
    const navigator = ('serviceWorker' in overrides ? { serviceWorker: overrides.serviceWorker } : {}) as Navigator;
    return {
      navigator,
      ...('PushManager' in overrides ? { PushManager: overrides.PushManager } : {}),
      ...('Notification' in overrides ? { Notification: overrides.Notification } : {}),
    } as Parameters<typeof pagePushSources>[0] extends () => infer W ? W : never;
  }

  it('is supported only with a service worker container, PushManager and Notification', () => {
    const notification = { permission: 'default', requestPermission: () => Promise.resolve('granted') };

    expect(pagePushSources(() => page({ serviceWorker: {}, PushManager: {}, Notification: notification })).supported()).toBe(true);
    expect(pagePushSources(() => page({ PushManager: {}, Notification: notification })).supported()).toBe(false);
    expect(pagePushSources(() => page({ serviceWorker: {}, Notification: notification })).supported()).toBe(false);
    expect(pagePushSources(() => page({ serviceWorker: {}, PushManager: {} })).supported()).toBe(false);
  });

  it('has no push manager when no worker is registered (the dev server), and the active one when it is', async () => {
    const pushManager = manager(null);
    const none = pagePushSources(() => page({ serviceWorker: { getRegistration: () => Promise.resolve(undefined) } }));
    const active = pagePushSources(() =>
      page({ serviceWorker: { getRegistration: () => Promise.resolve({ active: {}, pushManager }) } }),
    );

    expect(await none.pushManager()).toBeNull();
    expect(await active.pushManager()).toBe(pushManager);
  });

  it('rejects, rather than answering none, when a registered worker is not ready within the budget', async () => {
    vi.useFakeTimers();
    try {
      const late = pagePushSources(() =>
        page({
          serviceWorker: {
            getRegistration: () => Promise.resolve({ active: null, pushManager: manager(null) }),
            ready: new Promise(() => undefined),
          },
        }),
      );

      const read = late.pushManager(1_000);
      const settled = expect(read).rejects.toThrow('PUSH_WORKER_NOT_READY');
      await vi.advanceTimersByTimeAsync(1_001);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the permission, treating anything unknown as unanswered', async () => {
    const notification = { permission: 'denied', requestPermission: () => Promise.resolve('granted') };
    const odd = { permission: 'something', requestPermission: () => Promise.resolve('else') };

    expect(pagePushSources(() => page({ Notification: notification })).permission()).toBe('denied');
    expect(await pagePushSources(() => page({ Notification: notification })).requestPermission()).toBe('granted');
    expect(pagePushSources(() => page({ Notification: odd })).permission()).toBe('default');
    expect(await pagePushSources(() => page({ Notification: odd })).requestPermission()).toBe('default');
  });
});

describe('the device is read again when the page comes back into view', () => {
  it('calls back on visible only, until stopped', () => {
    const listeners = new Set<() => void>();
    const page = {
      visibilityState: 'hidden',
      addEventListener: (_type: 'visibilitychange', listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: 'visibilitychange', listener: () => void) => listeners.delete(listener),
    };
    const again = vi.fn();
    const stop = whenVisibleAgain(page, again);
    const fire = () => {
      for (const listener of listeners) listener();
    };

    fire();
    page.visibilityState = 'visible';
    fire();
    stop();
    fire();

    expect(again).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
