/**
 * Web Push on `/obavijesti` (story 10.4): this DEVICE's push on/off, decided
 * from injected sources so the node suite executes it (AD-15). The page's
 * sources, over `window`, are {@link pagePushSources}; the database side is a
 * {@link PushBackend} the hook builds from the one client.
 *
 * PER DEVICE, NOT PER MEMBER. Push is on here when this browser holds a
 * subscription AND the signed-in member owns its row (`0045`). A browser
 * subscription another member registered on this device reads as off: turning
 * it on registers the same endpoint, which `register_push_subscription` hands
 * to the caller.
 *
 * THE PERMISSION PROMPT FOLLOWS A PRESS, and nothing else: only
 * {@link turnPushOn} asks, and only the control's choice calls it.
 *
 * A SESSION'S END TAKES THE DEVICE WITH IT. Off, and sign-out
 * ({@link forgetPushDevice}), delete the row and unsubscribe; every other end
 * of a session (an expiry, a revocation, a local sign-out) is caught on the
 * next signed-in load ({@link reconcilePushDevice}): a subscription the member
 * does not own, or one the permission no longer covers, is dropped.
 */

export const PUSH_SUBSCRIPTIONS_TABLE = 'push_subscriptions';
export const REGISTER_PUSH_RPC = 'register_push_subscription';

/** Logged, never rendered: the build carries no usable VAPID public key. */
export const PUSH_KEY_MISSING = 'PUSH_KEY_MISSING';
/** The on or the off could not be completed: the control returns to what is stored. */
export const PUSH_FAILED = 'PUSH_FAILED';
/** The browser's permission is denied: the screen says it is blocked in its settings. */
export const PUSH_DENIED = 'PUSH_DENIED';
/** The permission prompt was dismissed without an answer: back to off, with no failure. */
export const PUSH_DISMISSED = 'PUSH_DISMISSED';
/** Thrown by a source: a registered worker did not become active within its budget. */
export const PUSH_WORKER_NOT_READY = 'PUSH_WORKER_NOT_READY';

export type PushPermission = 'default' | 'granted' | 'denied';

/** As much of a `PushSubscription` as this module uses. */
export interface PushSubscriptionLike {
  readonly endpoint: string;
  /** The key it was made under, where the browser says (`PushSubscriptionOptions`). */
  readonly options?: { readonly applicationServerKey?: ArrayBuffer | null } | undefined;
  toJSON(): unknown;
  unsubscribe(): Promise<boolean>;
}

/** As much of a `PushManager` as this module uses. */
export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSubscriptionLike>;
}

/** Where the device is read from. Every read is a function: nothing touches the page at import. */
export interface PushSources {
  /** A service worker, `PushManager` and `Notification` are all there. */
  supported(): boolean;
  permission(): PushPermission;
  /** Asks the browser. Only {@link turnPushOn} calls it, and only a press calls that. */
  requestPermission(): Promise<PushPermission>;
  /**
   * The active worker's push manager; `null` when no worker is registered (the
   * dev server). A registered worker that does not become active within
   * `budgetMs` REJECTS ({@link PUSH_WORKER_NOT_READY}): that is worth a retry,
   * not "unsupported".
   */
  pushManager(budgetMs?: number): Promise<PushManagerLike | null>;
}

/** The member's own rows, through RLS and the register definer (`0045`). */
export interface PushBackend {
  /** Whether the signed-in member owns this endpoint's row; `undefined` when the read failed. */
  owns(endpoint: string): Promise<boolean | undefined>;
  register(subscription: { endpoint: string; p256dh: string; auth: string }): Promise<boolean>;
  /**
   * Deletes the member's own row for this endpoint: how many it deleted (0
   * when the row is someone else's, or none), or `null` when it failed.
   */
  remove(endpoint: string): Promise<number | null>;
}

/** This device, as the screen needs it. */
export type PushDevice =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'available'; readonly on: boolean };

/** The read failed: the section offers a retry. */
export const DEVICE_UNAVAILABLE: PushDevice = { kind: 'unavailable' };

/** The device after a landed choice. */
export function deviceAfter(on: boolean): PushDevice {
  return { kind: 'available', on };
}

/** Whether push is on here, when the device can be switched at all; `null` when it cannot. */
export function switchableOn(device: PushDevice | undefined): boolean | null {
  return device?.kind === 'available' ? device.on : null;
}

export type PushWriteOutcome =
  | { readonly ok: true; readonly on: boolean }
  | { readonly ok: false; readonly code: typeof PUSH_FAILED | typeof PUSH_DENIED | typeof PUSH_DISMISSED };

/**
 * The VAPID public key (unpadded base64url, 65 bytes) as the bytes
 * `subscribe` takes, or `null` when the value is not one.
 */
export function applicationServerKeyOf(value: string | undefined): Uint8Array | null {
  const key = (value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{87}$/.test(key)) return null;

  const base64 = key.replace(/-/g, '+').replace(/_/g, '/') + '=';
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  // An uncompressed P-256 point starts with 0x04.
  return bytes.length === 65 && bytes[0] === 4 ? bytes : null;
}

/** Whether this build carries a usable VAPID public key at all. */
export function pushConfigured(publicKey: string | undefined): boolean {
  return applicationServerKeyOf(publicKey) !== null;
}

/**
 * Whether `subscription` was made under `key`. A browser that does not say
 * (no `options.applicationServerKey`) is taken at its word.
 */
export function madeUnderKey(subscription: PushSubscriptionLike, key: Uint8Array): boolean {
  const made = subscription.options?.applicationServerKey;
  if (made === undefined || made === null) return true;
  const bytes = new Uint8Array(made);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/** The endpoint and the two keys of a subscription, or `null` when it does not carry them. */
export function subscriptionKeysOf(
  subscription: PushSubscriptionLike,
): { endpoint: string; p256dh: string; auth: string } | null {
  const json = subscription.toJSON() as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = typeof json?.endpoint === 'string' ? json.endpoint : subscription.endpoint;
  const p256dh = json?.keys?.p256dh;
  const auth = json?.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint === '' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return null;
  }
  return { endpoint, p256dh, auth };
}

/**
 * The permission no longer covers this device's subscription: its row (when
 * the member owns it) is deleted and the browser unsubscribed. Best-effort:
 * nothing here throws.
 */
async function dropUncovered(subscription: PushSubscriptionLike, backend: PushBackend): Promise<void> {
  try {
    if ((await backend.owns(subscription.endpoint)) === true) await backend.remove(subscription.endpoint);
  } catch {
    // Best-effort: the next load tries again.
  }
  await subscription.unsubscribe().catch(() => false);
}

/** This device's state. Never throws: a failed read is `unavailable`, and worth a retry. */
export async function readPushDevice(sources: PushSources, backend: PushBackend): Promise<PushDevice> {
  try {
    if (!sources.supported()) return { kind: 'unsupported' };
    const permission = sources.permission();

    let manager: PushManagerLike | null;
    try {
      manager = await sources.pushManager();
    } catch (cause) {
      if (permission === 'denied') return { kind: 'denied' };
      throw cause;
    }

    const subscription = manager === null ? null : await manager.getSubscription();
    if (permission !== 'granted') {
      if (subscription !== null) await dropUncovered(subscription, backend);
      if (permission === 'denied') return { kind: 'denied' };
    }
    if (manager === null) return { kind: 'unsupported' };
    if (subscription === null || permission !== 'granted') return deviceAfter(false);

    const owned = await backend.owns(subscription.endpoint);
    return owned === undefined ? DEVICE_UNAVAILABLE : deviceAfter(owned);
  } catch (cause) {
    console.error(PUSH_FAILED, cause);
    return DEVICE_UNAVAILABLE;
  }
}

const FAILED = { ok: false, code: PUSH_FAILED } as const;

/**
 * On: the permission (asked here, after the press, when not yet answered),
 * this browser's subscription (the one it holds, unless it was made under
 * another VAPID key, in which case it is replaced), and the row, registered
 * to the caller. Never throws.
 */
export async function turnPushOn(
  sources: PushSources,
  backend: PushBackend,
  publicKey: string | undefined,
): Promise<PushWriteOutcome> {
  try {
    const applicationServerKey = applicationServerKeyOf(publicKey);
    if (applicationServerKey === null) {
      console.error(PUSH_KEY_MISSING);
      return FAILED;
    }
    if (!sources.supported()) return FAILED;

    let permission = sources.permission();
    if (permission === 'default') permission = await sources.requestPermission();
    if (permission === 'denied') return { ok: false, code: PUSH_DENIED };
    if (permission !== 'granted') return { ok: false, code: PUSH_DISMISSED };

    const manager = await sources.pushManager();
    if (manager === null) return FAILED;

    let subscription = await manager.getSubscription();
    // A subscription made under a rotated key is refused by its push service
    // on every send: replace it.
    if (subscription !== null && !madeUnderKey(subscription, applicationServerKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await manager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const keys = subscriptionKeysOf(subscription);
    if (keys === null) return FAILED;

    return (await backend.register(keys)) ? { ok: true, on: true } : FAILED;
  } catch (cause) {
    console.error(PUSH_FAILED, cause);
    return FAILED;
  }
}

/**
 * Off: the row deleted, then this browser unsubscribed. No worker is a
 * failure (nothing is known). A row that cannot be deleted keeps push on (the
 * failure is shown). A delete that matched nothing means the subscription is
 * someone else's (a shared device): it is off for this member, and the
 * browser's subscription is left alone. Never throws.
 */
export async function turnPushOff(sources: PushSources, backend: PushBackend): Promise<PushWriteOutcome> {
  try {
    const manager = await sources.pushManager();
    if (manager === null) return FAILED;
    const subscription = await manager.getSubscription();
    if (subscription === null) return { ok: true, on: false };

    const deleted = await backend.remove(subscription.endpoint);
    if (deleted === null) return FAILED;

    if (deleted > 0) await subscription.unsubscribe().catch(() => false);
    return { ok: true, on: false };
  } catch (cause) {
    console.error(PUSH_FAILED, cause);
    return FAILED;
  }
}

/** How long sign-out waits for the device to be forgotten before it goes on regardless. */
export const FORGET_PUSH_BUDGET_MS = 3_000;
/** Within that: how long to wait for a worker, and for the row's delete. */
export const FORGET_WORKER_BUDGET_MS = 1_000;
export const FORGET_REMOVE_BUDGET_MS = 1_500;

const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sign-out's half (story 10.4): this device's row deleted while the session
 * still holds, and the browser ALWAYS unsubscribed (even when the delete
 * fails or runs out of time), so the next person signed in on it hears
 * nothing meant for the last. BEST-EFFORT: bounded by
 * {@link FORGET_PUSH_BUDGET_MS}, never throws, and a failure is only logged.
 */
export async function forgetPushDevice(
  sources: PushSources,
  backend: PushBackend,
  wait: (ms: number) => Promise<void> = defaultWait,
): Promise<void> {
  const forget = async (): Promise<void> => {
    if (!sources.supported()) return;
    const manager = await sources.pushManager(FORGET_WORKER_BUDGET_MS);
    const subscription = manager === null ? null : await manager.getSubscription();
    if (subscription === null) return;
    await Promise.race([backend.remove(subscription.endpoint).catch(() => null), wait(FORGET_REMOVE_BUDGET_MS)]);
    await subscription.unsubscribe().catch(() => false);
  };

  try {
    await Promise.race([forget(), wait(FORGET_PUSH_BUDGET_MS)]);
  } catch (cause) {
    console.error(PUSH_FAILED, cause);
  }
}

/**
 * Every other end of a session, caught on the next signed-in load: a browser
 * subscription the signed-in member does not own (the last person's, whose
 * session expired or was revoked) is unsubscribed; one the permission no
 * longer covers is dropped, with its row. Silent, best-effort, never throws.
 * A row that cannot be read changes nothing.
 */
export async function reconcilePushDevice(sources: PushSources, backend: PushBackend): Promise<void> {
  try {
    if (!sources.supported()) return;
    const manager = await sources.pushManager(FORGET_WORKER_BUDGET_MS);
    const subscription = manager === null ? null : await manager.getSubscription();
    if (subscription === null) return;

    if (sources.permission() !== 'granted') {
      await dropUncovered(subscription, backend);
      return;
    }
    if ((await backend.owns(subscription.endpoint)) === false) await subscription.unsubscribe().catch(() => false);
  } catch {
    // Silent: the next signed-in load tries again.
  }
}

/** As much of `document` as {@link whenVisibleAgain} uses. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Calls `listener` each time the page comes back into view (the permission
 * may have changed in the browser's settings meanwhile). Returns the stop.
 */
export function whenVisibleAgain(page: VisibilitySource, listener: () => void): () => void {
  const changed = (): void => {
    if (page.visibilityState === 'visible') listener();
  };
  page.addEventListener('visibilitychange', changed);
  return () => {
    page.removeEventListener('visibilitychange', changed);
  };
}

// ------------------------------------------------------------------ the view

export const PUSH_LOADING = 'loading';
export const PUSH_NOT_CONFIGURED = 'notConfigured';
export const PUSH_IOS_INSTALL = 'iosInstall';
export const PUSH_UNSUPPORTED = 'unsupported';
export const PUSH_DENIED_VIEW = 'denied';
export const PUSH_UNAVAILABLE = 'unavailable';
export const PUSH_CONTROL = 'control';

export type PushView =
  | { readonly kind: typeof PUSH_LOADING }
  | { readonly kind: typeof PUSH_NOT_CONFIGURED }
  | { readonly kind: typeof PUSH_IOS_INSTALL }
  | { readonly kind: typeof PUSH_UNSUPPORTED }
  | { readonly kind: typeof PUSH_DENIED_VIEW }
  | { readonly kind: typeof PUSH_UNAVAILABLE }
  | { readonly kind: typeof PUSH_CONTROL; readonly on: boolean };

/**
 * The push section's state. A build with no VAPID public key first: push is
 * unavailable here, whatever the device. Then iOS in a browser tab: push there
 * needs the installed app (iOS 16.4+), whatever the tab reports. Then no
 * support, a blocked permission, a failed read, and otherwise the on/off.
 */
export function pushViewOf(state: {
  readonly configured: boolean;
  readonly iosInstall: boolean;
  readonly device: PushDevice | undefined;
}): PushView {
  if (!state.configured) return { kind: PUSH_NOT_CONFIGURED };
  if (state.iosInstall) return { kind: PUSH_IOS_INSTALL };
  if (state.device === undefined) return { kind: PUSH_LOADING };

  switch (state.device.kind) {
    case 'unsupported':
      return { kind: PUSH_UNSUPPORTED };
    case 'denied':
      return { kind: PUSH_DENIED_VIEW };
    case 'unavailable':
      return { kind: PUSH_UNAVAILABLE };
    case 'available':
      return { kind: PUSH_CONTROL, on: state.device.on };
  }
}

/** A landed choice's status line. */
export function pushStatusMessageKey(on: boolean): 'postavkeObavijesti.pushStatusOn' | 'postavkeObavijesti.pushStatusOff' {
  return on ? 'postavkeObavijesti.pushStatusOn' : 'postavkeObavijesti.pushStatusOff';
}

/** The control's two radio values. Strings because a radio group speaks them. */
export const PUSH_ON = 'on';
export const PUSH_OFF = 'off';

export function pushValue(on: boolean): string {
  return on ? PUSH_ON : PUSH_OFF;
}

/** What the radio group hands back; anything else keeps the stored value. */
export function pushOf(value: string, stored: boolean): boolean {
  if (value === PUSH_ON) return true;
  if (value === PUSH_OFF) return false;
  return stored;
}

// ------------------------------------------------------------- the page's sources

/** How long the device read waits for a registered worker to become active. */
export const WORKER_READY_BUDGET_MS = 5_000;

interface PushWindow {
  readonly navigator: Navigator;
  readonly Notification?: { readonly permission: string; requestPermission(): Promise<string> };
  readonly PushManager?: unknown;
}

function permissionOf(value: string | undefined): PushPermission {
  return value === 'granted' || value === 'denied' ? value : 'default';
}

/**
 * The page's sources, over `window`. The push manager is the registered
 * worker's: none registered (the dev server has none) is `null` at once, and
 * one still installing is waited for, at most the budget, past which the
 * read rejects ({@link PUSH_WORKER_NOT_READY}).
 */
export function pagePushSources(page: () => PushWindow): PushSources {
  return {
    supported: () => {
      const current = page();
      return 'serviceWorker' in current.navigator && current.PushManager !== undefined && current.Notification !== undefined;
    },
    permission: () => permissionOf(page().Notification?.permission),
    requestPermission: async () => {
      const notification = page().Notification;
      if (notification === undefined) return 'denied';
      return permissionOf(await notification.requestPermission());
    },
    pushManager: async (budgetMs = WORKER_READY_BUDGET_MS) => {
      const container = page().navigator.serviceWorker as ServiceWorkerContainer | undefined;
      if (container === undefined) return null;
      const registration = await container.getRegistration();
      if (registration === undefined) return null;
      if (registration.active !== null) return registration.pushManager as unknown as PushManagerLike;

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ready = await Promise.race([
          container.ready,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), budgetMs);
          }),
        ]);
        if (ready === null) throw new Error(PUSH_WORKER_NOT_READY);
        return ready.pushManager as unknown as PushManagerLike;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
