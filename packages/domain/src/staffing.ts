/**
 * Short-staffed shifts (story 11.1; CAP-21; engine rules R10.1–R10.5; AD-1,
 * AD-2, AD-7, AD-8).
 *
 * The ONE staffing rule. How many people are at work on a working Scheduled
 * Shift, and whether that is fewer than the organization's Minimum Members, is
 * derived here, on read, and nowhere else: nothing stores a count or a state
 * (AD-1, R10.3), and nothing "resolves" one — it ends only when the roster,
 * the absence or the setting changes.
 *
 * PEOPLE AT WORK (R10.1): the shift's roster after the roster overrides
 * ({@link rosterOn}: the default roster less each member an applying override
 * takes off, plus each member one puts on), less every member ON THAT LIST
 * whose leave record covers the date. A member a replacement took off is no
 * longer on the list, so their leave is never subtracted twice; a replacement
 * who is on leave themselves is subtracted. Every leave record counts as an
 * absence, whatever its type, except a half-day record (story 13.5, R10.1): a
 * member on a half day counts as at work.
 *
 * SHORT-STAFFED (R10.2): the scheduled shift type is a working one AND the
 * people at work number fewer than `minimumMembers`. A non-working day, a team
 * whose rotation has not started, and a `minimumMembers` of `null` are never
 * short-staffed. Minimum Members is current-state (AD-2), so the same input
 * with another minimum re-reports past dates too (R10.4).
 *
 * Results are ids, codes and numbers only (AD-8): no name and no text, and
 * nothing here reads a fire rank or a team position (FR-18a) — a roster entry's
 * position is carried by `roster.ts` and never looked at.
 *
 * Ranges are inclusive `from`–`to` calendar dates. Dates are `YYYY-MM-DD`
 * strings: no `Date`, no time zone. The caller bounds the window. Every
 * breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate } from './calendar.js';
import type { CollisionLeaveRecord } from './collisions.js';
import { checkRange, isHalfDay } from './leave.js';
import { rosterOn } from './roster.js';
import { adjacentMonth, monthOf, scheduleOfMonth, type ScheduleInput } from './schedule.js';

export const SHORT_STAFFED = 'SHORT_STAFFED';

/**
 * What staffing is derived from: the schedule's configuration
 * ({@link ScheduleInput} — the teams asked for, rotations, shift-type and
 * roster overrides, every member, the working types), every live leave record
 * and the organization's Minimum Members.
 */
export interface StaffingInput extends ScheduleInput {
  /** Every live leave record, of any member, in any order. */
  readonly leaveRecords: readonly CollisionLeaveRecord[];
  /** The organization's Minimum Members: a whole number from 1, or `null` when the setting is empty. */
  readonly minimumMembers: number | null;
}

/** A working shift's staffing: the type it works and the people at work on it. */
export interface Staffing {
  readonly shiftTypeId: string;
  readonly atWork: number;
}

/**
 * One short-staffed shift (R10.4's report): the date, the team, the working
 * type it works, the people at work and the minimum they fall short of.
 */
export interface ShortStaffedShift {
  readonly code: typeof SHORT_STAFFED;
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly atWork: number;
  readonly minimum: number;
}

/**
 * THE SHORT-STAFFED PREDICATE (R10.2), for a working shift's people at work:
 * fewer than the minimum. A `null` minimum (the setting empty) is never short.
 * The one comparison every caller reads — the report here, a resolution
 * strip's coverage term in the web layer (story 11.2) — so it lives once (AD-7).
 */
export function isShortStaffed(atWork: number, minimum: number | null): boolean {
  return minimum !== null && atWork < minimum;
}

/**
 * @throws RangeError when `minimumMembers` is neither `null` nor a whole
 *   number of at least 1.
 */
function checkMinimum(minimumMembers: number | null): void {
  if (minimumMembers === null) return;
  if (!Number.isInteger(minimumMembers) || minimumMembers < 1) {
    throw new RangeError(`the minimum members is ${String(minimumMembers)}, not a whole number of at least 1 or empty`);
  }
}

/** Whether `date` is covered by one of `records`. */
type LeaveIndex = (memberId: string, date: string) => boolean;

/**
 * The leave records indexed by member, each checked.
 *
 * @throws RangeError when two records share an id, or a record's start or end
 *   is not a calendar `YYYY-MM-DD`, it ends before it starts, or it is longer
 *   than `MAX_LEAVE_RANGE_DAYS`.
 */
function leaveIndexOf(records: readonly CollisionLeaveRecord[]): LeaveIndex {
  const ids = new Set<string>();
  const byMember = new Map<string, CollisionLeaveRecord[]>();
  for (const record of records) {
    if (ids.has(record.id)) {
      throw new RangeError(`leave record ${JSON.stringify(record.id)} is given twice`);
    }
    ids.add(record.id);
    checkRange(`leave record ${JSON.stringify(record.id)}`, record);
    // A member on a half day is at work (R10.1, story 13.5).
    if (isHalfDay(record)) continue;
    const known = byMember.get(record.memberId);
    if (known === undefined) byMember.set(record.memberId, [record]);
    else known.push(record);
  }
  return (memberId, date) => (byMember.get(memberId) ?? []).some((record) => record.from <= date && date <= record.to);
}

/**
 * @throws RangeError when `from` or `to` is not a calendar `YYYY-MM-DD`, or
 *   `to` is before `from`.
 */
function checkWindow(from: string, to: string): void {
  checkDate('the start of the window', from);
  checkDate('the end of the window', to);
  if (to < from) {
    throw new RangeError(`the window runs from ${JSON.stringify(from)} to ${JSON.stringify(to)}, which ends before it starts`);
  }
}

/**
 * Every working shift of the teams of `input.teamIds` from `from` to `to`, with
 * its people at work, soonest first and then in the order of `teamIds`.
 */
function staffedShiftsOf(
  input: StaffingInput,
  from: string,
  to: string,
): readonly (Staffing & { readonly date: string; readonly teamId: string })[] {
  const onLeave = leaveIndexOf(input.leaveRecords);
  const working = new Set(input.workingShiftTypeIds);
  const shifts: (Staffing & { readonly date: string; readonly teamId: string })[] = [];

  const last = monthOf(to);
  for (let month: string | null = monthOf(from); month !== null; month = month === last ? null : adjacentMonth(month, 1)) {
    for (const row of scheduleOfMonth(input, month)) {
      if (row.date < from || row.date > to) continue;
      for (const cell of row.cells) {
        if (cell.shiftTypeId === null || !working.has(cell.shiftTypeId)) continue;
        const { roster } = rosterOn(input.members, input.rosterOverrides, cell.teamId, row.date);
        const atWork = roster.filter((entry) => !onLeave(entry.memberId, row.date)).length;
        shifts.push({ date: row.date, teamId: cell.teamId, shiftTypeId: cell.shiftTypeId, atWork });
      }
    }
  }
  return shifts;
}

/**
 * The staffing of `teamId`'s shift on `date` (R10.1): the working type it
 * works and the people at work on it, or `null` when the team works no working
 * shift that day — a non-working type, or no rotation version yet. Does not
 * read `minimumMembers` beyond checking it. `teamId` need not be in
 * `input.teamIds`.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, on any
 *   precondition of the leave records or the minimum, and on any of
 *   {@link scheduleOfMonth} or {@link rosterOn}.
 */
export function peopleAtWorkOn(input: StaffingInput, teamId: string, date: string): Staffing | null {
  checkDate('the date', date);
  checkMinimum(input.minimumMembers);
  const [shift] = staffedShiftsOf({ ...input, teamIds: [teamId] }, date, date);
  return shift === undefined ? null : { shiftTypeId: shift.shiftTypeId, atWork: shift.atWork };
}

/**
 * Every short-staffed shift from `from` to `to` (R10.2) of the teams of
 * `input.teamIds`: each working shift whose people at work number fewer than
 * `input.minimumMembers`. None at all when the minimum is `null`. Soonest
 * first, then in the order of `teamIds`. Reads its input and writes nothing.
 *
 * @throws RangeError when the window is not two calendar dates in order, when
 *   the minimum is neither `null` nor a whole number of at least 1, on any
 *   precondition of the leave records, and on any of {@link scheduleOfMonth}
 *   or {@link rosterOn}.
 */
export function shortStaffedShiftsOf(input: StaffingInput, from: string, to: string): readonly ShortStaffedShift[] {
  checkWindow(from, to);
  checkMinimum(input.minimumMembers);
  const minimum = input.minimumMembers;
  if (minimum === null) return [];
  return staffedShiftsOf(input, from, to)
    .filter((shift) => isShortStaffed(shift.atWork, minimum))
    .map((shift) => ({ code: SHORT_STAFFED, date: shift.date, teamId: shift.teamId, shiftTypeId: shift.shiftTypeId, atWork: shift.atWork, minimum }));
}

/** The key a short-staffed shift is matched by across a change: its team and date. */
function shiftKeyOf(shift: Pick<ShortStaffedShift, 'date' | 'teamId'>): string {
  return JSON.stringify([shift.date, shift.teamId]);
}

/**
 * THE CHANGE'S REPORT (R10.4): the shifts from `from` to `to` that `after` makes
 * short-staffed and `before` did not — each one as `after` derives it, in
 * {@link shortStaffedShiftsOf}'s order. A shift short-staffed in both, or only
 * in `before`, is not returned. A shift is matched by its team and date, so
 * one whose type a change turns from one working type to another, and stays
 * short, is not newly short. Reads its inputs and writes nothing.
 *
 * `before` and `after` are one organization before and after ONE change, so
 * they ask for the same `teamIds`: a team only `after` asks for would report
 * each of its short shifts as new. The minimum may differ between them (it is
 * current-state, R10.4), and then every shift the new minimum makes short is
 * new, as the change it is.
 *
 * @throws RangeError on any precondition of {@link shortStaffedShiftsOf} for
 *   either input.
 */
export function newlyShortStaffedOf(before: StaffingInput, after: StaffingInput, from: string, to: string): readonly ShortStaffedShift[] {
  const already = new Set(shortStaffedShiftsOf(before, from, to).map(shiftKeyOf));
  return shortStaffedShiftsOf(after, from, to).filter((shift) => !already.has(shiftKeyOf(shift)));
}
