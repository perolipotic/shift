import {
  LEAVE_HALF_FIRST,
  LEAVE_HALF_SECOND,
  halfDayShiftOf,
  shiftHalvesOf,
  shiftTypeVersionOn,
  type LeaveBalanceInput,
  type LeaveHalf,
  type LeaveRange,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { formatMinuteOfDay, isIsoDate } from '@/lib/i18n/format';

/**
 * The half-day choice (story 13.5): *Pola dana*'s state, when it is offered,
 * the half sent, and the two half cards. Split out of `leave-section.ts`
 * (epic 13 retro A8), which re-exports its public names; it imports nothing
 * from there.
 */

/**
 * The half-day choice (story 13.5): *Pola dana* off, or on with the half
 * chosen, or none yet — neither card is preselected.
 */
export interface LeaveHalfChoice {
  readonly on: boolean;
  readonly half: LeaveHalf | null;
}

/** *Pola dana* off: a whole day, what every opening starts on unless its record is a half day. */
export const LEAVE_WHOLE_DAY: LeaveHalfChoice = { on: false, half: null };

/** The choice an amend opens on: its record's half, or a whole day. */
export function leaveHalfChoiceOf(record: LeaveRange | null): LeaveHalfChoice {
  return record?.half === LEAVE_HALF_FIRST || record?.half === LEAVE_HALF_SECOND ? { on: true, half: record.half } : LEAVE_WHOLE_DAY;
}

/**
 * The half choice once the amend's dialog lands on `from`–`to` (epic 13 retro
 * A2): the amended record's own half while the range is its own one date and
 * the record is a half day, so switching *Pola dana* back on or moving the
 * date back never loses the stored half (on a date with no single working
 * shift no card could pick it again); otherwise `otherwise`.
 */
export function leaveHalfRestoredOf(
  target: LeaveRange | null,
  from: string,
  to: string,
  otherwise: LeaveHalfChoice,
): LeaveHalfChoice {
  const stored = leaveHalfChoiceOf(target);

  return target !== null && stored.on && from === target.from && to === target.to ? stored : otherwise;
}

/** Whether *Pola dana* is offered: while Od and Do are one calendar date (story 13.5). */
export function leaveHalfOfferedOf(from: string, to: string): boolean {
  return isIsoDate(from) && from === to;
}

/**
 * The half the range is sent with: the chosen one while *Pola dana* is
 * offered and on, else none — a range of more than one date clears it.
 */
export function leaveSentHalfOf(from: string, to: string, choice: LeaveHalfChoice): LeaveHalf | null {
  return leaveHalfOfferedOf(from, to) && choice.on ? choice.half : null;
}

/** One half card (story 13.5): its half, and its times, `07:00`–`13:00`, or `null` for a shift with no times that date. */
export interface LeaveHalfOption {
  readonly half: LeaveHalf;
  readonly times: { readonly from: string; readonly to: string } | null;
}

/**
 * The two half cards for `date` (story 13.5, R4.12): *Prvi dio smjene* and
 * *Drugi dio smjene*, each with its times — the member's one working shift
 * that date split at its nominal midpoint (`shiftHalvesOf`), from the type's
 * version in force on it. `null` when the date holds no working shift or
 * more than one (`halfDayShiftOf`): the half day is then refused. A shift
 * whose type or version the snapshot does not hold for the date gets both
 * cards with no times, never invented ones.
 *
 * @throws RangeError on any precondition of the domain.
 */
export function leaveHalfOptionsOf(
  snapshot: CalendarSnapshot,
  input: LeaveBalanceInput['input'],
  date: string,
): readonly LeaveHalfOption[] | null {
  if (!isIsoDate(date)) return null;

  const shift = halfDayShiftOf(input, date);

  if (shift === null) return null;

  const type = snapshot.types.find((one) => one.id === shift.shiftTypeId);
  const version = type === undefined ? null : shiftTypeVersionOn(type.versions, date);

  // A type or a version the snapshot does not hold for the date: both cards, no times.
  if (version === null) {
    return [
      { half: LEAVE_HALF_FIRST, times: null },
      { half: LEAVE_HALF_SECOND, times: null },
    ];
  }

  const halves = shiftHalvesOf(version.startMinute, version.endMinute);
  const at = (minute: number): string => formatMinuteOfDay(minute % MINUTES_IN_DAY);
  const end = halves.second.startMinute + halves.second.durationMinutes;

  return [
    { half: LEAVE_HALF_FIRST, times: { from: at(halves.first.startMinute), to: at(halves.midpointMinute) } },
    { half: LEAVE_HALF_SECOND, times: { from: at(halves.midpointMinute), to: at(end) } },
  ];
}

const MINUTES_IN_DAY = 1440;
