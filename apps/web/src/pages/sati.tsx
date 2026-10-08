import { createRoute, redirect, useNavigate } from '@tanstack/react-router';

import { MonthNav } from '@/components/month-nav';
import { Card } from '@/components/ui/card';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { HoursBody, HoursNotice } from '@/features/hours/components/hours-body';
import { useHours } from '@/features/hours/hooks/use-hours';
import {
  HOURS_MONTH_HEADING_ID,
  hoursSearchOf,
  legacyHoursSearchOf,
  type HoursSearch,
} from '@/features/hours/services/my-hours';
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
 * team (`?smjena=`, since story 7.5; an old `?tim=` is redirected), person
 * and sort live in the URL beside the month.
 *
 * The month is chosen in the URL (`?mjesec=2026-09`), as on the calendar, and
 * moved through the month navigation the two screens share. The figures come
 * from the calendar's ONE snapshot, under its one key. A failed read is the
 * message alone; a month whose hours the domain refuses keeps its navigation,
 * the message in place of the figures (`myHoursSurfaceOf` decides which).
 *
 * THE CONFLICT COUNT (story 5.3d): *Sati* also waits for the leave the
 * viewer's role reads — the organization's for an admin, their own for a
 * member — and shows each member's shifts in unresolved conflict beside the
 * figures it changes none of. A read that failed shows the message with a
 * retry; a refusal reading again would repeat shows the message alone.
 *
 * THE TITLE (story 7.14): a member's page is *Moji sati*, their own month; an
 * admin's, and the page before the read names the viewer, is *Sati*.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */
export function SatiScreen() {
  const search = satiRoute.useSearch();
  const navigate = useNavigate({ from: satiRoute.fullPath });
  const { view, organization, organizationName, own, explain, month, navShown, refusal, retryable, loading, retry, show, change, pressColumn } =
    useHours(search, (next) => {
      void navigate({ search: next });
    });

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        {own ? (
          <PageTitle asChild>
            <h1>{t('sati.title.own')}</h1>
          </PageTitle>
        ) : (
          <PageTitle asChild>
            <h1>{t('nav.sati')}</h1>
          </PageTitle>
        )}
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
            organizationName={organizationName}
            onChange={change}
            onPress={pressColumn}
            explain={explain}
          />
        </Card>
      ) : (
        <HoursNotice refusal={refusal} onRetry={retryable ? retry : null} />
      )}
    </main>
  );
}

export const satiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/sati',
  validateSearch: (search: Record<string, unknown>): HoursSearch => hoursSearchOf(search),
  // STORY 7.5: `?tim=` became `?smjena=`, as on the calendar. An old URL is
  // REPLACED by the same view, every other parameter kept — never a second
  // history entry, so Back skips it.
  beforeLoad: ({ location }) => {
    const legacy = legacyHoursSearchOf(location.search as Record<string, unknown>);

    if (legacy !== null) throw redirect({ to: '/sati', search: legacy, replace: true });
  },
  component: SatiScreen,
});
