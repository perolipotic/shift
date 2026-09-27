import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { MONTH_HEADING_ID } from '@/features/calendar/utils/grid-keys';
import type { CalendarMonth } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';

/**
 * The month's heading and the way between months: the previous month,
 * `Ovaj mjesec` and the next month, each disabled where there is nowhere to
 * go. A placeholder bar while no month is shown. The heading takes focus when
 * a closed day detail's opener is gone.
 */
export function CalendarMonthNav({
  month,
  onShow,
}: {
  readonly month: CalendarMonth | null;
  readonly onShow: (mjesec: string | null) => void;
}): ReactNode {
  if (month === null) {
    return <div className="h-7 w-40 animate-pulse rounded-sm bg-muted" />;
  }

  return (
    <>
      <h2 id={MONTH_HEADING_ID} tabIndex={-1} className="font-heading text-xl font-bold outline-none">
        {t('kalendar.monthHeading', { month: month.monthName, year: month.year })}
      </h2>
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 p-0"
          aria-label={t('kalendar.previous')}
          disabled={month.previous === null}
          onClick={() => {
            onShow(month.previous);
          }}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={month.isCurrent}
          onClick={() => {
            onShow(null);
          }}
        >
          {t('kalendar.current')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-11 p-0"
          aria-label={t('kalendar.next')}
          disabled={month.next === null}
          onClick={() => {
            onShow(month.next);
          }}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </>
  );
}
