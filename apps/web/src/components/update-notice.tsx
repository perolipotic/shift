import { useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { reportRegistrationFailure, reportUpdateCheckFailure } from '@/lib/pwa/registration-failure';
import {
  checkForUpdatesOnResume,
  INITIAL_UPDATE_STATE,
  onNewWorkerControlling,
  onUpdateTap,
  performUpdateAction,
  type UpdateAction,
} from '@/lib/pwa/update-decision';

/**
 * The update notice (story 8.1): a new version is ready, and the member decides
 * when to load it.
 *
 * Registration runs in `prompt` mode (`vite.config.ts`), so a new service
 * worker installs and then WAITS. Nothing activates and nothing reloads until
 * the member taps *Osvježi*. An ignored notice changes nothing; the new version
 * applies on the next tap, or after every tab closes.
 *
 * ONE TAB'S TAP RELOADS ONE TAB. The plugin calls `onNeedReload` in every tab
 * once the new worker takes control, and `@/lib/pwa/update-decision` reloads
 * only the tab whose member tapped. Another tab keeps its notice, and its own
 * tap then reloads it directly. The decision is held in a ref because the hook
 * reads its callbacks once, at mount.
 *
 * An installed app resumed from the background checks for a new worker each
 * time it becomes visible, since SPA navigation never does.
 *
 * Mounted once, in the root shell, so it covers every route including sign-in.
 * Registration failing is not the member's problem: the app works as it did
 * without a worker, so the failure goes to the console
 * (`@/lib/pwa/registration-failure`) and nothing renders.
 *
 * The dev server registers no worker (no `devOptions`), so in dev and e2e this
 * always renders nothing.
 */
export function UpdateNotice() {
  const decision = useRef(INITIAL_UPDATE_STATE);

  const act = (action: UpdateAction) =>
    performUpdateAction(action, {
      reload: () => window.location.reload(),
      skipWaiting: () => void updateServiceWorker(),
    });

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: reportRegistrationFailure,
    onRegisteredSW: (_url, registration) =>
      checkForUpdatesOnResume(registration, document, reportUpdateCheckFailure),
    onNeedReload: () => {
      const next = onNewWorkerControlling(decision.current);
      decision.current = next.state;
      act(next.action);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-wrap items-center gap-3 px-6 pt-4">
      <Notice role="status" className="min-w-0 flex-1">
        {t('update.available')}
      </Notice>
      <Button
        type="button"
        className="h-11"
        onClick={() => {
          const next = onUpdateTap(decision.current);
          decision.current = next.state;
          act(next.action);
        }}
      >
        {t('update.refresh')}
      </Button>
    </div>
  );
}
