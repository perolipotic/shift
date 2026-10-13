import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { NO_SKEW } from '@/features/calendar/services/marks';
import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';

/**
 * THE SKEW RE-READ for the calendar's marks (story 5.5d's edge case): the
 * leave or resolution read landed after a member or team was added and names
 * an id the cached snapshot does not hold yet (`snapshotSkewOf`; `NO_SKEW`
 * for none). The snapshot is read again ONCE for each
 * distinct set, so ids that really are unknown settle on the alert and its
 * retry after one read and never loop. Wiring only; the rule is
 * `@/features/calendar/services/marks`', which the node suite executes.
 */
export function useSnapshotSkewRefresh(skew: string): void {
  const queryClient = useQueryClient();
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (skew === NO_SKEW || skew === asked.current) return;

    asked.current = skew;
    // A snapshot read already in flight is left to land.
    void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY }, { cancelRefetch: false });
  }, [queryClient, skew]);
}
