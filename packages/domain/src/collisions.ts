/**
 * Collisions between leave and the schedule (story 5.3a; engine rules R6.1,
 * R6.2, R6.5, R6.8, R7.1, R7.3; AD-4, AD-7, AD-8).
 *
 * The ONE collision rule. Which rostered working shifts a member's leave
 * collides with is derived here, on read, and nowhere else: there is no
 * conflicts table, no cached set, and no database routine that computes one.
 * A collision is `leave ∩ working shift ∩ roster` (AD-4), so nothing can
 * expire, miss or suppress it (R6.3, R6.5) — re-deriving from the live leave
 * records and schedule is the only way it changes.
 *
 * THE RULE (R6.1): one collision per `(memberId, date, teamId)`. It exists
 * when a leave record of the member covers the date, the member is active on
 * it ({@link activeOn}), and their schedule on it —
 * {@link memberScheduleOfMonth}, so it follows the shift-type and roster
 * overrides the caller passes — holds a WORKING shift of that team: their own
 * team's, or one a roster override puts them on. That is exactly the scope of
 * {@link isLeaveDay} and of the leave cost, per shift instead of per date, so
 * for every member the distinct collision dates are what
 * {@link leaveCostOf} charges over their records. Two working shifts of two
 * teams on one date are two collisions and one leave day.
 *
 * A non-working shift raises nothing; a member taken off their shift by a
 * roster override raises nothing for it. A member on no team raises nothing
 * (R7.1), meaning they have no own-team shift to collide with: if an active
 * member on no team is PUT ON another team's working shift by a roster
 * override, they are rostered on it and raise one collision, exactly as
 * {@link leaveCostOf} charges that date. A date the member is inactive raises
 * nothing, whatever a roster override puts them on, while their earlier
 * active dates still raise (R7.3).
 *
 * Detection reads its input and writes nothing (R6.2): no shift, record or
 * override is deleted, hidden or altered. The result is ids and dates only —
 * no name and no text (AD-8) — ordered soonest first (R6.8), then by team,
 * then by member. Resolutions (story 5.4a) match a collision by
 * {@link collisionKeyOf}; none is read by {@link collisionsOf}, and
 * {@link unresolvedCollisionsOf} is the one filter that drops the resolved.
 *
 * Ranges are inclusive `from`–`to` calendar dates as in `leave.ts`. Dates are
 * `YYYY-MM-DD` strings: no `Date`, no time zone. Every breached precondition
 * throws a `RangeError` naming the offending value.
 */

import { activeOn, type RosterMember } from './roster.js';
import { checkRange, isLeaveDay, type LeaveRange } from './leave.js';
import { adjacentMonth, memberScheduleOfMonth, monthOf, type MemberScheduleDay, type MemberScheduleInput } from './schedule.js';

/** One live leave record of one member, as stored (`leave_records`). */
export interface CollisionLeaveRecord extends LeaveRange {
  readonly id: string;
  readonly memberId: string;
}

/**
 * What an organization's collisions are derived from: the shared schedule
 * fields of {@link MemberScheduleInput} — every member, with their membership
 * and status histories, in `members` — and every live leave record.
 */
export interface CollisionInput
  extends Pick<MemberScheduleInput, 'assignments' | 'steps' | 'overrides' | 'members' | 'rosterOverrides' | 'workingShiftTypeIds'> {
  /** Every live leave record, of any member of `members`, in any order; no two of one member share a date. */
  readonly leaveRecords: readonly CollisionLeaveRecord[];
}

/**
 * One collision: the member on leave, the date, the team whose working shift
 * they are rostered on, the shift type it works, and the leave record that
 * covers the date.
 */
export interface Collision {
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly leaveRecordId: string;
}

/**
 * The key of a collision — `(memberId, date, teamId)`, which identifies it
 * whatever shift type or record it carries — and the key a conflict
 * resolution matches on (AD-4).
 *
 * In memory only, for matching: it is not a persisted format. Story 5.4
 * stores the columns `(member_id, date, team_id)`, never this string.
 */
export function collisionKeyOf(collision: Pick<Collision, 'memberId' | 'date' | 'teamId'>): string {
  return JSON.stringify([collision.memberId, collision.date, collision.teamId]);
}

/**
 * Every precondition of the leave records, and the records grouped by member.
 *
 * @throws RangeError on any precondition of {@link collisionsOf} about records.
 */
function recordsByMember(input: CollisionInput): ReadonlyMap<RosterMember, readonly CollisionLeaveRecord[]> {
  const members = new Map<string, RosterMember>();
  for (const member of input.members) {
    if (members.has(member.id)) {
      throw new RangeError(`member ${JSON.stringify(member.id)} is given twice among the members`);
    }
    members.set(member.id, member);
  }

  const ids = new Set<string>();
  const byMember = new Map<RosterMember, CollisionLeaveRecord[]>();
  for (const record of input.leaveRecords) {
    if (ids.has(record.id)) {
      throw new RangeError(`leave record ${JSON.stringify(record.id)} is given twice`);
    }
    ids.add(record.id);
    checkRange(`leave record ${JSON.stringify(record.id)}`, record);
    const member = members.get(record.memberId);
    if (member === undefined) {
      throw new RangeError(`leave record ${JSON.stringify(record.id)} belongs to member ${JSON.stringify(record.memberId)}, who is not among the members`);
    }
    const records = byMember.get(member);
    if (records === undefined) byMember.set(member, [record]);
    else records.push(record);
  }

  for (const [member, records] of byMember) {
    const byStart = [...records].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    for (let i = 1; i < byStart.length; i += 1) {
      const before = byStart[i - 1]!;
      const after = byStart[i]!;
      if (after.from <= before.to) {
        throw new RangeError(
          `leave records ${JSON.stringify(before.id)} and ${JSON.stringify(after.id)} of member ${JSON.stringify(member.id)} share ${JSON.stringify(after.from)}; records of one member never overlap`,
        );
      }
    }
  }
  return byMember;
}

/** Orders collisions soonest first, then by team, then by member (R6.8). */
function compareCollisions(left: Collision, right: Collision): number {
  for (const field of ['date', 'teamId', 'memberId'] as const) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
}

/**
 * Every collision of the organization (R6.1): for each leave record, each of
 * its dates on which its member is active, and each WORKING shift of their
 * schedule on that date, one collision per team. Soonest first, then by
 * `teamId`, then by `memberId` (R6.8). Reads `input` and writes nothing (R6.2).
 *
 * @throws RangeError when two members of `members` share an id; when two
 *   leave records share an id; when the start or
 *   end of a record is not a calendar `YYYY-MM-DD`, it ends before it starts,
 *   or it is longer than `MAX_LEAVE_RANGE_DAYS`; when a record's member is not
 *   among `members`; when two records of one member share a date; and on any
 *   precondition of {@link memberScheduleOfMonth} for a member with a record.
 */
export function collisionsOf(input: CollisionInput): readonly Collision[] {
  const collisions: Collision[] = [];

  for (const [member, records] of recordsByMember(input)) {
    const memberInput: MemberScheduleInput = {
      memberId: member.id,
      memberships: member.memberships,
      statuses: member.statuses,
      assignments: input.assignments,
      steps: input.steps,
      overrides: input.overrides,
      members: input.members,
      rosterOverrides: input.rosterOverrides,
      workingShiftTypeIds: input.workingShiftTypeIds,
    };
    const months = new Map<string, readonly MemberScheduleDay[]>();
    const scheduleOf = (month: string): readonly MemberScheduleDay[] => {
      let days = months.get(month);
      if (days === undefined) {
        days = memberScheduleOfMonth(memberInput, month);
        months.set(month, days);
      }
      return days;
    };

    for (const record of records) {
      const last = monthOf(record.to);
      for (let month: string | null = monthOf(record.from); month !== null; month = month === last ? null : adjacentMonth(month, 1)) {
        for (const day of scheduleOf(month)) {
          // Redundant today, kept on purpose: `memberScheduleOfMonth` drops the own team on an inactive date,
          // and a put-on override is inert for an inactive member because `rosterOverrideApplies` reads the
          // same statuses from `members`. Both hold only because this member's input is built from `members`;
          // the guard applies the cost's own `activeOn` rule so the agreement with `leaveCostOf` (which
          // guards the same way) never rests on that coupling.
          if (day.date < record.from || day.date > record.to || !activeOn(member.statuses, day.date)) continue;
          // Defensive only: one team cannot appear twice on a date, because `rosterOverrideApplies` refuses
          // to put on a member already on that roster.
          const teams = new Set<string>();
          for (const shift of day.shifts) {
            // The per-date rule of the cost, applied to this one shift: the two can never disagree.
            if (shift.shiftTypeId === null || teams.has(shift.teamId) || !isLeaveDay({ date: day.date, shifts: [shift] }, input.workingShiftTypeIds)) continue;
            teams.add(shift.teamId);
            collisions.push({ memberId: member.id, date: day.date, teamId: shift.teamId, shiftTypeId: shift.shiftTypeId, leaveRecordId: record.id });
          }
        }
      }
    }
  }

  return collisions.sort(compareCollisions);
}

/**
 * One live conflict resolution, as far as matching goes (story 5.4a): the
 * `(memberId, date, teamId)` it was recorded against. Its kind and author do
 * not bear on whether a collision is resolved, so they are not read here.
 */
export interface CollisionResolution {
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
}

/**
 * The ONE resolution filter (story 5.4a; AD-4): `collisions` without each one
 * that a live resolution matches by {@link collisionKeyOf}, in their given
 * order. A resolution on another team's key of the same member and date drops
 * nothing, and a resolution that matches no collision has no effect. Every
 * surface that counts or lists unresolved conflicts derives through this, so
 * they agree on one set. Reads its input and writes nothing.
 */
export function unresolvedCollisionsOf(collisions: readonly Collision[], resolutions: readonly CollisionResolution[]): readonly Collision[] {
  if (resolutions.length === 0) return collisions;
  const resolved = new Set(resolutions.map(collisionKeyOf));
  return collisions.filter((collision) => !resolved.has(collisionKeyOf(collision)));
}
