import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { ORGANIZATION_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-request-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { MY_SWAP_REQUESTS_KEY } from '@/features/swaps/services/my-swaps';
import { ORGANIZATION_SWAP_REQUESTS_KEY } from '@/features/swaps/services/organization-swaps';

/**
 * What `useToday` reads for every role: the calendar, the own leave and
 * resolutions, the leave tile's two, and (story 12.3) the viewer's own swaps,
 * which *Zamjene* lists on both bodies.
 */
const OWN_KEYS: readonly QueryKey[] = [
  CALENDAR_KEY,
  MY_LEAVE_RECORDS_KEY,
  MY_CONFLICT_RESOLUTIONS_KEY,
  MEMBERS_LIST_KEY,
  ORGANIZATION_SNAPSHOT_KEY,
  MY_SWAP_REQUESTS_KEY,
];

/**
 * *Danas*'s reads as one snapshot (story 8.2): the keys its freshness is
 * decided over. `useToday`'s six for every role; for an admin, also
 * `useAdminToday`'s organization leave, resolutions, leave requests (story
 * 9.5: *Treba tebe* counts pending requests) and swaps (story 12.4: and the
 * swaps waiting for an admin), since the page shows
 * both hooks' figures and they are one surface. The role is the snapshot's
 * or the chrome's cached one; the member's keys while neither answers.
 */
export function todaySurfaceKeysOf(role: MemberRole | null): readonly QueryKey[] {
  if (role === null || !readsOrganizationLeave(role)) return OWN_KEYS;

  return ADMIN_KEYS;
}

/** An admin's: `useToday`'s and `useAdminToday`'s together. */
const ADMIN_KEYS: readonly QueryKey[] = [
  ...OWN_KEYS,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_LEAVE_REQUESTS_KEY,
  ORGANIZATION_SWAP_REQUESTS_KEY,
];

/** The member body's snapshot (story 12.3), which *Zamjene* decides its reads over there. */
export const MEMBER_TODAY_SURFACE_KEYS: readonly QueryKey[] = OWN_KEYS;

/** The admin body's snapshot (story 12.3), which *Zamjene* decides its reads over there. */
export const ADMIN_TODAY_SURFACE_KEYS: readonly QueryKey[] = ADMIN_KEYS;
