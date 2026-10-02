import type { QueryKey } from '@tanstack/react-query';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import { MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { MEMBER_NAME_KEY } from '@/features/navigation/services/profile';
import { MEMBER_ROLE_KEY } from '@/features/navigation/services/role';
import { ROTATION_KEY } from '@/features/rotation/services/list';
import { OWN_TEAM_KEY, TEAM_ROSTERS_KEY } from '@/features/teams/services/roster';

/**
 * WHICH READS A TEAM OR MEMBERSHIP WRITE MAKES STALE, named in one place.
 *
 * THE CONVENTION (AD-13, amended): a write invalidates its own surface's key
 * AND every key whose read embeds or derives from the rows it writes. The
 * first half is each hook's own; the second half is declared here, per write,
 * so a read that starts embedding a team or a membership is added to one list
 * rather than hunted for across the handlers. `dependents.test.ts` classifies
 * every exported query key, so a new key fails there until it is placed.
 *
 *   - THE MEMBER LIST embeds `teams(name)` beside each membership version.
 *   - DANAS'S OWN-TEAM LINE embeds the same team name off the caller's row.
 *   - EVERY `/smjene/$id` ROSTER answers the team's name, its archived flag and
 *     today's active members with their names, ranks and positions.
 *   - THE ROTATION BUILDER binds every active team (story 2.3b) and embeds
 *     `members(name)` for its history's authors.
 *   - THE CALENDAR draws every team and who is on it. Its read has a stale time
 *     of 0, so it re-reads on every mount anyway and listing it is harmless
 *     today — but the rule requires it, and a later stale time would otherwise
 *     leave it stale silently.
 *   - THE CHROME'S OWN NAME AND ROLE are the signed-in member's own row, which
 *     an admin editing themselves writes.
 *   - THE CALENDAR SNAPSHOT embeds every hour band (story 4.1b), which *Sati*
 *     splits a member's hours by, so a band write names it too — declared
 *     here beside the others, though the write is the band screens'.
 *
 * THE DEPENDENTS ARE RE-READ ONLY AFTER A WRITE THAT LANDED. A refusal changes
 * no row, so it re-reads its own screen's reads (the likeliest reason for a
 * refusal is a list behind the database) and nothing else.
 *
 * Plain data and one function over a structural client, so the node suite
 * executes both.
 */

/** A new team: nothing embeds a team nobody is on yet, except the builder. */
export const TEAM_CREATE_DEPENDENTS: readonly QueryKey[] = [ROTATION_KEY];

/** A team renamed or archived: every read that shows a team's name or flag. */
export const TEAM_CHANGE_DEPENDENTS: readonly QueryKey[] = [
  ROTATION_KEY,
  MEMBERS_LIST_KEY,
  OWN_TEAM_KEY,
  TEAM_ROSTERS_KEY,
  CALENDAR_KEY,
];

/**
 * A member moved between teams, or their status changed: every read that
 * says who is on which team today.
 */
export const MEMBERSHIP_WRITE_DEPENDENTS: readonly QueryKey[] = [OWN_TEAM_KEY, TEAM_ROSTERS_KEY, CALENDAR_KEY];

/**
 * A member's own row saved: the rosters and the builder's history show the
 * name (the rosters the rank too), and the chrome's name and role are the
 * member's own when an admin edits themselves.
 */
export const MEMBER_SAVE_DEPENDENTS: readonly QueryKey[] = [
  TEAM_ROSTERS_KEY,
  ROTATION_KEY,
  MEMBER_NAME_KEY,
  MEMBER_ROLE_KEY,
];

/** An hour band added, changed or removed (story 4.1b): the snapshot *Sati* derives band hours from. */
export const HOUR_BAND_WRITE_DEPENDENTS: readonly QueryKey[] = [CALENDAR_KEY];

/**
 * A leave record saved, amended or removed (stories 5.1c, 5.2b): its own key
 * is the member's live records. Since story 5.2c the viewer's own records
 * (*Godišnji*) depend on it too — an admin's write to their own leave changes
 * their own tab. Since story 5.3b the organization's live records, which the
 * conflicts queue (*Raspored*) derives every collision from, depend on it
 * too. Since story 5.3c the calendar's marks read the same two keys — the
 * organization's records for an admin, the viewer's own for a member — so
 * they follow every leave write with no key of their own. Since story 5.3d
 * *Sati*'s conflict count reads the same two keys, by the same role rule, so
 * it follows too. Since story 5.4a the live conflict resolutions — the
 * organization's and the viewer's own — depend on it too: a removal or an
 * amend ends the resolutions whose date its leave stops covering (0031), and
 * every unresolved surface reads them.
 */
export const LEAVE_WRITE_DEPENDENTS: readonly QueryKey[] = [
  MY_LEAVE_RECORDS_KEY,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
];

/**
 * A conflict resolution recorded (story 5.4b): both live resolution reads.
 * The organization's is what the queue (*Raspored*), the calendar's marks
 * (the conflict ring, and the uncovered mark an accepted conflict leaves) and
 * an admin's *Sati* (the count, and the leave hours an accepted conflict
 * moves) derive from; the viewer's own is a member's *Sati* — an admin's
 * decision on their own conflict changes it. No leave, schedule or member row
 * changes, so nothing else is re-read.
 */
export const CONFLICT_RESOLUTION_WRITE_DEPENDENTS: readonly QueryKey[] = [
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  MY_CONFLICT_RESOLUTIONS_KEY,
];

/**
 * A conflict resolved by a replacement (story 5.4c): both live resolution
 * reads, for the reasons a recorded resolution names them, AND the calendar
 * snapshot — 0032 writes a roster override beside the resolution, which puts
 * the replacement on the day's roster, raises their band hours in *Sati* and
 * takes them out of the next conflict's candidates.
 */
export const CONFLICT_REPLACE_WRITE_DEPENDENTS: readonly QueryKey[] = [
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  MY_CONFLICT_RESOLUTIONS_KEY,
  CALENDAR_KEY,
];

/**
 * A replacement refused because the replacement is already put on the shift
 * (story 5.4c): the calendar snapshot, whose live roster overrides the
 * candidates are derived from, so the re-read takes them out of the list.
 */
export const CONFLICT_REPLACE_TAKEN_DEPENDENTS: readonly QueryKey[] = [CALENDAR_KEY];

/**
 * A conflict resolution refused as no longer open (story 5.4b): beside the
 * resolutions themselves, the organization's live leave — a P0002 means the
 * leave covering the date is gone, and only the leave read takes the
 * conflict away.
 */
export const CONFLICT_RESOLUTION_GONE_DEPENDENTS: readonly QueryKey[] = [ORGANIZATION_LEAVE_RECORDS_KEY];

/** A refusal's re-read: the surface's own key, and nothing that depends on it. */
export const NO_DEPENDENTS: readonly QueryKey[] = [];

/** The one call a write makes on the cache, named structurally so it can be stubbed. */
export interface InvalidatingClient {
  invalidateQueries(filters: { readonly queryKey: QueryKey }): Promise<void>;
}

/**
 * Re-read the surface's own key and every dependent, all started together so
 * one cannot hold up another.
 *
 * IT RESOLVES WHEN A RE-READ FAILS. TanStack Query's `invalidateQueries`
 * refetches with `throwOnError` false, so a rejecting `queryFn` settles the
 * query as failed and the promise still resolves, and a refetch paused offline
 * resolves at once. That, and not the callers' `try`, is what keeps a failed
 * re-read from ever turning a landed write into a refusal; `dependents.test.ts`
 * pins it against a real client. The callers' `try` remains for a client that
 * throws before any re-read starts.
 */
export async function refreshAfterWrite(
  client: InvalidatingClient,
  own: QueryKey,
  dependents: readonly QueryKey[],
): Promise<void> {
  await Promise.all([own, ...dependents].map((queryKey) => client.invalidateQueries({ queryKey })));
}
