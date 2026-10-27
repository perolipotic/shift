import { installStore } from '@/lib/pwa/install';
import { pageInstallSources } from '@/lib/pwa/install-sources';

/**
 * The page's one install store (story 8.4), over `window` and `navigator`.
 * Built at import and touching nothing until `start`: `main.tsx` starts it
 * at its top, before any `await`, because `beforeinstallprompt` can fire
 * before the first render. The rule is `./install`'s and the sources
 * `./install-sources`'s, and the node suite executes both (AD-15).
 */

export const pageInstall = installStore(pageInstallSources(() => window));
