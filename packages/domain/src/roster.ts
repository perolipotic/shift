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
 * LOANS (story 18.1, engine rules R11): a Loan lends a member to another team
 * for an inclusive date range. On a date it covers, the member's EFFECTIVE
 * team ({@link effectiveTeamOn}) is the loan team, else it is the home team of
 * {@link membershipOn} (R11.1); every roster is built from effective teams
 * (R11.2), so everything that reads a roster — the member's month, hours,
 * leave cost, collisions, staffing, a swap's validity — follows a loan with
 * no second implementation. A loan changes no membership version and no
 * rotation (R11.5). A member with no loans derives exactly as before (R11.4).
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

/**
 * One Loan of a member (story 18.1, R11): from `from` to `to`, both inclusive
 * calendar dates, the member works with `teamId` instead of their home team.
 * The member is the one whose `loans` hold it. A Loan is an exception, never a
 * version: it is dated, removable, and loans of one member never share a date
 * (R11.3).
 */
export interface Loan {
  readonly id: string;
  readonly teamId: string;
  readonly from: string;
  readonly to: string;
}

/** What a roster is derived from: one member's id, their two version histories and their loans. */
export interface RosterMember {
  readonly id: string;
  /** Every membership version of this member, in any order. */
  readonly memberships: readonly MembershipVersion[];
  /** Every status version of this member, in any order. */
  readonly statuses: readonly StatusVersion[];
  /** Every live Loan of this member, in any order (story 18.1); absent or empty, they are never lent. */
  readonly loans?: readonly Loan[] | undefined;
}

/**
 * The team a member works with on a date (R11.1): `teamId`, their position in
 * it, and the Loan that put them there — `null` on their home team. On a loan
 * team the position is `null`: a position is held in the home team.
 */
export interface EffectiveTeamOn extends MembershipOn {
  readonly loanId: string | null;
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
 * Every precondition of one member's loans (R11.3): each `from` and `to` a
 * calendar date, `from` on or before `to`, ids distinct, and no two loans
 * sharing a date. A loan to the member's home team is NOT a breach here: the
 * home team is versioned, so a later team move can make it so, and on such a
 * date the effective team is the home team either way. Refusing one when it
 * is written is the store's (story 18.2).
 *
 * @throws RangeError on the first breach, naming it.
 */
export function checkLoans(loans: readonly Loan[]): void {
  const ids = new Set<string>();
  for (const loan of loans) {
    checkDate(`loan ${loan.id} to team ${loan.teamId} starts on`, loan.from);
    checkDate(`loan ${loan.id} to team ${loan.teamId} ends on`, loan.to);
    if (loan.to < loan.from) {
      throw new RangeError(`loan ${loan.id} runs from ${JSON.stringify(loan.from)} to ${JSON.stringify(loan.to)}, which ends before it starts`);
    }
    if (ids.has(loan.id)) throw new RangeError(`two loans have the id ${JSON.stringify(loan.id)}`);
    ids.add(loan.id);
  }
  const ordered = [...loans].sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0));
  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1]!;
    const after = ordered[index]!;
    if (after.from <= before.to) {
      throw new RangeError(`loans ${JSON.stringify(before.id)} and ${JSON.stringify(after.id)} share ${JSON.stringify(after.from)}; loans of one member never overlap`);
    }
  }
}

/**
 * The Loan of `loans` covering `date`, or `null` when none does.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, and on any
 *   precondition of {@link checkLoans}.
 */
export function loanOn(loans: readonly Loan[], date: string): Loan | null {
  checkDate('the date', date);
  checkLoans(loans);
  return loans.find((loan) => loan.from <= date && date <= loan.to) ?? null;
}

/**
 * THE LOAN RULE (R11.1): the team a member works with on `date` — the loan
 * team when one of their loans covers it, with no position; else their home
 * team and position ({@link membershipOn}), or `null` when they have none. A
 * member on no team can be lent. Active status is not read here: an inactive
 * member is on no roster whatever their effective team.
 *
 * With no loan covering `date`, or one naming the home team that date (which
 * the store refuses, but a later team move can produce), this is
 * {@link membershipOn} with `loanId: null`: the home team, position kept.
 *
 * @throws RangeError on any precondition of {@link membershipOn} or {@link loanOn}.
 */
export function effectiveTeamOn(
  member: Pick<RosterMember, 'memberships' | 'loans'>,
  date: string,
): EffectiveTeamOn | null {
  const home = membershipOn(member.memberships, date);
  const loan = loanOn(member.loans ?? [], date);
  if (loan === null || loan.teamId === home?.teamId) return home === null ? null : { ...home, loanId: null };
  return { teamId: loan.teamId, position: null, loanId: loan.id };
}

/**
 * The roster of `teamId` on `date` (R11.2): every member of `members` who is
 * active on that date ({@link activeOn}) and whose EFFECTIVE team on it
 * ({@link effectiveTeamOn}) is `teamId`, with their position, in the order of
 * `members`. With no loan, the effective team is the home team of
 * {@link membershipOn}, so the roster is exactly the one before loans (R11.4).
 *
 * @throws RangeError on any precondition of {@link activeOn} or
 *   {@link effectiveTeamOn} for any member.
 */
export function shiftRoster(members: readonly RosterMember[], teamId: string, date: string): readonly RosterEntry[] {
  checkDate('the date', date);
  const roster: RosterEntry[] = [];
  for (const member of members) {
    const membership = effectiveTeamOn(member, date);
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
