import { useRef, type ReactNode } from 'react';

import type { FilterBarHandle } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { HoursSkeleton } from '@/features/hours/components/hours-skeleton';
import { HoursSummary } from '@/features/hours/components/hours-summary';
import { OrganizationHoursExport } from '@/features/hours/components/organization-hours-export';
import { OrganizationHoursFilters } from '@/features/hours/components/organization-hours-filters';
import { OrganizationHoursTable } from '@/features/hours/components/organization-hours-table';
import {
  hoursMessageKey,
  type HoursFailure,
  type HoursSearchChange,
  type HoursSortKey,
  type MyHoursView,
} from '@/features/hours/services/my-hours';
import type { OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { t } from '@/lib/i18n';

/**
 * The one message *Sati* shows, or nothing — with its retry when `onRetry` is
 * given: a read that failed or is paused offline (`retryable`, story 5.3d),
 * never a refusal reading again would repeat.
 */
export function HoursNotice({
  refusal,
  onRetry = null,
}: {
  readonly refusal: HoursFailure | null;
  readonly onRetry?: (() => void) | null;
}): ReactNode {
  if (refusal === null) {
    return null;
  }

  return (
    <div className="grid min-w-0 gap-2">
      <Notice role="alert">{t(hoursMessageKey(refusal))}</Notice>
      {onRetry === null ? null : (
        <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={onRetry}>
          {t('sati.retry')}
        </Button>
      )}
    </div>
  );
}

/**
 * What sits under the month navigation: the message in place of the figures
 * when the domain refused them, the skeleton while the read is unanswered,
 * the organization's table for an admin (story 4.2) with its export beside
 * the filter bar (stories 4.3, 7.5), and the viewer's own
 * figures for a member (story 4.1b). `hoursSurfaceOf` decides which; this
 * only draws it.
 */
export function HoursBody({
  refusal,
  view,
  organization,
  organizationName,
  onChange,
  onPress,
}: {
  readonly refusal: HoursFailure | null;
  readonly view: MyHoursView | null;
  readonly organization: OrganizationHoursView | null;
  /** The organization's name, which the export's file name carries; `null` before the read answers. */
  readonly organizationName: string | null;
  readonly onChange: (change: HoursSearchChange) => void;
  readonly onPress: (key: HoursSortKey) => void;
}): ReactNode {
  // The filter bar's first chip: where the empty table's two actions put focus.
  const filtersRef = useRef<FilterBarHandle>(null);

  if (refusal !== null) {
    return (
      <div className="px-4 pb-4">
        <HoursNotice refusal={refusal} />
      </div>
    );
  }

  if (organization !== null) {
    return (
      <>
        <OrganizationHoursFilters view={organization} filtersRef={filtersRef} onChange={onChange} />
        {organizationName === null ? null : (
          <OrganizationHoursExport view={organization} organizationName={organizationName} />
        )}
        <OrganizationHoursTable view={organization} filtersRef={filtersRef} onChange={onChange} onPress={onPress} />
      </>
    );
  }

  if (view === null) {
    return <HoursSkeleton />;
  }

  return <HoursSummary view={view} />;
}
