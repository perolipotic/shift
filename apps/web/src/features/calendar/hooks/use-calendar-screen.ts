import type { CollisionResolution } from '@shift/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';

import { useDayDetail } from '@/features/calendar/hooks/use-day-detail';
import { usePhone } from '@/hooks/viewport';
import {
  GRID_CELL_SELECTOR,
  FOCUS_VISIBLE,
  GRID_REVEAL,
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
  type CalendarFilterChange,
  type CalendarMode,
  type CalendarMonth,
  type CalendarSearch,
} from '@/features/calendar/utils/month';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { dayConflictsOf, type DayConflict } from '@/features/calendar/utils/day-detail';
import { candidateLeaveOf } from '@/features/calendar/utils/replacement-candidates';
import { cachedRoleOf, calendarSkeletonShapeOf, earlyCalendarModeOf } from '@/features/calendar/utils/skeleton';
import { dayDetailKeyOf, gridFocusKeyOf } from '@/features/calendar/utils/screen-keys';
import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  type CalendarMembersRpc,
  calendarQueryOptions,
  calendarSurfaceStateOf,
} from '@/features/calendar/services/snapshot';
import {
  MARKS_LOADING,
  MARKS_READY,
  calendarMarksStateOf,
  calendarRefusalOf,
  readsOrganizationLeave,
} from '@/features/calendar/services/marks';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_TABLE,
  MY_LEAVE_RECORDS_KEY,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  myLeaveRecordsQueryOptions,
  organizationLeaveRecordsQueryOptions,
  type MyLeaveRecordsRpc,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import { hoursLeaveKeysOf } from '@/features/hours/services/hours-conflicts';
import { MEMBER_ROLE_KEY } from '@/features/navigation/services/role';
import { supabaseClient } from '@/lib/supabase/client';

/** No conflicts on the open day, and no decided-leave keys: frozen, so a memo's answer stays the same object. */
const NO_CONFLICTS: readonly DayConflict[] = Object.freeze([]);
const NO_LEAVE_KEYS: readonly CollisionResolution[] = Object.freeze([]);

function noRoleOnServer(): null {
  return null;
}

/**
 * The calendar screen's state, its reads and its handlers (stories 3.1 to
 * 3.5a, 5.3c). `search` is the route's search; `go` navigates to another one.
 *
 * THE SCHEDULE IS ONE READ (AD-13) under `CALENDAR_KEY`, unwindowed, so
 * moving between months never reads again: every month is
 * `@/features/calendar/utils/month`'s pure computation over the one snapshot,
 * and the projection inside it is `@shift/domain`'s. Every rule is in
 * `@/features/calendar/services/snapshot` and the `utils/` modules, which the
 * node suite executes; this hook holds state and wiring only.
 *
 * THE MARKS ARE THE SECOND (story 5.3c), by the viewer's role once the
 * snapshot names it: an admin reads the organization's live leave under
 * `ORGANIZATION_LEAVE_RECORDS_KEY`, a member their own under
 * `MY_LEAVE_RECORDS_KEY` — never both. Every leave write names both keys
 * among its dependents, and a schedule write re-reads the first read, so the
 * marks follow without a reload. The month waits for both reads, and a
 * failed leave read is the calendar's unavailable state with its retry.
 *
 * AN ADMIN'S MARKS READ A THIRD (story 5.4a): the organization's live
 * conflict resolutions under `ORGANIZATION_CONFLICT_RESOLUTIONS_KEY`, enabled
 * by role as the leave is, so a resolved conflict is never marked. A member
 * is shown no conflict and reads none, so the retry reads the organization's
 * key alone. Every leave write names it among its dependents.
 *
 * THE OPEN DAY'S FACTS (story 7.9) come from the same reads, never a fourth:
 * its unresolved conflicts (`dayConflicts`, the marks' own collisions — none
 * for a member), the live leave the roster dialog groups its candidates by
 * (`candidateLeave`), and the decided-leave keys its previews count hours with
 * as *Sati* does (`leaveKeys`, an admin's alone). Each is derived once per
 * answer; one that cannot be derived is none, logged.
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
  const { snapshot } = state;
  const role = snapshot === null ? null : snapshot.viewer.role;
  const organizationLeave = useQuery({
    // Named structurally, as *Raspored*'s read is.
    ...organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
    enabled: role !== null && readsOrganizationLeave(role),
  });
  const ownLeave = useQuery({
    // Named structurally, as *Godišnji*'s read is.
    ...myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
    enabled: role !== null && !readsOrganizationLeave(role),
  });
  // An admin's alone: a member is shown no conflict.
  const readsResolutions = role !== null && readsOrganizationLeave(role);
  const resolutions = useQuery({
    // Named structurally, as *Raspored*'s read is.
    ...organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
    enabled: readsResolutions,
  });
  // STORY 5.5d: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(snapshot, readsResolutions ? resolutions.data : undefined);
  const leaveAnswer = role !== null && readsOrganizationLeave(role) ? organizationLeave : ownLeave;
  const leaveData = leaveAnswer.data;
  const leaveIsError = leaveAnswer.isError;
  const leaveIsPending = leaveAnswer.isPending;
  const leaveFetchStatus = leaveAnswer.fetchStatus;
  const resolutionsData = resolutions.data;
  const resolutionsIsError = resolutions.isError;
  const resolutionsIsPending = resolutions.isPending;
  const resolutionsFetchStatus = resolutions.fetchStatus;
  // Derived once per answer, not on every render: the collisions walk every record.
  const marksState = useMemo(
    () =>
      snapshot === null
        ? null
        : calendarMarksStateOf(
            snapshot,
            {
              data: leaveData,
              isError: leaveIsError,
              isPending: leaveIsPending,
              fetchStatus: leaveFetchStatus,
            },
            readsResolutions
              ? {
                  data: resolutionsData,
                  isError: resolutionsIsError,
                  isPending: resolutionsIsPending,
                  fetchStatus: resolutionsFetchStatus,
                }
              : null,
          ),
    [
      snapshot,
      leaveData,
      leaveIsError,
      leaveIsPending,
      leaveFetchStatus,
      readsResolutions,
      resolutionsData,
      resolutionsIsError,
      resolutionsIsPending,
      resolutionsFetchStatus,
    ],
  );
  const marks = marksState?.kind === MARKS_READY ? marksState.marks : null;
  // `null` while the marks are not ready (loading or failed): grouping over no
  // leave would read every member on leave as free, so nobody is grouped.
  const candidateLeave = useMemo(() => (marks === null ? null : candidateLeaveOf(marks.leave)), [marks]);
  const leaveKeys = useMemo(() => {
    if (snapshot === null || !readsResolutions || resolutionsData === undefined) return NO_LEAVE_KEYS;

    try {
      return hoursLeaveKeysOf(snapshot, resolutionsData);
    } catch (cause) {
      console.error(cause);

      return NO_LEAVE_KEYS;
    }
  }, [snapshot, readsResolutions, resolutionsData]);
  const loading = state.loading || marksState?.kind === MARKS_LOADING;
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const mjesec = search.mjesec;
  const smjena = search.smjena;
  const osoba = search.osoba;
  // GUARDED (`calendarMonthOutcomeOf`): a month the domain refuses is the read
  // failure, never a crashed route.
  const outcome = useMemo(
    () =>
      snapshot === null || today === null || marks === null
        ? null
        : calendarMonthOutcomeOf(snapshot, { mjesec, smjena, osoba }, today, marks),
    [snapshot, mjesec, smjena, osoba, today, marks],
  );
  // A retry only where reading again can help: a failed or paused read.
  const { refusal, retryable } = calendarRefusalOf(
    state.refusal,
    marksState,
    outcome !== null && !outcome.ok ? outcome.code : null,
  );
  const month = outcome !== null && outcome.ok ? outcome.month : null;
  // READ LIVE: crossing 640 px changes the default mode while no `prikaz` is chosen.
  const isPhone = usePhone();
  // Before the snapshot lands, the mode switch and the skeleton's shape follow
  // the chrome's role answer, if the cache already holds it, read and followed
  // there — never fetched here, so the calendar still makes its one read.
  const client = useQueryClient();
  const [roleStore] = useState(() => ({
    subscribe: (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    get: () => cachedRoleOf(client.getQueryData(MEMBER_ROLE_KEY)),
  }));
  const cachedRole = useSyncExternalStore(roleStore.subscribe, roleStore.get, noRoleOnServer);
  const mode =
    snapshot === null
      ? earlyCalendarModeOf(search, cachedRole, isPhone)
      : calendarModeOf(search, snapshot.viewer.role, isPhone);
  const skeleton = calendarSkeletonShapeOf(search, cachedRole, isPhone);
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
  // An admin's alone: a member is shown no conflict (their marks carry none
  // anyway). `dayConflictsOf` never throws: an entry it cannot date is said
  // without dates, so one bad entry never hides the others.
  const dayConflicts = useMemo(
    () =>
      snapshot === null || marks === null || detail === null || !readsResolutions
        ? NO_CONFLICTS
        : dayConflictsOf(snapshot, marks.collisions, marks.leave, detail),
    [snapshot, marks, detail, readsResolutions],
  );
  // Built once per month shown, not on every focus move.
  const labels = useMemo(() => (month === null ? null : gridCellLabelsOf(month, translateCellLabel)), [month]);

  /** Read again every read the month stands on, from the unavailable alert's retry (`retryable` alone): the calendar never reads the viewer's own resolutions. */
  function retry(): void {
    for (const queryKey of [
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      MY_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ]) {
      void client.invalidateQueries({ queryKey });
    }
  }

  function show(mjesec: string | null): void {
    go(calendarSearchTo(search, { mjesec }));
  }

  function choose(prikaz: CalendarMode): void {
    go(calendarSearchTo(search, { prikaz }));
  }

  function filter(change: CalendarFilterChange): void {
    go(calendarSearchTo(search, change));
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
    const cell = gridRef.current?.querySelector<HTMLElement>(gridCellSelectorOf(next));

    // Focus without the browser's own scroll: the cell's `onFocus` reveals it
    // (`reveal`), once.
    cell?.focus({ preventScroll: true });
  }

  /**
   * A cell received focus, from any source — the keys, Tab, or the day
   * detail's close returning it: shown whole by `GRID_REVEAL`, inside its
   * `scroll-margin`, so it lands clear of the sticky date column and header,
   * which the browser's own focus scroll ignores. Only while the focus is
   * shown (`:focus-visible`): a click lands where the pointer already is, and
   * scrolling under it could move the cell away before the click completes.
   */
  function reveal(cell: HTMLElement): void {
    if (cell.matches(FOCUS_VISIBLE)) cell.scrollIntoView(GRID_REVEAL);
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
    retryable,
    month,
    mode,
    skeleton,
    labels,
    gridFocus,
    gridRef,
    detail,
    dayConflicts,
    candidateLeave,
    leaveKeys,
    retry,
    show,
    choose,
    filter,
    remember,
    reveal,
    moveGridFocus,
    openOnKeyUp,
    openDay,
    closeDay,
    closedByBrowser,
  };
}

export type CalendarScreenState = ReturnType<typeof useCalendarScreen>;
