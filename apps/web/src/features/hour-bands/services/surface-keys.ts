import type { QueryKey } from '@tanstack/react-query';

import { HOUR_BANDS_LIST_KEY } from '@/features/hour-bands/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  organizationTimeZone,
  type OrganizationOutcome,
} from '@/features/organization/services/snapshot';

/**
 * *Satni pojasi* `/organizacija/satni-pojasi` and its editor `$id` as one
 * snapshot (story 8.2d): the band list, and the organization snapshot the
 * as-of note takes its zone from — the rows carry none. The list hook and the
 * edit hook decide over this one set. Neither observes the organization (the
 * chrome always does), so it is decided from the cache, never a second
 * `useQuery` on a band screen. `surface-keys.test.ts` pins the set and that
 * every key is kept on the device.
 */
export const HOUR_BANDS_SURFACE_KEYS: readonly QueryKey[] = [HOUR_BANDS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY];

/**
 * The zone *Satni pojasi*'s as-of note states its time in (story 8.2d): the
 * organization snapshot's, as the cache holds it. With none — never read, or
 * an answer that is its own failure — it is `null`, and the bands are
 * unavailable offline rather than drawn without their note.
 */
export function hourBandsTimeZoneOf(organization: OrganizationOutcome | undefined): string | null {
  return organization !== undefined && organization.ok ? organizationTimeZone(organization.snapshot) : null;
}
