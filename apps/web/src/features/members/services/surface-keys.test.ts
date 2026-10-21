import { describe, expect, it } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { MEMBERS_TABLE_SURFACE_KEYS, memberPageSurfaceKeysOf } from '@/features/members/services/surface-keys';
import { SESSION_SUBJECT_KEY } from '@/features/members/services/write';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { persistsKey } from '@/lib/offline/persistence';

const text = (key: readonly unknown[]): string => JSON.stringify(key);

/** Story 8.2b: the admin's *Ljudi* table reads the member list alone, and it is kept on the device. */
describe("the Ljudi table's keys", () => {
  it('are the member list alone', () => {
    expect(MEMBERS_TABLE_SURFACE_KEYS).toEqual([MEMBERS_LIST_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of MEMBERS_TABLE_SURFACE_KEYS) expect(persistsKey(key), text(key)).toBe(true);
  });
});

/** Story 8.2c: one member's page is the union of its two hooks' reads, every key kept on the device. */
describe("the member page's keys", () => {
  it("are the member edit's reads and the leave card's, once each", () => {
    expect(memberPageSurfaceKeysOf('member-1')).toEqual([
      MEMBERS_LIST_KEY,
      CALENDAR_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      SESSION_SUBJECT_KEY,
      TEAMS_LIST_KEY,
      LEAVE_RECORDS_KEY('member-1'),
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ]);
    const hashed = memberPageSurfaceKeysOf('member-1').map(text);

    expect(new Set(hashed).size).toBe(hashed.length);
  });

  it("name this member's leave alone", () => {
    expect(memberPageSurfaceKeysOf('member-2')).toContainEqual(LEAVE_RECORDS_KEY('member-2'));
    expect(memberPageSurfaceKeysOf('member-2')).not.toContainEqual(LEAVE_RECORDS_KEY('member-1'));
  });

  it('are all kept on the device', () => {
    for (const key of memberPageSurfaceKeysOf('member-1')) expect(persistsKey(key), text(key)).toBe(true);
  });
});
