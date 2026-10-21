import { useQuery } from '@tanstack/react-query';

import { positionsShown } from '@/features/members/utils/position';
import { ranksShown } from '@/features/members/utils/rank';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  organizationTable,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import {
  TEAM_ROSTER_KEY,
  TEAM_ROSTER_READ_STALE_MS,
  TEAM_ROSTER_UNAVAILABLE,
  readTeamRoster,
  teamRosterNoticeOf,
  teamRosterSurfaceStateOf,
  type TeamRosterRpc,
} from '@/features/teams/services/roster';
import { teamRosterSurfaceKeysOf, teamRosterTimeZoneOf } from '@/features/teams/services/surface-keys';
import { offlineNoteOf, zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * One team's roster and the setting that decides what stands beside a name
 * (story 1.8, member rank, team position).
 *
 * ONE READ UNDER ONE KEY (AD-13): the team's name, its archived flag and its
 * members all come from the single RPC, so the heading and the count can never
 * disagree with the names beside them.
 *
 * THE RANK BESIDE A NAME is shown only when the organization uses fire ranks.
 * The setting comes from the one organization snapshot under its shared key —
 * the navigation chrome already reads it on every screen, so this is a second
 * consumer of one cache entry, not a second read. Until it arrives, or if it
 * fails, the roster shows names only: the rank is an addition to a name, never
 * a reason to withhold one.
 *
 * Every rule is in `@/features/teams/services/roster` and the members
 * feature's rank and position modules, which the node suite executes; this hook
 * holds the two reads and their derivations only.
 */
export function useTeamRoster(id: string) {
  const answerRead = useQuery({
    queryKey: TEAM_ROSTER_KEY(id),
    queryFn: () => readTeamRoster(supabaseClient() as unknown as TeamRosterRpc, id),
    staleTime: TEAM_ROSTER_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });
  // Through the one factory the chrome reads this entry with: one function and one policy for the key.
  const organizationRead = useQuery(
    organizationSnapshotQueryOptions(organizationTable),
  );
  // STORY 8.2b: the roster and the setting are one snapshot, decided from these
  // very observer results: online, a read older than this session's network is
  // never drawn as fresh; offline, the cached roster is drawn under the as-of
  // note (`offline`), or the unavailable message is.
  // The note's zone is the organization's; with none, the roster is unavailable offline.
  const timeZone = teamRosterTimeZoneOf(organizationRead.data);
  const { freshness, answerOf } = useSnapshotFreshness(
    teamRosterSurfaceKeysOf(id),
    [
      [TEAM_ROSTER_KEY(id), answerRead],
      [ORGANIZATION_SNAPSHOT_KEY, organizationRead],
    ],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const state = teamRosterSurfaceStateOf(answer);
  const { roster, loading } = state;
  // The refusal, or the unavailable message beside a roster a refetch paused
  // offline over — the message this screen already has, so no new text. Under
  // the freshness a paused refetch is never seen: the as-of note stands there.
  const refusal = teamRosterNoticeOf(state);

  const organization = answerOf(organizationRead).data;
  const snapshot = organization !== undefined && organization.ok ? organization.snapshot : null;
  const shown = ranksShown(snapshot);
  // TEAM POSITION: the same setting, "uses fire ranks and positions".
  const positionShown = positionsShown(snapshot);

  // STORY 8.2b: the as-of note's time and zone — the organization's — while
  // the cached roster is drawn offline; none beside a refusal.
  const offline = offlineNoteOf(freshness, timeZone, refusal === TEAM_ROSTER_UNAVAILABLE);

  return { roster, refusal, loading, shown, positionShown, offline };
}

/** What the roster screen's parts are drawn from. */
export type TeamRosterScreen = ReturnType<typeof useTeamRoster>;
