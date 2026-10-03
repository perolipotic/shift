import { onlineManager, useQueryClient } from '@tanstack/react-query';

import {
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_TABLE,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { erasureCheckOf, type ErasureCheck } from '@/features/rotation/services/erasure-check';
import { ROTATION_READ_TABLE, rotationQueryOptions } from '@/features/rotation/services/list';
import type { RotationDraft } from '@/features/rotation/utils/draft';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The rotation save's erasure check (story 5.5a), as the builder runs it:
 * wiring only — every decision is `@/features/rotation/services/erasure-check`'s
 * and `@/features/rotation/services/erasures`'s, which the node suite executes.
 *
 * FRESH ON EVERY PRESS. The four reads the check stands on — the rotation,
 * the calendar snapshot, the organization's live leave records and its live
 * resolutions, each under the key its own screen reads it with (AD-13) — are
 * fetched again whenever the check runs (`staleTime: 0`): on "Spremi
 * rotaciju", on the dialog's own save, and on "Pokušaj ponovno". Nothing is
 * observed between presses.
 *
 * NEVER STUCK PENDING. `networkMode: 'always'` runs each fetch even when the
 * browser reports itself offline, so a fetch that cannot reach the network
 * rejects — and every query function here throws on a failure — rather than
 * pausing until the network returns.
 */
export function useErasureCheck(): (entered: RotationDraft, today: string) => Promise<ErasureCheck> {
  const queryClient = useQueryClient();

  return (entered, today) =>
    erasureCheckOf(
      async () => {
        const [rotation, calendar, records, resolutions] = await Promise.all([
          queryClient.fetchQuery({
            ...rotationQueryOptions(() => supabaseClient().from(ROTATION_READ_TABLE)),
            staleTime: 0,
            networkMode: 'always',
          }),
          queryClient.fetchQuery({
            ...calendarQueryOptions(
              () => supabaseClient().from(CALENDAR_READ_TABLE),
              // As the calendar's: the client's `rpc` is wider than the calls made.
              () => supabaseClient() as unknown as CalendarMembersRpc,
            ),
            staleTime: 0,
            networkMode: 'always',
          }),
          queryClient.fetchQuery({
            ...organizationLeaveRecordsQueryOptions(
              () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
            ),
            staleTime: 0,
            networkMode: 'always',
          }),
          queryClient.fetchQuery({
            ...organizationConflictResolutionsQueryOptions(
              () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
            ),
            staleTime: 0,
            networkMode: 'always',
          }),
        ]);

        return { rotation, calendar, records, resolutions };
      },
      entered,
      today,
      onlineManager.isOnline(),
    );
}
