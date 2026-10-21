import { describe, expect, it } from 'vitest';

import { HOUR_BANDS_LIST_KEY } from '@/features/hour-bands/services/list';
import { HOUR_BANDS_SURFACE_KEYS, hourBandsTimeZoneOf } from '@/features/hour-bands/services/surface-keys';
import {
  ORGANIZATION_REFUSED,
  ORGANIZATION_SNAPSHOT_KEY,
  type OrganizationOutcome,
} from '@/features/organization/services/snapshot';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2d: *Satni pojasi* and its editor, one snapshot, every key kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("Satni pojasi's keys", () => {
  it('are the band list and the organization', () => {
    expect(HOUR_BANDS_SURFACE_KEYS).toEqual([HOUR_BANDS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of HOUR_BANDS_SURFACE_KEYS) expect(persistsKey(key), text(key)).toBe(true);
  });
});

describe("the note's zone", () => {
  it("is the organization snapshot's, and none without it", () => {
    const organization = { ok: true, snapshot: { timezone: 'Europe/Zagreb' } } as unknown as OrganizationOutcome;

    expect(hourBandsTimeZoneOf(organization)).toBe('Europe/Zagreb');
    expect(hourBandsTimeZoneOf({ ok: false, code: ORGANIZATION_REFUSED })).toBeNull();
    expect(hourBandsTimeZoneOf(undefined)).toBeNull();
  });
});
