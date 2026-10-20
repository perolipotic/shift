import { describe, expect, it } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { calendarSurfaceKeysOf } from '@/features/calendar/services/surface-keys';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { todaySurfaceKeysOf } from '@/features/today/services/surface-keys';
import { PERSISTED_KEY_ROOTS } from '@/lib/offline/persistence';

/**
 * Story 8.2's prefetch, REINTERPRETED: the calendar snapshot is one
 * unwindowed entry that covers every month, and *Danas* already reads every
 * key *Kalendar* reads for the same role. Keeping those keys on the device IS
 * the prefetch — so a member who opened *Danas* online opens *Kalendar*
 * offline — and this suite pins both halves.
 */

const ROLES: readonly MemberRole[] = ['member_role', 'admin'];

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe('Danas reads everything Kalendar reads, for each role', () => {
  for (const role of ROLES) {
    it(`for a ${role}, every Kalendar key is a Danas key`, () => {
      const danas = new Set(todaySurfaceKeysOf(role).map(text));

      for (const key of calendarSurfaceKeysOf(role)) expect(danas.has(text(key)), text(key)).toBe(true);
    });
  }

  it('before the role is known, Kalendar waits on the snapshot alone, which Danas reads too', () => {
    expect(calendarSurfaceKeysOf(null)).toEqual([CALENDAR_KEY]);
    expect(todaySurfaceKeysOf(null).map(text)).toContain(text(CALENDAR_KEY));
  });

  it('reads by role exactly what the screen enables: a member their own leave, an admin the organization\'s', () => {
    expect(calendarSurfaceKeysOf('member_role')).toEqual([CALENDAR_KEY, MY_LEAVE_RECORDS_KEY]);
    expect(calendarSurfaceKeysOf('admin')).toEqual([
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ]);
  });

  it('keeps every key either surface reads on the device', () => {
    for (const role of [...ROLES, null]) {
      for (const key of [...todaySurfaceKeysOf(role), ...calendarSurfaceKeysOf(role)]) {
        expect(key, text(key)).toHaveLength(1);
        expect(PERSISTED_KEY_ROOTS, text(key)).toContain(key[0]);
      }
    }
  });
});
