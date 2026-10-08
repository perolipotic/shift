import type { HoursFigureCode } from '@shift/domain';
import { useRef, useState, type ReactNode } from 'react';

import type { FilterBarHandle } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { HoursExplanationDrawer } from '@/features/hours/components/hours-explanation';
import { HoursSkeleton } from '@/features/hours/components/hours-skeleton';
import { HoursSummary } from '@/features/hours/components/hours-summary';
import { OrganizationHoursExport } from '@/features/hours/components/organization-hours-export';
import { OrganizationHoursFilters } from '@/features/hours/components/organization-hours-filters';
import { OrganizationHoursRows } from '@/features/hours/components/organization-hours-rows';
import { OrganizationHoursTable } from '@/features/hours/components/organization-hours-table';
import {
  hoursMessageKey,
  type HoursFailure,
  type HoursSearchChange,
  type HoursSortKey,
  type MyHoursView,
} from '@/features/hours/services/my-hours';
import type { HoursExplainRequest, HoursExplanationView } from '@/features/hours/services/hours-explanation';
import type { OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { usePhone } from '@/hooks/viewport';
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
 * the filter bar (stories 4.3, 7.5) — below 640 px its stacked rows
 * instead, only one of the two in the DOM (story 7.6) — and the viewer's own
 * figures for a member (story 4.1b). `hoursSurfaceOf` decides which; this
 * only draws it. It also holds which figure's ⓘ was chosen (story 7.14) and
 * draws that figure's explanation drawer, which `explain` — the hook's, the
 * domain's — answers.
 */
export function HoursBody({
  refusal,
  view,
  organization,
  organizationName,
  onChange,
  onPress,
  explain,
}: {
  readonly refusal: HoursFailure | null;
  readonly view: MyHoursView | null;
  readonly organization: OrganizationHoursView | null;
  /** The organization's name, which the export's file name carries; `null` before the read answers. */
  readonly organizationName: string | null;
  readonly onChange: (change: HoursSearchChange) => void;
  readonly onPress: (key: HoursSortKey) => void;
  /** The explanation of a figure, or `null` when it cannot be shown. */
  readonly explain: (request: HoursExplainRequest) => HoursExplanationView | null;
}): ReactNode {
  // The filter bar's first chip: where the empty table's two actions put focus.
  const filtersRef = useRef<FilterBarHandle>(null);
  // Story 7.6: which form the organization's month takes. The sort and the
  // filters live in the URL, so crossing 640 px keeps both.
  const isPhone = usePhone();
  // Story 7.14: the figure whose ⓘ was chosen, or `null` while no drawer is open.
  const [explained, setExplained] = useState<HoursExplainRequest | null>(null);

  function ask(memberId: string | null, figure: HoursFigureCode): void {
    setExplained({ memberId, figure });
  }

  const drawer =
    explained === null ? null : (
      <HoursExplanationDrawer
        explanation={explain(explained)}
        onClose={() => {
          setExplained(null);
        }}
      />
    );

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
        {isPhone ? (
          <OrganizationHoursRows
            view={organization}
            filtersRef={filtersRef}
            onChange={onChange}
            onPress={onPress}
            onExplain={ask}
          />
        ) : (
          <OrganizationHoursTable
            view={organization}
            filtersRef={filtersRef}
            onChange={onChange}
            onPress={onPress}
            onExplain={ask}
          />
        )}
        {drawer}
      </>
    );
  }

  if (view === null) {
    return <HoursSkeleton />;
  }

  return (
    <>
      <HoursSummary
        view={view}
        onExplain={(figure) => {
          ask(null, figure);
        }}
      />
      {drawer}
    </>
  );
}
