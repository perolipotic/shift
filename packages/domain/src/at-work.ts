/**
 * A member's at-work shifts, R12 (story 16.2; AD-7, AD-19).
 *
 * THE ASSEMBLY. {@link ScheduleInputs} is the one shape a server projection
 * reads (AD-19): what `private.member_schedule_inputs(member, from, to)`
 * returns as `jsonb`, and what `apps/web`'s one adapter
 * (`scheduleInputsOfCalendar`) builds from the calendar snapshot and the
 * member's own leave. Asserted rows only, stamps included, and nothing
 * derived (AD-1). The two are held deep-equal by the read-parity suite.
 *
 * THE RULE. {@link atWorkShiftsOf} is R12, the ONE function the calendar feed,
 * the reminders and the browser's `.ics` download read (R12.3):
 *
 * - R12.1 a member's at-work shifts on a date are the WORKING shifts of their
 *   day in `memberScheduleOfMonth` — their effective team's after loans
 *   (R11), less a working shift a roster override in force took them off,
 *   plus each one an override in force put them on — with the shift-type
 *   overrides in force applied, and none on a date they hold a full-day
 *   Leave Record of any type;
 * - R12.2 a Half-day Record keeps the date's one working shift with the
 *   worked half's interval, split at the nominal midpoint as hours split it
 *   (`shiftHalvesOf`); on a date holding more than one working shift the
 *   half splits none, as in hours. A half whose worked side has no minute
 *   (a one-minute shift) leaves no at-work shift.
 *
 * Which overrides are IN FORCE is `overrideStandingOf`'s, over the rotation
 * versions' stamps and each override's `writtenAt`: one a rotation change
 * left pending review is not applied, as the browser does not apply it.
 *
 * A working shift with no version of its type's times in effect that date
 * has no interval, and is not an at-work shift: nothing can be put in a
 * calendar or a reminder for it. A non-working type is never one.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';
import { deriveShiftTimes, shiftDurationOn, shiftTypeVersionOn } from './duration.js';
import { shiftHalvesOf, type ShiftTypeWithVersions } from './hours.js';
import { checkRange, LEAVE_HALF_FIRST, LEAVE_HALF_SECOND, type LeaveHalf } from './leave.js';
import { overrideStandingOf, type RotationVersionStamp, type StampedShiftTypeOverride } from './overrides.js';
import type { RotationAssignment, RotationStep } from './projection.js';
import type { Loan, MembershipVersion, RosterOverride, StatusVersion } from './roster.js';
import { memberScheduleOfMonth, monthOf, adjacentMonth } from './schedule.js';

/** The longest range {@link atWorkShiftsOf} projects, in days, both ends included: two years and a day. */
export const MAX_AT_WORK_RANGE_DAYS = 732;

/** A team as the assembly carries it: its id, its name as stored, and whether it is archived. */
export interface ScheduleTeam {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

/** A member as the assembly carries it: no name, no rank, no address (AD-19). */
export interface ScheduleMember {
  readonly id: string;
  /** Every version of their team membership, positions included. */
  readonly memberships: readonly MembershipVersion[];
  /** Every version of their active status; none is always active. */
  readonly statuses: readonly StatusVersion[];
  /** Their live Loans overlapping the window (story 18.2): no reason, no author. */
  readonly loans: readonly Loan[];
}

/** A live roster override with the instant it was written or last confirmed (µs), which decides whether it is in force. */
export interface StampedRosterOverride extends RosterOverride {
  readonly writtenAt: number;
}

/**
 * One live Leave Record of THE member (AD-19): its dates, its half, its
 * absence type's id. No type name, no reason, no drawing flag. A whole day
 * carries no `half` key.
 */
export interface ScheduleLeave {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly half?: LeaveHalf;
  readonly absenceTypeId: string;
}

/**
 * Everything a member's projection is derived from (AD-19): the one
 * assembly, in the domain's own input shapes. Versioned rules come whole;
 * overrides are those dated in the window, loans and leave those overlapping
 * it. Overrides of either kind are LIVE, in force or pending alike, each with
 * its `writtenAt` stamp (µs, `confirmed_at ?? created_at`).
 */
export interface ScheduleInputs {
  readonly organizationId: string;
  /** The organization's IANA zone; the projection itself never reads it (AD-6). */
  readonly timeZone: string;
  /** Whose projection this is: the member the leave belongs to. */
  readonly memberId: string;
  readonly teams: readonly ScheduleTeam[];
  readonly shiftTypes: readonly ShiftTypeWithVersions[];
  readonly steps: readonly RotationStep[];
  readonly assignments: readonly RotationAssignment[];
  /** One stamp per assignment: when that version was saved (µs). */
  readonly assignmentStamps: readonly RotationVersionStamp[];
  /** Every member of the organization, active or not, the member included. */
  readonly members: readonly ScheduleMember[];
  readonly overrides: readonly StampedShiftTypeOverride[];
  readonly rosterOverrides: readonly StampedRosterOverride[];
  /** THE member's own live leave records; nobody else's. */
  readonly leave: readonly ScheduleLeave[];
}

/**
 * One at-work shift (R12): the date it starts on, the team — the effective
 * team after loans, or the team a roster override put the member on — and its
 * shift type, and the interval worked, in minutes after the start of `date`:
 * past 1440 runs into the next date (DI-5), which the second half of a
 * midnight-crossing shift may START in (R12.2). The date is still the
 * shift's start date.
 */
export interface AtWorkShift {
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly startMinute: number;
  /** Always after `startMinute`; at most 2879. */
  readonly endMinute: number;
  /** Held only through a roster override, not as a member of the team. */
  readonly viaOverride: boolean;
  /** The Loan that put them on this team that date; ABSENT when none. */
  readonly loanId?: string;
  /** On a Half-day Record, the half worked (R12.2); ABSENT on a whole shift. */
  readonly workedHalf?: LeaveHalf;
}

function checkShiftTypes(shiftTypes: readonly ShiftTypeWithVersions[], probeDate: string): ReadonlyMap<string, ShiftTypeWithVersions> {
  const byId = new Map<string, ShiftTypeWithVersions>();
  for (const entry of shiftTypes) {
    if (byId.has(entry.type.id)) throw new RangeError(`shift type ${entry.type.id} is given twice`);
    // The versions are this type's own and well-formed, and a non-working type carries none.
    shiftDurationOn(entry.type, entry.versions, probeDate);
    byId.set(entry.type.id, entry);
  }
  return byId;
}

interface LeaveDays {
  readonly fullDays: ReadonlySet<string>;
  readonly halves: ReadonlyMap<string, LeaveHalf>;
}

function leaveDaysOf(leave: readonly ScheduleLeave[], from: string, to: string): LeaveDays {
  const ordered = [...leave].sort((left, right) => (left.from < right.from ? -1 : left.from > right.from ? 1 : 0));
  const fullDays = new Set<string>();
  const halves = new Map<string, LeaveHalf>();
  let previous: ScheduleLeave | null = null;
  for (const record of ordered) {
    checkRange(`leave record ${record.id}`, record);
    if (previous !== null && record.from <= previous.to) {
      throw new RangeError(`leave records ${previous.id} and ${record.id} share a date`);
    }
    previous = record;
    if (record.half === LEAVE_HALF_FIRST || record.half === LEAVE_HALF_SECOND) {
      halves.set(record.from, record.half);
      continue;
    }
    const first = Math.max(civilDayNumber(record.from), civilDayNumber(from));
    const last = Math.min(civilDayNumber(record.to), civilDayNumber(to));
    for (let day = first; day <= last; day += 1) {
      const date = dateOfCivilDay(day);
      if (date !== null) fullDays.add(date);
    }
  }
  return { fullDays, halves };
}

/**
 * R12: the at-work shifts of `inputs.memberId` from `from` through `to`, both
 * inclusive, by the date each starts on, in date order and, within a date,
 * in `memberScheduleOfMonth`'s order (their own team's first).
 *
 * @throws RangeError when `from` or `to` is not a calendar `YYYY-MM-DD`, when
 *   `to` is before `from` or the range is longer than
 *   {@link MAX_AT_WORK_RANGE_DAYS}; when the member is not among
 *   `inputs.members`, or a member or a team is given twice; when a shift type is given
 *   twice or its versions are not its own or malformed; when a stamp or an
 *   override breaks `overrideStandingOf`'s preconditions; when a leave record
 *   is malformed or two share a date; when an at-work shift names a team the
 *   assembly lacks; and on any precondition of `memberScheduleOfMonth`.
 */
export function atWorkShiftsOf(inputs: ScheduleInputs, from: string, to: string): readonly AtWorkShift[] {
  checkDate('the first date', from);
  checkDate('the last date', to);
  if (to < from) throw new RangeError(`the range ${from}–${to} ends before it starts`);
  if (civilDayNumber(to) - civilDayNumber(from) + 1 > MAX_AT_WORK_RANGE_DAYS) {
    throw new RangeError(`the range ${from}–${to} is longer than ${String(MAX_AT_WORK_RANGE_DAYS)} days`);
  }

  const memberIds = new Set<string>();
  for (const member of inputs.members) {
    if (memberIds.has(member.id)) throw new RangeError(`member ${member.id} is given twice`);
    memberIds.add(member.id);
  }
  const member = inputs.members.find((one) => one.id === inputs.memberId);
  if (member === undefined) throw new RangeError(`member ${inputs.memberId} is not among the members given`);

  const types = checkShiftTypes(inputs.shiftTypes, from);
  const teamIds = new Set<string>();
  for (const team of inputs.teams) {
    if (teamIds.has(team.id)) throw new RangeError(`team ${team.id} is given twice`);
    teamIds.add(team.id);
  }
  const workingShiftTypeIds = inputs.shiftTypes.filter((entry) => entry.type.isWorking).map((entry) => entry.type.id);
  const { fullDays, halves } = leaveDaysOf(inputs.leave, from, to);

  const scheduleInput = {
    memberId: member.id,
    memberships: member.memberships,
    statuses: member.statuses,
    loans: member.loans,
    assignments: inputs.assignments,
    steps: inputs.steps,
    overrides: overrideStandingOf(inputs.assignmentStamps, inputs.overrides).inForce,
    members: inputs.members,
    rosterOverrides: overrideStandingOf(inputs.assignmentStamps, inputs.rosterOverrides).inForce,
    workingShiftTypeIds,
  };

  const shifts: AtWorkShift[] = [];
  const lastMonth = monthOf(to);
  for (let month: string | null = monthOf(from); month !== null && month <= lastMonth; month = adjacentMonth(month, 1)) {
    for (const day of memberScheduleOfMonth(scheduleInput, month)) {
      if (day.date < from || day.date > to || fullDays.has(day.date)) continue;

      const timed = day.shifts.flatMap((shift) => {
        const entry = shift.shiftTypeId === null ? undefined : types.get(shift.shiftTypeId);
        if (shift.shiftTypeId !== null && entry === undefined) {
          throw new RangeError(`the schedule names shift type ${shift.shiftTypeId} on ${day.date}, which is not given`);
        }
        if (entry === undefined || !entry.type.isWorking) return [];
        const version = shiftTypeVersionOn(entry.versions, day.date);
        return [{ shift, shiftTypeId: entry.type.id, version }];
      });
      const half = timed.length === 1 ? halves.get(day.date) : undefined;

      for (const { shift, shiftTypeId, version } of timed) {
        if (version === null) continue;
        if (!teamIds.has(shift.teamId)) {
          throw new RangeError(`the schedule names team ${shift.teamId} on ${day.date}, which is not given`);
        }
        const base = {
          date: day.date,
          teamId: shift.teamId,
          shiftTypeId,
          viaOverride: shift.viaOverride,
          ...(shift.loanId === undefined ? {} : { loanId: shift.loanId }),
        };
        if (half !== undefined) {
          const halvesOf = shiftHalvesOf(version.startMinute, version.endMinute);
          const workedHalf: LeaveHalf = half === LEAVE_HALF_FIRST ? LEAVE_HALF_SECOND : LEAVE_HALF_FIRST;
          const worked = workedHalf === LEAVE_HALF_FIRST ? halvesOf.first : halvesOf.second;
          if (worked.durationMinutes === 0) continue;
          shifts.push({
            ...base,
            startMinute: worked.startMinute,
            endMinute: worked.startMinute + worked.durationMinutes,
            workedHalf,
          });
          continue;
        }
        const times = deriveShiftTimes(version.startMinute, version.endMinute);
        shifts.push({ ...base, startMinute: times.startMinute, endMinute: times.startMinute + times.durationMinutes });
      }
    }
  }
  return shifts;
}
