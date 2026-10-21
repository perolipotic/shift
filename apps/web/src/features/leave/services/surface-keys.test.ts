import { describe, expect, it } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { LEAVE_OVERVIEW_RECORDS_KEY, MY_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { GODISNJI_MEMBER_SURFACE_KEYS, godisnjiSurfaceKeysOf } from '@/features/leave/services/surface-keys';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { todaySurfaceKeysOf } from '@/features/today/services/surface-keys';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2b: *Godišnji*'s keys per role, every one kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("Godišnji's keys", () => {
  it("are a member's four reads", () => {
    expect(godisnjiSurfaceKeysOf('member_role')).toEqual([
      CALENDAR_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      MY_LEAVE_RECORDS_KEY,
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

  it("are, for a member, all keys Danas reads too", () => {
    const danas = new Set(todaySurfaceKeysOf('member_role').map(text));

    for (const key of godisnjiSurfaceKeysOf('member_role')) expect(danas.has(text(key)), text(key)).toBe(true);
  });

  it('are all kept on the device', () => {
    for (const role of ['member_role', 'admin', null] as const) {
      for (const key of godisnjiSurfaceKeysOf(role)) expect(persistsKey(key), text(key)).toBe(true);
    }
  });
});
