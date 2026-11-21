import { createRoute, useNavigate } from '@tanstack/react-router';

import { MonthNav } from '@/components/month-nav';
import { StickyHead } from '@/components/sticky-head';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Printer } from '@/components/ui/icon';
import { OfflineNote } from '@/components/offline-note';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageHeader, PageTitle } from '@/components/ui/page-header';
import { CalendarFilters, calendarFilterSummaryOf } from '@/features/calendar/components/calendar-filters';
import { CalendarModeSwitch } from '@/features/calendar/components/calendar-mode-switch';
import { CalendarMonthBody } from '@/features/calendar/components/calendar-month-body';
import { CalendarPrintHeader, calendarPrintHeaderOf } from '@/features/calendar/components/calendar-print-header';
import { LoanNoticeLine } from '@/features/calendar/components/loan-notice-line';
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
import { SwapProposedLine } from '@/features/swaps/components/swap-proposed-line';
import { useSwapProposed } from '@/features/swaps/hooks/use-swap-proposed';
import { usePrintMonth } from '@/hooks/print';
import { usePhone } from '@/hooks/viewport';
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
 * `?osoba=<member id>`: *Sve smjene* narrowed by the shared filter bar at the
 * top of the Card (story 7.5) — Smjena and Osoba chips, a summary of what is
 * shown and one `Poništi filtre`. A person chosen replaces the grid with their
 * day list, headed with their name, and wins over a team. The state lives in
 * the URL alone, and the bar waits for the month, so a loading screen shows
 * the toolbar and the skeleton only. *Moj raspored* shows no filters but one
 * sentence in their place: whose schedule it is, the viewer's team, and that
 * the filters belong to *Sve smjene* (deferred-work E822).
 *
 * THE MONTH CONTROL (story 15.7b) is ONE `MonthNav`, its slot chosen by
 * `usePhone()`: from 640 px a compact header control at the right of the
 * `PageHeader` row, beside the `<h1>`, and the Card opens on the mode switch;
 * below 640 px it stays in the Card's sticky head at the top of the viewport
 * while the month scrolls (`StickyHead`, deferred-work E816), the mode switch
 * beside it. Never two at once: their ids, heading and picker state would
 * collide. The filter bar follows the head in flow, and once it has scrolled
 * under the head, the head shows the active filters as one line. With the
 * read refused there is no month control, in either slot.
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
 * A SWAP PROPOSED (story 12.2): a member's day detail on their own working
 * shift links to `/kalendar/zamjena`; a landed proposal returns here, on its
 * month, with one polite status line naming the date, the shift and the
 * colleague (`useSwapProposed`).
 *
 * THE MONTH PRINTS (story 16.1, UX-DR56, decision D3): *Ispiši*, in both
 * modes once a month is drawn — from 640 px at the end of the Card's head
 * row, below it the page header's action under the title, never in the
 * phone's sticky head (its 160 px budget, deferred-work E816) — opens the
 * browser's own print dialog (`usePrintMonth`). What prints is THIS page —
 * the same snapshot, the same marks under the viewer's own visibility, never a
 * second read (AD-13) — under the print stylesheet (`index.css`, scoped by
 * `data-print-month`): A4 landscape, the shell, the page header, the sticky
 * head and the filter bar not drawn, and in their place `CalendarPrintHeader`:
 * the organization, the month, the filter in words and the time printed. The
 * legend, the loan notice and the as-of note print as the screen shows them.
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
  // Story 15.7b: the one month control's slot — the page header from 640 px, the sticky head below.
  const isPhone = usePhone();
  const monthNav =
    refusal !== null ? null : <MonthNav month={month} headingId={MONTH_HEADING_ID} onShow={screen.show} />;
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
  // STORY 16.1: the printed header, once a month is drawn.
  const { printedAt, print } = usePrintMonth();
  const printHeader = calendarPrintHeaderOf({ refused: refusal !== null, snapshot, month, mode, printedAt });
  // *Ispiši* is ONE button, its slot chosen by `usePhone()` as the month
  // control's is, the other way round: from 640 px at the end of the Card's
  // head row, below 640 px the page header's action under the title, which
  // scrolls away. The phone's sticky head holds the month toolbar alone
  // (deferred-work E816, its 160 px budget): beside the mode switch the
  // button opened a third row.
  const printAction =
    printHeader === null ? null : (
      <Button className="h-11 gap-2 px-3 sm:ml-auto" type="button" variant="outline" onClick={print}>
        <Printer aria-hidden className="size-4 shrink-0" />
        {t('print.action')}
      </Button>
    );
  // STORY 12.2: the polite line a landed swap proposal returns with.
  const { proposed: swapProposed, lineField: swapLine } = useSwapProposed();
  const overrideForm = useOverrideForm(snapshot, screen.detail, screen.leaveKeys, screen.leaveRecords);
  const rosterForm = useRosterForm(
    snapshot,
    screen.detail,
    overrideForm.latch,
    screen.candidateLeave,
    screen.leaveKeys,
    screen.leaveRecords,
  );

  return (
    <main
      data-print-month
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6 print:max-w-none print:gap-2 print:p-0"
      aria-busy={loading}
    >
      {printHeader === null ? null : <CalendarPrintHeader text={printHeader} />}
      <PageHeader className="print:hidden">
        <PageTitle asChild>
          <h1>{t('nav.kalendar')}</h1>
        </PageTitle>
        {isPhone && printAction !== null ? <PageActions>{printAction}</PageActions> : null}
        {isPhone ? null : monthNav}
      </PageHeader>
      <OfflineNote offline={screen.offline} />
      <SwapProposedLine proposed={swapProposed} lineField={swapLine} />
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
        <Card className="min-w-0 print:rounded-none print:border-0">
          {/* From 640 px the head's row holds the mode switch alone; the month is in the page header.
              Until the mode is known there it has nothing to hold, so no empty row opens the Card. */}
          {!isPhone && mode === null ? null : (
            <StickyHead summary={filterSummary}>
              <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2 sm:gap-3 sm:py-4">
                {isPhone ? monthNav : null}
                {mode === null ? null : <CalendarModeSwitch chosen={mode} onChoose={screen.choose} />}
                {isPhone ? null : printAction}
              </div>
            </StickyHead>
          )}
          {month === null || mode !== MODE_SVE ? null : (
            <div className="min-w-0 print:hidden">
              <CalendarFilters shown={month} onFilter={screen.filter} />
            </div>
          )}
          {ownNote === null ? null : (
            <p className="min-w-0 px-4 pb-4 pt-2 text-sm text-muted-foreground sm:pt-0 print:hidden">{ownNote}</p>
          )}
          {/* STORY 18.5 (UX-DR59): the viewer's own loan, covering today or ahead. */}
          {ownNote === null || month?.ownLoan === undefined ? null : (
            <LoanNoticeLine notice={month.ownLoan} className="-mt-3 min-w-0 px-4 pb-4 text-sm text-muted-foreground print:mt-0 print:pb-2" />
          )}
          <CalendarMonthBody screen={screen} />
        </Card>
      )}
      <DayDetailDialog
        detail={screen.detail}
        snapshot={snapshot}
        conflicts={screen.dayConflicts}
        staffing={screen.dayStaffing}
        form={overrideForm}
        roster={rosterForm}
        swapOffered={screen.swapOffered}
        swapProposed={screen.swapProposed}
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
