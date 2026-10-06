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
import {
  MY_LEAVE_RECORDS_KEY,
  myLeaveRecordsQueryOptions,
  type MyLeaveRecordsRpc,
} from '@/features/leave/services/leave-list';
import { TODAY_LOADING, todayDateShownOf, todayOf } from '@/features/today/services/today';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Danas*'s two reads and its state (story 6.1a). Wiring only — every
 * decision is `@/features/today/services/today`'s, which the node suite
 * executes.
 *
 * THE CALENDAR'S OWN READS (AD-13), through *Kalendar*'s own query options:
 * the calendar snapshot under `CALENDAR_KEY`, and the viewer's own live leave
 * under `MY_LEAVE_RECORDS_KEY`, read through `my_leave_records()` for every
 * role — an admin's own rows included — never a select on `leave_records`.
 * One cache entry per key, shared with *Kalendar*, *Sati* and *Godišnji*; a
 * leave write names that key among its dependents. No figure is optimistic.
 */
export function useToday() {
  const queryClient = useQueryClient();
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
  const calendarState = calendarSurfaceStateOf(calendar);
  const snapshot = calendarState.snapshot;
  const refusal = calendarState.refusal;
  const calendarLoading = calendarState.loading;
  const rows = records.data;
  const rowsIsError = records.isError;
  const rowsIsPending = records.isPending;
  const rowsFetchStatus = records.fetchStatus;
  // THE ORGANIZATION'S TODAY, worked out on every render as *Kalendar*'s is:
  // a tab left open past midnight re-derives the case, the next shift, the
  // week and the date once the date changes.
  const todayDate = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  // Derived once per answer and per date, not on every render: the next shift walks up to a year of days.
  const today = useMemo(
    () =>
      todayOf(
        {
          calendar: { snapshot, refusal, loading: calendarLoading },
          records: { data: rows, isError: rowsIsError, isPending: rowsIsPending, fetchStatus: rowsFetchStatus },
        },
        new Date(),
      ),
    // `todayDate` is read through `new Date()` inside; it is here so a new date re-derives.
    [snapshot, refusal, calendarLoading, rows, rowsIsError, rowsIsPending, rowsFetchStatus, todayDate],
  );

  /** Read again both reads the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, MY_LEAVE_RECORDS_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return { today, date: todayDateShownOf(today), loading: today.kind === TODAY_LOADING, retry };
}
