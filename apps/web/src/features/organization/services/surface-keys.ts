import type { QueryKey } from '@tanstack/react-query';

import { HOUR_BANDS_LIST_KEY } from '@/features/hour-bands/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_UNAVAILABLE,
  organizationTimeZone,
  type OrganizationFailure,
  type OrganizationOutcome,
} from '@/features/organization/services/snapshot';
import { ZONE_NOT_NEEDED, zoneFromReads, type NoteZone } from '@/lib/offline/freshness';

/**
 * *Organizacija* `/organizacija` as one snapshot (story 8.2d): the
 * organization row and the hour bands its *Satni pojasi* card summarizes.
 * `useOrganizationSettings` and `useOrganizationHourBands` both decide over
 * this one set — each observing its own read and deciding the other's from
 * the cache — so the cards are drawn whole under one note or the page is
 * unavailable as one. `surface-keys.test.ts` pins the set and that every key
 * is kept on the device. The logo's signed URL is no part of it: it is never
 * kept, and offline the lockup falls back to the mark.
 */
export const ORGANIZATION_SURFACE_KEYS: readonly QueryKey[] = [ORGANIZATION_SNAPSHOT_KEY, HOUR_BANDS_LIST_KEY];

/**
 * The zone *Organizacija*'s as-of note states its time in (story 8.2d): the
 * organization snapshot's own. With no row — never read, or an answer that is
 * its own failure — `null`.
 */
export function organizationSurfaceTimeZoneOf(organization: OrganizationOutcome | undefined): string | null {
  return organization !== undefined && organization.ok ? organizationTimeZone(organization.snapshot) : null;
}

/**
 * The refusal the row's read RESOLVED with, other than unavailable
 * (`ORGANIZATION_REFUSED`, say), or `null` (story 8.2d). Such an answer is
 * never kept on the device, so it is this session's own, and it is drawn as
 * its own message whatever the page's freshness decides — offline too, with
 * the hour bands never read. Unavailable is not one of these: it is the
 * unavailable state, which the freshness decides.
 */
export function organizationRefusalOf(organization: OrganizationOutcome | undefined): OrganizationFailure | null {
  return organization !== undefined && !organization.ok && organization.code !== ORGANIZATION_UNAVAILABLE
    ? organization.code
    : null;
}

/**
 * Where *Organizacija*'s note takes its zone from (story 8.2d). A read that
 * RESOLVED with a refusal other than unavailable (`ORGANIZATION_REFUSED`, say)
 * draws its own message, never a snapshot, so it needs no zone
 * (`ZONE_NOT_NEEDED`) and shows no note. Anything else takes the row's zone,
 * and with none the cached snapshot is unavailable offline rather than drawn
 * without its note.
 */
export function organizationNoteZoneOf(organization: OrganizationOutcome | undefined): NoteZone {
  return organizationRefusalOf(organization) !== null
    ? ZONE_NOT_NEEDED
    : zoneFromReads(organizationSurfaceTimeZoneOf(organization));
}
