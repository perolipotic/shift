import { useQuery } from '@tanstack/react-query';

import { positionsShown } from '@/features/members/utils/position';
import { ranksShown } from '@/features/members/utils/rank';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  readOrganization,
} from '@/features/organization/services/snapshot';
import {
  TEAM_ROSTER_KEY,
  TEAM_ROSTER_READ_STALE_MS,
  readTeamRoster,
  teamRosterSurfaceStateOf,
  type TeamRosterRpc,
} from '@/features/teams/services/roster';
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
  const answer = useQuery({
    queryKey: TEAM_ROSTER_KEY(id),
    queryFn: () => readTeamRoster(supabaseClient() as unknown as TeamRosterRpc, id),
    staleTime: TEAM_ROSTER_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const { roster, refusal, loading } = teamRosterSurfaceStateOf(answer);

  const organization = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
    // The chrome's own cache policy for this entry (`features/navigation/components/chrome.tsx`).
    retry: false,
    staleTime: ORGANIZATION_READ_STALE_MS,
  });
  const snapshot =
    organization.data !== undefined && organization.data.ok ? organization.data.snapshot : null;
  const shown = ranksShown(snapshot);
  // TEAM POSITION: the same setting, "uses fire ranks and positions".
  const positionShown = positionsShown(snapshot);

  return { roster, refusal, loading, shown, positionShown };
}

/** What the roster screen's parts are drawn from. */
export type TeamRosterScreen = ReturnType<typeof useTeamRoster>;
