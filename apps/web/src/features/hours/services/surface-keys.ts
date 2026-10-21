import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import type { MemberRole } from '@/features/navigation/utils/destinations';

/**
 * *Sati*'s reads as one snapshot (story 8.2b): the keys its offline freshness
 * is decided over, by the viewer's role once the cached snapshot names it —
 * exactly the reads `useHours` enables, and no more (human amendment
 * 2026-10-21: *Sati* adds no read). The calendar snapshot alone before that;
 * then a member's own leave and resolutions, or an admin's organization leave
 * and resolutions. Every one is a key *Danas* reads for the same role, so a
 * *Danas* read online is what *Sati* reads offline; `surface-keys.test.ts`
 * pins that subset and that every key is kept on the device.
 */
export function hoursSurfaceKeysOf(role: MemberRole | null): readonly QueryKey[] {
  if (role === null) return [CALENDAR_KEY];

  return readsOrganizationLeave(role)
    ? [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY]
    : [CALENDAR_KEY, MY_LEAVE_RECORDS_KEY, MY_CONFLICT_RESOLUTIONS_KEY];
}
