/**
 * Who belongs where on a date (story 3.4a; CAP-11, AD-2, FR-12).
 *
 * Team membership (with position) and member active status are versioned
 * rules, selected by the date being derived: the version with the greatest
 * `effectiveFrom` on or before the date is the one in effect. A team's roster
 * on a date is its members active on that date — including members
 * deactivated since, because the date, not today, decides.
 *
 * Roster overrides (story 3.6a) layer on top of {@link shiftRoster}: one
 * override takes a member off a team's shift on a date, puts one on, or both
 * at once — a replacement, one atomic row. {@link rosterOn} is the roster with
 * them applied; with none, it is {@link shiftRoster} exactly. Rank and
 * position are carried, never read by a rule.
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

/**
 * One live stored roster override (`roster_overrides`, story 3.6a): on
 * `date`, `memberOutId` is taken off the shift of `teamId` and `memberInId`
 * is put on it. Either may be `null` — a removal alone, or an addition alone
 * — but never both, and never the same member twice.
 */
export interface RosterOverride {
  readonly id: string;
  readonly teamId: string;
  readonly date: string;
  readonly memberOutId: string | null;
  readonly memberInId: string | null;
}

/** One member on a shift's roster once the roster overrides are applied. */
export interface RosterOnEntry extends RosterEntry {
  /** Put on the shift by an override; their `position` is then `null`. */
  readonly added: boolean;
}

/** A shift's roster with the roster overrides applied, and which of them were. */
export interface RosterOnDate<Override extends RosterOverride = RosterOverride> {
  /** The default roster less those taken off, in its order, then those put on, in the overrides' order. */
  readonly roster: readonly RosterOnEntry[];
  /** The members taken off, in the overrides' order. */
  readonly removed: readonly string[];
  /** The overrides that applied, in their order; every other one on the team and date is inert. */
  readonly applied: readonly Override[];
}

function rosterKeyOf(teamId: string, date: string): string {
  return `${teamId}\u0000${date}`;
}

/**
 * Every precondition of a set of live roster overrides: each date a calendar
 * date, each override naming at least one member and never one member twice,
 * and — as the live keys of `roster_overrides` have it — at most one override
 * per team and date taking a given member off, and at most one putting a
 * given member on.
 *
 * @throws RangeError on the first breach, naming it.
 */
export function checkRosterOverrides(overrides: readonly RosterOverride[]): void {
  const outs = new Set<string>();
  const ins = new Set<string>();
  for (const override of overrides) {
    checkDate(`roster override ${override.id} of team ${override.teamId} is dated`, override.date);
    if (override.memberOutId === null && override.memberInId === null) {
      throw new RangeError(`roster override ${override.id} takes no member off and puts no member on`);
    }
    if (override.memberOutId === override.memberInId) {
      throw new RangeError(`roster override ${override.id} takes member ${String(override.memberOutId)} off and puts them on`);
    }
    const key = rosterKeyOf(override.teamId, override.date);
    if (override.memberOutId !== null) {
      const out = `${key}\u0000${override.memberOutId}`;
      if (outs.has(out)) {
        throw new RangeError(`two roster overrides take member ${override.memberOutId} off team ${override.teamId} on ${override.date}`);
      }
      outs.add(out);
    }
    if (override.memberInId !== null) {
      const put = `${key}\u0000${override.memberInId}`;
      if (ins.has(put)) {
        throw new RangeError(`two roster overrides put member ${override.memberInId} on team ${override.teamId} on ${override.date}`);
      }
      ins.add(put);
    }
  }
}

/**
 * `overrides` indexed by team and date, in their order, after
 * {@link checkRosterOverrides}. INTERNAL to the package's derivations.
 *
 * @throws RangeError on any precondition of {@link checkRosterOverrides}.
 */
export function rosterOverridesByTeamAndDate<Override extends RosterOverride>(
  overrides: readonly Override[],
): ReadonlyMap<string, readonly Override[]> {
  checkRosterOverrides(overrides);
  const indexed = new Map<string, Override[]>();
  for (const override of overrides) {
    const key = rosterKeyOf(override.teamId, override.date);
    const known = indexed.get(key);
    if (known === undefined) indexed.set(key, [override]);
    else known.push(override);
  }
  return indexed;
}

/** The overrides of `teamId` on `date` in an index of {@link rosterOverridesByTeamAndDate}. INTERNAL. */
export function rosterOverridesAt<Override extends RosterOverride>(
  indexed: ReadonlyMap<string, readonly Override[]>,
  teamId: string,
  date: string,
): readonly Override[] {
  return indexed.get(rosterKeyOf(teamId, date)) ?? [];
}

/**
 * THE APPLIES RULE (story 3.6a), over the default roster of the override's
 * team and date: the member taken off must be on it, and the member put on
 * must not be, and must be ACTIVE on the date ({@link activeOn} over their
 * status versions in `members`; one `members` does not hold has none, and so
 * is active). An override that fails any of these is INERT — never applied,
 * never refused — so a stale one leaves the shift unchanged rather than
 * wrong, and a deactivated member is never shown working. The member put on
 * may be on their own team's shift that date too: a double shift, allowed.
 * The shift itself must be a working one; that is the caller's to know, and
 * it asks only then. INTERNAL.
 *
 * @throws RangeError on any precondition of {@link activeOn}.
 */
export function rosterOverrideApplies(
  defaultRoster: readonly RosterEntry[],
  members: readonly RosterMember[],
  override: RosterOverride,
): boolean {
  const on = (memberId: string): boolean => defaultRoster.some((entry) => entry.memberId === memberId);
  if (override.memberOutId !== null && !on(override.memberOutId)) return false;
  if (override.memberInId === null) return true;
  if (on(override.memberInId)) return false;
  const put = members.find((member) => member.id === override.memberInId);
  return activeOn(put?.statuses ?? [], override.date);
}

/**
 * The roster of `teamId` on `date` with the roster overrides applied (story
 * 3.6a): {@link shiftRoster}, less each member an applying override takes
 * off, plus each member one puts on — `added`, with no position. Only the
 * overrides of `teamId` on `date` are read, but every one is checked.
 *
 * ASK ONLY FOR A WORKING SHIFT: an override applies only on a team and date
 * whose scheduled type is a working one. On any other day there is no roster,
 * and every override on it is inert.
 *
 * With no applying override, `roster` is {@link shiftRoster} entry for entry,
 * each `added: false`.
 *
 * @throws RangeError on any precondition of {@link shiftRoster} or
 *   {@link checkRosterOverrides}.
 */
export function rosterOn<Override extends RosterOverride>(
  members: readonly RosterMember[],
  overrides: readonly Override[],
  teamId: string,
  date: string,
): RosterOnDate<Override> {
  const indexed = rosterOverridesByTeamAndDate(overrides);
  const base = shiftRoster(members, teamId, date);
  const applied = rosterOverridesAt(indexed, teamId, date).filter((override) =>
    rosterOverrideApplies(base, members, override),
  );
  const removed = applied.flatMap((override) => (override.memberOutId === null ? [] : [override.memberOutId]));
  const gone = new Set(removed);
  const roster: RosterOnEntry[] = base
    .filter((entry) => !gone.has(entry.memberId))
    .map((entry) => ({ ...entry, added: false }));
  for (const override of applied) {
    if (override.memberInId !== null) roster.push({ memberId: override.memberInId, position: null, added: true });
  }
  return { roster, removed, applied };
}
