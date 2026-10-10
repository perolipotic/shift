/**
 * Leave accounting (story 5.1a; engine rules R4.2, R4.5–R4.7; AD-7).
 *
 * The ONE leave rule. What a range of dates costs, which leave year a date
 * falls in, what a member's balance is, and what a new range would do to it
 * are computed here and nowhere else — no database routine and no screen
 * recomputes them.
 *
 * COST (R4.2, inferred and not confirmed by the pilot): a date costs one leave
 * day when the member is active on it and their schedule on it —
 * {@link memberScheduleOfMonth}, so it follows the shift-type and roster
 * overrides the caller passes — holds at least one WORKING shift, on their own
 * team or one a roster override puts them on. Two working shifts on one date
 * still cost one. {@link isLeaveDay} is that per-date shift rule, and the
 * single place to change it. A date the member is inactive costs nothing,
 * whatever a roster override puts them on.
 *
 * LEAVE YEAR (R4.6): the year beginning on the organization's start month and
 * day (day 1–28, as `organizations` checks) that contains a date. Only the
 * dates of a record inside the current leave year — the one containing the
 * caller's `today` — count as used.
 *
 * BALANCE (R4.5): `balance = allowance − used`, and it may go negative. An
 * over-balance range is flagged (R4.7), never refused.
 *
 * Ranges are inclusive `from`–`to` calendar dates, `from <= to`, at most
 * {@link MAX_LEAVE_RANGE_DAYS} days long, and may span months and leave years.
 * Dates are `YYYY-MM-DD` strings: no `Date`, no time zone. Records of one
 * member never share a date — the database refuses that (R4.4) — so records
 * that do are a breached precondition here, and a previewed range that
 * overlaps one is flagged and never charged twice for a date. The results are
 * numbers and flags only.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';
import { activeOn } from './roster.js';
import { adjacentMonth, datesOfMonth, memberScheduleOfMonth, monthOf, type MemberScheduleDay, type MemberScheduleInput } from './schedule.js';

/**
 * The longest range or record accepted, in days, both ends included: annual
 * leave never exceeds a year, and the cap stops a mistyped year from walking
 * thousands of months.
 */
export const MAX_LEAVE_RANGE_DAYS = 366;

/** An inclusive range of calendar dates, `from <= to`: a leave record, or one being entered. */
export interface LeaveRange {
  readonly from: string;
  readonly to: string;
}

/** Where an organization's leave year begins: a month 1–12 and a day 1–28. */
export interface LeaveYearStart {
  readonly month: number;
  readonly day: number;
}

/** What a member's leave balance is derived from. */
export interface LeaveBalanceInput {
  /** The member's schedule input, whose working shifts and statuses decide what each date costs. */
  readonly input: MemberScheduleInput;
  /** The member's allowance for a leave year, in whole days, never negative. */
  readonly allowanceDays: number;
  /** Every leave record of THIS member, in any order, no two sharing a date. Named in errors by their index here. */
  readonly records: readonly LeaveRange[];
  /** The caller's current date, `YYYY-MM-DD`, which picks the current leave year. */
  readonly today: string;
  /** Where the organization's leave year begins. */
  readonly leaveYearStart: LeaveYearStart;
}

/** What a new range is previewed against: the balance input plus the range. */
export interface LeavePreviewInput extends LeaveBalanceInput {
  /** The range being entered; when amending, `records` must not hold the record being amended. */
  readonly range: LeaveRange;
}

/** A member's balance in the current leave year. Always `balanceDays = allowanceDays − usedDays`. */
export interface LeaveBalance {
  readonly allowanceDays: number;
  readonly usedDays: number;
  /** May be negative. */
  readonly balanceDays: number;
}

/**
 * What saving a new range would cost, and what it would leave: the balance
 * BEFORE the range, then the range's figures.
 */
export interface LeavePreview extends LeaveBalance {
  /** Leave days over the whole range, whichever leave years it spans and whatever records it overlaps. */
  readonly costDays: number;
  /**
   * What the balance is charged: the leave days of the range's dates inside
   * the current leave year that no existing record already covers.
   */
  readonly costInYearDays: number;
  /** `balanceDays − costInYearDays`; may be negative. */
  readonly balanceAfterDays: number;
  /** True when the range charges something and more than the balance before it: a warning, never a refusal. */
  readonly exceedsBalance: boolean;
  /** True when the range shares a date with an existing record, which the database will refuse (R4.4). */
  readonly overlapsRecord: boolean;
}

/**
 * THE PER-DATE SHIFT RULE (R4.2): whether one date of a member's schedule
 * costs a leave day — true when it holds at least one shift whose type is
 * among `workingShiftTypeIds`, however many. A date on no team, or taken off
 * the only shift, holds no working shift, and costs nothing. Whether the
 * member is active is checked by the callers, not here.
 */
export function isLeaveDay(day: MemberScheduleDay, workingShiftTypeIds: readonly string[]): boolean {
  return day.shifts.some((shift) => shift.shiftTypeId !== null && workingShiftTypeIds.includes(shift.shiftTypeId));
}

/**
 * INTERNAL: shared with `collisions.ts` (story 5.3a) and not re-exported from
 * `index.ts`.
 *
 * @throws RangeError naming `what` when either end is not a calendar
 *   `YYYY-MM-DD`, when `from` is after `to`, or when the range is longer than
 *   {@link MAX_LEAVE_RANGE_DAYS}.
 */
export function checkRange(what: string, range: LeaveRange): void {
  checkDate(`the start of ${what}`, range.from);
  checkDate(`the end of ${what}`, range.to);
  if (range.from > range.to) {
    throw new RangeError(`${what} runs from ${JSON.stringify(range.from)} to ${JSON.stringify(range.to)}, which ends before it starts`);
  }
  const days = civilDayNumber(range.to) - civilDayNumber(range.from) + 1;
  if (days > MAX_LEAVE_RANGE_DAYS) {
    throw new RangeError(
      `${what} runs from ${JSON.stringify(range.from)} to ${JSON.stringify(range.to)}, ${String(days)} days, longer than ${String(MAX_LEAVE_RANGE_DAYS)}`,
    );
  }
}

/**
 * @throws RangeError naming the value when the month is not an integer 1–12 or
 *   the day not an integer 1–28.
 */
function checkLeaveYearStart(start: LeaveYearStart): void {
  if (!Number.isInteger(start.month) || start.month < 1 || start.month > 12) {
    throw new RangeError(`the leave year starts in month ${String(start.month)}, not an integer 1–12`);
  }
  if (!Number.isInteger(start.day) || start.day < 1 || start.day > 28) {
    throw new RangeError(`the leave year starts on day ${String(start.day)}, not an integer 1–28`);
  }
}

/** Whether `date` lies inside `range`. */
function covers(range: LeaveRange, date: string): boolean {
  return date >= range.from && date <= range.to;
}

/** The part of `range` inside `year`, or `null` when they share no date. Both already checked. */
function intersect(range: LeaveRange, year: LeaveRange): LeaveRange | null {
  const from = range.from > year.from ? range.from : year.from;
  const to = range.to < year.to ? range.to : year.to;
  return from <= to ? { from, to } : null;
}

/**
 * A leave-date collector over one member's input: each month of their
 * schedule is derived at most once per call. It returns, in order, the dates
 * of an already-checked range on which the member is active and
 * {@link isLeaveDay} holds, skipping any date inside one of `skip`.
 */
function leaveDatesCollector(input: MemberScheduleInput): (range: LeaveRange, skip?: readonly LeaveRange[]) => readonly string[] {
  const months = new Map<string, readonly MemberScheduleDay[]>();
  const scheduleOf = (month: string): readonly MemberScheduleDay[] => {
    let days = months.get(month);
    if (days === undefined) {
      days = memberScheduleOfMonth(input, month);
      months.set(month, days);
    }
    return days;
  };

  return (range, skip = []) => {
    const last = monthOf(range.to);
    const dates: string[] = [];
    for (let month: string | null = monthOf(range.from); month !== null; month = month === last ? null : adjacentMonth(month, 1)) {
      for (const day of scheduleOf(month)) {
        if (!covers(range, day.date) || skip.some((other) => covers(other, day.date))) continue;
        if (activeOn(input.statuses, day.date) && isLeaveDay(day, input.workingShiftTypeIds)) dates.push(day.date);
      }
    }
    return dates;
  };
}

/** A cost counter over one member's input: the count of {@link leaveDatesCollector}'s dates. */
function costCounter(input: MemberScheduleInput): (range: LeaveRange, skip?: readonly LeaveRange[]) => number {
  const datesOf = leaveDatesCollector(input);
  return (range, skip) => datesOf(range, skip).length;
}

/**
 * What the inclusive range `from`–`to` costs the member (R4.2): the count of
 * its dates on which they are active and that are {@link isLeaveDay} under
 * `input.workingShiftTypeIds`.
 *
 * @throws RangeError when either end is not a calendar `YYYY-MM-DD`, when
 *   `from` is after `to`, when the range is longer than
 *   {@link MAX_LEAVE_RANGE_DAYS}, and on any precondition of
 *   {@link memberScheduleOfMonth}.
 */
export function leaveCostOf(input: MemberScheduleInput, from: string, to: string): number {
  const range = { from, to };
  checkRange('the leave range', range);
  return costCounter(input)(range);
}

/** A `YYYY-MM-DD`-shaped string, a real calendar date or not: what can be placed by string comparison. */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The member's charged leave dates in `month` (R4.2), in order: every date of
 * a record inside the month on which they are active and that is
 * {@link isLeaveDay}. A record straddling the month counts only its dates
 * inside it, so the months of one record sum to {@link leaveCostOf} over it.
 * The count of a month's leave days is the length; the dates are what explain
 * it.
 *
 * A record is checked as {@link leaveCostOf} checks a range, whole, whenever
 * it reaches the month. A record whose ends are both `YYYY-MM-DD`-shaped —
 * even an impossible date such as `2026-11-31` — and that lies wholly outside
 * the month by string comparison is skipped unchecked, so a malformed record
 * in another month cannot fail this one. An end that is not date-shaped at
 * all cannot be placed, and fails the month.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999; when
 *   either end of any record is not `YYYY-MM-DD`-shaped; when a record
 *   reaching the month has an end that is not a calendar date, ends before it
 *   starts or is longer than {@link MAX_LEAVE_RANGE_DAYS}; and on any
 *   precondition of {@link memberScheduleOfMonth}.
 */
export function leaveDaysOfMonth(input: MemberScheduleInput, records: readonly LeaveRange[], month: string): readonly string[] {
  const dates = datesOfMonth(month);
  const span: LeaveRange = { from: dates[0]!, to: dates[dates.length - 1]! };
  const datesOf = leaveDatesCollector(input);
  const charged = new Set<string>();
  records.forEach((record, index) => {
    const what = `leave record ${String(index)}`;
    // Ends that are not date-shaped cannot be placed outside the month either.
    if (!DATE_SHAPE.test(record.from)) throw new RangeError(`the start of ${what} is ${JSON.stringify(record.from)}, not a YYYY-MM-DD`);
    if (!DATE_SHAPE.test(record.to)) throw new RangeError(`the end of ${what} is ${JSON.stringify(record.to)}, not a YYYY-MM-DD`);
    const first = record.from < record.to ? record.from : record.to;
    const last = record.from < record.to ? record.to : record.from;
    if (last < span.from || first > span.to) return;
    checkRange(what, record);
    const inMonth: LeaveRange = {
      from: record.from > span.from ? record.from : span.from,
      to: record.to < span.to ? record.to : span.to,
    };
    for (const date of datesOf(inMonth)) charged.add(date);
  });
  return [...charged].sort();
}

/**
 * The leave year containing `date` (R4.6): from the latest start month and
 * day on or before it, to the day before the next one, both inclusive. A year
 * that would begin before 0001-01-01 or end after 9999-12-31 is cut there,
 * the calendar's ends.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, when the
 *   start month is not an integer 1–12, or the start day not an integer 1–28.
 */
export function leaveYearOf(date: string, start: LeaveYearStart): LeaveRange {
  checkDate('the date', date);
  checkLeaveYearStart(start);

  const startIn = (year: number): string =>
    `${String(year).padStart(4, '0')}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  const year = Number(date.slice(0, 4));
  const firstYear = date >= startIn(year) ? year : year - 1;

  const from = firstYear < 1 ? '0001-01-01' : startIn(firstYear);
  if (firstYear + 1 > 9999) return { from, to: '9999-12-31' };
  const to = dateOfCivilDay(civilDayNumber(startIn(firstYear + 1)) - 1);
  if (to === null) {
    // Unreachable: the day before a start in years 0002–9999 is a calendar date.
    throw new RangeError(`the leave year of ${JSON.stringify(date)} has no last day`);
  }
  return { from, to };
}

/**
 * Every precondition of a balance input, and the current leave year.
 *
 * @throws RangeError on any precondition of {@link leaveBalanceOf}.
 */
function checkBalanceInput(balance: LeaveBalanceInput): LeaveRange {
  if (!Number.isInteger(balance.allowanceDays) || balance.allowanceDays < 0) {
    throw new RangeError(`the leave allowance is ${String(balance.allowanceDays)} days, not a whole number of zero or more`);
  }
  checkDate('today', balance.today);
  checkLeaveYearStart(balance.leaveYearStart);
  balance.records.forEach((record, index) => checkRange(`leave record ${String(index)}`, record));

  const byStart = balance.records.map((record, index) => ({ record, index })).sort((a, b) => (a.record.from < b.record.from ? -1 : 1));
  for (let i = 1; i < byStart.length; i += 1) {
    const before = byStart[i - 1]!;
    const after = byStart[i]!;
    if (after.record.from <= before.record.to) {
      throw new RangeError(
        `leave records ${String(before.index)} and ${String(after.index)} share ${JSON.stringify(after.record.from)}; records of one member never overlap`,
      );
    }
  }
  return leaveYearOf(balance.today, balance.leaveYearStart);
}

/** The balance of an already-checked input in `year`, counted by `costOf`. */
function balanceOf(costOf: (range: LeaveRange) => number, balance: LeaveBalanceInput, year: LeaveRange): LeaveBalance {
  let usedDays = 0;
  for (const record of balance.records) {
    const inYear = intersect(record, year);
    if (inYear !== null) usedDays += costOf(inYear);
  }
  return { allowanceDays: balance.allowanceDays, usedDays, balanceDays: balance.allowanceDays - usedDays };
}

/**
 * The member's balance in the current leave year (R4.5, R4.6): the allowance,
 * the leave days of every record's dates inside the leave year containing
 * `today` — a record straddling the year's start or end counts only its dates
 * inside it — and the allowance less those, which may be negative.
 *
 * @throws RangeError when `allowanceDays` is not a whole number of zero or
 *   more; when `today`, or the start or end of a record, is not a calendar
 *   `YYYY-MM-DD`; when a record ends before it starts or is longer than
 *   {@link MAX_LEAVE_RANGE_DAYS}; when two records share a date; on any
 *   precondition of {@link leaveYearOf}; and on any of
 *   {@link memberScheduleOfMonth}.
 */
export function leaveBalanceOf(balance: LeaveBalanceInput): LeaveBalance {
  const year = checkBalanceInput(balance);
  const costOf = costCounter(balance.input);
  return balanceOf((range) => costOf(range), balance, year);
}

/**
 * What saving `range` would do (R4.2, R4.7): the balance before it, the
 * range's cost over every date, the part the balance is charged — its dates
 * inside the current leave year that no existing record covers, so no date
 * is charged twice — the balance after that charge, whether the charge is
 * positive and greater than the balance before it, and whether the range
 * overlaps an existing record. The flags are warnings; nothing here refuses.
 *
 * @throws RangeError on any precondition of {@link leaveBalanceOf}, and when
 *   the start or end of `range` is not a calendar `YYYY-MM-DD`, when it ends
 *   before it starts, or when it is longer than {@link MAX_LEAVE_RANGE_DAYS}.
 */
export function leavePreviewOf(preview: LeavePreviewInput): LeavePreview {
  const year = checkBalanceInput(preview);
  checkRange('the leave range', preview.range);

  const costOf = costCounter(preview.input);
  const before = balanceOf((range) => costOf(range), preview, year);
  const costDays = costOf(preview.range);
  const inYear = intersect(preview.range, year);
  const costInYearDays = inYear === null ? 0 : costOf(inYear, preview.records);

  return {
    ...before,
    costDays,
    costInYearDays,
    balanceAfterDays: before.balanceDays - costInYearDays,
    exceedsBalance: costInYearDays > 0 && costInYearDays > before.balanceDays,
    overlapsRecord: preview.records.some((record) => intersect(record, preview.range) !== null),
  };
}
