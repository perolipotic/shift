import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

/**
 * `virtual:pwa-register/react` for the node suite (story 8.1).
 *
 * The virtual module exists only inside a Vite build with `VitePWA` in its
 * plugins, and `vitest.config.ts` deliberately does not extend
 * `vite.config.ts`. Every test that imports the route tree reaches the root
 * shell, and through it `components/update-notice.tsx`, so the specifier is
 * aliased here: no worker, never a waiting version.
 */
export function useRegisterSW(_options?: RegisterSWOptions) {
  return {
    needRefresh: [false, () => undefined] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: (_reloadPage?: boolean) => Promise.resolve(),
  };
}
