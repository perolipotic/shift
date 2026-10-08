import { useState, type ReactNode } from 'react';

import { RadioCard, RadioGroup } from '@/components/ui/radio-group';
import { t } from '@/lib/i18n';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
} from '@/features/organization/components/organization-dialog';
import { OrganizationLockup } from '@/features/organization/components/lockup';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import type { OrganizationSnapshot } from '@/features/organization/services/snapshot';
import {
  accentMessageKey,
  brandAccentOf,
  brandAccentValue,
  BRAND_ACCENT_OPTIONS,
} from '@/features/organization/utils/accent';
import { ACCENT_DIALOG } from '@/features/organization/utils/dialogs';
import { ORGANIZATION_ACCENT_FIELD } from '@/features/organization/services/snapshot';
import {
  ORGANIZATION_ACCENT_LABEL_ID,
  ORGANIZATION_ACCENT_REFUSED_DESCRIPTION,
  ORGANIZATION_ACCENT_RULE_ID,
} from '@/features/organization/utils/element-ids';

/**
 * `Promijeni naglasak` (stories 1.4c and 7.18): the curated accents as named
 * radio cards (UX-DR5) — four keys and no accent — and nothing else: no hex
 * field, no colour picker, no free-form value. Every colour in this
 * application has its contrast measured at BUILD time, and an admin-entered
 * colour would move that guarantee to runtime. The rule is said beside the
 * cards: the accent tints the lockup and the shell's edge only, never a shift,
 * and red is not offered because it is the conflicts' (UX-DR4).
 */
export function OrganizationAccentDialog({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  return (
    <OrganizationChangeDialog settings={settings} dialog={ACCENT_DIALOG} title={t('organization.changeAccent')}>
      <AccentForm settings={settings} organization={organization} />
    </OrganizationChangeDialog>
  );
}

/**
 * The cards and the one Spremi. The choice is held here, so it lives exactly
 * as long as this opening.
 *
 * WHAT IS CHOSEN AT FIRST is what the row holds — except an accent this build
 * cannot render, which no card names: then nothing is chosen, Spremi waits,
 * and the line says why. Folding it into `Neutralna` would claim the
 * organization has no accent.
 */
function AccentForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { pending, failure, refusedField, saveAccent } = settings;
  const stored = organization.brandAccent;
  const unknown = stored !== null && brandAccentOf(stored) === null;
  const [chosen, setChosen] = useState<string | null>(unknown ? null : brandAccentValue(brandAccentOf(stored)));

  return (
    <OrganizationDialogForm
      settings={settings}
      canSave={chosen !== null}
      onSubmit={async (event) => {
        event.preventDefault();
        if (chosen !== null) await saveAccent(brandAccentOf(chosen));
      }}
    >
      <div className="grid gap-3">
        <p id={ORGANIZATION_ACCENT_LABEL_ID} className="text-sm font-semibold leading-none">
          {t('organization.accent')}
        </p>
        <RadioGroup
          value={chosen}
          onValueChange={setChosen}
          disabled={pending}
          aria-labelledby={ORGANIZATION_ACCENT_LABEL_ID}
          aria-describedby={failure === null ? ORGANIZATION_ACCENT_RULE_ID : ORGANIZATION_ACCENT_REFUSED_DESCRIPTION}
          aria-invalid={refusedField === ORGANIZATION_ACCENT_FIELD}
          className="grid-cols-1 sm:grid-cols-2"
        >
          {BRAND_ACCENT_OPTIONS.map((option) => (
            <RadioCard key={brandAccentValue(option)} value={brandAccentValue(option)}>
              <span className="flex min-w-0 items-center gap-3">
                {/* THE LOCKUP'S MARK IN THAT ACCENT, the one place a tint may
                    land (UX-DR5). Hidden from assistive technology: the name
                    beside it is what the card says. */}
                <span aria-hidden className="flex shrink-0">
                  <OrganizationLockup
                    organization={{ ...organization, brandAccent: option }}
                    logoUrl={null}
                    onUnrenderable={() => undefined}
                    pending={false}
                    compact
                  />
                </span>
                <span className="text-sm font-semibold">{t(accentMessageKey(option))}</span>
              </span>
            </RadioCard>
          ))}
        </RadioGroup>
        <p id={ORGANIZATION_ACCENT_RULE_ID} className="text-sm text-muted-foreground">
          {t('organization.accentRule')}
        </p>
        {chosen === null ? (
          <p className="text-sm text-muted-foreground">
            {t('organization.accentChoose')}
          </p>
        ) : null}
      </div>
    </OrganizationDialogForm>
  );
}
