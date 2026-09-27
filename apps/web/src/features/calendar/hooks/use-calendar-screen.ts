import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';

import { useDayDetail } from '@/features/calendar/hooks/use-day-detail';
import {
  GRID_CELL_SELECTOR,
  gridCellSelectorOf,
  gridFocusAfter,
  gridPositionOf,
  gridOpenOnKeyDown,
  gridOpensOnKeyUp,
  isSameGridPosition,
  keyModifiersOf,
  type GridFocus,
  type GridPosition,
} from '@/features/calendar/utils/grid-keys';
import { gridCellLabelsOf } from '@/features/calendar/utils/modifiers';
import {
  calendarModeOf,
  calendarMonthOutcomeOf,
  calendarSearchTo,
  calendarTodayOf,
  phoneStoreOf,
  type CalendarFilterChange,
  type CalendarMode,
  type CalendarMonth,
  type CalendarSearch,
} from '@/features/calendar/utils/month';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { dayDetailKeyOf, gridFocusKeyOf } from '@/features/calendar/utils/screen-keys';
import {
  CALENDAR_READ_TABLE,
  type CalendarMembersRpc,
  calendarQueryOptions,
  calendarSurfaceStateOf,
} from '@/features/calendar/services/snapshot';
import { supabaseClient } from '@/lib/supabase/client';

const phone = phoneStoreOf((query) => window.matchMedia(query));

function isPhoneOnServer(): boolean {
  return false;
}

/**
 * The calendar screen's state, its one read and its handlers (stories 3.1 to
 * 3.5a). `search` is the route's search; `go` navigates to another one.
 *
 * ONE READ (AD-13) under `CALENDAR_KEY`, unwindowed, so moving between months
 * never reads again: every month is `@/features/calendar/utils/month`'s pure
 * computation over the one snapshot, and the projection inside it is
 * `@shift/domain`'s. Every rule is in
 * `@/features/calendar/services/snapshot` and the `utils/` modules, which the
 * node suite executes; this hook holds state and wiring only.
 */
export function useCalendarScreen(search: CalendarSearch, go: (next: CalendarSearch) => void) {
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
  const shownGrid = gridFocusKeyOf(month);
  const [focusGrid, setFocusGrid] = useState<string | null>(shownGrid);

  if (focusGrid !== shownGrid) {
    setFocusGrid(shownGrid);
    setGridFocus(null);
  }

  const gridRef = useRef<HTMLTableElement>(null);
  // The cell a Space keydown armed.
  const armedRef = useRef<HTMLElement | null>(null);
  // The key the grid's tab stop resets on, with the mode: any change closes
  // the detail — browser Back while it is open included.
  const { detail, openDay, closeDay, closedByBrowser } = useDayDetail(
    snapshot,
    dayDetailKeyOf(shownGrid, mode),
    gridRef,
  );
  // The reset unmounts itself; focus goes to the filter rather than <body>.
  const filterRef = useRef<HTMLSelectElement>(null);
  // Built once per month shown, not on every focus move.
  const labels = useMemo(() => (month === null ? null : gridCellLabelsOf(month, translateCellLabel)), [month]);

  function show(mjesec: string | null): void {
    go(calendarSearchTo(search, { mjesec }));
  }

  function choose(prikaz: CalendarMode): void {
    go(calendarSearchTo(search, { prikaz }));
  }

  function filter(change: CalendarFilterChange): void {
    go(calendarSearchTo(search, change));
  }

  /** The filter's reset: every team, nobody chosen, and focus on the filter. */
  function resetFilter(): void {
    filter({ smjena: null, osoba: null });
    filterRef.current?.focus();
  }

  /** Opens the detail of the grid cell at `from`, `target` its element. */
  function openCell(shown: CalendarMonth, from: GridPosition, target: HTMLElement): void {
    const row = shown.rows[from.row];
    const cell = row?.cells[from.column];

    if (row !== undefined && cell !== undefined) openDay(cell.teamId, row.date, target);
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

  return {
    snapshot,
    loading,
    refusal,
    month,
    mode,
    labels,
    gridFocus,
    gridRef,
    filterRef,
    detail,
    show,
    choose,
    filter,
    resetFilter,
    remember,
    moveGridFocus,
    openOnKeyUp,
    openDay,
    closeDay,
    closedByBrowser,
  };
}

export type CalendarScreenState = ReturnType<typeof useCalendarScreen>;
