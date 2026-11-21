/**
 * Zone arithmetic at the edges (AD-6 as amended by Architect pass 1; story
 * 16.2).
 *
 * Every rule of this package is nominal wall-clock minutes over civil dates,
 * and no instant enters a calculation of hours, leave, rosters or conflicts.
 * Two consumers need an instant: a reminder's due time (`remind`) and a
 * calendar's timezone definition (`@shift/ics`). Both get it from THIS
 * module, which converts an organization-local date and minute to an instant
 * and lists a zone's offset transitions over a range.
 *
 * It uses only the runtime's built-in `Intl` (no timezone library, no I/O),
 * and it is the ONLY module of this package that names `Intl` or the
 * built-in date object (`test/purity.test.ts`). An instant here is a number:
 * epoch milliseconds, UTC. A second local-to-UTC conversion anywhere else is
 * a defect.
 *
 * A LOCAL TIME A TRANSITION SKIPS (spring forward) is read with the offset in
 * force before the transition, so it lands that far after the gap: 02:30 on
 * 2026-03-29 in Europe/Zagreb is 01:30Z, which reads 03:30 local. A LOCAL TIME
 * A TRANSITION REPEATS (fall back) is its EARLIER instant. Both are the
 * "compatible" rule of RFC 5545 §3.3.5 and of ECMAScript Temporal.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';
import { MINUTES_PER_DAY } from './bands.js';

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/** How far apart the transition scan samples the offset: no zone changes twice within it. */
const SCAN_STEP_MS = 12 * 60 * MS_PER_MINUTE;

/** The longest range {@link zoneTransitionsOf} scans, in days: about eleven years. */
export const MAX_ZONE_RANGE_DAYS = 4018;

/** One change of a zone's UTC offset: the instant it takes effect, and the offsets either side, in minutes east of UTC. */
export interface ZoneTransition {
  /** Epoch milliseconds, UTC: the first instant of the new offset. */
  readonly instant: number;
  readonly offsetFromMinutes: number;
  readonly offsetToMinutes: number;
}

/** One formatter per zone: a built-in object, not a derived value, so keeping it is no cache of the schedule (AD-1). */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterOf(zone: string): Intl.DateTimeFormat {
  const known = FORMATTERS.get(zone);
  if (known !== undefined) return known;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
  } catch {
    throw new RangeError(`the time zone is ${JSON.stringify(zone)}, which this runtime does not know`);
  }
  FORMATTERS.set(zone, formatter);
  return formatter;
}

/**
 * @throws RangeError when `zone` is not an IANA time zone the runtime knows.
 */
export function checkTimeZone(zone: string): void {
  if (typeof zone !== 'string' || zone === '') {
    throw new RangeError(`the time zone is ${JSON.stringify(zone)}, which this runtime does not know`);
  }
  formatterOf(zone);
}

function checkInstant(instant: number): void {
  if (!Number.isSafeInteger(instant)) {
    throw new RangeError(`the instant is ${String(instant)}, not a whole number of epoch milliseconds`);
  }
}

/**
 * The UTC offset of `zone` at `instant`, in minutes east of UTC (Zagreb in
 * winter answers 60): the zone's wall clock at that instant, read through
 * `Intl`, minus the instant.
 *
 * @throws RangeError when `instant` is not a safe integer, or `zone` is not
 *   one the runtime knows.
 */
export function offsetMinutesAt(instant: number, zone: string): number {
  checkInstant(instant);
  const parts = formatterOf(zone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(value)) throw new RangeError(`the runtime formats the ${type} of ${zone} unreadably`);
    return value;
  };
  const era = parts.find((part) => part.type === 'era')?.value;
  const year = era === 'BC' || era === 'B' ? 1 - field('year') : field('year');
  const second = Math.floor(instant / MS_PER_SECOND) * MS_PER_SECOND;
  const wall =
    civilDayOf(year, field('month'), field('day')) * MS_PER_DAY +
    field('hour') * 60 * MS_PER_MINUTE +
    field('minute') * MS_PER_MINUTE +
    field('second') * MS_PER_SECOND;
  return (wall - second) / MS_PER_MINUTE;
}

/** The civil day number of a year, month and day, any proleptic year. */
function civilDayOf(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthFromMarch = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/**
 * The instant at which the wall clock of `zone` reads `minute` minutes after
 * the start of `date`, in epoch milliseconds. `minute` may run into the next
 * date (a shift crossing midnight ends there, DI-5): 0 up to two days.
 * A skipped local time is read with the offset before the gap, and a
 * repeated one is its earlier instant (the module's rule).
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`, when
 *   `minute` is not a whole number in 0–2879, and when `zone` is not one the
 *   runtime knows.
 */
export function instantOf(date: string, minute: number, zone: string): number {
  checkDate('the local date', date);
  if (!Number.isInteger(minute) || minute < 0 || minute >= 2 * MINUTES_PER_DAY) {
    throw new RangeError(`the local minute is ${String(minute)}, not a whole minute in 0–${String(2 * MINUTES_PER_DAY - 1)}`);
  }
  checkTimeZone(zone);
  const local = civilDayNumber(date) * MS_PER_DAY + minute * MS_PER_MINUTE;
  // The offsets a day either side: across any one transition, these are the
  // two the local time could be read with.
  const before = offsetMinutesAt(local - MS_PER_DAY, zone);
  const after = offsetMinutesAt(local + MS_PER_DAY, zone);
  const candidates = [...new Set([local - before * MS_PER_MINUTE, local - after * MS_PER_MINUTE])]
    .filter((instant) => instant + offsetMinutesAt(instant, zone) * MS_PER_MINUTE === local)
    .sort((left, right) => left - right);
  // Repeated: the earlier. Skipped: none matches, and the offset before the gap is used.
  return candidates[0] ?? local - before * MS_PER_MINUTE;
}

/**
 * An instant as an ISO 8601 UTC timestamp to the second, `YYYY-MM-DDTHH:MM:SSZ`.
 *
 * @throws RangeError when `instant` is not a safe integer, or falls outside
 *   years 0001–9999.
 */
export function utcIsoOf(instant: number): string {
  checkInstant(instant);
  const day = Math.floor(instant / MS_PER_DAY);
  const date = dateOfCivilDay(day);
  if (date === null) throw new RangeError(`the instant ${String(instant)} is outside years 0001–9999`);
  const seconds = Math.floor((instant - day * MS_PER_DAY) / MS_PER_SECOND);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date}T${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}Z`;
}

/**
 * Every offset transition of `zone` whose instant falls from the start of
 * `from` through the end of `to`, local dates both inclusive, in order. A
 * zone with no transition in the range answers none.
 *
 * @throws RangeError when `from` or `to` is not a calendar `YYYY-MM-DD`, when
 *   `to` is before `from` or the range is longer than
 *   {@link MAX_ZONE_RANGE_DAYS}, and when `zone` is not one the runtime knows.
 */
export function zoneTransitionsOf(zone: string, from: string, to: string): readonly ZoneTransition[] {
  checkDate('the first date', from);
  checkDate('the last date', to);
  if (to < from) throw new RangeError(`the range ${from}–${to} ends before it starts`);
  if (civilDayNumber(to) - civilDayNumber(from) + 1 > MAX_ZONE_RANGE_DAYS) {
    throw new RangeError(`the range ${from}–${to} is longer than ${String(MAX_ZONE_RANGE_DAYS)} days`);
  }
  checkTimeZone(zone);
  const start = instantOf(from, 0, zone);
  // The first instant of the date after `to`: minute 1440 of `to`.
  const end = instantOf(to, MINUTES_PER_DAY, zone);

  const transitions: ZoneTransition[] = [];
  // From a second before the range, so a transition AT its first instant (a
  // zone that springs forward at midnight) is found and kept.
  let low = start - MS_PER_SECOND;
  let lowOffset = offsetMinutesAt(low, zone);
  while (low < end) {
    const high = Math.min(low + SCAN_STEP_MS, end);
    const highOffset = offsetMinutesAt(high, zone);
    if (highOffset !== lowOffset) {
      // Narrow to the second: the first instant that reads the new offset.
      let before = low;
      let after = high;
      while (after - before > MS_PER_SECOND) {
        const middle = before + Math.floor((after - before) / 2 / MS_PER_SECOND) * MS_PER_SECOND;
        if (middle === before) break;
        if (offsetMinutesAt(middle, zone) === lowOffset) before = middle;
        else after = middle;
      }
      if (after >= start && after < end) {
        transitions.push({ instant: after, offsetFromMinutes: lowOffset, offsetToMinutes: offsetMinutesAt(after, zone) });
      }
    }
    low = high;
    lowOffset = highOffset;
  }
  return transitions;
}
