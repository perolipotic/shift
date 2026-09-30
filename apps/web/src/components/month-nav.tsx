import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * What the month navigation draws: the month's name and year, the adjacent
 * months (`null` where there is nowhere to go), and whether it is the current
 * one. A calendar month and an hours month both satisfy it.
 */
export interface MonthNavMonth {
  readonly monthName: string;
  readonly year: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly isCurrent: boolean;
}

/**
 * The month's heading and the way between months, shared by *Kalendar* and
 * *Sati* (story 4.1b): the previous month, `Ovaj mjesec` and the next month,
 * each disabled where there is nowhere to go. A placeholder bar while no month
 * is shown. The heading carries `headingId` and takes focus by it — the
 * calendar's when a closed day detail's opener is gone.
 *
 * `onShow(null)` is the current month. The copy stays under `kalendar.*`,
 * where both screens' month navigation has always read it.
 */
export function MonthNav({
  month,
  headingId,
  onShow,
}: {
  readonly month: MonthNavMonth | null;
  readonly headingId: string;
  readonly onShow: (mjesec: string | null) => void;
}): ReactNode {
  if (month === null) {
    return <div className="h-7 w-40 animate-pulse rounded-sm bg-muted" />;
  }

  return (
    <>
      <h2 id={headingId} tabIndex={-1} className="font-heading text-xl font-bold outline-none">
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
