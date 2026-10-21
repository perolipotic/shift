import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { SESSION_SUBJECT_KEY } from '@/features/members/services/write';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';

/**
 * The admin's *Ljudi* table's reads as one snapshot (story 8.2b): the keys
 * its offline freshness is decided over — the member list alone, the one read
 * every figure on the table comes from (AD-13). `surface-keys.test.ts` pins
 * it and that it is kept on the device. The members' directory on the same
 * path is the teams feature's (`directorySurfaceKeysOf`).
 */
export const MEMBERS_TABLE_SURFACE_KEYS: readonly QueryKey[] = [MEMBERS_LIST_KEY];

/**
 * One member's page `/ljudi/$id` as one snapshot (story 8.2c): the UNION of
 * what its two hooks read — `useMemberEdit` (the member list, the calendar
 * snapshot, the organization, the caller's account id and the teams) and the
 * leave card's `useMemberLeave` (the same list, organization and calendar,
 * this member's live leave and the organization's live resolutions). Both
 * hooks decide over this one set, so the page is drawn whole or is
 * unavailable as one, never half drawn: offline, a member whose leave was
 * never read leaves the whole page unavailable. `surface-keys.test.ts` pins
 * the set and that every key is kept on the device. The erasure guard's
 * fresh reads are no part of it: they decide a write, never the page.
 */
export function memberPageSurfaceKeysOf(id: string): readonly QueryKey[] {
  return [
    MEMBERS_LIST_KEY,
    CALENDAR_KEY,
    ORGANIZATION_SNAPSHOT_KEY,
    SESSION_SUBJECT_KEY,
    TEAMS_LIST_KEY,
    LEAVE_RECORDS_KEY(id),
    ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  ];
}
