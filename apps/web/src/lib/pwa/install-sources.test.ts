import { describe, expect, it } from 'vitest';

import { pageInstallSources, type InstallPage } from '@/lib/pwa/install-sources';

type DisplayMode = 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui' | 'window-controls-overlay';

/**
 * A page whose `matchMedia` answers a query list (the commas are OR) for one
 * display mode, as a browser does. `legacy` gives its `MediaQueryList` only
 * the deprecated `addListener`, as an older Safari's.
 */
function fakePage(options: { mode?: DisplayMode; standalone?: boolean; legacy?: boolean } = {}) {
  let mode = options.mode ?? 'browser';
  const changes = new Set<() => void>();
  const matches = (query: string) => query.split(',').some((part) => part.trim() === `(display-mode: ${mode})`);

  const page: InstallPage = {
    matchMedia: (query) => {
      const list = {
        get matches() {
          return matches(query);
        },
        media: query,
        addListener: (listener: () => void) => changes.add(listener),
        removeListener: (listener: () => void) => changes.delete(listener),
        ...(options.legacy
          ? {}
          : {
              addEventListener: (_type: string, listener: () => void) => changes.add(listener),
              removeEventListener: (_type: string, listener: () => void) => changes.delete(listener),
            }),
      };
      return list as unknown as MediaQueryList;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    navigator: { userAgent: '', platform: '', maxTouchPoints: 0, ...(options.standalone === undefined ? {} : { standalone: options.standalone }) },
  };

  return {
    page,
    changeMode(next: DisplayMode) {
      mode = next;
      for (const listener of [...changes]) listener();
    },
    listenerCount: () => changes.size,
  };
}

describe('the page sources', () => {
  it.each(['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'] as const)(
    'the %s display mode is installed',
    (mode) => {
      expect(pageInstallSources(() => fakePage({ mode }).page).standalone()).toBe(true);
    },
  );

  it('a browser tab is not installed, unless iOS says it is', () => {
    expect(pageInstallSources(() => fakePage().page).standalone()).toBe(false);
    expect(pageInstallSources(() => fakePage({ standalone: true }).page).standalone()).toBe(true);
  });

  it.each([
    ['addEventListener', false],
    ['only the deprecated addListener', true],
  ] as const)('a display mode change reaches the store through %s, until it unsubscribes', (_name, legacy) => {
    const device = fakePage({ legacy });
    const sources = pageInstallSources(() => device.page);
    let changed = 0;

    const unsubscribe = sources.onDisplayModeChange?.(() => {
      changed += 1;
    });
    device.changeMode('minimal-ui');
    expect(changed).toBe(1);
    expect(sources.standalone()).toBe(true);

    unsubscribe?.();
    expect(device.listenerCount()).toBe(0);
  });
});
