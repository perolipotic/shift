import { useSyncExternalStore } from 'react';

import { INSTALL_NOTHING, type InstallKind } from '@/lib/pwa/install';
import { pageInstall } from '@/lib/pwa/page-install';

/** What the *Instaliraj* row can do now (story 8.4), whether a prompt it opened is showing, and its one press. */
export function useInstall(): { kind: InstallKind; prompting: boolean; prompt: () => Promise<void> } {
  const { kind, prompting } = useSyncExternalStore(
    pageInstall.subscribe,
    pageInstall.snapshot,
    // No install on a server render: the row is not drawn.
    () => INSTALL_NOTHING,
  );

  return { kind, prompting, prompt: pageInstall.prompt };
}
