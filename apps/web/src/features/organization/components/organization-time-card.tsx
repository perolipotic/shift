import { CalendarDays, Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  ORGANIZATION_LEAVE_DAY_FIELD,
  ORGANIZATION_LEAVE_MONTH_FIELD,
  type OrganizationSnapshot,
} from '@/features/organization/services/snapshot';
import { LEAVE_YEAR_DIALOG } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_DIALOG_ERROR_ID,
  ORGANIZATION_LEAVE_DAY_FIELD_ID,
  ORGANIZATION_LEAVE_MONTH_FIELD_ID,
  ORGANIZATION_TIME_HEADING_ID,
} from '@/features/organization/utils/element-ids';
import {
  LEAVE_START_DAYS,
  LEAVE_START_MONTHS,
  leaveYearStartLabel,
} from '@/features/organization/utils/leave-start';

/**
 * *Vrijeme i godina* (story 7.18): the timezone and the leave year's start as
 * facts, and `Uredi` in the header for the one of the two an admin may change.
 *
 * THE ZONE IS LOCKED, AND THE CARD SAYS WHY (FR-8). It is set when the
 * organization is provisioned and every date in the application resolves
 * against it, so no surface offers a control for it; a lock beside the value
 * and a sentence under the facts say so in words, never by colour or an icon
 * alone. The locale shares the sentence, and the organization type has no
 * fact at all (FR-7): it changes nothing anybody sees.
 */
export function OrganizationTimeCard({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { openers, open, saved } = settings;
  const starts = leaveYearStartLabel(organization.leaveYearStartMonth, organization.leaveYearStartDay);

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_TIME_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_TIME_HEADING_ID} tabIndex={-1}>{t('organization.timeHeading')}</h2>
          </CardTitle>
          <Button
            ref={openers.leaveYear}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={t('organization.editLeaveYear')}
            onClick={() => {
              open(LEAVE_YEAR_DIALOG);
            }}
          >
            {t('organization.edit')}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {saved === LEAVE_YEAR_DIALOG ? <Notice role="status">{t('organization.saved')}</Notice> : null}
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
            <OrganizationFact label={t('organization.timezone')}>
              <span className="inline-flex items-center gap-1.5">
                {organization.timezone}
                <Lock aria-hidden className="size-3.5 text-muted-foreground" />
                <span className="sr-only">{t('organization.timezoneLocked')}</span>
              </span>
            </OrganizationFact>
            <OrganizationFact label={t('organization.leaveYear')}>
              {starts === null ? null : t('organization.leaveYearStartsOn', { date: starts })}
            </OrganizationFact>
          </dl>
          <p className="text-sm text-muted-foreground">{t('organization.timezoneReason')}</p>
        </CardContent>
      </Card>
      <OrganizationChangeDialog settings={settings} dialog={LEAVE_YEAR_DIALOG} title={t('organization.leaveYearStart')}>
        <LeaveYearForm settings={settings} organization={organization} />
      </OrganizationChangeDialog>
    </>
  );
}

/**
 * The leave year's start: a day and a month, named together by the dialog's
 * title and each by its own label, behind one Spremi. Not a date picker: the setting recurs yearly, so a year would mean
 * nothing, and `0002:106` admits days 1-28 by SHAPE, which two closed lists
 * express and a calendar cannot. See `@/features/organization/utils/leave-start`.
 */
function LeaveYearForm({
  settings,
  organization,
}: {
  readonly settings: OrganizationSettings;
  readonly organization: OrganizationSnapshot;
}): ReactNode {
  const { pending, failure, refusedField, saveLeaveYear } = settings;

  return (
    <OrganizationDialogForm settings={settings} onSubmit={saveLeaveYear}>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
        <div className="grid min-w-0">
          <Label htmlFor={ORGANIZATION_LEAVE_DAY_FIELD_ID} className="sr-only">{t('organization.leaveYearStartDay')}</Label>
          <Select
            id={ORGANIZATION_LEAVE_DAY_FIELD_ID}
            name={ORGANIZATION_LEAVE_DAY_FIELD}
            required
            defaultValue={organization.leaveYearStartDay}
            disabled={pending}
            aria-invalid={refusedField === ORGANIZATION_LEAVE_DAY_FIELD}
            aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}
            className="h-11"
          >
            {LEAVE_START_DAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid min-w-0">
          <Label htmlFor={ORGANIZATION_LEAVE_MONTH_FIELD_ID} className="sr-only">{t('organization.leaveYearStartMonth')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <CalendarDays />
            </InputGroupIcon>
            <Select
              id={ORGANIZATION_LEAVE_MONTH_FIELD_ID}
              name={ORGANIZATION_LEAVE_MONTH_FIELD}
              required
              defaultValue={organization.leaveYearStartMonth}
              disabled={pending}
              aria-invalid={refusedField === ORGANIZATION_LEAVE_MONTH_FIELD}
              aria-describedby={failure === null ? undefined : ORGANIZATION_DIALOG_ERROR_ID}
              className="h-11"
            >
              {LEAVE_START_MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </Select>
          </InputGroup>
        </div>
      </div>
    </OrganizationDialogForm>
  );
}
