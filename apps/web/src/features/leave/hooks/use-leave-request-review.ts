import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import {
  LEAVE_REQUEST_APPROVED_SAVED,
  LEAVE_REQUEST_REJECTED_SAVED,
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
  LEAVE_RECORDS_KEY,
  LEAVE_RECORDS_TABLE,
  leaveRecordsQueryOptions,
  leaveRecordsStateOf,
  type LeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import {
  REVIEW_LOADING,
  REVIEW_NO_MEMBER,
  REVIEW_PENDING,
  REVIEW_UNAVAILABLE,
  decisionRefreshKeysOf,
  leaveRequestReviewOf,
  reviewNeedsActors,
  reviewNeedsPreview,
  type LeaveRequestReview,
} from '@/features/leave/services/leave-request-review';
import {
  LEAVE_REQUESTS_TABLE,
  LEAVE_REQUEST_KEY,
  REQUEST_APPROVED,
  leaveRequestFoundOf,
  leaveRequestQueryOptions,
  type LeaveRequestsTable,
} from '@/features/leave/services/leave-request-list';
import {
  REQUEST_FAILED,
  decideLeaveRequest,
  type DecideLeaveRequestRpc,
  type LeaveRequestDecideFailure,
  type LeaveRequestOutcome,
} from '@/features/leave/services/leave-request-write';
import { leaveRequestReviewSurfaceKeysOf } from '@/features/leave/services/surface-keys';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersQueryOptions,
  membersSurfaceStateOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  organizationTable,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { refreshAfterWrite } from '@/features/teams/services/dependents';
import { ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * One leave request's decision screen (story 9.4): its reads, *Odobri* and
 * *Odbij*. Wiring only — every decision is
 * `@/features/leave/services/leave-request-review`'s, `.../leave-request-list`'s
 * and `.../leave-request-write`'s, which the node suite executes.
 *
 * THE READS, each under its own key and shared with the screens that own it
 * (AD-13): the request by its id, the calendar snapshot and the member list
 * for every request; for a pending one the admin leave dialog's own reads for
 * the preview — the organization snapshot, the member's live records and the
 * organization's live resolutions; for a decided one the acting admins' names,
 * as *Odlučeno* reads them. Which of them the screen stands on follows the
 * request as read (`leaveRequestReviewSurfaceKeysOf`).
 *
 * ONE SNAPSHOT, ONLINE OR NOT (story 8.2): the reads are seen through the
 * page's freshness, so offline the whole cached snapshot is drawn under the
 * as-of note, or the unavailable state is; both decisions are gated then.
 *
 * THE DECISION calls `decide_leave_request` with no confirmation — the screen
 * is the review. One in flight at a time (a ref; no mutation and nothing
 * optimistic); offline nothing is sent. A landed decision HOLDS the view it
 * decided while its re-read lands — an approval the request keys, everything a
 * leave write makes stale and the member's records; a rejection the request
 * keys alone — then returns to *Za odluku* with its status line in router
 * state (`withResolutionSaved`), the queue's one slot. A refusal says so in an
 * alert that takes focus: P0002 re-reads what an approval makes stale — another
 * admin may have approved it — and the request then reads as it now stands; 23P01 re-reads it and the member's records, and it stays
 * pending, to be rejected; anything else re-reads the request alone. A screen
 * left meanwhile is never navigated away from.
 */
export function useLeaveRequestReview(requestId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const deciding = useRef(false);
  /** A decision is in flight: both buttons wait. */
  const [pending, setPending] = useState(false);
  /** Which decision was last sent, so its button says it is busy while it is in flight. */
  const [chosen, setChosen] = useState<LeaveRequestOutcome | null>(null);
  const [failure, setFailure] = useState<LeaveRequestDecideFailure | null>(null);
  /** The view a landed decision holds while its re-read and its navigation land. */
  const [landed, setLanded] = useState<LeaveRequestReview | null>(null);
  /** The refusal's alert, which takes focus once drawn. */
  const alertField = useRef<HTMLParagraphElement>(null);
  /** The heading, where focus rests when no alert is drawn. */
  const heading = useRef<HTMLHeadingElement>(null);
  /** Whether this screen is still the one shown: a late decision never moves another. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const requestRead = useQuery(
    // Named structurally, as the member's own requests read is.
    leaveRequestQueryOptions(() => supabaseClient().from(LEAVE_REQUESTS_TABLE) as unknown as LeaveRequestsTable, requestId),
  );
  // WHAT THE SCREEN STANDS ON follows the request as the cache holds it: its
  // member's records and the preview's reads while pending, the names once decided.
  const known = requestRead.data === undefined ? null : (leaveRequestFoundOf(requestRead.data, requestId)?.request ?? null);
  const memberId = known === null ? null : known.memberId;
  const previewMemberId = reviewNeedsPreview(known) ? memberId : null;
  const actorsNeeded = reviewNeedsActors(known);
  const recordsKey: QueryKey = LEAVE_RECORDS_KEY(memberId ?? REVIEW_NO_MEMBER);

  const calendarRead = useCalendarSnapshot();
  const membersRead = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  // THE PREVIEW'S READS wait for a pending request to name its member.
  const organizationRead = useQuery({
    ...organizationSnapshotQueryOptions(organizationTable),
    enabled: previewMemberId !== null,
  });
  const recordsRead = useQuery({
    ...leaveRecordsQueryOptions(
      // Named structurally, as the member card's read is.
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as LeaveRecordsTable,
      memberId ?? REVIEW_NO_MEMBER,
    ),
    enabled: previewMemberId !== null,
  });
  const resolutionsRead = useQuery({
    ...organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
    enabled: previewMemberId !== null,
  });
  const actorsRead = useQuery(
    actingAdminsQueryOptions(() => supabaseClient().from(ACTING_ADMINS_TABLE) as unknown as ActingAdminsTable, actorsNeeded),
  );
  const { freshness, clock, answerFor } = useSnapshotFreshness(
    leaveRequestReviewSurfaceKeysOf(requestId, previewMemberId, actorsNeeded),
    [
      [LEAVE_REQUEST_KEY(requestId), requestRead],
      [CALENDAR_KEY, calendarRead],
      [MEMBERS_LIST_KEY, membersRead],
      [ORGANIZATION_SNAPSHOT_KEY, organizationRead],
      [ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead],
      [recordsKey, recordsRead],
      [ACTING_ADMINS_KEY, actorsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const calendarState = calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead));
  const derived = leaveRequestReviewOf(
    {
      request: answerFor(LEAVE_REQUEST_KEY(requestId), requestRead),
      members: membersSurfaceStateOf(answerFor(MEMBERS_LIST_KEY, membersRead)),
      calendar: calendarState,
      organization: answerFor(ORGANIZATION_SNAPSHOT_KEY, organizationRead),
      records: leaveRecordsStateOf(answerFor(recordsKey, recordsRead)),
      resolutions: answerFor(ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead),
      actors: answerFor(ACTING_ADMINS_KEY, actorsRead),
      // THE RAW OBSERVER'S fetch flag (the fetch-flag rule, `use-snapshot-freshness`).
      calendarRefreshing: calendarRead.isFetching,
    },
    requestId,
    new Date(),
  );
  const screen = landed ?? derived;

  /** Re-read after a decision, never turning its outcome into a refusal. */
  async function refresh(dependents: readonly QueryKey[]): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, LEAVE_REQUEST_KEY(requestId), dependents);
    } catch (cause) {
      console.error(REQUEST_FAILED, cause);
    }
  }

  /**
   * *Odobri* or *Odbij*: the pending request decided, once at a time, online
   * only, never optimistic. The database decides overlap: nothing here refuses
   * an approval first.
   */
  async function decide(choice: LeaveRequestOutcome, memberGone: string): Promise<void> {
    if (deciding.current || screen.kind !== REVIEW_PENDING) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    const view = screen;
    const { request, from, to } = view.facts;
    // A member gone from both lists is named on the queue's line as the screen names them.
    const memberName = view.facts.memberName ?? memberGone;
    /** Set once the database has decided: nothing after it may say the decision failed. */
    let landedWrite = false;

    deciding.current = true;
    setChosen(choice);
    setPending(true);
    setFailure(null);

    try {
      const outcome = await decideLeaveRequest(supabaseClient() as unknown as DecideLeaveRequestRpc, request.id, choice);

      // A screen left meanwhile is not written to.
      if (!mounted.current) return;

      if (!outcome.ok) {
        // Said at once, before the re-read can change what the screen is.
        setFailure(outcome.code);
        await refresh(decisionRefreshKeysOf(outcome.code, request.memberId));
        focusLater([() => alertField.current], () => heading.current);

        return;
      }

      landedWrite = true;
      // HELD while the re-read lands, so the queue opens on fresh rows and
      // this screen never flashes the request as already decided.
      setLanded(view);
      await refresh(decisionRefreshKeysOf(choice, request.memberId));

      if (!mounted.current) return;

      const kind = choice === REQUEST_APPROVED ? LEAVE_REQUEST_APPROVED_SAVED : LEAVE_REQUEST_REJECTED_SAVED;

      await navigate({ to: '/za-odluku', state: (entry) => withResolutionSaved(entry, { kind, memberName, from, to }) });

      // STILL HERE: the navigation was blocked or redirected, so the held view
      // gives way to the request as it now stands.
      if (mounted.current) setLanded(null);
    } catch (cause) {
      console.error(REQUEST_FAILED, cause);
      // A LANDED DECISION never reads as failed: only its re-read or its navigation threw.
      if (landedWrite || !mounted.current) {
        if (mounted.current) setLanded(null);

        return;
      }
      setLanded(null);
      setFailure(REQUEST_FAILED);
    } finally {
      deciding.current = false;
      if (mounted.current) setPending(false);
    }
  }

  /** Read again every read the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of leaveRequestReviewSurfaceKeysOf(requestId, previewMemberId, actorsNeeded)) {
      // A read already in flight is left to land: repeated presses never restart it.
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }

  return {
    screen,
    loading: screen.kind === REVIEW_LOADING,
    // The as-of note's time and zone while the whole cached snapshot is drawn
    // offline; none above the unavailable state, nor over a landed decision's view.
    offline:
      landed === null
        ? offlineNoteOf(
            freshness,
            calendarState.snapshot === null ? null : calendarState.snapshot.timeZone,
            screen.kind === REVIEW_UNAVAILABLE,
          )
        : null,
    // The decision in flight, or null.
    pending: pending ? chosen : null,
    failure,
    decide,
    alertField,
    heading,
    // STORY 8.2e: "show the read retry now" — the screen is unavailable, and online.
    retryable: clock.online && screen.kind === REVIEW_UNAVAILABLE,
    retry,
  };
}

export type LeaveRequestReviewState = ReturnType<typeof useLeaveRequestReview>;
