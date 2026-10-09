import { compareText } from '@/lib/i18n/format';
import { NO_TEXT, foldForSearch, foldedSearchOf } from '@/features/members/services/list';
import type { TeamRow } from '@/features/teams/services/list';
import {
  TEAM_ROSTER_FETCH_PAUSED,
  TEAM_ROSTER_UNKNOWN,
  ownTeamTodayOf,
  type OwnTeamOutcome,
  type RosterQueryAnswer,
  type TeamRosterMember,
  type TeamRosterOutcome,
} from '@/features/teams/services/roster';

/**
 * The member directory (story 7.17): who is on which team today, for a
 * member-role session on `/ljudi`.
 *
 * EVERY RULE IS HERE, for the reason `@/features/teams/services/roster` gives:
 * a `.tsx` is collected by no test (AD-15), so the groups, their order, the
 * counts, the own-team mark, the search and the empty and failed states are
 * one pure function the node suite executes.
 *
 * NO NEW READ. The directory composes the reads a member-role session already
 * has, under their existing keys: the team list (`TEAMS_LIST_KEY`), one
 * `team_roster(team)` per active team (`TEAM_ROSTER_KEY`) and the caller's own
 * team today (`OWN_TEAM_KEY`). A roster carries an id, a name, a rank and a
 * position and nothing else, so nothing here could show an allowance, a
 * balance, hours or an address even by mistake (CAP-5, FR-16).
 *
 * ALL OR NOTHING. One failed read — the list, any roster, an active team the
 * roster calls unknown, or the caller's own team — is the whole directory
 * unavailable. A partial directory would state a team as missing, or the
 * caller's mark as absent, with nothing to say it is not true.
 */

/** A read that has not answered yet. */
export const DIRECTORY_READ_LOADING = 'loading';
/** A read that failed, or answered something that cannot be trusted. */
export const DIRECTORY_READ_FAILED = 'failed';
/** A read that answered. */
export const DIRECTORY_READ_ANSWERED = 'answered';

/** One read as the directory sees it. */
export type DirectoryRead<T> =
  | { readonly state: typeof DIRECTORY_READ_LOADING }
  | { readonly state: typeof DIRECTORY_READ_FAILED }
  | { readonly state: typeof DIRECTORY_READ_ANSWERED; readonly value: T };

/**
 * One query result as a read: failed on an error or a first fetch paused
 * offline, answered once there is data, loading before that. A failed refetch
 * over kept data is FAILED, not answered: the directory never stands on a read
 * it knows has gone wrong.
 */
export function directoryReadOf<T>(answer: RosterQueryAnswer<T>): DirectoryRead<T> {
  if (answer.isError) return { state: DIRECTORY_READ_FAILED };
  if (answer.data !== undefined) return { state: DIRECTORY_READ_ANSWERED, value: answer.data };
  if (answer.fetchStatus === TEAM_ROSTER_FETCH_PAUSED) return { state: DIRECTORY_READ_FAILED };

  return { state: DIRECTORY_READ_LOADING };
}

/**
 * The caller's own read as the id of their team today, `null` for none. A
 * refused own read is a failed read: the mark would be a guess.
 */
export function ownTeamIdReadOf(read: DirectoryRead<OwnTeamOutcome>, now: Date): DirectoryRead<string | null> {
  if (read.state !== DIRECTORY_READ_ANSWERED) return read;
  if (!read.value.ok) return { state: DIRECTORY_READ_FAILED };

  // The same derivation Danas's line uses, as at the organization's today.
  return { state: DIRECTORY_READ_ANSWERED, value: ownTeamTodayOf(read.value.snapshot, now)?.id ?? null };
}

/** One team in the directory. */
export interface DirectoryGroup {
  readonly id: string;
  /** The team's name today, as its roster answers it. Data, never translated. */
  readonly name: string;
  /** The caller's own team today, marked *tvoja smjena*. */
  readonly own: boolean;
  /** Today's members in roster order — every one, or a search's hits. */
  readonly members: readonly TeamRosterMember[];
}

/** The element id a group's heading carries, which its section is labelled by. */
export function directoryHeadingIdOf(group: Pick<DirectoryGroup, 'id'>): string {
  return `ljudi-directory-${group.id}`;
}

/** The directory is waiting for a read. */
export const DIRECTORY_LOADING = 'loading';
/** A read failed: one notice and a retry, no groups. */
export const DIRECTORY_UNAVAILABLE = 'unavailable';
/** Every read answered. */
export const DIRECTORY_ANSWERED = 'answered';

export type MemberDirectory =
  | { readonly kind: typeof DIRECTORY_LOADING }
  | { readonly kind: typeof DIRECTORY_UNAVAILABLE }
  | {
      readonly kind: typeof DIRECTORY_ANSWERED;
      /** The groups to draw, in order: the caller's team first, then by name. */
      readonly groups: readonly DirectoryGroup[];
      /** Whether a search narrows the groups. */
      readonly searched: boolean;
    };

function compareGroups(first: DirectoryGroup, second: DirectoryGroup): number {
  if (first.own !== second.own) return first.own ? -1 : 1;

  // Under the Croatian collation, then by id, so two teams that share a name
  // sort the same way every time.
  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/**
 * The directory, from its reads and the search box's text.
 *
 * `activeTeams` may hold archived rows: they are dropped here, so the caller
 * cannot list one by passing the wrong half of a split. `rosters` is keyed by
 * team id; a team with no entry is still loading. A roster that answers an
 * archived team (archived between the two reads) leaves it out as well.
 *
 * ORDER: the caller's team first, then the rest by name; members stay in
 * roster order. COUNTS are the members drawn, so a count never disagrees with
 * the names beside it. A team with nobody today keeps its heading and its
 * zero, unless a search is active: a search hides every team with no hit.
 * The search matches NAMES ONLY, folded as the member list folds.
 */
export function memberDirectoryOf(
  activeTeams: DirectoryRead<readonly TeamRow[]>,
  rosters: ReadonlyMap<string, DirectoryRead<TeamRosterOutcome>>,
  ownTeamId: DirectoryRead<string | null>,
  query: string,
): MemberDirectory {
  if (activeTeams.state === DIRECTORY_READ_FAILED || ownTeamId.state === DIRECTORY_READ_FAILED) {
    return { kind: DIRECTORY_UNAVAILABLE };
  }

  const teams = activeTeams.state === DIRECTORY_READ_ANSWERED ? activeTeams.value.filter((team) => !team.archived) : [];
  const reads = teams.map(
    (team): DirectoryRead<TeamRosterOutcome> => rosters.get(team.id) ?? { state: DIRECTORY_READ_LOADING },
  );

  // FAILURE FIRST: a failed roster beside a pending one is already a failed
  // directory, so the notice does not wait for the rest.
  if (reads.some(rosterFailed)) return { kind: DIRECTORY_UNAVAILABLE };

  if (activeTeams.state === DIRECTORY_READ_LOADING || ownTeamId.state === DIRECTORY_READ_LOADING) {
    return { kind: DIRECTORY_LOADING };
  }

  const own = ownTeamId.state === DIRECTORY_READ_ANSWERED ? ownTeamId.value : null;
  const folded = foldedSearchOf(query);
  const groups: DirectoryGroup[] = [];

  for (const [index, team] of teams.entries()) {
    const read = reads[index];

    if (read === undefined || read.state !== DIRECTORY_READ_ANSWERED) return { kind: DIRECTORY_LOADING };
    if (!read.value.ok) return { kind: DIRECTORY_UNAVAILABLE };

    const roster = read.value.roster;

    if (roster.archived) continue;

    const members = folded === null ? roster.members : roster.members.filter((member) => nameMatches(member, folded));

    if (folded !== null && members.length === 0) continue;

    groups.push({ id: team.id, name: roster.name, own: team.id === own, members });
  }

  return { kind: DIRECTORY_ANSWERED, groups: groups.sort(compareGroups), searched: folded !== null };
}

/** Which reads the unavailable notice's retry reads again. */
export interface DirectoryRetry {
  readonly teams: boolean;
  readonly own: boolean;
  /** One flag per roster read, in the order given. */
  readonly rosters: readonly boolean[];
}

/** A roster read the directory counts as failed: failed itself, or answered with a code. */
function rosterFailed(read: DirectoryRead<TeamRosterOutcome>): boolean {
  return read.state === DIRECTORY_READ_FAILED || (read.state === DIRECTORY_READ_ANSWERED && !read.value.ok);
}

/**
 * The retry's plan: every read {@link memberDirectoryOf} counts as failed —
 * a first fetch paused offline included, which carries no `isError` — and
 * nothing else. A roster answering `TEAM_ROSTER_UNKNOWN` also re-reads the
 * team list: the team was most likely archived after the list was read, and
 * re-reading only its roster would answer unknown forever.
 */
export function directoryRetryOf(
  teams: DirectoryRead<unknown>,
  rosters: readonly DirectoryRead<TeamRosterOutcome>[],
  ownTeamId: DirectoryRead<unknown>,
): DirectoryRetry {
  const unknownRoster = rosters.some(
    (read) => read.state === DIRECTORY_READ_ANSWERED && !read.value.ok && read.value.code === TEAM_ROSTER_UNKNOWN,
  );

  return {
    teams: teams.state === DIRECTORY_READ_FAILED || unknownRoster,
    own: ownTeamId.state === DIRECTORY_READ_FAILED,
    rosters: rosters.map(rosterFailed),
  };
}

/** Whether a member's NAME holds a folded query. Nothing else is searched. */
function nameMatches(member: TeamRosterMember, folded: string): boolean {
  // A query that folds to nothing matches nobody (`foldedSearchOf`).
  return folded !== NO_TEXT && foldForSearch(member.name).includes(folded);
}
