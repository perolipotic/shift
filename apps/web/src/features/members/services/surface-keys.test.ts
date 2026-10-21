import { describe, expect, it } from 'vitest';

import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { MEMBERS_TABLE_SURFACE_KEYS } from '@/features/members/services/surface-keys';
import { persistsKey } from '@/lib/offline/persistence';

/** Story 8.2b: the admin's *Ljudi* table reads the member list alone, and it is kept on the device. */
describe("the Ljudi table's keys", () => {
  it('are the member list alone', () => {
    expect(MEMBERS_TABLE_SURFACE_KEYS).toEqual([MEMBERS_LIST_KEY]);
  });

  it('are all kept on the device', () => {
    for (const key of MEMBERS_TABLE_SURFACE_KEYS) expect(persistsKey(key), JSON.stringify(key)).toBe(true);
  });
});
