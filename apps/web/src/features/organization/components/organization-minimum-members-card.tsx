import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
  OrganizationFact,
} from '@/features/organization/components/organization-dialog';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import {
  minimumMembersOf,
  ORGANIZATION_MINIMUM_MEMBERS_FIELD,
  type OrganizationSnapshot,
} from '@/features/organization/services/snapshot';
import { MINIMUM_MEMBERS_DIALOG } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_MINIMUM_MEMBERS_FIELD_ID,
  ORGANIZATION_MINIMUM_MEMBERS_HEADING_ID,
  ORGANIZATION_MINIMUM_MEMBERS_HINT_ID,
  ORGANIZATION_MINIMUM_MEMBERS_REFUSED_DESCRIPTION,
} from '@/features/organization/utils/element-ids';

/**
 * *Najmanje ljudi u smjeni* (story 11.1; FR-70): how many people a working
 * shift needs, or not set. `domain/staffing` derives from it which shifts are
 * short-staffed; nothing on this screen reports one (stories 11.2–11.4).
 * The fire-rank card's shape: a fact, `Uredi`, and a dialog with one Spremi.
 */
export function OrganizationMinimumMembersCard({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { openers, open, saved } = settings;
  const minimum = minimumMembersOf(organization);

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_MINIMUM_MEMBERS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_MINIMUM_MEMBERS_HEADING_ID} tabIndex={-1}>
              {t('organization.minimumMembers')}
            </h2>
          </CardTitle>
          <Button
            ref={openers.minimumMembers}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('organization.editMinimumMembers')}
            onClick={() => {
              open(MINIMUM_MEMBERS_DIALOG);
            }}
          >
            {t('organization.edit')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {saved === MINIMUM_MEMBERS_DIALOG ? (
            <Notice role="status">
              {minimum === null
                ? t('organization.minimumMembersStatusNotSet')
                : t('organization.minimumMembersStatusSet', { count: minimum })}
            </Notice>
          ) : null}
          <dl className="grid min-w-0 gap-4">
            <OrganizationFact label={t('organization.minimumMembers')}>
              {minimum === null ? t('organization.minimumMembersNotSet') : String(minimum)}
            </OrganizationFact>
          </dl>
        </CardContent>
      </Card>
      <OrganizationChangeDialog settings={settings} dialog={MINIMUM_MEMBERS_DIALOG} title={t('organization.minimumMembers')}>
        <MinimumMembersForm settings={settings} organization={organization} />
      </OrganizationChangeDialog>
    </>
  );
}

/** The number, or empty, and one Spremi. */
function MinimumMembersForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { pending, failure, refusedField, saveMinimumMembers } = settings;

  return (
    <OrganizationDialogForm settings={settings} onSubmit={saveMinimumMembers}>
      {/* NOT VALIDATED BY THE BROWSER (`noValidate` on the form is the dialog's):
          an entry that is no whole number from 1 is refused by the hook, named,
          and the field marked and focused. Empty is a value: not set. NO
          `maxLength`: the browser would cut a pasted 100000 to 10000 and save
          it; the hook refuses the whole entry instead. The hint describes the
          field always, and the refusal beside it, as the radio cards' hints do. */}
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_MINIMUM_MEMBERS_FIELD_ID}>{t('organization.minimumMembers')}</Label>
        <Input
          id={ORGANIZATION_MINIMUM_MEMBERS_FIELD_ID}
          name={ORGANIZATION_MINIMUM_MEMBERS_FIELD}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          // Uncontrolled, seeded from the row (UX-DR34); not set seeds an empty field.
          defaultValue={organization.minimumMembers ?? undefined}
          disabled={pending}
          aria-invalid={refusedField === ORGANIZATION_MINIMUM_MEMBERS_FIELD}
          aria-describedby={failure === null ? ORGANIZATION_MINIMUM_MEMBERS_HINT_ID : ORGANIZATION_MINIMUM_MEMBERS_REFUSED_DESCRIPTION}
          className="h-11"
        />
        <p id={ORGANIZATION_MINIMUM_MEMBERS_HINT_ID} className="text-sm text-muted-foreground">
          {t('organization.minimumMembersHint')}
        </p>
      </div>
    </OrganizationDialogForm>
  );
}
