import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import type { MemberScreen } from '@/features/members/hooks/member-edit-context';
import { useMemberBasics } from '@/features/members/hooks/use-member-basics';
import { useMemberReset } from '@/features/members/hooks/use-member-reset';
import { useMemberStatus } from '@/features/members/hooks/use-member-status';
import { useMemberTeam } from '@/features/members/hooks/use-member-team';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersSurfaceStateOf,
  membersTodayOf,
  membersQueryOptions,
} from '@/features/members/services/list';
import {
  SESSION_SUBJECT_KEY,
  memberFormRefusalOf,
  memberReadRetryable,
  teamPositionsOn,
  teamPositionsRefusalOf,
  teamPositionsSettingOf,
  readSessionSubject,
} from '@/features/members/services/write';
import { memberPageSurfaceKeysOf } from '@/features/members/services/surface-keys';
import { ranksShownIn } from '@/features/members/utils/rank';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  organizationTable,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { retryRead } from '@/features/teams/services/dependents';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  splitTeams,
  teamsSurfaceStateOf,
  writableTeamsOf,
} from '@/features/teams/services/list';
import { ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { currentSession, supabaseClient } from '@/lib/supabase/client';

/**
 * `/ljudi/$id`'s state, its four reads and its handlers (story 1.5b; facts
 * and dialogs since story 7.11). The page composes the header and the cards —
 * basics, team, leave (with the allowance's slot), status and sign-in — and
 * each card is a component in `@/features/members/components` that reads this
 * hook's result.
 *
 * ONE HOOK PER CARD (epics 5–7 retro A16, A21). This hook reads; each card's
 * state and handlers are its own hook — `useMemberBasics` (the basics and
 * the allowance's dialogs), `useMemberTeam`, `useMemberStatus` and
 * `useMemberReset` — handed the one screen read here (`MemberScreen`), and
 * the page reads their results as one.
 *
 * THE READS. The member comes out of `MEMBERS_LIST_KEY` (AD-13) rather than a
 * second read of one row, and `memberFormRefusalOf` turns that one answer into
 * "this member", "still loading" or "nothing here". The organization is read
 * under the chrome's own key and cache policy, for the rank and position
 * settings; the session subject, so the status block is never offered on the
 * caller's own row; and the teams under `TEAMS_LIST_KEY`, for the picker.
 *
 * THE STATE. Every piece that is raised about a member — a refusal, an open
 * dialog, a confirmation, an issued credential — is scoped through
 * `raisedForMember`, because one component instance serves every row and
 * navigating between two members changes a route param, not the component.
 *
 * THE DIALOGS (story 7.11, the day detail's pattern from 7.9). Each card's
 * header button opens its own small dialog with one final button. The hook
 * owns whether it is open and the button that opened it (`basicsDialog`,
 * `allowanceDialog`, `teamDialog`, `statusDialog`); each opening renders a
 * fresh keyed body; while its write is pending it cannot be dismissed; a
 * refusal keeps it open with its alert above the buttons; a landed save
 * closes it, says so on the card and returns focus to the opener. A dialog
 * whose offer disappears on a re-read closes by itself, and the card says why.
 *
 * THE HANDLERS. Each write has its own in-flight ref, pending flag and
 * refusal, so no block's request disables another's controls: `submit` (the
 * basics and the allowance dialogs' one member write, `saveMember`), `issue`
 * (the password reset), `changeStatus` and `changeTeam`. The team and status
 * dialogs' Save is the old arm-then-confirm folded into one press — `armTeam`
 * / `armStatus` run the preflight, then `changeTeam` / `changeStatus` run the
 * erasure check and the write. Withdrawing a scheduled change keeps its card
 * button and its confirmation. Every rule any of them applies is a pure
 * function in `@/features/members/services/write`, where a test runs it.
 *
 * ONE SNAPSHOT WITH THE LEAVE CARD (story 8.2c): every read is seen through
 * the page's freshness over `memberPageSurfaceKeysOf`, the same set
 * `useMemberLeave` decides over, as *Danas*'s body and header decide as one.
 * The erasure guard's fresh reads stay outside it: they decide a write only.
 */
export function useMemberEdit(id: string) {
  const queryClient = useQueryClient();
  /** Counts openings, so every opening of any dialog gets a key of its own. */
  const openings = useRef(0);
  // THE ERASURE GUARD'S THREE FRESH READS (story 5.5e), shared by the team
  // and status cards.
  const readErasures = useErasureReads();

  const membersRead = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  // THE CALENDAR SNAPSHOT, observed through its one binding — the leave
  // card's own (`@/features/leave/hooks/use-member-leave`) — for the
  // deactivation's consequence.
  const calendarRead = useCalendarSnapshot();

  // MEMBER RANK. Whether the rank control is offered, read from the one
  // organization snapshot under its shared key (AD-13), through the chrome's
  // own factory and cache policy. Until it arrives the control is absent and
  // the save leaves the stored rank alone.
  const organizationRead = useQuery(
    organizationSnapshotQueryOptions(organizationTable),
  );

  // THE CALLER'S OWN ACCOUNT, so the status block is never offered on it.
  const subjectRead = useQuery({
    queryKey: SESSION_SUBJECT_KEY,
    queryFn: () => readSessionSubject(currentSession),
    refetchOnWindowFocus: false,
  });

  // THE TEAMS THE PICKER OFFERS, under the team screens' own key (AD-13).
  const teamsRead = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));

  // STORY 8.2c: the page is ONE snapshot over the union of this hook's reads
  // and the leave card's (`memberPageSurfaceKeysOf`), decided here from these
  // very observer results and, for the leave card's own two, from the cache —
  // the card decides over the same set, so the page is drawn whole or is
  // unavailable as one. Online, a read older than this session's network is
  // never drawn as fresh; offline, the whole cached snapshot is drawn under
  // the as-of note (`offline`, the page's one), or the unavailable state is.
  const { freshness, clock, answerOf } = useSnapshotFreshness(
    memberPageSurfaceKeysOf(id),
    [
      [MEMBERS_LIST_KEY, membersRead],
      [CALENDAR_KEY, calendarRead],
      [ORGANIZATION_SNAPSHOT_KEY, organizationRead],
      [SESSION_SUBJECT_KEY, subjectRead],
      [TEAMS_LIST_KEY, teamsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const answer = answerOf(membersRead);
  const calendar = answerOf(calendarRead);
  const organization = answerOf(organizationRead);
  const offersRank = ranksShownIn(organization.data);
  // TEAM POSITION: the same setting — on, off, pending or failed. Until it is
  // KNOWN no move is offered, so no position is ever sent on a guess.
  const positionsSetting = teamPositionsSettingOf(organization);
  const offersPosition = teamPositionsOn(positionsSetting);
  const positionsRefusal = teamPositionsRefusalOf(positionsSetting);
  const callerAuthUserId = answerOf(subjectRead).data ?? null;
  const teamsAnswer = answerOf(teamsRead);
  const teamsState = teamsSurfaceStateOf(teamsAnswer);
  // WRITABLE, not merely drawable: a failed refetch keeps the cached teams, and
  // the picker and team actions are withheld on it as they were before.
  const allTeams = writableTeamsOf(teamsState);
  const activeTeams = allTeams === null ? null : splitTeams(allTeams).active;
  const organizationMembers = membersSurfaceStateOf(answer).members ?? [];
  // THE ORGANIZATION'S TODAY — the date controls' default and their minimum —
  // from the zone the one list read embeds.
  const today = membersTodayOf(organizationMembers, new Date());

  // TWO PURE FUNCTIONS AND NO BRANCH OF ITS OWN: the list's four states, then
  // "is this member in it". Both are pinned by execution in `write.test.ts`.
  const form = memberFormRefusalOf(membersSurfaceStateOf(answer), id);
  // THE SCREEN AS LAST DRAWN, read after an await (story 5.5e): an erasure
  // dialog's save is judged against these as they are then, never against
  // what the render that started it had captured.
  const latest = useRef({
    member: form.member,
    today,
    teams: allTeams,
    members: organizationMembers,
    caller: callerAuthUserId,
  });

  useEffect(() => {
    latest.current = { member: form.member, today, teams: allTeams, members: organizationMembers, caller: callerAuthUserId };
  });

  const calendarSnapshot = calendarSurfaceStateOf(calendar).snapshot;
  const screen: MemberScreen = {
    id,
    openings,
    form,
    today,
    organizationMembers,
    allTeams,
    activeTeams,
    callerAuthUserId,
    offersRank,
    positionsSetting,
    offersPosition,
    calendarSnapshot,
    latest,
    readErasures,
  };
  const basics = useMemberBasics(screen);
  const reset = useMemberReset(screen);
  const status = useMemberStatus(screen);
  const team = useMemberTeam(screen);

  return {
    // The member write: the basics and the allowance dialogs.
    ...basics,
    form,
    /**
     * Whether the read refusal offers its retry: an unavailable read only, and
     * never offline (story 8.2e) — the re-read would pause until the
     * connection returns. Online it returns.
     */
    readRetryable: clock.online && memberReadRetryable(form.refusal),
    retryMembers: () => {
      void retryRead(queryClient, MEMBERS_LIST_KEY);
    },
    offersRank,
    // The password reset.
    ...reset,
    // The status block.
    ...status,
    // The team block.
    ...team,
    today,
    offersPosition,
    positionsRefusal,
    teamsState,
    /** Whether to show the teams read's retry now: its refusal, online (story 8.2e). */
    teamsRetryable: clock.online && teamsState.refusal !== null,
    retryTeams: () => {
      void retryRead(queryClient, TEAMS_LIST_KEY);
    },
    // STORY 8.2c: the page's one as-of note, under its heading — the calendar
    // snapshot's zone — while the whole cached snapshot is drawn offline; none
    // above the member read's unavailable state, where no card is drawn.
    offline: offlineNoteOf(
      freshness,
      calendarSnapshot === null ? null : calendarSnapshot.timeZone,
      memberReadRetryable(form.refusal),
    ),
  };
}

/** Everything the member page's cards read, as the hook returns it. */
export type MemberEdit = ReturnType<typeof useMemberEdit>;
