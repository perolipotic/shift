import { CircleDashed } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { RadioCard } from '@/components/ui/radio-group';
import {
  OPTION_ACCEPT_UNCOVERED,
  RESOLUTION_ACCEPT_BODY_ID,
  RESOLUTION_ACCEPT_DESCRIBED_BY,
  RESOLUTION_ACCEPT_STRIP_ID,
  RESOLUTION_ACCEPT_TITLE_ID,
  coverageMessageKey,
  leaveHoursMessageKey,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import { t } from '@/lib/i18n';

/**
 * One term of the consequence strip: its label over its value. A `<span>`
 * throughout, because the whole card is the radio's `<button>`.
 */
function StripTerm({ label, children }: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <span className="grid min-w-0 content-start gap-0.5 break-words">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs sm:text-sm">{children}</span>
    </span>
  );
}

/**
 * The `resolution-option` card for "Prihvati kao nepokriveno" (story 5.4b;
 * UX-DR10, UX-DR11): its title, what it means, and the consequence strip in
 * its three fixed terms — coverage, the absent member's hours, the balance.
 * Three columns at every width, a phone's included. Neither preselected nor
 * styled apart: `RadioCard` draws the chosen state.
 */
export function AcceptUncoveredOption({
  view,
  optionRef,
}: {
  readonly view: ResolutionView;
  readonly optionRef: RefObject<HTMLButtonElement | null>;
}): ReactNode {
  return (
    <RadioCard
      ref={optionRef}
      value={OPTION_ACCEPT_UNCOVERED}
      aria-labelledby={RESOLUTION_ACCEPT_TITLE_ID}
      aria-describedby={RESOLUTION_ACCEPT_DESCRIBED_BY}
      footer={<ConsequenceStrip view={view} />}
    >
      <span id={RESOLUTION_ACCEPT_TITLE_ID} className="font-semibold">
        {t('raspored.resolution.acceptTitle')}
      </span>
      <span id={RESOLUTION_ACCEPT_BODY_ID} className="min-w-0 break-words text-sm text-muted-foreground">
        {t('raspored.resolution.acceptBody', { team: view.teamName })}
      </span>
    </RadioCard>
  );
}

/**
 * The strip's three fixed terms — coverage, the absent member's hours, the
 * balance — in three columns at every width, across the whole card.
 */
function ConsequenceStrip({ view }: { readonly view: ResolutionView }): ReactNode {
  return (
    <span id={RESOLUTION_ACCEPT_STRIP_ID} className="grid min-w-0 grid-cols-3 gap-2 border-t pt-3">
      <StripTerm label={t('raspored.resolution.coverageLabel')}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <span className="font-semibold tabular-nums">
            {t(coverageMessageKey(), { covered: view.covered, total: view.total })}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <CircleDashed aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{t('raspored.resolution.uncovered')}</span>
          </span>
        </span>
      </StripTerm>
      <StripTerm label={t('raspored.resolution.hoursLabel')}>
        {view.leaveHours === null
          ? t(leaveHoursMessageKey(null))
          : t(leaveHoursMessageKey(view.leaveHours), {
              hours: t(view.leaveHours.key, view.leaveHours.values),
            })}
      </StripTerm>
      <StripTerm label={t('raspored.resolution.balanceLabel')}>
        <span className="block font-semibold tabular-nums">
          {t('raspored.resolution.balance', { count: view.balanceDays })}
        </span>
        <span className="block text-muted-foreground">{t('raspored.resolution.balanceUnchanged')}</span>
      </StripTerm>
    </span>
  );
}
