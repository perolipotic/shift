import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import {
  MY_LEAVE_RECORDS_KEY,
  myLeaveRecordsQueryOptions,
  type MyLeaveRecordsRpc,
} from '@/features/leave/services/leave-list';
import { myLeaveOf, myLeaveRowsStateOf, MY_LEAVE_LOADING, MY_LEAVE_UNAVAILABLE } from '@/features/leave/services/my-leave';
import { GODISNJI_MEMBER_SURFACE_KEYS } from '@/features/leave/services/surface-keys';
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
import { ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Godišnji*'s four reads and its state (story 5.2c). Wiring only — every
 * decision is `@/features/leave/services/my-leave`'s, which the node suite
 * executes.
 *
 * THE READS, each under its own key and shared with the screens that own it
 * (AD-13): the member list (the viewer's own row, for the allowance), the
 * organization snapshot (the leave year), the calendar snapshot (the viewer,
 * the schedule and today) and the viewer's own live records, read through
 * `my_leave_records()` under their own key — never a select on
 * `leave_records`. A leave write names that key among its dependents, so an
 * admin's write to their own leave re-reads this screen too. No figure is
 * optimistic.
 *
 * ONE SNAPSHOT, ONLINE OR NOT (story 8.2b), as *Danas*'s: every read is seen
 * through the screen's freshness (`useSnapshotFreshness` over
 * `godisnjiSurfaceKeysOf`). Online, a read older than this session's network
 * is never drawn as fresh; offline, the whole cached snapshot is drawn under
 * the as-of note (`offline`), or the unavailable state is.
 */
export function useMyLeave() {
  const queryClient = useQueryClient();
  const membersRead = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const organizationRead = useQuery(
    organizationSnapshotQueryOptions(organizationTable),
  );
  const calendarRead = useCalendarSnapshot();
  const recordsRead = useQuery(
    // Named structurally, as the calendar's `rpc` is.
    myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
  );
  // STORY 8.2b: the four reads are one snapshot, decided from these very
  // observer results over *Godišnji*'s member keys — this hook draws a
  // member's own figures alone, whatever the snapshot names.
  const { freshness, clock, answerFor } = useSnapshotFreshness(
    GODISNJI_MEMBER_SURFACE_KEYS,
    [
      [CALENDAR_KEY, calendarRead],
      [MEMBERS_LIST_KEY, membersRead],
      [ORGANIZATION_SNAPSHOT_KEY, organizationRead],
      [MY_LEAVE_RECORDS_KEY, recordsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const members = answerFor(MEMBERS_LIST_KEY, membersRead);
  const organization = answerFor(ORGANIZATION_SNAPSHOT_KEY, organizationRead);
  const calendar = answerFor(CALENDAR_KEY, calendarRead);
  const records = answerFor(MY_LEAVE_RECORDS_KEY, recordsRead);
  const calendarState = calendarSurfaceStateOf(calendar);

  const leave = myLeaveOf(
    {
      members: membersSurfaceStateOf(members),
      calendar: calendarState,
      organization,
      records: myLeaveRowsStateOf(records),
    },
    new Date(),
  );

  /** Read again every read the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [MEMBERS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY, CALENDAR_KEY, MY_LEAVE_RECORDS_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return {
    leave,
    loading: leave.kind === MY_LEAVE_LOADING,
    // STORY 8.2b: the as-of note's time and zone while the whole snapshot is
    // drawn offline; none above the unavailable state, where nothing is drawn.
    offline: offlineNoteOf(
      freshness,
      calendarState.snapshot === null ? null : calendarState.snapshot.timeZone,
      leave.kind === MY_LEAVE_UNAVAILABLE,
    ),
    // STORY 8.2e: "show the read retry now" — the surface is in its
    // retryable unavailable state, and online: offline its re-read would
    // pause until the connection returns.
    retryable: clock.online && leave.kind === MY_LEAVE_UNAVAILABLE,
    retry,
  };
}
