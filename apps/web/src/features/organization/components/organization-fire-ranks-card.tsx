import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { t } from '@/lib/i18n';
import {
  fireRanksMessageKey,
  fireRanksOf,
  fireRanksStatusMessageKey,
  fireRanksValue,
  FIRE_RANKS_OPTIONS,
} from '@/features/members/utils/rank';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
  OrganizationFact,
} from '@/features/organization/components/organization-dialog';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import type { OrganizationSnapshot } from '@/features/organization/services/snapshot';
import { FIRE_RANKS_DIALOG } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_FIRE_RANKS_HEADING_ID,
  ORGANIZATION_FIRE_RANKS_HINT_ID,
  ORGANIZATION_FIRE_RANKS_LABEL_ID,
  ORGANIZATION_FIRE_RANKS_REFUSED_DESCRIPTION,
} from '@/features/organization/utils/element-ids';

/**
 * *Vatrogasni činovi i položaji* (member rank; a card of facts since story
 * 7.18): whether the member pages offer a rank and a position, and the roster
 * shows them. It gates display and entry ONLY: off, stored ranks and positions
 * are hidden and survive. `Uredi` opens its dialog; a landed save says what
 * the row now holds, as a sentence naming the setting.
 */
export function OrganizationFireRanksCard({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { openers, open, saved } = settings;

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_FIRE_RANKS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_FIRE_RANKS_HEADING_ID} tabIndex={-1}>{t('organization.fireRanks')}</h2>
          </CardTitle>
          <Button
            ref={openers.fireRanks}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('organization.editFireRanks')}
            onClick={() => {
              open(FIRE_RANKS_DIALOG);
            }}
          >
            {t('organization.edit')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {saved === FIRE_RANKS_DIALOG ? (
            <Notice role="status">{t(fireRanksStatusMessageKey(organization.usesFireRanks))}</Notice>
          ) : null}
          <dl className="grid min-w-0 gap-4">
            <OrganizationFact label={t('organization.fireRanksUse')}>
              {t(fireRanksMessageKey(organization.usesFireRanks))}
            </OrganizationFact>
          </dl>
        </CardContent>
      </Card>
      <OrganizationChangeDialog settings={settings} dialog={FIRE_RANKS_DIALOG} title={t('organization.fireRanks')}>
        <FireRanksForm settings={settings} organization={organization} />
      </OrganizationChangeDialog>
    </>
  );
}

/** The two choices, the one the row holds chosen, and one Spremi. */
function FireRanksForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { pending, failure, saveFireRanks } = settings;
  const [chosen, setChosen] = useState(fireRanksValue(organization.usesFireRanks));

  return (
    <OrganizationDialogForm
      settings={settings}
      onSubmit={async (event) => {
        event.preventDefault();
        await saveFireRanks(fireRanksOf(chosen, organization.usesFireRanks));
      }}
    >
      <div className="grid gap-3">
        <p id={ORGANIZATION_FIRE_RANKS_LABEL_ID} className="text-sm font-semibold leading-none">
          {t('organization.fireRanksUse')}
        </p>
        <RadioGroup
          value={chosen}
          onValueChange={setChosen}
          disabled={pending}
          aria-labelledby={ORGANIZATION_FIRE_RANKS_LABEL_ID}
          aria-describedby={failure === null ? ORGANIZATION_FIRE_RANKS_HINT_ID : ORGANIZATION_FIRE_RANKS_REFUSED_DESCRIPTION}
          className="gap-1"
        >
          {FIRE_RANKS_OPTIONS.map((option) => (
            <RadioRow key={fireRanksValue(option)} value={fireRanksValue(option)}>
              {t(fireRanksMessageKey(option))}
            </RadioRow>
          ))}
        </RadioGroup>
        <p id={ORGANIZATION_FIRE_RANKS_HINT_ID} className="text-sm text-muted-foreground">
          {t('organization.fireRanksHint')}
        </p>
      </div>
    </OrganizationDialogForm>
  );
}
