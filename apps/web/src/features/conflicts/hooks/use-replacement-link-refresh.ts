import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { CALENDAR_KEY, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { unknownReplacementLinksOf } from '@/features/conflicts/services/replacement-effect';

/**
 * THE FETCH-SKEW RE-READ (story 5.5d). The resolutions re-read can land
 * before the snapshot's — right after `replace_conflict_member`, say — and
 * name an override the snapshot does not hold yet. Until the snapshot is read
 * again that replacement counts (`effectiveResolutionsOf`: unknown, never
 * proven inert), and this hook re-reads the snapshot ONCE for each distinct
 * set of unknown links, so a link to an override that really is gone settles
 * after one read and never loops. Wiring only; the rule is
 * `unknownReplacementLinksOf`, which the node suite executes.
 */
export function useReplacementLinkRefresh(
  snapshot: CalendarSnapshot | null | undefined,
  resolutionRows: readonly unknown[] | undefined,
): void {
  const queryClient = useQueryClient();
  const asked = useRef<string | null>(null);
  const unknown =
    snapshot === null || snapshot === undefined || resolutionRows === undefined
      ? ''
      : unknownReplacementLinksOf(snapshot, resolutionRows).join(',');

  useEffect(() => {
    if (unknown === '' || unknown === asked.current) return;

    asked.current = unknown;
    // A snapshot read already in flight is left to land.
    void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY }, { cancelRefetch: false });
  }, [queryClient, unknown]);
}
