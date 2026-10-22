import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { useSnapshotSkewRefresh } from '@/features/calendar/hooks/use-snapshot-skew-refresh';
import { CALENDAR_FETCH_FETCHING, CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { snapshotSkewOf } from '@/features/calendar/services/snapshot-skew';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  myConflictResolutionsQueryOptions,
  type MyConflictResolutionsRpc,
} from '@/features/conflicts/services/resolutions';
import { hoursConflictsStateOf } from '@/features/hours/services/hours-conflicts';
import type { HoursSearch } from '@/features/hours/services/hours-search';
import { hoursSnapshotStateOf, myHoursSurfaceOf } from '@/features/hours/services/my-hours';
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
  organizationTable,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { useTodayRole } from '@/features/today/hooks/use-admin-today';
import { todaySurfaceKeysOf } from '@/features/today/services/surface-keys';
import {
  TODAY_LOADING,
  TODAY_UNAVAILABLE,
  ownTeamShownOf,
  todayDateShownOf,
  todayOf,
} from '@/features/today/services/today';
import { todayTilesOf } from '@/features/today/services/today-tiles';
import { useMinuteTicker } from '@/hooks/minute-ticker';
import { FRESHNESS_OFFLINE, ZONE_FROM_CALENDAR } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
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
 *
 * ONE SNAPSHOT, ONLINE OR NOT (story 8.2). Every read is seen through the
 * surface's freshness (`useSnapshotFreshness` over `todaySurfaceKeysOf`, an
 * admin's body's keys included): online, a read older than this session's
 * network is never drawn as fresh — the skeleton after the app's start, the
 * whole cached snapshot under the as-of note after a reconnect — and
 * offline, the whole cached snapshot is drawn under the note (`offline`), or
 * nothing is.
 */
export function useToday() {
  const queryClient = useQueryClient();
  const now = useMinuteTicker();
  const calendarRead = useCalendarSnapshot();
  const recordsRead = useQuery(
    // Named structurally, as *Godišnji*'s read is.
    myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
  );
  const resolutionsRead = useQuery(
    // Named structurally, as *Sati*'s read is.
    myConflictResolutionsQueryOptions(() => supabaseClient() as unknown as MyConflictResolutionsRpc),
  );
  const membersRead = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const organizationRead = useQuery(
    organizationSnapshotQueryOptions(organizationTable),
  );
  // THE ROLE THE PAGE PICKS ITS BODY BY (`role` below, through
  // `useTodayRole` in `DanasScreen`) is the role the keys follow, so an
  // admin's body's reads are always among them. Read off the cached snapshot
  // as it stands, never a figure drawn.
  const snapshotRole = calendarRead.data === undefined ? null : calendarRead.data.viewer.role;
  const pageRole = useTodayRole(snapshotRole);
  const { freshness, clock, answerOf } = useSnapshotFreshness(
    todaySurfaceKeysOf(pageRole),
    [
      [CALENDAR_KEY, calendarRead],
      [MY_LEAVE_RECORDS_KEY, recordsRead],
      [MY_CONFLICT_RESOLUTIONS_KEY, resolutionsRead],
      [MEMBERS_LIST_KEY, membersRead],
      [ORGANIZATION_SNAPSHOT_KEY, organizationRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const calendar = answerOf(calendarRead);
  const records = answerOf(recordsRead);
  const resolutions = answerOf(resolutionsRead);
  const members = answerOf(membersRead);
  const organization = answerOf(organizationRead);
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
  const snapshotFetching = calendar.fetchStatus === CALENDAR_FETCH_FETCHING;

  // As *Sati*: a resolution naming a team the snapshot does not hold yet re-reads it once.
  useSnapshotSkewRefresh(snapshotSkewOf(hoursSnapshot, rows, resolutionsData));
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
            snapshotFetching,
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
      snapshotFetching,
    ],
  );
  const hoursToday = hoursSnapshot === null ? null : calendarTodayOf(hoursSnapshot, now);
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
    now,
  );
  const tiles = todayTilesOf(hours, leave);

  /** Read again every read the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [
      CALENDAR_KEY,
      MY_LEAVE_RECORDS_KEY,
      MY_CONFLICT_RESOLUTIONS_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return {
    today,
    tiles,
    date: todayDateShownOf(today),
    // E804: the admin subtitle's team link, from the same snapshot as the
    // member's today card (AD-13).
    ownTeam: ownTeamShownOf(today),
    // STORY 6.3: the role *Danas* picks its body by, once the snapshot names
    // it — since story 8.2 the cached snapshot's, the same role the keys
    // follow, so the admin body is mounted exactly when its reads are decided
    // over. A role picks a body; it draws no figure.
    role: snapshotRole,
    loading: today.kind === TODAY_LOADING,
    // STORY 8.2: the as-of note's time and zone while the whole snapshot is drawn offline.
    // None above an unavailable today, as *Kalendar* shows none beside a refusal.
    offline:
      freshness.kind === FRESHNESS_OFFLINE && snapshot !== null && today.kind !== TODAY_UNAVAILABLE
        ? { asOf: freshness.asOf, timeZone: snapshot.timeZone }
        : null,
    // STORY 8.2e: the unavailable alert's read retry, never offline — its
    // re-read would pause until the connection returns. Online it returns.
    retryable: clock.online && today.kind === TODAY_UNAVAILABLE && today.retryable,
    retry,
  };
}
