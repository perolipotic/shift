import { useQuery } from '@tanstack/react-query';

import {
  ORGANIZATION_SWAPS_TABLE,
  organizationSwapRequestsQueryOptions,
  type OrganizationSwapsTable,
} from '@/features/swaps/services/organization-swaps';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * THE ORGANIZATION'S SWAPS' ONE BINDING (story 12.4), on the organization's
 * leave requests' terms (`use-organization-leave-requests.ts`): its query
 * options over the app's client, under `ORGANIZATION_SWAP_REQUESTS_KEY`.
 * *Za odluku*, *Odlučeno*, a conflict's resolution screen, the admin's
 * *Danas* and a swap's decision screen take it from here, so "the same key,
 * no extra request" holds by construction. Named structurally, as the
 * requests' read is.
 */
export function organizationSwapRequestsReadOptions() {
  return organizationSwapRequestsQueryOptions(
    () => supabaseClient().from(ORGANIZATION_SWAPS_TABLE) as unknown as OrganizationSwapsTable,
  );
}

/** The organization's swaps, observed through {@link organizationSwapRequestsReadOptions}. */
export function useOrganizationSwapRequests() {
  return useQuery(organizationSwapRequestsReadOptions());
}
