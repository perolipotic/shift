import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import {
  RESOLUTION_LOADING,
  RESOLUTION_READY,
  refetchingAfterFailure,
  resolutionOptionOf,
  resolutionScreenOf,
  withResolutionSaved,
  type ResolutionLink,
  type ResolutionOption,
  type ResolutionParams,
  type ResolutionScreen,
  type ResolutionView,
} from '@/features/conflicts/services/resolution-screen';
import {
  RESOLUTION_FAILED,
  RESOLUTION_GONE,
  RESOLUTION_WRITE_TABLE,
  acceptUncovered,
  type ResolutionInsertTable,
  type ResolutionWriteFailure,
} from '@/features/conflicts/services/resolution-write';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_TABLE,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersQueryOptions,
  membersSurfaceStateOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import {
  CONFLICT_RESOLUTION_GONE_DEPENDENTS,
  CONFLICT_RESOLUTION_WRITE_DEPENDENTS,
  NO_DEPENDENTS,
  refreshAfterWrite,
} from '@/features/teams/services/dependents';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * One conflict's resolution screen (story 5.4b): its five reads, the choice
 * and the one write. Wiring only — every decision is
 * `@/features/conflicts/services/resolution-screen`'s or
 * `@/features/conflicts/services/resolution-write`'s, which the node suite
 * executes.
 *
 * THE READS, each under its own key and shared with the screens that own it
 * (AD-13): the queue's three — the calendar snapshot, the organization's live
 * leave and its live resolutions — and the member card's two for the
 * balance, the member list (the allowance) and the organization snapshot
 * (the leave year).
 *
 * THE CHOICE starts empty — nothing is preselected — and Spremi does nothing
 * until one is made. The page keys this hook by the conflict, so ‹ › to
 * another one starts clean.
 *
 * THE WRITE has its own in-flight ref and pending flag, and nothing is
 * optimistic. While it is pending, ‹ ›, Odustani and the way back are
 * disabled. Once it lands the screen HOLDS the view it saved — never the
 * "no longer open" line its own re-read would otherwise flash — while both
 * resolution reads are re-read (`CONFLICT_RESOLUTION_WRITE_DEPENDENTS`), and
 * then returns to the queue with what was saved in ROUTER STATE only, never
 * the URL and never storage, for its status line; a screen left meanwhile is
 * never navigated away from. A refusal re-reads the resolutions, and for one
 * no longer open the organization's leave too, so a P0002 takes the conflict
 * away. Spremi pressed with nothing chosen moves focus to the choice.
 */
export function useConflictResolution(params: ResolutionParams) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const saving = useRef(false);
  const [choice, setChoice] = useState<ResolutionOption | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ResolutionWriteFailure | null>(null);
  /** The view a landed save holds while its re-read and its navigation land. */
  const [landed, setLanded] = useState<ResolutionView | null>(null);
  /** The first option, where Spremi pressed with no choice sends focus. */
  const firstOption = useRef<HTMLButtonElement>(null);
  /** Whether this screen is still the one shown: a late save never moves another. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const records = useQuery(
    // Named structurally, as the queue's read is.
    organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
  );
  const resolutions = useQuery(
    organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
  );
  const members = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const organization = useQuery(organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)));

  const derived = resolutionScreenOf(
    {
      calendar: calendarSurfaceStateOf(calendar),
      records,
      resolutions,
      members: membersSurfaceStateOf(members),
      organization,
      refetching: refetchingAfterFailure([calendar, records, resolutions, members, organization]),
    },
    params,
    new Date(),
  );
  const screen: ResolutionScreen = landed === null ? derived : { kind: RESOLUTION_READY, view: landed };

  /** The radio group's change: an option, never anything else. */
  function choose(value: string): void {
    setChoice(resolutionOptionOf(value));
    setFailure(null);
  }

  /** Read again every read the screen stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
    ]) {
      // A read already in flight is left to land: repeated presses never restart it.
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }

  /** ‹ or ›: the adjacent conflict, nothing saved. */
  function go(link: ResolutionLink | null): void {
    if (link === null || saving.current) return;

    void navigate({
      to: '/raspored/$memberId/$date/$teamId',
      params: { memberId: link.memberId, date: link.date, teamId: link.teamId },
    });
  }

  /** Re-read after a write, never turning its outcome into a refusal. */
  async function refresh(dependents: Parameters<typeof refreshAfterWrite>[2]): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, dependents);
    } catch (cause) {
      console.error(RESOLUTION_FAILED, cause);
    }
  }

  /** Spremi odluku: focus to the choice until a card is chosen, once at a time, never optimistic. */
  async function save(): Promise<void> {
    if (choice === null) {
      firstOption.current?.focus();

      return;
    }

    if (screen.kind !== RESOLUTION_READY || saving.current || failure === RESOLUTION_GONE) return;

    const view = screen.view;

    saving.current = true;
    setPending(true);
    setFailure(null);

    try {
      const outcome = await acceptUncovered(
        // Structurally, for the reason the reads are.
        supabaseClient().from(RESOLUTION_WRITE_TABLE) as unknown as ResolutionInsertTable,
        { organizationId: view.organizationId, memberId: params.memberId, date: params.date, teamId: params.teamId },
      );

      if (!outcome.ok) {
        // Said at once, before the re-read can change what the screen is.
        setFailure(outcome.code);
        await refresh(outcome.code === RESOLUTION_GONE ? CONFLICT_RESOLUTION_GONE_DEPENDENTS : NO_DEPENDENTS);

        return;
      }

      // HELD while the re-read lands, so the queue opens on fresh rows and
      // this screen never says its own conflict is no longer open.
      setLanded(view);
      await refresh(CONFLICT_RESOLUTION_WRITE_DEPENDENTS);

      if (!mounted.current) return;

      await navigate({ to: '/raspored', state: (entry) => withResolutionSaved(entry, view.saved) });
    } catch (cause) {
      console.error(RESOLUTION_FAILED, cause);
      setLanded(null);
      setFailure(RESOLUTION_FAILED);
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return {
    screen,
    loading: screen.kind === RESOLUTION_LOADING,
    firstOption,
    choice,
    choose,
    pending,
    failure,
    save,
    go,
    retry,
  };
}

export type ConflictResolutionState = ReturnType<typeof useConflictResolution>;
