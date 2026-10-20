import { useEffect, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { AbsentCard } from '@/features/today/components/absent-card';
import { AdminTodaySkeleton } from '@/features/today/components/admin-today-skeleton';
import { CoverageCard } from '@/features/today/components/coverage-card';
import { NeedsYouCard } from '@/features/today/components/needs-you-card';
import { WeekGrid } from '@/features/today/components/week-grid';
import { useAdminToday } from '@/features/today/hooks/use-admin-today';
import { ADMIN_TODAY_LOADING, ADMIN_TODAY_UNAVAILABLE } from '@/features/today/services/admin-today';
import { t } from '@/lib/i18n';

/**
 * *Danas* for an admin (story 6.3), in this order: *Treba tebe*, *Pokrivenost
 * danas*, *Odsutni danas* and *Ovaj tjedan*. The skeleton while the reads are
 * unanswered; one alert with a retry, and no figure, when a read failed or
 * what it answered cannot be trusted. `adminTodayOf` decides which; this only
 * draws it, and holds its own reads (`useAdminToday`), so the page only picks
 * the body. While its reads are pending it tells the page (`onBusy`), whose
 * `main` is `aria-busy` then too; while it is unavailable it tells the page
 * too (`onUnavailable`, story 8.2), which then shows no as-of note above it.
 */
export function AdminTodayBody({
  onBusy,
  onUnavailable,
}: {
  readonly onBusy: (busy: boolean) => void;
  readonly onUnavailable: (unavailable: boolean) => void;
}): ReactNode {
  const { adminToday, retry } = useAdminToday();
  const busy = adminToday.kind === ADMIN_TODAY_LOADING;
  const unavailable = adminToday.kind === ADMIN_TODAY_UNAVAILABLE;

  // The page's `main` is busy while these reads are, too.
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);

  // No note above an alert: nothing cached is drawn under it. Reset when the
  // body unmounts — the role changed — so a member's page never inherits it.
  useEffect(() => {
    onUnavailable(unavailable);
  }, [unavailable, onUnavailable]);
  useEffect(
    () => () => {
      onUnavailable(false);
    },
    [onUnavailable],
  );

  if (adminToday.kind === ADMIN_TODAY_LOADING) return <AdminTodaySkeleton />;

  if (adminToday.kind === ADMIN_TODAY_UNAVAILABLE) {
    return (
      <Card className="grid min-w-0 gap-2 p-4 sm:p-6">
        <Notice role="alert">{t('danas.admin.unavailable')}</Notice>
        <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={retry}>
          {t('danas.retry')}
        </Button>
      </Card>
    );
  }

  const { view } = adminToday;

  return (
    <>
      <NeedsYouCard needsYou={view.needsYou} />
      <CoverageCard coverage={view.coverage} />
      <AbsentCard absences={view.absences} />
      <WeekGrid week={view.week} />
    </>
  );
}
