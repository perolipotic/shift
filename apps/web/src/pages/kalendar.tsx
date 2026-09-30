import { createRoute, useNavigate } from '@tanstack/react-router';

import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { CalendarFilter } from '@/features/calendar/components/calendar-filter';
import { CalendarModeSwitch } from '@/features/calendar/components/calendar-mode-switch';
import { CalendarMonthBody } from '@/features/calendar/components/calendar-month-body';
import { CalendarMonthNav } from '@/features/calendar/components/calendar-month-nav';
import { DayDetailDialog } from '@/features/calendar/components/day-detail-dialog';
import { useCalendarScreen } from '@/features/calendar/hooks/use-calendar-screen';
import { useOverrideForm } from '@/features/calendar/hooks/use-override-form';
import { useRosterForm } from '@/features/calendar/hooks/use-roster-form';
import { MODE_SVE, calendarSearchOf, type CalendarSearch } from '@/features/calendar/utils/month';
import { calendarMessageKey } from '@/features/calendar/services/snapshot';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Kalendar` — one month, every active team (story 3.1). This file composes
 * the screen; its state, its one read and its handlers are
 * `useCalendarScreen` (the day detail's, `useDayDetail`), its sections are
 * components in `@/features/calendar/components`, and every rule is in
 * `@/features/calendar/services/snapshot` and `@/features/calendar/utils`,
 * which the node suite executes.
 *
 * Member and admin alike (UX-DR31/UX-DR32): the same grid, a row per date and
 * a column per active team, each cell the shift type that team works that
 * day. The month is chosen in the URL (`?mjesec=2026-09`) — a SEARCH
 * PARAMETER, not a child route, so `router.test.ts`'s unmatched deep link
 * still lands on the root's not-found.
 *
 * TWO MODES (story 3.2a), `?prikaz=moj|sve`: *Moj raspored*, the viewer's
 * own day list, and *Sve smjene*, the grid. With no `prikaz`, a member-role
 * account below 640 px lands on the day list and everyone else on the grid.
 * Below 640 px the grid is COMPRESSED by CSS alone — one letter per team
 * header and per cell, the full names `sr-only` — and is the same table.
 *
 * THE GRID IS AN ARIA GRID (story 3.2b), full and compressed alike: one tab
 * stop, the arrows, Home and End moving focus by `@/features/calendar/utils/grid-keys`,
 * and every data cell a `gridcell` named in full. The legend shows only while
 * a mark is on screen. The day list stays a plain list.
 *
 * ONE TEAM (story 3.3a), `?smjena=<team id>`, and ONE PERSON (story 3.3b),
 * `?osoba=<member id>`: *Sve smjene* narrowed by a native `Select` above the
 * grid, with a reset while either is chosen. A person chosen replaces the grid
 * with their day list, headed with their name, and wins over a team. The state
 * lives in the URL alone.
 *
 * ONE DAY (story 3.4b): a grid cell — clicked, or Enter or Space on it — and a
 * day-list day on a team open a read-only Dialog of that team on that date.
 * Which day is open lives in `useState`, not in the URL, and every close
 * returns focus to the opener, or to the grid's tab stop or the month heading
 * when the opener is gone.
 *
 * ONE CHANGE (story 3.5b): an admin sets a shift-type override on the open
 * day from its Dialog, or removes the one it has through a neutral
 * confirmation — `useOverrideForm`'s state, shown by the viewer's role and
 * decided by the database.
 *
 * ONE ROSTER CHANGE (story 3.6b): an admin takes a member off the open day's
 * shift, puts one on, or both, and removes any listed change through a
 * neutral confirmation — `useRosterForm`'s state, on the same terms.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */
export function KalendarScreen() {
  const search = kalendarRoute.useSearch();
  const navigate = useNavigate({ from: kalendarRoute.fullPath });
  const screen = useCalendarScreen(search, (next) => {
    void navigate({ search: next });
  });
  const { snapshot, loading, refusal, month, mode } = screen;
  const overrideForm = useOverrideForm(snapshot, screen.detail);
  const rosterForm = useRosterForm(snapshot, screen.detail, overrideForm.latch);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.kalendar')}</h1>
        </PageTitle>
      </PageHeader>
      {refusal === null ? null : <Notice role="alert">{t(calendarMessageKey(refusal))}</Notice>}
      {refusal !== null ? null : (
        <Card className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-4">
            <CalendarMonthNav month={month} onShow={screen.show} />
            {mode === null ? null : <CalendarModeSwitch chosen={mode} onChoose={screen.choose} />}
          </div>
          {month === null || mode !== MODE_SVE ? null : (
            <CalendarFilter
              shown={month}
              filterRef={screen.filterRef}
              onFilter={screen.filter}
              onReset={screen.resetFilter}
            />
          )}
          <CalendarMonthBody screen={screen} />
        </Card>
      )}
      <DayDetailDialog
        detail={screen.detail}
        snapshot={snapshot}
        form={overrideForm}
        roster={rosterForm}
        onClose={screen.closeDay}
        onClosedByBrowser={screen.closedByBrowser}
      />
    </main>
  );
}

export const kalendarRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/kalendar',
  validateSearch: (search: Record<string, unknown>): CalendarSearch => calendarSearchOf(search),
  component: KalendarScreen,
});
