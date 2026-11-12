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
 * BALANCE (R4.5, R4.13): `balance = allowance + carried − used`, and it may go negative. An
 * over-balance range is flagged (R4.7), never refused.
 *
 * ALLOWANCE PER LEAVE YEAR (story 13.3, AD-2 versioned): a member has a
 * starting allowance and append-only versions, each for one leave year,
 * numbered by the calendar year it begins in ({@link leaveYearNumberOf}). The
 * allowance of leave year Y is the highest-`id` version for Y; otherwise the
 * highest-`id` version of the latest year before Y; otherwise the starting
 * allowance ({@link leaveAllowanceOf}). A balance uses the allowance of the
 * leave year containing its `today`.
 *
 * CARRY-OVER (story 13.4b, R4.13–R4.15, PO 2026-11-11 and 2026-11-12): an
 * organization may set a cap, an expiry day and month, and the first leave
 * year carried INTO ({@link LeaveCarryOver}). The days carried into leave
 * year Y are min(cap, max(0, Y−1's balance at its end)), and nothing is
 * carried into a year before the first; into the first, they come from Y−1's
 * balance with nothing carried into Y−1. The chain recomputes from the first
 * year on read, each year with its own allowance and drawing records, so
 * nothing is stored (R4.15). The expiry in Y is the first date on or after
 * Y's first day with the stored day and month ({@link carryOverExpiryOf}).
 * Drawing leave days consume carried days first (R4.14): consumed =
 * min(carried, the year's drawing leave days dated on or before the expiry).
 * While `today` is on or before the expiry, the balance shows every carried
 * day and none lapsed; after it, it shows the consumed part and the rest as
 * lapsed. A year's END balance, the one carried onward and the one the
 * preview's warning judges, is always the post-expiry one, so days after the
 * expiry are never covered by carried days. Always `balance = allowance +
 * carried − used`. Without a setting every figure is as before.
 *
 * ABSENCE TYPES (story 13.2, CAP-23): a record whose type does not draw the
 * allowance ({@link LeaveRange.drawsAllowance} `false`) is never counted in
 * `used`, and a previewed range of such a type charges nothing. Every other
 * rule — the cost of a range, {@link leaveDaysOfMonth}, the overlap check, and
 * the collisions and staffing that read these records — sees every record,
 * whatever its type.
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
  /**
   * Whether the record's absence type draws down the allowance (story 13.2).
   * Absent means it does: every record written before absence types existed
   * is annual leave. Only the balance reads it.
   */
  readonly drawsAllowance?: boolean;
}

/** Whether a record or range draws down the allowance: absent means it does (story 13.2). */
export function drawsAllowance(range: LeaveRange): boolean {
  return range.drawsAllowance !== false;
}

/** Where an organization's leave year begins: a month 1–12 and a day 1–28. */
export interface LeaveYearStart {
  readonly month: number;
  readonly day: number;
}

/** One version of a member's allowance, for one leave year (story 13.3). Never changed once written. */
export interface LeaveAllowanceVersion {
  /** The row's identity; a later correction of the same year has a higher one. A positive integer. */
  readonly id: number;
  /** The calendar year in which the leave year begins, an integer 1–9999. */
  readonly leaveYear: number;
  /** The allowance for that leave year, in whole days, never negative. */
  readonly days: number;
}

/** A member's allowance across leave years (story 13.3): the starting allowance and every version, in any order. */
export interface LeaveAllowance {
  /** The allowance of every leave year before the first version, in whole days, never negative. */
  readonly startingDays: number;
  readonly versions: readonly LeaveAllowanceVersion[];
}

/**
 * An organization's carry-over setting (story 13.4, R4.13): all four set, or
 * none (`null`/absent on {@link LeaveBalanceInput.carryOver}).
 */
export interface LeaveCarryOver {
  /** The most days carried into a leave year, an integer of 1 or more. */
  readonly maxDays: number;
  /** The expiry month, an integer 1–12. */
  readonly expiryMonth: number;
  /** The expiry day, an integer from 1 to the month's last day, February at 28. */
  readonly expiryDay: number;
  /** The first leave year carried INTO, numbered as {@link leaveYearNumberOf} numbers it, an integer 1–9999. */
  readonly firstLeaveYear: number;
}

/** What a member's leave balance is derived from. */
export interface LeaveBalanceInput {
  /** The member's schedule input, whose working shifts and statuses decide what each date costs. */
  readonly input: MemberScheduleInput;
  /** The member's allowance across leave years; the balance resolves it for the leave year containing `today`. */
  readonly allowance: LeaveAllowance;
  /** Every leave record of THIS member, in any order, no two sharing a date. Named in errors by their index here. */
  readonly records: readonly LeaveRange[];
  /** The caller's current date, `YYYY-MM-DD`, which picks the current leave year. */
  readonly today: string;
  /** Where the organization's leave year begins. */
  readonly leaveYearStart: LeaveYearStart;
  /** The organization's carry-over setting (story 13.4b); absent or `null` means none. */
  readonly carryOver?: LeaveCarryOver | null;
}

/** What a new range is previewed against: the balance input plus the range. */
export interface LeavePreviewInput extends LeaveBalanceInput {
  /** The range being entered; when amending, `records` must not hold the record being amended. */
  readonly range: LeaveRange;
}

/** A member's balance in the current leave year. Always `balanceDays = allowanceDays + carriedDays − usedDays`. */
export interface LeaveBalance {
  /** The allowance resolved for the current leave year ({@link leaveAllowanceOf}). */
  readonly allowanceDays: number;
  /**
   * The carried days the balance counts (story 13.4b): every day carried into
   * the current leave year while `today` is on or before the expiry, and only
   * the consumed part after it. `0` without carry-over.
   */
  readonly carriedDays: number;
  /** The carried days that lapsed unconsumed: `0` until `today` is past the expiry. */
  readonly lapsedDays: number;
  /** The expiry of the days carried into the current leave year, `YYYY-MM-DD`; `null` when nothing was carried. */
  readonly carryOverExpiry: string | null;
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
  /**
   * The balance with the range added as a record (story 13.4b); may be
   * negative. Without carry-over, `balanceDays − costInYearDays`.
   */
  readonly balanceAfterDays: number;
  /**
   * The current leave year's balance after the expiry, with the range: the
   * carried days only as far as they were consumed by the expiry. Without
   * carry-over, or once the expiry has passed, equal to `balanceAfterDays`.
   */
  readonly endBalanceAfterDays: number;
  /**
   * True when the range lowers the balance — by its in-year charge, or by
   * shrinking the days carried in from the previous leave year — and the
   * year's balance after the expiry, with the range, would be negative
   * (`endBalanceAfterDays < 0`): a warning, never a refusal. Without
   * carry-over, when the charge is more than the balance before it.
   */
  readonly exceedsBalance: boolean;
  /**
   * True when the warning is caused by the expiry (story 13.4b, PO
   * 2026-11-12): {@link exceedsBalance} while `balanceAfterDays` is still
   * zero or more, because carried days still count today but lapse on
   * `carryOverExpiry`. Never true without carry-over.
   */
  readonly exceedsAfterExpiry: boolean;
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
export function isLeaveDay(day: Pick<MemberScheduleDay, 'date' | 'shifts'>, workingShiftTypeIds: readonly string[]): boolean {
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
 * The number of the leave year containing `date` (story 13.3): the calendar
 * year in which that leave year begins, as {@link leaveYearOf} places it. A
 * date in 0001 before the start month and day belongs to leave year 0, which
 * no version can name.
 *
 * @throws RangeError on any precondition of {@link leaveYearOf}.
 */
export function leaveYearNumberOf(date: string, start: LeaveYearStart): number {
  checkDate('the date', date);
  checkLeaveYearStart(start);
  const year = Number(date.slice(0, 4));
  const startIn = `${date.slice(0, 4)}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
  return date >= startIn ? year : year - 1;
}

/**
 * @throws RangeError naming the value when the starting allowance or a
 *   version's days are not a whole number of zero or more, a version's id is
 *   not a positive integer, or its leave year not an integer 1–9999.
 */
function checkLeaveAllowance(allowance: LeaveAllowance): void {
  if (!Number.isInteger(allowance.startingDays) || allowance.startingDays < 0) {
    throw new RangeError(`the starting leave allowance is ${String(allowance.startingDays)} days, not a whole number of zero or more`);
  }
  allowance.versions.forEach((version, index) => {
    const what = `leave allowance version ${String(index)}`;
    if (!Number.isInteger(version.id) || version.id < 1) {
      throw new RangeError(`${what} has id ${String(version.id)}, not a positive integer`);
    }
    if (!Number.isInteger(version.leaveYear) || version.leaveYear < 1 || version.leaveYear > 9999) {
      throw new RangeError(`${what} is for leave year ${String(version.leaveYear)}, not an integer 1–9999`);
    }
    if (!Number.isInteger(version.days) || version.days < 0) {
      throw new RangeError(`${what} is ${String(version.days)} days, not a whole number of zero or more`);
    }
  });
}

/**
 * The allowance of leave year `leaveYear` (story 13.3, PO 2026-11-10): the
 * highest-`id` version for that year; otherwise the highest-`id` version of
 * the latest year before it; otherwise the starting allowance. A version for
 * a later year never applies.
 *
 * @throws RangeError when `leaveYear` is not an integer, and on any malformed
 *   allowance (see {@link LeaveAllowance}).
 */
export function leaveAllowanceOf(allowance: LeaveAllowance, leaveYear: number): number {
  if (!Number.isInteger(leaveYear)) {
    throw new RangeError(`the leave year is ${String(leaveYear)}, not an integer`);
  }
  checkLeaveAllowance(allowance);
  let chosen: LeaveAllowanceVersion | null = null;
  for (const version of allowance.versions) {
    if (version.leaveYear > leaveYear) continue;
    if (
      chosen === null ||
      version.leaveYear > chosen.leaveYear ||
      (version.leaveYear === chosen.leaveYear && version.id > chosen.id)
    ) {
      chosen = version;
    }
  }
  return chosen === null ? allowance.startingDays : chosen.days;
}

/** An already-checked balance input's current leave year, its number and the allowance resolved for it. */
interface CurrentYear {
  readonly year: LeaveRange;
  readonly yearNumber: number;
  readonly allowanceDays: number;
}

/** The last day of `month` 1–12 an expiry may fall on: February at 28, as `0057` checks. */
function carryOverLastDayOf(month: number): number {
  return month === 2 ? 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * @throws RangeError naming the value when the cap is not an integer of 1 or
 *   more, the expiry month not an integer 1–12, the expiry day not an integer
 *   from 1 to that month's last day (February at 28), or the first leave year
 *   not an integer 1–9999.
 */
function checkCarryOver(carryOver: LeaveCarryOver): void {
  if (!Number.isInteger(carryOver.maxDays) || carryOver.maxDays < 1) {
    throw new RangeError(`the carry-over cap is ${String(carryOver.maxDays)} days, not an integer of 1 or more`);
  }
  if (!Number.isInteger(carryOver.expiryMonth) || carryOver.expiryMonth < 1 || carryOver.expiryMonth > 12) {
    throw new RangeError(`the carry-over expires in month ${String(carryOver.expiryMonth)}, not an integer 1–12`);
  }
  const lastDay = carryOverLastDayOf(carryOver.expiryMonth);
  if (!Number.isInteger(carryOver.expiryDay) || carryOver.expiryDay < 1 || carryOver.expiryDay > lastDay) {
    throw new RangeError(
      `the carry-over expires on day ${String(carryOver.expiryDay)} of month ${String(carryOver.expiryMonth)}, not an integer 1–${String(lastDay)}`,
    );
  }
  if (!Number.isInteger(carryOver.firstLeaveYear) || carryOver.firstLeaveYear < 1 || carryOver.firstLeaveYear > 9999) {
    throw new RangeError(`the first leave year carried into is ${String(carryOver.firstLeaveYear)}, not an integer 1–9999`);
  }
}

/** `YYYY-MM-DD` of `month` and `day` in calendar year `year` 1–9999. */
function dateIn(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Leave year number `leaveYear` 1–9999 as a range, as {@link leaveYearOf}
 * places it. Start already checked.
 */
function leaveYearNumbered(leaveYear: number, start: LeaveYearStart): LeaveRange {
  return leaveYearOf(dateIn(leaveYear, start.month, start.day), start);
}

/**
 * The expiry of the days carried into leave year `leaveYear` (story 13.4b,
 * the 13.4 spec's Design Notes): the first date on or after that year's first
 * day with the setting's day and month, so always inside the year. A start of
 * 01.01. with 30.06. gives 30.06. of the same year; a start of 01.07. with
 * 30.06. gives 30.06. of the next, the year's last day. An expiry past
 * 9999-12-31 is cut there, the calendar's end.
 *
 * @throws RangeError when `leaveYear` is not an integer 1–9999, on a
 *   malformed setting (see {@link LeaveCarryOver}), and on a malformed start.
 */
export function carryOverExpiryOf(leaveYear: number, start: LeaveYearStart, carryOver: LeaveCarryOver): string {
  if (!Number.isInteger(leaveYear) || leaveYear < 1 || leaveYear > 9999) {
    throw new RangeError(`the leave year is ${String(leaveYear)}, not an integer 1–9999`);
  }
  checkLeaveYearStart(start);
  checkCarryOver(carryOver);
  const first = dateIn(leaveYear, start.month, start.day);
  const sameYear = dateIn(leaveYear, carryOver.expiryMonth, carryOver.expiryDay);
  if (sameYear >= first) return sameYear;
  return leaveYear + 1 > 9999 ? '9999-12-31' : dateIn(leaveYear + 1, carryOver.expiryMonth, carryOver.expiryDay);
}

/**
 * Every precondition of a balance input, the current leave year, and its allowance.
 *
 * @throws RangeError on any precondition of {@link leaveBalanceOf}.
 */
function checkBalanceInput(balance: LeaveBalanceInput): CurrentYear {
  checkDate('today', balance.today);
  checkLeaveYearStart(balance.leaveYearStart);
  if (balance.carryOver !== undefined && balance.carryOver !== null) checkCarryOver(balance.carryOver);
  const yearNumber = leaveYearNumberOf(balance.today, balance.leaveYearStart);
  const allowanceDays = leaveAllowanceOf(balance.allowance, yearNumber);
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
  return { year: leaveYearOf(balance.today, balance.leaveYearStart), yearNumber, allowanceDays };
}

/** A cost counter over one member's input: the leave days of a range not inside any of `skip`. */
type CostOf = (range: LeaveRange, skip?: readonly LeaveRange[]) => number;

/**
 * A drawn-days counter: the leave days of every DRAWING record inside
 * `window`, plus those of `extra` (a range being previewed, already known to
 * draw) not already covered by a record, so no date is counted twice.
 */
function drawnDaysCounter(costOf: CostOf, records: readonly LeaveRange[], extra: LeaveRange | null): (window: LeaveRange) => number {
  return (window) => {
    let days = 0;
    for (const record of records) {
      if (!drawsAllowance(record)) continue;
      const inWindow = intersect(record, window);
      if (inWindow !== null) days += costOf(inWindow);
    }
    if (extra !== null) {
      const inWindow = intersect(extra, window);
      if (inWindow !== null) days += costOf(inWindow, records);
    }
    return days;
  };
}

/** The days carried into a year and what of them its drawing leave days consumed by the expiry. */
interface CarriedInto {
  readonly carriedDays: number;
  readonly consumedDays: number;
  /** `null` when nothing was carried. */
  readonly expiry: string | null;
}

const NOTHING_CARRIED: CarriedInto = { carriedDays: 0, consumedDays: 0, expiry: null };

/**
 * What was carried into leave year `yearNumber` and consumed by its expiry
 * (R4.13, R4.14), by the chain from the setting's first year.
 *
 * The chain starts at the later of the year before the first and the year
 * before the earliest drawing record (or extra): a year with no drawing leave
 * days ends at its own allowance whatever was carried into it, so nothing
 * before it can change what follows.
 */
function carriedInto(
  drawnIn: (window: LeaveRange) => number,
  balance: LeaveBalanceInput,
  yearNumber: number,
  extra: LeaveRange | null,
): CarriedInto {
  const carryOver = balance.carryOver;
  if (carryOver === undefined || carryOver === null || yearNumber < carryOver.firstLeaveYear) return NOTHING_CARRIED;
  const start = balance.leaveYearStart;

  let earliest = yearNumber;
  for (const record of [...balance.records.filter(drawsAllowance), ...(extra === null ? [] : [extra])]) {
    earliest = Math.min(earliest, leaveYearNumberOf(record.from, start));
  }

  const consumedIn = (year: number, carriedDays: number): CarriedInto => {
    if (carriedDays === 0) return NOTHING_CARRIED;
    const expiry = carryOverExpiryOf(year, start, carryOver);
    const drawnByExpiry = drawnIn({ from: leaveYearNumbered(year, start).from, to: expiry });
    return { carriedDays, consumedDays: Math.min(carriedDays, drawnByExpiry), expiry };
  };

  let carried = 0;
  for (let year = Math.min(yearNumber - 1, Math.max(carryOver.firstLeaveYear - 1, earliest - 1)); year < yearNumber; year += 1) {
    if (year < 1) {
      // Leave year 0 (dates in 0001 before the start) carries nothing onward.
      carried = 0;
      continue;
    }
    const { consumedDays } = consumedIn(year, carried);
    const endBalance = leaveAllowanceOf(balance.allowance, year) + consumedDays - drawnIn(leaveYearNumbered(year, start));
    carried = year + 1 >= carryOver.firstLeaveYear ? Math.min(carryOver.maxDays, Math.max(0, endBalance)) : 0;
  }
  return consumedIn(yearNumber, carried);
}

/** A balance and the current year's balance after the expiry, the one the preview's warning judges. */
interface BalanceAndEnd {
  readonly balance: LeaveBalance;
  readonly endBalanceDays: number;
}

/**
 * The balance of an already-checked input in its current year, counted by
 * `costOf`; only drawing records are used, plus `extra` when given (a range
 * being previewed, known to draw).
 */
function balanceOf(costOf: CostOf, balance: LeaveBalanceInput, current: CurrentYear, extra: LeaveRange | null = null): BalanceAndEnd {
  const drawnIn = drawnDaysCounter(costOf, balance.records, extra);
  const usedDays = drawnIn(current.year);
  const carried = carriedInto(drawnIn, balance, current.yearNumber, extra);
  const pending = carried.expiry !== null && balance.today <= carried.expiry;
  const carriedDays = pending ? carried.carriedDays : carried.consumedDays;
  const lapsedDays = pending ? 0 : carried.carriedDays - carried.consumedDays;
  return {
    balance: {
      allowanceDays: current.allowanceDays,
      carriedDays,
      lapsedDays,
      carryOverExpiry: carried.expiry,
      usedDays,
      balanceDays: current.allowanceDays + carriedDays - usedDays,
    },
    endBalanceDays: current.allowanceDays + carried.consumedDays - usedDays,
  };
}

/**
 * The member's balance in the current leave year (R4.5, R4.6, R4.13–R4.15):
 * the allowance of that leave year ({@link leaveAllowanceOf}, story 13.3),
 * the carried days and their expiry (story 13.4b, see CARRY-OVER above), the
 * leave days of every DRAWING record's dates (story 13.2) inside the leave
 * year containing `today` — a record straddling the year's start or end
 * counts only its dates inside it — and allowance + carried − used, which may
 * be negative.
 *
 * @throws RangeError when the allowance is malformed (a starting allowance or
 *   version days not a whole number of zero or more, a version id not a
 *   positive integer, a version leave year not an integer 1–9999); when the
 *   carry-over setting is malformed (see {@link LeaveCarryOver}); when
 *   `today`, or the start or end of a record, is not a calendar
 *   `YYYY-MM-DD`; when a record ends before it starts or is longer than
 *   {@link MAX_LEAVE_RANGE_DAYS}; when two records share a date; on any
 *   precondition of {@link leaveYearOf}; and on any of
 *   {@link memberScheduleOfMonth}.
 */
export function leaveBalanceOf(balance: LeaveBalanceInput): LeaveBalance {
  const current = checkBalanceInput(balance);
  return balanceOf(costCounter(balance.input), balance, current).balance;
}

/**
 * What saving `range` would do (R4.2, R4.7): the balance before it, the
 * range's cost over every date, the part the balance is charged — its dates
 * inside the current leave year that no existing record covers, so no date
 * is charged twice, and nothing when the range does not draw the allowance —
 * the balance with the range added as a record, whether the charge is
 * positive and the year's balance after the expiry, with the range, would be
 * negative (story 13.4b: days after the expiry are never covered by carried
 * days), and whether the range overlaps an existing record. The flags are
 * warnings; nothing here refuses.
 *
 * @throws RangeError on any precondition of {@link leaveBalanceOf}, and when
 *   the start or end of `range` is not a calendar `YYYY-MM-DD`, when it ends
 *   before it starts, or when it is longer than {@link MAX_LEAVE_RANGE_DAYS}.
 */
export function leavePreviewOf(preview: LeavePreviewInput): LeavePreview {
  const current = checkBalanceInput(preview);
  checkRange('the leave range', preview.range);

  const costOf = costCounter(preview.input);
  const beforeAndEnd = balanceOf(costOf, preview, current);
  const before = beforeAndEnd.balance;
  const costDays = costOf(preview.range);
  const inYear = intersect(preview.range, current.year);
  // A range of a type that does not draw the allowance charges nothing; its
  // cost over every date is still reported (story 13.2).
  const draws = drawsAllowance(preview.range);
  const costInYearDays = inYear === null || !draws ? 0 : costOf(inYear, preview.records);
  const after = draws ? balanceOf(costOf, preview, current, { from: preview.range.from, to: preview.range.to }) : beforeAndEnd;
  // The range lowers the balance: by its charge in the year, or — a range in
  // the previous leave year — by shrinking what is carried into this one.
  const lowers = costInYearDays > 0 || after.balance.balanceDays < before.balanceDays;
  const exceedsBalance = lowers && after.endBalanceDays < 0;

  return {
    ...before,
    costDays,
    costInYearDays,
    balanceAfterDays: after.balance.balanceDays,
    endBalanceAfterDays: after.endBalanceDays,
    exceedsBalance,
    exceedsAfterExpiry: exceedsBalance && after.balance.balanceDays >= 0,
    overlapsRecord: preview.records.some((record) => intersect(record, preview.range) !== null),
  };
}
