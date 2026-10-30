import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import type { PushSettingsState } from '@/features/notifications/hooks/use-push-settings';
import {
  PUSH_CONTROL,
  PUSH_DENIED_VIEW,
  PUSH_IOS_INSTALL,
  PUSH_LOADING,
  PUSH_NOT_CONFIGURED,
  PUSH_UNAVAILABLE,
  PUSH_UNSUPPORTED,
  pushOf,
  pushStatusMessageKey,
  pushValue,
} from '@/features/notifications/services/push';
import {
  NOTIFICATIONS_PUSH_FAILURE_ID,
  NOTIFICATIONS_PUSH_HEADING_ID,
  NOTIFICATIONS_PUSH_LABEL_ID,
} from '@/features/notifications/utils/element-ids';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/** The two options, on first, as the email control's. */
const PUSH_OPTIONS: readonly boolean[] = [true, false];

/**
 * *Obavijesti na uređaju* on `/obavijesti` (story 10.4): this device's push
 * on/off, its own section beside the email one, so a member with no address
 * still has it. On iOS in a browser tab it reads that push needs the
 * installed app; where the browser cannot receive push, or has blocked it,
 * it says so, with no control; a build with no VAPID public key says push is
 * unavailable here. The browser asks permission only after the
 * on is chosen.
 */
export function PushSettingsCard({ state }: { readonly state: PushSettingsState }): ReactNode {
  const { view } = state;

  return (
    <Card role="region" aria-labelledby={NOTIFICATIONS_PUSH_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2 id={NOTIFICATIONS_PUSH_HEADING_ID}>{t('postavkeObavijesti.pushHeading')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.kind === PUSH_LOADING ? (
          <div role="status" aria-busy className="grid animate-pulse gap-3">
            <span className="sr-only">{t('postavkeObavijesti.loading')}</span>
            <div className="h-5 w-48 rounded bg-muted" />
          </div>
        ) : null}
        {view.kind === PUSH_NOT_CONFIGURED ? <p className="text-sm">{t('postavkeObavijesti.pushNotConfigured')}</p> : null}
        {view.kind === PUSH_IOS_INSTALL ? <p className="text-sm">{t('postavkeObavijesti.pushIosInstall')}</p> : null}
        {view.kind === PUSH_UNSUPPORTED ? <p className="text-sm">{t('postavkeObavijesti.pushUnsupported')}</p> : null}
        {view.kind === PUSH_DENIED_VIEW ? <p className="text-sm">{t('postavkeObavijesti.pushDenied')}</p> : null}
        {view.kind === PUSH_UNAVAILABLE ? (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t('postavkeObavijesti.unavailable')}</Notice>
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              aria-busy={state.retrying}
              onClick={() => {
                void state.retry();
              }}
            >
              {t('postavkeObavijesti.retry')}
            </Button>
          </div>
        ) : null}
        {view.kind === PUSH_CONTROL ? (
          <>
            <p className="text-sm text-muted-foreground">{t('postavkeObavijesti.pushLede')}</p>
            <PushControl state={state} stored={view.on} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The on/off, saved on choice, with its pending, failure and saved states. */
function PushControl({ state, stored }: { readonly state: PushSettingsState; readonly stored: boolean }): ReactNode {
  const gate = useWriteGate();
  const { pending, failed, saved, save } = state;
  const shown = pending ?? stored;
  // BUSY, NEVER `disabled`, as the email control: focus stays on the group.
  const busy = pending !== null;

  return (
    <div className="grid gap-3">
      <p id={NOTIFICATIONS_PUSH_LABEL_ID} className="text-sm font-semibold leading-none">
        {t('postavkeObavijesti.pushChoice')}
      </p>
      <RadioGroup
        value={pushValue(shown)}
        onValueChange={(value) => {
          if (!gate.online || busy) return;
          void save(pushOf(value, stored));
        }}
        aria-busy={busy}
        aria-disabled={busy || gate.disabled === true ? true : undefined}
        aria-labelledby={NOTIFICATIONS_PUSH_LABEL_ID}
        aria-describedby={gate.describedBy(failed ? NOTIFICATIONS_PUSH_FAILURE_ID : null)}
        className="gap-1"
      >
        {PUSH_OPTIONS.map((option) => (
          <RadioRow key={pushValue(option)} value={pushValue(option)}>
            {option ? t('postavkeObavijesti.on') : t('postavkeObavijesti.off')}
          </RadioRow>
        ))}
      </RadioGroup>
      <OfflineWriteNote gate={gate} />
      {failed ? (
        <Notice id={NOTIFICATIONS_PUSH_FAILURE_ID} role="alert">
          {t('postavkeObavijesti.saveFailed')}
        </Notice>
      ) : null}
      {saved !== null && !failed ? <Notice role="status">{t(pushStatusMessageKey(saved))}</Notice> : null}
    </div>
  );
}
