import { describe, expect, it } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import { hoursSurfaceKeysOf } from '@/features/hours/services/surface-keys';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { todaySurfaceKeysOf } from '@/features/today/services/surface-keys';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2b: *Sati* reads offline only its own reads, each one *Danas* reads online for the same role. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("Sati's keys", () => {
  for (const role of ['member_role', 'admin', null] as const satisfies readonly (MemberRole | null)[]) {
    it(`are a subset of Danas's keys for ${String(role)}`, () => {
      const danas = new Set(todaySurfaceKeysOf(role).map(text));

      for (const key of hoursSurfaceKeysOf(role)) expect(danas.has(text(key)), text(key)).toBe(true);
    });

    it(`are all kept on the device for ${String(role)}`, () => {
      for (const key of hoursSurfaceKeysOf(role)) expect(persistsKey(key), text(key)).toBe(true);
    });
  }

  it('are exactly the reads Sati makes, by role', () => {
    expect(hoursSurfaceKeysOf(null)).toEqual([CALENDAR_KEY]);
    expect(hoursSurfaceKeysOf('member_role')).toEqual([CALENDAR_KEY, MY_LEAVE_RECORDS_KEY, MY_CONFLICT_RESOLUTIONS_KEY]);
    expect(hoursSurfaceKeysOf('admin')).toEqual([
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ]);
  });
});
