import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';

import {
  GRID_CELL_SELECTOR,
  gridCellSelectorOf,
  gridFocusAfter,
  gridPositionOf,
  gridTabStopOf,
  isInertGridKey,
  isSameGridPosition,
  keyModifiersOf,
  type GridFocus,
  type GridPosition,
} from '@/calendar/grid-keys';
import {
  gridCellLabelsOf,
  legendOf,
  modifierMessageKey,
  modifierNamesTextOf,
  modifierTreatmentOf,
  type CellLabelTranslate,
} from '@/calendar/modifiers';
import {
  ALL_TEAMS_FILTER,
  COMPRESSED_CELL_CLASS,
  DAY_CELL_CLASS,
  DAY_RANGE_CLASS,
  GRID_RANGE_CLASS,
  MODE_MOJ,
  MODE_SVE,
  NO_ROTATION_SHOWN,
  SKELETON_COLUMN_COUNT,
  SKELETON_GRID_STYLE,
  SKELETON_ROW_COUNT,
  calendarFilterChangeOf,
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
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
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
 * THE GRID IS AN ARIA GRID (story 3.2b), full and compressed alike: one tab
 * stop, the arrows, Home and End moving focus by `@/calendar/grid-keys`, and
 * every data cell a `gridcell` named in full by `cellLabelOf` — the date, the
 * team, the type, the range and each modifier, never a letter — with its
 * drawing `aria-hidden` beside it. Modifier marks draw through one cell
 * renderer, shared by the grid and the day list, and the legend shows only
 * while a mark is on screen. The day list stays a plain list.
 *
 * ONE TEAM (story 3.3a), `?smjena=<team id>`: *Sve smjene* narrowed to one
 * active team by a native `Select` above the grid, with a reset while a team
 * is chosen. Which team is chosen — an unknown or archived id being none — is
 * `calendarMonthOf`'s decision; the state lives in the URL alone.
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

const translateCellLabel: CellLabelTranslate = (key) => t(key);

export function KalendarScreen() {
  const search = kalendarRoute.useSearch();
  const navigate = useNavigate({ from: kalendarRoute.fullPath });
  const answer = useQuery(calendarQueryOptions(() => supabaseClient().from(CALENDAR_READ_TABLE)));
  const state = calendarSurfaceStateOf(answer);
  const { snapshot, loading } = state;
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const mjesec = search.mjesec;
  const smjena = search.smjena;
  // GUARDED (`calendarMonthOutcomeOf`): a month the domain refuses is the read
  // failure, never a crashed route.
  const outcome = useMemo(
    () =>
      snapshot === null || today === null ? null : calendarMonthOutcomeOf(snapshot, { mjesec, smjena }, today),
    [snapshot, mjesec, smjena, today],
  );
  const refusal = state.refusal ?? (outcome !== null && !outcome.ok ? outcome.code : null);
  const month = outcome !== null && outcome.ok ? outcome.month : null;
  // READ LIVE: crossing 640 px changes the default mode while no `prikaz` is chosen.
  const isPhone = useSyncExternalStore(phone.subscribe, phone.get, isPhoneOnServer);
  const mode = snapshot === null ? null : calendarModeOf(search, snapshot.viewer.role, isPhone);
  // The grid's one tab stop, remembered across re-renders and FORGOTTEN
  // whenever the month shown or the team chosen changes (story 3.3a) — by the
  // buttons, the filter, the URL or history — so coming back to a month starts
  // on today again, not where focus last was.
  const [gridFocus, setGridFocus] = useState<GridFocus | null>(null);
  const shownGrid = month === null ? null : `${month.month}|${month.filter.chosen ?? ALL_TEAMS_FILTER}`;
  const [focusGrid, setFocusGrid] = useState<string | null>(shownGrid);

  if (focusGrid !== shownGrid) {
    setFocusGrid(shownGrid);
    setGridFocus(null);
  }

  const gridRef = useRef<HTMLTableElement>(null);
  // The reset unmounts itself; focus goes to the filter rather than <body>.
  const filterRef = useRef<HTMLSelectElement>(null);
  // Built once per month shown, not on every focus move.
  const labels = useMemo(() => (month === null ? null : gridCellLabelsOf(month, translateCellLabel)), [month]);

  function show(mjesec: string | null): void {
    void navigate({ search: calendarSearchTo(search, { mjesec }) });
  }

  function choose(prikaz: CalendarMode): void {
    void navigate({ search: calendarSearchTo(search, { prikaz }) });
  }

  function filter(change: { readonly smjena: string | null }): void {
    void navigate({ search: calendarSearchTo(search, change) });
  }

  /** A cell's name or letter; in the grid, every part `aria-hidden` and the letter first. */
  function renderCellName(cell: CalendarCell, inGrid: boolean): ReactNode {
    if (cell.name === null) {
      return (
        <>
          <span aria-hidden>{NO_ROTATION_SHOWN}</span>
          {inGrid ? null : <span className="sr-only">{t('kalendar.noRotation')}</span>}
        </>
      );
    }

    if (!inGrid) {
      return <span>{cell.name}</span>;
    }

    return (
      <>
        <span aria-hidden className="sm:hidden">
          {cell.letter}
        </span>
        <span aria-hidden className="hidden sm:inline">
          {cell.name}
        </span>
      </>
    );
  }

  /**
   * THE ONE CELL RENDERER, for the grid (full and compressed) and the day
   * list: the type's fill, any modifier's ring or hatch over it, and the
   * glyphs beside the name or letter. In the grid every part is `aria-hidden`,
   * because the `gridcell`'s label names it in full; in the day list the
   * marks' names are there for a screen reader.
   */
  function renderCellBox(cell: CalendarCell, inGrid: boolean): ReactNode {
    const treatment = modifierTreatmentOf(cell.modifiers);

    return (
      <div className={`${cell.className} ${inGrid ? COMPRESSED_CELL_CLASS : DAY_CELL_CLASS} ${treatment.className}`}>
        {treatment.glyphs.length === 0 ? (
          renderCellName(cell, inGrid)
        ) : (
          <span className="flex items-center gap-1">
            {renderCellName(cell, inGrid)}
            <span aria-hidden className="font-normal [font-variant-emoji:text]">
              {treatment.glyphText}
            </span>
          </span>
        )}
        {cell.range === null ? null : (
          <span
            aria-hidden={inGrid ? true : undefined}
            className={inGrid ? GRID_RANGE_CLASS : DAY_RANGE_CLASS}
          >
            {cell.range}
          </span>
        )}
        {inGrid || treatment.modifiers.length === 0 ? null : (
          <span className="sr-only">{modifierNamesTextOf(treatment.modifiers, translateCellLabel)}</span>
        )}
      </div>
    );
  }

  /** Focus moved to a cell: it becomes the grid's one tab stop. */
  function remember(month: string, position: GridPosition): void {
    setGridFocus((current) =>
      current !== null && current.month === month && isSameGridPosition(current.position, position)
        ? current
        : { month, position },
    );
  }

  /**
   * A key on the grid, from the cell that HAS focus: move focus by
   * `gridFocusAfter`, swallow Space, or leave the key alone.
   */
  function moveGridFocus(event: KeyboardEvent<HTMLTableElement>, shown: CalendarMonth): void {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(GRID_CELL_SELECTOR) : null;
    const from = target === null ? null : gridPositionOf(target.dataset);

    if (from === null) return;

    const modifiers = keyModifiersOf(event);

    if (isInertGridKey(event.key, modifiers)) {
      event.preventDefault();

      return;
    }

    const next = gridFocusAfter(event.key, modifiers, from, {
      rows: shown.rows.length,
      columns: shown.columns.length,
    });

    if (next === null) return;

    event.preventDefault();
    remember(shown.month, next);
    gridRef.current?.querySelector<HTMLElement>(gridCellSelectorOf(next))?.focus();
  }

  function renderCell(
    month: string,
    cell: CalendarCell,
    label: string | undefined,
    position: GridPosition,
    tabStop: GridPosition,
  ): ReactNode {
    return (
      <TableCell
        key={cell.teamId}
        role="gridcell"
        data-row={position.row}
        data-column={position.column}
        tabIndex={isSameGridPosition(position, tabStop) ? 0 : -1}
        aria-label={label}
        onFocus={() => {
          remember(month, position);
        }}
        className="px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {renderCellBox(cell, true)}
      </TableCell>
    );
  }

  /** The legend of the marks on screen, or nothing when there are none. */
  function renderLegend(cells: Iterable<CalendarCell | null>): ReactNode {
    const legend = legendOf(cells);

    if (legend.length === 0) return null;

    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 text-sm">
        <span id="kalendar-legend" className="font-semibold">
          {t('kalendar.legend')}
        </span>
        <ul aria-labelledby="kalendar-legend" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {legend.map((modifier) => (
            <li key={modifier} className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-flex size-6 items-center justify-center rounded-sm bg-card text-xs [font-variant-emoji:text] ${modifierTreatmentOf([modifier]).className}`}
              >
                {modifierTreatmentOf([modifier]).glyphText}
              </span>
              <span>{t(modifierMessageKey(modifier))}</span>
            </li>
          ))}
        </ul>
      </div>
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

  /**
   * THE TEAM FILTER of *Sve smjene* (story 3.3a): a native `Select`, as on
   * `/ljudi`, whose value is the team the grid IS narrowed to — so an unknown
   * or archived id reads as every team rather than claiming a filter the grid
   * ignores. The first option counts the active teams (UX-DR19); the teams
   * sit under a labelled heading, their names data. The reset shows only while
   * a team is chosen, and keeps the viewer on `/kalendar`.
   */
  function renderFilter(shown: CalendarMonth): ReactNode {
    if (shown.filter.teams.length === 0) return null;

    return (
      <div className="flex min-w-0 flex-wrap items-end gap-3 px-4 pb-4">
        <div className="grid w-full min-w-0 gap-2 sm:w-64">
          <Label htmlFor="kalendar-filter">{t('kalendar.filter.label')}</Label>
          <Select
            id="kalendar-filter"
            ref={filterRef}
            className="h-11"
            value={shown.filter.chosen ?? ALL_TEAMS_FILTER}
            onChange={(event) => {
              filter(calendarFilterChangeOf(event.target.value));
            }}
          >
            <option value={ALL_TEAMS_FILTER}>{t('kalendar.filter.all', { count: shown.filter.teams.length })}</option>
            <optgroup label={t('kalendar.filter.group')}>
              {shown.filter.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </div>
        {shown.filter.chosen === null ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              filter({ smjena: null });
              filterRef.current?.focus();
            }}
          >
            {t('kalendar.filter.reset')}
          </Button>
        )}
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
          renderCellBox(day.cell, false)
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
      <>
        {renderLegend(shown.days.days.map((day) => day.cell))}
        <ol aria-labelledby="kalendar-month-heading" className="divide-y divide-border px-4 pb-4">
          {shown.days.days.map((day) => renderDay(day))}
        </ol>
      </>
    );
  }

  function renderGrid(shown: CalendarMonth): ReactNode {
    if (shown.columns.length === 0) {
      return <p className="px-4 pb-4 text-sm text-muted-foreground">{t('kalendar.noTeams')}</p>;
    }

    const tabStop = gridTabStopOf(gridFocus, shown.month, shown.rows, shown.columns.length);

    return (
      <>
        {renderLegend(shown.rows.flatMap((row) => row.cells))}
        <Table
          ref={gridRef}
          role="grid"
          aria-readonly
          aria-labelledby="kalendar-month-heading"
          onKeyDown={(event) => {
            moveGridFocus(event, shown);
          }}
        >
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
            {shown.rows.map((row, rowIndex) => (
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
                {row.cells.map((cell, column) =>
                  renderCell(shown.month, cell, labels?.[rowIndex]?.[column], { row: rowIndex, column }, tabStop),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </>
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
          {month === null || mode !== MODE_SVE ? null : renderFilter(month)}
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
