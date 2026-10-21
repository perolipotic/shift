import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { positionsShown } from '@/features/members/utils/position';
import { ranksShown } from '@/features/members/utils/rank';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  organizationTable,
  readOrganization,
} from '@/features/organization/services/snapshot';
import {
  DIRECTORY_LOADING,
  DIRECTORY_UNAVAILABLE,
  DIRECTORY_READ_LOADING,
  directoryReadOf,
  directoryRetryOf,
  memberDirectoryOf,
  ownTeamIdReadOf,
  type DirectoryRead,
} from '@/features/teams/services/directory';
import { TEAMS_LIST_KEY, TEAMS_TABLE, splitTeams, teamsQueryOptions } from '@/features/teams/services/list';
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
import { directorySurfaceKeysOf, directoryTimeZoneOf } from '@/features/teams/services/surface-keys';
import { offlineNoteOf, zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness, type ObservedRead } from '@/lib/offline/use-snapshot-freshness';
import { currentSession, supabaseClient } from '@/lib/supabase/client';
import { NO_TEXT } from '@/utils/text';

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
  // THE ACTIVE TEAMS OF THE CACHED LIST as it stands — which rosters to read,
  // never a figure drawn — so the rosters are read with the list's own
  // refetch, and the keys (`directorySurfaceKeysOf`, story 8.2b) are exactly
  // the reads made.
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
    queryFn: () => readOrganization(organizationTable()),
    // The chrome's own cache policy for this entry (`features/navigation/components/chrome.tsx`).
    retry: false,
    staleTime: ORGANIZATION_READ_STALE_MS,
  });

  // STORY 8.2b: the directory's reads are one snapshot, decided from these
  // very observer results: online, a read older than this session's network
  // is never drawn as fresh; offline, the whole cached directory is drawn
  // under the as-of note (`offline`), or — a team's roster never read
  // included — the unavailable state is.
  // THE NOTE'S ZONE: the organization snapshot's, or the own-team read's; with
  // neither, the directory is unavailable offline, never drawn without its note.
  const timeZone = directoryTimeZoneOf(organization.data, own.data);
  const { freshness, answerOf } = useSnapshotFreshness(
    directorySurfaceKeysOf(active.map((team) => team.id)),
    [
      [TEAMS_LIST_KEY, teams],
      [OWN_TEAM_KEY, own],
      [ORGANIZATION_SNAPSHOT_KEY, organization],
      ...active.flatMap((team, index): ObservedRead[] => {
        const answer = rosters[index];

        return answer === undefined ? [] : [[TEAM_ROSTER_KEY(team.id), answer]];
      }),
    ],
    zoneFromReads(timeZone),
  );
  const rosterList = active.map(
    (_team, index): DirectoryRead<TeamRosterOutcome> => {
      const answer = rosters[index];

      return answer === undefined ? { state: DIRECTORY_READ_LOADING } : directoryReadOf(answerOf(answer));
    },
  );
  const rosterReads = new Map<string, DirectoryRead<TeamRosterOutcome>>(
    active.map((team, index) => [team.id, rosterList[index] ?? { state: DIRECTORY_READ_LOADING }]),
  );
  const teamsRead = directoryReadOf(answerOf(teams));
  const ownAnswer = answerOf(own);
  const ownRead = ownTeamIdReadOf(directoryReadOf(ownAnswer), new Date());
  const directory = memberDirectoryOf(teamsRead, rosterReads, ownRead, text);
  const organizationData = answerOf(organization).data;
  // THE RANK AND POSITION beside a name, as the roster shows them: until the
  // snapshot arrives, or if it fails, names only.
  const snapshot = organizationData !== undefined && organizationData.ok ? organizationData.snapshot : null;

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
    // STORY 8.2b: the as-of note's time and zone while the whole directory is
    // drawn offline; none above the unavailable state, where nothing is drawn.
    // Whatever the directory draws — groups, none, no match — but its unavailable state.
    offline: offlineNoteOf(freshness, timeZone, directory.kind === DIRECTORY_UNAVAILABLE),
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
