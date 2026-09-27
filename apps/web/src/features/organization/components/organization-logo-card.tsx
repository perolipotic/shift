import { Upload } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import { OrganizationLockup } from '@/features/organization/components/lockup';
import { ORGANIZATION_LOGO_ACCEPT } from '@/features/organization/services/logo';
import { ORGANIZATION_ERROR_ID } from '@/features/organization/utils/messages';

/**
 * The settings screen's logo block (story 1.4b): the logo as it stands, or a
 * neutral mark carrying the organization's name, and the action that replaces
 * it.
 *
 * GATED ON THE SNAPSHOT, as the settings form is: there is nothing to draw a
 * mark for until the row has been read, and the mark's accessible name IS the
 * organization's name.
 *
 * The fallback says nothing. It is a mark, not a sentence — the voice rule is
 * to state the fact rather than the absence, and there is no fact here beyond
 * whose organization this is.
 *
 * THE LOGO IS A SECOND WRITE AND NOT A SIXTH FIELD: `chooseLogo` hands the
 * file to the hook, whose `uploadLogo` writes `{ logoPath }` on its own
 * (`useOrganizationSettings` says why). NOTHING ANNOUNCES AN ABSENCE: `Nema` is
 * banned from every built chunk by `test/localization-applied.test.ts`. The
 * file input itself is `sr-only` rather than hidden:
 * it keeps its accessible name and stays reachable by keyboard, while the
 * control a pointer meets is a `<Button>` that reads in Croatian. A native file
 * input renders its own chrome in the BROWSER's language.
 */
export function OrganizationLogoCard({
  settings,
}: {
  readonly settings: OrganizationSettings;
}): ReactNode {
  const {
    snapshot,
    organization,
    refusal,
    logo,
    logoField,
    busy,
    uploadingLogo,
    chooseLogo,
    openLogoPicker,
  } = settings;

  if (organization === null) {
    // A SKELETON THE SIZE OF THE LOCKUP, for the reason the settings card's
    // form draws one: without it the card has no logo block at all until the row
    // arrives and then grows one, which moves every control below it under
    // whatever the pointer was already heading for. Drawn by the lockup
    // itself, so the size is one fact rather than two that can disagree.
    return snapshot.isPending ? (
      <OrganizationLockup
        organization={organization}
        logoUrl={logo.url}
        onUnrenderable={logo.onUnrenderable}
        pending={snapshot.isPending}
        compact={false}
      />
    ) : null;
  }

  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-semibold leading-none">{t('organization.logo')}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{t('organization.logoHint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {/* THE LOCKUP, shared with the navigation chrome rather than drawn
            twice. The logo-or-mark decision, the accessible name, the
            broken-image fallback and the accent are four decisions, and two
            copies of them are two places for one copy to be fixed. */}
        <OrganizationLockup
          organization={organization}
          logoUrl={logo.url}
          onUnrenderable={logo.onUnrenderable}
          pending={snapshot.isPending}
          compact={false}
        />
        {/* `disabled` on the INPUT as well as on the button: only the button
            carried it, so a keyboard user reaching the control directly could
            choose a second file mid-upload and get silence. */}
        <input
          ref={logoField}
          id="organization-logo"
          name="logo"
          type="file"
          accept={ORGANIZATION_LOGO_ACCEPT}
          onChange={chooseLogo}
          disabled={busy}
          aria-label={t('organization.logoChoose')}
          aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
          className="sr-only"
        />
        <Button
          className="h-11"
          type="button"
          variant="dashed"
          disabled={busy}
          aria-busy={uploadingLogo}
          aria-describedby={refusal === null ? undefined : ORGANIZATION_ERROR_ID}
          onClick={openLogoPicker}
        >
          <Upload aria-hidden />
          {t('organization.logoChoose')}
        </Button>
      </div>
    </div>
  );
}
