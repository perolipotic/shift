/**
 * Duties (story 6.2): working shifts that touch, read as one. PRESENTATION
 * ONLY — a duty is never stored, and the data stays one scheduled shift per
 * date. Codes and integer minutes over nominal wall-clock time; nothing here
 * reads a zone or constructs a `Date`.
 *
 * A LEG is one working shift: its date, the minute of that date it starts at
 * and how long it runs. Its ABSOLUTE start is `civilDayNumber(date) · 1440 +
 * startMinute`, so a leg on one date and the next leg on the following date
 * compare as plain integers.
 *
 * Legs sorted by start JOIN when a leg starts exactly where the previous one
 * ends. A gap of any length never joins: two legs that do not touch are two
 * shifts. A leg that OVERLAPS any other leg is in no duty at all — nor is the
 * leg it overlaps: two shifts at once are a roster defect a duty must not
 * paper over, and keeping either would pick one arbitrarily. A duty is two or
 * more joined legs; a leg alone is a shift.
 */

import { MINUTES_PER_DAY } from './bands.js';
import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';

/** One working shift, as far as a duty reads it. */
export interface DutyLeg {
  /** `YYYY-MM-DD`: the date the shift is scheduled on. */
  readonly date: string;
  /** The minute of `date` it starts at, 0–1439. */
  readonly startMinute: number;
  /** How long it runs, 1–1440 minutes (`deriveShiftTimes`'s `durationMinutes`). */
  readonly durationMinutes: number;
}

/** Two or more legs, each starting where the one before it ends. */
export interface Duty<Leg extends DutyLeg = DutyLeg> {
  /** In start order; at least two. */
  readonly legs: readonly Leg[];
  /** The first leg's absolute start, in minutes. */
  readonly startMinute: number;
  /** The last leg's absolute end, in minutes. */
  readonly endMinute: number;
  /** `endMinute − startMinute`: every leg's duration, summed. */
  readonly totalMinutes: number;
}

/** Not begun at the minute asked about. */
export const DUTY_UPCOMING = 'upcoming';
/** Begun and not ended: the start included, the end excluded. */
export const DUTY_RUNNING = 'running';
/** Ended: at or after the end. */
export const DUTY_DONE = 'done';

export type DutyPhase = typeof DUTY_UPCOMING | typeof DUTY_RUNNING | typeof DUTY_DONE;

/** Where a minute falls within a duty. */
export interface DutyProgress {
  readonly phase: DutyPhase;
  /** Minutes of the duty already behind, 0–total. */
  readonly elapsedMinutes: number;
  /** Minutes still ahead: `total − elapsed`. */
  readonly remainingMinutes: number;
  /** Each leg's own phase, in the duty's leg order. */
  readonly legs: readonly DutyPhase[];
}

/** A date and a minute of it: what an absolute minute reads back as. */
export interface DutyMoment {
  readonly date: string;
  /** 0–1439. */
  readonly minute: number;
}

/** @throws RangeError when `minute` is not an integer in 0–1439. */
function checkMinuteOfDay(what: string, minute: number): void {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw new RangeError(`${what} is ${minute}, not a whole minute in 0–${MINUTES_PER_DAY - 1}`);
  }
}

/**
 * The absolute minute of `minute` on `date`: `civilDayNumber(date) · 1440 +
 * minute`.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD` or `minute`
 *   is not an integer in 0–1439.
 */
export function absoluteMinuteOf(date: string, minute: number): number {
  checkDate('the date', date);
  checkMinuteOfDay(`the minute of ${date}`, minute);

  return civilDayNumber(date) * MINUTES_PER_DAY + minute;
}

/**
 * The date and minute an absolute minute falls on: the inverse of
 * {@link absoluteMinuteOf}.
 *
 * @throws RangeError when `absolute` is not an integer, or falls outside
 *   years 0001–9999.
 */
export function momentOf(absolute: number): DutyMoment {
  if (!Number.isInteger(absolute)) throw new RangeError(`the minute ${absolute} is not a whole minute`);

  const day = Math.floor(absolute / MINUTES_PER_DAY);
  const date = dateOfCivilDay(day);

  if (date === null) throw new RangeError(`the minute ${absolute} falls outside years 0001–9999`);

  return { date, minute: absolute - day * MINUTES_PER_DAY };
}

/** A checked leg's absolute start. */
function legStart(leg: DutyLeg): number {
  return civilDayNumber(leg.date) * MINUTES_PER_DAY + leg.startMinute;
}

/** @throws RangeError naming the leg when any of its fields is out of range. */
function checkLeg(leg: DutyLeg): void {
  checkDate('a leg is dated', leg.date);
  checkMinuteOfDay(`the start of the leg on ${leg.date}`, leg.startMinute);

  const { durationMinutes } = leg;

  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MINUTES_PER_DAY) {
    throw new RangeError(
      `the leg on ${leg.date} runs ${durationMinutes} minutes, not a whole number in 1–${MINUTES_PER_DAY}`,
    );
  }
}

/**
 * Every duty among `legs`, in start order: runs of two or more legs, sorted
 * by absolute start, in which each leg starts EXACTLY where the one before it
 * ends. A leg that overlaps any other leg — two legs with one start always
 * do — is set aside first, and its neighbours chain without it. A leg that
 * joins nothing is in no duty. Each leg object is returned as given, so a
 * caller's own fields ride along.
 *
 * @throws RangeError when a leg's date is not a calendar date, its start is
 *   not a whole minute in 0–1439, or its duration not one in 1–1440.
 */
export function dutiesOf<Leg extends DutyLeg>(legs: readonly Leg[]): readonly Duty<Leg>[] {
  for (const leg of legs) checkLeg(leg);

  const spans = legs.map((leg) => {
    const start = legStart(leg);

    return { leg, start, end: start + leg.durationMinutes };
  });
  // Half-open spans: a leg ending as another starts touches it, and does not overlap.
  const overlapping = (index: number): boolean => {
    const span = spans[index];

    return (
      span !== undefined &&
      spans.some((other, at) => at !== index && other.start < span.end && span.start < other.end)
    );
  };
  // `sort` is stable: one start is an overlap, set aside, so no tie survives to be ordered.
  const ordered = spans.filter((_, index) => !overlapping(index)).sort((a, b) => a.start - b.start);
  const duties: Duty<Leg>[] = [];
  let run: { leg: Leg; start: number }[] = [];

  const close = (): void => {
    const first = run[0];
    const last = run[run.length - 1];

    if (run.length >= 2 && first !== undefined && last !== undefined) {
      const endMinute = last.start + last.leg.durationMinutes;

      duties.push({
        legs: run.map((entry) => entry.leg),
        startMinute: first.start,
        endMinute,
        totalMinutes: endMinute - first.start,
      });
    }

    run = [];
  };

  for (const entry of ordered) {
    const previous = run[run.length - 1];

    if (previous !== undefined && entry.start !== previous.start + previous.leg.durationMinutes) close();

    run.push(entry);
  }

  close();

  return duties;
}

/** The phase of the span `[start, end)` at `now`. */
function phaseOf(start: number, end: number, now: number): DutyPhase {
  if (now < start) return DUTY_UPCOMING;
  if (now >= end) return DUTY_DONE;

  return DUTY_RUNNING;
}

/**
 * Where the absolute minute `nowMinute` falls within `duty`: upcoming before
 * its start, running from its start up to (not including) its end, done from
 * its end on — and each leg's phase by the same rule.
 *
 * @throws RangeError when `nowMinute` is not an integer.
 */
export function dutyProgressOf<Leg extends DutyLeg>(duty: Duty<Leg>, nowMinute: number): DutyProgress {
  if (!Number.isInteger(nowMinute)) throw new RangeError(`now is ${nowMinute}, not a whole minute`);

  const elapsedMinutes = Math.min(Math.max(nowMinute - duty.startMinute, 0), duty.totalMinutes);
  const legs = duty.legs.map((leg) => {
    const start = legStart(leg);

    return phaseOf(start, start + leg.durationMinutes, nowMinute);
  });

  return {
    phase: phaseOf(duty.startMinute, duty.endMinute, nowMinute),
    elapsedMinutes,
    remainingMinutes: duty.totalMinutes - elapsedMinutes,
    legs,
  };
}
