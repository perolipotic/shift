import { Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
} from '@/features/organization/components/organization-dialog';
import { OrganizationLockup } from '@/features/organization/components/lockup';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import { NO_FILE_CHOSEN, ORGANIZATION_LOGO_ACCEPT } from '@/features/organization/services/logo';
import type { OrganizationSnapshot } from '@/features/organization/services/snapshot';
import { LOGO_DIALOG } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_DIALOG_ERROR_ID,
  ORGANIZATION_LOGO_FIELD_ID,
} from '@/features/organization/utils/element-ids';

/**
 * `Promijeni logotip` (stories 1.4b and 7.18): the logo as it stands, the
 * action that picks a file, and one Spremi that uploads it. Picking no longer
 * uploads: the file is held until Spremi, so a mistaken pick costs nothing.
 */
export function OrganizationLogoDialog({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  return (
    <OrganizationChangeDialog
      settings={settings}
      dialog={LOGO_DIALOG}
      title={t('organization.changeLogo')}
      description={t('organization.logoHint')}
    >
      <LogoForm settings={settings} organization={organization} />
    </OrganizationChangeDialog>
  );
}

/**
 * The picker and what it picked.
 *
 * THE FILE INPUT IS `sr-only` rather than hidden: it keeps its accessible name
 * and stays reachable by keyboard, while the control a pointer meets is a
 * `<Button>` that reads in Croatian — a native file input renders its own
 * chrome in the BROWSER's language. Spremi stays disabled until a file is
 * picked, and the chosen file's name says what Spremi will send.
 */
function LogoForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { logo, snapshot, pending, failure, saveLogo } = settings;
  const picker = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);

  return (
    <OrganizationDialogForm
      settings={settings}
      canSave={chosen !== null}
      onSubmit={async (event) => {
        event.preventDefault();
        if (chosen !== null) await saveLogo(chosen);
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <OrganizationLockup
          organization={organization}
          logoUrl={logo.url}
          onUnrenderable={logo.onUnrenderable}
          pending={snapshot.isPending}
          compact={false}
        />
        <input
          ref={picker}
          id={ORGANIZATION_LOGO_FIELD_ID}
          name="logo"
          type="file"
          accept={ORGANIZATION_LOGO_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];

            // RESET, so picking the same file again after a refusal still
            // fires a change: the retry a person is most likely to attempt.
            event.target.value = NO_FILE_CHOSEN;
            if (file !== undefined) setChosen(file);
          }}
          disabled={pending}
          aria-label={t('organization.logoChoose')}
          aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}
          className="sr-only"
        />
        <Button
          className="h-11"
          type="button"
          variant="dashed"
          disabled={pending}
          onClick={() => {
            picker.current?.click();
          }}
        >
          <Upload aria-hidden />
          {t('organization.logoChoose')}
        </Button>
      </div>
      {chosen === null ? null : (
        <p className="break-words text-sm text-muted-foreground">
          {t('organization.logoChosen', { name: chosen.name })}
        </p>
      )}
    </OrganizationDialogForm>
  );
}
