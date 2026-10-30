import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import type { NotificationSettingsState } from '@/features/notifications/hooks/use-notification-settings';
import {
  emailOf,
  emailStatusMessageKey,
  emailValue,
  ledeMessageKey,
  NOTIFICATIONS_CONTROL,
  NOTIFICATIONS_LOADING,
  NOTIFICATIONS_NO_ADDRESS,
  NOTIFICATIONS_ORGANIZATION_OFF,
  NOTIFICATIONS_UNAVAILABLE,
} from '@/features/notifications/services/settings';
import {
  NOTIFICATIONS_EMAIL_FAILURE_ID,
  NOTIFICATIONS_EMAIL_HEADING_ID,
  NOTIFICATIONS_EMAIL_LABEL_ID,
} from '@/features/notifications/utils/element-ids';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/** The two options, on first: the default. */
const EMAIL_OPTIONS: readonly boolean[] = [true, false];

/**
 * *E-pošta* on `/obavijesti` (story 10.3): the member's own address, read
 * only, and their on/off, under a line saying what they are sent (by role).
 * No address reads `Nemaš upisan e-mail` with no control; the organization's
 * switch off says the organization sends no email, with no control, and to
 * an admin where it is turned back on. Both facts show when both hold. The
 * control saves on choice; the browser asks no permission (push is its own
 * section, `push-settings-card.tsx`).
 */
export function NotificationSettingsCard({ state }: { readonly state: NotificationSettingsState }): ReactNode {
  const { view } = state;

  return (
    <Card role="region" aria-labelledby={NOTIFICATIONS_EMAIL_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2 id={NOTIFICATIONS_EMAIL_HEADING_ID}>{t('postavkeObavijesti.email')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.kind === NOTIFICATIONS_LOADING ? (
          <div role="status" aria-busy className="grid animate-pulse gap-3">
            <span className="sr-only">{t('postavkeObavijesti.loading')}</span>
            <div className="h-5 w-48 rounded bg-muted" />
            <div className="h-24 rounded bg-muted" />
          </div>
        ) : null}
        {view.kind === NOTIFICATIONS_UNAVAILABLE ? (
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
        {view.kind === NOTIFICATIONS_CONTROL ? <p className="text-sm text-muted-foreground">{t(ledeMessageKey(view.admin))}</p> : null}
        {view.kind === NOTIFICATIONS_NO_ADDRESS ? <p className="text-sm">{t('postavkeObavijesti.noAddress')}</p> : null}
        {view.kind === NOTIFICATIONS_ORGANIZATION_OFF || view.kind === NOTIFICATIONS_CONTROL ? (
          <dl className="grid min-w-0 gap-1">
            <dt className="text-sm font-semibold">{t('postavkeObavijesti.address')}</dt>
            <dd className="min-w-0 break-words text-sm">{view.address}</dd>
          </dl>
        ) : null}
        {view.kind === NOTIFICATIONS_ORGANIZATION_OFF ||
        (view.kind === NOTIFICATIONS_NO_ADDRESS && view.organizationOff) ? (
          <div className="grid gap-2">
            <p className="text-sm">{t('postavkeObavijesti.organizationOff')}</p>
            {/* An admin can turn it back on: the way there, never a dead end. */}
            {view.admin ? (
              <Link
                to="/organizacija"
                className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
              >
                {t('postavkeObavijesti.organizationOffAdmin')}
              </Link>
            ) : null}
          </div>
        ) : null}
        {view.kind === NOTIFICATIONS_CONTROL ? <EmailControl state={state} stored={view.email} /> : null}
      </CardContent>
    </Card>
  );
}

/** The on/off, saved on choice, with its pending, failure and saved states. */
function EmailControl({
  state,
  stored,
}: {
  readonly state: NotificationSettingsState;
  readonly stored: boolean;
}): ReactNode {
  const gate = useWriteGate();
  const { pending, failed, saved, save } = state;
  // WHILE A WRITE IS IN FLIGHT the chosen value is drawn; otherwise the stored
  // one, so a refused write returns the control to what the database holds.
  const shown = pending ?? stored;
  // BUSY, NEVER `disabled`: a disabled group drops focus to the body mid-save.
  // While a write is in flight, or offline, the group stays focusable,
  // `aria-disabled`, and a change does nothing (the write gate's convention).
  const busy = pending !== null;

  return (
    <div className="grid gap-3">
      <p id={NOTIFICATIONS_EMAIL_LABEL_ID} className="text-sm font-semibold leading-none">
        {t('postavkeObavijesti.choice')}
      </p>
      <RadioGroup
        value={emailValue(shown)}
        onValueChange={(value) => {
          if (!gate.online || busy) return;
          void save(emailOf(value, stored));
        }}
        aria-busy={busy}
        aria-disabled={busy || gate.disabled === true ? true : undefined}
        aria-labelledby={NOTIFICATIONS_EMAIL_LABEL_ID}
        aria-describedby={gate.describedBy(failed ? NOTIFICATIONS_EMAIL_FAILURE_ID : null)}
        className="gap-1"
      >
        {EMAIL_OPTIONS.map((option) => (
          <RadioRow key={emailValue(option)} value={emailValue(option)}>
            {option ? t('postavkeObavijesti.on') : t('postavkeObavijesti.off')}
          </RadioRow>
        ))}
      </RadioGroup>
      <OfflineWriteNote gate={gate} />
      {failed ? (
        <Notice id={NOTIFICATIONS_EMAIL_FAILURE_ID} role="alert">
          {t('postavkeObavijesti.saveFailed')}
        </Notice>
      ) : null}
      {saved !== null && !failed ? <Notice role="status">{t(emailStatusMessageKey(saved))}</Notice> : null}
    </div>
  );
}
