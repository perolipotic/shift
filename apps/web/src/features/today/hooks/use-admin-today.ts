import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useSyncExternalStore } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { cachedRoleOf } from '@/features/calendar/utils/skeleton';
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_TABLE,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { MEMBER_ROLE_KEY } from '@/features/navigation/services/role';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { adminTodayOf } from '@/features/today/services/admin-today';
import { useMinuteTicker } from '@/hooks/minute-ticker';
import { supabaseClient } from '@/lib/supabase/client';

/** No role while rendering on a server: there is no cache to read. */
function noRoleOnServer(): MemberRole | null {
  return null;
}

/**
 * The role *Danas* picks its body by (story 6.3): the snapshot's own
 * `viewer.role` once it is in; before that, the chrome's answer already in
 * the cache under `MEMBER_ROLE_KEY` — never a read of its own, as *Kalendar*
 * reads it — so the skeleton is the shape the screen will take; `null` while
 * neither answers.
 */
export function useTodayRole(snapshotRole: MemberRole | null): MemberRole | null {
  const client = useQueryClient();
  const [roleStore] = useState(() => ({
    subscribe: (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    get: () => cachedRoleOf(client.getQueryData(MEMBER_ROLE_KEY)),
  }));
  const cachedRole = useSyncExternalStore(roleStore.subscribe, roleStore.get, noRoleOnServer);

  return snapshotRole ?? cachedRole;
}

/**
 * *Danas*'s reads for an admin and their state (story 6.3). Wiring only —
 * every decision is `@/features/today/services/admin-today`'s, which the node
 * suite executes.
 *
 * *RASPORED*'S THREE READS (AD-13), through the queue's own query options:
 * the calendar snapshot under `CALENDAR_KEY`, the organization's live leave
 * under `ORGANIZATION_LEAVE_RECORDS_KEY` and its live resolutions under
 * `ORGANIZATION_CONFLICT_RESOLUTIONS_KEY`. One cache entry per key, shared
 * with *Raspored* and *Kalendar*; a decision saved there re-reads them, and
 * the count here changes only then. No figure is optimistic, and nothing is
 * stored: the screen is derived from the three answers at every minute.
 *
 * NOT `useConflictsQueue`, which steps the router's state for *Raspored*'s
 * status line.
 */
export function useAdminToday() {
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
    // Named structurally, as the queue's read is.
    organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
  );
  const resolutions = useQuery(
    organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
  );
  const calendarState = calendarSurfaceStateOf(calendar);
  const snapshot = calendarState.snapshot;
  const refusal = calendarState.refusal;
  const calendarLoading = calendarState.loading;

  // STORY 5.5d, as the queue: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(snapshot, resolutions.data);

  const rows = records.data;
  const rowsIsError = records.isError;
  const rowsIsPending = records.isPending;
  const rowsFetchStatus = records.fetchStatus;
  const resolutionRows = resolutions.data;
  const resolutionsIsError = resolutions.isError;
  const resolutionsIsPending = resolutions.isPending;
  const resolutionsFetchStatus = resolutions.fetchStatus;
  // Derived once per answer and per minute, not on every render: the
  // collisions walk every record, and the week draws up to two months.
  const adminToday = useMemo(
    () =>
      adminTodayOf(
        {
          calendar: { snapshot, refusal, loading: calendarLoading },
          records: { data: rows, isError: rowsIsError, isPending: rowsIsPending, fetchStatus: rowsFetchStatus },
          resolutions: {
            data: resolutionRows,
            isError: resolutionsIsError,
            isPending: resolutionsIsPending,
            fetchStatus: resolutionsFetchStatus,
          },
        },
        now,
      ),
    [
      snapshot,
      refusal,
      calendarLoading,
      rows,
      rowsIsError,
      rowsIsPending,
      rowsFetchStatus,
      resolutionRows,
      resolutionsIsError,
      resolutionsIsPending,
      resolutionsFetchStatus,
      now,
    ],
  );

  /** Read again every read the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return { adminToday, retry };
}
