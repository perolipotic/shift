import { onlineManager, useQueryClient } from '@tanstack/react-query';

import { ownEntryOf, useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import {
  cancelErasureCheckOf,
  erasureCheckOf,
  type CancelErasureCheck,
  type ErasureCheck,
  type ErasureReads,
} from '@/features/rotation/services/erasure-check';
import { ROTATION_READ_TABLE, rotationQueryOptions } from '@/features/rotation/services/list';
import type { RotationDraft } from '@/features/rotation/utils/draft';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The rotation save's erasure check (story 5.5a), as the builder runs it:
 * wiring only — every decision is `@/features/rotation/services/erasure-check`'s
 * and `@/features/rotation/services/erasures`'s, which the node suite executes.
 *
 * FRESH ON EVERY PRESS. The three core reads are the shared
 * `useErasureReads`'s (story 5.5b); the rotation the save is built from is
 * the builder's own addition, fetched beside them under the check's own entry
 * (`ownEntryOf`, `staleTime: 0`) and, like them, with `networkMode: 'always'`,
 * so a fetch offline rejects rather than pausing and a failed one never puts
 * the builder's own read in error. Once all four have answered, each answer
 * is written into its screen's own entry — `ROTATION_KEY` included — so the
 * builder shows the rotation the dialog was derived from, as in 5.5a.
 *
 * The cancel of a scheduled change (story 5.5g) stands on the same four reads
 * (`useCancelErasureCheck`).
 */
export function useErasureCheck(): (entered: RotationDraft, today: string) => Promise<ErasureCheck> {
  const read = useFreshRotationReads();

  return (entered, today) => erasureCheckOf(read, entered, today, onlineManager.isOnline());
}

/**
 * The scheduled change's cancel's erasure check (story 5.5g), over the very
 * same four fresh reads as the save's.
 */
export function useCancelErasureCheck(): (confirmed: string, today: string) => Promise<CancelErasureCheck> {
  const read = useFreshRotationReads();

  return (confirmed, today) => cancelErasureCheckOf(read, confirmed, today, onlineManager.isOnline());
}

/** The four fresh reads, written into the screens' own entries once all have answered. */
function useFreshRotationReads(): () => Promise<ErasureReads> {
  const queryClient = useQueryClient();
  const core = useErasureReads();

  return async () => {
    const rotationRead = rotationQueryOptions(() => supabaseClient().from(ROTATION_READ_TABLE));
    const [rotation, reads] = await Promise.all([
      queryClient.fetchQuery({ ...ownEntryOf(rotationRead), staleTime: 0, networkMode: 'always' }),
      core.read(),
    ]);

    // ALL FOUR ANSWERED: the builder and the other screens show what the dialog lists.
    core.share(reads);
    queryClient.setQueryData(rotationRead.queryKey, rotation);

    return { rotation, ...reads };
  };
}
