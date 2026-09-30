import type { ReactNode } from 'react';

import { Notice } from '@/components/ui/notice';
import { HoursSkeleton } from '@/features/hours/components/hours-skeleton';
import { HoursSummary } from '@/features/hours/components/hours-summary';
import { hoursMessageKey, type HoursFailure, type MyHoursView } from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';

/** The one message *Sati* shows, or nothing. */
export function HoursNotice({ refusal }: { readonly refusal: HoursFailure | null }): ReactNode {
  if (refusal === null) {
    return null;
  }

  return <Notice role="alert">{t(hoursMessageKey(refusal))}</Notice>;
}

/**
 * What sits under the month navigation (story 4.1b): the message in place of
 * the figures when the domain refused them, the skeleton while the read is
 * unanswered, and the figures once it is. `myHoursSurfaceOf` decides which;
 * this only draws it.
 */
export function HoursBody({
  refusal,
  view,
}: {
  readonly refusal: HoursFailure | null;
  readonly view: MyHoursView | null;
}): ReactNode {
  if (refusal !== null) {
    return (
      <div className="px-4 pb-4">
        <HoursNotice refusal={refusal} />
      </div>
    );
  }

  if (view === null) {
    return <HoursSkeleton />;
  }

  return <HoursSummary view={view} />;
}
