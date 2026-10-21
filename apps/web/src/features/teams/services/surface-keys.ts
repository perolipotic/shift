import type { QueryKey } from '@tanstack/react-query';

import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { OWN_TEAM_KEY, TEAM_ROSTER_KEY } from '@/features/teams/services/roster';

/**
 * The members' directory's reads as one snapshot (story 8.2b): the keys its
 * offline freshness is decided over — the team list, the caller's own team,
 * the organization snapshot, and one roster for each ACTIVE team the cached
 * team list holds (`activeTeamIds`), exactly the reads `useMemberDirectory`
 * makes. Offline, a team whose roster was never read leaves the directory
 * unavailable, never a directory missing a team. `surface-keys.test.ts` pins
 * the set and that every key is kept on the device.
 */
export function directorySurfaceKeysOf(activeTeamIds: readonly string[]): readonly QueryKey[] {
  return [TEAMS_LIST_KEY, OWN_TEAM_KEY, ORGANIZATION_SNAPSHOT_KEY, ...activeTeamIds.map((id) => TEAM_ROSTER_KEY(id))];
}

/**
 * One team's roster, `/smjene/$id`, as one snapshot (story 8.2b): the roster
 * and the organization snapshot that decides what stands beside a name.
 */
export function teamRosterSurfaceKeysOf(id: string): readonly QueryKey[] {
  return [TEAM_ROSTER_KEY(id), ORGANIZATION_SNAPSHOT_KEY];
}

/** The organization read as far as its zone goes: its own outcome, or nothing yet. */
type OrganizationZoneAnswer = { readonly ok: true; readonly snapshot: { readonly timezone: string } } | { readonly ok: false };
/** The own-team read as far as its zone goes. */
type OwnTeamZoneAnswer = { readonly ok: true; readonly snapshot: { readonly timeZone: string } } | { readonly ok: false };

/**
 * The zone a team roster's as-of note states its time in (story 8.2b): the
 * organization snapshot's. The roster carries no zone of its own, so with
 * none — a read not yet answered, or one that answered its own failure — it
 * is `null`, and the roster is unavailable offline rather than drawn
 * without its note.
 */
export function teamRosterTimeZoneOf(organization: OrganizationZoneAnswer | undefined): string | null {
  return organization !== undefined && organization.ok ? organization.snapshot.timezone : null;
}

/**
 * The zone the directory's as-of note states its time in (story 8.2b): the
 * organization snapshot's, and failing that the organization zone the
 * caller's own-team read carries; `null` with neither, and the directory is
 * then unavailable offline rather than drawn without its note.
 */
export function directoryTimeZoneOf(
  organization: OrganizationZoneAnswer | undefined,
  own: OwnTeamZoneAnswer | undefined,
): string | null {
  return teamRosterTimeZoneOf(organization) ?? (own !== undefined && own.ok ? own.snapshot.timeZone : null);
}
