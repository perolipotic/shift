import { describe, expect, it } from 'vitest';

import { HOUR_BANDS_LIST_KEY } from '@/features/hour-bands/services/list';
import {
  ORGANIZATION_REFUSED,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_UNAVAILABLE,
  type OrganizationOutcome,
} from '@/features/organization/services/snapshot';
import {
  ORGANIZATION_SURFACE_KEYS,
  organizationNoteZoneOf,
  organizationRefusalOf,
  organizationSurfaceTimeZoneOf,
} from '@/features/organization/services/surface-keys';
import { ZONE_NOT_NEEDED, zoneFromReads } from '@/lib/offline/freshness';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2d: *Organizacija* — the row and the hour bands — one snapshot, every key kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);
const organization = { ok: true, snapshot: { timezone: 'Europe/Zagreb' } } as unknown as OrganizationOutcome;

describe("Organizacija's keys", () => {
  it('are the organization and the hour bands', () => {
    expect(ORGANIZATION_SURFACE_KEYS).toEqual([ORGANIZATION_SNAPSHOT_KEY, HOUR_BANDS_LIST_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of ORGANIZATION_SURFACE_KEYS) expect(persistsKey(key), text(key)).toBe(true);
  });
});

describe("the note's zone", () => {
  it("is the row's, and none without one", () => {
    expect(organizationSurfaceTimeZoneOf(organization)).toBe('Europe/Zagreb');
    expect(organizationSurfaceTimeZoneOf({ ok: false, code: ORGANIZATION_UNAVAILABLE })).toBeNull();
    expect(organizationSurfaceTimeZoneOf(undefined)).toBeNull();
  });

  it('comes from the reads, except beside a resolved refusal, which needs none', () => {
    expect(organizationNoteZoneOf(organization)).toEqual(zoneFromReads('Europe/Zagreb'));
    expect(organizationNoteZoneOf(undefined)).toEqual(zoneFromReads(null));
    // Unavailable is the unavailable state, never a refusal drawn on its own.
    expect(organizationNoteZoneOf({ ok: false, code: ORGANIZATION_UNAVAILABLE })).toEqual(zoneFromReads(null));
    expect(organizationNoteZoneOf({ ok: false, code: ORGANIZATION_REFUSED })).toBe(ZONE_NOT_NEEDED);
  });
});

describe('the refusal the read resolved with', () => {
  it('is a resolved refusal other than unavailable, and nothing else', () => {
    expect(organizationRefusalOf({ ok: false, code: ORGANIZATION_REFUSED })).toBe(ORGANIZATION_REFUSED);
    expect(organizationRefusalOf({ ok: false, code: ORGANIZATION_UNAVAILABLE })).toBeNull();
    expect(organizationRefusalOf(organization)).toBeNull();
    expect(organizationRefusalOf(undefined)).toBeNull();
  });
});
