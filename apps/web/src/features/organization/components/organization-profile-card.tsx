import { Building2 } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { OrganizationAccentDialog } from '@/features/organization/components/organization-accent-dialog';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
  OrganizationFact,
} from '@/features/organization/components/organization-dialog';
import { OrganizationLockup } from '@/features/organization/components/lockup';
import { OrganizationLogoDialog } from '@/features/organization/components/organization-logo-dialog';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import { storedAccentLabel } from '@/features/organization/utils/accent-label';
import {
  ACCENT_DIALOG,
  LOGO_DIALOG,
  NAME_DIALOG,
  PROFILE_DIALOGS,
} from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_DIALOG_ERROR_ID,
  ORGANIZATION_NAME_FIELD_ID,
  ORGANIZATION_PROFILE_HEADING_ID,
} from '@/features/organization/utils/element-ids';
import type { OrganizationSnapshot } from '@/features/organization/services/snapshot';
import { ORGANIZATION_NAME_FIELD } from '@/features/organization/services/snapshot';

/**
 * One fact with its own change: the fact on the left, `Promijeni` on the
 * right, whose accessible name names what it changes. Its own `<dl>`, because
 * a button is not a term or a description.
 */
function ProfileRow({
  label,
  changeLabel,
  opener,
  onOpen,
  children,
}: {
  readonly label: string;
  readonly changeLabel: string;
  readonly opener: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <dl className="min-w-0 flex-1">
        <OrganizationFact label={label}>{children}</OrganizationFact>
      </dl>
      <Button ref={opener} className="h-11" type="button" variant="outline" aria-label={changeLabel} onClick={onOpen}>
        {t('organization.change')}
      </Button>
    </div>
  );
}

/**
 * *Profil* (story 7.18): the name, the logo and the accent as facts, each with
 * its own `Promijeni` and its own dialog — the three disjoint writes the row
 * has always had, so one Spremi never sends two writes that could half-land.
 * The page's settings card draws it only once there is a row.
 */
export function OrganizationProfileCard({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { logo, snapshot, openers, open, saved } = settings;

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_PROFILE_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader>
          <CardTitle asChild>
            <h2 id={ORGANIZATION_PROFILE_HEADING_ID} tabIndex={-1}>{t('organization.profileHeading')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* A LANDED SAVE, said on the card its dialog closed back onto.
              `role="status"`: the assertive region belongs to a refusal. */}
          {saved !== null && PROFILE_DIALOGS.includes(saved) ? (
            <Notice role="status">{t('organization.saved')}</Notice>
          ) : null}
          <ProfileRow
            label={t('organization.name')}
            changeLabel={t('organization.changeName')}
            opener={openers.name}
            onOpen={() => {
              open(NAME_DIALOG);
            }}
          >
            {organization.name}
          </ProfileRow>
          <ProfileRow
            label={t('organization.logo')}
            changeLabel={t('organization.changeLogo')}
            opener={openers.logo}
            onOpen={() => {
              open(LOGO_DIALOG);
            }}
          >
            {/* THE LOCKUP, shared with the navigation chrome rather than
                drawn twice, and the fact in words beside it. */}
            <span className="flex min-w-0 items-center gap-3">
              <OrganizationLockup
                organization={organization}
                logoUrl={logo.url}
                onUnrenderable={logo.onUnrenderable}
                pending={snapshot.isPending}
                compact
              />
              <span>{organization.logoPath === null ? t('organization.logoMark') : t('organization.logoImage')}</span>
            </span>
          </ProfileRow>
          <ProfileRow
            label={t('organization.accent')}
            changeLabel={t('organization.changeAccent')}
            opener={openers.accent}
            onOpen={() => {
              open(ACCENT_DIALOG);
            }}
          >
            {/* WHAT THE ROW HOLDS, including an accent this build has no
                name for, which reads as its stored value. */}
            {storedAccentLabel(organization.brandAccent)}
          </ProfileRow>
        </CardContent>
      </Card>
      <OrganizationChangeDialog settings={settings} dialog={NAME_DIALOG} title={t('organization.changeName')}>
        <NameForm settings={settings} organization={organization} />
      </OrganizationChangeDialog>
      <OrganizationLogoDialog settings={settings} organization={organization} />
      <OrganizationAccentDialog settings={settings} organization={organization} />
    </>
  );
}

/** `Promijeni naziv`: the name alone, behind one Spremi. */
function NameForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { failure, refusedField, saveName } = settings;

  return (
    <OrganizationDialogForm settings={settings} onSubmit={saveName}>
      {/* NOT VALIDATED BY THE BROWSER: a blank name is refused by `0002`'s
          check, named, and the field marked and focused. */}
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_NAME_FIELD_ID}>{t('organization.name')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Building2 />
          </InputGroupIcon>
          <Input
            id={ORGANIZATION_NAME_FIELD_ID}
            name={ORGANIZATION_NAME_FIELD}
            type="text"
            required
            defaultValue={organization.name}
            aria-invalid={refusedField === ORGANIZATION_NAME_FIELD}
            aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}
            className="h-11"
          />
        </InputGroup>
      </div>
    </OrganizationDialogForm>
  );
}
