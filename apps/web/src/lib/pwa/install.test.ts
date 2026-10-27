import { describe, expect, it, vi } from 'vitest';

import {
  installKindOf,
  INSTALL_NOTHING,
  installStore,
  isIos,
  PROMPT_CHOICE_TIMEOUT_MS,
  type DeviceTraits,
  type InstallPromptEvent,
  type InstallSources,
} from '@/lib/pwa/install';

const DESKTOP_CHROME: DeviceTraits = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  platform: 'Win32',
  maxTouchPoints: 0,
};
const IPHONE_SAFARI: DeviceTraits = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
};
const IPHONE_CHROME: DeviceTraits = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
};
// iPadOS asks for the desktop site: a Mac's user agent and platform.
const IPAD: DeviceTraits = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 5,
};
const MAC: DeviceTraits = { ...IPAD, maxTouchPoints: 0 };
// In-app browsers: WebKit on an iPhone, but no Add to Home Screen.
const IPHONE_INSTAGRAM: DeviceTraits = {
  ...IPHONE_SAFARI,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.2.23.88',
};
const IPHONE_FACEBOOK: DeviceTraits = {
  ...IPHONE_SAFARI,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.40.108]',
};
const IPHONE_GOOGLE_APP: DeviceTraits = {
  ...IPHONE_SAFARI,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.689 Mobile/15E148 Safari/604.1',
};
const FIREFOX_DESKTOP: DeviceTraits = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  platform: 'Linux x86_64',
  maxTouchPoints: 0,
};

function fakeSources(traits: DeviceTraits, standalone = false) {
  const waits: { ms: number; signal: AbortSignal; resolve: () => void }[] = [];
  const prompts = new Set<(event: InstallPromptEvent) => void>();
  const installs = new Set<() => void>();
  const modes = new Set<() => void>();
  let isStandalone = standalone;

  const sources: InstallSources = {
    standalone: () => isStandalone,
    traits: () => traits,
    onBeforeInstallPrompt: (listener) => {
      prompts.add(listener);
      return () => prompts.delete(listener);
    },
    onAppInstalled: (listener) => {
      installs.add(listener);
      return () => installs.delete(listener);
    },
    onDisplayModeChange: (listener) => {
      modes.add(listener);
      return () => modes.delete(listener);
    },
    wait: (ms, signal) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, signal, resolve });
      }),
  };

  return {
    sources,
    fireBeforeInstallPrompt(event: InstallPromptEvent) {
      for (const listener of prompts) listener(event);
    },
    fireAppInstalled() {
      for (const listener of installs) listener();
    },
    becomeStandalone() {
      isStandalone = true;
      for (const listener of modes) listener();
    },
    /** A browser tab leaving fullscreen (F11, a video): the mode reads browser again. */
    leaveStandalone() {
      isStandalone = false;
      for (const listener of modes) listener();
    },
    listenerCount: () => prompts.size + installs.size + modes.size,
    /** Lets every pending choice bound run out. */
    timeOut() {
      for (const pending of waits.splice(0)) pending.resolve();
    },
    waitedFor: () => waits.map((pending) => pending.ms),
    /** Whether every bound started so far was cancelled. */
    boundsCancelled: () => waits.every((pending) => pending.signal.aborted),
  };
}

function fakeEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  let answer: (value: { outcome: string }) => void = () => {};
  const userChoice = new Promise<{ outcome: string }>((resolve) => {
    answer = resolve;
  });
  const event = {
    preventDefault: vi.fn(),
    prompt: vi.fn(() => Promise.resolve()),
    userChoice,
    answer: () => answer({ outcome }),
  };
  return event;
}

describe('iOS is every iOS browser, iPadOS included, and no in-app browser', () => {
  it.each([
    ['iPhone Safari', IPHONE_SAFARI, true],
    ['iPhone Chrome', IPHONE_CHROME, true],
    ['Instagram\'s in-app browser', IPHONE_INSTAGRAM, false],
    ['Facebook\'s in-app browser', IPHONE_FACEBOOK, false],
    ['the Google app', IPHONE_GOOGLE_APP, false],
    ['iPadOS (desktop site)', IPAD, true],
    ['a Mac', MAC, false],
    ['Desktop Chrome', DESKTOP_CHROME, false],
    ['Firefox desktop', FIREFOX_DESKTOP, false],
  ] as const)('%s', (_name, traits, expected) => {
    expect(isIos(traits)).toBe(expected);
  });
});

describe('the kind', () => {
  it.each([
    [{ installed: true, held: true, ios: true }, 'installed'],
    [{ installed: true, held: false, ios: false }, 'installed'],
    [{ installed: false, held: true, ios: true }, 'prompt'],
    [{ installed: false, held: true, ios: false }, 'prompt'],
    [{ installed: false, held: false, ios: true }, 'ios'],
    [{ installed: false, held: false, ios: false }, 'none'],
  ] as const)('%o is %s', (state, kind) => {
    expect(installKindOf(state)).toBe(kind);
  });
});

describe('the store', () => {
  it('knows nothing before it starts', () => {
    const { sources } = fakeSources(IPHONE_SAFARI);
    expect(installStore(sources).snapshot().kind).toBe('none');
  });

  it('Chrome before the event, and Firefox desktop, show no row', () => {
    for (const traits of [DESKTOP_CHROME, FIREFOX_DESKTOP]) {
      const store = installStore(fakeSources(traits).sources);
      store.start();
      expect(store.snapshot().kind).toBe('none');
    }
  });

  it('holds the browser prompt, keeps the browser from showing it, and offers it', () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();

    const event = fakeEvent();
    device.fireBeforeInstallPrompt(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(store.snapshot().kind).toBe('prompt');
    expect(listener).toHaveBeenCalledOnce();
    // Nothing opens by itself.
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'dismissed'] as const)('drops the event after the choice (%s), until a new one', async (outcome) => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent(outcome);
    device.fireBeforeInstallPrompt(event);

    const pressed = store.prompt();
    // A second press while the prompt is open opens nothing.
    void store.prompt();
    await Promise.resolve();
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(store.snapshot().kind).toBe('prompt');

    event.answer();
    await pressed;
    expect(store.snapshot().kind).toBe('none');

    device.fireBeforeInstallPrompt(fakeEvent());
    expect(store.snapshot().kind).toBe('prompt');
  });

  it('drops an event whose prompt cannot open', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent();
    event.prompt.mockImplementation(() => Promise.reject(new Error('InvalidStateError')));
    device.fireBeforeInstallPrompt(event);

    await store.prompt();
    expect(store.snapshot().kind).toBe('none');
  });

  it('a press with nothing held does nothing', async () => {
    const store = installStore(fakeSources(DESKTOP_CHROME).sources);
    store.start();
    await expect(store.prompt()).resolves.toBeUndefined();
    expect(store.snapshot().kind).toBe('none');
  });

  it('on iOS offers the steps, and a held prompt wins', () => {
    const device = fakeSources(IPAD);
    const store = installStore(device.sources);
    store.start();
    expect(store.snapshot().kind).toBe('ios');

    device.fireBeforeInstallPrompt(fakeEvent());
    expect(store.snapshot().kind).toBe('prompt');
  });

  it.each([
    ['display-mode standalone', DESKTOP_CHROME],
    ['iOS navigator.standalone', IPHONE_SAFARI],
  ] as const)('installed (%s) shows no row, even with an event', (_name, traits) => {
    const device = fakeSources(traits, true);
    const store = installStore(device.sources);
    store.start();
    expect(store.snapshot().kind).toBe('installed');

    device.fireBeforeInstallPrompt(fakeEvent());
    expect(store.snapshot().kind).toBe('installed');
  });

  it('appinstalled hides the row and drops the event', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent();
    device.fireBeforeInstallPrompt(event);

    device.fireAppInstalled();
    expect(store.snapshot().kind).toBe('installed');

    await store.prompt();
    expect(event.prompt).not.toHaveBeenCalled();
  });

  it('a display mode that turns standalone hides the row', () => {
    const device = fakeSources(IPHONE_SAFARI);
    const store = installStore(device.sources);
    store.start();
    device.becomeStandalone();
    expect(store.snapshot().kind).toBe('installed');
  });

  it('a display mode is read fresh: a tab leaving fullscreen gets its row back, appinstalled stays', () => {
    const device = fakeSources(IPHONE_SAFARI);
    const store = installStore(device.sources);
    store.start();
    device.becomeStandalone();
    device.leaveStandalone();
    expect(store.snapshot().kind).toBe('ios');

    device.fireAppInstalled();
    device.leaveStandalone();
    expect(store.snapshot().kind).toBe('installed');
  });

  it('starts once, and its stop removes every listener', () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    const stop = store.start();

    expect(store.start()).toBe(stop);
    expect(device.listenerCount()).toBe(3);

    stop();
    expect(device.listenerCount()).toBe(0);
  });

  it('starts again after a stop (a hot reload) still installed, and the stop drops the held event', () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    const stop = store.start();
    device.fireBeforeInstallPrompt(fakeEvent());
    stop();
    expect(store.snapshot().kind).toBe('none');

    store.start();
    device.fireAppInstalled();
    store.start()();
    // The display mode still reads browser; appinstalled is remembered.
    store.start();
    expect(store.snapshot().kind).toBe('installed');
  });
});

describe('a prompt that is showing', () => {
  async function flush() {
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
  }

  it('marks the row as prompting, so a press does nothing until it settles', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent();
    device.fireBeforeInstallPrompt(event);

    const pressed = store.prompt();
    expect(store.snapshot()).toEqual({ kind: 'prompt', prompting: true });
    await store.prompt();
    expect(event.prompt).toHaveBeenCalledOnce();

    event.answer();
    await pressed;
    expect(store.snapshot()).toEqual(INSTALL_NOTHING);
  });

  it('a choice that never settles is spent after the bound, so the row is never dead', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent();
    device.fireBeforeInstallPrompt(event);

    const pressed = store.prompt();
    await flush();
    expect(device.waitedFor()).toEqual([PROMPT_CHOICE_TIMEOUT_MS]);
    expect(store.snapshot().prompting).toBe(true);

    device.timeOut();
    await pressed;
    expect(store.snapshot()).toEqual(INSTALL_NOTHING);
  });

  it('a choice that settles first cancels the bound, so no timer outlives it', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent();
    device.fireBeforeInstallPrompt(event);

    const pressed = store.prompt();
    await flush();
    expect(device.boundsCancelled()).toBe(false);

    event.answer();
    await pressed;
    expect(device.boundsCancelled()).toBe(true);
  });

  it('a prompt that never opens is bounded as well, so the row is never dead', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const event = fakeEvent();
    event.prompt.mockImplementation(() => new Promise<void>(() => {}));
    device.fireBeforeInstallPrompt(event);

    const pressed = store.prompt();
    await flush();
    expect(device.waitedFor()).toEqual([PROMPT_CHOICE_TIMEOUT_MS]);
    expect(store.snapshot().prompting).toBe(true);

    device.timeOut();
    await pressed;
    expect(store.snapshot()).toEqual(INSTALL_NOTHING);
  });

  it('a new event replaces the held one and frees the row; the old prompt settling leaves it alone', async () => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();
    const first = fakeEvent();
    device.fireBeforeInstallPrompt(first);
    const pressed = store.prompt();
    await flush();

    const second = fakeEvent();
    device.fireBeforeInstallPrompt(second);
    expect(store.snapshot()).toEqual({ kind: 'prompt', prompting: false });

    // The second can be pressed while the first still hangs.
    const again = store.prompt();
    expect(second.prompt).toHaveBeenCalledOnce();

    first.answer();
    await pressed;
    expect(store.snapshot()).toEqual({ kind: 'prompt', prompting: true });

    second.answer();
    await again;
    expect(store.snapshot()).toEqual(INSTALL_NOTHING);
  });
});

describe('the event and the sources are guarded', () => {
  it.each([
    ['no prompt', { preventDefault: vi.fn(), userChoice: Promise.resolve() }],
    ['a prompt that is not a function', { preventDefault: vi.fn(), prompt: 'yes', userChoice: Promise.resolve() }],
    ['no userChoice', { preventDefault: vi.fn(), prompt: vi.fn() }],
    ['a userChoice that is not thenable', { preventDefault: vi.fn(), prompt: vi.fn(), userChoice: { outcome: 'accepted' } }],
  ])('an event with %s is not held, and the browser keeps it', (_name, event) => {
    const device = fakeSources(DESKTOP_CHROME);
    const store = installStore(device.sources);
    store.start();

    device.fireBeforeInstallPrompt(event as unknown as InstallPromptEvent);
    expect(store.snapshot().kind).toBe('none');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['standalone', 'traits', 'onBeforeInstallPrompt', 'onAppInstalled', 'onDisplayModeChange'] as const)(
    'a %s source that throws never throws from start, and only disables the row',
    (failing) => {
      const device = fakeSources(IPHONE_SAFARI);
      const sources: InstallSources = {
        ...device.sources,
        [failing]: () => {
          throw new Error('SOURCE_FAILED');
        },
      };
      const store = installStore(sources);

      let stop: (() => void) | undefined;
      expect(() => {
        stop = store.start();
      }).not.toThrow();
      expect(store.snapshot()).toEqual(INSTALL_NOTHING);
      expect(device.listenerCount()).toBe(0);
      expect(() => stop?.()).not.toThrow();
    },
  );
});
