import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { ORGANIZATION_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-requests';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';

/** What `useToday` reads for every role: the calendar, the own leave and resolutions, and the leave tile's two. */
const OWN_KEYS: readonly QueryKey[] = [
  CALENDAR_KEY,
  MY_LEAVE_RECORDS_KEY,
  MY_CONFLICT_RESOLUTIONS_KEY,
  MEMBERS_LIST_KEY,
  ORGANIZATION_SNAPSHOT_KEY,
];

/**
 * *Danas*'s reads as one snapshot (story 8.2): the keys its freshness is
 * decided over. `useToday`'s five for every role; for an admin, also
 * `useAdminToday`'s organization leave, resolutions and leave requests (story
 * 9.5: *Treba tebe* counts pending requests), since the page shows
 * both hooks' figures and they are one surface. The role is the snapshot's
 * or the chrome's cached one; the member's keys while neither answers.
 */
export function todaySurfaceKeysOf(role: MemberRole | null): readonly QueryKey[] {
  if (role === null || !readsOrganizationLeave(role)) return OWN_KEYS;

  return [...OWN_KEYS, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, ORGANIZATION_LEAVE_REQUESTS_KEY];
}
