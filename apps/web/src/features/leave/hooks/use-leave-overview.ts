import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import {
  LEAVE_OVERVIEW_RECORDS_KEY,
  leaveOverviewRecordsQueryOptions,
  type LeaveOverviewRecordsRpc,
} from '@/features/leave/services/leave-list';
import {
  GODISNJI_OVERVIEW,
  OVERVIEW_LOADING,
  godisnjiViewOf,
  leaveOverviewFiltersOf,
  leaveOverviewFromRows,
  leaveOverviewRowsOf,
  leaveOverviewSearchFor,
  nextLeaveOverviewSort,
  type GodisnjiSearch,
  type LeaveOverviewSortKey,
} from '@/features/leave/services/leave-overview';
import { myLeaveRowsStateOf } from '@/features/leave/services/my-leave';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  NO_TEXT,
  membersQueryOptions,
  membersSurfaceStateOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { supabaseClient } from '@/lib/supabase/client';

/** How the hook writes the URL: the next search, and whether it replaces the entry (typing does). */
export type GodisnjiNavigate = (next: GodisnjiSearch, options: { readonly replace: boolean }) => void;

/**
 * *Godišnji*'s role gate and the admin's overview (story 7.15). Wiring only —
 * every decision is `@/features/leave/services/leave-overview`'s, which the
 * node suite executes.
 *
 * THE ROLE IS THE CALENDAR SNAPSHOT'S (`snapshot.viewer.role`), as *Sati*
 * reads it — no `beforeLoad` read of its own. Until the snapshot names an
 * admin, NO overview read is made: a member's session never calls
 * `leave_overview_records()`, which would refuse it anyway (0034).
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

  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const calendarState = calendarSurfaceStateOf(calendar);
  const view = godisnjiViewOf(calendarState);
  const admin = view === GODISNJI_OVERVIEW;
  const members = useQuery({
    ...membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)),
    enabled: admin,
  });
  const organization = useQuery({
    ...organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)),
    enabled: admin,
  });
  const records = useQuery({
    // Named structurally, as the viewer's own read is.
    ...leaveOverviewRecordsQueryOptions(() => supabaseClient() as unknown as LeaveOverviewRecordsRpc),
    enabled: admin,
  });

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
  // THE ORGANIZATION'S TODAY, so the rows are worked out again when the day turns.
  const today = calendarState.snapshot === null ? null : calendarTodayOf(calendarState.snapshot, new Date());
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
        new Date(),
      ),
    // `today` is read only to re-run the rows when the organization's day turns.
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
      today,
    ],
  );
  const { search: query, sort } = filters;
  // The box's own text, so the rows follow every keystroke before the URL does.
  const overview = leaveOverviewFromRows(rows, { search: text, sort });

  /** Read again every read the overview stands on, from the unavailable notice's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, MEMBERS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY, LEAVE_OVERVIEW_RECORDS_KEY]) {
      // A read already in flight is left to land: repeated presses never restart it.
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }

  function writeSearch(value: string): void {
    typed.current = value;
    setText(value);
    navigate(leaveOverviewSearchFor({ search: value.trim(), sort }), { replace: true });
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
    navigate(leaveOverviewSearchFor({ search: query, sort: nextLeaveOverviewSort(sort, key) }), { replace: false });
  }

  return {
    view,
    overview,
    loading: admin && overview.kind === OVERVIEW_LOADING,
    search: text,
    searchField,
    changeSearch,
    clearSearch,
    pressColumn,
    retry,
  };
}

/** What the overview's parts are drawn from. */
export type LeaveOverviewScreen = ReturnType<typeof useLeaveOverview>;
