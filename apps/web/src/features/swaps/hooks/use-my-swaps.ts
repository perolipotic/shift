import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  myConflictResolutionsQueryOptions,
  type MyConflictResolutionsRpc,
} from '@/features/conflicts/services/resolutions';
import {
  MY_SWAPS_TABLE,
  MY_SWAP_REQUESTS_KEY,
  SWAP_ACT_FAILED,
  actOnSwapRequest,
  mySwapRequestsQueryOptions,
  mySwapRowsOf,
  mySwapsOf,
  type MySwapRow,
  type MySwapsTable,
  type SwapAction,
  type SwapActFailure,
  type SwapRequestRpc,
  type SwapShiftShown,
} from '@/features/swaps/services/my-swaps';
import { swapLeaveKeysOf } from '@/features/swaps/services/swap-proposal';
import { SWAP_REQUEST_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { useOrganizationToday } from '@/hooks/organization-today';
import { ZONE_FROM_CALENDAR } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/** No rows: frozen, so a memo's answer stays the same object. */
const NO_ROWS: readonly MySwapRow[] = Object.freeze([]);

/**
 * The viewer's own swaps read (story 12.3), under `MY_SWAP_REQUESTS_KEY`:
 * filtered to the calendar snapshot's viewer, and made only once the snapshot
 * names them and `enabled` holds (the calendar enables it for a member
 * alone). One cache entry, shared by *Danas*, *Kalendar*'s day detail and the
 * proposal surface. Named structurally, as the leave requests' read is.
 */
export function useMySwapRequestsRead(enabled = true) {
  const calendarRead = useCalendarSnapshot();
  const memberId = calendarRead.data === undefined ? null : calendarRead.data.viewer.memberId;

  return useQuery({
    ...mySwapRequestsQueryOptions(() => supabaseClient().from(MY_SWAPS_TABLE) as unknown as MySwapsTable, memberId),
    enabled: enabled && memberId !== null,
  });
}

/** An action that did not land, and the swap it was for, named by its given shift in the alert. */
export interface SwapActRefusal {
  readonly code: SwapActFailure;
  readonly shift: SwapShiftShown;
}

/** An action that landed: what was done, and to which swap. */
export interface SwapActed {
  readonly action: SwapAction;
  readonly shift: SwapShiftShown;
}

/**
 * *Zamjene* on *Danas* (story 12.3): the viewer's own swaps from both sides,
 * *Prihvati*, *Odbij* and *Povuci*, and the card's one outcome line. Wiring
 * only — every rule is `@/features/swaps/services/my-swaps`'s, which the node
 * suite executes.
 *
 * ONE SNAPSHOT (story 8.2): the calendar, the swaps and the viewer's own
 * resolutions (the leave keys the consequence counts, as their *Sati* does)
 * are seen through the page's own freshness, over `surfaceKeys` — *Danas*'s
 * keys for the body's role — so offline the card is drawn from the cached
 * snapshot under the page's as-of note, or not at all. No row, no card.
 *
 * THE ACTIONS call 0049's definers with no confirmation. One in flight at a
 * time (a ref, no mutation and nothing optimistic); offline nothing is sent.
 * After any outcome the swaps are read again through `refreshAfterWrite` with
 * `SWAP_REQUEST_WRITE_DEPENDENTS`, so a swap no longer open (P0002, a
 * colleague's withdrawal in the meantime) shows as it now stands.
 */
export function useMySwaps(surfaceKeys: readonly QueryKey[]) {
  const queryClient = useQueryClient();
  const calendarRead = useCalendarSnapshot();
  const swapsRead = useMySwapRequestsRead();
  const resolutionsRead = useQuery(myConflictResolutionsQueryOptions(() => supabaseClient() as unknown as MyConflictResolutionsRpc));
  const { answerFor } = useSnapshotFreshness(
    surfaceKeys,
    [
      [CALENDAR_KEY, calendarRead],
      [MY_SWAP_REQUESTS_KEY, swapsRead],
      [MY_CONFLICT_RESOLUTIONS_KEY, resolutionsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const snapshot = calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead)).snapshot;
  const swapRows = answerFor(MY_SWAP_REQUESTS_KEY, swapsRead).data;
  const resolutionRows = answerFor(MY_CONFLICT_RESOLUTIONS_KEY, resolutionsRead).data;
  const { today } = useOrganizationToday(snapshot === null ? null : snapshot.timeZone);
  const leave = useMemo(
    () => (snapshot === null ? { keys: [], known: false } : swapLeaveKeysOf(snapshot, resolutionRows)),
    [snapshot, resolutionRows],
  );
  const rows = useMemo(() => {
    if (snapshot === null || today === null || swapRows === undefined) return NO_ROWS;

    // A row that cannot be trusted is dropped (logged) and the rest stand; an answer that is no list is no card.
    const swaps = mySwapsOf(swapRows, snapshot.viewer.memberId);

    if (swaps === null) return NO_ROWS;

    return mySwapRowsOf(snapshot, swaps, today, leave.keys);
  }, [snapshot, today, swapRows, leave.keys]);
  const acting = useRef(false);
  /** The swap whose action is in flight: its row alone reads busy; cleared in `finally`. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<SwapActRefusal | null>(null);
  const [acted, setActed] = useState<SwapActed | null>(null);
  /** The outcome line — the refusal's alert or the status — which takes focus once drawn. */
  const outcomeField = useRef<HTMLParagraphElement>(null);
  /** The card's heading, where focus rests when no line is drawn. */
  const heading = useRef<HTMLHeadingElement>(null);

  /** *Prihvati*, *Odbij* or *Povuci* on `row`'s swap: one at a time, online only, re-read after any outcome. */
  async function act(row: MySwapRow, action: SwapAction): Promise<void> {
    if (acting.current) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    acting.current = true;
    setRefusal(null);
    setActed(null);
    setPendingId(row.swap.id);

    const shift = row.given;

    try {
      const outcome = await actOnSwapRequest(supabaseClient() as unknown as SwapRequestRpc, row.swap.id, action);

      if (outcome.ok) setActed({ action, shift });
      else setRefusal({ code: outcome.code, shift });

      try {
        // A P0002 is the list behind the database: the re-read shows the swap as it stands.
        await refreshAfterWrite(queryClient, MY_SWAP_REQUESTS_KEY, SWAP_REQUEST_WRITE_DEPENDENTS);
      } catch (cause) {
        console.error(SWAP_ACT_FAILED, cause);
      }
    } catch (cause) {
      console.error(SWAP_ACT_FAILED, cause);
      setRefusal({ code: SWAP_ACT_FAILED, shift });
    } finally {
      acting.current = false;
      setPendingId(null);
    }

    // The row's buttons change after a landed action: focus goes to the line that says so.
    focusLater([() => outcomeField.current], () => heading.current);
  }

  return {
    rows,
    // STORY 12.2 REVIEW, as the proposal's: the figures count no leave while the resolutions cannot be read.
    leaveUnknown: !leave.known,
    pendingId,
    refusal,
    acted,
    act,
    outcomeField,
    heading,
  };
}

export type MySwaps = ReturnType<typeof useMySwaps>;
