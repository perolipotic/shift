import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

/**
 * Story 10.4: `apps/web/public/push-sw.js`, run in a fake worker scope
 * (`self`, `clients`, `registration`) with `node:vm`, since no browser runs
 * here (AD-15). It shows what `notify` sends, and a tap opens that url on
 * this origin only.
 */

const source = readFileSync(
  join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'web', 'public', 'push-sw.js'),
  'utf8',
);
const ORIGIN = 'https://shift.example.org';

interface FakeClient {
  url: string;
  navigate?: ReturnType<typeof vi.fn>;
  focus?: ReturnType<typeof vi.fn>;
}

function worker(windows: FakeClient[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve({}));
  const matchAll = vi.fn(() => Promise.resolve(windows));
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
  };
  runInNewContext(source, { self, clients: { matchAll, openWindow }, URL });

  /** Fires `type` and answers the promise it handed to `waitUntil`. */
  const fire = async (type: string, event: Record<string, unknown>): Promise<void> => {
    let waited: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => (waited = promise) });
    await waited;
  };
  const push = (data: unknown) => fire('push', { data: { json: () => data } });
  const click = (url: unknown) => {
    const close = vi.fn();
    return fire('notificationclick', { notification: { close, data: { url } } }).then(() => close);
  };

  return { handlers, showNotification, openWindow, matchAll, push, click };
}

describe('the push handler shows what notify sends', () => {
  it('shows the title, the body, the url and the tag, with the app icon and no badge', async () => {
    const scope = worker();

    // A path, as notify sends it since retro 10 A6.
    await scope.push({ title: 'Naslov', body: 'Tijelo', url: '/prijava/dvd?povratak=%2Fgodisnji', tag: 'LEAVE_RECORDED:abc' });

    expect(scope.showNotification).toHaveBeenCalledWith('Naslov', {
      body: 'Tijelo',
      icon: '/pwa-192x192.png',
      data: { url: '/prijava/dvd?povratak=%2Fgodisnji' },
      tag: 'LEAVE_RECORDED:abc',
    });
  });

  it('still shows something for a payload that is not JSON or not an object', async () => {
    const scope = worker();
    const handler = scope.handlers.get('push');
    let waited: unknown;
    handler?.({ data: { json: () => { throw new SyntaxError('x'); } }, waitUntil: (promise: unknown) => (waited = promise) });
    await waited;
    await scope.push(null);

    expect(scope.showNotification).toHaveBeenNthCalledWith(1, 'Shift', { body: '', icon: '/pwa-192x192.png', data: { url: '/' } });
    expect(scope.showNotification).toHaveBeenCalledTimes(2);
  });
});

describe('a tap opens the url, on this origin only', () => {
  it('navigates and focuses a window the worker controls', async () => {
    const focused = {};
    const focus = vi.fn(() => Promise.resolve(focused));
    const navigate = vi.fn(() => Promise.resolve({ focus }));
    const scope = worker([{ url: `${ORIGIN}/danas`, navigate }]);

    const close = await scope.click(`${ORIGIN}/prijava/dvd?povratak=%2Fkalendar`);

    expect(close).toHaveBeenCalled();
    expect(scope.matchAll).toHaveBeenCalledWith({ type: 'window' });
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/prijava/dvd?povratak=%2Fkalendar`);
    expect(focus).toHaveBeenCalled();
    expect(scope.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window when none is controlled', async () => {
    const scope = worker([]);

    await scope.click(`${ORIGIN}/prijava/dvd?povratak=%2Fgodisnji`);

    expect(scope.openWindow).toHaveBeenCalledWith(`${ORIGIN}/prijava/dvd?povratak=%2Fgodisnji`);
  });

  it('opens a window when the navigation is refused or answers no window', async () => {
    const refused = worker([{ url: `${ORIGIN}/danas`, navigate: vi.fn(() => Promise.reject(new TypeError('no'))) }]);
    const nothing = worker([{ url: `${ORIGIN}/danas`, navigate: vi.fn(() => Promise.resolve(null)) }]);

    await refused.click(`${ORIGIN}/a`);
    await nothing.click(`${ORIGIN}/b`);

    expect(refused.openWindow).toHaveBeenCalledWith(`${ORIGIN}/a`);
    expect(nothing.openWindow).toHaveBeenCalledWith(`${ORIGIN}/b`);
  });

  it('opens the path notify sends (retro 10 A6) on its own origin, whichever origin notify was configured with', async () => {
    const navigate = vi.fn(() => Promise.resolve({ focus: vi.fn(() => Promise.resolve({})) }));
    const controlled = worker([{ url: `${ORIGIN}/danas`, navigate }]);
    const none = worker([]);

    await controlled.click('/prijava/dvd?povratak=%2Fgodisnji');
    await none.click('/prijava/dvd?povratak=%2Fkalendar');

    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/prijava/dvd?povratak=%2Fgodisnji`);
    expect(none.openWindow).toHaveBeenCalledWith(`${ORIGIN}/prijava/dvd?povratak=%2Fkalendar`);
  });

  it.each(['https://evil.example/phish', 'javascript:alert(1)', 42, undefined])('falls back to / for %j', async (url) => {
    const scope = worker([]);

    await scope.click(url);

    expect(scope.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
