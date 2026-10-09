import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { NO_TEXT } from '@/features/members/services/list';
import { positionsShown } from '@/features/members/utils/position';
import { ranksShown } from '@/features/members/utils/rank';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  readOrganization,
} from '@/features/organization/services/snapshot';
import {
  DIRECTORY_LOADING,
  DIRECTORY_READ_LOADING,
  directoryReadOf,
  directoryRetryOf,
  memberDirectoryOf,
  ownTeamIdReadOf,
  type DirectoryRead,
} from '@/features/teams/services/directory';
import { TEAMS_TABLE, splitTeams, teamsQueryOptions } from '@/features/teams/services/list';
import {
  OWN_TEAM_KEY,
  OWN_TEAM_TABLE,
  TEAM_ROSTER_KEY,
  TEAM_ROSTER_READ_STALE_MS,
  readOwnTeamToday,
  readTeamRoster,
  type TeamRosterOutcome,
  type TeamRosterRpc,
} from '@/features/teams/services/roster';
import { currentSession, supabaseClient } from '@/lib/supabase/client';

/** How the hook writes the search to the URL: `?trazi=`, replacing the entry. */
export type DirectoryNavigate = (search: string) => void;

/**
 * The member directory's reads and its search box (story 7.17). Wiring only:
 * every decision is `@/features/teams/services/directory`'s, which the node
 * suite executes.
 *
 * NO KEY OF ITS OWN. It composes the reads a member-role session already
 * makes, each under its existing key and with its existing query function and
 * stale time: the team list (`teamsQueryOptions`, read directly rather than
 * through `useTeamList`, which carries the admin's create flow), one roster
 * per ACTIVE team (`TEAM_ROSTER_KEY`, as `/smjene/$id` reads it), the caller's
 * own team (`OWN_TEAM_KEY`, as Danas reads it) and the organization snapshot
 * for the rank and position setting (as `useTeamRoster` reads it). A team or
 * membership write already invalidates every one of them
 * (`@/features/teams/services/dependents`).
 *
 * THE SEARCH IS THE URL'S `?trazi=`. Typing replaces the entry, so Back
 * leaves the page rather than stepping through keystrokes; the box keeps what
 * was typed, and follows the URL when it changes from elsewhere.
 */
export function useMemberDirectory(search: string, navigate: DirectoryNavigate) {
  const [text, setText] = useState(search);
  const typed = useRef(text);
  const searchField = useRef<HTMLInputElement>(null);

  // THE URL MOVED FROM ELSEWHERE — Back, a link, a reload — when it no longer
  // holds what was typed, trimmed as the route trims it.
  useEffect(() => {
    if (typed.current.trim() === search) return;
    typed.current = search;
    setText(search);
  }, [search]);

  const teams = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));
  const active = teams.data === undefined ? [] : splitTeams(teams.data).active;
  const rosters = useQueries({
    queries: active.map((team) => ({
      queryKey: TEAM_ROSTER_KEY(team.id),
      queryFn: () => readTeamRoster(supabaseClient() as unknown as TeamRosterRpc, team.id),
      staleTime: TEAM_ROSTER_READ_STALE_MS,
      refetchOnWindowFocus: false,
    })),
  });
  const own = useQuery({
    queryKey: OWN_TEAM_KEY,
    queryFn: () => readOwnTeamToday(supabaseClient().from(OWN_TEAM_TABLE), currentSession),
    staleTime: TEAM_ROSTER_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const organization = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
    // The chrome's own cache policy for this entry (`features/navigation/components/chrome.tsx`).
    retry: false,
    staleTime: ORGANIZATION_READ_STALE_MS,
  });

  const rosterList = active.map(
    (_team, index): DirectoryRead<TeamRosterOutcome> => {
      const answer = rosters[index];

      return answer === undefined ? { state: DIRECTORY_READ_LOADING } : directoryReadOf(answer);
    },
  );
  const rosterReads = new Map<string, DirectoryRead<TeamRosterOutcome>>(
    active.map((team, index) => [team.id, rosterList[index] ?? { state: DIRECTORY_READ_LOADING }]),
  );
  const teamsRead = directoryReadOf(teams);
  const ownRead = ownTeamIdReadOf(directoryReadOf(own), new Date());
  const directory = memberDirectoryOf(teamsRead, rosterReads, ownRead, text);
  // THE RANK AND POSITION beside a name, as the roster shows them: until the
  // snapshot arrives, or if it fails, names only.
  const snapshot =
    organization.data !== undefined && organization.data.ok ? organization.data.snapshot : null;

  /** Read again every read the directory counts as failed — and only those (`directoryRetryOf`). */
  function retry(): void {
    const plan = directoryRetryOf(teamsRead, rosterList, ownRead);

    if (plan.teams) void teams.refetch();
    if (plan.own) void own.refetch();
    plan.rosters.forEach((failed, index) => {
      if (failed) void rosters[index]?.refetch();
    });
  }

  function write(value: string): void {
    typed.current = value;
    setText(value);
    navigate(value);
  }

  function changeSearch(event: ChangeEvent<HTMLInputElement>): void {
    write(event.target.value);
  }

  /** *Poništi pretragu*: the box emptied, and focus back in it. */
  function clearSearch(): void {
    write(NO_TEXT);
    searchField.current?.focus();
  }

  return {
    directory,
    // `main` is busy while the directory waits for a read.
    loading: directory.kind === DIRECTORY_LOADING,
    search: text,
    searchField,
    changeSearch,
    clearSearch,
    retry,
    shown: ranksShown(snapshot),
    positionShown: positionsShown(snapshot),
  };
}

/** What the directory's parts are drawn from. */
export type MemberDirectoryScreen = ReturnType<typeof useMemberDirectory>;
