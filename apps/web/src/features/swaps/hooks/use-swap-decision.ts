import { onlineManager, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { useSnapshotSkewRefresh } from '@/features/calendar/hooks/use-snapshot-skew-refresh';
import { CALENDAR_FETCH_FETCHING, CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { snapshotSkewOf } from '@/features/calendar/services/snapshot-skew';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import {
  SWAP_APPROVED_SAVED,
  SWAP_REJECTED_SAVED,
  withResolutionSaved,
} from '@/features/conflicts/services/resolution-screen';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  ACTING_ADMINS_KEY,
  ACTING_ADMINS_TABLE,
  actingAdminsQueryOptions,
  type ActingAdminsTable,
} from '@/features/conflicts/services/resolved-conflicts';
import {
  LEAVE_RECORDS_TABLE,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { useOrganizationSwapRequests } from '@/features/swaps/hooks/use-organization-swaps';
import {
  ORGANIZATION_SWAP_REQUESTS_KEY,
  SWAP_APPROVED,
  SWAP_REJECTED,
  organizationSwapFoundOf,
  type OrganizationSwap,
} from '@/features/swaps/services/organization-swaps';
import {
  SWAP_DECISION_FAILED,
  SWAP_DECISION_ARCHIVED,
  SWAP_DECISION_MEMBER_INACTIVE,
  SWAP_DECISION_NOT_WAITING,
  SWAP_DECISION_STALE,
  SWAP_DECISION_TAKEN,
  SWAP_SCREEN_LOADING,
  SWAP_SCREEN_UNAVAILABLE,
  SWAP_SCREEN_WAITING,
  decideSwapRequest,
  swapDecisionOf,
  swapDecisionRefreshKeysOf,
  swapDecisionSurfaceKeysOf,
  swapErasureCheckOf,
  swapNeedsActors,
  swapNeedsPreview,
  type DecideSwapRequestRpc,
  type SwapDecisionChoice,
  type SwapDecisionFailure,
  type SwapDecisionScreen,
} from '@/features/swaps/services/swap-decision';
import { useOrganizationToday } from '@/hooks/organization-today';
import { refreshAfterWrite } from '@/features/teams/services/dependents';
import { ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * The refusals that say the approval cannot be made as the swap stands — a
 * member inactive (55000), the roster already changed (23505), an archived
 * team (23514): *Odobri* is withheld for the rest of this screen's life, and
 * *Odbij* stays.
 */
const APPROVAL_REFUSALS: readonly SwapDecisionFailure[] = [
  SWAP_DECISION_MEMBER_INACTIVE,
  SWAP_DECISION_TAKEN,
  SWAP_DECISION_ARCHIVED,
];

/** A waiting screen, the one a decision is made on. */
type WaitingScreen = Extract<SwapDecisionScreen, { readonly kind: typeof SWAP_SCREEN_WAITING }>;

/**
 * One swap's decision screen (story 12.4): its reads, *Odobri* and *Odbij*.
 * Wiring only — every rule is `@/features/swaps/services/swap-decision`'s,
 * which the node suite executes.
 *
 * THE READS, each under its own key and shared with the screens that own it
 * (AD-13): the organization's swaps (the queue's own read) and the calendar
 * snapshot for every swap; for a waiting one the organization's live leave
 * and resolutions — what the preview and the erasure check stand on; for a
 * decided one the acting admins' names, as *Odlučeno* reads them.
 *
 * ONE SNAPSHOT, ONLINE OR NOT (story 8.2): the reads are seen through the
 * page's freshness, so offline the whole cached snapshot is drawn under the
 * as-of note, or the unavailable state is; both decisions are gated then.
 *
 * *ODOBRI* IS GUARDED (AD-5), as a calendar roster change is
 * (`use-roster-form`): the erasure check over fresh reads first, under ONE
 * latch held from the press to the write's end. Stale over the fresh reads
 * refuses, and the screen is read again. None erased writes at once; some
 * open the shared `ErasureDialog`, and the write waits for every row to be
 * confirmed — the check derived again on the dialog's save, a changed list
 * shown again undecided. A check that cannot be derived refuses the write,
 * with a retry. *Odbij* records the decision alone.
 *
 * THE WRITE calls 0049's decision (`decideSwapRequest`). One in flight at a
 * time (a ref; no mutation and nothing optimistic); offline nothing is sent. A landed
 * decision HOLDS the view it decided while its re-read lands
 * (`SWAP_REQUEST_DECISION_DEPENDENTS`), then returns to *Za odluku* with its
 * status line in router state (`withResolutionSaved`). A refusal says so in
 * an alert that takes focus, and the screen is read again. A screen left
 * meanwhile is never navigated away from.
 */
export function useSwapDecision(requestId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deciding = useRef(false);
  /** A decision is in flight: both buttons wait, and the busy one says so. */
  const [pending, setPending] = useState<SwapDecisionChoice | null>(null);
  const [failure, setFailure] = useState<SwapDecisionFailure | null>(null);
  /** The approval's erasure check could not be derived: the refusal with its retry. */
  const [unchecked, setUnchecked] = useState(false);
  /**
   * An approval refused as the swap stands (`APPROVAL_REFUSALS`): *Odobri*
   * stays withheld until the screen remounts — the simpler of the two rules,
   * never cleared by a re-read.
   */
  const [approvalRefused, setApprovalRefused] = useState(false);
  /** The view a landed decision holds while its re-read and its navigation land. */
  const [landed, setLanded] = useState<SwapDecisionScreen | null>(null);
  /** The refusal's alert, which takes focus once drawn. */
  const alertField = useRef<HTMLParagraphElement>(null);
  /** The heading, where focus rests when no alert is drawn. */
  const heading = useRef<HTMLHeadingElement>(null);
  /** *Odobri*, where focus returns when the erasure confirmation closes. */
  const approveButton = useRef<HTMLButtonElement>(null);
  /** The unchecked refusal's retry. */
  const retryButton = useRef<HTMLButtonElement>(null);
  /** The erasure confirmation's own save: where focus returns when the connection drops mid-check. */
  const erasuresSaveButton = useRef<HTMLButtonElement>(null);
  /** Whether this screen is still the one shown: a late decision never moves another. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const readErasures = useErasureReads();
  const confirmation = useErasureConfirmation<OrganizationSwap>(pending !== null, () => approveButton.current);

  const swapsRead = useOrganizationSwapRequests();
  // PARSED ONCE per answer: the screen's own derivation reuses it.
  const swapRows = swapsRead.data;
  const found = useMemo(
    () => (swapRows === undefined ? undefined : organizationSwapFoundOf(swapRows, requestId)),
    [swapRows, requestId],
  );
  // WHAT THE SCREEN STANDS ON follows the swap as the cache holds it.
  const known = found?.swap ?? null;
  const waiting = swapNeedsPreview(known);
  const decided = swapNeedsActors(known);

  const calendarRead = useCalendarSnapshot();
  const recordsRead = useQuery({
    // Named structurally, as the queue's read is.
    ...organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
    enabled: waiting,
  });
  const resolutionsRead = useQuery({
    ...organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
    enabled: waiting,
  });
  const actorsRead = useQuery(
    actingAdminsQueryOptions(() => supabaseClient().from(ACTING_ADMINS_TABLE) as unknown as ActingAdminsTable, decided),
  );
  const { freshness, clock, answerFor } = useSnapshotFreshness(
    swapDecisionSurfaceKeysOf(waiting, decided),
    [
      [ORGANIZATION_SWAP_REQUESTS_KEY, swapsRead],
      [CALENDAR_KEY, calendarRead],
      [ORGANIZATION_LEAVE_RECORDS_KEY, recordsRead],
      [ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead],
      [ACTING_ADMINS_KEY, actorsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const calendarState = calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead));
  const swapsAnswer = answerFor(ORGANIZATION_SWAP_REQUESTS_KEY, swapsRead);

  // AS THE QUEUE: a swap naming a member or team the snapshot does not hold yet re-reads it once.
  useSnapshotSkewRefresh(snapshotSkewOf(calendarState.snapshot, undefined, undefined, undefined, swapsAnswer.data));

  // The organization's today, moved at its midnight: a screen left open overnight says a date has passed.
  const { now } = useOrganizationToday(calendarState.snapshot === null ? null : calendarState.snapshot.timeZone);
  const derived = swapDecisionOf(
    {
      swaps: swapsAnswer,
      calendar: calendarState,
      records: answerFor(ORGANIZATION_LEAVE_RECORDS_KEY, recordsRead),
      resolutions: answerFor(ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead),
      actors: answerFor(ACTING_ADMINS_KEY, actorsRead),
      // THE RAW OBSERVER'S fetch flag (the fetch-flag rule, `use-snapshot-freshness`).
      snapshotFetching: calendarRead.fetchStatus === CALENDAR_FETCH_FETCHING,
    },
    requestId,
    now,
    // The rows the memo parsed, when they are the very rows the answer holds.
    swapsAnswer.data === swapRows ? found : undefined,
  );
  const screen = landed ?? derived;
  const canApprove = screen.kind === SWAP_SCREEN_WAITING && !screen.stale && !approvalRefused;

  /** Re-read after a decision or a refusal, never turning its outcome into a refusal. */
  async function refresh(dependents: readonly QueryKey[]): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, ORGANIZATION_SWAP_REQUESTS_KEY, dependents);
    } catch (cause) {
      console.error(SWAP_DECISION_FAILED, cause);
    }
  }

  /** A stale approval: said at once, the screen read again, the alert focused. */
  async function refuseStale(): Promise<void> {
    setFailure(SWAP_DECISION_STALE);
    await refresh(swapDecisionRefreshKeysOf(SWAP_DECISION_STALE));
    focusLater([() => alertField.current], () => heading.current);
  }

  /**
   * THE WRITE ITSELF, under the latch its caller already holds: the decision
   * on `view`'s swap. A refusal is said at once and the screen read again; a
   * landed decision holds the view while the re-read lands, then returns to
   * the queue with its status line.
   */
  async function write(view: WaitingScreen, choice: SwapDecisionChoice, reason: string | null): Promise<void> {
    const { swap, proposerName, addresseeName, dateShown } = view.facts;
    /** Set once the database has decided: nothing after it may say the decision failed. */
    let landedWrite = false;

    try {
      const outcome = await decideSwapRequest(supabaseClient() as unknown as DecideSwapRequestRpc, swap.id, choice, reason);

      if (!outcome.ok) {
        // A screen left meanwhile is not written to.
        if (!mounted.current) return;
        // Said at once, before the re-read can change what the screen is.
        setFailure(outcome.code);
        if (APPROVAL_REFUSALS.includes(outcome.code)) setApprovalRefused(true);
        await refresh(swapDecisionRefreshKeysOf(outcome.code));
        focusLater([() => alertField.current], () => heading.current);

        return;
      }

      landedWrite = true;
      // HELD while the re-read lands, so the queue opens on fresh rows and
      // this screen never flashes the swap as already decided.
      if (mounted.current) setLanded(view);
      // THE RE-READ RUNS EVEN ON A SCREEN LEFT MEANWHILE: the decision landed,
      // and every surface it changed must read it. Only navigation and state are skipped.
      await refresh(swapDecisionRefreshKeysOf(choice));

      if (!mounted.current) return;

      const kind = choice === SWAP_APPROVED ? SWAP_APPROVED_SAVED : SWAP_REJECTED_SAVED;

      await navigate({
        to: '/za-odluku',
        state: (entry) => withResolutionSaved(entry, { kind, proposerName, addresseeName, date: dateShown }),
      });

      // STILL HERE: the navigation was blocked or redirected, so the held view
      // gives way to the swap as it now stands.
      if (mounted.current) setLanded(null);
    } catch (cause) {
      console.error(SWAP_DECISION_FAILED, cause);
      // A LANDED DECISION never reads as failed: only its re-read or its navigation threw.
      if (landedWrite || !mounted.current) {
        if (mounted.current) setLanded(null);

        return;
      }
      setLanded(null);
      setFailure(SWAP_DECISION_FAILED);
    }
  }

  /** The check could not be derived: refused with the retry — unless the connection dropped, which the gate says. */
  function refuseUnchecked(): void {
    if (!writesOnline()) {
      focusLater([() => approveButton.current], () => heading.current);

      return;
    }
    setUnchecked(true);
    focusLater([() => retryButton.current], () => heading.current);
  }

  /** *Odbij*: the decision alone, no check — a rejection changes no roster, and sends no reason. */
  async function reject(): Promise<void> {
    if (deciding.current || screen.kind !== SWAP_SCREEN_WAITING) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    const view = screen;

    deciding.current = true;
    setPending(SWAP_REJECTED);
    setFailure(null);
    setUnchecked(false);

    try {
      await write(view, SWAP_REJECTED, null);
    } catch (cause) {
      console.error(SWAP_DECISION_FAILED, cause);
      if (mounted.current) setFailure(SWAP_DECISION_FAILED);
    } finally {
      deciding.current = false;
      if (mounted.current) setPending(null);
    }
  }

  /**
   * *Odobri*, and the unchecked refusal's retry: the erasure check over
   * fresh reads, then the write, under ONE latch. Stale refuses; none erased
   * writes at once; some open their confirmation; a check that cannot be
   * derived refuses with a retry. Nothing is written unchecked. Never on a
   * stale swap.
   */
  async function approve(reason: string): Promise<void> {
    if (deciding.current || screen.kind !== SWAP_SCREEN_WAITING || screen.stale || approvalRefused) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    const view = screen;

    deciding.current = true;
    setPending(SWAP_APPROVED);
    setFailure(null);
    setUnchecked(false);

    try {
      const check = await swapErasureCheckOf(readErasures.readAndShare, view.facts.swap, onlineManager.isOnline());

      if (!mounted.current) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        refuseUnchecked();

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await refuseStale();

        return;
      }

      if (check.rows.length > 0) {
        confirmation.show(check.rows, view.facts.swap);

        return;
      }

      await write(view, SWAP_APPROVED, reason);
    } catch (cause) {
      console.error(SWAP_DECISION_FAILED, cause);
      if (mounted.current) setFailure(SWAP_DECISION_FAILED);
    } finally {
      deciding.current = false;
      if (mounted.current) setPending(null);
    }
  }

  /**
   * The erasure confirmation's own save, once every row is confirmed, under
   * the same one latch: the check derived again from fresh reads. The same
   * conflicts, as shown: the dialog closes and the approval is written. A
   * changed list: shown again, undecided. Stale: the dialog closes and the
   * approval is refused. A check that cannot be derived closes the dialog and
   * refuses with the retry.
   */
  async function confirmErasures(shown: ShownErasures<OrganizationSwap>, reason: string): Promise<void> {
    if (deciding.current || !confirmation.confirmed) return;

    // NO LONGER WAITING while the dialog stood (a re-read closed it, or a
    // refusal withheld *Odobri*): the dialog closes visibly and says why — its
    // save never does nothing.
    if (screen.kind !== SWAP_SCREEN_WAITING || screen.stale || approvalRefused) {
      confirmation.drop();
      // An approval already refused keeps its own refusal standing.
      if (screen.kind !== SWAP_SCREEN_WAITING) setFailure(SWAP_DECISION_NOT_WAITING);
      else if (screen.stale) setFailure(SWAP_DECISION_STALE);
      focusLater([() => alertField.current], () => heading.current);

      return;
    }

    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    const view = screen;

    deciding.current = true;
    setPending(SWAP_APPROVED);
    setFailure(null);
    setUnchecked(false);

    try {
      const check = await swapErasureCheckOf(readErasures.readAndShare, shown.subject, onlineManager.isOnline());

      await confirmation.follow(shown, check, {
        // A screen left meanwhile says nothing, and nothing else runs.
        stopped: () => !mounted.current,
        unavailable: () => {
          // STORY 8.3a: offline, the confirmation stays open under the gate, focus on its save (story 8.3b).
          if (!writesOnline()) {
            focusLater([() => erasuresSaveButton.current], () => heading.current);

            return;
          }
          confirmation.drop();
          refuseUnchecked();
        },
        refused: async () => {
          confirmation.drop();
          await refuseStale();
        },
        write: async () => {
          confirmation.drop();
          await write(view, SWAP_APPROVED, reason);
        },
      });
    } catch (cause) {
      console.error(SWAP_DECISION_FAILED, cause);
      confirmation.drop();
      if (mounted.current) setFailure(SWAP_DECISION_FAILED);
    } finally {
      deciding.current = false;
      if (mounted.current) setPending(null);
    }
  }

  /** Read again every read the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of swapDecisionSurfaceKeysOf(waiting, decided)) {
      // A read already in flight is left to land: repeated presses never restart it.
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }

  return {
    screen,
    loading: screen.kind === SWAP_SCREEN_LOADING,
    // The as-of note's time and zone while the whole cached snapshot is drawn
    // offline; none above the unavailable state, nor over a landed decision's view.
    offline:
      landed === null
        ? offlineNoteOf(
            freshness,
            calendarState.snapshot === null ? null : calendarState.snapshot.timeZone,
            screen.kind === SWAP_SCREEN_UNAVAILABLE,
          )
        : null,
    // The decision in flight, or null.
    pending,
    failure,
    // *Odobri* is offered: a waiting swap, not stale, and no approval refused as it stands.
    canApprove,
    // The unchecked refusal and its retry, only while *Odobri* is offered: a
    // swap that turned stale draws no retry that would do nothing.
    unchecked: unchecked && canApprove,
    approve,
    reject,
    erasures: confirmation,
    confirmErasures,
    alertField,
    heading,
    approveButton,
    retryButton,
    erasuresSaveButton,
    // STORY 8.2e: "show the read retry now" — the screen is unavailable, and online.
    retryable: clock.online && screen.kind === SWAP_SCREEN_UNAVAILABLE,
    retry,
  };
}

export type SwapDecisionState = ReturnType<typeof useSwapDecision>;
