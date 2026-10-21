import { describe, expect, it } from 'vitest';

import { ROTATION_KEY } from '@/features/rotation/services/list';
import { ROTATION_SURFACE_KEYS, rotationSurfaceTimeZoneOf } from '@/features/rotation/services/surface-keys';
import { SHIFT_TYPES_LIST_KEY } from '@/features/shift-types/services/list';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2d: *Postavke rotacije* — the shift types and the builder — one snapshot, every key kept on the device. */

const text = (key: readonly unknown[]): string => JSON.stringify(key);

describe("Postavke rotacije's keys", () => {
  it('are the shift types and the rotation', () => {
    expect(ROTATION_SURFACE_KEYS).toEqual([SHIFT_TYPES_LIST_KEY, ROTATION_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of ROTATION_SURFACE_KEYS) expect(persistsKey(key), text(key)).toBe(true);
  });
});

describe("the note's zone", () => {
  it("is the shift types', then the rotation's, and none without either", () => {
    const types = { timeZone: 'Europe/Zagreb' };
    const rotation = { timeZone: 'Europe/Vienna' };

    expect(rotationSurfaceTimeZoneOf(types, rotation)).toBe('Europe/Zagreb');
    expect(rotationSurfaceTimeZoneOf(undefined, rotation)).toBe('Europe/Vienna');
    expect(rotationSurfaceTimeZoneOf(types, undefined)).toBe('Europe/Zagreb');
    expect(rotationSurfaceTimeZoneOf(undefined, undefined)).toBeNull();
  });
});
