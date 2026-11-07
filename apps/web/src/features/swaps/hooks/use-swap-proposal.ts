import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { monthOf } from '@shift/domain';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { swapProposalMarkOf, type OpenSwapProposal } from '@/features/calendar/utils/day-detail';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  myConflictResolutionsQueryOptions,
  type MyConflictResolutionsRpc,
} from '@/features/conflicts/services/resolutions';
import { useMySwapRequestsRead } from '@/features/swaps/hooks/use-my-swaps';
import { MY_SWAP_REQUESTS_KEY, openSwapProposalsOf } from '@/features/swaps/services/my-swaps';
import {
  SWAP_COLLEAGUE_GONE,
  SWAP_FAILED,
  SWAP_NO_CHOICE,
  SWAP_NO_COLLEAGUE,
  SWAP_NO_RETURN,
  SWAP_REQUESTS_TABLE,
  SWAP_VIEW_ADMIN,
  SWAP_VIEW_MEMBER,
  SWAP_VIEW_UNAVAILABLE,
  ownSwapShiftOf,
  sendSwapProposal,
  swapDayOf,
  swapChoiceOf,
  swapChoiceOnColleague,
  swapColleaguesOf,
  swapLeaveKeysOf,
  swapPreviewOf,
  swapReturnOptionsOf,
  swapReturnValueOf,
  swapSendCheckOf,
  swapViewOf,
  withSwapProposed,
  type SwapChoiceValues,
  type SwapProposed,
  type SwapRequestInsertTable,
  type SwapSearch,
  type SwapSendFailure,
} from '@/features/swaps/services/swap-proposal';
import { NO_DEPENDENTS, SWAP_REQUEST_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { useOrganizationToday } from '@/hooks/organization-today';
import { FETCH_FETCHING, ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * The surface's snapshot: the calendar alone. The viewer's own resolutions,
 * which give their *Sati*'s leave keys, are read beside it and never gate it.
 */
const SWAP_SURFACE_KEYS = [CALENDAR_KEY] as const;

/**
 * Which body `/kalendar/zamjena` draws (story 12.2), from the calendar
 * snapshot's role — no `beforeLoad` read of its own. An ADMIN is sent to
 * `/kalendar`, replacing the entry: an admin changes a roster directly. Until
 * the role is known no other read is made. When the snapshot cannot name a
 * role the view is unavailable, and — online — its retry reads the calendar
 * snapshot again.
 */
export function useSwapProposalView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const calendarRead = useCalendarSnapshot();
  const { clock, answerFor } = useSnapshotFreshness([CALENDAR_KEY], [[CALENDAR_KEY, calendarRead]], ZONE_FROM_CALENDAR);
  const view = swapViewOf(calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead)));

  useEffect(() => {
    if (view === SWAP_VIEW_ADMIN) void navigate({ to: '/kalendar', replace: true });
  }, [view, navigate]);

  /** Read the calendar snapshot again, from the unavailable notice's retry. */
  function retry(): void {
    void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
  }

  return {
    view,
    member: view === SWAP_VIEW_MEMBER,
    retryable: clock.online && view === SWAP_VIEW_UNAVAILABLE,
    retry,
  };
}

/**
 * *Predloži zamjenu* (story 12.2): the given shift the URL names, the
 * colleague and the optional return shift chosen, the preview, and the one
 * send. Wiring only — every rule is
 * `@/features/swaps/services/swap-proposal`'s, which the node suite executes.
 *
 * ONE SNAPSHOT (story 8.2): the calendar snapshot, so offline the form is
 * drawn from the cached snapshot under the as-of note, and *Pošalji* is gated.
 * The viewer's own resolutions are read beside it for the leave keys their
 * *Sati* counts (`swapLeaveKeysOf`), and never gate the form: while they
 * cannot be read — paused offline with none cached, or failed — the preview
 * counts no leave and says so, and the retry reads them again too. SINCE
 * STORY 12.3 the viewer's own swaps are read beside it too, never gating it:
 * a shift they already proposed in an open swap shows a notice instead of
 * the form, and while that read is unknown the form is offered as before
 * (0049's 23505 stays the backstop).
 *
 * THE FIELDS ARE CONTROLLED, from the choice held here, so each shows what
 * would be sent, and a refusal keeps every chosen value. A choice the options
 * no longer hold is drawn as none, and *Pošalji* refuses it with its reason
 * rather than send something else. Choosing another colleague drops the
 * return shift (`swapChoiceOnColleague`). One send in flight (a ref, no
 * mutation, nothing optimistic), held until a landed send has navigated. The
 * FR-66 check (`swapSendCheckOf`) re-derives the choice over the snapshot as
 * it stands; the preview never gates. After any landed or refused insert the
 * calendar is read again (`refreshAfterWrite`, `SWAP_REQUEST_WRITE_DEPENDENTS`:
 * a proposal derives nothing); a landed send returns to `/kalendar` on the
 * given date's month with the status line in the entry's state.
 */
export function useSwapProposal(search: SwapSearch) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const calendarRead = useCalendarSnapshot();
  const resolutionsRead = useQuery(myConflictResolutionsQueryOptions(() => supabaseClient() as unknown as MyConflictResolutionsRpc));
  const swapsRead = useMySwapRequestsRead();
  const { freshness, clock, answerFor } = useSnapshotFreshness(
    SWAP_SURFACE_KEYS,
    [[CALENDAR_KEY, calendarRead]],
    ZONE_FROM_CALENDAR,
  );
  const calendar = calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead));
  const snapshot = calendar.snapshot;
  const resolutionRows = resolutionsRead.data;
  // Only a first read actually in flight is waited for: paused offline or failed, the figures go without it.
  const resolutionsWaiting =
    resolutionsRead.data === undefined && !resolutionsRead.isError && resolutionsRead.fetchStatus === FETCH_FETCHING;
  const { today } = useOrganizationToday(snapshot === null ? null : snapshot.timeZone);
  const loading = calendar.loading || (snapshot !== null && today === null) || resolutionsWaiting;
  const [choice, setChoice] = useState<SwapChoiceValues>(SWAP_NO_CHOICE);
  const [failure, setFailure] = useState<SwapSendFailure | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const colleagueField = useRef<HTMLSelectElement>(null);
  const alertField = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const leave = useMemo(
    () => (snapshot === null ? { keys: [], known: false } : swapLeaveKeysOf(snapshot, resolutionRows)),
    [snapshot, resolutionRows],
  );
  // UNKNOWN UNLESS ANSWERED: a failed read is no answer, even over cached rows
  // (the offer then stands, and 0049's 23505 is the backstop).
  const swapRows = swapsRead.isError ? undefined : swapsRead.data;
  const liveProposals = useMemo(
    () => (snapshot === null ? null : openSwapProposalsOf(swapRows, snapshot.viewer.memberId)),
    [snapshot, swapRows],
  );
  // HELD FROM A LANDED SEND TO THE NAVIGATION: the send's own re-read of the
  // swaps would otherwise find the new proposal and swap the form for the
  // notice (and drop focus) before the surface is left.
  const [held, setHeld] = useState<{ readonly proposals: readonly OpenSwapProposal[] | null } | null>(null);
  const proposals = held === null ? liveProposals : held.proposals;
  const given = useMemo(
    () => (snapshot === null ? null : ownSwapShiftOf(snapshot, search, today, proposals)),
    [snapshot, search, today, proposals],
  );
  // STORY 12.3: the shift the URL names, already proposed by the viewer in an open swap.
  const alreadyProposed = useMemo(() => {
    if (snapshot === null || search.dan === undefined || search.smjena === undefined) return null;

    return swapProposalMarkOf(snapshot, swapDayOf(snapshot, { teamId: search.smjena, date: search.dan }), today, proposals);
  }, [snapshot, search, today, proposals]);
  const colleagues = useMemo(
    () => (snapshot === null || given === null ? [] : swapColleaguesOf(snapshot, given)),
    [snapshot, given],
  );
  const returnOptions = useMemo(
    () =>
      snapshot === null || given === null || today === null || choice.colleagueId === SWAP_NO_COLLEAGUE
        ? []
        : swapReturnOptionsOf(snapshot, given, choice.colleagueId, today),
    [snapshot, given, choice.colleagueId, today],
  );
  const resolved = useMemo(() => swapChoiceOf(colleagues, returnOptions, choice), [colleagues, returnOptions, choice]);
  // WHAT THE FIELDS DRAW: the choice where the options still hold it, else none.
  const colleagueValue = colleagues.some((one) => one.id === choice.colleagueId) ? choice.colleagueId : SWAP_NO_COLLEAGUE;
  const returnValue = returnOptions.some((one) => swapReturnValueOf(one) === choice.returnValue)
    ? choice.returnValue
    : SWAP_NO_RETURN;
  const preview = useMemo(
    () =>
      snapshot === null || given === null || !resolved.ok
        ? null
        : swapPreviewOf(snapshot, given, resolved.colleague.id, resolved.returnShift, leave.keys),
    [snapshot, given, resolved, leave.keys],
  );

  /** A colleague chosen: the return shift was the last colleague's, so it goes; so does a standing refusal. */
  function chooseColleague(value: string): void {
    setFailure(null);
    setChoice((current) => swapChoiceOnColleague(current, value));
  }

  /** A return shift chosen, or none. */
  function chooseReturn(value: string): void {
    setFailure(null);
    setChoice((current) => ({ ...current, returnValue: value }));
  }

  /** *Pošalji*: the FR-66 check over the snapshot as it stands, then the one insert. */
  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (snapshot === null || given === null || sending.current) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    setFailure(null);

    const checked = swapSendCheckOf(snapshot, { teamId: given.teamId, date: given.isoDate }, choice, today);

    if (!checked.ok) {
      setFailure(checked.code);
      // A colleague no longer offered is let go, so the field and the choice agree again.
      if (checked.code === SWAP_COLLEAGUE_GONE) setChoice(SWAP_NO_CHOICE);
      focusLater([() => alertField.current], () => colleagueField.current);

      return;
    }

    const { colleague, returnShift } = checked;
    const back = returnShift === null ? null : returnOptions.find((one) => swapReturnValueOf(one) === choice.returnValue);
    const proposed: SwapProposed = {
      date: given.isoDate,
      teamName: given.teamName,
      colleagueName: colleague.name,
      returnShift: returnShift === null ? null : { date: returnShift.date, teamName: back?.teamName ?? returnShift.teamId },
    };

    sending.current = true;
    setPending(true);

    try {
      const outcome = await sendSwapProposal(
        // Structurally, as the leave request's insert is.
        supabaseClient().from(SWAP_REQUESTS_TABLE) as unknown as SwapRequestInsertTable,
        {
          organizationId: snapshot.organizationId,
          proposerId: snapshot.viewer.memberId,
          addresseeId: colleague.id,
          given: { teamId: given.teamId, date: given.isoDate },
          returnShift,
        },
      );

      // A REFUSAL KEEPS EVERY CHOSEN VALUE: nothing here resets the fields.
      if (!outcome.ok) setFailure(outcome.code);
      // A LANDED SEND holds the proposals as they stood until the navigation.
      else setHeld({ proposals: liveProposals });

      try {
        await refreshAfterWrite(queryClient, CALENDAR_KEY, outcome.ok ? SWAP_REQUEST_WRITE_DEPENDENTS : NO_DEPENDENTS);
      } catch (cause) {
        console.error(SWAP_FAILED, cause);
      }

      if (outcome.ok) {
        // HELD THROUGH THE NAVIGATION: the send stays in flight until the surface is left.
        if (mounted.current) {
          await navigate({
            to: '/kalendar',
            search: { mjesec: monthOf(proposed.date) },
            state: (entry) => withSwapProposed(entry, proposed),
          });
        }

        return;
      }
    } catch (cause) {
      console.error(SWAP_FAILED, cause);
      setFailure(SWAP_FAILED);
    } finally {
      sending.current = false;
      setPending(false);
    }

    focusLater([() => alertField.current], () => colleagueField.current);
  }

  /** Read again what the form stands on: the calendar snapshot, and the viewer's resolutions. */
  function retry(): void {
    void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    void queryClient.invalidateQueries({ queryKey: MY_CONFLICT_RESOLUTIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: MY_SWAP_REQUESTS_KEY });
  }

  return {
    snapshot,
    loading,
    today,
    given,
    alreadyProposed,
    colleagues,
    colleagueValue,
    returnOptions,
    returnValue,
    preview,
    // STORY 12.2 REVIEW: the figures count no leave while the resolutions cannot be read.
    leaveUnknown: !leave.known && !resolutionsWaiting,
    failure,
    pending,
    chooseColleague,
    chooseReturn,
    send,
    colleagueField,
    alertField,
    // STORY 8.2: the as-of note while the whole snapshot is drawn offline.
    offline: offlineNoteOf(freshness, snapshot === null ? null : snapshot.timeZone, calendar.refusal !== null),
    unavailable: calendar.refusal !== null,
    retryable: clock.online && calendar.refusal !== null,
    retry,
  };
}

export type SwapProposalForm = ReturnType<typeof useSwapProposal>;
