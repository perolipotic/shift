import { leaveSpanOf, type LeaveRange, type ScheduleInputs } from '@shift/domain';

import { instantMicrosOf } from '@/features/rotation/services/list';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';

/**
 * THE BROWSER'S SIDE OF AD-19 (story 16.2): the one adapter from what the
 * browser reads — the calendar snapshot under `CALENDAR_KEY` and the viewer's
 * own live leave under `MY_LEAVE_RECORDS_KEY` — to the domain's
 * `ScheduleInputs`, the shape `private.member_schedule_inputs` answers on the
 * server. The server has no adapter: its assembly is already that shape.
 *
 * The read-parity suite (`test/schedule-inputs-parity.test.ts`) holds the two
 * deep-equal for every member of both fixtures, and R12 over each equal too.
 * So a field added here is added to the SQL assembly and to the parity
 * fixture in the same story (AD-19), and never only here.
 *
 * WINDOWED AS THE SERVER WINDOWS: versioned rules whole; the live overrides
 * of either kind dated in the window, in force or pending alike, each with
 * its `writtenAt` (`confirmedAt ?? createdAt`, µs, by `instantMicrosOf`);
 * loans and leave overlapping it. Every list in one canonical order, so two
 * equal assemblies are equal as written.
 *
 * NOTHING IS PROJECTED HERE (AD-7), and no name of a member, no reason, no
 * author and no absence type's name is carried.
 */

/** A live leave record of the viewer as `my_leave_records()` parses (`LeaveRecord`), as much as the assembly reads. */
export interface OwnLeaveRecord extends LeaveRange {
  readonly id: string;
  readonly absenceTypeId: string;
}

/** The window, both ends inclusive, as `YYYY-MM-DD`. */
export interface ScheduleWindow {
  readonly from: string;
  readonly to: string;
}

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const overlaps = (range: { readonly from: string; readonly to: string }, window: ScheduleWindow): boolean =>
  range.from <= window.to && range.to >= window.from;

/** A stamp as the domain reads it: an unreadable one is `NaN`, which `overrideStandingOf` refuses. */
const writtenAtOf = (override: { readonly createdAt: string; readonly confirmedAt: string | null }): number =>
  instantMicrosOf(override.confirmedAt ?? override.createdAt) ?? Number.NaN;

/**
 * The viewer's `ScheduleInputs` over `window`, from the calendar snapshot and
 * their own live leave records.
 */
export function scheduleInputsOfCalendar(
  snapshot: CalendarSnapshot,
  ownLeave: readonly OwnLeaveRecord[],
  window: ScheduleWindow,
): ScheduleInputs {
  const inWindow = (date: string): boolean => date >= window.from && date <= window.to;

  return {
    organizationId: snapshot.organizationId,
    timeZone: snapshot.timeZone,
    memberId: snapshot.viewer.memberId,
    teams: snapshot.teams
      .map((team) => ({ id: team.id, name: team.name, archived: team.archived }))
      .sort((left, right) => byText(left.id, right.id)),
    shiftTypes: snapshot.types
      .map((type) => ({
        type: { id: type.id, name: type.name, isWorking: type.isWorking },
        versions: type.versions
          .map((version) => ({
            shiftTypeId: version.shiftTypeId,
            effectiveFrom: version.effectiveFrom,
            startMinute: version.startMinute,
            endMinute: version.endMinute,
          }))
          .sort((left, right) => byText(left.effectiveFrom, right.effectiveFrom)),
      }))
      .sort((left, right) => byText(left.type.id, right.type.id)),
    steps: snapshot.steps
      .map((step) => ({ id: step.id, patternId: step.patternId, position: step.position, shiftTypeId: step.shiftTypeId }))
      .sort((left, right) => byText(left.id, right.id)),
    assignments: snapshot.assignments
      .map((assignment) => ({
        teamId: assignment.teamId,
        patternId: assignment.patternId,
        offsetStepId: assignment.offsetStepId,
        anchorDate: assignment.anchorDate,
        effectiveFrom: assignment.effectiveFrom,
      }))
      .sort((left, right) => byText(left.teamId, right.teamId) || byText(left.effectiveFrom, right.effectiveFrom)),
    assignmentStamps: snapshot.assignmentStamps
      .map((stamp) => ({ teamId: stamp.teamId, effectiveFrom: stamp.effectiveFrom, createdAt: stamp.createdAt }))
      .sort((left, right) => byText(left.teamId, right.teamId) || byText(left.effectiveFrom, right.effectiveFrom)),
    members: snapshot.members
      .map((member) => ({
        id: member.id,
        memberships: member.memberships
          .map((version) => ({ teamId: version.teamId, position: version.position, effectiveFrom: version.effectiveFrom }))
          .sort((left, right) => byText(left.effectiveFrom, right.effectiveFrom)),
        statuses: member.statuses
          .map((version) => ({ active: version.active, effectiveFrom: version.effectiveFrom }))
          .sort((left, right) => byText(left.effectiveFrom, right.effectiveFrom)),
        loans: member.loans
          .filter((loan) => overlaps(loan, window))
          .map((loan) => ({ id: loan.id, teamId: loan.teamId, from: loan.from, to: loan.to }))
          .sort((left, right) => byText(left.from, right.from) || byText(left.id, right.id)),
      }))
      .sort((left, right) => byText(left.id, right.id)),
    overrides: snapshot.overrides
      .filter((override) => inWindow(override.date))
      .map((override) => ({
        id: override.id,
        teamId: override.teamId,
        date: override.date,
        shiftTypeId: override.shiftTypeId,
        writtenAt: writtenAtOf(override),
      }))
      .sort((left, right) => byText(left.id, right.id)),
    rosterOverrides: snapshot.rosterOverrides
      .filter((override) => inWindow(override.date))
      .map((override) => ({
        id: override.id,
        teamId: override.teamId,
        date: override.date,
        memberOutId: override.memberOutId,
        memberInId: override.memberInId,
        writtenAt: writtenAtOf(override),
      }))
      .sort((left, right) => byText(left.id, right.id)),
    leave: ownLeave
      .filter((record) => overlaps(record, window))
      .map((record) => ({ id: record.id, ...leaveSpanOf(record), absenceTypeId: record.absenceTypeId }))
      .sort((left, right) => byText(left.from, right.from) || byText(left.id, right.id)),
  };
}
