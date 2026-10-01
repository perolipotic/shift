import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import {
  MY_LEAVE_RECORDS_KEY,
  myLeaveRecordsQueryOptions,
  type MyLeaveRecordsRpc,
} from '@/features/leave/services/leave-list';
import { myLeaveOf, myLeaveRowsStateOf, MY_LEAVE_LOADING } from '@/features/leave/services/my-leave';
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
 */
export function useMyLeave() {
  const queryClient = useQueryClient();
  const members = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const organization = useQuery(
    organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)),
  );
  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const records = useQuery(
    // Named structurally, as the calendar's `rpc` is.
    myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
  );

  const leave = myLeaveOf(
    {
      members: membersSurfaceStateOf(members),
      calendar: calendarSurfaceStateOf(calendar),
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

  return { leave, loading: leave.kind === MY_LEAVE_LOADING, retry };
}
