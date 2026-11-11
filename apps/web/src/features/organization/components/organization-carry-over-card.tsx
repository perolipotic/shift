import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarDots } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { t } from '@/lib/i18n';
import {
  OrganizationChangeDialog,
  OrganizationDialogForm,
  OrganizationFact,
} from '@/features/organization/components/organization-dialog';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import {
  carryOverOf,
  ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD,
  ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD,
  ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD,
  ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD,
  type OrganizationSnapshot,
} from '@/features/organization/services/snapshot';
import { CARRY_OVER_EXPIRY_DAYS, carryOverFactValues } from '@/features/organization/utils/carry-over';
import { CARRY_OVER_DIALOG } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD_ID,
  ORGANIZATION_CARRY_OVER_EXPIRY_LABEL_ID,
  ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD_ID,
  ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD_ID,
  ORGANIZATION_CARRY_OVER_FIRST_YEAR_HINT_ID,
  ORGANIZATION_CARRY_OVER_FIRST_YEAR_REFUSED_DESCRIPTION,
  ORGANIZATION_CARRY_OVER_HEADING_ID,
  ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD_ID,
  ORGANIZATION_CARRY_OVER_MAX_DAYS_HINT_ID,
  ORGANIZATION_CARRY_OVER_MAX_DAYS_REFUSED_DESCRIPTION,
  ORGANIZATION_DIALOG_ERROR_ID,
} from '@/features/organization/utils/element-ids';
import { LEAVE_START_MONTHS } from '@/features/organization/utils/leave-start';
import { NO_TEXT } from '@/utils/text';

/** The empty choice of a select: no expiry chosen yet. The product sets no default (DI-8). */
const NO_CHOICE = NO_TEXT;

/**
 * *Prijenos godišnjeg* (story 13.4): how many unused days carry into the next
 * leave year, when they expire, and the first leave year carried into, or no
 * carry-over. Only the setting: nothing on any surface derives carried days
 * from it yet (13.4b). Minimum members' shape: a fact, `Uredi`, and a dialog
 * with one Spremi.
 */
export function OrganizationCarryOverCard({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { openers, open, saved } = settings;
  const carryOver = carryOverOf(organization);

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_CARRY_OVER_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_CARRY_OVER_HEADING_ID} tabIndex={-1}>
              {t('organization.carryOver')}
            </h2>
          </CardTitle>
          <Button
            ref={openers.carryOver}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('organization.editCarryOver')}
            onClick={() => {
              open(CARRY_OVER_DIALOG);
            }}
          >
            {t('organization.edit')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {saved === CARRY_OVER_DIALOG ? (
            <Notice role="status">
              {carryOver === null
                ? t('organization.carryOverStatusNone')
                : t('organization.carryOverStatusSet', carryOverFactValues(carryOver))}
            </Notice>
          ) : null}
          <dl className="grid min-w-0 gap-4">
            <OrganizationFact label={t('organization.carryOver')}>
              {carryOver === null ? t('organization.carryOverNone') : t('organization.carryOverFact', carryOverFactValues(carryOver))}
            </OrganizationFact>
          </dl>
        </CardContent>
      </Card>
      <OrganizationChangeDialog settings={settings} dialog={CARRY_OVER_DIALOG} title={t('organization.carryOver')}>
        <CarryOverForm settings={settings} organization={organization} />
      </OrganizationChangeDialog>
    </>
  );
}

/**
 * The cap, the expiry's day and month, and the first leave year, behind one
 * Spremi. NOT VALIDATED BY THE BROWSER (`noValidate` is the dialog form's): an
 * entry `0057` would refuse is refused by the hook, named, and its field
 * marked and focused. An empty or zero cap is a value: no carry-over,
 * whatever the other fields hold. NO `maxLength` on either text field, for minimum
 * members' reason: the hook refuses the whole entry instead of the browser
 * cutting it. The day lists 1 to 31 whatever the month; a day the month does
 * not have is refused on Spremi, as the database would.
 */
function CarryOverForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { pending, failure, refusedField, saveCarryOver } = settings;
  // THE SAME READ AS THE FACT: a malformed or pre-0057 cached value seeds an
  // empty form, never one pre-filled under a card that says *Bez prijenosa*.
  const stored = carryOverOf(organization);

  return (
    <OrganizationDialogForm settings={settings} onSubmit={saveCarryOver}>
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD_ID}>{t('organization.carryOverMaxDays')}</Label>
        <Input
          id={ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD_ID}
          name={ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          // Uncontrolled, seeded from the row (UX-DR34); no carry-over seeds
          // an empty field.
          defaultValue={stored?.maxDays ?? undefined}
          disabled={pending}
          aria-invalid={refusedField === ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD}
          aria-describedby={failure === null ? ORGANIZATION_CARRY_OVER_MAX_DAYS_HINT_ID : ORGANIZATION_CARRY_OVER_MAX_DAYS_REFUSED_DESCRIPTION}
          className="h-11"
        />
        <p id={ORGANIZATION_CARRY_OVER_MAX_DAYS_HINT_ID} className="text-sm text-muted-foreground">
          {t('organization.carryOverMaxDaysHint')}
        </p>
      </div>
      <div role="group" aria-labelledby={ORGANIZATION_CARRY_OVER_EXPIRY_LABEL_ID} className="grid gap-2">
        <p id={ORGANIZATION_CARRY_OVER_EXPIRY_LABEL_ID} className="text-sm font-medium">
          {t('organization.carryOverExpiry')}
        </p>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
          <div className="grid min-w-0">
            <Label htmlFor={ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD_ID} className="sr-only">
              {t('organization.carryOverExpiryDay')}
            </Label>
            <Select
              id={ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD_ID}
              name={ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD}
              defaultValue={stored?.expiryDay ?? NO_CHOICE}
              disabled={pending}
              aria-invalid={refusedField === ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD}
              aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}
              className="h-11"
            >
              <option value={NO_CHOICE}>{t('organization.carryOverExpiryDayEmpty')}</option>
              {CARRY_OVER_EXPIRY_DAYS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid min-w-0">
            <Label htmlFor={ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD_ID} className="sr-only">
              {t('organization.carryOverExpiryMonth')}
            </Label>
            <InputGroup>
              <InputGroupIcon>
                <CalendarDots />
              </InputGroupIcon>
              <Select
                id={ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD_ID}
                name={ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD}
                defaultValue={stored?.expiryMonth ?? NO_CHOICE}
                disabled={pending}
                aria-invalid={refusedField === ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD}
                aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}
                className="h-11"
              >
                <option value={NO_CHOICE}>{t('organization.carryOverExpiryMonthEmpty')}</option>
                {LEAVE_START_MONTHS.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </Select>
            </InputGroup>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD_ID}>{t('organization.carryOverFirstYear')}</Label>
        <Input
          id={ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD_ID}
          name={ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={stored?.firstLeaveYear ?? undefined}
          disabled={pending}
          aria-invalid={refusedField === ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD}
          aria-describedby={failure === null ? ORGANIZATION_CARRY_OVER_FIRST_YEAR_HINT_ID : ORGANIZATION_CARRY_OVER_FIRST_YEAR_REFUSED_DESCRIPTION}
          className="h-11"
        />
        <p id={ORGANIZATION_CARRY_OVER_FIRST_YEAR_HINT_ID} className="text-sm text-muted-foreground">
          {t('organization.carryOverFirstYearHint')}
        </p>
      </div>
    </OrganizationDialogForm>
  );
}
