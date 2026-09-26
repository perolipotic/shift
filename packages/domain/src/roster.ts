/**
 * Who belongs where on a date (story 3.4a; CAP-11, AD-2, FR-12).
 *
 * Team membership (with position) and member active status are versioned
 * rules, selected by the date being derived: the version with the greatest
 * `effectiveFrom` on or before the date is the one in effect. A team's roster
 * on a date is its members active on that date — including members
 * deactivated since, because the date, not today, decides.
 *
 * Roster overrides (story 3.6) layer on top of {@link shiftRoster}; there are
 * none yet. Rank and position are carried, never read by a rule.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate } from './calendar.js';

/**
 * One stored version of a member's team membership
 * (`team_membership_versions`): from `effectiveFrom` on, until the next
 * version, the member belongs to `teamId` — or to no team when it is `null` —
 * in `position` (`null` when none is recorded).
 */
export interface MembershipVersion {
  readonly teamId: string | null;
  readonly position: string | null;
  readonly effectiveFrom: string;
}

/**
 * One stored version of a member's active status (`member_status_versions`):
 * from `effectiveFrom` on, until the next version, the member is `active` or
 * not.
 */
export interface StatusVersion {
  readonly active: boolean;
  readonly effectiveFrom: string;
}

/** The team a member belongs to on a date, and their position in it. */
export interface MembershipOn {
  readonly teamId: string;
  readonly position: string | null;
}

/** What a roster is derived from: one member's id and their two version histories. */
export interface RosterMember {
  readonly id: string;
  /** Every membership version of this member, in any order. */
  readonly memberships: readonly MembershipVersion[];
  /** Every status version of this member, in any order. */
  readonly statuses: readonly StatusVersion[];
}

/** One member on a team's roster on a date. */
export interface RosterEntry {
  readonly memberId: string;
  readonly position: string | null;
}

/**
 * `versions` sorted by `effectiveFrom`, each date checked and none repeated.
 *
 * @throws RangeError when an `effectiveFrom` is not a calendar `YYYY-MM-DD`,
 *   or when two versions share one.
 */
export function orderedVersions<Version extends { readonly effectiveFrom: string }>(
  what: string,
  versions: readonly Version[],
): readonly Version[] {
  const seen = new Set<string>();
  for (const version of versions) {
    checkDate(`a ${what} version is effective from`, version.effectiveFrom);
    if (seen.has(version.effectiveFrom)) {
      throw new RangeError(`two ${what} versions are effective from ${version.effectiveFrom}`);
    }
    seen.add(version.effectiveFrom);
  }
  return [...versions].sort((left, right) => (left.effectiveFrom < right.effectiveFrom ? -1 : 1));
}

/**
 * The version in effect on `date` among versions already ordered by
 * {@link orderedVersions}, or `undefined` before the first.
 */
export function versionOn<Version extends { readonly effectiveFrom: string }>(
  ordered: readonly Version[],
  date: string,
): Version | undefined {
  let found: Version | undefined;
  for (const version of ordered) {
    if (version.effectiveFrom > date) break;
    found = version;
  }
  return found;
}

/**
 * Whether a member is active on `date`: the status version with the greatest
 * `effectiveFrom` on or before it, and `true` when there is none — exactly as
 * `member_active_on` (0008) judges it.
 *
 * @throws RangeError when `date` or a version's `effectiveFrom` is not a
 *   calendar `YYYY-MM-DD`, or when two versions share an `effectiveFrom`.
 */
export function activeOn(statuses: readonly StatusVersion[], date: string): boolean {
  checkDate('the date', date);
  return versionOn(orderedVersions('member status', statuses), date)?.active ?? true;
}

/**
 * The team a member belongs to on `date`, with their position: the membership
 * version with the greatest `effectiveFrom` on or before it, or `null` when
 * there is none or that version names no team.
 *
 * @throws RangeError when `date` or a version's `effectiveFrom` is not a
 *   calendar `YYYY-MM-DD`, or when two versions share an `effectiveFrom`.
 */
export function membershipOn(memberships: readonly MembershipVersion[], date: string): MembershipOn | null {
  checkDate('the date', date);
  const version = versionOn(orderedVersions('team membership', memberships), date);
  if (version === undefined || version.teamId === null) return null;
  return { teamId: version.teamId, position: version.position };
}

/**
 * The roster of `teamId` on `date`: every member of `members` who is active on
 * that date ({@link activeOn}) and whose team on it ({@link membershipOn}) is
 * `teamId`, with their position, in the order of `members`.
 *
 * @throws RangeError on any precondition of {@link activeOn} or
 *   {@link membershipOn} for any member.
 */
export function shiftRoster(members: readonly RosterMember[], teamId: string, date: string): readonly RosterEntry[] {
  checkDate('the date', date);
  const roster: RosterEntry[] = [];
  for (const member of members) {
    const membership = membershipOn(member.memberships, date);
    const active = activeOn(member.statuses, date);
    if (active && membership !== null && membership.teamId === teamId) {
      roster.push({ memberId: member.id, position: membership.position });
    }
  }
  return roster;
}
