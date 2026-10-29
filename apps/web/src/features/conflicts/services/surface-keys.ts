import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { ACTING_ADMINS_KEY, TAB_RESOLVED, type ConflictsTab } from '@/features/conflicts/services/resolved-conflicts';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { ORGANIZATION_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-request-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';

/**
 * *Za odluku*'s reads as one snapshot (story 8.2c): the keys its offline
 * freshness is decided over, by the open tab — the calendar snapshot, the
 * organization's live leave, its live resolutions and its leave requests
 * (story 9.5: pending ones wait on *Čeka odluku*, decided ones are listed on
 * *Odlučeno*) on both, and on
 * *Odlučeno* the names of whoever decided too, the one read that tab adds
 * (and makes only once it is open). Offline, a *Odlučeno* never opened online
 * is unavailable, never a list missing its names. `surface-keys.test.ts` pins
 * the set and that every key is kept on the device.
 */
export function rasporedSurfaceKeysOf(tab: ConflictsTab): readonly QueryKey[] {
  const queue = [
    CALENDAR_KEY,
    ORGANIZATION_LEAVE_RECORDS_KEY,
    ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ORGANIZATION_LEAVE_REQUESTS_KEY,
  ];

  return tab === TAB_RESOLVED ? [...queue, ACTING_ADMINS_KEY] : queue;
}

/**
 * One conflict's resolution page as one snapshot (story 8.2c): its five reads
 * — the queue's calendar, live leave and live resolutions, and the member
 * card's two for the balance, the member list and the organization snapshot.
 * The leave-request read (story 9.5) is not among them: it is the back link
 * count's own read, with its own freshness (retro 8–9 item 18), so a snapshot
 * without it still shows the page — only the count goes.
 */
export const RESOLUTION_SURFACE_KEYS: readonly QueryKey[] = [
  CALENDAR_KEY,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  MEMBERS_LIST_KEY,
  ORGANIZATION_SNAPSHOT_KEY,
];

/** The resolution page's back link count's own read (retro 8–9 item 18): the organization's leave requests, fresh on their own. */
export const RESOLUTION_COUNT_KEYS: readonly QueryKey[] = [ORGANIZATION_LEAVE_REQUESTS_KEY];
