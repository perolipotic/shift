import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import {
  LEAVE_OVERVIEW_RECORDS_KEY,
  leaveOverviewRecordsQueryOptions,
  type LeaveOverviewRecordsRpc,
} from '@/features/leave/services/leave-list';
import {
  GODISNJI_OVERVIEW,
  OVERVIEW_LOADING,
  OVERVIEW_READY,
  OVERVIEW_UNAVAILABLE,
  chooseLeaveOverviewChip,
  clearedLeaveOverviewFilters,
  godisnjiSearchKeyOf,
  godisnjiViewOf,
  leaveOverviewChipChoiceOf,
  leaveOverviewChipRemovalOf,
  leaveOverviewFiltersOf,
  leaveOverviewFromRows,
  leaveOverviewRowsOf,
  leaveOverviewSearchFor,
  nextLeaveOverviewSort,
  type GodisnjiSearch,
  type LeaveOverviewFilters,
  type LeaveOverviewSortKey,
} from '@/features/leave/services/leave-overview';
import { ALL_TEAMS } from '@/features/members/services/list';
import { myLeaveRowsStateOf } from '@/features/leave/services/my-leave';
import { godisnjiSurfaceKeysOf } from '@/features/leave/services/surface-keys';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersQueryOptions,
  membersSurfaceStateOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  organizationTable,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { useOrganizationToday } from '@/hooks/organization-today';
import { ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';
import { NO_TEXT } from '@/utils/text';

/** How the hook writes the URL: the next search, and whether it replaces the entry (typing does). */
export type GodisnjiNavigate = (next: GodisnjiSearch, options: { readonly replace: boolean }) => void;

/**
 * *Godišnji*'s role gate and the admin's overview (story 7.15). Wiring only —
 * every decision is `@/features/leave/services/leave-overview`'s, which the
 * node suite executes.
 *
 * THE ROLE IS THE CALENDAR SNAPSHOT'S (`snapshot.viewer.role`), as *Sati*
 * reads it — no `beforeLoad` read of its own. Until the snapshot — the cached
 * one included, since story 8.2b — names an admin, NO overview read is made: a
 * member's session never calls `leave_overview_records()`, which would refuse
 * it anyway (0034).
 *
 * ONE SNAPSHOT, ONLINE OR NOT (story 8.2b): every read is seen through the
 * overview's freshness (`useSnapshotFreshness` over `godisnjiSurfaceKeysOf`).
 * Online, a read older than this session's network is never drawn as fresh;
 * offline, the whole cached overview is drawn under the as-of note
 * (`offline`), or the unavailable state is.
 *
 * THE READS, each under its own key and shared with the screens that own it
 * (AD-13): the calendar snapshot, the member list (the allowances and who is
 * active today), the organization snapshot (the leave year) — the member
 * page's card's reads — and the organization's live records through
 * `leave_overview_records()` under `LEAVE_OVERVIEW_RECORDS_KEY`, which every
 * leave write names among its dependents. No figure is optimistic.
 *
 * THE SEARCH IS THE URL'S `?trazi=`: typing replaces the entry, as the member
 * directory's does; the box keeps what was typed and follows the URL when it
 * changes from elsewhere. A heading press pushes `?sort=`.
 *
 * THE CHIPS (E884) are `?smjena=` and `?stanje=`: a pick, a ✕ and
 * `Poništi filtre` each push an entry, and return the state they leave as
 * one key, which the option-chip bar waits on to move focus — *Ljudi*'s
 * pattern. A team the rows no longer offer is replaced out of the URL.
 */
export function useLeaveOverview(search: GodisnjiSearch, navigate: GodisnjiNavigate) {
  const queryClient = useQueryClient();
  const filters = leaveOverviewFiltersOf(search);
  const [text, setText] = useState(filters.search);
  const typed = useRef(text);
  const searchField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typed.current.trim() === filters.search) return;
    typed.current = filters.search;
    setText(filters.search);
  }, [filters.search]);

  const calendarRead = useCalendarSnapshot();
  // THE ROLE THE READS ARE CHOSEN BY is the cached snapshot's as it stands — a
  // role, never a figure drawn — so the overview's reads start with the
  // snapshot's own refetch, and the keys (`godisnjiSurfaceKeysOf`, story 8.2b)
  // are exactly the reads enabled.
  const readsRole = calendarRead.data === undefined ? null : calendarRead.data.viewer.role;
  const readsAdmin = readsRole !== null && readsOrganizationLeave(readsRole);
  const membersRead = useQuery({
    ...membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)),
    enabled: readsAdmin,
  });
  const organizationRead = useQuery({
    ...organizationSnapshotQueryOptions(organizationTable),
    enabled: readsAdmin,
  });
  const recordsRead = useQuery({
    // Named structurally, as the viewer's own read is.
    ...leaveOverviewRecordsQueryOptions(() => supabaseClient() as unknown as LeaveOverviewRecordsRpc),
    enabled: readsAdmin,
  });
  // STORY 8.2b: the overview's four reads are one snapshot, decided from these
  // very observer results. For anybody but an admin the gate decides over the
  // calendar snapshot alone: a member's own figures are `useMyLeave`'s, with
  // their own freshness, and the disabled reads here pass raw.
  const { freshness, answerFor } = useSnapshotFreshness(
    godisnjiSurfaceKeysOf(readsAdmin ? readsRole : null),
    [
      [CALENDAR_KEY, calendarRead],
      [MEMBERS_LIST_KEY, membersRead],
      [ORGANIZATION_SNAPSHOT_KEY, organizationRead],
      [LEAVE_OVERVIEW_RECORDS_KEY, recordsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const calendar = answerFor(CALENDAR_KEY, calendarRead);
  const members = answerFor(MEMBERS_LIST_KEY, membersRead);
  const organization = answerFor(ORGANIZATION_SNAPSHOT_KEY, organizationRead);
  const records = answerFor(LEAVE_OVERVIEW_RECORDS_KEY, recordsRead);
  const calendarState = calendarSurfaceStateOf(calendar);
  const view = godisnjiViewOf(calendarState);
  const admin = view === GODISNJI_OVERVIEW;

  const { data: membersData, isError: membersFailed, isPending: membersPending, fetchStatus: membersFetch } = members;
  const { data: calendarData, isError: calendarFailed, isPending: calendarPending, fetchStatus: calendarFetch } =
    calendar;
  const {
    data: organizationData,
    isError: organizationFailed,
    isPending: organizationPending,
    fetchStatus: organizationFetch,
  } = organization;
  const { data: recordsData, isError: recordsFailed, isPending: recordsPending, fetchStatus: recordsFetch } = records;
  // THE ORGANIZATION'S TODAY, moved at its midnight, so the rows are worked out again when the day turns.
  const { now } = useOrganizationToday(calendarState.snapshot === null ? null : calendarState.snapshot.timeZone);
  // EVERY MEMBER'S FIGURES, once per answer and day — never on a keystroke:
  // the search and the sort below run over these rows.
  const rows = useMemo(
    () =>
      leaveOverviewRowsOf(
        {
          members: membersSurfaceStateOf({
            data: membersData,
            isError: membersFailed,
            isPending: membersPending,
            fetchStatus: membersFetch,
          }),
          calendar: calendarSurfaceStateOf({
            data: calendarData,
            isError: calendarFailed,
            isPending: calendarPending,
            fetchStatus: calendarFetch,
          }),
          organization: {
            data: organizationData,
            isError: organizationFailed,
            isPending: organizationPending,
            fetchStatus: organizationFetch,
          },
          records: myLeaveRowsStateOf({
            data: recordsData,
            isError: recordsFailed,
            isPending: recordsPending,
            fetchStatus: recordsFetch,
          }),
        },
        now,
      ),
    [
      membersData,
      membersFailed,
      membersPending,
      membersFetch,
      calendarData,
      calendarFailed,
      calendarPending,
      calendarFetch,
      organizationData,
      organizationFailed,
      organizationPending,
      organizationFetch,
      recordsData,
      recordsFailed,
      recordsPending,
      recordsFetch,
      now,
    ],
  );
  const { search: query, sort } = filters;
  // The box's own text, so the rows follow every keystroke before the URL does.
  const overview = leaveOverviewFromRows(rows, { ...filters, search: text });
  /** The state the URL holds, as one key: the filter bar waits for it to move focus. */
  const stateKey = godisnjiSearchKeyOf(search);
  /** The team the rows were narrowed by once they are ready; before that the URL's. */
  const appliedTeam = overview.kind === OVERVIEW_READY ? overview.team : filters.team;

  /** Read again every read the overview stands on, from the unavailable notice's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, MEMBERS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY, LEAVE_OVERVIEW_RECORDS_KEY]) {
      // A read already in flight is left to land: repeated presses never restart it.
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }

  /**
   * Write `next` to the URL, and return the state it leaves. A change that
   * leaves the URL as it is navigates nowhere, so it pushes no duplicate entry.
   */
  function write(next: LeaveOverviewFilters, replace: boolean): string {
    const written = leaveOverviewSearchFor(next);
    const key = godisnjiSearchKeyOf(written);

    if (key !== stateKey) navigate(written, { replace });

    return key;
  }

  // A TEAM THAT LEFT THE OPTIONS LEAVES THE URL TOO, replacing the entry.
  // The other filters and the box's text are read as they are, never followed.
  const dropLeftTeam = useEffectEvent((): void => {
    write({ ...filters, search: text.trim(), team: ALL_TEAMS }, true);
  });

  useEffect(() => {
    if (appliedTeam === filters.team) return;
    dropLeftTeam();
  }, [appliedTeam, filters.team]);

  function writeSearch(value: string): void {
    typed.current = value;
    setText(value);
    write({ ...filters, search: value.trim() }, true);
  }

  function changeSearch(event: ChangeEvent<HTMLInputElement>): void {
    writeSearch(event.target.value);
  }

  /** *Poništi pretragu*: the box emptied, and focus back in it. */
  function clearSearch(): void {
    writeSearch(NO_TEXT);
    searchField.current?.focus();
  }

  function pressColumn(key: LeaveOverviewSortKey): void {
    write({ ...filters, search: query, sort: nextLeaveOverviewSort(sort, key) }, false);
  }

  /** A chip's pick: the URL changes, and the state it leaves is returned. */
  function pickChip(key: string, id: string): string {
    const chip = chooseLeaveOverviewChip(key);
    const teams = overview.kind === OVERVIEW_READY ? overview.teams : [];

    return chip === null ? stateKey : write(leaveOverviewChipChoiceOf({ ...filters, search: query }, chip, id, teams), false);
  }

  /** A chip's ✕. */
  function removeChip(key: string): string {
    const chip = chooseLeaveOverviewChip(key);

    return chip === null ? stateKey : write(leaveOverviewChipRemovalOf({ ...filters, search: query }, chip), false);
  }

  // THE SEARCH AND BOTH CHIPS BACK TO THEIR DEFAULTS, the sort kept, in one
  // entry. The phone sheet's `Poništi`: focus stays in the sheet.
  function clearFilters(): void {
    typed.current = NO_TEXT;
    setText(NO_TEXT);
    write(clearedLeaveOverviewFilters(filters), false);
  }

  // `Poništi filtre` under the chips, and the empty line's: the same, and focus to the search.
  function resetFilters(): void {
    clearFilters();
    searchField.current?.focus();
  }

  return {
    view,
    overview,
    // STORY 8.2b: the as-of note's time and zone while the whole overview is
    // drawn offline; none above the unavailable state, where nothing is drawn.
    // Only the overview's: a member's own figures carry their own note (`useMyLeave`).
    offline: admin
      ? offlineNoteOf(
          freshness,
          calendarState.snapshot === null ? null : calendarState.snapshot.timeZone,
          overview.kind === OVERVIEW_UNAVAILABLE,
        )
      : null,
    loading: admin && overview.kind === OVERVIEW_LOADING,
    search: text,
    filters,
    team: appliedTeam,
    stateKey,
    searchField,
    changeSearch,
    clearSearch,
    pressColumn,
    pickChip,
    removeChip,
    clearFilters,
    resetFilters,
    retry,
  };
}

/** What the overview's parts are drawn from. */
export type LeaveOverviewScreen = ReturnType<typeof useLeaveOverview>;
