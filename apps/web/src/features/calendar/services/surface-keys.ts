import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import type { MemberRole } from '@/features/navigation/utils/destinations';

/**
 * *Kalendar*'s reads as one snapshot (story 8.2): the keys its freshness is
 * decided over, by the viewer's role once the snapshot names it. The
 * calendar snapshot alone before that; then a member's own leave, or an
 * admin's organization leave and resolutions — exactly the reads
 * `useCalendarScreen` enables. Every one of them is a key *Danas* reads for
 * the same role (`todaySurfaceKeysOf`), so a *Danas* read online is what
 * *Kalendar* reads offline; `surface-keys.test.ts` pins that.
 */
export function calendarSurfaceKeysOf(role: MemberRole | null): readonly QueryKey[] {
  if (role === null) return [CALENDAR_KEY];

  return readsOrganizationLeave(role)
    ? [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY]
    : [CALENDAR_KEY, MY_LEAVE_RECORDS_KEY];
}
