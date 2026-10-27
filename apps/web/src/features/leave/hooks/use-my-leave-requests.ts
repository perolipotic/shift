import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import {
  LEAVE_REQUESTS_TABLE,
  MY_LEAVE_REQUESTS_KEY,
  REQUEST_FAILED,
  REQUEST_NOT_PENDING,
  myLeaveRequestsQueryOptions,
  withdrawLeaveRequest,
  type LeaveRequestWithdrawFailure,
  type LeaveRequestsTable,
  type WithdrawLeaveRequestRpc,
} from '@/features/leave/services/leave-requests';
import {
  MY_LEAVE_LOADING,
  MY_REQUESTS_LOADING,
  MY_REQUESTS_UNAVAILABLE,
  leaveRequestSentOf,
  leaveRequestSentStepOf,
  myLeaveRequestsOf,
  myLeaveRequestsViewerOf,
  myLeaveRowsStateOf,
  withoutLeaveRequestSent,
  type LeaveRequestSent,
  type MyLeave,
  type MyLeaveRequestRow,
  type MyLeaveRequests,
} from '@/features/leave/services/my-leave';
import { GODISNJI_MEMBER_SURFACE_KEYS } from '@/features/leave/services/surface-keys';
import { LEAVE_REQUEST_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { ZONE_FROM_CALENDAR } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/** A withdrawal that did not land, and the request it was for, named by its range in the alert. */
export interface LeaveRequestWithdrawRefusal {
  readonly code: LeaveRequestWithdrawFailure;
  readonly requestId: string;
  /** `05.10.2026`, the request's first date as its row writes it. */
  readonly from: string;
  /** Its last. */
  readonly to: string;
}

/** A withdrawal that landed: the range it closed, which the status line names. */
export interface LeaveRequestWithdrawn {
  readonly from: string;
  readonly to: string;
}

/**
 * The viewer's own requests read (story 9.3), observed so the screen's one
 * snapshot has its fifth read: *Godišnji* lists them, and the request form
 * mounts the read so its freshness is decided over all five. Filtered to the
 * calendar snapshot's viewer, and made only once the snapshot names them.
 * Named structurally, as the leave records' read is.
 */
export function useMyLeaveRequestsRead() {
  const calendarRead = useCalendarSnapshot();
  const memberId = calendarRead.data === undefined ? null : calendarRead.data.viewer.memberId;

  return useQuery(
    myLeaveRequestsQueryOptions(
      () => supabaseClient().from(LEAVE_REQUESTS_TABLE) as unknown as LeaveRequestsTable,
      memberId,
    ),
  );
}

/**
 * The status line *Godišnji* shows after a landed send (story 9.3), naming
 * the range: the form hands it over in the history entry's state
 * (`withLeaveRequestSent`), and the location that brings it shows it and
 * clears it off the entry through the router, so a reload or Back finds none
 * — the *Za odluku* saved line's rule (`leaveRequestSentStepOf`). The line
 * takes focus once drawn, so it is announced; `dismiss` takes it down when
 * another outcome line replaces it.
 */
function useLeaveRequestSent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sent, setSent] = useState<LeaveRequestSent | null>(() => leaveRequestSentOf(location.state));
  /** Whether the next location is our own clearing replace. */
  const clearing = useRef(false);
  /** The location state already stepped over: an effect run twice steps once. */
  const stepped = useRef<unknown>(undefined);
  const sentField = useRef<HTMLParagraphElement>(null);
  const state = location.state;

  useEffect(() => {
    if (stepped.current === state) return;

    stepped.current = state;

    const step = leaveRequestSentStepOf(sent, state, clearing.current);

    clearing.current = step.clearing;
    setSent(step.shown);
    if (step.clear) {
      void navigate({ to: '/godisnji', replace: true, state: (entry) => withoutLeaveRequestSent(entry) });
    }
  }, [state, sent, navigate]);

  useEffect(() => {
    if (sent !== null) sentField.current?.focus();
  }, [sent]);

  return { sent, sentField, dismiss: () => setSent(null) };
}

/**
 * *Godišnji*'s list of the viewer's own leave requests, *Povuci zahtjev* and
 * the page's one polite outcome line (story 9.3). Wiring only — every
 * decision is `@/features/leave/services/my-leave`'s and `.../leave-requests`',
 * which the node suite executes.
 *
 * THE LIST STANDS ON THE REQUESTS READ ALONE, and the calendar snapshot for
 * whose they are: a member whose figures are unscheduled or unavailable still
 * sees and withdraws their requests, each row then without its cost. While the
 * figures are still loading the list waits with them, so no cost flickers in.
 *
 * ONE SNAPSHOT (story 8.2b): both reads are seen through the member's
 * *Godišnji* freshness (`GODISNJI_MEMBER_SURFACE_KEYS`), the figures' other
 * reads decided from the cache, so offline the list is drawn from the cached
 * snapshot under the screen's as-of note, or not at all.
 *
 * ONE OUTCOME LINE AT A TIME: the sent line a landed send returns with, or the
 * withdrawn line. A withdrawal takes the sent line down when it starts, and a
 * sent line that arrives replaces any withdrawn one.
 *
 * THE WITHDRAWAL calls `withdraw_leave_request` with no confirmation: a
 * withdrawn range can be sent again. One in flight at a time (a ref, no
 * mutation and nothing optimistic); offline nothing is sent. After any outcome
 * the requests are read again through `refreshAfterWrite` — a landed one or a
 * P0002 with `LEAVE_REQUEST_WRITE_DEPENDENTS`, any other refusal with none —
 * so a request no longer pending shows as it now stands. A refusal names the
 * request's range.
 */
export function useMyLeaveRequests(leave: MyLeave) {
  const queryClient = useQueryClient();
  const calendarRead = useCalendarSnapshot();
  const requestsRead = useMyLeaveRequestsRead();
  const { clock, answerFor } = useSnapshotFreshness(
    GODISNJI_MEMBER_SURFACE_KEYS,
    [
      [CALENDAR_KEY, calendarRead],
      [MY_LEAVE_REQUESTS_KEY, requestsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const snapshot = calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead)).snapshot;
  const requests = answerFor(MY_LEAVE_REQUESTS_KEY, requestsRead);
  const list: MyLeaveRequests | null =
    snapshot === null
      ? null
      : leave.kind === MY_LEAVE_LOADING
        ? { kind: MY_REQUESTS_LOADING }
        : myLeaveRequestsOf(myLeaveRequestsViewerOf(snapshot, leave), myLeaveRowsStateOf(requests));
  const { sent, sentField, dismiss } = useLeaveRequestSent();
  const withdrawing = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [withdrawPending, setWithdrawPending] = useState(false);
  const [refusal, setRefusal] = useState<LeaveRequestWithdrawRefusal | null>(null);
  const [withdrawn, setWithdrawn] = useState<LeaveRequestWithdrawn | null>(null);
  /** The withdrawal's outcome line — the refusal's alert or the status — which takes focus once drawn. */
  const outcomeField = useRef<HTMLParagraphElement>(null);
  /** The list's heading, where focus rests when no line is drawn. */
  const listHeading = useRef<HTMLHeadingElement>(null);

  // A sent line that arrives replaces any withdrawn one.
  useEffect(() => {
    if (sent !== null) setWithdrawn(null);
  }, [sent]);

  /** Withdraw `row`'s pending request: one at a time, online only, re-read after any outcome. */
  async function withdraw(row: MyLeaveRequestRow): Promise<void> {
    if (withdrawing.current || !row.withdrawable) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    withdrawing.current = true;
    dismiss();
    setRefusal(null);
    setWithdrawn(null);
    setPendingId(row.request.id);
    setWithdrawPending(true);

    const named = { requestId: row.request.id, from: row.from, to: row.to };

    try {
      const outcome = await withdrawLeaveRequest(supabaseClient() as unknown as WithdrawLeaveRequestRpc, row.request.id);

      if (outcome.ok) setWithdrawn({ from: row.from, to: row.to });
      else setRefusal({ code: outcome.code, ...named });

      try {
        // A P0002 is the list behind the database: the re-read shows the row as it stands.
        await refreshAfterWrite(
          queryClient,
          MY_LEAVE_REQUESTS_KEY,
          outcome.ok || outcome.code === REQUEST_NOT_PENDING ? LEAVE_REQUEST_WRITE_DEPENDENTS : NO_DEPENDENTS,
        );
      } catch (cause) {
        console.error(REQUEST_FAILED, cause);
      }
    } catch (cause) {
      console.error(REQUEST_FAILED, cause);
      setRefusal({ code: REQUEST_FAILED, ...named });
    } finally {
      withdrawing.current = false;
      setWithdrawPending(false);
    }

    // The row's button is gone after a landed withdrawal: focus goes to the line that says so.
    focusLater([() => outcomeField.current], () => listHeading.current);
  }

  /** Read the requests again, from the list's unavailable line's retry. */
  function retry(): void {
    void queryClient.invalidateQueries({ queryKey: MY_LEAVE_REQUESTS_KEY });
  }

  return {
    list,
    // STORY 8.2e: "show the read retry now" — the list is unavailable, and online.
    retryable: clock.online && list !== null && list.kind === MY_REQUESTS_UNAVAILABLE,
    pendingId: withdrawPending ? pendingId : null,
    refusal,
    withdrawn,
    sent,
    sentField,
    withdraw,
    retry,
    outcomeField,
    listHeading,
  };
}
