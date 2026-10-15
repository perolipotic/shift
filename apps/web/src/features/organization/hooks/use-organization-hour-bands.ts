import { useQuery } from '@tanstack/react-query';

import {
  HOUR_BANDS_TABLE,
  hourBandsNoticeOf,
  hourBandsQueryOptions,
  hourBandsSummaryOf,
  hourBandsSurfaceStateOf,
  type HourBandsFailure,
  type HourBandsSummary,
} from '@/features/hour-bands/services/list';
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
  const answer = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));
  const state = hourBandsSurfaceStateOf(answer);

  return {
    summary: state.bands === null ? null : hourBandsSummaryOf(state.bands),
    refusal: hourBandsNoticeOf(state),
    loading: state.loading,
  };
}
