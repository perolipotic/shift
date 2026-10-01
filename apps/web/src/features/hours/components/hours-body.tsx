import type { ReactNode } from 'react';

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

/** The one message *Sati* shows, or nothing. */
export function HoursNotice({ refusal }: { readonly refusal: HoursFailure | null }): ReactNode {
  if (refusal === null) {
    return null;
  }

  return <Notice role="alert">{t(hoursMessageKey(refusal))}</Notice>;
}

/**
 * What sits under the month navigation: the message in place of the figures
 * when the domain refused them, the skeleton while the read is unanswered,
 * the organization's table for an admin (story 4.2) with its export beside
 * the filters (story 4.3), and the viewer's own
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
        <OrganizationHoursFilters view={organization} onChange={onChange} />
        {organizationName === null ? null : (
          <OrganizationHoursExport view={organization} organizationName={organizationName} />
        )}
        <OrganizationHoursTable view={organization} onPress={onPress} />
      </>
    );
  }

  if (view === null) {
    return <HoursSkeleton />;
  }

  return <HoursSummary view={view} />;
}
