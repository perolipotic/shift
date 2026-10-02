/**
 * Hours (story 4.1a; CAP-3, AD-3, AD-7).
 *
 * The ONE hour computation. A member's month is walked through
 * {@link memberScheduleOfMonth} — so it follows the shift-type and roster
 * overrides the caller passes, exactly as the schedule does — and each working
 * shift's nominal interval is intersected with the organization's hour bands.
 * Hours are derived, never entered, cached or stored, and recomputing them
 * anywhere else is a defect.
 *
 * A shift is ONE interval `[start, start + duration)` in integer minutes over
 * nominal wall-clock time, its duration that of the shift-type version in
 * force on its date (`shiftTypeVersionOn`, `deriveShiftTimes`). A shift that
 * crosses midnight is still one interval, counted wholly in the month of its
 * start date and never split at midnight. There is no `Date`, no time zone and
 * no elapsed time, so a daylight-saving date changes nothing, and nothing is
 * ever rounded.
 *
 * The invariant: the band minutes plus `unbandedMinutes` equal `totalMinutes`,
 * and `totalMinutes` is the sum of the durations of the timed working shifts.
 * `unbandedMinutes` is non-zero only when the organization has no bands.
 *
 * LEAVE SHIFTS (story 5.4b). A shift the caller names in `leaveShifts` — an
 * accepted-uncovered conflict of THIS member: the member was on leave and the
 * shift went without them — is not worked. Its duration counts in
 * `leaveMinutes` and nowhere else: in no band, not in the total and not in
 * `shiftCount`. An untimed one adds nothing anywhere, not even to
 * `untimedShiftCount`. A name that matches no working shift of the member's
 * schedule changes nothing, and no `leaveShifts` at all leaves every figure as
 * it was. The leave minutes never enter a band or the total, so the invariant
 * holds as it is.
 *
 * The result is numbers and ids only; nothing here reads a name.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { MINUTES_PER_DAY, deriveHourBands, partitionOfDay, type DayPartition, type HourBand } from './bands.js';
import { deriveShiftTimes, shiftDurationOn, shiftTypeVersionOn, type ShiftType, type ShiftTypeVersion } from './duration.js';
import { datesOfMonth, memberScheduleOfMonth, type MemberScheduleInput } from './schedule.js';

/** One shift type with every version of its times. */
export interface ShiftTypeWithVersions {
  readonly type: ShiftType;
  /** Every version of THIS type's times, in any order; none for a non-working type. */
  readonly versions: readonly ShiftTypeVersion[];
}

/** What one member's hours are derived from: their month's schedule input, the bands and the shift types. */
export interface MemberHoursInput extends MemberScheduleInput {
  /** Every hour band of the organization; none is a valid configuration. */
  readonly bands: readonly HourBand[];
  /**
   * Every shift type of the organization, each once, with its versions. The
   * working ones must be exactly `workingShiftTypeIds`.
   */
  readonly shiftTypes: readonly ShiftTypeWithVersions[];
  /**
   * The member's shifts that count as leave, not as work (story 5.4b): each
   * `(date, teamId)` of an accepted-uncovered conflict of THIS member, in any
   * order. Absent or empty, every shift is worked.
   */
  readonly leaveShifts?: readonly LeaveShift[];
}

/** One shift of a member, by its date and team, that counts as leave (story 5.4b). */
export interface LeaveShift {
  readonly date: string;
  readonly teamId: string;
}

/** The minutes one band holds in the month, and how many shifts overlap it. */
export interface BandHours {
  readonly bandId: string;
  readonly minutes: number;
  /**
   * Shifts whose interval overlaps this band. A split shift counts once in
   * EVERY band it touches, so these counts do not sum to
   * {@link MemberHours.shiftCount}: under UJ-5, where every shift straddles a
   * band edge, they sum to twice it. An untimed shift counts in
   * `MemberHours.shiftCount` but in no band.
   */
  readonly shiftCount: number;
}

/** One member's hours of a month, in integer minutes. */
export interface MemberHours {
  /** Every working shift of the month, each once, timed or not. */
  readonly shiftCount: number;
  /** Every band, in {@link deriveHourBands} order, those with 0 minutes included. */
  readonly bands: readonly BandHours[];
  /** Minutes covered by no band: non-zero only when there are no bands. */
  readonly unbandedMinutes: number;
  /** The sum of the durations of the timed working shifts. */
  readonly totalMinutes: number;
  /**
   * The durations of the timed working shifts named in `leaveShifts` (story
   * 5.4b); never in a band, the total or `shiftCount`.
   */
  readonly leaveMinutes: number;
  /** Working shifts on a date before their type's first version: counted in `shiftCount`, in no minutes. */
  readonly untimedShiftCount: number;
}

/**
 * The minutes the interval `[startMinute, startMinute + durationMinutes)`
 * spends in each band of `partition`, by band id (`null` for the uncovered
 * day when there are no bands). The interval may run past midnight, up to
 * 2880, so each segment is matched as it is and shifted by one day; a band
 * that crosses midnight is two segments under one id, and so one continuous
 * stretch. Only bands the interval overlaps appear, and their minutes sum to
 * `durationMinutes`.
 */
function minutesByBand(
  partition: DayPartition,
  startMinute: number,
  durationMinutes: number,
): ReadonlyMap<string | null, number> {
  const end = startMinute + durationMinutes;
  const found = new Map<string | null, number>();
  for (const dayOffset of [0, MINUTES_PER_DAY]) {
    for (const segment of partition.segments) {
      const overlap = Math.min(end, segment.toMinute + dayOffset) - Math.max(startMinute, segment.fromMinute + dayOffset);
      if (overlap > 0) found.set(segment.bandId, (found.get(segment.bandId) ?? 0) + overlap);
    }
  }
  return found;
}

/**
 * The shift types by id, after checking each is given once, that its versions
 * are its own and well-formed (a non-working type carries none), and that the
 * working ones are exactly `workingShiftTypeIds`.
 */
function shiftTypesById(input: MemberHoursInput, probeDate: string): ReadonlyMap<string, ShiftTypeWithVersions> {
  const byId = new Map<string, ShiftTypeWithVersions>();
  for (const entry of input.shiftTypes) {
    const { id } = entry.type;
    if (byId.has(id)) throw new RangeError(`shift type ${id} is given twice`);
    // Checks the versions belong to the type, that a non-working type has
    // none, and every version's date and times, on any one date.
    shiftDurationOn(entry.type, entry.versions, probeDate);
    byId.set(id, entry);
  }

  const working = new Set(input.workingShiftTypeIds);
  for (const id of working) {
    if (byId.get(id)?.type.isWorking !== true) {
      throw new RangeError(`shift type ${id} is listed as working, but is not a working shift type given`);
    }
  }
  for (const { type } of byId.values()) {
    if (type.isWorking && !working.has(type.id)) {
      throw new RangeError(`working shift type ${type.id} is missing from the working shift type ids`);
    }
  }
  return byId;
}

/**
 * One member's hours of `month` (`YYYY-MM`): each working shift of
 * {@link memberScheduleOfMonth} — the own team's and each one a roster
 * override put them on — intersected with the bands. A non-working shift and
 * a day with no rotation contribute nothing; a working shift before its
 * type's first version counts as a shift and as untimed, never in minutes.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999, on
 *   any precondition of {@link deriveHourBands} or {@link memberScheduleOfMonth},
 *   when two bands share an id, when a shift type is given twice, when a version belongs to another type or
 *   is malformed, or a non-working type carries one, when the working types
 *   given are not exactly `workingShiftTypeIds`, and when the schedule names a
 *   shift type that is not given.
 */
export function memberHoursOfMonth(input: MemberHoursInput, month: string): MemberHours {
  const dates = datesOfMonth(month);
  const windows = deriveHourBands(input.bands);
  const bandIds = new Set<string>();
  for (const window of windows) {
    if (bandIds.has(window.bandId)) throw new RangeError(`hour band ${window.bandId} is given twice`);
    bandIds.add(window.bandId);
  }
  const partition = partitionOfDay(input.bands);
  // Non-null: every month has a first date.
  const typesById = shiftTypesById(input, dates[0]!);

  const bandMinutes = new Map<string, number>();
  const bandShifts = new Map<string, number>();
  for (const window of windows) {
    bandMinutes.set(window.bandId, 0);
    bandShifts.set(window.bandId, 0);
  }
  let shiftCount = 0;
  let untimedShiftCount = 0;
  let unbandedMinutes = 0;
  let totalMinutes = 0;
  let leaveMinutes = 0;
  const leaveShifts = new Set((input.leaveShifts ?? []).map((shift) => JSON.stringify([shift.date, shift.teamId])));

  for (const day of memberScheduleOfMonth(input, month)) {
    for (const shift of day.shifts) {
      if (shift.shiftTypeId === null) continue;
      const entry = typesById.get(shift.shiftTypeId);
      if (entry === undefined) {
        throw new RangeError(`the schedule names shift type ${shift.shiftTypeId} on ${day.date}, which is not given`);
      }
      if (!entry.type.isWorking) continue;

      const version = shiftTypeVersionOn(entry.versions, day.date);
      if (leaveShifts.has(JSON.stringify([day.date, shift.teamId]))) {
        // A leave shift is not worked: only its duration, as leave.
        if (version !== null) leaveMinutes += deriveShiftTimes(version.startMinute, version.endMinute).durationMinutes;
        continue;
      }

      shiftCount += 1;
      if (version === null) {
        untimedShiftCount += 1;
        continue;
      }
      const times = deriveShiftTimes(version.startMinute, version.endMinute);
      totalMinutes += times.durationMinutes;
      for (const [bandId, minutes] of minutesByBand(partition, times.startMinute, times.durationMinutes)) {
        if (bandId === null) {
          unbandedMinutes += minutes;
        } else {
          bandMinutes.set(bandId, (bandMinutes.get(bandId) ?? 0) + minutes);
          bandShifts.set(bandId, (bandShifts.get(bandId) ?? 0) + 1);
        }
      }
    }
  }

  return {
    shiftCount,
    bands: windows.map((window) => ({
      bandId: window.bandId,
      minutes: bandMinutes.get(window.bandId) ?? 0,
      shiftCount: bandShifts.get(window.bandId) ?? 0,
    })),
    unbandedMinutes,
    totalMinutes,
    leaveMinutes,
    untimedShiftCount,
  };
}
