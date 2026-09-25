/**
 * Shift types and their durations (CAP-7, DI-5, AD-2, AD-7).
 *
 * An organization stores a shift type as a name and whether it is working
 * (current-state), and a working type's times as versions, each effective from
 * a date. The duration is derived here and nowhere else, never stored:
 *
 *   duration = end − start, plus 1440 when end <= start
 *
 * So 19:00–07:00 is 720 minutes and 07:00–07:00 a full 1440. A shift is ONE
 * span, attributed to its start date and never split at midnight.
 * `crossesMidnight` is strict: it says the span runs PAST the end of its start
 * date (`start + duration > 1440`), so 19:00–00:00 and 00:00–00:00, which end
 * exactly at midnight, do not cross.
 *
 * A non-working type has no times and a duration of 0. The times in effect on
 * a date are those of the version with the greatest `effectiveFrom` on or
 * before it, so a correction never rewrites a date before it.
 *
 * Time is integer minutes since midnight over nominal wall-clock time
 * (0–1439); dates are `YYYY-MM-DD` strings, compared lexically and never
 * turned into a `Date`. Nothing here reads a name.
 *
 * The preconditions the schema enforces are re-checked on entry, and a breach
 * throws a `RangeError` naming the offending value.
 */

import { MINUTES_PER_DAY } from './bands.js';
import { checkDate } from './calendar.js';

/** One stored shift type, as the database holds it (`shift_types`). */
export interface ShiftType {
  readonly id: string;
  readonly name: string;
  readonly isWorking: boolean;
}

/**
 * One stored version of a working type's times (`shift_type_versions`).
 *
 * Preconditions, enforced by the schema (`0013_shift_types.sql`) and
 * re-checked here on every version given: both minutes are integers in
 * 0–1439, `effectiveFrom` is a calendar date as `YYYY-MM-DD`, and no two
 * versions of one type share it.
 */
export interface ShiftTypeVersion {
  readonly shiftTypeId: string;
  readonly effectiveFrom: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

/** A shift's derived span. `endMinute` is the wall-clock end (0–1439). */
export interface ShiftTimes {
  readonly startMinute: number;
  readonly endMinute: number;
  /** 1–1440: an end at or before the start is on the next day. */
  readonly durationMinutes: number;
  /**
   * Whether the one span runs PAST the end of its start date (strictly:
   * `start + duration > 1440`). 19:00–00:00 and 00:00–00:00 end exactly at
   * midnight and do not cross.
   */
  readonly crossesMidnight: boolean;
}

/** @throws RangeError naming `what` when `minute` is not an integer in 0–1439. */
function checkMinute(what: string, minute: number): void {
  if (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY) {
    throw new RangeError(`${what} is ${minute}, not a whole minute in 0–${MINUTES_PER_DAY - 1}`);
  }
}

/**
 * The span a start and an end describe. An end at or before the start is on
 * the next day, so equal times are a full 24 hours.
 *
 * @throws RangeError naming the value when either minute is not an integer in
 *   0–1439.
 */
export function deriveShiftTimes(startMinute: number, endMinute: number): ShiftTimes {
  checkMinute('the start', startMinute);
  checkMinute('the end', endMinute);

  const durationMinutes =
    endMinute <= startMinute ? endMinute - startMinute + MINUTES_PER_DAY : endMinute - startMinute;

  return {
    startMinute,
    endMinute,
    durationMinutes,
    crossesMidnight: startMinute + durationMinutes > MINUTES_PER_DAY,
  };
}

/**
 * The version of ONE shift type in effect on `date`: the one with the greatest
 * `effectiveFrom` on or before it, or `null` when none has begun yet.
 *
 * @throws RangeError naming the value when `date` or a version's
 *   `effectiveFrom` is not a calendar `YYYY-MM-DD`, when a version's start or
 *   end is not an integer in 0–1439, when the versions belong to more than one
 *   shift type, or when two versions share an `effectiveFrom`.
 */
export function shiftTypeVersionOn(
  versions: readonly ShiftTypeVersion[],
  date: string,
): ShiftTypeVersion | null {
  checkDate('the date', date);

  const seen = new Set<string>();
  const typeId = versions[0]?.shiftTypeId;
  let inEffect: ShiftTypeVersion | null = null;
  for (const version of versions) {
    const { effectiveFrom, shiftTypeId } = version;
    if (shiftTypeId !== typeId) {
      throw new RangeError(
        `versions of shift types ${typeId} and ${shiftTypeId} were given together; pass one type's versions`,
      );
    }
    checkDate(`a version of shift type ${shiftTypeId} is effective from`, effectiveFrom);
    checkMinute(`the start of shift type ${shiftTypeId} from ${effectiveFrom}`, version.startMinute);
    checkMinute(`the end of shift type ${shiftTypeId} from ${effectiveFrom}`, version.endMinute);
    if (seen.has(effectiveFrom)) {
      throw new RangeError(
        `two versions of shift type ${version.shiftTypeId} are effective from ${effectiveFrom}`,
      );
    }
    seen.add(effectiveFrom);
    if (effectiveFrom <= date && (inEffect === null || effectiveFrom > inEffect.effectiveFrom)) {
      inEffect = version;
    }
  }
  return inEffect;
}

/**
 * How long a shift of `type` runs on `date`: 0 for a non-working type, the
 * derived duration of the version in effect for a working one, and `null` for
 * a working type with no version in effect yet — nothing invents its times.
 *
 * @throws RangeError when a precondition of {@link shiftTypeVersionOn} or
 *   {@link deriveShiftTimes} is breached, when a version belongs to another
 *   type, or when a non-working type carries a version.
 */
export function shiftDurationOn(
  type: ShiftType,
  versions: readonly ShiftTypeVersion[],
  date: string,
): number | null {
  const stranger = versions.find((version) => version.shiftTypeId !== type.id);
  if (stranger !== undefined) {
    throw new RangeError(
      `a version of shift type ${stranger.shiftTypeId} was given for shift type ${type.id}`,
    );
  }
  if (!type.isWorking) {
    checkDate('the date', date);
    if (versions.length > 0) {
      throw new RangeError(`non-working shift type ${type.id} carries a version, and has no times`);
    }
    return 0;
  }
  const version = shiftTypeVersionOn(versions, date);
  return version === null
    ? null
    : deriveShiftTimes(version.startMinute, version.endMinute).durationMinutes;
}
