import { useQuery } from '@tanstack/react-query';

import {
  LEAVE_REQUESTS_TABLE,
  organizationLeaveRequestsQueryOptions,
  type OrganizationLeaveRequestsTable,
} from '@/features/leave/services/leave-request-list';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * THE ORGANIZATION'S LEAVE REQUESTS' ONE BINDING (retro 8–9, D6), on the
 * calendar snapshot's terms (`use-calendar-snapshot.ts`): its query options
 * over the app's client, under `ORGANIZATION_LEAVE_REQUESTS_KEY`. *Danas*,
 * *Za odluku*, a conflict's resolution screen and the member page's
 * deactivation take it from here, so "the same key, no extra request" holds by
 * construction rather than by each hook copying the same lambda.
 */
export function organizationLeaveRequestsReadOptions() {
  return organizationLeaveRequestsQueryOptions(
    () => supabaseClient().from(LEAVE_REQUESTS_TABLE) as unknown as OrganizationLeaveRequestsTable,
  );
}

/** The organization's requests, observed through {@link organizationLeaveRequestsReadOptions}. */
export function useOrganizationLeaveRequests() {
  return useQuery(organizationLeaveRequestsReadOptions());
}
