import { useId, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import {
  NEXT_SHIFT_HORIZON_DAYS,
  nextShiftHeadingMessageKey,
  type NextShift,
} from '@/features/today/services/today';
import { t } from '@/lib/i18n';

/**
 * The next working shift (story 6.1a): its weekday and date, its type and
 * its range — the name alone for a type with no times — headed by how many
 * days away it is, or, from leave, the viewer's return. When none falls
 * within the horizon, a sentence says so: never an empty card.
 */
export function NextShiftCard({
  next,
  returning,
}: {
  readonly next: NextShift | null;
  readonly returning: boolean;
}): ReactNode {
  const headingId = useId();

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {next === null
            ? t('danas.next.title')
            : t(nextShiftHeadingMessageKey(returning), { days: t('count.days', { count: next.inDays }) })}
        </h2>
        {next === null ? (
          <p className="text-muted-foreground">
            {t('danas.next.none', { days: t('count.days', { count: NEXT_SHIFT_HORIZON_DAYS }) })}
          </p>
        ) : (
          <div className="grid min-w-0 gap-1">
            <p className="tabular-nums">{t('danas.dateLine', { weekday: next.weekday, date: next.text })}</p>
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold">{next.name}</span>
              {next.range === null ? null : <span className="tabular-nums">{next.range}</span>}
            </p>
          </div>
        )}
      </section>
    </Card>
  );
}
