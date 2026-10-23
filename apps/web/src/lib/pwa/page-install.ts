import { installStore, type InstallPromptEvent } from '@/lib/pwa/install';

/**
 * The page's one install store (story 8.4), over `window` and `navigator`.
 * Built at import and touching nothing until `start`: `main.tsx` starts it
 * at its top, before any `await`, because `beforeinstallprompt` can fire
 * before the first render. The rule is `./install`'s, which the node suite
 * executes with injected sources (AD-15).
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

export const pageInstall = installStore({
  standalone: () =>
    window.matchMedia(INSTALLED_QUERY).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true,
  traits: () => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  }),
  onBeforeInstallPrompt: (listener) => {
    const handle = (event: Event) => listener(event as Event & InstallPromptEvent);
    window.addEventListener('beforeinstallprompt', handle);
    return () => window.removeEventListener('beforeinstallprompt', handle);
  },
  onAppInstalled: (listener) => {
    window.addEventListener('appinstalled', listener);
    return () => window.removeEventListener('appinstalled', listener);
  },
  onDisplayModeChange: (listener) => onQueryChange(window.matchMedia(INSTALLED_QUERY), listener),
});
