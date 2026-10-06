import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  myConflictResolutionsQueryOptions,
  type MyConflictResolutionsRpc,
} from '@/features/conflicts/services/resolutions';
import { hoursConflictsStateOf } from '@/features/hours/services/hours-conflicts';
import { hoursSnapshotStateOf, myHoursSurfaceOf, type HoursSearch } from '@/features/hours/services/my-hours';
import {
  MY_LEAVE_RECORDS_KEY,
  myLeaveRecordsQueryOptions,
  type MyLeaveRecordsRpc,
} from '@/features/leave/services/leave-list';
import { myLeaveOf, myLeaveRowsStateOf } from '@/features/leave/services/my-leave';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersQueryOptions,
  membersSurfaceStateOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { OWN_TEAM_KEY } from '@/features/teams/services/roster';
import { TODAY_LOADING, todayDateShownOf, todayOf } from '@/features/today/services/today';
import { todayTilesOf } from '@/features/today/services/today-tiles';
import { useMinuteTicker } from '@/hooks/minute-ticker';
import { supabaseClient } from '@/lib/supabase/client';

/** *Sati*'s default search: the organization's current month, nothing else. */
const CURRENT_MONTH: HoursSearch = {};

/**
 * *Danas*'s reads and its state (story 6.1a; the tiles, story 6.1b). Wiring only — every
 * decision is `@/features/today/services/today`'s, which the node suite
 * executes.
 *
 * THE CALENDAR'S OWN READS (AD-13), through *Kalendar*'s own query options:
 * the calendar snapshot under `CALENDAR_KEY`, and the viewer's own live leave
 * under `MY_LEAVE_RECORDS_KEY`, read through `my_leave_records()` for every
 * role — an admin's own rows included — never a select on `leave_records`.
 * One cache entry per key, shared with *Kalendar*, *Sati* and *Godišnji*; a
 * leave write names that key among its dependents. No figure is optimistic.
 *
 * THE TILES' READS (story 6.1b), each its detail view's own, under the same
 * keys. The hours tile is *Sati*'s member branch for every role — the
 * viewer's own month — over the snapshot, the own leave and the own
 * resolutions under `MY_CONFLICT_RESOLUTIONS_KEY` (through
 * `hoursConflictsStateOf`, as *Sati*). The leave tile is *Godišnji*'s
 * `myLeaveOf` over its four reads: the member list under `MEMBERS_LIST_KEY`,
 * the organization snapshot under `ORGANIZATION_SNAPSHOT_KEY`, the calendar
 * and the own leave. No organization-wide leave or resolution read.
 */
export function useToday() {
  const queryClient = useQueryClient();
  const now = useMinuteTicker();
  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const records = useQuery(
    // Named structurally, as *Godišnji*'s read is.
    myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
  );
  const resolutions = useQuery(
    // Named structurally, as *Sati*'s read is.
    myConflictResolutionsQueryOptions(() => supabaseClient() as unknown as MyConflictResolutionsRpc),
  );
  const members = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const organization = useQuery(
    organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)),
  );
  const calendarState = calendarSurfaceStateOf(calendar);
  const snapshot = calendarState.snapshot;
  const refusal = calendarState.refusal;
  const calendarLoading = calendarState.loading;
  const rows = records.data;
  const rowsIsError = records.isError;
  const rowsIsPending = records.isPending;
  const rowsFetchStatus = records.fetchStatus;
  // THE ORGANIZATION'S TODAY AND ITS MINUTE (story 6.2), at the ticker's
  // `now`: a duty's progress moves every minute, and a tab left open past
  // midnight re-derives the case, the next shift, the week and the date.
  // Derived once per answer and per minute, not on every render: the next shift walks up to a year of days.
  const today = useMemo(
    () =>
      todayOf(
        {
          calendar: { snapshot, refusal, loading: calendarLoading },
          records: { data: rows, isError: rowsIsError, isPending: rowsIsPending, fetchStatus: rowsFetchStatus },
        },
        now,
      ),
    [snapshot, refusal, calendarLoading, rows, rowsIsError, rowsIsPending, rowsFetchStatus, now],
  );

  // THE HOURS TILE: *Sati*'s own surface, the viewer's own month.
  const hoursState = hoursSnapshotStateOf(calendar);
  const hoursSnapshot = hoursState.snapshot;
  const hoursRefusal = hoursState.refusal;
  const hoursLoading = hoursState.loading;
  const resolutionsData = resolutions.data;
  // STORY 5.5d, as *Sati*: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(hoursSnapshot, resolutionsData);
  const resolutionsIsError = resolutions.isError;
  const resolutionsIsPending = resolutions.isPending;
  const resolutionsFetchStatus = resolutions.fetchStatus;
  // Derived once per answer, not on every render: the collisions walk every record.
  const conflicts = useMemo(
    () =>
      hoursSnapshot === null
        ? null
        : hoursConflictsStateOf(
            hoursSnapshot,
            { data: rows, isError: rowsIsError, isPending: rowsIsPending, fetchStatus: rowsFetchStatus },
            {
              data: resolutionsData,
              isError: resolutionsIsError,
              isPending: resolutionsIsPending,
              fetchStatus: resolutionsFetchStatus,
            },
          ),
    [
      hoursSnapshot,
      rows,
      rowsIsError,
      rowsIsPending,
      rowsFetchStatus,
      resolutionsData,
      resolutionsIsError,
      resolutionsIsPending,
      resolutionsFetchStatus,
    ],
  );
  const hoursToday = hoursSnapshot === null ? null : calendarTodayOf(hoursSnapshot, new Date());
  // Worked out once per answer and per day, not on every render.
  const hours = useMemo(
    () =>
      myHoursSurfaceOf(
        { snapshot: hoursSnapshot, refusal: hoursRefusal, loading: hoursLoading },
        conflicts,
        CURRENT_MONTH,
        hoursToday,
      ),
    [hoursSnapshot, hoursRefusal, hoursLoading, conflicts, hoursToday],
  );
  // THE LEAVE TILE: *Godišnji*'s own state, over its four reads.
  const leave = myLeaveOf(
    {
      members: membersSurfaceStateOf(members),
      calendar: calendarState,
      organization,
      records: myLeaveRowsStateOf(records),
    },
    new Date(),
  );
  const tiles = todayTilesOf(hours, leave);

  /** Read again every read the screen stands on, the team line's included, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [
      CALENDAR_KEY,
      MY_LEAVE_RECORDS_KEY,
      MY_CONFLICT_RESOLUTIONS_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      OWN_TEAM_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return { today, tiles, date: todayDateShownOf(today), loading: today.kind === TODAY_LOADING, retry };
}
