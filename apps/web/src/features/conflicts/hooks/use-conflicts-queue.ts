import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { CONFLICTS_LOADING, conflictsQueueOf } from '@/features/conflicts/services/conflicts-queue';
import {
  LEAVE_RECORDS_TABLE,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Raspored*'s two reads and its state (story 5.3b). Wiring only — every
 * decision is `@/features/conflicts/services/conflicts-queue`'s, which the
 * node suite executes.
 *
 * THE READS, each under its own key (AD-13): the calendar snapshot, shared
 * with the screens that own it, and the organization's live leave records.
 * A schedule write re-reads the first, and every leave write names the second
 * among its dependents, so a conflict appears or clears without a reload.
 * Nothing is written, and no conflict set is kept: the queue is derived from
 * the two answers on every render.
 */
export function useConflictsQueue() {
  const queryClient = useQueryClient();
  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const records = useQuery(
    // Named structurally, as the member card's read is.
    organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
  );

  const queue = conflictsQueueOf({ calendar: calendarSurfaceStateOf(calendar), records }, new Date());

  /** Read again both reads the queue stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return { queue, loading: queue.kind === CONFLICTS_LOADING, retry };
}
