import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { ACTING_ADMINS_KEY } from '@/features/conflicts/services/resolved-conflicts';
import { LEAVE_OVERVIEW_RECORDS_KEY, LEAVE_RECORDS_KEY, MY_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { LEAVE_REQUEST_KEY, MY_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-request-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';

/** What *Godišnji* reads for either role: the calendar snapshot, the member list and the organization snapshot. */
const SHARED_KEYS: readonly QueryKey[] = [CALENDAR_KEY, MEMBERS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY];

/**
 * *Godišnji*'s reads as one snapshot (story 8.2b): the keys its offline
 * freshness is decided over, by the viewer's role once the cached snapshot
 * names it — exactly the reads the screen makes for that role. Before that,
 * the calendar snapshot alone, which decides the role. A member's own three
 * figures read `useMyLeave`'s four, their own live leave among them; an
 * admin's overview reads the same three and the organization's records
 * through `leave_overview_records()` instead (`useLeaveOverview`), and draws
 * NO figures of the admin's own (decision of 2026-10-09: `useMyLeave` is
 * mounted for a member alone), so the own leave records are no admin key. The
 * overview's records are a read of *Godišnji*'s own, which no other surface
 * makes: they read offline only after the overview was read online once.
 * STORY 9.3: a member's *Godišnji* and the request form also read the
 * viewer's own requests, which *Danas* does not, so the member's keys are no
 * longer a subset of *Danas*'s; both surfaces mount the requests read.
 * `surface-keys.test.ts` pins both and that every key is kept on the device.
 */
export function godisnjiSurfaceKeysOf(role: MemberRole | null): readonly QueryKey[] {
  if (role === null) return [CALENDAR_KEY];

  return readsOrganizationLeave(role)
    ? [...SHARED_KEYS, LEAVE_OVERVIEW_RECORDS_KEY]
    : [...SHARED_KEYS, MY_LEAVE_RECORDS_KEY, MY_LEAVE_REQUESTS_KEY];
}

/**
 * A member's own *Godišnji* keys, whatever the snapshot names: what
 * `useMyLeave` (the figures) and `useMyLeaveRequests` (the requests) read
 * together, on *Godišnji* and on the request form alike.
 */
export const GODISNJI_MEMBER_SURFACE_KEYS: readonly QueryKey[] = godisnjiSurfaceKeysOf('member_role');

/**
 * A leave request's decision screen as one snapshot (story 9.4): the request
 * by its id, the calendar snapshot (the organization's zone, the schedule) and
 * the member list (the name, the allowance) for every request; for a PENDING
 * one, `previewMemberId`, the preview's reads too — the organization snapshot
 * (the leave year), the organization's live resolutions (the collisions) and
 * the member's live records; for a DECIDED one (`actors`), the acting admins'
 * names, as *Odlučeno* reads them. Before the request is read, the first
 * three alone. `surface-keys.test.ts` pins the sets and that every key is kept
 * on the device.
 */
export function leaveRequestReviewSurfaceKeysOf(
  requestId: string,
  previewMemberId: string | null,
  actors: boolean,
): readonly QueryKey[] {
  const keys: QueryKey[] = [LEAVE_REQUEST_KEY(requestId), CALENDAR_KEY, MEMBERS_LIST_KEY];

  if (previewMemberId !== null) {
    keys.push(ORGANIZATION_SNAPSHOT_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, LEAVE_RECORDS_KEY(previewMemberId));
  }
  if (actors) keys.push(ACTING_ADMINS_KEY);

  return keys;
}
