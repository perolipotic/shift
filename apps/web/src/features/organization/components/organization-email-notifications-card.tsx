import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { t } from '@/lib/i18n';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
  OrganizationFact,
} from '@/features/organization/components/organization-dialog';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import type { OrganizationSnapshot } from '@/features/organization/services/snapshot';
import { EMAIL_NOTIFICATIONS_DIALOG } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_EMAIL_NOTIFICATIONS_HEADING_ID,
  ORGANIZATION_EMAIL_NOTIFICATIONS_HINT_ID,
  ORGANIZATION_EMAIL_NOTIFICATIONS_LABEL_ID,
  ORGANIZATION_EMAIL_NOTIFICATIONS_REFUSED_DESCRIPTION,
} from '@/features/organization/utils/element-ids';
import {
  emailNotificationsMessageKey,
  emailNotificationsOf,
  emailNotificationsStatusMessageKey,
  emailNotificationsValue,
  EMAIL_NOTIFICATIONS_OPTIONS,
} from '@/features/organization/utils/email-notifications';

/**
 * *Obavijesti e-poštom* (story 10.3): whether the organization sends email
 * notifications at all. Off, no event writes an email row for any of its
 * members (`0044`'s outbox filter), and a row already queued is settled
 * unsent at its next claim.
 * The fire-rank card's shape: a fact, `Uredi`, and a dialog with one Spremi.
 */
export function OrganizationEmailNotificationsCard({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { openers, open, saved } = settings;

  return (
    <>
      <Card
        role="region"
        aria-labelledby={ORGANIZATION_EMAIL_NOTIFICATIONS_HEADING_ID}
        className="w-full min-w-0 max-w-2xl"
      >
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_EMAIL_NOTIFICATIONS_HEADING_ID} tabIndex={-1}>
              {t('organization.emailNotifications')}
            </h2>
          </CardTitle>
          <Button
            ref={openers.emailNotifications}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('organization.editEmailNotifications')}
            onClick={() => {
              open(EMAIL_NOTIFICATIONS_DIALOG);
            }}
          >
            {t('organization.edit')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {saved === EMAIL_NOTIFICATIONS_DIALOG ? (
            <Notice role="status">{t(emailNotificationsStatusMessageKey(organization.emailNotifications))}</Notice>
          ) : null}
          <dl className="grid min-w-0 gap-4">
            <OrganizationFact label={t('organization.emailNotificationsUse')}>
              {t(emailNotificationsMessageKey(organization.emailNotifications))}
            </OrganizationFact>
          </dl>
        </CardContent>
      </Card>
      <OrganizationChangeDialog
        settings={settings}
        dialog={EMAIL_NOTIFICATIONS_DIALOG}
        title={t('organization.emailNotifications')}
      >
        <EmailNotificationsForm settings={settings} organization={organization} />
      </OrganizationChangeDialog>
    </>
  );
}

/** The two choices, the one the row holds chosen, and one Spremi. */
function EmailNotificationsForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { pending, failure, saveEmailNotifications } = settings;
  const [chosen, setChosen] = useState(emailNotificationsValue(organization.emailNotifications));

  return (
    <OrganizationDialogForm
      settings={settings}
      onSubmit={async (event) => {
        event.preventDefault();
        await saveEmailNotifications(emailNotificationsOf(chosen, organization.emailNotifications));
      }}
    >
      <div className="grid gap-3">
        <p id={ORGANIZATION_EMAIL_NOTIFICATIONS_LABEL_ID} className="text-sm font-semibold leading-none">
          {t('organization.emailNotificationsUse')}
        </p>
        <RadioGroup
          value={chosen}
          onValueChange={setChosen}
          disabled={pending}
          aria-labelledby={ORGANIZATION_EMAIL_NOTIFICATIONS_LABEL_ID}
          aria-describedby={
            failure === null
              ? ORGANIZATION_EMAIL_NOTIFICATIONS_HINT_ID
              : ORGANIZATION_EMAIL_NOTIFICATIONS_REFUSED_DESCRIPTION
          }
          className="gap-1"
        >
          {EMAIL_NOTIFICATIONS_OPTIONS.map((option) => (
            <RadioRow key={emailNotificationsValue(option)} value={emailNotificationsValue(option)}>
              {t(emailNotificationsMessageKey(option))}
            </RadioRow>
          ))}
        </RadioGroup>
        <p id={ORGANIZATION_EMAIL_NOTIFICATIONS_HINT_ID} className="text-sm text-muted-foreground">
          {t('organization.emailNotificationsHint')}
        </p>
      </div>
    </OrganizationDialogForm>
  );
}
