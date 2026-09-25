import type { Session } from '@supabase/supabase-js';

import { compareText, organizationIsoDate } from '@/i18n/format';
import { memberTeamOn, teamVersionsIn, type MemberTeam, type MemberTeamVersion } from '@/members/list';

/**
 * Who is on a team today, and which team the caller is on (story 1.8).
 *
 * EVERYTHING THE TWO SURFACES DECIDE IS HERE, for the reason `@/teams/list`
 * gives: a `.tsx` is collected by no test (AD-15), so the parsing, the sort, the
 * surface state and the message keys are pure functions the node suite runs.
 *
 * TWO READS, EACH ONE SNAPSHOT UNDER ONE KEY (AD-13):
 *
 *   - THE ROSTER is `team_roster(team)` (`0011`), one RPC answering the team's
 *     name, its archived flag and today's active members as id and name. It is
 *     the only way a member-role session learns a colleague's name: since
 *     `0011` the select policy on `members` shows such a session its own row
 *     and nothing else (CAP-5).
 *   - THE CALLER'S TEAM TODAY is read off the caller's own `members` row, with
 *     the same embed `@/members/list` reads and through the same parser and
 *     derivation, so the SQL and SPA readings of "team today" cannot drift.
 *
 * `rpc` and `select` AND NOTHING ELSE. Neither surface writes.
 */

/** The function `0011` declares. */
export const TEAM_ROSTER_FUNCTION = 'team_roster';

/** The one query key the roster screen reads under, per team. */
export function TEAM_ROSTER_KEY(id: string): readonly ['team-roster', string] {
  return ['team-roster', id] as const;
}

/** Five minutes, the bound `TEAMS_READ_STALE_MS` sets, for the same reason. */
export const TEAM_ROSTER_READ_STALE_MS = 300000;

/** TanStack Query's name for a fetch it has not started (offline). */
export const TEAM_ROSTER_FETCH_PAUSED = 'paused';

/** The roster could not be read, or what came back cannot be trusted as one. */
export const TEAM_ROSTER_UNAVAILABLE = 'TEAM_ROSTER_UNAVAILABLE';

/**
 * Zero rows: the team is another organization's, never existed, or the caller
 * is not active today. `0011` answers all of these identically, so the surface
 * names them with one sentence and invents nothing.
 */
export const TEAM_ROSTER_UNKNOWN = 'TEAM_ROSTER_UNKNOWN';

export type TeamRosterFailure = typeof TEAM_ROSTER_UNAVAILABLE | typeof TEAM_ROSTER_UNKNOWN;

/** One person on a roster: an id, a name, a rank and a position, and nothing else ever arrives. */
export interface TeamRosterMember {
  readonly id: string;
  readonly name: string;
  /**
   * The member's rank code (`0014`), or `null` for none. Wide rather than the
   * code union: the row may carry a code this build lacks, and the surface
   * shows that as "unknown rank" rather than refusing the roster. Returned
   * whatever the organization's setting says; the surface decides whether to
   * show it.
   */
  readonly fireRank: string | null;
  /**
   * The position in effect today (`0015`), or `null` for none. Wide for the
   * rank's reason, and returned whatever the setting says.
   */
  readonly position: string | null;
}

/** One team's roster today, members sorted by name. */
export interface TeamRoster {
  readonly name: string;
  readonly archived: boolean;
  readonly members: readonly TeamRosterMember[];
}

export type TeamRosterOutcome =
  | { readonly ok: true; readonly roster: TeamRoster }
  | { readonly ok: false; readonly code: TeamRosterFailure };

/** As much of a PostgREST error as this module reads. */
export interface TeamRosterReadFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface TeamRosterAnswer {
  readonly data: unknown;
  readonly error: TeamRosterReadFailure | null;
}

/** The one call the roster makes, named structurally so it can be stubbed. */
export interface TeamRosterRpc {
  rpc(fn: string, args: { readonly team: string }): PromiseLike<TeamRosterAnswer>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareMembers(first: TeamRosterMember, second: TeamRosterMember): number {
  // By name under the Croatian collation, then by id, so two people who share
  // a name sort the same way every time.
  return compareText(first.name, second.name) || compareText(first.id, second.id);
}

/**
 * One roster row as the surface sees it, or `null` — validated field by field,
 * so a malformed answer refuses the roster rather than rendering a blank. Only
 * `id`, `name`, `fire_rank` and `position` are carried off each member,
 * whatever else might arrive. `fire_rank` and `position` must be PRESENT, as
 * text or null: a member object without them is not a reading `0015` produces.
 */
export function teamRosterOf(row: unknown): TeamRoster | null {
  if (!isRecord(row)) return null;

  const name = row['name'];
  const archived = row['archived'];
  const members = row['members'];

  if (typeof name !== 'string' || typeof archived !== 'boolean') return null;
  if (!Array.isArray(members)) return null;

  const parsed: TeamRosterMember[] = [];

  for (const entry of members as readonly unknown[]) {
    if (!isRecord(entry)) return null;

    const id = entry['id'];
    const memberName = entry['name'];
    const fireRank = entry['fire_rank'];
    const position = entry['position'];

    if (typeof id !== 'string' || typeof memberName !== 'string') return null;
    if (fireRank !== null && typeof fireRank !== 'string') return null;
    if (position !== null && typeof position !== 'string') return null;

    parsed.push({ id, name: memberName, fireRank, position });
  }

  // The same person twice is not a roster any reading of `0011` produces.
  if (new Set(parsed.map((member) => member.id)).size !== parsed.length) return null;

  return { name, archived, members: parsed.sort(compareMembers) };
}

/** A UUID in its canonical textual shape, the only thing `team uuid` accepts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The roster of one team, or one stable code.
 *
 * UNKNOWN WITHOUT A CALL when the route's id is not a UUID: `team_roster`
 * takes a `uuid`, so `/smjene/abc` would be refused by Postgres as `22P02` and
 * shown as a retryable outage for a team that simply does not exist.
 *
 * Unknown on zero rows. Unavailable on a rejected call, an error, an answer
 * that is not an array, more than one row, or a row that does not validate.
 */
export async function readTeamRoster(client: TeamRosterRpc, id: string): Promise<TeamRosterOutcome> {
  if (!UUID.test(id)) return { ok: false, code: TEAM_ROSTER_UNKNOWN };

  let answered: TeamRosterAnswer;

  try {
    answered = await client.rpc(TEAM_ROSTER_FUNCTION, { team: id });
  } catch (cause) {
    console.error(TEAM_ROSTER_UNAVAILABLE, cause);

    return { ok: false, code: TEAM_ROSTER_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(TEAM_ROSTER_UNAVAILABLE, typeof answered);

    return { ok: false, code: TEAM_ROSTER_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(TEAM_ROSTER_UNAVAILABLE, answered.error.code);

    return { ok: false, code: TEAM_ROSTER_UNAVAILABLE };
  }

  const rows = answered.data;

  if (!Array.isArray(rows)) {
    console.error(TEAM_ROSTER_UNAVAILABLE, 'shape');

    return { ok: false, code: TEAM_ROSTER_UNAVAILABLE };
  }

  if (rows.length === 0) return { ok: false, code: TEAM_ROSTER_UNKNOWN };

  if (rows.length > 1) {
    console.error(TEAM_ROSTER_UNAVAILABLE, rows.length);

    return { ok: false, code: TEAM_ROSTER_UNAVAILABLE };
  }

  const roster = teamRosterOf(rows[0]);

  if (roster === null) {
    console.error(TEAM_ROSTER_UNAVAILABLE, 'row');

    return { ok: false, code: TEAM_ROSTER_UNAVAILABLE };
  }

  return { ok: true, roster };
}

/** The message a roster failure renders as. Exhaustive. */
export function teamRosterMessageKey(
  failure: TeamRosterFailure,
): 'smjene.error.unknown' | 'smjene.roster.error.unavailable' {
  if (failure === TEAM_ROSTER_UNKNOWN) return 'smjene.error.unknown';
  if (failure === TEAM_ROSTER_UNAVAILABLE) return 'smjene.roster.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

/** The query result a surface state is derived from. */
export interface RosterQueryAnswer<T> {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: T | undefined;
}

export interface TeamRosterSurfaceState {
  /** The roster to draw, or `null` when there is no answer to draw. */
  readonly roster: TeamRoster | null;
  readonly refusal: TeamRosterFailure | null;
  /** Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as what the roster screen shows — the four states
 * `teamsSurfaceStateOf` distinguishes: answered, failed, paused offline, and a
 * failed refetch over a good answer (roster kept, message beside it).
 */
export function teamRosterSurfaceStateOf(
  answer: RosterQueryAnswer<TeamRosterOutcome>,
): TeamRosterSurfaceState {
  const answered = answer.data;
  const roster = answered !== undefined && answered.ok ? answered.roster : null;
  const paused = answer.isPending && answer.fetchStatus === TEAM_ROSTER_FETCH_PAUSED;

  if (answered !== undefined && !answered.ok) {
    return { roster: null, refusal: answered.code, loading: false };
  }

  if (answer.isError || paused) {
    return { roster, refusal: TEAM_ROSTER_UNAVAILABLE, loading: false };
  }

  return { roster, refusal: null, loading: answer.isPending };
}

// ------------------------------------------------------ the caller's team today

/** The relation the caller's own row is read from. */
export const OWN_TEAM_TABLE = 'members';

/** The one query key Danas reads the caller's team under. */
export const OWN_TEAM_KEY = ['own-team'] as const;

/**
 * The caller's own row, carrying only what "team today" needs: the team
 * history with each team's name, and the organization's zone — the same embed
 * `MEMBERS_COLUMNS` names, position included (`0015`), so one parser reads
 * both.
 */
export const OWN_TEAM_COLUMNS =
  'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)';

const AUTH_USER_COLUMN = 'auth_user_id';
const EQUALS = 'eq';
const ONE_ROW = 1;

/** The caller's own row could not be read, or cannot be trusted as one. */
export const OWN_TEAM_UNAVAILABLE = 'OWN_TEAM_UNAVAILABLE';

export type OwnTeamFailure = typeof OWN_TEAM_UNAVAILABLE;

/** What the own-row read answers: the history and the zone to read it in. */
export interface OwnTeamSnapshot {
  readonly teamVersions: readonly MemberTeamVersion[];
  readonly timeZone: string;
}

export type OwnTeamOutcome =
  | { readonly ok: true; readonly snapshot: OwnTeamSnapshot }
  | { readonly ok: false; readonly code: OwnTeamFailure };

export interface OwnTeamAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: TeamRosterReadFailure | null;
}

export interface OwnTeamRowsFilter {
  limit(count: number): PromiseLike<OwnTeamAnswer>;
}

export interface OwnTeamSelectFilter {
  filter(column: string, operator: string, value: string): OwnTeamRowsFilter;
}

/** The one call Danas makes, named structurally so it can be stubbed. */
export interface OwnTeamTable {
  select(columns: string): OwnTeamSelectFilter;
}

/** One own row as a snapshot, or `null` if it does not validate. */
export function ownTeamSnapshotOf(row: unknown): OwnTeamSnapshot | null {
  if (!isRecord(row)) return null;

  const teamVersions = teamVersionsIn(row);
  const organization = row['organizations'];
  const timeZone = isRecord(organization) ? organization['timezone'] : null;

  if (teamVersions === null || typeof timeZone !== 'string') return null;

  return { teamVersions, timeZone };
}

/**
 * The caller's own row, filtered by `auth_user_id` as `@/navigation/role` does
 * rather than trusting the policy to return one row: `limit(2)` and the extra
 * row is the assertion.
 *
 * Unavailable on no session, a rejected call, an error, zero or two rows, or a
 * row that does not validate. Never a guess.
 */
export async function readOwnTeamToday(
  table: OwnTeamTable,
  session: () => Promise<Session | null>,
): Promise<OwnTeamOutcome> {
  let current: Session | null;

  try {
    current = await session();
  } catch (cause) {
    console.error(OWN_TEAM_UNAVAILABLE, cause);

    return { ok: false, code: OWN_TEAM_UNAVAILABLE };
  }

  if (current === null) return { ok: false, code: OWN_TEAM_UNAVAILABLE };

  let answered: OwnTeamAnswer;

  try {
    answered = await table
      .select(OWN_TEAM_COLUMNS)
      .filter(AUTH_USER_COLUMN, EQUALS, current.user.id)
      .limit(ONE_ROW + 1);
  } catch (cause) {
    console.error(OWN_TEAM_UNAVAILABLE, cause);

    return { ok: false, code: OWN_TEAM_UNAVAILABLE };
  }

  if (!isRecord(answered)) {
    console.error(OWN_TEAM_UNAVAILABLE, typeof answered);

    return { ok: false, code: OWN_TEAM_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(OWN_TEAM_UNAVAILABLE, answered.error.code);

    return { ok: false, code: OWN_TEAM_UNAVAILABLE };
  }

  const rows = answered.data ?? [];

  if (rows.length !== ONE_ROW) {
    console.error(OWN_TEAM_UNAVAILABLE, rows.length);

    return { ok: false, code: OWN_TEAM_UNAVAILABLE };
  }

  const snapshot = ownTeamSnapshotOf(rows[0]);

  if (snapshot === null) {
    console.error(OWN_TEAM_UNAVAILABLE, 'row');

    return { ok: false, code: OWN_TEAM_UNAVAILABLE };
  }

  return { ok: true, snapshot };
}

/**
 * The caller's team as at the ORGANIZATION's today (L8), through the same
 * derivation the member list uses. `null` is no team.
 */
export function ownTeamTodayOf(snapshot: OwnTeamSnapshot, now: Date): MemberTeam | null {
  return memberTeamOn(snapshot, organizationIsoDate(now, snapshot.timeZone));
}

/** The line Danas renders: the caller's team today, or none. */
export interface OwnTeamLine {
  readonly team: MemberTeam | null;
}

/** The team today as a line. */
export function ownTeamLineOf(team: MemberTeam | null): OwnTeamLine {
  return { team };
}

/**
 * The words the line opens with: "Tvoja smjena" beside the team's name, or the
 * positive no-team words the member list uses — never a blank, which would say
 * nothing at all.
 */
export function ownTeamLineMessageKey(
  line: OwnTeamLine,
): 'smjene.today.label' | 'smjene.membership.none' {
  return line.team === null ? 'smjene.membership.none' : 'smjene.today.label';
}

/** The message an own-row failure renders as. Exhaustive. */
export function ownTeamMessageKey(failure: OwnTeamFailure): 'smjene.today.error.unavailable' {
  if (failure === OWN_TEAM_UNAVAILABLE) return 'smjene.today.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

export interface OwnTeamSurfaceState {
  /** The line to draw, or `null` while there is none to draw. */
  readonly line: OwnTeamLine | null;
  readonly refusal: OwnTeamFailure | null;
  readonly loading: boolean;
}

/** One query result as what Danas shows, by `teamRosterSurfaceStateOf`'s rules. */
export function ownTeamSurfaceStateOf(
  answer: RosterQueryAnswer<OwnTeamOutcome>,
  now: Date,
): OwnTeamSurfaceState {
  const answered = answer.data;
  const line =
    answered !== undefined && answered.ok ? ownTeamLineOf(ownTeamTodayOf(answered.snapshot, now)) : null;
  const paused = answer.isPending && answer.fetchStatus === TEAM_ROSTER_FETCH_PAUSED;

  if (answered !== undefined && !answered.ok) {
    return { line: null, refusal: answered.code, loading: false };
  }

  if (answer.isError || paused) {
    return { line, refusal: OWN_TEAM_UNAVAILABLE, loading: false };
  }

  return { line, refusal: null, loading: answer.isPending };
}
