import { createRoute, useNavigate } from '@tanstack/react-router';

import { MonthNav } from '@/components/month-nav';
import { Card } from '@/components/ui/card';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { HoursBody, HoursNotice } from '@/features/hours/components/hours-body';
import { useHours } from '@/features/hours/hooks/use-hours';
import { HOURS_MONTH_HEADING_ID, hoursSearchOf, type HoursSearch } from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Sati` — the viewer's own month of hours for a member (story 4.1b), and
 * every member's for an admin (story 4.2). This file composes the screen; its
 * one read and its state are `useHours`, its sections are components in
 * `@/features/hours/components`, and every rule is in
 * `@/features/hours/services/my-hours` and `.../organization-hours`, which
 * the node suite executes.
 *
 * ONE DESTINATION, not two. UX-DR31 lists `Sati` for the member role and
 * UX-DR32 lists it again for an admin; the human decision of 2026-09-04
 * resolved that overlap as one destination whose CONTENT is role-scoped:
 * a member reads their own month, an admin the organization's table, whose
 * team, person and sort live in the URL beside the month.
 *
 * The month is chosen in the URL (`?mjesec=2026-09`), as on the calendar, and
 * moved through the month navigation the two screens share. The figures come
 * from the calendar's ONE snapshot, under its one key. A failed read is the
 * message alone; a month whose hours the domain refuses keeps its navigation,
 * the message in place of the figures (`myHoursSurfaceOf` decides which).
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */
export function SatiScreen() {
  const search = satiRoute.useSearch();
  const navigate = useNavigate({ from: satiRoute.fullPath });
  const { view, organization, month, navShown, refusal, loading, show, change, pressColumn } = useHours(search, (next) => {
    void navigate({ search: next });
  });

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.sati')}</h1>
        </PageTitle>
      </PageHeader>
      {navShown ? (
        <Card className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-4">
            <MonthNav month={month} headingId={HOURS_MONTH_HEADING_ID} onShow={show} />
          </div>
          <HoursBody
            refusal={refusal}
            view={view}
            organization={organization}
            onChange={change}
            onPress={pressColumn}
          />
        </Card>
      ) : (
        <HoursNotice refusal={refusal} />
      )}
    </main>
  );
}

export const satiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/sati',
  validateSearch: (search: Record<string, unknown>): HoursSearch => hoursSearchOf(search),
  component: SatiScreen,
});
