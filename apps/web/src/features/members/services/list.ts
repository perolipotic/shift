import { queryOptions } from '@tanstack/react-query';

import { initialsOf } from '@/utils/initials';
import { compareText, formatIsoDate, formatIsoDayMonth, isIsoDate, organizationIsoDate } from '@/lib/i18n/format';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLES, type MemberRoleOutcome } from '@/features/navigation/services/role';

/**
 * The member list: one organization's people, read once and narrowed in memory
 * (story 1.5a).
 *
 * EVERYTHING THE SCREEN DECIDES IS HERE, and that is the decision this module
 * exists to hold rather than a tidiness. `pages/ljudi.tsx` is a `.tsx`, and
 * AD-15 collects none of those — so a comparator, a sort toggle, a level
 * fallback or a count written there is executed by no test in this repository
 * and can only be asserted by reading its own source text. The 1.5a review
 * demonstrated what that costs: swapping the sort keys on two headers left the
 * suite green. So the screen holds markup and state, and every rule it applies
 * is a pure function below.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13), the shape `@/features/organization/services/snapshot`
 * established: {@link MEMBERS_LIST_KEY} is the only key this surface reads
 * under, and every figure on it — the rows, the stated count, the per-level
 * counts beside the filter — is DERIVED from that one answer by
 * {@link narrowMembers}. Independent keys are precisely what put a stale total
 * beside a fresh list.
 *
 * THE TABLE IS A PARAMETER, never an import, exactly as `@/features/navigation/services/role`'s
 * is. That is what makes every row of the story's I/O matrix executable from the
 * node suite against a stub — no browser, no stack, no environment — and the
 * interfaces below are structural and narrow on purpose, so
 * `supabaseClient().from(MEMBERS_TABLE)` satisfies them and a stub does not have
 * to impersonate the rest of PostgREST.
 *
 * WHAT THIS MODULE DOES NOT DO is write. Creating a member, editing one and
 * resetting a member's password are all `@/features/members/services/write`, which owns the
 * PostgREST edit, the privileged calls and the branch between them, and
 * deactivating one (story 1.6), which is a PostgREST insert of a status
 * version. Nothing here posts, patches or deletes, and the seam below names `select`
 * alone so a write cannot be added without widening the interface in front of a
 * reviewer.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — {@link membersMessageKey} is that edge, and it lives here
 * for the same reason the comparators do.
 */

/**
 * The relation this module reads.
 *
 * IMPORTED FROM `@/features/navigation/services/role` rather than re-declared, because two
 * spellings of one table name is exactly the drift a renamed relation would
 * produce: one read would move and the other would 404 at runtime with nothing
 * in the type system to say so.
 */
export { MEMBERS_TABLE } from '@/features/navigation/services/role';

/**
 * The single query key this surface reads under.
 *
 * A CONSTANT rather than an inline array, for the reason
 * `ORGANIZATION_SNAPSHOT_KEY` is one: two call sites writing `['members']` by
 * hand are two keys the moment one of them gains a qualifier, and AD-13's
 * failure mode is a screen reading the same thing twice under keys that drifted
 * apart.
 *
 * DISTINCT FROM `MEMBER_ROLE_KEY`, which the chrome reads. That one is a single
 * column of a single row — the caller's own level — and this is the whole list;
 * caching the list under the chrome's key would make every navigation in the
 * application refetch several hundred rows for one word.
 */
export const MEMBERS_LIST_KEY = ['members'] as const;

/**
 * The columns this read selects, in one place.
 *
 * FIVE RENDERABLE FIELDS AND TWO THAT ARE NOT. `name`, `email`, `role` and
 * `leave_allowance_days` are what the table shows; `id` is what React keys a row
 * by. `organization_id` renders nowhere and is selected anyway — see
 * {@link readMembers}, which fails closed when an answer spans more than one
 * organization. A column removed from this list is a tripwire removed.
 *
 * `username` IS SELECTED AND NO COLUMN SHOWS IT, and that is a decision rather
 * than an oversight. `0007` gave it to `members` so the application can read
 * the credential an admin issued at all — it exists nowhere else this tree can
 * reach, because `auth.users` is not exposed through PostgREST — and story
 * 1.5b's edit form is what has to seed a field with it. Putting it in
 * {@link MEMBER_COLUMNS} would be a FIFTH heading, which the block there argues
 * is a later story's work arriving without that story's review, and it would
 * widen the search's pinned "name and address and nothing else" claim in the
 * same commit. The list reads it; the edit form renders it.
 *
 * STORY 1.6 ADDS TWO. `auth_user_id` is what lets the edit screen recognise
 * the caller's OWN row — the one row the deactivation control is never offered
 * on — by comparing it with the session's subject. And the member's status
 * versions are EMBEDDED rather than read by a second query (AD-13): one answer
 * carries every member and every version, so the list's inactive marker and
 * the edit screen's status line are derived from the same snapshot. Active
 * state is versioned (AD-2), so there is no active column to select; what
 * arrives is the history, and {@link memberActiveOn} reads it as at a date.
 * The organization's TIMEZONE is embedded for the same reason: "as at today"
 * means the organization's today (L8), and reading the zone from a second
 * query would put two reads behind one figure.
 *
 * `created_at` is not here, and neither is anything else: `members` carries no
 * health data and no absence-reason field (Q5), and this list is where that
 * claim is made concrete enough for `features/members/services/list.test.ts` to assert it.
 *
 * STORY 1.7b EMBEDS THE TEAM HISTORY the same way the status history is, and
 * for the same reasons: membership is versioned (AD-2), so there is no
 * `team_id` on `members` to select, and the list's team column and the edit
 * screen's team block are derived from this one answer (AD-13). Each version
 * carries its team's NAME through the nested `teams(name)` embed, so the list
 * stays at one query; {@link memberTeamOn} reads the history as at a date.
 *
 * MEMBER RANK ADDS `fire_rank` (`0014`), read and never shown by the table: a
 * rank column on the list is an Ask First. The edit form seeds its rank
 * control from it.
 *
 * TEAM POSITION ADDS `position` to each membership version (`0015`): the
 * position is versioned with the team, so it arrives in the same embed and
 * the edit screen's team block reads both off one history.
 */
export const MEMBERS_COLUMNS =
  'organization_id,id,auth_user_id,name,username,email,role,leave_allowance_days,fire_rank,' +
  'member_status_versions(active,effective_from),' +
  'team_membership_versions(team_id,position,effective_from,teams(name)),organizations(timezone)';

/**
 * The exact count the transport is asked for alongside the rows.
 *
 * `supabase/config.toml:15` caps PostgREST at `max_rows = 1000`, and nothing in
 * this application reads `Content-Range` or paginates — so an answer truncated
 * at that ceiling is byte-indistinguishable from a complete one, and the surface
 * would render a short list under a confidently wrong total. `'exact'` is what
 * makes the difference observable: the count is the organization's real size and
 * the rows are what arrived, so {@link readMembers} can refuse when they
 * disagree rather than fail open.
 *
 * `'exact'` and not `'planned'` or `'estimated'`, which answer from the planner
 * and from statistics respectively: both are approximations, and an
 * approximation compared against a row count produces a refusal on a correct
 * answer roughly as often as it catches a wrong one.
 */
export const MEMBERS_COUNT: MembersCountOptions = { count: 'exact' };

/**
 * The empty string, NAMED.
 *
 * `pages/ljudi.tsx` may hold no string literal of its own — `prijava.test.ts`
 * sweeps every screen for a literal that is neither a `t()` key nor a
 * structural attribute value, and an empty one is still one. Two things on that
 * surface are nothing at all: the search a freshly opened list carries, and the
 * cell of a member with no address. Both are this.
 */
export const NO_TEXT = '';

/** The id of the list's refusal notice, which the search and the chips point at while it is shown. */
export const MEMBERS_ERROR_ID = 'ljudi-error';

/** Ljudi's `h1` (story 7.13b): where focus lands when the add dialog closes and no button opened it. */
export const MEMBERS_PAGE_HEADING_ID = 'ljudi-heading';

/**
 * TanStack Query's own name for a fetch it has NOT started.
 *
 * A paused query is not a failed one and not a slow one: the browser reports
 * itself offline, so `isPending` stays true with nothing in flight and no error
 * ever arriving. The surface has to tell the two apart or it pulses a skeleton
 * forever, and the literal lives here for the reason {@link NO_TEXT} does.
 */
export const FETCH_PAUSED = 'paused';

/**
 * How long the member list may be served from cache, in milliseconds.
 *
 * Here rather than at the call site because this read is the most expensive one
 * in the application: several hundred rows AND an exact count, which costs the
 * database a second pass over the same index. Unbounded, TanStack Query treats
 * every mount and every window focus as a reason to re-run it — so an admin who
 * alt-tabs to their mail and back re-reads the whole organization for a list
 * that has not changed.
 *
 * Five minutes, the same bound `ORGANIZATION_READ_STALE_MS` sets and for the
 * same reason: long enough that returning to the tab is free, short enough that
 * a member added on another device shows up without a reload. It is a FLOOR on
 * staleness rather than a cache — the write half of story 1.5 will invalidate
 * this key explicitly, so a change made here will show up immediately and this
 * bound governs only changes made somewhere else.
 */
export const MEMBERS_READ_STALE_MS = 300000;

/** This session reaches no member row at all — the policy refused, silently. */
export const MEMBERS_REFUSED = 'MEMBERS_REFUSED';
/** The list could not be read, or what came back cannot be trusted as one. */
export const MEMBERS_UNAVAILABLE = 'MEMBERS_UNAVAILABLE';

export type MembersFailure = typeof MEMBERS_REFUSED | typeof MEMBERS_UNAVAILABLE;

export type MembersOutcome =
  | { readonly ok: true; readonly members: readonly MemberListRow[] }
  | { readonly ok: false; readonly code: MembersFailure };

/** As much of a PostgREST error as this module reads — whether there is one. */
export interface PostgrestFailure {
  // `| undefined` on every member, for the reason `@/features/navigation/services/role`'s
  // identical interface records: `exactOptionalPropertyTypes` is on and
  // postgrest-js declares these as present-and-possibly-undefined.
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/** The options the read passes. See {@link MEMBERS_COUNT}. */
export interface MembersCountOptions {
  readonly count: 'exact';
}

/** What the one call below resolves to, count included. */
export interface MembersAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: PostgrestFailure | null;
  /** The organization's real size, or `null` where the transport withheld it. */
  readonly count: number | null;
}

/**
 * The one call this module makes, named structurally so it can be stubbed.
 *
 * `select` AND NOTHING ELSE — no `insert`, no `update`, no `delete`. The seam is
 * the shape of the permission: this story renders rows it does not write, and a
 * writing verb added here is a diff a reviewer sees rather than a call buried in
 * a handler.
 *
 * ONE LINK DEEP, unlike `@/features/navigation/services/role`'s three: there is no filter, because
 * the policy is the filter (`members_select_own_organization`, `0003:289-300`)
 * and a client-side `organization_id` filter would be the application asserting
 * an isolation it cannot enforce. No `limit` either — the whole organization is
 * the answer, and {@link MEMBERS_COUNT} is how a truncated one is caught.
 */
export interface MembersTable {
  select(columns: string, options: MembersCountOptions): PromiseLike<MembersAnswer>;
}

/**
 * One member, as the surface sees them.
 *
 * `camelCase` against the database's `snake_case`, which is the conventions'
 * rule and also the seam: {@link memberListRowOf} is the one place the two
 * spellings meet, so a renamed column is one edit rather than a search.
 *
 * `email` is `string | null` because the column is nullable by requirement
 * (`0002:135`) — a member with no address is still a member, and the synthesized
 * sign-in address (AD-12) is never this one.
 */
export interface MemberListRow {
  readonly id: string;
  /** Selected, never rendered. See {@link readMembers}. */
  readonly organizationId: string;
  readonly name: string;
  /**
   * The credential this member signs in with (`0007`).
   *
   * `string` and never `string | null`: the column is `not null`, and a member
   * whose username could not be read is a member whose sign-in identity the
   * edit form would then write a blank over. Selected by this read and rendered
   * by the edit form rather than by the table — see {@link MEMBERS_COLUMNS}.
   */
  readonly username: string;
  readonly email: string | null;
  readonly role: MemberRole;
  readonly leaveAllowanceDays: number;
  /**
   * The member's rank code (`0014`), or `null` for none. Wide rather than the
   * code union, because a row may carry a code this build lacks; the edit form
   * shows that as "unknown rank" rather than refusing the row.
   */
  readonly fireRank: string | null;
  /**
   * The account this member signs in with (`members.auth_user_id`). Rendered
   * nowhere; the edit screen compares it with the session's subject so the
   * deactivation control is never offered on the caller's own row.
   */
  readonly authUserId: string;
  /**
   * Every status version this member has, oldest first (story 1.6). Empty for
   * a member who was never deactivated, which reads as active.
   */
  readonly statusVersions: readonly MemberStatusVersion[];
  /**
   * Every team membership version this member has, oldest first (story 1.7b).
   * Empty for a member never put on a team, which reads as no team.
   */
  readonly teamVersions: readonly MemberTeamVersion[];
  /**
   * The member's organization's zone, embedded in the same read, so "today"
   * for the marker and the date control is the organization's and never the
   * device's (L8). Every row carries the same one — {@link readMembers} refuses
   * an answer spanning two organizations.
   */
  readonly timeZone: string;
}

/**
 * One status version as the surface sees it (`0008`). A version is never
 * edited, so this is history rather than state: the state as at a date is
 * {@link memberActiveOn}'s reading of it.
 */
export interface MemberStatusVersion {
  readonly active: boolean;
  /** An ISO calendar date, `YYYY-MM-DD`, in the organization's own frame. */
  readonly effectiveFrom: string;
}

/** A team as the member screens name it: its id, and its name. */
export interface MemberTeam {
  readonly id: string;
  readonly name: string;
}

/**
 * One team membership version as the surface sees it (`0010`). `team` is
 * `null` for a version that says "no team from this date".
 */
export interface MemberTeamVersion {
  readonly team: MemberTeam | null;
  /**
   * The position code (`0015`), or `null` for none — a version written while
   * the organization did not use positions, or one naming no team. Wide
   * rather than the code union: a code this build lacks is kept as it is and
   * shown as "unknown position" (`@/features/members/utils/position`).
   */
  readonly position: string | null;
  /** An ISO calendar date, `YYYY-MM-DD`, in the organization's own frame. */
  readonly effectiveFrom: string;
}

/** Oldest first. ISO dates order as strings. */
function byEffectiveFrom<T extends { readonly effectiveFrom: string }>(first: T, second: T): number {
  return first.effectiveFrom < second.effectiveFrom
    ? -1
    : first.effectiveFrom > second.effectiveFrom
      ? 1
      : 0;
}

/**
 * The team versions a row carries, oldest first, or `null` if any of them is
 * not one.
 *
 * A MALFORMED VERSION REFUSES THE ROW, for the reason a malformed status
 * version does: a dropped move reads as the member still on their old team.
 * A version naming a team whose name did not arrive is malformed too — the
 * list would otherwise say "no team" about somebody who is on one.
 *
 * EXPORTED FOR STORY 1.8: `@/features/teams/services/roster` reads the caller's own row with the
 * same embed, so Danas and the list derive "team today" through one parser.
 */
export function teamVersionsIn(row: Record<string, unknown>): MemberTeamVersion[] | null {
  const value = row['team_membership_versions'];

  if (!Array.isArray(value)) return null;

  const versions: MemberTeamVersion[] = [];

  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;

    const fields = entry as Record<string, unknown>;
    const teamId = fields['team_id'];
    const position = fields['position'];
    const effectiveFrom = fields['effective_from'];
    const team = fields['teams'];

    if (typeof effectiveFrom !== 'string' || !isIsoDate(effectiveFrom)) return null;
    // PRESENT, as text or null: a version without it is not a reading `0015`
    // produces. An unknown code is kept as it is, never refused or dropped.
    if (position !== null && typeof position !== 'string') return null;

    if (teamId === null) {
      versions.push({ team: null, position, effectiveFrom });
      continue;
    }

    if (typeof teamId !== 'string') return null;
    if (typeof team !== 'object' || team === null || Array.isArray(team)) return null;

    const name = (team as Record<string, unknown>)['name'];

    if (typeof name !== 'string') return null;

    versions.push({ team: { id: teamId, name }, position, effectiveFrom });
  }

  return versions.sort(byEffectiveFrom);
}

/**
 * The team a member is on at a date: the version with the greatest
 * `effectiveFrom` on or before it, and no team when there is none.
 *
 * THE SAME READING `0010`'s `member_team_on` makes, and `test/rls-isolation`
 * asserts that one over the same history `features/members/services/list.test.ts` asserts this
 * one over.
 */
export function memberTeamOn(
  member: Pick<MemberListRow, 'teamVersions'>,
  day: string,
): MemberTeam | null {
  let team: MemberTeam | null = null;

  for (const version of member.teamVersions) {
    if (version.effectiveFrom <= day) team = version.team;
  }

  return team;
}

/**
 * The membership version in effect at a date — team AND position — or `null`
 * when there is none. The SPA's twin of `0015`'s `member_team_version_on`, and
 * {@link memberTeamOn} is its team.
 */
export function memberTeamVersionOn(
  member: Pick<MemberListRow, 'teamVersions'>,
  day: string,
): MemberTeamVersion | null {
  let found: MemberTeamVersion | null = null;

  for (const version of member.teamVersions) {
    if (version.effectiveFrom <= day) found = version;
  }

  return found;
}

/** A member's latest team version, or `null` for a member who has none. */
export function memberTeamLatestVersion(member: MemberListRow): MemberTeamVersion | null {
  return member.teamVersions[member.teamVersions.length - 1] ?? null;
}

/**
 * A member's team as at the organization's today, and the move scheduled after
 * it. AT MOST ONE IS SCHEDULED, for the reason {@link MemberStatus} gives:
 * `0010` admits a version only while the latest one is in effect.
 */
export interface MemberTeamState {
  /** The team today, or `null` for no team. */
  readonly team: MemberTeam | null;
  /** The latest version when it is dated after today, or `null`. */
  readonly scheduled: {
    readonly team: MemberTeam | null;
    readonly from: string;
  } | null;
}

/**
 * The team cell as at `today`: today's team, and the change dated after it
 * (design refresh C) — the same state the member screen states in words.
 */
export function teamCellOf(member: MemberListRow, today: string): MemberCell {
  const state = memberTeamOf(member, today);

  return {
    kind: TEAM_CELL,
    team: state.team?.name ?? null,
    scheduled:
      state.scheduled === null
        ? null
        : {
            team: state.scheduled.team?.name ?? null,
            from: state.scheduled.from,
            keepsTeam: state.scheduled.team !== null && state.scheduled.team.id === state.team?.id,
          },
  };
}

export function memberTeamOf(member: MemberListRow, today: string): MemberTeamState {
  const latest = memberTeamLatestVersion(member);

  return {
    team: memberTeamOn(member, today),
    scheduled:
      latest !== null && latest.effectiveFrom > today
        ? { team: latest.team, from: latest.effectiveFrom }
        : null,
  };
}

/**
 * The versions a row carries, oldest first, or `null` if any of them is not
 * one.
 *
 * A MALFORMED VERSION REFUSES THE ROW rather than being dropped: a dropped
 * deactivation reads as an active member, which is the one wrong answer this
 * reading must never give silently.
 */
function statusVersionsIn(row: Record<string, unknown>): MemberStatusVersion[] | null {
  const value = row['member_status_versions'];

  if (!Array.isArray(value)) return null;

  const versions: MemberStatusVersion[] = [];

  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;

    const fields = entry as Record<string, unknown>;
    const active = fields['active'];
    const effectiveFrom = fields['effective_from'];

    if (typeof active !== 'boolean') return null;
    // THE ONE VALIDATOR (`@/lib/i18n/format`), so an impossible date refuses the
    // row here exactly as it refuses an entered date on the edit screen.
    if (typeof effectiveFrom !== 'string' || !isIsoDate(effectiveFrom)) return null;

    versions.push({ active, effectiveFrom });
  }

  return versions.sort(byEffectiveFrom);
}

/**
 * Whether a member is active on a date: the version with the greatest
 * `effectiveFrom` on or before it, and active when there is none.
 *
 * THE SAME READING `0008`'s `member_active_on` makes, and it has to be: the
 * list's marker and the database's refusal of a sign-in are one fact, and two
 * readings of it are how a person shown as active is locked out.
 */
export function memberActiveOn(member: MemberListRow, day: string): boolean {
  let active = true;

  for (const version of member.statusVersions) {
    if (version.effectiveFrom <= day) active = version.active;
  }

  return active;
}

/**
 * The organization's today as an ISO date, read off the list itself, or `null`
 * while there is no row to read it from.
 *
 * NEVER THE DEVICE'S DATE (L8), and never a second query (AD-13): the zone
 * arrives embedded in the one list read. `null` is the honest answer before
 * that read has settled, and every caller has a case for it — no marker on the
 * list and no deactivation offered on the edit screen, rather than either one
 * resting on a guess.
 */
export function membersTodayOf(members: readonly MemberListRow[] | null, now: Date): string | null {
  const first = members?.[0];

  return first === undefined ? null : organizationIsoDate(now, first.timeZone);
}

/**
 * Whether a member is active on EVERY date from `day` onward: active on it,
 * and no deactivation dated after it. The reading `0008`'s never-zero-admins
 * rule makes (`member_active_from`), so the surface names the last-admin
 * refusal for exactly the writes the database refuses for that reason.
 */
export function memberActiveFrom(member: MemberListRow, day: string): boolean {
  return (
    memberActiveOn(member, day) &&
    !member.statusVersions.some((version) => version.effectiveFrom > day && !version.active)
  );
}

/**
 * An ISO date the way the screens show one — `23.09.2026` — or the value
 * unchanged if it is not a real calendar date, so a malformed value is still
 * visibly the value that was entered rather than a blank.
 */
export function shownDate(isoDate: string): string {
  return formatIsoDate(isoDate) ?? isoDate;
}

/** A member's latest version, or `null` for a member who has none. */
export function memberLatestVersion(member: MemberListRow): MemberStatusVersion | null {
  return member.statusVersions[member.statusVersions.length - 1] ?? null;
}

/**
 * A member's status as at the organization's today, and the change scheduled
 * after it.
 *
 * AT MOST ONE CHANGE IS SCHEDULED. `0008` admits a new version only while the
 * member's latest one is already in effect, so the latest version is the only
 * one that can be dated after today — and when it is, it is the scheduled
 * change. `scheduled` is exactly that: the latest version, when it is dated
 * after today.
 */
export interface MemberStatus {
  readonly activeToday: boolean;
  /**
   * The date the version in effect today took effect, when there is one —
   * what "inactive since" names. `null` for a member no version has touched
   * yet.
   */
  readonly since: string | null;
  /** The latest version when it is dated after today, or `null`. */
  readonly scheduled: MemberStatusVersion | null;
}

export function memberStatusOf(member: MemberListRow, today: string): MemberStatus {
  let since: string | null = null;

  for (const version of member.statusVersions) {
    if (version.effectiveFrom <= today) since = version.effectiveFrom;
  }

  const latest = memberLatestVersion(member);

  return {
    activeToday: memberActiveOn(member, today),
    since,
    scheduled: latest !== null && latest.effectiveFrom > today ? latest : null,
  };
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

function numberAt(row: Record<string, unknown>, column: string): number | null {
  const value = row[column];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The permission level a value IS, or `null` if it is not one.
 *
 * A GUARD, never a cast, exactly as `@/features/navigation/services/role`'s is — and here the
 * stakes are a whole column rather than one row: `row.role as MemberRole` would
 * let `'supervisor'` through, and the level column would then render whatever
 * an inexhaustive label mapping happened to return for it. `null` is what makes
 * "the application does not recognise this" a case the caller has to handle.
 */
function memberRoleIn(row: Record<string, unknown>): MemberRole | null {
  const value = row['role'];

  return MEMBER_ROLES.find((known) => known === value) ?? null;
}

/** What a row that is not a row at all is reported as. */
export const NOT_A_ROW = 'row';

/**
 * A row that did not validate: WHICH COLUMN was wrong, and which row it was.
 *
 * NAMES RATHER THAN VALUES, and that is a privacy decision rather than a
 * tidiness one. This module used to log the offending ROW, which on this table
 * is a person's name and their email address — the one log in the whole surface
 * that emitted personal data, on a screen whose entire justification is that
 * those addresses are sensitive enough to guard with a route. A column name and
 * a row id are what somebody debugging actually needs, and neither identifies
 * anybody to whoever reads the console.
 */
export interface MalformedRow {
  /** The column that failed, or {@link NOT_A_ROW} for something that is not one. */
  readonly field: string;
  /** The row's own id where it had a usable one, `null` otherwise. Never a name. */
  readonly id: string | null;
}

export type RowOutcome =
  | { readonly ok: true; readonly member: MemberListRow }
  | { readonly ok: false; readonly malformed: MalformedRow };

/**
 * One PostgREST row as a member, or the name of the column that was wrong.
 *
 * VALIDATED FIELD BY FIELD rather than cast, for the reason
 * `organizationSnapshotOf` is: a cast makes `member.name` a `string` the type
 * system believes in and the runtime may not, and an `undefined` name reaching
 * the collator throws inside a sort over several hundred rows — which takes the
 * screen down rather than degrading. Every required column is checked; `email`
 * is admitted as `null`, which is what the column actually is.
 *
 * The FIRST failing column is reported and the rest are not checked: a row is
 * refused whole either way, and the first name is the one that points at the
 * migration or the proxy that caused it.
 */
export function memberRowOutcomeOf(row: unknown): RowOutcome {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return { ok: false, malformed: { field: NOT_A_ROW, id: null } };
  }

  const fields = row as Record<string, unknown>;

  const id = textAt(fields, 'id');
  const organizationId = textAt(fields, 'organization_id');
  const name = textAt(fields, 'name');
  const username = textAt(fields, 'username');
  const role = memberRoleIn(fields);
  const leaveAllowanceDays = numberAt(fields, 'leave_allowance_days');

  if (id === null) return { ok: false, malformed: { field: 'id', id: null } };
  if (organizationId === null) {
    return { ok: false, malformed: { field: 'organization_id', id } };
  }
  if (name === null) return { ok: false, malformed: { field: 'name', id } };
  // REQUIRED, because `0007` makes the column `not null`. Admitting a missing
  // one as the empty string would seed the edit form with a blank username and
  // save it back over a working sign-in identity.
  if (username === null) return { ok: false, malformed: { field: 'username', id } };
  if (role === null) return { ok: false, malformed: { field: 'role', id } };
  if (leaveAllowanceDays === null) {
    return { ok: false, malformed: { field: 'leave_allowance_days', id } };
  }

  const authUserId = textAt(fields, 'auth_user_id');

  if (authUserId === null) return { ok: false, malformed: { field: 'auth_user_id', id } };

  // MEMBER RANK. Text or null, and nothing else: a rank that is neither is a
  // row this build cannot trust, never "no rank" — which the edit form would
  // then write back over whatever the column holds.
  const fireRank = fields['fire_rank'];

  if (fireRank !== null && typeof fireRank !== 'string') {
    return { ok: false, malformed: { field: 'fire_rank', id } };
  }

  const statusVersions = statusVersionsIn(fields);

  if (statusVersions === null) {
    return { ok: false, malformed: { field: 'member_status_versions', id } };
  }

  const teamVersions = teamVersionsIn(fields);

  if (teamVersions === null) {
    return { ok: false, malformed: { field: 'team_membership_versions', id } };
  }

  const organization = fields['organizations'];
  const timeZone =
    typeof organization === 'object' && organization !== null && !Array.isArray(organization)
      ? textAt(organization as Record<string, unknown>, 'timezone')
      : null;

  if (timeZone === null) return { ok: false, malformed: { field: 'organizations', id } };

  return {
    ok: true,
    member: {
      id,
      organizationId,
      name,
      username,
      email: textAt(fields, 'email'),
      role,
      leaveAllowanceDays,
      fireRank,
      authUserId,
      statusVersions,
      teamVersions,
      timeZone,
    },
  };
}

/** The same validation as a nullable value, which is what most callers want. */
export function memberListRowOf(row: unknown): MemberListRow | null {
  const outcome = memberRowOutcomeOf(row);

  return outcome.ok ? outcome.member : null;
}

/**
 * Every member this session reaches, or one stable code.
 *
 * FOUR WAYS TO FAIL, and the order they are checked in is the argument.
 *
 *   - AN ERROR IS NEVER A REFUSAL on this table. Row level security refuses by
 *     failing USING: the statement matches nothing and raises nothing. So an
 *     `error` that reached here is a transport or a schema fault, and reporting
 *     it as "you have no access" would send an entitled admin to ask for rights
 *     they already hold, over a renamed column.
 *   - NO ROW IS THE POLICY'S SILENT REFUSAL, and it is reported as one rather
 *     than rendered as an empty table. An organization always has at least the
 *     caller in it, so zero rows means the session reaches nothing — a
 *     deactivated account, a missing claim — and an empty table under a
 *     confident "0" would say the organization has no people in it.
 *   - A TRUNCATED ANSWER IS UNAVAILABLE. `max_rows = 1000` caps what PostgREST
 *     returns and nothing here paginates, so fewer rows than the exact count
 *     claims is a SHORT LIST THAT LOOKS COMPLETE — the one failure this module
 *     would otherwise commit silently, and the reason the count is asked for at
 *     all. Refusing is the only honest answer: the surface cannot show a list it
 *     did not receive, and showing part of one under the whole organization's
 *     count is worse than showing none.
 *   - AN ANSWER SPANNING TWO ORGANIZATIONS IS UNAVAILABLE. That is the shape a
 *     widened `members_select_own_organization` produces, and it is why
 *     `organization_id` is selected though nothing renders it. It is a CLIENT-
 *     SIDE TRIPWIRE, not a boundary: AD-10 puts isolation in the database, and
 *     proving each row is the CALLER's own would need the caller's organization
 *     from a second source this surface is not permitted to read. What it does
 *     prove is that the answer describes one organization, which is the failure
 *     a loosened policy actually produces.
 *
 * A row that does not validate is UNAVAILABLE and never dropped: a list quietly
 * missing the member whose row was malformed is a wrong answer presented as a
 * right one, which is the same fail-open the truncation check refuses.
 */
export async function readMembers(table: MembersTable): Promise<MembersOutcome> {
  let answered;

  try {
    answered = await table.select(MEMBERS_COLUMNS, MEMBERS_COUNT);
  } catch (cause) {
    // A rejected promise is the transport failing outside postgrest-js's own
    // error mapping — a blocked request, an aborted navigation, a DNS failure,
    // or `SUPABASE_ENVIRONMENT_MISSING` from a build with no environment.
    // LOGGED WITH ITS CAUSE: a discarded cause is a surface that reports "try
    // again" forever with nothing anywhere to say what is actually wrong.
    console.error(MEMBERS_UNAVAILABLE, cause);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  // AN ANSWER THAT IS NOT AN ANSWER. `table.select` is a seam, and a seam can
  // resolve to anything — a proxy returning a string, a stub written wrong, a
  // transport that answered 200 with a body that is not JSON. Reading `.error`
  // off it would THROW out of a function whose whole contract is that it returns
  // a code rather than throwing, and the throw would surface as an unhandled
  // rejection inside TanStack Query rather than as this surface's own message.
  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(MEMBERS_UNAVAILABLE, typeof answered);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(MEMBERS_UNAVAILABLE, answered.error);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  const rows = answered.data ?? [];

  if (rows.length === 0) return { ok: false, code: MEMBERS_REFUSED };

  const total = answered.count;

  if (total !== null && total > rows.length) {
    // The count is the whole diagnosis: how many the organization has against
    // how many arrived.
    console.error(MEMBERS_UNAVAILABLE, total, rows.length);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  const members: MemberListRow[] = [];

  for (const row of rows) {
    const outcome = memberRowOutcomeOf(row);

    if (!outcome.ok) {
      // THE COLUMN AND THE ROW ID, never the row. See {@link MalformedRow}: the
      // row is a name and an email address, and this is the one log on a surface
      // guarded precisely because those are sensitive.
      console.error(MEMBERS_UNAVAILABLE, outcome.malformed.field, outcome.malformed.id);

      return { ok: false, code: MEMBERS_UNAVAILABLE };
    }

    members.push(outcome.member);
  }

  const organizations = new Set(members.map((member) => member.organizationId));

  if (organizations.size > 1) {
    console.error(MEMBERS_UNAVAILABLE, organizations.size);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  return { ok: true, members };
}

/**
 * Whether a session's permission level may read this surface at all.
 *
 * THE GUARD'S WHOLE DECISION, as a function, so `router.test.ts` can execute it
 * and `features/members/services/list.test.ts` can pin both polarities. Written inside
 * `beforeLoad` it was assertable only by matching source text, and the 1.5a
 * review widened it to `mayReadMembers(outcome) || outcome.ok` with the suite
 * still green.
 *
 * `MEMBER_ROLES[0]` RATHER THAN THE LITERAL `'admin'`, and what index 0 MEANS is
 * the part worth stating precisely, because the obvious reading of it is wrong.
 * It is not "the most privileged level" — read that way, a level inserted ABOVE
 * `admin` would take index 0 and lock every existing administrator out of the
 * one screen they need. It is THE LEVEL THAT ADMINISTERS THE ORGANIZATION, which
 * `@/features/navigation/services/role` declares index 0 to be and `features/members/services/list.test.ts` pins
 * against the literal `'admin'`. A fourth level, wherever it ranks, goes
 * anywhere in that array except position 0 — and if it genuinely administers
 * too, this predicate is what has to be widened, in front of a reviewer.
 *
 * The indirection still earns its place: the guard names no level, so the one
 * place the administering level is written down is the array, and the literal
 * pin is what makes a careless reorder a failing test rather than an inverted
 * guard.
 *
 * A FAILED READ IS NOT PERMISSION. Every non-`ok` outcome — refused,
 * unrecognised, unavailable — answers `false`, so a role read that could not
 * complete forwards the visitor rather than admitting them. That is the right
 * direction for a guard whose only cost of being wrong in the other direction is
 * handing a member their colleagues' addresses.
 */
export function mayReadMembers(outcome: MemberRoleOutcome): boolean {
  return outcome.ok && outcome.role === MEMBER_ROLES[0];
}

/** The column a row is named by. */
export const NAME_COLUMN = 'name';
/** The column carrying the member's own address, which may be absent. */
export const EMAIL_COLUMN = 'email';
/** The column carrying the permission level. */
export const LEVEL_COLUMN = 'role';
/** The column carrying the annual leave allowance, in days. */
export const LEAVE_COLUMN = 'leaveAllowanceDays';
/** The column carrying the member's team today (story 1.7b). */
export const TEAM_COLUMN = 'team';
/** The column carrying the member's status today, or the change scheduled after it (story 7.13). */
export const STATUS_COLUMN = 'status';

export type MemberColumnKey =
  | typeof NAME_COLUMN
  | typeof EMAIL_COLUMN
  | typeof LEVEL_COLUMN
  | typeof TEAM_COLUMN
  | typeof LEAVE_COLUMN
  | typeof STATUS_COLUMN;

/** The keys the six column headings render. Typed as the union so a heading
 *  absent from `hr.json` is a `pnpm typecheck` failure here. The team heading
 *  lives under `smjene.*`, the one namespace that may say the Team. */
export type MemberColumnLabel =
  | 'ljudi.name'
  | 'ljudi.email'
  | 'ljudi.role'
  | 'smjene.membership.column'
  | 'ljudi.leave'
  | 'ljudi.status.heading';

/** A cell holding text the row already carries — an address. */
export const TEXT_CELL = 'text';
/**
 * A cell holding a member's name (visual refresh B). It carries the initials
 * the avatar chip beside the name draws, so the screen reads no member field
 * for them. SINCE STORY 7.13 IT CARRIES NO STATUS: the status column states
 * that fact, once per row.
 */
export const NAME_CELL = 'name';
/**
 * A cell holding a member's status as at the organization's today (story
 * 7.13): active, inactive, or — when a change is dated after today — that
 * change and its date, which covers a scheduled reactivation too. One fact
 * per row, in WORDS (colour is never the only signal), and read through
 * {@link memberStatusOf}, the one rule the member page's Status card reads.
 */
export const STATUS_CELL = 'status';
/** A cell holding a permission level, which the surface resolves through `t()`. */
export const LEVEL_CELL = 'level';
/** A cell holding a count of days, which the surface runs through the formatter. */
export const DAYS_CELL = 'days';
/**
 * A cell holding a member's team TODAY (story 1.7b): its name, or `null` for
 * no team, which the surface states in positive words (`Bez smjene`) rather
 * than leaving blank — a blank cell reads as "not loaded".
 */
export const TEAM_CELL = 'team';

/**
 * What one cell CONTAINS, as a value rather than as a rendered string.
 *
 * THE POINT OF THE DISCRIMINANT is that the screen never touches a member field.
 * `cellText` used to live in `pages/ljudi.tsx` as a chain of `if`s reading
 * `member.name`, `member.email` and `member.leaveAllowanceDays` — and vitest
 * executes no `.tsx` at all (AD-15), so swapping the name and address branches
 * rendered every address under `Ime` with the whole suite green. The column now
 * says what its cell holds; the screen only knows how to render each KIND, and
 * `features/members/services/list.test.ts` pins the pairing exactly as it pins `sortValue`.
 *
 * `t()` and the number formatter stay on the surface, because a data module that
 * called them would need i18next initialised to be testable at all — which is
 * the dependency this module is written to avoid.
 */
export type MemberCell =
  | { readonly kind: typeof TEXT_CELL; readonly text: string }
  | { readonly kind: typeof NAME_CELL; readonly text: string; readonly initials: string | null }
  | {
      readonly kind: typeof STATUS_CELL;
      readonly activeToday: boolean;
      /** The change dated after today, or `null`: active or inactive from `from` (an ISO date). */
      readonly scheduled: { readonly active: boolean; readonly from: string } | null;
    }
  | { readonly kind: typeof LEVEL_CELL; readonly level: MemberRole }
  | {
      readonly kind: typeof TEAM_CELL;
      readonly team: string | null;
      /**
       * The change dated after today, or `null`: the team from then (`null`
       * for none), and whether it keeps today's team — a position-only change.
       */
      readonly scheduled: {
        readonly team: string | null;
        readonly from: string;
        readonly keepsTeam: boolean;
      } | null;
    }
  | { readonly kind: typeof DAYS_CELL; readonly days: number };

/** The status column's cell (story 7.13). */
export type StatusCell = Extract<MemberCell, { readonly kind: typeof STATUS_CELL }>;

export interface MemberColumn {
  readonly key: MemberColumnKey;
  /** The heading's translation key. NEVER the heading. */
  readonly label: MemberColumnLabel;
  /**
   * Whether this column holds a FIGURE, and so needs tabular numerals.
   *
   * UX-DR40: a column of numbers whose glyphs are proportionally spaced wobbles
   * from row to row, and the leave allowance is the first aligned numeric column
   * in the application. On the column rather than in the markup so a fifth
   * numeric column cannot arrive without one.
   */
  readonly numeric: boolean;
  /**
   * What this column's cell holds for one member, as at `today` — the
   * organization's own date, or `null` while it is not yet known. See
   * {@link MemberCell}.
   */
  readonly cell: (member: MemberListRow, today: string | null) => MemberCell;
  /**
   * What this column sorts by, or `null` for a row that carries no value in it.
   *
   * A FUNCTION ON THE COLUMN rather than a `switch` beside the sort, so the
   * column's heading, its cell and its order are one row of one table — which is
   * what makes swapping two columns' sort keys a visible edit to a table
   * `features/members/services/list.test.ts` pins, rather than a two-character change in JSX that
   * nothing executes.
   */
  readonly sortValue: (member: MemberListRow, today?: string | null) => string | number | null;
}

/**
 * The six columns, in binding order.
 *
 * DATA IN A `.ts`, exactly as `@/features/navigation/utils/destinations` is and for the same
 * reason: the surface renders its headings, its skeleton cells and its body
 * cells from this one array, so a fifth column is one edit here — and a test can
 * EXECUTE the pairing of heading to sort key, which no regex over a component
 * could. The 1.5a review swapped two headers' sort keys and the suite stayed
 * green precisely because the pairing lived in JSX.
 *
 * FIVE SINCE STORY 1.7b, which adds the team as at the organization's today,
 * and SIX SINCE STORY 7.13, which adds the status: today's, or the change
 * scheduled after it, so a reactivation shows before it takes effect. The
 * name cell carried an inactive marker until then; the status column states
 * that fact instead, once. There is still no hours column (epic 4).
 *
 * The permission level sorts by RANK rather than by its own text: `MEMBER_ROLES`
 * is ordered most-privileged first, so ascending puts administrators at the top.
 * Sorting the raw column text would order by the accident of the spelling
 * `'admin'` and `'member_role'` having been chosen, and would reorder itself the
 * day a third level is named.
 */
export const MEMBER_COLUMNS: readonly MemberColumn[] = [
  {
    key: NAME_COLUMN,
    label: 'ljudi.name',
    numeric: false,
    cell: (member) => ({ kind: NAME_CELL, text: member.name, initials: initialsOf(member.name) }),
    sortValue: (member) => member.name,
  },
  {
    key: EMAIL_COLUMN,
    label: 'ljudi.email',
    numeric: false,
    // AN EMPTY CELL for a member with no address, and deliberately no sentence:
    // `email` is nullable by requirement and a member without one is still a
    // member, so there is nothing to report. UX-DR20 states facts rather than
    // absences, and the honest fact about an empty column is that it is empty.
    cell: (member) => ({ kind: TEXT_CELL, text: member.email ?? NO_TEXT }),
    sortValue: (member) => member.email,
  },
  {
    key: LEVEL_COLUMN,
    label: 'ljudi.role',
    numeric: false,
    cell: (member) => ({ kind: LEVEL_CELL, level: member.role }),
    sortValue: (member) => MEMBER_ROLES.indexOf(member.role),
  },
  {
    key: TEAM_COLUMN,
    label: 'smjene.membership.column',
    numeric: false,
    // AS AT TODAY, and nothing at all while today is not known, for the reason
    // the name cell gives: "no team" by a guessed date is a false statement.
    cell: (member, today) => (today === null ? { kind: TEXT_CELL, text: NO_TEXT } : teamCellOf(member, today)),
    // BY THE TEAM THE CELL SHOWS, as at today; the latest state's while today
    // is unknown. Members on no team sort last, as members with no address do.
    sortValue: (member, today) =>
      (today === null || today === undefined
        ? memberTeamLatestVersion(member)?.team?.name
        : memberTeamOn(member, today)?.name) ?? null,
  },
  {
    key: LEAVE_COLUMN,
    label: 'ljudi.leave',
    numeric: true,
    cell: (member) => ({ kind: DAYS_CELL, days: member.leaveAllowanceDays }),
    sortValue: (member) => member.leaveAllowanceDays,
  },
  {
    key: STATUS_COLUMN,
    label: 'ljudi.status.heading',
    numeric: false,
    // AS AT TODAY, and nothing at all while today is not known: a member
    // called inactive by a guessed date is a false statement about a person,
    // and the device's own date is the wrong frame (L8).
    cell: (member, today) => (today === null ? { kind: TEXT_CELL, text: NO_TEXT } : statusCellOf(member, today)),
    // BY THE FACT THE CELL STATES: active, then a scheduled deactivation, then
    // a scheduled reactivation, then inactive. Nothing while today is unknown.
    sortValue: (member, today) =>
      today === null || today === undefined ? null : statusRankOf(memberStatusOf(member, today)),
  },
];

/** The status column's cell for a member as at `today`, from {@link memberStatusOf}. */
export function statusCellOf(member: MemberListRow, today: string): StatusCell {
  const status = memberStatusOf(member, today);

  return {
    kind: STATUS_CELL,
    activeToday: status.activeToday,
    scheduled:
      status.scheduled === null
        ? null
        : { active: status.scheduled.active, from: status.scheduled.effectiveFrom },
  };
}

/** Where a status sorts: active 0, active with a deactivation scheduled 1, inactive with a reactivation scheduled 2, inactive 3. */
function statusRankOf(status: MemberStatus): number {
  if (status.activeToday) return status.scheduled === null ? 0 : 1;

  return status.scheduled === null ? 3 : 2;
}

/**
 * One column of {@link MEMBER_COLUMNS}, by its key (story 7.6): the phone's
 * stacked row places each value by what it IS — the name as the title, the
 * team and level under it, the allowance on the right — rather than by the
 * table's column order, and reads every cell and heading from the same
 * column the table does, so the two forms cannot disagree.
 *
 * @throws Error for a key no column has — unreachable while the key is typed.
 */
export function memberColumnOf(key: MemberColumnKey): MemberColumn {
  const column = MEMBER_COLUMNS.find((candidate) => candidate.key === key);

  if (column === undefined) throw new Error(`No member column ${key}`);

  return column;
}

/**
 * What the row action on this list is NAMED AFTER.
 *
 * A FUNCTION FOR ONE FIELD READ, and it earns its line for the reason every
 * other function in this module does: `pages/ljudi.tsx` is executed by nothing
 * (AD-15), and `prijava.test.ts` refuses the screen reaching into a member row
 * at all — because the last time it did, swapping two branches rendered every
 * address under `Ime` with the whole suite green. The row action interpolates a
 * member field into its accessible name, so WHICH field is a decision, and it
 * is the one decision on that control that can be wrong without looking wrong:
 * `member.email` here would announce four hundred people's addresses to anybody
 * moving through the table with a screen reader, and a tenth of them have none,
 * so a tenth of the actions would be named nothing at all.
 *
 * `features/members/services/list.test.ts` executes it against a member whose name and address
 * differ, which is what makes that swap a failing case rather than a silent one.
 */
export function memberActionName(member: MemberListRow): string {
  return member.name;
}

/**
 * The classes a cell is drawn with, decided by what the column HOLDS.
 *
 * TAILWIND LITERALS IN A `.ts`, the precedent `@/features/organization/utils/accent` set, and
 * for two reasons rather than one. The first is that a ternary over two class
 * strings written in JSX is refused outright by `eslint.config.js`'s L2 block —
 * it cannot tell a class name from a word somebody reads, and a merge-blocking
 * rule that has to be argued with is worse than one line here. The second is
 * that it makes UX-DR40 EXECUTABLE: `tabular-nums` on the one aligned numeric
 * column is a claim `features/members/services/list.test.ts` can assert, where a class buried in a
 * component is a claim nothing reads.
 *
 * `text-right` travels with it because the two are one decision: a column of
 * figures aligns right so the digits line up, and tabular numerals are what stop
 * them wobbling once they do. The leave allowance is the first such column in
 * the application; the hours table of epic 4 is the next.
 */
export function cellClassNameOf(column: MemberColumn): string {
  if (column.numeric) return 'whitespace-nowrap text-right tabular-nums';
  // VISUAL REFRESH B: the name cell carries a chip and, for a marked member, a
  // badge beside the name. Held to one line on a phone, a scheduled marker
  // would make this one column wider than the screen, so it wraps below `sm`.
  if (column.key === NAME_COLUMN) return 'whitespace-normal sm:whitespace-nowrap';
  // DESIGN REFRESH C: an address is the one unbounded value in a row, and one
  // long address pushed the actions column past the card. Bounded here and cut
  // with an ellipsis by the cell's text (`truncate`); the whole address stays
  // in the DOM, so a screen reader still reads all of it.
  if (column.key === EMAIL_COLUMN) return 'max-w-56 whitespace-nowrap';

  return 'whitespace-nowrap';
}

/**
 * The badge variants a cell may be drawn with, spelled as `components/ui/badge`
 * spells them. No status colour exists among them on purpose: a badge's meaning
 * is its text, and the variant only reinforces it.
 */
export type MemberBadge = 'default' | 'secondary' | 'outline';

/**
 * The status cell's words (story 7.13), or `null` for any other cell.
 *
 * ONE FACT, IN WORDS, never by colour alone: `Aktivno`, `Neaktivno`, or — a
 * change dated after today — `Od {dd.mm.}: neaktivno|aktivno`, which says
 * what the member WILL be. Swapping two would call a member inactive who is
 * only scheduled to be, so the pairing is executed by
 * `features/members/services/list.test.ts` rather than written in a `.tsx`
 * nothing runs.
 */
export function memberStatusMessageKey(
  cell: StatusCell,
):
  | 'ljudi.status.cellActive'
  | 'ljudi.status.cellInactive'
  | 'ljudi.status.cellFromActive'
  | 'ljudi.status.cellFromInactive' {
  if (cell.scheduled !== null) {
    return cell.scheduled.active ? 'ljudi.status.cellFromActive' : 'ljudi.status.cellFromInactive';
  }

  return cell.activeToday ? 'ljudi.status.cellActive' : 'ljudi.status.cellInactive';
}

/** The status cell's interpolation: the scheduled change's date as `05.10.`, or empty for none. */
export function memberStatusArgsOf(cell: StatusCell): { readonly date: string } {
  if (cell.scheduled === null) return { date: NO_TEXT };

  return { date: formatIsoDayMonth(cell.scheduled.from) ?? cell.scheduled.from };
}

/**
 * The marker a team cell carries for a change dated after today (design
 * refresh C), or `null` when none is scheduled: a move onto a team, onto no
 * team, or a change that keeps the team (a new position). Exhaustive over the
 * three, so a scheduled change is never drawn as nothing.
 */
export function teamMarkerMessageKey(
  cell: MemberCell,
):
  | 'smjene.membership.markerMove'
  | 'smjene.membership.markerNone'
  | 'smjene.membership.markerChange'
  | null {
  if (cell.kind !== TEAM_CELL || cell.scheduled === null) return null;
  if (cell.scheduled.keepsTeam) return 'smjene.membership.markerChange';
  if (cell.scheduled.team === null) return 'smjene.membership.markerNone';

  return 'smjene.membership.markerMove';
}

/** A marker beside a cell's value as the screen draws it: a variant, a key and its argument. */
export interface MemberStatusLook {
  readonly variant: MemberBadge;
  readonly key: NonNullable<ReturnType<typeof teamMarkerMessageKey>>;
  /**
   * The key's interpolation. `date` is the SHOWN date, or empty for none;
   * `team` the scheduled team's name, or empty for none.
   */
  readonly args: { readonly date: string; readonly team: string };
}

/** The initials chip beside a name. `initials` is `null` for a name with no
 *  letter in it, which draws an EMPTY chip so the names stay aligned. */
export interface MemberAvatar {
  readonly initials: string | null;
}

/**
 * How one cell is drawn, decided here rather than in the screen (visual
 * refresh B, AD-15).
 *
 * - `avatar`: the initials chip beside a name, or `null` for no chip at all.
 * - `badge`: the badge the cell's own value is drawn as, or `null` for plain
 *   text. A permission level is a badge: administrators in the primary tint,
 *   members in the secondary fill. The level's WORD is what says which it is.
 *   A scheduled status change is an outline badge (story 7.13).
 * - `status`: the scheduled team change's marker beside the team, with its
 *   words, or `null` when none is scheduled. The key comes from
 *   {@link teamMarkerMessageKey}, so the look and the words are one decision.
 * - `muted`: the plain value is drawn in muted text — `Aktivno`, the common
 *   case, so the rows that differ stand out by their words.
 */
export interface MemberCellLook {
  readonly avatar: MemberAvatar | null;
  readonly badge: MemberBadge | null;
  readonly status: MemberStatusLook | null;
  readonly muted: boolean;
}

const PLAIN_LOOK: MemberCellLook = { avatar: null, badge: null, status: null, muted: false };

/**
 * A scheduled team change, drawn in the PRIMARY tint so it stands out from
 * the plain team name beside it — its words say what changes and from when;
 * the tint only draws the eye (no status colour, UX-DR4).
 */
function teamMarkerLookOf(cell: MemberCell): MemberStatusLook | null {
  const key = teamMarkerMessageKey(cell);

  if (key === null || cell.kind !== TEAM_CELL || cell.scheduled === null) return null;

  return {
    variant: 'default',
    key,
    args: { date: shownDate(cell.scheduled.from), team: cell.scheduled.team ?? NO_TEXT },
  };
}

export function memberCellLookOf(cell: MemberCell): MemberCellLook {
  if (cell.kind === NAME_CELL) return { ...PLAIN_LOOK, avatar: { initials: cell.initials } };
  if (cell.kind === STATUS_CELL) {
    if (cell.scheduled !== null) return { ...PLAIN_LOOK, badge: 'outline' };

    return { ...PLAIN_LOOK, muted: cell.activeToday };
  }
  if (cell.kind === LEVEL_CELL) {
    return { ...PLAIN_LOOK, badge: cell.level === 'admin' ? 'default' : 'secondary' };
  }
  if (cell.kind === TEAM_CELL) return { ...PLAIN_LOOK, status: teamMarkerLookOf(cell) };

  return PLAIN_LOOK;
}

/**
 * The classes a cell's plain value is drawn with: cut with an ellipsis, and
 * muted where {@link memberCellLookOf} says so. In a `.ts` because a ternary
 * over two class strings in JSX is refused by `eslint.config.js`'s L2 block.
 */
export function cellTextClassNameOf(look: MemberCellLook): string {
  return look.muted ? 'truncate text-muted-foreground' : 'truncate';
}

/**
 * The summary line's operands (story 7.13): how many rows are shown, how many
 * of them are administrators, and how many have a status change scheduled
 * after today — `Prikazano: 15 osoba · 1 administrator · 1 zakazana promjena`.
 *
 * THE ROWS SHOWN, never the whole snapshot: the line says what the table
 * holds, so a search or a filter moves it with the rows. Every count is
 * stated at zero. `scheduled` is `null` while today is unknown, for the reason
 * the status cell is empty then: a count by a guessed date is a false statement.
 */
export interface MembersSummary {
  readonly shown: number;
  readonly admins: number;
  readonly scheduled: number | null;
}

/** The summary of the rows the table shows, as at `today`. */
export function membersSummaryOf(rows: readonly MemberListRow[], today: string | null): MembersSummary {
  let admins = 0;
  let scheduled = 0;

  for (const member of rows) {
    if (member.role === 'admin') admins += 1;
    if (today !== null && memberStatusOf(member, today).scheduled !== null) scheduled += 1;
  }

  return { shown: rows.length, admins, scheduled: today === null ? null : scheduled };
}

/** The summary line's message: with the scheduled count, or without it while today is unknown. */
export function membersSummaryMessageKey(summary: MembersSummary): 'ljudi.summary.full' | 'ljudi.summary.noStatus' {
  return summary.scheduled === null ? 'ljudi.summary.noStatus' : 'ljudi.summary.full';
}

/** `aria-sort`'s own vocabulary, so the screen writes neither value by hand. */
export const ASCENDING = 'ascending';
export const DESCENDING = 'descending';
/** What an unsorted column reports. Part of the same ARIA vocabulary. */
export const UNSORTED = 'none';

export type SortDirection = typeof ASCENDING | typeof DESCENDING;

export interface SortState {
  readonly key: MemberColumnKey;
  readonly direction: SortDirection;
}

/**
 * The order the list opens in: by name, ascending.
 *
 * A TABLE IS ALWAYS SORTED, and there is deliberately no third "unsorted" state
 * for a header to cycle back to. Row order is never arbitrary — an unsorted
 * table is sorted by whatever order the transport happened to return — so
 * offering "unsorted" would be a control that claims to remove an ordering it
 * cannot remove.
 */
export const DEFAULT_SORT: SortState = { key: NAME_COLUMN, direction: ASCENDING };

/**
 * What pressing a column heading does.
 *
 * TWO CASES, and the one that matters is the second: pressing a DIFFERENT column
 * starts it ascending rather than inheriting the direction of the column being
 * left. Inheriting is the shape that makes a person press a heading and get a
 * list that is upside down for reasons nothing on screen explains.
 */
export function nextSortState(current: SortState, pressed: MemberColumnKey): SortState {
  if (current.key !== pressed) return { key: pressed, direction: ASCENDING };

  return {
    key: pressed,
    direction: current.direction === ASCENDING ? DESCENDING : ASCENDING,
  };
}

/** What a column heading reports to assistive technology. */
export function sortStateOf(
  sort: SortState,
  column: MemberColumnKey,
): SortDirection | typeof UNSORTED {
  return sort.key === column ? sort.direction : UNSORTED;
}

/** The arrow a sorted heading shows. Names a DIRECTION, never a glyph. */
export const ARROW_UP = 'up';
export const ARROW_DOWN = 'down';

export type SortIndicator = typeof ARROW_UP | typeof ARROW_DOWN;

/**
 * Which way the sorted column's arrow points, or `null` for a column that is
 * not sorted.
 *
 * A PURE FUNCTION rather than a ternary in the heading, and the reason is the
 * one that runs through this whole module: `pages/ljudi.tsx` is executed by no
 * test, so `state === ASCENDING ? ArrowUp : ArrowDown` written there could be
 * inverted with the suite green — and an inverted arrow is worse than no arrow,
 * because it disagrees SILENTLY with a perfectly correct `aria-sort` on the same
 * element. A sighted person and a screen-reader user would then be told opposite
 * things about the same column.
 *
 * `features/members/services/list.test.ts` pins this against {@link sortStateOf} for every column
 * and both directions, so the two can never drift apart. What the screen still
 * owns is which GLYPH each name draws, and `prijava.test.ts` pins that pairing
 * at source level, because no node test can see a rendered icon.
 */
export function sortIndicatorOf(sort: SortState, column: MemberColumnKey): SortIndicator | null {
  if (sort.key !== column) return null;

  return sortDirectionIndicatorOf(sort);
}

/**
 * Which way the SORTED column's arrow points (story 7.6): the phone's sort
 * control names the sorted column, which always has an arrow. A total
 * mapping of the two directions, so there is no fallback to get wrong.
 */
const DIRECTION_INDICATORS: Record<SortDirection, SortIndicator> = {
  [ASCENDING]: ARROW_UP,
  [DESCENDING]: ARROW_DOWN,
};

export function sortDirectionIndicatorOf(sort: SortState): SortIndicator {
  return DIRECTION_INDICATORS[sort.direction];
}

/** Every member, whatever their level. */
export const ALL_LEVELS = 'all';

export type LevelFilter = typeof ALL_LEVELS | MemberRole;

/**
 * The filter's options, in binding order.
 *
 * DERIVED from `MEMBER_ROLES` rather than written out, so a third permission
 * level appears in the filter the moment it exists rather than the moment
 * somebody remembers this list. `ALL_LEVELS` leads because it is the state the
 * screen opens in.
 *
 * ONE OF TWO AXES since the team filter arrived (UX-DR17, UX-DR19): the team
 * options are derived from the snapshot rather than written out, by
 * {@link narrowMembers}, because unlike the levels they are data. Both share
 * the SHAPE — each option states its own count.
 */
export const LEVEL_FILTERS: readonly LevelFilter[] = [ALL_LEVELS, ...MEMBER_ROLES];

/**
 * The level a `<select>` value IS, or every level.
 *
 * A LOOKUP WITH AN EXPLICIT FALLBACK, never a cast. A `<select>`'s value is a
 * string as far as the DOM is concerned, and a value outside this vocabulary —
 * a stale option after a build, an extension rewriting the control — would cast
 * to a `LevelFilter` the type system believes in and `narrowMembers` would then
 * match no row at all: an empty list with no explanation, which is the one
 * outcome this surface must never produce silently. Falling back to every level
 * shows too much rather than nothing, which is the harmless direction.
 */
export function chooseLevel(value: string): LevelFilter {
  return LEVEL_FILTERS.find((known) => known === value) ?? ALL_LEVELS;
}

/** Every member, whatever their team. */
export const ALL_TEAMS = 'all';

/** The members on no team today. */
export const NO_TEAM = 'none';

/**
 * A team filter value: {@link ALL_TEAMS}, {@link NO_TEAM}, or a team's id.
 *
 * THE SENTINELS CANNOT COLLIDE WITH AN ID: `teams.id` is a UUID, and neither
 * `all` nor `none` is one. A plain `string` rather than a union, because the
 * third member is data the snapshot supplies — which is exactly why a value is
 * only ever admitted through {@link chooseTeam}.
 */
export type TeamFilter = string;

/**
 * One option of the team filter, with the count it would yield (UX-DR19).
 *
 * `team` is the name a named option interpolates, and {@link NO_TEXT} for the
 * two sentinels, whose messages name no team. It is DATA, never a key.
 */
export interface TeamFilterOption {
  readonly value: TeamFilter;
  readonly team: string;
  readonly count: number;
}

/**
 * The team a member counts under, as at today: its id, or {@link NO_TEAM}.
 *
 * TODAY'S TEAM, and a scheduled move changes nothing until its date — the
 * reading the team column and `0010`'s `member_team_on` make.
 */
function teamFilterValueOf(member: MemberListRow, today: string): TeamFilter {
  return memberTeamOn(member, today)?.id ?? NO_TEAM;
}

/**
 * Every team somebody in the snapshot is on today, by name in Croatian order,
 * then by id so two teams sharing a name still order totally.
 *
 * DERIVED FROM THE ROWS rather than read from `teams` (AD-13): a team nobody is
 * on today would only ever state `0`, and fetching it would be a second read
 * behind one figure. The WHOLE snapshot, never the searched part, so an option
 * does not vanish because a search excluded its members — it reads `0` instead
 * (UX-DR20).
 */
function teamsOnToday(members: readonly MemberListRow[], today: string): MemberTeam[] {
  const byId = new Map<string, MemberTeam>();

  for (const member of members) {
    const team = memberTeamOn(member, today);

    if (team !== null && !byId.has(team.id)) byId.set(team.id, team);
  }

  return [...byId.values()].sort((first, second) => {
    const byName = compareText(first.name, second.name);

    return byName !== 0 ? byName : compareText(first.id, second.id);
  });
}

/**
 * The team a `<select>` value IS among the options on screen, or every team.
 *
 * A LOOKUP WITH AN EXPLICIT FALLBACK, for the reason {@link chooseLevel} gives —
 * and more so here, because the vocabulary is DATA: a team everybody left since
 * the last read, or a value from a stale option, is not among the options, and
 * admitting it would narrow to an empty list nobody explained.
 */
export function chooseTeam(value: string, options: readonly TeamFilterOption[]): TeamFilter {
  return options.find((option) => option.value === value)?.value ?? ALL_TEAMS;
}

/**
 * The name one team option renders as in the Smjena chip's picker (story
 * 7.13), or `null` for a team, whose name is data. Its count is drawn beside it.
 *
 * UNDER `smjene.membership.*`, not `ljudi.*`: the team namespace is the one
 * that may say `smjena` (`test/resource-hygiene.test.ts`), and "no team" is
 * said in positive words, `Bez smjene`, as the team column says it.
 */
export function teamFilterMessageKey(
  value: TeamFilter,
): 'smjene.membership.allTeams' | 'smjene.membership.none' | null {
  if (value === ALL_TEAMS) return 'smjene.membership.allTeams';
  if (value === NO_TEAM) return 'smjene.membership.none';

  return null;
}

/**
 * The team filter value the screen should STORE, given the one the narrowing
 * actually applied: the stored value itself, or the applied one when the stored
 * team has left the options.
 *
 * WITHOUT THIS A VANISHED TEAM COMES BACK. The narrowing treats a team nobody
 * is on any more as every team, but the screen's state would still hold its
 * id — so a later refetch that puts somebody back on it would silently
 * re-apply a filter the select had stopped showing, and the reset (which reads
 * the applied team) would be disabled the whole time. Replacing it only while
 * the answer is real — members present and today known — keeps a loading or
 * refused screen from discarding a choice it simply cannot judge yet.
 */
export function teamToStore(
  stored: TeamFilter,
  applied: TeamFilter,
  members: readonly MemberListRow[] | null,
  today: string | null,
): TeamFilter {
  if (members === null || today === null) return stored;

  return stored === applied ? stored : applied;
}

/** Every member, whatever their status: the status chip's ✕ (story 7.13). */
export const STATUS_ALL = 'svi';
/** The members active today: the view the list opens in. */
export const STATUS_ACTIVE = 'aktivni';
/** The members inactive today. */
export const STATUS_INACTIVE = 'neaktivni';

/**
 * A status filter value, written to the URL as `?status=` (story 7.13). The
 * values ARE the URL's words, as `?prikaz=moj|sve` are on *Kalendar*.
 */
export type StatusFilter = typeof STATUS_ACTIVE | typeof STATUS_INACTIVE | typeof STATUS_ALL;

/** The status options, in the order the chip's picker offers them. */
export const STATUS_FILTERS: readonly StatusFilter[] = [STATUS_ACTIVE, STATUS_INACTIVE, STATUS_ALL];

/** The status the list opens in: active today (FR-15). */
export const DEFAULT_STATUS: StatusFilter = STATUS_ACTIVE;

/** The status a value IS, or the default — never a cast (see {@link chooseLevel}). */
export function chooseStatus(value: unknown): StatusFilter {
  return STATUS_FILTERS.find((known) => known === value) ?? DEFAULT_STATUS;
}

/** The label one status option renders as. */
export function statusFilterMessageKey(
  status: StatusFilter,
): 'ljudi.statusFilter.active' | 'ljudi.statusFilter.inactive' | 'ljudi.statusFilter.all' {
  if (status === STATUS_ACTIVE) return 'ljudi.statusFilter.active';
  if (status === STATUS_INACTIVE) return 'ljudi.statusFilter.inactive';
  if (status === STATUS_ALL) return 'ljudi.statusFilter.all';

  const unhandled: never = status;

  return unhandled;
}

/**
 * Whether a member passes the status filter as at `today`, by the one status
 * rule the status cell and the member page read ({@link memberStatusOf}).
 * `svi` needs no status. With today unknown nobody passes `aktivni` or
 * `neaktivni`: there is no honest answer to "who is active" without it, and
 * the screen draws skeleton rows instead ({@link membersAwaitTodayOf}).
 */
function statusMatches(member: MemberListRow, status: StatusFilter, today: string | null): boolean {
  if (status === STATUS_ALL) return true;
  if (today === null) return false;

  return memberStatusOf(member, today).activeToday === (status === STATUS_ACTIVE);
}

/**
 * Whether the list must wait for today before it can draw a row (story
 * 7.13): it has members, the organization's today is not settled, and the
 * status filter needs it. The screen draws skeleton rows meanwhile; `svi`
 * lists rows at once, because it needs no status.
 */
export function membersAwaitTodayOf(
  members: readonly MemberListRow[] | null,
  today: string | null,
  status: StatusFilter,
): boolean {
  return members !== null && members.length > 0 && today === null && status !== STATUS_ALL;
}

/**
 * Everything the list is narrowed and ordered by, as the URL holds it (story
 * 7.13): the search as typed, the level, the team, the status and the sort.
 */
export interface MembersFilters {
  readonly search: string;
  readonly level: LevelFilter;
  readonly team: TeamFilter;
  readonly status: StatusFilter;
  readonly sort: SortState;
}

/** The list as it opens: no search, every level, every team, active today, by name ascending. */
export const DEFAULT_FILTERS: MembersFilters = {
  search: NO_TEXT,
  level: ALL_LEVELS,
  team: ALL_TEAMS,
  status: DEFAULT_STATUS,
  sort: DEFAULT_SORT,
};

/**
 * Whether the list differs from the view it opens in, which is when
 * `Poništi filtre` is shown (story 7.13).
 *
 * ANY TEXT IN THE BOX COUNTS, whitespace included: the reset's job is to put
 * the controls back, and a box holding two spaces is not back. The sort counts
 * too: the reset returns the URL to its defaults, and the sort is in the URL.
 */
export function isNarrowed(filters: MembersFilters): boolean {
  return (
    filters.search !== DEFAULT_FILTERS.search ||
    filters.level !== DEFAULT_FILTERS.level ||
    filters.team !== DEFAULT_FILTERS.team ||
    filters.status !== DEFAULT_FILTERS.status ||
    filters.sort.key !== DEFAULT_FILTERS.sort.key ||
    filters.sort.direction !== DEFAULT_FILTERS.sort.direction
  );
}

/** The search parameters `/ljudi` reads: `?trazi=&razina=&smjena=&status=&sort=`, each absent at its default. */
export type MembersSearch = {
  readonly trazi?: string | undefined;
  readonly razina?: string | undefined;
  readonly smjena?: string | undefined;
  readonly status?: string | undefined;
  readonly sort?: string | undefined;
};

/** Each level as the URL writes it: `?razina=admin|clan`. */
const LEVEL_SEARCH_VALUES: Readonly<Record<MemberRole, string>> = { admin: 'admin', member_role: 'clan' };

/** Each sortable column as the URL writes it: `?sort=ime`, `?sort=-ime` descending. */
const SORT_SEARCH_VALUES: Readonly<Record<MemberColumnKey, string>> = {
  [NAME_COLUMN]: 'ime',
  [EMAIL_COLUMN]: 'adresa',
  [LEVEL_COLUMN]: 'razina',
  // `tim`, as *Sati*'s `sort=tim`: the team's search parameter is `smjena`.
  [TEAM_COLUMN]: 'tim',
  [LEAVE_COLUMN]: 'godisnji',
  [STATUS_COLUMN]: 'status',
};

/** The prefix a descending sort carries in the URL. */
const DESCENDING_PREFIX = '-';

function levelOfSearch(value: unknown): LevelFilter {
  return MEMBER_ROLES.find((role) => LEVEL_SEARCH_VALUES[role] === value) ?? ALL_LEVELS;
}

function sortOfSearch(value: unknown): SortState {
  if (typeof value !== 'string') return DEFAULT_SORT;

  const descending = value.startsWith(DESCENDING_PREFIX);
  const name = descending ? value.slice(DESCENDING_PREFIX.length) : value;
  const key = MEMBER_COLUMNS.find((column) => SORT_SEARCH_VALUES[column.key] === name)?.key;

  return key === undefined ? DEFAULT_SORT : { key, direction: descending ? DESCENDING : ASCENDING };
}

/**
 * The URL's search text, trimmed: whitespace alone is no search, so
 * `?trazi=%20%20` opens at the defaults and offers no reset. A number too —
 * the router parses `?trazi=123` as JSON.
 */
function searchOfText(text: unknown): string {
  if (typeof text === 'number') return String(text);

  return typeof text === 'string' ? text.trim() : NO_TEXT;
}

/**
 * What the URL's search says, as filters: every value outside its vocabulary
 * falls back to its default, and never throws. A team is any non-empty value
 * here — whether it is still an option is the snapshot's to say
 * ({@link teamToStore}), which the parser cannot see.
 */
export function membersFiltersOf(search: Readonly<Record<string, unknown>>): MembersFilters {
  const text = search['trazi'];
  const team = search['smjena'];

  return {
    search: searchOfText(text),
    level: levelOfSearch(search['razina']),
    team: typeof team === 'string' && team !== NO_TEXT ? team : ALL_TEAMS,
    status: chooseStatus(search['status']),
    sort: sortOfSearch(search['sort']),
  };
}

/** The URL's search for `filters`: each value at its default is left out, so the defaults are `/ljudi`. */
export function membersSearchFor(filters: MembersFilters): MembersSearch {
  const sorted = filters.sort.key !== DEFAULT_SORT.key || filters.sort.direction !== DEFAULT_SORT.direction;
  const sort = `${filters.sort.direction === DESCENDING ? DESCENDING_PREFIX : NO_TEXT}${SORT_SEARCH_VALUES[filters.sort.key]}`;

  return {
    ...(filters.search === NO_TEXT ? {} : { trazi: filters.search }),
    ...(filters.level === ALL_LEVELS ? {} : { razina: LEVEL_SEARCH_VALUES[filters.level] }),
    ...(filters.team === ALL_TEAMS ? {} : { smjena: filters.team }),
    ...(filters.status === DEFAULT_STATUS ? {} : { status: filters.status }),
    ...(sorted ? { sort } : {}),
  };
}

/**
 * `/ljudi`'s `validateSearch`: the search parsed and written back, so an
 * unknown value is dropped and the route only ever holds what it shows.
 */
export function membersSearchOf(search: Readonly<Record<string, unknown>>): MembersSearch {
  return membersSearchFor(membersFiltersOf(search));
}

/** `?dodaj=1`: the add-member dialog is open (story 7.13b). The one value it takes. */
export const MEMBERS_ADD_OPEN = 1;

/** The dialog's half of `/ljudi`'s search, beside the filters: absent while it is closed. */
export type MembersAddSearch = {
  readonly dodaj?: typeof MEMBERS_ADD_OPEN | undefined;
};

/** `/ljudi`'s whole search: the filters, and whether the add dialog is open. */
export type LjudiSearch = MembersSearch & MembersAddSearch;

/**
 * Whether the URL opens the add dialog: `?dodaj=1` does, which the router
 * reads as the number `1` (or the text `'1'` from a hand-written link). Any
 * other value is no dialog and is dropped, and nothing throws. Kept apart from
 * {@link membersSearchOf}, which drops every key it does not know by design.
 */
export function membersAddSearchOf(search: Readonly<Record<string, unknown>>): MembersAddSearch {
  const value = search['dodaj'];

  return value === MEMBERS_ADD_OPEN || value === String(MEMBERS_ADD_OPEN) ? { dodaj: MEMBERS_ADD_OPEN } : {};
}

/** One search as a string, so a change and the state it leaves compare as one key. */
export function membersSearchKeyOf(search: MembersSearch): string {
  // JSON, never a join: free text holding the separator would make two states one key.
  return JSON.stringify([search.trazi, search.razina, search.smjena, search.status, search.sort].map((value) => value ?? null));
}

/** The three chips beside the search (story 7.13), in the order they are drawn. */
export const CHIP_LEVEL = 'level';
export const CHIP_TEAM = 'team';
export const CHIP_STATUS = 'status';

export type MemberChipKey = typeof CHIP_LEVEL | typeof CHIP_TEAM | typeof CHIP_STATUS;

export const MEMBER_CHIPS: readonly MemberChipKey[] = [CHIP_LEVEL, CHIP_TEAM, CHIP_STATUS];

/** The chip a key names, or `null` for none — never a cast. */
export function chooseChip(value: string): MemberChipKey | null {
  return MEMBER_CHIPS.find((key) => key === value) ?? null;
}

/**
 * Whether a chip is SET — drawn active, with its ✕. The status chip is set at
 * its default, `aktivni`, because the default view does narrow: its ✕ shows
 * `svi`. `team` is the team the rows were narrowed by.
 */
export function memberChipActive(filters: MembersFilters, team: TeamFilter, key: MemberChipKey): boolean {
  switch (key) {
    case CHIP_LEVEL:
      return filters.level !== ALL_LEVELS;
    case CHIP_TEAM:
      return team !== ALL_TEAMS;
    case CHIP_STATUS:
      return filters.status !== STATUS_ALL;
  }
}

/** How many chips are set: the phone's `Filtri · N`. */
export function memberChipsActiveCount(filters: MembersFilters, team: TeamFilter): number {
  return MEMBER_CHIPS.filter((key) => memberChipActive(filters, team, key)).length;
}

/**
 * What choosing `value` in a chip's picker leaves. A value outside the chip's
 * options falls back as the URL does: a level or a team to "all", a status to
 * its default ({@link chooseStatus}) — one rule.
 */
export function memberChipChoiceOf(
  filters: MembersFilters,
  key: MemberChipKey,
  value: string,
  teams: readonly TeamFilterOption[],
): MembersFilters {
  switch (key) {
    case CHIP_LEVEL:
      return { ...filters, level: chooseLevel(value) };
    case CHIP_TEAM:
      return { ...filters, team: chooseTeam(value, teams) };
    case CHIP_STATUS:
      return { ...filters, status: chooseStatus(value) };
  }
}

/** What a chip's ✕ leaves: that chip at "all" — the status at `svi` — and the rest kept. */
export function memberChipRemovalOf(filters: MembersFilters, key: MemberChipKey): MembersFilters {
  switch (key) {
    case CHIP_LEVEL:
      return { ...filters, level: ALL_LEVELS };
    case CHIP_TEAM:
      return { ...filters, team: ALL_TEAMS };
    case CHIP_STATUS:
      return { ...filters, status: STATUS_ALL };
  }
}

/**
 * The message key each failure renders as — the edge, and the only place one of
 * these codes becomes Croatian.
 *
 * Here rather than as a ternary in the screen, for the reason
 * `@/features/organization/utils/messages` records: a `.tsx` is collected by nothing, so a
 * mapping written there can only be read as source text, and swapping two
 * branches passes every source-level assertion.
 *
 * NEITHER MESSAGE SAYS "you need administrator rights", and that is the
 * constraint this surface adds to the pattern. `/ljudi` is reachable only
 * through a route guard that has already read this session's level and found it
 * to be an administrator's — so telling the person they lack the rights would be
 * false on the one path that reaches this screen, and it would send somebody to
 * ask for a permission they demonstrably hold.
 *
 * TWO CODES, TWO MESSAGES, AND TWO DIFFERENT ACTIONS, which is the part the
 * wording has to keep honest. An unavailable read is the transport, so it may
 * well succeed on a second attempt and its message says to try again. A REFUSAL
 * WILL NOT: the database declined this session, and pressing the same button
 * again asks the same question of the same claim. So its message does not invite
 * a retry — it names the action that can actually change the answer, which is
 * signing in again. A session's `organization_id` claim is minted at sign-in
 * (`custom_access_token_hook`) while role and active status are re-read on every
 * statement, so a stale or missing claim is precisely what a new token fixes,
 * and a reactivated account is picked up by the next read either way. Telling
 * somebody to retry something that cannot work is the one thing a refusal
 * message must not do.
 */
export function membersMessageKey(
  failure: MembersFailure,
): 'ljudi.error.refused' | 'ljudi.error.unavailable' {
  if (failure === MEMBERS_REFUSED) return 'ljudi.error.refused';
  if (failure === MEMBERS_UNAVAILABLE) return 'ljudi.error.unavailable';

  // EXHAUSTIVE, and `never` is what makes it so — the idiom
  // `@/features/organization/utils/messages` records. A third code added to the vocabulary
  // becomes a `pnpm typecheck` failure here, at the one place it has to be
  // taught, rather than a fall-through that reports the wrong fact confidently.
  const unhandled: never = failure;

  return unhandled;
}

/**
 * The label a permission level renders as.
 *
 * AN EXHAUSTIVE MAPPING and never a binary ternary, which is the shape this
 * replaces: `role === 'admin' ? t('…admin') : t('…member')` renders an
 * unrecognised level as `Član` — it tells an administrator whose level a newer
 * build wrote that they are an ordinary member, which is a confident lie about
 * a permission. The `never` below makes a third level a `pnpm typecheck` failure
 * here instead.
 */
export function memberLevelMessageKey(role: MemberRole): 'ljudi.admin' | 'ljudi.member' {
  if (role === 'admin') return 'ljudi.admin';
  if (role === 'member_role') return 'ljudi.member';

  const unhandled: never = role;

  return unhandled;
}

/**
 * The name one level option renders as in the Razina chip's picker (story
 * 7.13); its count is drawn beside it.
 *
 * EXHAUSTIVE for the reason above, and with the same consequence if it were not:
 * a fall-through would label a third level as "every level" and quietly promise
 * a list it does not produce.
 */
export function levelFilterMessageKey(level: LevelFilter): 'ljudi.chip.allLevels' | 'ljudi.admin' | 'ljudi.member' {
  if (level === ALL_LEVELS) return 'ljudi.chip.allLevels';

  return memberLevelMessageKey(level);
}

/** The status chip's value, `aktivni`, and its option's name, `Aktivni` (story 7.13). */
export function statusValueMessageKey(
  status: StatusFilter,
): 'ljudi.statusValue.active' | 'ljudi.statusValue.inactive' | 'ljudi.statusValue.all' {
  if (status === STATUS_ACTIVE) return 'ljudi.statusValue.active';
  if (status === STATUS_INACTIVE) return 'ljudi.statusValue.inactive';
  if (status === STATUS_ALL) return 'ljudi.statusValue.all';

  const unhandled: never = status;

  return unhandled;
}

/**
 * The Croatian digraphs Unicode also encodes as single code points.
 *
 * NFD DOES NOT TOUCH THEM. `'ǆ'.normalize('NFD')` is still `'ǆ'` — these are
 * compatibility characters, not precomposed accents — so a fold built on NFD
 * alone leaves a member whose name was pasted from a system that emits them
 * unfindable by typing `dz`. They are mapped to the two-letter sequences a
 * Croatian keyboard produces, which is what somebody searching will type.
 *
 * Both cases and the title case of each, because all three exist as distinct
 * code points and a person pasting a surname gets whichever their source used.
 */
const DIGRAPHS: readonly (readonly [string, string])[] = [
  // TWO ENCODINGS OF DŽ, not one. U+01C4–U+01C6 are the Latin-Extended-B forms
  // and U+01F1–U+01F3 are the later additions Unicode encoded separately — the
  // same three glyphs at two code points each, and a fold that knew only the
  // first block left a surname pasted from a system emitting the second
  // unfindable by typing `dz`. There is no such pair for LJ or NJ.
  ['Ǳ', 'DZ'],
  ['ǲ', 'Dz'],
  ['ǳ', 'dz'],
  ['Ǆ', 'DZ'],
  ['ǅ', 'Dz'],
  ['ǆ', 'dz'],
  ['Ǉ', 'LJ'],
  ['ǈ', 'Lj'],
  ['ǉ', 'lj'],
  ['Ǌ', 'NJ'],
  ['ǋ', 'Nj'],
  ['ǌ', 'nj'],
];

/** Combining marks, which NFD separates from the letter it decomposed. */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Text as a search compares it: lowercase, and with every Croatian diacritic
 * folded to the letter underneath it.
 *
 * `Đ` IS THE CASE A NAIVE FOLD MISSES, and it is a Croatian surname's first
 * letter often enough to matter. `normalize('NFD')` decomposes `ć`, `č`, `š` and
 * `ž` into a letter plus a combining mark — but `đ` is U+0111 LATIN SMALL LETTER
 * D WITH STROKE, a letter in its own right with no decomposition at all, so
 * `Đurić` stays unfindable by typing `Duric` unless it is mapped by hand.
 *
 * A FOLD RATHER THAN A COLLATOR: `Intl.Collator` with `sensitivity: 'base'`
 * answers "are these two strings equal", and a search is a SUBSTRING question —
 * `mari` inside `Marić` — which no collator answers. The order the list is
 * presented in is the collator's job, and `@/lib/i18n/format` holds that.
 */
export function foldForSearch(text: string): string {
  let folded = text;

  for (const [single, pair] of DIGRAPHS) folded = folded.split(single).join(pair);

  return folded
    .toLocaleLowerCase('hr')
    .split('đ')
    .join('d')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '');
}

/** Whether a member matches a folded search. Name and address, nothing else:
 *  those are the two fields a person knows somebody by. */
function matches(member: MemberListRow, folded: string): boolean {
  const name = foldForSearch(member.name);
  const email = member.email === null ? NO_TEXT : foldForSearch(member.email);

  return name.includes(folded) || email.includes(folded);
}

/**
 * The members a search selects.
 *
 * A QUERY THAT FOLDS TO NOTHING MATCHES NOTHING, and that is the case this
 * exists to separate from an empty search box. The fold strips combining marks
 * and lowercases, so a query made entirely of characters it removes — a stray
 * accent, a diacritic typed on its own, a combining mark pasted out of a
 * document — folds to the empty string, and `''.includes` is true of every
 * member. The screen would then report the whole organization as the result of
 * a search that matched nobody, with a confident count beside it.
 *
 * An EMPTY box is the other thing entirely: it is not a search at all, and every
 * member is the honest answer to it.
 */
function searchedMembers(
  members: readonly MemberListRow[],
  search: string,
): readonly MemberListRow[] {
  const query = search.trim();

  if (query === NO_TEXT) return members;

  const folded = foldForSearch(query);

  // TRIMMED AGAIN, and the second trim is not the first one repeating itself.
  // The fold removes combining marks from the MIDDLE of the query as well as
  // from its ends, so `"\u0300 \u0301"` — two marks with a space between them —
  // survives the first trim as a non-empty query and folds to a lone space,
  // which `includes` then finds in every member whose name has one. What is left
  // after folding has to carry something before it can select anybody.
  if (folded.trim() === NO_TEXT) return [];

  return members.filter((member) => matches(member, folded));
}

/** How many of each level a set of members holds, keyed the filter's own way. */
export type LevelCounts = Readonly<Record<LevelFilter, number>>;

export interface MembersNarrowing {
  /** The rows to render, searched, filtered and ordered. */
  readonly rows: readonly MemberListRow[];
  /** What each level option would yield from the same search and team. */
  readonly counts: LevelCounts;
  /**
   * The team filter's options, in binding order — every team, the teams
   * somebody is on today by name, and no team — each with what it would yield
   * from the same search and level.
   */
  readonly teams: readonly TeamFilterOption[];
  /** What each status option would yield from the same search, level and team (story 7.13). */
  readonly statuses: Readonly<Record<StatusFilter, number>>;
  /**
   * The team the rows were actually narrowed by: the one asked for, or
   * {@link ALL_TEAMS} when it is not among {@link teams} any more. The
   * `<select>` shows THIS, so it never claims a team the rows ignore.
   */
  readonly team: TeamFilter;
}

/**
 * Two values in this column's order, or `0` where the column cannot compare
 * them. Strings go through the Croatian collator; numbers subtract.
 */
function compareValues(first: string | number, second: string | number): number {
  if (typeof first === 'string' && typeof second === 'string') return compareText(first, second);
  if (typeof first === 'number' && typeof second === 'number') return first - second;

  return 0;
}

/**
 * A TOTAL order over members: the column's own value, then the name, then the id.
 *
 * THE TIE-BREAKS ARE WHAT MAKE DESCENDING A MIRROR OF ASCENDING. Without them
 * `sort()` leaves equal values in whatever order they arrived and `reverse()`
 * then INVERTS that arbitrary order — so two members with the same allowance
 * swap places when the direction changes, for no reason a person can see. It is
 * acute on the permission level, where four hundred rows carry two distinct
 * values: pressing the heading twice would reshuffle the whole list rather than
 * turn it over.
 *
 * The id is the last resort and it is what makes the order genuinely total: two
 * members may share a name, and `members.id` is a primary key. With no ties left
 * anywhere, reversing is the exact mirror, which is the property
 * `features/members/services/list.test.ts` asserts rather than assumes.
 */
function compareMembers(
  first: { readonly member: MemberListRow; readonly value: string | number },
  second: { readonly member: MemberListRow; readonly value: string | number },
): number {
  const byValue = compareValues(first.value, second.value);
  if (byValue !== 0) return byValue;

  const byName = compareText(first.member.name, second.member.name);
  if (byName !== 0) return byName;

  return compareText(first.member.id, second.member.id);
}

/** The same total order for the members a column has no value for. */
function compareByName(first: MemberListRow, second: MemberListRow): number {
  const byName = compareText(first.name, second.name);

  return byName !== 0 ? byName : compareText(first.id, second.id);
}

/**
 * The rows the surface renders AND the counts beside its filter, from one call.
 *
 * ONE FUNCTION FOR BOTH, and that is the decision rather than a convenience: the
 * counts describe the rows, and computed separately the two drift — a filter
 * promising twelve beside three rows is the defect, and it is the kind nobody
 * reports because each half looks right on its own. Here they are the same
 * traversal.
 *
 * THE COUNTS ARE FACETED. Each option says how many rows choosing it would
 * produce with everything else as it is: a level option counts over the search
 * and the chosen team, a team option over the search and the chosen level —
 * which is what makes the numbers an answer to "what happens if I pick this"
 * rather than a static fact about the organization. Counting after an axis's
 * own filter would make every option but the chosen one read zero, and
 * counting over the search alone would disagree with the rows the moment the
 * other axis is narrowed.
 *
 * THE TEAM IS TODAY'S, and nothing while today is unknown: with no today there
 * is no honest answer to "who is on which team", so the only option is every
 * team and the team axis narrows nothing. A chosen team nobody in the snapshot
 * is on any more narrows nothing either — it is not an option, so it cannot be
 * a filter.
 *
 * ADDRESS-LESS MEMBERS SORT LAST IN BOTH DIRECTIONS. A member with no address is
 * not "before A" or "after Z" — they have no place in an alphabetical order at
 * all — so they are partitioned out and appended, and reversing the direction
 * reverses the members who HAVE an address rather than floating the ones who do
 * not to the top. `features/members/services/list.test.ts` pins both directions, because the
 * obvious implementation (sort with `null` as the empty string) gets exactly one
 * of the two right.
 */
export function narrowMembers(
  members: readonly MemberListRow[],
  search: string,
  level: LevelFilter,
  sort: SortState,
  today: string | null = null,
  team: TeamFilter = ALL_TEAMS,
  status: StatusFilter = STATUS_ALL,
): MembersNarrowing {
  const searched = searchedMembers(members, search);

  // THE OPTIONS FIRST, from the whole snapshot, because whether the chosen
  // team still counts as a filter depends on whether it is still one of them.
  const named = today === null ? [] : teamsOnToday(members, today);
  const values: TeamFilter[] =
    today === null ? [ALL_TEAMS] : [ALL_TEAMS, ...named.map((known) => known.id), NO_TEAM];
  const applied = values.includes(team) ? team : ALL_TEAMS;

  const counts: Record<LevelFilter, number> = {
    [ALL_LEVELS]: 0,
    admin: 0,
    member_role: 0,
  };
  const teamCounts = new Map<TeamFilter, number>(values.map((value) => [value, 0]));
  const statuses: Record<StatusFilter, number> = { [STATUS_ACTIVE]: 0, [STATUS_INACTIVE]: 0, [STATUS_ALL]: 0 };
  const filtered: MemberListRow[] = [];

  // ONE TRAVERSAL for the rows and every set of counts, so none of them can
  // drift from the others. Each axis counts over the other two (faceted).
  for (const member of searched) {
    // `null` IS "UNKNOWN", never a filter value: with no today there is no team
    // to count a member under, and only the every-team option exists.
    const onTeam: TeamFilter | null = today === null ? null : teamFilterValueOf(member, today);
    const levelMatches = level === ALL_LEVELS || member.role === level;
    const teamMatches = applied === ALL_TEAMS || onTeam === applied;
    const statusMatch = statusMatches(member, status, today);

    if (teamMatches && statusMatch) {
      counts[ALL_LEVELS] += 1;
      counts[member.role] += 1;
    }

    if (levelMatches && statusMatch) {
      teamCounts.set(ALL_TEAMS, (teamCounts.get(ALL_TEAMS) ?? 0) + 1);
      if (onTeam !== null) teamCounts.set(onTeam, (teamCounts.get(onTeam) ?? 0) + 1);
    }

    if (levelMatches && teamMatches) {
      statuses[STATUS_ALL] += 1;
      if (today !== null) statuses[memberStatusOf(member, today).activeToday ? STATUS_ACTIVE : STATUS_INACTIVE] += 1;
    }

    if (levelMatches && teamMatches && statusMatch) filtered.push(member);
  }

  const names = new Map(named.map((known) => [known.id, known.name]));
  const teams: TeamFilterOption[] = values.map((value) => ({
    value,
    team: names.get(value) ?? NO_TEXT,
    count: teamCounts.get(value) ?? 0,
  }));

  const column = MEMBER_COLUMNS.find((candidate) => candidate.key === sort.key);
  // A sort key no column owns orders nothing rather than throwing: the state is
  // this module's own and cannot reach that, but a `!` here would turn a future
  // mistake into a blank screen instead of an unsorted one.
  if (column === undefined) return { rows: filtered, counts, teams, statuses, team: applied };

  // DECORATED once rather than read inside the comparator, which is called
  // O(n log n) times: at Q20's several hundred members that is a few thousand
  // extra property reads per keystroke, and for the name column a few thousand
  // extra folds. It is also what removes the `null` from the comparator's
  // argument types, so nothing here has to invent a value for a member who has
  // none.
  const present: { readonly member: MemberListRow; readonly value: string | number }[] = [];
  const absent: MemberListRow[] = [];

  for (const member of filtered) {
    const value = column.sortValue(member, today);

    if (value === null) absent.push(member);
    else present.push({ member, value });
  }

  present.sort(compareMembers);
  absent.sort(compareByName);

  // REVERSED BLOCK BY BLOCK, which keeps two properties that pull in opposite
  // directions. Both orders are total, so reversing is the exact MIRROR of
  // ascending rather than a reshuffle of whatever order equal values arrived in.
  // And the members a column has no value for stay at the END either way: they
  // have no place in the order at all, so floating them to the top when the
  // direction flips would be the list inventing one for them.
  if (sort.direction === DESCENDING) {
    present.reverse();
    absent.reverse();
  }

  return {
    rows: [...present.map((entry) => entry.member), ...absent],
    counts,
    teams,
    statuses,
    team: applied,
  };
}

/**
 * Everything the narrowing depends on, in one object.
 *
 * WHY THIS EXISTS AT ALL: `pages/ljudi.tsx` memoizes the narrowing, and a
 * dependency dropped from that array is invisible here — `eslint.config.js`
 * registers no `react-hooks` plugin, so nothing lints the list, and the screen
 * is executed by no test. Removing `sort` left the suite green and eslint clean
 * while the arrow flipped and the rows never moved.
 *
 * Naming the inputs once, and DERIVING the dependency array from the same
 * object the call consumes, is what closes that: the two cannot disagree,
 * because there is only one of them. `features/members/services/list.test.ts` pins the array's
 * contents, so a field dropped from {@link narrowingDependencies} is a failing
 * test rather than a stale table.
 */
export interface NarrowingInputs {
  readonly members: readonly MemberListRow[] | null;
  readonly search: string;
  readonly level: LevelFilter;
  /** The team filter's value; {@link narrowMembers} decides whether it applies. */
  readonly team: TeamFilter;
  /** The status filter's value (story 7.13). */
  readonly status: StatusFilter;
  readonly sort: SortState;
  /** The organization's today, which the team column sorts by (story 1.7b). */
  readonly today: string | null;
}

/**
 * The memo's dependency array, derived from the inputs rather than written
 * beside them.
 *
 * Every field of {@link NarrowingInputs}, in declaration order, and the test
 * that pins it compares against the object's own keys — so a SEVENTH input added
 * to the narrowing and forgotten here fails rather than producing a table that
 * quietly stops responding to it.
 */
export function narrowingDependencies(inputs: NarrowingInputs): readonly unknown[] {
  return [inputs.members, inputs.search, inputs.level, inputs.team, inputs.status, inputs.sort, inputs.today];
}

/** The narrowing, from the same object the dependencies are derived from. */
export function narrowFrom(inputs: NarrowingInputs): MembersNarrowing {
  return narrowMembers(
    inputs.members ?? [],
    inputs.search,
    inputs.level,
    inputs.sort,
    inputs.today,
    inputs.team,
    inputs.status,
  );
}

/** Everything the member list draws from one set of inputs. */
export interface MembersView {
  /** The summary line: the rows SHOWN, or `null` before there is an answer. */
  readonly summary: MembersSummary | null;
  /** The table's rows and the filters' counts. */
  readonly narrowed: MembersNarrowing;
}

/**
 * The summary and the narrowing, from the same inputs, in ONE call the screen
 * makes (story 7.13).
 *
 * THE SUMMARY COUNTS THE NARROWED ROWS, the very array the table draws, so
 * the line and the rows cannot disagree; this is the function the screen
 * calls, so the claim is executed here rather than hoped for in a `.tsx`.
 */
export function membersViewOf(inputs: NarrowingInputs): MembersView {
  const narrowed = narrowFrom(inputs);

  return {
    summary: inputs.members === null ? null : membersSummaryOf(narrowed.rows, inputs.today),
    narrowed,
  };
}

/**
 * What the members query settles to: the list, or the policy's refusal.
 *
 * NARROWER THAN {@link MembersOutcome} on purpose. `MEMBERS_UNAVAILABLE` is
 * never resolved data — {@link membersQueryOptions} rejects on it — so the
 * only failure a settled answer can carry is `MEMBERS_REFUSED`.
 */
export type MembersSettled =
  | { readonly ok: true; readonly members: readonly MemberListRow[] }
  | { readonly ok: false; readonly code: typeof MEMBERS_REFUSED };

/**
 * The one query definition every screen reading {@link MEMBERS_LIST_KEY} uses.
 *
 * TWO FAILURES, TWO TREATMENTS:
 *
 *   - `MEMBERS_UNAVAILABLE` IS TRANSIENT, so it REJECTS. TanStack Query then
 *     retries it, and on a failed refetch keeps the previous `data` beside
 *     `isError`. Resolved as data instead, it replaced a good cached list the
 *     moment any write's invalidation refetched into a blip, and `retry` never
 *     ran.
 *   - `MEMBERS_REFUSED` IS SETTLED — the policy's answer, not a fault — so it
 *     stays resolved data: not retried, and allowed to replace rows, because a
 *     session the database now declines should stop seeing the list.
 *
 * THE TABLE IS RESOLVED INSIDE THE QUERY FUNCTION, so `supabaseClient()`
 * raising `SUPABASE_ENVIRONMENT_MISSING` is a query rejection as well.
 */
export function membersQueryOptions(table: () => MembersTable) {
  return queryOptions({
    queryKey: MEMBERS_LIST_KEY,
    queryFn: async (): Promise<MembersSettled> => {
      const outcome = await readMembers(table());

      if (outcome.ok) return outcome;

      const code = outcome.code;

      // EXHAUSTIVE, so a new `MembersFailure` code fails to compile here rather
      // than being relabelled a refusal or silently resolved as data.
      switch (code) {
        case MEMBERS_REFUSED:
          return { ok: false, code };
        case MEMBERS_UNAVAILABLE:
          throw new Error(code);
        default: {
          const unhandled: never = code;
          return unhandled;
        }
      }
    },
    // BOUNDED, because this is the most expensive read in the application:
    // several hundred rows AND an exact count, which costs the database a second
    // pass over the same index. Unbounded, every window focus re-runs it — an
    // admin who alt-tabs to their mail and back re-reads the whole organization
    // for a list that has not changed. See `MEMBERS_READ_STALE_MS`.
    staleTime: MEMBERS_READ_STALE_MS,
    refetchOnWindowFocus: false,
    // ONE RETRY, ONE SECOND APART, not TanStack's three with backoff (~7 s). A
    // write awaits the invalidation's refetch before releasing its busy lock, so
    // the default held Save disabled for seconds after a write that had landed.
    retry: 1,
    retryDelay: 1000,
  });
}

/**
 * As much of a TanStack Query result as this surface reads.
 *
 * A STRUCTURAL PARAMETER, the same shape the table seam above is, and for the
 * same reason: the derivation below decides what the screen shows, and a
 * derivation that could only be driven by mounting a component would be a
 * derivation no test in this repository executes.
 */
export interface MembersQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  /** The last settled answer, kept by TanStack Query across a failed refetch. */
  readonly data: MembersSettled | undefined;
}

/** What the surface renders: rows, a skeleton, a message, or a combination. */
export interface MembersSurfaceState {
  /** The rows to narrow and draw, or `null` when there are none to draw. */
  readonly members: readonly MemberListRow[] | null;
  /** The message to show, or `null`. */
  readonly refusal: MembersFailure | null;
  /** Whether to pulse the skeleton. Never true beside a message. */
  readonly loading: boolean;
  /**
   * A REFETCH PAUSED OFFLINE OVER CACHED ROWS. Not a refusal: an edit form
   * built on this state stays mounted with what was typed. A list screen
   * announces it through {@link membersNoticeOf}, the unavailable message beside the
   * kept rows.
   */
  readonly paused: boolean;
}

/**
 * One query result as the things the screen can be showing.
 *
 * Every one of these was a defect in this surface at some point:
 *
 *   - ANSWERED. The list, drawn.
 *   - REFUSED. The policy answered with zero rows, which
 *     {@link membersQueryOptions} resolves as settled data. No rows, the
 *     refusal's own message, and no retry.
 *   - FAILED. Every unavailable read REJECTS — `readMembers`' own
 *     `MEMBERS_UNAVAILABLE`, rethrown by the query options, and
 *     `supabaseClient()` raising `SUPABASE_ENVIRONMENT_MISSING` on a build with
 *     no environment — so once TanStack's retries are spent it arrives as
 *     `isError` with no `data`. A version reading only `data` once left that
 *     case rendering headings with no rows, no count and no message.
 *   - PAUSED. TanStack Query pauses rather than fails when the browser reports
 *     itself offline: `isPending` stays true with nothing in flight and no error
 *     ever arriving, so the skeleton pulses for ever with nothing saying why.
 *     A REFETCH paused over a cached answer is NOT a refusal: it is `paused`,
 *     so the edit form over the cached row keeps what was typed, and the list
 *     announces it through {@link membersNoticeOf} beside the kept rows.
 *     `fetchStatus` alone says so, since `isPending` is false once anything is
 *     cached.
 *   - FAILED OVER A GOOD ANSWER. A refetch that fails while a complete list is
 *     already cached — a network blip after a write's invalidation, on a screen
 *     someone is looking at. Because the failure rejects, TanStack keeps the
 *     previous `data` beside `isError`: the rows are KEPT and the message is
 *     shown BESIDE them. Stale data plainly labelled as troubled beats no data
 *     at all, and the alternative asks somebody to reload to see what they were
 *     already looking at. Over a cached REFUSAL the current fault wins: the
 *     message is the unavailable one, and there are still no rows.
 *
 * `loading` and `refusal` are never both set: a skeleton beside an explanation
 * says the surface is both working and broken.
 */
export function membersSurfaceStateOf(answer: MembersQueryAnswer): MembersSurfaceState {
  const answered = answer.data;
  const members = answered !== undefined && answered.ok ? answered.members : null;
  const pausedFetch = answer.fetchStatus === FETCH_PAUSED;

  // THE CURRENT FAULT WINS: a refetch that failed over a cached refusal is
  // unavailable now, whatever the policy said last time.
  if (answer.isError || (answer.isPending && pausedFetch)) {
    return { members, refusal: MEMBERS_UNAVAILABLE, loading: false, paused: false };
  }

  // A PAUSE OVER A CACHED REFUSAL keeps that refusal: nothing new arrived.
  if (answered !== undefined && !answered.ok) {
    return { members: null, refusal: answered.code, loading: false, paused: pausedFetch };
  }

  return { members, refusal: null, loading: answer.isPending, paused: pausedFetch };
}

/**
 * What the LIST screen announces: the refusal, or over rows a refetch paused
 * offline, the unavailable message beside them. The edit form reads `refusal`.
 */
export function membersNoticeOf(state: MembersSurfaceState): MembersFailure | null {
  return state.refusal ?? (state.paused ? MEMBERS_UNAVAILABLE : null);
}
