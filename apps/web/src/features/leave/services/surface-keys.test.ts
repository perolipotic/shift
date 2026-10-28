import { describe, expect, it } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { ACTING_ADMINS_KEY } from '@/features/conflicts/services/resolved-conflicts';
import { LEAVE_OVERVIEW_RECORDS_KEY, LEAVE_RECORDS_KEY, MY_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { LEAVE_REQUEST_KEY, MY_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-requests';
import {
  GODISNJI_MEMBER_SURFACE_KEYS,
  godisnjiSurfaceKeysOf,
  leaveRequestReviewSurfaceKeysOf,
} from '@/features/leave/services/surface-keys';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { todaySurfaceKeysOf } from '@/features/today/services/surface-keys';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2b: *Godišnji*'s keys per role, every one kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("Godišnji's keys", () => {
  it("are a member's five reads: the figures' four and, since story 9.3, their own requests", () => {
    expect(godisnjiSurfaceKeysOf('member_role')).toEqual([
      CALENDAR_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      MY_LEAVE_RECORDS_KEY,
      MY_LEAVE_REQUESTS_KEY,
    ]);
  });

  it("are the admin overview's, which add the organization's records", () => {
    expect(godisnjiSurfaceKeysOf('admin')).toEqual([
      CALENDAR_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      LEAVE_OVERVIEW_RECORDS_KEY,
    ]);
  });

  it("are a member's own for the hook that draws only those figures", () => {
    expect(GODISNJI_MEMBER_SURFACE_KEYS).toEqual(godisnjiSurfaceKeysOf('member_role'));
  });

  it('wait on the calendar snapshot alone until it names the role', () => {
    expect(godisnjiSurfaceKeysOf(null)).toEqual([CALENDAR_KEY]);
  });

  it("are, for a member, all keys Danas reads too, but the requests, which Danas does not read (story 9.3)", () => {
    const danas = new Set(todaySurfaceKeysOf('member_role').map(text));
    const own = godisnjiSurfaceKeysOf('member_role');

    expect(danas.has(text(MY_LEAVE_REQUESTS_KEY)), 'Danas reads the requests').toBe(false);
    expect(own.map(text)).toContain(text(MY_LEAVE_REQUESTS_KEY));
    for (const key of own) {
      if (text(key) !== text(MY_LEAVE_REQUESTS_KEY)) expect(danas.has(text(key)), text(key)).toBe(true);
    }
  });

  it('are all kept on the device', () => {
    for (const role of ['member_role', 'admin', null] as const) {
      for (const key of godisnjiSurfaceKeysOf(role)) expect(persistsKey(key), text(key)).toBe(true);
    }
  });
});

describe("a leave request's decision screen's keys (story 9.4)", () => {
  const REQUEST = '11111111-1111-4111-8111-111111111111';

  it('are the request, the calendar snapshot and the member list before the request is read, or once it is withdrawn', () => {
    expect(leaveRequestReviewSurfaceKeysOf(REQUEST, null, false)).toEqual([
      LEAVE_REQUEST_KEY(REQUEST),
      CALENDAR_KEY,
      MEMBERS_LIST_KEY,
    ]);
  });

  it("add the preview's reads for a pending request: the leave year, the resolutions and the member's records", () => {
    expect(leaveRequestReviewSurfaceKeysOf(REQUEST, 'member-a', false)).toEqual([
      LEAVE_REQUEST_KEY(REQUEST),
      CALENDAR_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      LEAVE_RECORDS_KEY('member-a'),
    ]);
  });

  it("add the acting admins' names for a decided request", () => {
    expect(leaveRequestReviewSurfaceKeysOf(REQUEST, null, true)).toEqual([
      LEAVE_REQUEST_KEY(REQUEST),
      CALENDAR_KEY,
      MEMBERS_LIST_KEY,
      ACTING_ADMINS_KEY,
    ]);
  });

  it('are all kept on the device', () => {
    for (const key of [
      ...leaveRequestReviewSurfaceKeysOf(REQUEST, 'member-a', false),
      ...leaveRequestReviewSurfaceKeysOf(REQUEST, null, true),
    ]) {
      expect(persistsKey(key), text(key)).toBe(true);
    }
  });
});
