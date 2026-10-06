import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { NextShiftCard } from '@/features/today/components/next-shift-card';
import { TodayCard } from '@/features/today/components/today-card';
import { TodaySkeleton } from '@/features/today/components/today-skeleton';
import { WeekList } from '@/features/today/components/week-list';
import {
  TODAY_LOADING,
  TODAY_UNAVAILABLE,
  TODAY_UNSCHEDULED,
  todayMessageKey,
  type Today,
} from '@/features/today/services/today';
import { t } from '@/lib/i18n';

/**
 * What *Danas* shows above the team line (story 6.1a), in phone priority
 * order: the skeleton while the reads are unanswered; one alert, with a retry
 * where reading again can help, and no case when a read failed or what it
 * answered cannot be trusted; the viewer's own sentence when they have no
 * membership; and otherwise today's card, the next shift and the week.
 * `todayOf` decides which; this only draws it.
 */
export function TodayBody({ today, onRetry }: { readonly today: Today; readonly onRetry: () => void }): ReactNode {
  if (today.kind === TODAY_LOADING) return <TodaySkeleton />;

  if (today.kind === TODAY_UNAVAILABLE) {
    return (
      <Card className="grid min-w-0 gap-2 p-4 sm:p-6">
        <Notice role="alert">{t(todayMessageKey(today.kind))}</Notice>
        {today.retryable ? (
          <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={onRetry}>
            {t('danas.retry')}
          </Button>
        ) : null}
      </Card>
    );
  }

  if (today.kind === TODAY_UNSCHEDULED) {
    return (
      <Card className="min-w-0 p-4 sm:p-6">
        <p>{t(todayMessageKey(today.kind))}</p>
      </Card>
    );
  }

  const { view } = today;

  return (
    <>
      <TodayCard todayCase={view.todayCase} />
      <NextShiftCard next={view.next} returning={view.returning} />
      <WeekList week={view.week} />
    </>
  );
}
