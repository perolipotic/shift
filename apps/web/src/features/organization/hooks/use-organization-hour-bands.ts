import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_TABLE,
  hourBandsNoticeOf,
  hourBandsQueryOptions,
  hourBandsSummaryOf,
  hourBandsSurfaceStateOf,
  type HourBandsFailure,
  type HourBandsSummary,
} from '@/features/hour-bands/services/list';
import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import {
  ORGANIZATION_SURFACE_KEYS,
  organizationNoteZoneOf,
  organizationRefusalOf,
} from '@/features/organization/services/surface-keys';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';

/** What the *Satni pojasi* card draws: the summary, its skeleton, or the read's message. */
export interface OrganizationHourBands {
  /** `null` while there is no answer to summarize. */
  readonly summary: HourBandsSummary | null;
  readonly refusal: HourBandsFailure | null;
  readonly loading: boolean;
}

/**
 * The hour bands as *Organizacija*'s facts card states them (deferred work
 * from story 7.18): the SECOND read the card needs, and the page's only one
 * besides the organization row.
 *
 * NOT A KEY OF ITS OWN (AD-13): the band list's one query definition
 * (`hourBandsQueryOptions`, under `HOUR_BANDS_LIST_KEY`), so the card and
 * `/organizacija/satni-pojasi` share one cache entry, and a band write that
 * invalidates the list refreshes the card too. Every rule is
 * `@/features/hour-bands/services/list`'s.
 */
export function useOrganizationHourBands(): OrganizationHourBands {
  const queryClient = useQueryClient();
  const answerRead = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));
  // STORY 8.2d: part of *Organizacija*'s one snapshot (`ORGANIZATION_SURFACE_KEYS`),
  // decided here from this observer and, for the row, from the cache — the
  // same set and the same zone rule `useOrganizationSettings` decides with —
  // so the card is drawn with the others or the page is unavailable as one.
  // The page's as-of note is the settings hook's; the card adds none.
  // The row exactly as the settings hook's observer holds it: the same entry,
  // so the two hooks decide over one zone and one refusal.
  const row = queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY);
  const { answerOf } = useSnapshotFreshness(
    ORGANIZATION_SURFACE_KEYS,
    [[HOUR_BANDS_LIST_KEY, answerRead]],
    organizationNoteZoneOf(row),
  );

  // NEVER CACHED BANDS BESIDE THE PAGE'S REFUSAL (story 8.2d): a row that
  // resolved with its own refusal is drawn as that message with no note, so
  // the card draws nothing at all rather than bands nobody labelled.
  if (organizationRefusalOf(row) !== null) return { summary: null, refusal: null, loading: false };

  const state = hourBandsSurfaceStateOf(answerOf(answerRead));

  return {
    summary: state.bands === null ? null : hourBandsSummaryOf(state.bands),
    refusal: hourBandsNoticeOf(state),
    loading: state.loading,
  };
}
