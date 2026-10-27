import type { CollisionResolution } from '@shift/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';

import { useDayDetail } from '@/features/calendar/hooks/use-day-detail';
import { useSnapshotSkewRefresh } from '@/features/calendar/hooks/use-snapshot-skew-refresh';
import { usePhone } from '@/hooks/viewport';
import { useOrganizationToday } from '@/hooks/organization-today';
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
  calendarOpenDayOf,
  calendarSearchTo,
  type CalendarFilterChange,
  type CalendarMode,
  type CalendarMonth,
  type CalendarOpenDay,
  type CalendarSearch,
} from '@/features/calendar/utils/month';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { dayConflictsOf, type DayConflict } from '@/features/calendar/utils/day-detail';
import { candidateLeaveOf } from '@/features/calendar/utils/replacement-candidates';
import { cachedRoleOf, calendarSkeletonShapeOf, earlyCalendarModeOf } from '@/features/calendar/utils/skeleton';
import { gridFocusKeyOf } from '@/features/calendar/utils/screen-keys';
import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_FETCH_FETCHING, CALENDAR_KEY, calendarRetryStateOf } from '@/features/calendar/services/snapshot';
import { calendarSurfaceKeysOf } from '@/features/calendar/services/surface-keys';
import {
  MARKS_LOADING,
  MARKS_READY,
  calendarMarksStateOf,
  calendarRefusalOf,
} from '@/features/calendar/services/marks';
import { readsOrganizationLeave, snapshotSkewOf } from '@/features/calendar/services/snapshot-skew';
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
import { FRESHNESS_OFFLINE, ZONE_FROM_CALENDAR } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';

/** No conflicts on the open day, and no decided-leave keys: frozen, so a memo's answer stays the same object. */
const NO_CONFLICTS: readonly DayConflict[] = Object.freeze([]);
const NO_LEAVE_KEYS: readonly CollisionResolution[] = Object.freeze([]);

function noRoleOnServer(): null {
  return null;
}

/**
 * The calendar screen's state, its reads and its handlers (stories 3.1 to
 * 3.5a, 5.3c). `search` is the route's search; `go` navigates to another one,
 * replacing the history entry when asked (a day detail's close), and keeping
 * the page's scroll for a day opening or closing.
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
 *
 * ONE SNAPSHOT, ONLINE OR NOT (story 8.2). Every read is seen through the
 * month's freshness (`useSnapshotFreshness` over `calendarSurfaceKeysOf`):
 * online, a read older than this session's network is never drawn as fresh
 * — the skeleton after the app's start; after a reconnect the whole cached
 * month stays under the as-of note until every read is fresh, so an open day
 * stays open; offline, the whole cached month is drawn under the note
 * (`offline`), or the unavailable state is. A skew offline cannot be
 * read again, so it is that unavailable state, never a waiting skeleton.
 */
export function useCalendarScreen(
  search: CalendarSearch,
  go: (next: CalendarSearch, options?: { readonly replace?: boolean; readonly keepScroll?: boolean }) => void,
) {
  const answerRead = useCalendarSnapshot();
  // THE ROLE THE READS ARE CHOSEN BY is the cached snapshot's as it stands — a
  // role, never a figure drawn — so the leave and resolution reads start with
  // the snapshot's own refetch, and the month's keys (`calendarSurfaceKeysOf`,
  // story 8.2) are exactly the reads enabled.
  const readsRole = answerRead.data === undefined ? null : answerRead.data.viewer.role;
  const readsAdmin = readsRole !== null && readsOrganizationLeave(readsRole);
  const organizationLeave = useQuery({
    // Named structurally, as *Za odluku*'s read is.
    ...organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
    enabled: readsAdmin,
  });
  const ownLeave = useQuery({
    // Named structurally, as *Godišnji*'s read is.
    ...myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
    enabled: readsRole !== null && !readsAdmin,
  });
  // An admin's alone: a member is shown no conflict.
  const resolutionsRead = useQuery({
    // Named structurally, as *Za odluku*'s read is.
    ...organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
    enabled: readsAdmin,
  });
  // STORY 8.2: the month's reads are one snapshot, decided from these very
  // observer results (`useSnapshotFreshness`); a read off the month's keys —
  // the other role's leave, a member's disabled resolutions — passes raw.
  const { freshness, clock, answerFor } = useSnapshotFreshness(
    calendarSurfaceKeysOf(readsRole),
    [
      [CALENDAR_KEY, answerRead],
      [ORGANIZATION_LEAVE_RECORDS_KEY, organizationLeave],
      [MY_LEAVE_RECORDS_KEY, ownLeave],
      [ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const answer = answerFor(CALENDAR_KEY, answerRead);
  // A failed read being read again is the skeleton, so the retry's press shows.
  const state = calendarRetryStateOf(answer);
  const { snapshot } = state;
  const role = snapshot === null ? null : snapshot.viewer.role;
  const readsResolutions = role !== null && readsOrganizationLeave(role);
  const resolutions = answerFor(ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead);
  // STORY 5.5d: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(snapshot, readsResolutions ? resolutions.data : undefined);
  const leaveAnswer =
    role !== null && readsOrganizationLeave(role)
      ? answerFor(ORGANIZATION_LEAVE_RECORDS_KEY, organizationLeave)
      : answerFor(MY_LEAVE_RECORDS_KEY, ownLeave);
  const leaveData = leaveAnswer.data;
  const leaveIsError = leaveAnswer.isError;
  const leaveIsPending = leaveAnswer.isPending;
  const leaveFetchStatus = leaveAnswer.fetchStatus;
  const resolutionsData = resolutions.data;
  const resolutionsIsError = resolutions.isError;
  const resolutionsIsPending = resolutions.isPending;
  const resolutionsFetchStatus = resolutions.fetchStatus;
  const snapshotFetching = answer.fetchStatus === CALENDAR_FETCH_FETCHING;
  // A leave or resolution row naming a member or team the snapshot does not hold yet re-reads it once.
  const skew = useMemo(
    () => snapshotSkewOf(snapshot, leaveData, readsResolutions ? resolutionsData : undefined),
    [snapshot, leaveData, readsResolutions, resolutionsData],
  );

  useSnapshotSkewRefresh(skew);
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
            snapshotFetching,
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
      snapshotFetching,
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
  // THE ORGANIZATION'S TODAY, moved at its midnight: a screen left open
  // overnight marks the new day's row and `Ovaj mjesec` target.
  const { today } = useOrganizationToday(snapshot === null ? null : snapshot.timeZone);
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
  // A retry only where reading again can help: a failed read (the refusal's
  // own `retryable`) — and, below, only online.
  const { refusal, retryable: refusalRetryable } = calendarRefusalOf(
    state.refusal,
    marksState,
    outcome !== null && !outcome.ok ? outcome.code : null,
  );
  // STORY 8.2e: "show the read retry now" — never offline, where the re-read
  // would pause until the connection returns. Online it returns.
  const retryable = clock.online && refusalRetryable;
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
  // THE OPEN DAY IS THE URL'S (deferred-work E862): opening pushes it, so
  // Back closes it, and closing replaces it, so it leaves no open state to
  // step back into. Any other change of the search drops it
  // (`calendarSearchTo`), so a change of the month, mode or filter closes it.
  const { dan, danSmjena } = search;
  const opened = useMemo(() => calendarOpenDayOf({ dan, danSmjena }), [dan, danSmjena]);
  const { detail, openDay, closeDay, closedByBrowser } = useDayDetail(
    snapshot,
    opened,
    (day: CalendarOpenDay | null) => {
      go(calendarSearchTo(search, { dan: day }), { replace: day === null, keepScroll: true });
    },
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
      // A read already in flight is left to land: repeated presses never restart it.
      void client.invalidateQueries({ queryKey }, { cancelRefetch: false });
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
    // STORY 8.2: the as-of note's time and zone while the whole month is drawn
    // offline; none beside a refusal, where nothing is drawn.
    offline:
      freshness.kind === FRESHNESS_OFFLINE && snapshot !== null && refusal === null
        ? { asOf: freshness.asOf, timeZone: snapshot.timeZone }
        : null,
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
