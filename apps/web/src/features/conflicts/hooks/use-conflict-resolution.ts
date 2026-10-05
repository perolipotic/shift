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
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import {
  OPTION_AMEND_LEAVE,
  OPTION_REPLACE_MEMBER,
  RESOLUTION_LOADING,
  RESOLUTION_READY,
  SAVE_FOCUS_CANDIDATES,
  SAVE_FOCUS_CHOICE,
  amendHandoffOf,
  candidateIdOf,
  hasCandidates,
  saveFocusOf,
  refetchingAfterFailure,
  replacedSavedOf,
  replacementOf,
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
  RESOLUTION_HELD,
  RESOLUTION_TAKEN,
  RESOLUTION_WRITE_TABLE,
  acceptUncovered,
  replaceMember,
  type ResolutionInsertTable,
  type ResolutionReplaceRpc,
  type ResolutionWriteFailure,
  type ResolutionWriteOutcome,
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
import { withLeaveHandoff } from '@/features/leave/services/leave-section';
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
  CONFLICT_REPLACE_TAKEN_DEPENDENTS,
  CONFLICT_REPLACE_WRITE_DEPENDENTS,
  CONFLICT_RESOLUTION_GONE_DEPENDENTS,
  CONFLICT_RESOLUTION_HELD_DEPENDENTS,
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
 *
 * REPLACING (story 5.4c): the second card adds a pick — nobody at first — and
 * Spremi waits for it too, sending focus to the first candidate. A pick the
 * re-read took away counts as nobody. The write is 0032's function, with the
 * reason the screen generated through `t()`; once it lands it re-reads the
 * calendar snapshot beside both resolution reads
 * (`CONFLICT_REPLACE_WRITE_DEPENDENTS`), and the queue's status line names the
 * replacement. Refused as TAKEN — the replacement is already on the shift —
 * the snapshot is re-read so the candidates drop them, the pick is cleared,
 * and the line names who was taken.
 *
 * A KEY STILL HELD (story 5.5d): when a replacement that no longer applies
 * holds the key, a refusal on it is HELD — the screen's own line, "remove it
 * in the calendar, then decide" — and the snapshot is re-read beside the
 * resolutions.
 *
 * AMENDING (story 5.4d): the third card writes nothing. Its Spremi goes to the
 * member page with the record and the range that would clear the conflict, or
 * its removal, in router state (`amendHandoffOf`) — no pending, no write and
 * nothing held. The member page's own amend or removal does the write, and
 * the conflict clears by derivation once it lands.
 */
export function useConflictResolution(params: ResolutionParams) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const saving = useRef(false);
  const [choice, setChoice] = useState<ResolutionOption | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ResolutionWriteFailure | null>(null);
  /** The candidate picked on the second card (story 5.4c), by id; `null` for nobody. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Who a TAKEN refusal named, for its line. */
  const [taken, setTaken] = useState<string | null>(null);
  /** The first candidate, where Spremi pressed with nobody picked sends focus. */
  const firstCandidate = useRef<HTMLButtonElement>(null);
  /** The second card, where Spremi pressed with nobody to pick sends focus. */
  const replaceOption = useRef<HTMLButtonElement>(null);
  /** Set once a TAKEN refusal's re-read has landed: focus moves to the candidates, or the card when none are left. */
  const [refocus, setRefocus] = useState(false);
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

  // STORY 5.5d: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(calendarSurfaceStateOf(calendar).snapshot, resolutions.data);

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
  // A pick the re-read took away is nobody.
  const replacement = screen.kind === RESOLUTION_READY ? replacementOf(screen.view, picked) : null;
  const candidatesExist = screen.kind === RESOLUTION_READY && hasCandidates(screen.view);

  // After a TAKEN refusal, the next step is another pick: focus goes there once the list is re-read.
  useEffect(() => {
    if (!refocus) return;

    setRefocus(false);
    (firstCandidate.current ?? replaceOption.current)?.focus();
  }, [refocus]);

  /** The radio group's change: an option, never anything else. */
  function choose(value: string): void {
    const next = resolutionOptionOf(value);

    // Away from the second card, its pick goes: coming back starts with nobody.
    if (next !== OPTION_REPLACE_MEMBER) setPicked(null);
    setChoice(next);
    setFailure(null);
    setTaken(null);
  }

  /** The candidate picker's change (story 5.4c). */
  function pick(value: string): void {
    setPicked(candidateIdOf(value));
    setFailure(null);
    setTaken(null);
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

  /**
   * Spremi odluku: focus to the choice until a card is chosen — and to the
   * candidates until one is picked on the second, or back to that card when
   * there is nobody to pick — once at a time, never optimistic.
   * `replacementReasonOf` words the override's reason for the absent member;
   * it is called on a replacement alone.
   */
  async function save(replacementReasonOf: (memberName: string) => string): Promise<void> {
    // HELD (story 5.5d): the key is a replacement's until it is removed in the calendar; saving would fail.
    if (screen.kind === RESOLUTION_READY && screen.view.held) return;

    const focus = saveFocusOf(choice, replacement?.id ?? null, candidatesExist);

    if (focus !== null) {
      const target = focus === SAVE_FOCUS_CHOICE ? firstOption : focus === SAVE_FOCUS_CANDIDATES ? firstCandidate : replaceOption;

      target.current?.focus();

      return;
    }

    if (screen.kind !== RESOLUTION_READY || saving.current || failure === RESOLUTION_GONE) return;

    const view = screen.view;

    // NO RESOLUTION ROW (human, 2026-10-02): the leave amend is the write, on the member page.
    // A double press or a repeated Enter pushes one entry: the in-flight ref, as a write's.
    if (choice === OPTION_AMEND_LEAVE) {
      const handoff = amendHandoffOf(view, params);

      saving.current = true;

      try {
        await navigate({
          to: '/ljudi/$id',
          params: { id: params.memberId },
          state: (entry) => withLeaveHandoff(entry, handoff),
        });
      } finally {
        saving.current = false;
      }

      return;
    }

    const target = { organizationId: view.organizationId, memberId: params.memberId, date: params.date, teamId: params.teamId };
    const replacing = choice === OPTION_REPLACE_MEMBER && replacement !== null ? replacement : null;

    saving.current = true;
    setPending(true);
    setFailure(null);
    setTaken(null);

    try {
      // Structurally, for the reason the reads are.
      // `view.held` (story 5.5d): a refusal on the key says to remove the replacement first.
      const outcome: ResolutionWriteOutcome =
        replacing === null
          ? await acceptUncovered(
              supabaseClient().from(RESOLUTION_WRITE_TABLE) as unknown as ResolutionInsertTable,
              target,
              view.held,
            )
          : await replaceMember(
              supabaseClient() as unknown as ResolutionReplaceRpc,
              {
                ...target,
                replacementId: replacing.id,
                reason: replacementReasonOf(view.memberName),
              },
              view.held,
            );

      // A screen left meanwhile is not written to.
      if (!mounted.current) return;

      if (!outcome.ok) {
        // Said at once, before the re-read can change what the screen is.
        setFailure(outcome.code);

        if (outcome.code === RESOLUTION_TAKEN) {
          setTaken(replacing?.name ?? null);
          setPicked(null);
        }

        await refresh(
          outcome.code === RESOLUTION_GONE
            ? CONFLICT_RESOLUTION_GONE_DEPENDENTS
            : outcome.code === RESOLUTION_TAKEN
              ? CONFLICT_REPLACE_TAKEN_DEPENDENTS
              : outcome.code === RESOLUTION_HELD
                ? CONFLICT_RESOLUTION_HELD_DEPENDENTS
                : NO_DEPENDENTS,
        );

        if (mounted.current && outcome.code === RESOLUTION_TAKEN) setRefocus(true);

        return;
      }

      // HELD while the re-read lands, so the queue opens on fresh rows and
      // this screen never says its own conflict is no longer open.
      setLanded(view);
      await refresh(replacing === null ? CONFLICT_RESOLUTION_WRITE_DEPENDENTS : CONFLICT_REPLACE_WRITE_DEPENDENTS);

      if (!mounted.current) return;

      const saved = replacing === null ? view.saved : replacedSavedOf(view.saved, replacing.name);

      await navigate({ to: '/raspored', state: (entry) => withResolutionSaved(entry, saved) });
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
    firstCandidate,
    replaceOption,
    candidatesExist,
    choice,
    choose,
    replacement,
    pick,
    taken,
    pending,
    failure,
    save,
    go,
    retry,
  };
}

export type ConflictResolutionState = ReturnType<typeof useConflictResolution>;
