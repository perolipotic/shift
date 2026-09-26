import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import {
  NO_ROTATION_SHOWN,
  SKELETON_COLUMN_COUNT,
  SKELETON_GRID_STYLE,
  SKELETON_ROW_COUNT,
  calendarMonthOutcomeOf,
  calendarSearchOf,
  calendarTodayOf,
  type CalendarCell,
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
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */

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

  function show(mjesec: string | null): void {
    void navigate({ search: mjesec === null ? {} : { mjesec } });
  }

  function renderCell(cell: CalendarCell): ReactNode {
    return (
      <TableCell key={cell.teamId} className="px-1 py-1">
        <div className={cell.className}>
          {cell.name === null ? (
            <>
              <span aria-hidden>{NO_ROTATION_SHOWN}</span>
              <span className="sr-only">{t('kalendar.noRotation')}</span>
            </>
          ) : (
            <>
              <span>{cell.name}</span>
              {cell.range === null ? null : (
                <span className="hidden font-normal tabular-nums lg:inline">{cell.range}</span>
              )}
            </>
          )}
        </div>
      </TableCell>
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
              <TableHead key={team.id} scope="col" className="whitespace-nowrap normal-case">
                {team.name}
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
          </div>
          {month === null ? renderSkeleton() : renderGrid(month)}
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
