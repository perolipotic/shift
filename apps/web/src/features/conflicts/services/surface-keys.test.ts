import { describe, expect, it } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { ACTING_ADMINS_KEY, TAB_RESOLVED, TAB_UNRESOLVED } from '@/features/conflicts/services/resolved-conflicts';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { RESOLUTION_COUNT_KEYS, RESOLUTION_SURFACE_KEYS, rasporedSurfaceKeysOf } from '@/features/conflicts/services/surface-keys';
import { ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { ORGANIZATION_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-request-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { ORGANIZATION_SWAP_REQUESTS_KEY } from '@/features/swaps/services/organization-swaps';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2c: *Za odluku* by its tab, and one conflict's resolution page, each one snapshot, every key kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("Za odluku's keys", () => {
  it('are the calendar, the organization leave, its resolutions, its requests and (story 12.4) its swaps on Čeka odluku', () => {
    expect(rasporedSurfaceKeysOf(TAB_UNRESOLVED)).toEqual([
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      ORGANIZATION_LEAVE_REQUESTS_KEY,
      ORGANIZATION_SWAP_REQUESTS_KEY,
    ]);
  });

  it('add the acting admins\' names on Odlučeno', () => {
    expect(rasporedSurfaceKeysOf(TAB_RESOLVED)).toEqual([
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      ORGANIZATION_LEAVE_REQUESTS_KEY,
      ORGANIZATION_SWAP_REQUESTS_KEY,
      ACTING_ADMINS_KEY,
    ]);
  });

  it('are all kept on the device', () => {
    for (const tab of [TAB_UNRESOLVED, TAB_RESOLVED] as const) {
      for (const key of rasporedSurfaceKeysOf(tab)) expect(persistsKey(key), text(key)).toBe(true);
    }
  });
});

describe("the resolution page's keys", () => {
  it('are the calendar, live leave, live resolutions, the member list and the organization', () => {
    expect(RESOLUTION_SURFACE_KEYS).toEqual([
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
    ]);
  });

  it('are all kept on the device', () => {
    for (const key of RESOLUTION_SURFACE_KEYS) expect(persistsKey(key), text(key)).toBe(true);
  });

  it("keep the back link count's request and swap reads on the device, though they are not among them", () => {
    for (const key of [ORGANIZATION_LEAVE_REQUESTS_KEY, ORGANIZATION_SWAP_REQUESTS_KEY]) {
      expect(RESOLUTION_SURFACE_KEYS).not.toContainEqual(key);
      expect(persistsKey(key), text(key)).toBe(true);
    }
  });
});

describe("the resolution page's count keys (retro 8–9 item 18)", () => {
  it('are the leave requests and (story 12.4) the swaps alone', () => {
    expect(RESOLUTION_COUNT_KEYS).toEqual([ORGANIZATION_LEAVE_REQUESTS_KEY, ORGANIZATION_SWAP_REQUESTS_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of RESOLUTION_COUNT_KEYS) expect(persistsKey(key), text(key)).toBe(true);
  });
});
