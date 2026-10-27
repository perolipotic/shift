import { createRoute, useNavigate } from '@tanstack/react-router';

import { MonthNav } from '@/components/month-nav';
import { StickyHead } from '@/components/sticky-head';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { OfflineNote } from '@/components/offline-note';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { CalendarFilters, calendarFilterSummaryOf } from '@/features/calendar/components/calendar-filters';
import { CalendarModeSwitch } from '@/features/calendar/components/calendar-mode-switch';
import { CalendarMonthBody } from '@/features/calendar/components/calendar-month-body';
import { DayDetailDialog } from '@/features/calendar/components/day-detail-dialog';
import { useCalendarScreen } from '@/features/calendar/hooks/use-calendar-screen';
import { useOverrideForm } from '@/features/calendar/hooks/use-override-form';
import { useRosterForm } from '@/features/calendar/hooks/use-roster-form';
import {
  MODE_MOJ,
  MODE_SVE,
  MONTH_HEADING_ID,
  calendarSearchOf,
  type CalendarSearch,
} from '@/features/calendar/utils/month';
import { calendarMessageKey } from '@/features/calendar/services/snapshot';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { keepFocusOnAlert } from '@/utils/retry-focus';

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
 * `?osoba=<member id>`: *Sve smjene* narrowed by the shared filter bar under
 * the month toolbar (story 7.5) — Smjena and Osoba chips, a summary of what is
 * shown and one `Poništi filtre`. A person chosen replaces the grid with their
 * day list, headed with their name, and wins over a team. The state lives in
 * the URL alone, and the bar waits for the month, so a loading screen shows
 * the toolbar and the skeleton only. *Moj raspored* shows no filters but one
 * sentence in their place: whose schedule it is, the viewer's team, and that
 * the filters belong to *Sve smjene* (deferred-work E822).
 *
 * ON A PHONE the month toolbar is a sticky head at the top of the viewport
 * while the month scrolls (`StickyHead`, deferred-work E816); the filter bar
 * follows in flow, and once it has scrolled under the head, the head shows the
 * active filters as one line.
 *
 * ONE DAY (story 3.4b): a grid cell — clicked, or Enter or Space on it — and a
 * day-list day on a team open a Dialog of that team on that date: facts only
 * since story 7.9 — the type, an admin's unresolved conflicts with "Odluči",
 * the roster and *Izmjene* — with each change in its own dialog.
 * Which day is open lives in the URL (`?dan=…&danSmjena=…`, deferred-work
 * E862): opening pushes it, so Back closes the day and Back from "Odluči"
 * reopens it; closing replaces it. Every close returns focus to the
 * opener, or to the grid's tab stop or the month heading when the opener is
 * gone.
 *
 * ONE CHANGE (story 3.5b): an admin sets a shift-type override on the open
 * day from its own dialog ("Promijeni tip smjene", story 7.9), or removes the one it has through a neutral
 * confirmation — `useOverrideForm`'s state, shown by the viewer's role and
 * decided by the database.
 *
 * ONE ROSTER CHANGE (story 3.6b): an admin takes a member off the open day's
 * shift, puts one on, or both, and removes any listed change through a
 * neutral confirmation — `useRosterForm`'s state, on the same terms.
 *
 * THE MARKS (story 5.3c): an admin sees every conflict on the month, and
 * leave as a hatch, without opening a day; a member sees their own leave and
 * nothing else. The month waits for the leave read too, and any read that
 * failed shows the one alert with a retry — a deterministic refusal shows the
 * alert alone — never a month without its marks.
 *
 * OFFLINE (story 8.2): a month read online is drawn whole from the device
 * under the as-of note (`OfflineNote`, under the heading), its time the
 * oldest of the month's reads; with any read missing, the one alert instead.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */
export function KalendarScreen() {
  const search = kalendarRoute.useSearch();
  const navigate = useNavigate({ from: kalendarRoute.fullPath });
  const screen = useCalendarScreen(search, (next, options) => {
    void navigate({
      search: next,
      replace: options?.replace ?? false,
      // A day opening or closing is a dialog over the page: the page stays where it is.
      ...(options?.keepScroll === true ? { resetScroll: false } : {}),
    });
  });
  const { snapshot, loading, refusal, month, mode } = screen;
  // The active filters as one line, for the phone's sticky head (deferred-work E816).
  const filterSummary =
    month === null || mode !== MODE_SVE ? null : calendarFilterSummaryOf(month);
  // *Moj raspored*'s one sentence in the filters' place (deferred-work E822).
  const ownNote =
    month === null || mode !== MODE_MOJ
      ? null
      : month.ownTeamName === null
        ? t('kalendar.ownNoteNoTeam')
        : t('kalendar.ownNote', { team: month.ownTeamName });
  const overrideForm = useOverrideForm(snapshot, screen.detail, screen.leaveKeys);
  const rosterForm = useRosterForm(
    snapshot,
    screen.detail,
    overrideForm.latch,
    screen.candidateLeave,
    screen.leaveKeys,
  );

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.kalendar')}</h1>
        </PageTitle>
      </PageHeader>
      <OfflineNote offline={screen.offline} />
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(calendarMessageKey(refusal))}</Notice>
          {screen.retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={screen.retry}
            >
              {t('kalendar.retry')}
            </Button>
          ) : null}
        </div>
      )}
      {refusal !== null ? null : (
        <Card className="min-w-0">
          <StickyHead summary={filterSummary}>
            <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2 sm:gap-3 sm:py-4">
              <MonthNav month={month} headingId={MONTH_HEADING_ID} onShow={screen.show} />
              {mode === null ? null : <CalendarModeSwitch chosen={mode} onChoose={screen.choose} />}
            </div>
          </StickyHead>
          {month === null || mode !== MODE_SVE ? null : <CalendarFilters shown={month} onFilter={screen.filter} />}
          {ownNote === null ? null : (
            <p className="min-w-0 px-4 pb-4 pt-2 text-sm text-muted-foreground sm:pt-0">{ownNote}</p>
          )}
          <CalendarMonthBody screen={screen} />
        </Card>
      )}
      <DayDetailDialog
        detail={screen.detail}
        snapshot={snapshot}
        conflicts={screen.dayConflicts}
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
