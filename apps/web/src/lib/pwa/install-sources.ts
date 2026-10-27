import type { InstallPromptEvent, InstallSources } from '@/lib/pwa/install';

/**
 * The install store's sources over a page (story 8.4): `window` in the app,
 * a stub in the node suite, which executes them (AD-15). Touches nothing
 * until the store calls them.
 */

/**
 * Every display mode an installed app runs in, as one query list (the
 * commas are OR). A browser tab is `browser`.
 */
const INSTALLED_QUERY = [
  '(display-mode: standalone)',
  '(display-mode: fullscreen)',
  '(display-mode: minimal-ui)',
  '(display-mode: window-controls-overlay)',
].join(', ');

/**
 * Listens for changes on `query`. An older Safari's `MediaQueryList` has no
 * `addEventListener`, only the deprecated `addListener`.
 */
function onQueryChange(query: MediaQueryList, listener: () => void): () => void {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }

  query.addListener(listener);
  return () => query.removeListener(listener);
}

/** As much of `window` and `navigator` as the sources read. */
export interface InstallPage {
  matchMedia(query: string): MediaQueryList;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  readonly navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & { readonly standalone?: boolean };
}

/**
 * The store's sources over a page: `window` in the app, a stub in the node
 * suite. The page is read through `page()` on every call, never at import:
 * a module that imports the store must load where there is no `window`.
 */
export function pageInstallSources(page: () => InstallPage): InstallSources {
  return {
    standalone: () => page().matchMedia(INSTALLED_QUERY).matches || page().navigator.standalone === true,
    traits: () => ({
      userAgent: page().navigator.userAgent,
      platform: page().navigator.platform,
      maxTouchPoints: page().navigator.maxTouchPoints,
    }),
    onBeforeInstallPrompt: (listener) => {
      const target = page();
      const handle = (event: Event) => listener(event as Event & InstallPromptEvent);
      target.addEventListener('beforeinstallprompt', handle);
      return () => target.removeEventListener('beforeinstallprompt', handle);
    },
    onAppInstalled: (listener) => {
      const target = page();
      target.addEventListener('appinstalled', listener);
      return () => target.removeEventListener('appinstalled', listener);
    },
    onDisplayModeChange: (listener) => onQueryChange(page().matchMedia(INSTALLED_QUERY), listener),
  };
}
