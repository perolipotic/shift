import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

import {
  COMPRESSED_CELL_CLASS,
  MODE_MOJ,
  MODE_SVE,
  NO_ROTATION_SHOWN,
  SKELETON_COLUMN_COUNT,
  SKELETON_GRID_STYLE,
  SKELETON_ROW_COUNT,
  calendarModeOf,
  calendarMonthOutcomeOf,
  calendarSearchOf,
  calendarSearchTo,
  calendarTodayOf,
  phoneStoreOf,
  type CalendarCell,
  type CalendarDay,
  type CalendarMode,
  type CalendarMonth,
  type CalendarSearch,
} from '@/calendar/month';
import {
  CALENDAR_READ_TABLE,
  calendarMessageKey,
  calendarQueryOptions,
  calendarSurfaceStateOf,
} from '@/calendar/snapshot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/i18n';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';

/**
 * `Kalendar` — one month, every active team (story 3.1).
 *
 * Member and admin alike (UX-DR31/UX-DR32): the same grid, a row per date and
 * a column per active team, each cell the shift type that team works that
 * day. The month is chosen in the URL (`?mjesec=2026-09`) — a SEARCH
 * PARAMETER, not a child route, so `router.test.ts`'s unmatched deep link
 * still lands on the root's not-found.
 *
 * ONE READ (AD-13) under `CALENDAR_KEY`, unwindowed, so moving between months
 * never reads again: every month is `@/calendar/month`'s pure computation over
 * the one snapshot, and the projection inside it is `@shift/domain`'s.
 *
 * THIS FILE HOLDS MARKUP. Every rule is in `@/calendar/snapshot` and
 * `@/calendar/month`, which the node suite executes.
 *
 * TWO MODES (story 3.2a), `?prikaz=moj|sve`: *Moj raspored*, the viewer's
 * own day list, and *Sve smjene*, the grid. With no `prikaz`, a member-role
 * account below 640 px lands on the day list and everyone else on the grid.
 * Below 640 px the grid is COMPRESSED by CSS alone — one letter per team
 * header and per cell, the full names `sr-only` — and is the same table; from
 * 640 px up it is story 3.1's.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */

const phone = phoneStoreOf((query) => window.matchMedia(query));

function isPhoneOnServer(): boolean {
  return false;
}

const SKELETON_ROWS = Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => index);
const SKELETON_COLUMNS = Array.from({ length: SKELETON_COLUMN_COUNT + 1 }, (_, index) => index);

export function KalendarScreen() {
  const search = kalendarRoute.useSearch();
  const navigate = useNavigate({ from: kalendarRoute.fullPath });
  const answer = useQuery(calendarQueryOptions(() => supabaseClient().from(CALENDAR_READ_TABLE)));
  const state = calendarSurfaceStateOf(answer);
  const { snapshot, loading } = state;
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const mjesec = search.mjesec;
  // GUARDED (`calendarMonthOutcomeOf`): a month the domain refuses is the read
  // failure, never a crashed route.
  const outcome = useMemo(
    () => (snapshot === null || today === null ? null : calendarMonthOutcomeOf(snapshot, { mjesec }, today)),
    [snapshot, mjesec, today],
  );
  const refusal = state.refusal ?? (outcome !== null && !outcome.ok ? outcome.code : null);
  const month = outcome !== null && outcome.ok ? outcome.month : null;
  // READ LIVE: crossing 640 px changes the default mode while no `prikaz` is chosen.
  const isPhone = useSyncExternalStore(phone.subscribe, phone.get, isPhoneOnServer);
  const mode = snapshot === null ? null : calendarModeOf(search, snapshot.viewer.role, isPhone);

  function show(mjesec: string | null): void {
    void navigate({ search: calendarSearchTo(search, { mjesec }) });
  }

  function choose(prikaz: CalendarMode): void {
    void navigate({ search: calendarSearchTo(search, { prikaz }) });
  }

  function renderCellBody(cell: CalendarCell, compressed: boolean): ReactNode {
    if (cell.name === null) {
      return (
        <>
          <span aria-hidden>{NO_ROTATION_SHOWN}</span>
          <span className="sr-only">{t('kalendar.noRotation')}</span>
        </>
      );
    }

    if (!compressed) {
      return (
        <>
          <span>{cell.name}</span>
          {cell.range === null ? null : <span className="font-normal tabular-nums">{cell.range}</span>}
        </>
      );
    }

    return (
      <>
        <span aria-hidden className="sm:hidden">
          {cell.letter}
        </span>
        <span className="sr-only sm:not-sr-only">{cell.name}</span>
        {cell.range === null ? null : (
          <span className="hidden font-normal tabular-nums lg:inline">{cell.range}</span>
        )}
      </>
    );
  }

  function renderCell(cell: CalendarCell): ReactNode {
    return (
      <TableCell key={cell.teamId} className="px-1 py-1">
        <div className={`${cell.className} ${COMPRESSED_CELL_CLASS}`}>{renderCellBody(cell, true)}</div>
      </TableCell>
    );
  }

  // The pressed mode is filled from its own `aria-pressed`, so the fill and the
  // state never disagree; it differs from the other by fill AND border.
  function renderSwitch(chosen: CalendarMode): ReactNode {
    return (
      <div role="group" aria-label={t('kalendar.mode.label')} className="flex w-full gap-2 sm:w-auto">
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-11 flex-1 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground sm:flex-none"
          aria-pressed={chosen === MODE_MOJ}
          onClick={() => {
            choose(MODE_MOJ);
          }}
        >
          {t('kalendar.mode.moj')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-11 flex-1 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground sm:flex-none"
          aria-pressed={chosen === MODE_SVE}
          onClick={() => {
            choose(MODE_SVE);
          }}
        >
          {t('kalendar.mode.sve')}
        </Button>
      </div>
    );
  }

  function renderDay(day: CalendarDay): ReactNode {
    return (
      <li
        key={day.date}
        aria-current={day.isToday ? 'date' : undefined}
        className={
          day.isToday
            ? 'flex min-h-11 items-center gap-3 border-l-4 border-foreground py-1 pl-2 pr-1 font-bold'
            : 'flex min-h-11 items-center gap-3 py-1 pl-3 pr-1'
        }
      >
        <span className="w-20 shrink-0 text-sm">
          <span className="block tabular-nums">{day.dayMonth}</span>
          <span className="block text-xs font-normal text-muted-foreground">{day.weekday}</span>
        </span>
        {day.cell === null ? (
          <span className="text-sm text-muted-foreground">{t('kalendar.day.noTeam')}</span>
        ) : (
          <div className={`${day.cell.className} min-w-0 flex-1`}>{renderCellBody(day.cell, false)}</div>
        )}
      </li>
    );
  }

  function renderDays(shown: CalendarMonth): ReactNode {
    // The day list's own failure: the alert and no list. The grid is unaffected.
    if (!shown.days.ok) {
      return (
        <div className="px-4 pb-4">
          <Notice role="alert">{t(calendarMessageKey(shown.days.code))}</Notice>
        </div>
      );
    }

    if (shown.days.days === null) {
      // What is true, never an empty list: the viewer is on no team this month.
      return <p className="px-4 pb-4 text-sm text-muted-foreground">{t('kalendar.noTeam')}</p>;
    }

    return (
      <ol aria-labelledby="kalendar-month-heading" className="divide-y divide-border px-4 pb-4">
        {shown.days.days.map((day) => renderDay(day))}
      </ol>
    );
  }

  function renderGrid(shown: CalendarMonth): ReactNode {
    if (shown.columns.length === 0) {
      return <p className="px-4 pb-4 text-sm text-muted-foreground">{t('kalendar.noTeams')}</p>;
    }

    return (
      <Table aria-labelledby="kalendar-month-heading">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="sticky left-0 bg-muted">
              {t('kalendar.columnDate')}
            </TableHead>
            {shown.columns.map((team) => (
              <TableHead key={team.id} scope="col" className="whitespace-nowrap normal-case max-sm:text-center">
                <span aria-hidden className="sm:hidden">
                  {team.letter}
                </span>
                <span className="sr-only sm:not-sr-only">{team.name}</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.rows.map((row) => (
            <TableRow key={row.date} aria-current={row.isToday ? 'date' : undefined}>
              <TableHead
                scope="row"
                className={
                  row.isToday
                    ? 'sticky left-0 h-auto whitespace-nowrap border-l-4 border-foreground bg-card py-1 text-sm font-bold normal-case tracking-normal text-foreground'
                    : 'sticky left-0 h-auto whitespace-nowrap bg-card py-1 text-sm font-medium normal-case tracking-normal text-foreground'
                }
              >
                <span className="block tabular-nums">{row.dayMonth}</span>
                <span className="block text-xs font-normal text-muted-foreground">{row.weekday}</span>
              </TableHead>
              {row.cells.map((cell) => renderCell(cell))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  function renderSkeleton(): ReactNode {
    return (
      <div className="grid gap-1 px-4 pb-4">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="grid gap-1" style={SKELETON_GRID_STYLE}>
            {SKELETON_COLUMNS.map((column) => (
              <div key={column} className="h-[30px] animate-pulse rounded-sm bg-muted" />
            ))}
          </div>
        ))}
      </div>
    );
  }

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
            {month === null ? (
              <div className="h-7 w-40 animate-pulse rounded-sm bg-muted" />
            ) : (
              <>
                <h2 id="kalendar-month-heading" className="font-heading text-xl font-bold">
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
                      show(month.previous);
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
                      show(null);
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
                      show(month.next);
                    }}
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </div>
              </>
            )}
            {mode === null ? null : renderSwitch(mode)}
          </div>
          {month === null ? renderSkeleton() : mode === MODE_MOJ ? renderDays(month) : renderGrid(month)}
        </Card>
      )}
    </main>
  );
}

export const kalendarRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/kalendar',
  validateSearch: (search: Record<string, unknown>): CalendarSearch => calendarSearchOf(search),
  component: KalendarScreen,
});
