import { skipToken, useQueryClient, type FetchQueryOptions, type QueryFunction, type QueryKey, type SkipToken } from '@tanstack/react-query';

import {
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import type { ErasureReads } from '@/features/conflicts/services/erasure-check';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_TABLE,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * THE THREE CORE READS every erasure check stands on (stories 5.5a, 5.5b),
 * as a surface runs them: wiring only — every decision is
 * `@/features/conflicts/services/erasure-check`'s and
 * `@/features/conflicts/services/erasures`'s, which the node suite executes.
 *
 * FRESH ON EVERY CALL. The calendar snapshot, the organization's live leave
 * records and its live resolutions — each under the key its own screen reads
 * it with (AD-13) — are fetched again whenever the check runs
 * (`staleTime: 0`): on the surface's save, on the dialog's own save, and on
 * "Pokušaj ponovno". Nothing is observed between presses. A surface that
 * needs more (the rotation builder's rotation) fetches it beside these.
 *
 * FETCHED UNDER THE CHECK'S OWN ENTRY, SHARED ON SUCCESS (story 5.5b). Each
 * is fetched under its screen's key with {@link ERASURE_CHECK_KEY_PART}
 * appended — an entry observed by nothing — so a read that fails here
 * refuses the check and leaves the screen's read as it was: the calendar,
 * which observes all three, keeps its month and its open day detail rather
 * than turning unavailable under the admin's form. Once all three have
 * answered, each answer is written into the screen's own entry
 * (`setQueryData`), so every screen shows the data the dialog lists, as
 * when the check read under those keys (5.5a). Invalidating a screen's key
 * reaches the check's entries too, by prefix, and harmlessly.
 *
 * NEVER STUCK PENDING. `networkMode: 'always'` runs each fetch even when the
 * browser reports itself offline, so a fetch that cannot reach the network
 * rejects — and every query function here throws on a failure — rather than
 * pausing until the network returns.
 */
/** What a check's own fetch appends to the key its screen reads with. */
export const ERASURE_CHECK_KEY_PART = 'erasure-check';

/** The part of a screen's query options a check's own entry is built from: the read and its retry. */
interface ScreenRead<Data, Key extends QueryKey> {
  readonly queryKey: Key;
  readonly queryFn?: QueryFunction<Data, Key> | SkipToken;
  readonly retry?: FetchQueryOptions<Data, Error, Data, Key>['retry'];
  readonly retryDelay?: FetchQueryOptions<Data, Error, Data, Key>['retryDelay'];
}

/**
 * A screen's read under the check's own cache entry: the same query function
 * — still handed the key it was written for — and the same retry, the key
 * extended by {@link ERASURE_CHECK_KEY_PART}.
 */
export function ownEntryOf<Data, Key extends QueryKey>(options: ScreenRead<Data, Key>): FetchQueryOptions<Data, Error, Data> {
  const { queryKey, queryFn, retry, retryDelay } = options;

  return {
    queryKey: [...queryKey, ERASURE_CHECK_KEY_PART],
    queryFn:
      queryFn === undefined || queryFn === skipToken
        ? skipToken
        : (context) => queryFn({ ...context, queryKey }),
    ...(retry === undefined ? {} : { retry }),
    ...(retryDelay === undefined ? {} : { retryDelay }),
  };
}

/** The three core reads, fetched afresh, and how their answers reach the screens. */
export interface ErasureReadsHook {
  /** Fetches the three under the check's own entries; rejects when any fails. */
  readonly read: () => Promise<ErasureReads>;
  /**
   * Writes answers that ALL succeeded into the screens' own entries, so a
   * screen shows the data the dialog lists. A surface with a read of its own
   * calls it once that read has answered too.
   */
  readonly share: (reads: ErasureReads) => void;
  /** {@link read}, then {@link share}: for a surface with no read of its own. */
  readonly readAndShare: () => Promise<ErasureReads>;
}

export function useErasureReads(): ErasureReadsHook {
  const queryClient = useQueryClient();
  const calendarRead = calendarQueryOptions(
    () => supabaseClient().from(CALENDAR_READ_TABLE),
    // As the calendar's: the client's `rpc` is wider than the calls made.
    () => supabaseClient() as unknown as CalendarMembersRpc,
  );
  const leaveRead = organizationLeaveRecordsQueryOptions(
    () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
  );
  const resolutionsRead = organizationConflictResolutionsQueryOptions(
    () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
  );

  async function read(): Promise<ErasureReads> {
    const [calendar, records, resolutions] = await Promise.all([
      queryClient.fetchQuery({ ...ownEntryOf(calendarRead), staleTime: 0, networkMode: 'always' }),
      queryClient.fetchQuery({ ...ownEntryOf(leaveRead), staleTime: 0, networkMode: 'always' }),
      queryClient.fetchQuery({ ...ownEntryOf(resolutionsRead), staleTime: 0, networkMode: 'always' }),
    ]);

    return { calendar, records, resolutions };
  }

  function share({ calendar, records, resolutions }: ErasureReads): void {
    queryClient.setQueryData(calendarRead.queryKey, calendar);
    queryClient.setQueryData(leaveRead.queryKey, records);
    queryClient.setQueryData(resolutionsRead.queryKey, resolutions);
  }

  return {
    read,
    share,
    readAndShare: async () => {
      const reads = await read();

      share(reads);

      return reads;
    },
  };
}
