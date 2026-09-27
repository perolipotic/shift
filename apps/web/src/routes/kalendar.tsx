import { useQuery } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';

import {
  GRID_CELL_SELECTOR,
  GRID_TAB_STOP_SELECTOR,
  MONTH_HEADING_ID,
  gridCellSelectorOf,
  gridFocusAfter,
  gridPositionOf,
  gridTabStopOf,
  gridOpenOnKeyDown,
  gridOpensOnKeyUp,
  isSameGridPosition,
  keyModifiersOf,
  type GridFocus,
  type GridPosition,
} from '@/calendar/grid-keys';
import { DAY_DETAIL_DIALOG_ID, DAY_DETAIL_POPUP, DAY_NO_ROTATION, DAY_OFF, dayDetailShownOf, type DayDetail, type OpenedDay } from '@/calendar/day-detail';
import {
  dayListLabelsOf,
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
  personFilterValueOf,
  phoneStoreOf,
  type CalendarCell,
  type CalendarDay,
  type CalendarDayListOutcome,
  type CalendarFilterChange,
  type CalendarMode,
  type CalendarMonth,
  type CalendarPersonMonth,
  type CalendarSearch,
} from '@/calendar/month';
import {
  CALENDAR_READ_TABLE,
  type CalendarMembersRpc,
  calendarMessageKey,
  calendarQueryOptions,
  calendarSurfaceStateOf,
} from '@/calendar/snapshot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { t } from '@/i18n';
import { positionsShown, rosterLineOf, rosterPositionMessageKey } from '@/members/position';
import { ranksShown, rosterRankMessageKey } from '@/members/rank';
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
 * ONE PERSON (story 3.3b), `?osoba=<member id>`: the same Select offers every
 * member active on the organization's today under *Osobe*. The members come
 * from `calendar_members()` (story 3.4a), active or not; which of them are
 * active today is `calendarMonthOf`'s decision, through `activeOn`. A
 * person chosen replaces the grid with their day list — the one *Moj
 * raspored* draws — headed with their name, and wins over a team.
 *
 * ONE DAY (story 3.4b): a grid cell — clicked, or Enter or Space on it — and
 * a day-list day on a team open a read-only Dialog of that team on that date:
 * the type, its times and who is rostered, as `@/calendar/day-detail` derives
 * it from the same snapshot, so opening a day reads nothing. Which day is open
 * lives in `useState`, not in the URL; it is re-derived on every refetch and
 * closes — for good, never reopening by itself — when the snapshot is gone,
 * the team disappears, or the month, mode, team or person shown changes.
 * Every close returns focus to the opener once the Dialog has closed, or to
 * the grid's tab stop or the month heading when the opener is gone.
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
  const answer = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // The precedent of `smjene.$id.tsx`: the client's `rpc` is wider than
      // the one call the calendar makes.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const state = calendarSurfaceStateOf(answer);
  const { snapshot, loading } = state;
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const mjesec = search.mjesec;
  const smjena = search.smjena;
  const osoba = search.osoba;
  // GUARDED (`calendarMonthOutcomeOf`): a month the domain refuses is the read
  // failure, never a crashed route.
  const outcome = useMemo(
    () =>
      snapshot === null || today === null
        ? null
        : calendarMonthOutcomeOf(snapshot, { mjesec, smjena, osoba }, today),
    [snapshot, mjesec, smjena, osoba, today],
  );
  const refusal = state.refusal ?? (outcome !== null && !outcome.ok ? outcome.code : null);
  const month = outcome !== null && outcome.ok ? outcome.month : null;
  // READ LIVE: crossing 640 px changes the default mode while no `prikaz` is chosen.
  const isPhone = useSyncExternalStore(phone.subscribe, phone.get, isPhoneOnServer);
  const mode = snapshot === null ? null : calendarModeOf(search, snapshot.viewer.role, isPhone);
  // The grid's one tab stop, remembered across re-renders and FORGOTTEN
  // whenever the month shown, the team chosen (story 3.3a) or the person
  // chosen (story 3.3b) changes — by the buttons, the filter, the URL or
  // history — so coming back to a month starts on today again, not where focus
  // last was.
  const [gridFocus, setGridFocus] = useState<GridFocus | null>(null);
  const shownGrid =
    month === null
      ? null
      : `${month.month}|${month.filter.chosen ?? ALL_TEAMS_FILTER}|${month.filter.person ?? ALL_TEAMS_FILTER}`;
  const [focusGrid, setFocusGrid] = useState<string | null>(shownGrid);

  if (focusGrid !== shownGrid) {
    setFocusGrid(shownGrid);
    setGridFocus(null);
  }

  const gridRef = useRef<HTMLTableElement>(null);
  // THE DAY DETAIL (story 3.4b): which day is open; the control that opened
  // it, which gets focus back; the cell a Space keydown armed; and a count of
  // closes, which the effect below returns focus after.
  const [opened, setOpened] = useState<OpenedDay | null>(null);
  const [closes, setCloses] = useState(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const armedRef = useRef<HTMLElement | null>(null);
  // Whether a close the screen asked for still owes its `close` event. The
  // browser fires it as a TASK after the dialog has closed, so a day opened in
  // between (Escape, then Space at once) must not be closed by the late event.
  const closeEventOwedRef = useRef(false);
  // Re-derived from the current snapshot while open (`dayDetailShownOf`).
  const shownDetail = useMemo(() => dayDetailShownOf(snapshot, opened), [snapshot, opened]);
  const detail = shownDetail.detail;
  // The key the grid's tab stop resets on, with the mode: any change closes
  // the detail — browser Back while it is open included.
  const detailKey = `${shownGrid ?? ALL_TEAMS_FILTER}|${mode ?? ALL_TEAMS_FILTER}`;
  const [detailFor, setDetailFor] = useState(detailKey);

  if (detailFor !== detailKey) {
    setDetailFor(detailKey);

    if (opened !== null) {
      setOpened(null);
      setCloses((count) => count + 1);
    }
  } else if (shownDetail.close) {
    // No snapshot, the team gone, or a derivation that threw: forget the day,
    // so it never reopens by itself when data returns.
    setOpened(null);
    setCloses((count) => count + 1);
  }

  // AFTER the Dialog has closed (its own effect runs first, and the browser
  // restores focus on `close()`), focus goes back to the opener — or, when it
  // is no longer in the document, to the grid's tab stop or the month heading.
  useEffect(() => {
    if (closes === 0) return;

    const frame = requestAnimationFrame(() => {
      const opener = openerRef.current;
      const fallback =
        gridRef.current?.querySelector<HTMLElement>(GRID_TAB_STOP_SELECTOR) ??
        document.getElementById(MONTH_HEADING_ID);

      (opener?.isConnected === true ? opener : fallback)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [closes]);
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

  function filter(change: CalendarFilterChange): void {
    void navigate({ search: calendarSearchTo(search, change) });
  }

  /** Opens `teamId` on `date`, remembering `opener` for the return of focus. */
  function openDay(teamId: string, date: string, opener: HTMLElement): void {
    openerRef.current = opener;
    setOpened({ teamId, date });
  }

  /** Every close by the viewer — Escape, the close button, the backdrop. */
  function closeDay(): void {
    const dialog = document.getElementById(DAY_DETAIL_DIALOG_ID);

    // Still open: its `close` event is yet to come, and is this close's.
    if (dialog instanceof HTMLDialogElement && dialog.open) closeEventOwedRef.current = true;
    setOpened(null);
    setCloses((count) => count + 1);
  }

  /**
   * The dialog's `close` event: the one a close already handled owes is
   * consumed; any other — the browser closing it on its own — closes the day.
   */
  function closedByBrowser(): void {
    if (closeEventOwedRef.current) {
      closeEventOwedRef.current = false;

      return;
    }

    if (opened !== null) closeDay();
  }

  /** Opens the detail of the grid cell at `from`, `target` its element. */
  function openCell(shown: CalendarMonth, from: GridPosition, target: HTMLElement): void {
    const row = shown.rows[from.row];
    const cell = row?.cells[from.column];

    if (row !== undefined && cell !== undefined) openDay(cell.teamId, row.date, target);
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
   * A key on the grid, from the cell that HAS focus: open its day detail on
   * Enter, arm it on Space (its default prevented, so Space never scrolls) —
   * by `gridOpenOnKeyDown` — move focus by `gridFocusAfter`, or leave the key
   * alone.
   */
  function moveGridFocus(event: KeyboardEvent<HTMLTableElement>, shown: CalendarMonth): void {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(GRID_CELL_SELECTOR) : null;
    const from = target === null ? null : gridPositionOf(target.dataset);

    if (from === null) return;

    const modifiers = keyModifiersOf(event);

    const step = gridOpenOnKeyDown(event.key, modifiers, {
      repeat: event.repeat,
      composing: event.nativeEvent.isComposing,
    });

    if (step !== null) {
      if (step.prevent) event.preventDefault();
      if (step.arm) armedRef.current = target;
      if (step.open && target !== null) openCell(shown, from, target);

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

  /**
   * A key released on the grid: Space opens the cell its keydown armed
   * (`gridOpensOnKeyUp`), so its keyup never reaches the Dialog's close
   * button. Any keyup disarms.
   */
  function openOnKeyUp(event: KeyboardEvent<HTMLTableElement>, shown: CalendarMonth): void {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(GRID_CELL_SELECTOR) : null;
    const from = target === null ? null : gridPositionOf(target.dataset);
    const armed = target !== null && armedRef.current === target;

    armedRef.current = null;

    if (from === null || target === null) return;

    if (gridOpensOnKeyUp(event.key, keyModifiersOf(event), { armed, composing: event.nativeEvent.isComposing })) {
      event.preventDefault();
      openCell(shown, from, target);
    }
  }

  function renderCell(
    month: string,
    date: string,
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
        aria-haspopup={DAY_DETAIL_POPUP}
        onFocus={() => {
          remember(month, position);
        }}
        onClick={(event) => {
          openDay(cell.teamId, date, event.currentTarget);
        }}
        className="cursor-pointer px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
   * THE FILTER of *Sve smjene*: a native `Select`, as on `/ljudi`, whose value
   * is the team the grid IS narrowed to (story 3.3a) or the person shown
   * (story 3.3b) — so an unknown id reads as every team rather than claiming a
   * filter the screen ignores. The first option counts the active teams
   * (UX-DR19); the teams sit under *Smjene* and the people under *Osobe*,
   * their names data. The reset shows only while a team or a person is
   * chosen, and keeps the viewer on `/kalendar`.
   */
  function renderFilter(shown: CalendarMonth): ReactNode {
    if (shown.filter.teams.length === 0 && shown.filter.people.length === 0) return null;

    const value =
      shown.filter.person !== null
        ? personFilterValueOf(shown.filter.person)
        : (shown.filter.chosen ?? ALL_TEAMS_FILTER);

    return (
      <div className="flex min-w-0 flex-wrap items-end gap-3 px-4 pb-4">
        <div className="grid w-full min-w-0 gap-2 sm:w-64">
          <Label htmlFor="kalendar-filter">{t('kalendar.filter.label')}</Label>
          <Select
            id="kalendar-filter"
            ref={filterRef}
            className="h-11"
            value={value}
            onChange={(event) => {
              filter(calendarFilterChangeOf(event.target.value));
            }}
          >
            <option value={ALL_TEAMS_FILTER}>{t('kalendar.filter.all', { count: shown.filter.teams.length })}</option>
            {shown.filter.teams.length === 0 ? null : (
              <optgroup label={t('kalendar.filter.group')}>
                {shown.filter.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </optgroup>
            )}
            {shown.filter.people.length === 0 ? null : (
              <optgroup label={t('kalendar.filter.people')}>
                {shown.filter.people.map((person) => (
                  <option key={person.id} value={personFilterValueOf(person.id)}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        {shown.filter.chosen === null && shown.filter.person === null ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              filter({ smjena: null, osoba: null });
              filterRef.current?.focus();
            }}
          >
            {t('kalendar.filter.reset')}
          </Button>
        )}
      </div>
    );
  }

  /** A day on a team, as a button that opens that team's detail on that date (story 3.4b). */
  function renderDayButton(teamId: string, date: string, cell: CalendarCell, label: string | null): ReactNode {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-h-11 min-w-0 flex-1 items-stretch whitespace-normal p-0 text-left"
        aria-label={label ?? undefined}
        aria-haspopup={DAY_DETAIL_POPUP}
        onClick={(event) => {
          openDay(teamId, date, event.currentTarget);
        }}
      >
        {renderCellBox(cell, false)}
      </Button>
    );
  }

  /** The roster, one `Ime · čin · položaj` line per member, rank and position where the organization uses them. */
  function renderRoster(shown: DayDetail, usesFireRanks: boolean): ReactNode {
    if (shown.roster.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('kalendar.detail.empty')}</p>;
    }

    const rankShown = ranksShown({ usesFireRanks });
    const positionShown = positionsShown({ usesFireRanks });

    return (
      <ul aria-labelledby="kalendar-detail-roster" className="grid gap-2">
        {shown.roster.map((member) => {
          const rankKey = rosterRankMessageKey(member.fireRank, rankShown);
          const positionKey = rosterPositionMessageKey(member.position, positionShown);
          // WHICH SENTENCE is `rosterLineOf`'s decision, executed in a test.
          const line = rosterLineOf(member.name, rankKey, positionKey, (key) => t(key));

          return (
            <li key={member.id} className="min-w-0 break-words text-base">
              {line.key === null ? line.text : t(line.key, line.values)}
            </li>
          );
        })}
      </ul>
    );
  }

  /** The day detail's body: the type, its times and the roster, or why there is none. */
  function renderDetail(shown: DayDetail, usesFireRanks: boolean): ReactNode {
    if (shown.kind === DAY_OFF) {
      return <p className="text-sm">{t('kalendar.detail.off', { team: shown.teamName })}</p>;
    }

    if (shown.kind === DAY_NO_ROTATION) {
      return <p className="text-sm">{t('kalendar.detail.noRotation', { team: shown.teamName })}</p>;
    }

    return (
      <div className="grid gap-4">
        <p className="flex flex-wrap items-baseline gap-x-3 text-base">
          <span className="font-semibold">{shown.typeName}</span>
          {shown.range === null ? null : <span className="tabular-nums">{shown.range}</span>}
        </p>
        <div className="grid gap-2">
          <h3 id="kalendar-detail-roster" className="font-heading text-base font-semibold">
            {t('kalendar.detail.roster')}
          </h3>
          {renderRoster(shown, usesFireRanks)}
        </div>
      </div>
    );
  }

  function renderDay(day: CalendarDay, label: string | null): ReactNode {
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
        {day.cell === null || day.teamId === null ? (
          <span className="text-sm text-muted-foreground">{t('kalendar.day.noTeam')}</span>
        ) : (
          renderDayButton(day.teamId, day.date, day.cell, label)
        )}
      </li>
    );
  }

  /**
   * A day list — the viewer's, or the person chosen — or its own failure, or
   * the explanation `noTeam` when there is no team all month, never an empty
   * list. The list is named by the month's heading, after the person's when
   * it is theirs.
   */
  function renderDayList(days: CalendarDayListOutcome, noTeam: string, ofPerson: boolean): ReactNode {
    // The day list's own failure: the alert and no list. The grid is unaffected.
    if (!days.ok) {
      return (
        <div className="px-4 pb-4">
          <Notice role="alert">{t(calendarMessageKey(days.code))}</Notice>
        </div>
      );
    }

    if (days.days === null) {
      return <p className="px-4 pb-4 text-sm text-muted-foreground">{noTeam}</p>;
    }

    // The button's name is the grid cell's full label: the date, the team,
    // the type, the times and each mark.
    const labels = snapshot === null ? [] : dayListLabelsOf(days.days, snapshot.teams, translateCellLabel);

    return (
      <>
        {renderLegend(days.days.map((day) => day.cell))}
        <ol
          aria-labelledby={ofPerson ? 'kalendar-person-heading kalendar-month-heading' : 'kalendar-month-heading'}
          className="divide-y divide-border px-4 pb-4">
          {days.days.map((day, index) => renderDay(day, labels[index] ?? null))}
        </ol>
      </>
    );
  }

  function renderDays(shown: CalendarMonth): ReactNode {
    // What is true, never an empty list: the viewer is on no team this month.
    return renderDayList(shown.days, t('kalendar.noTeam'), false);
  }

  /** The person chosen in *Sve smjene* (story 3.3b): their name, then their day list. */
  function renderPerson(person: CalendarPersonMonth): ReactNode {
    return (
      <>
        <h3 id="kalendar-person-heading" className="px-4 pb-3 font-heading text-lg font-semibold">
          {person.name}
        </h3>
        {renderDayList(person.days, t('kalendar.person.noTeam', { name: person.name }), true)}
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
          onKeyUp={(event) => {
            openOnKeyUp(event, shown);
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
                  renderCell(
                    shown.month,
                    row.date,
                    cell,
                    labels?.[rowIndex]?.[column],
                    { row: rowIndex, column },
                    tabStop,
                  ),
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
                <h2 id={MONTH_HEADING_ID} tabIndex={-1} className="font-heading text-xl font-bold outline-none">
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
          {month === null
            ? renderSkeleton()
            : mode === MODE_MOJ
              ? renderDays(month)
              : month.person === null
                ? renderGrid(month)
                : renderPerson(month.person)}
        </Card>
      )}
      {/* ESCAPE CLOSES ON `cancel`, which fires at once, and the late `close`
          event is `closedByBrowser`'s — both through the primitive's own
          props — so a quick reopen is never closed by the previous one. */}
      <Dialog
        id={DAY_DETAIL_DIALOG_ID}
        open={detail !== null}
        onOpenChange={(next) => {
          if (!next) closeDay();
        }}
        onCancel={closeDay}
        onClose={closedByBrowser}
        aria-labelledby="kalendar-detail-heading"
      >
        {detail === null || snapshot === null ? null : (
          <>
            <DialogHeader closeLabel={t('kalendar.detail.close')} onClose={closeDay}>
              <DialogTitle id="kalendar-detail-heading">{t('kalendar.detail.title', { team: detail.teamName, date: detail.date })}</DialogTitle>
            </DialogHeader>
            {renderDetail(detail, snapshot.usesFireRanks)}
          </>
        )}
      </Dialog>
    </main>
  );
}

export const kalendarRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/kalendar',
  validateSearch: (search: Record<string, unknown>): CalendarSearch => calendarSearchOf(search),
  component: KalendarScreen,
});
