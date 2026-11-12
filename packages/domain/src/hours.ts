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
 * HALF DAYS (story 13.5, R4.12, PO 2026-11-12). On a date the caller names in
 * `halfDays` whose schedule holds exactly ONE working shift, that shift is
 * split at its nominal midpoint, start + ⌊duration/2⌋ ({@link shiftHalvesOf}):
 * the worked half is intersected with the bands and counts in the total and
 * `shiftCount`, the absent half counts in `leaveMinutes` — whether or not the
 * shift is also an accepted-uncovered leave shift. An untimed one is untimed,
 * as ever. A date holding no working shift, or more than one, is read as if
 * no half day were named. The invariant holds: the worked half's band minutes
 * sum to the minutes it adds to the total.
 *
 * The result is numbers and ids only; nothing here reads a name.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { MINUTES_PER_DAY, deriveHourBands, partitionOfDay, type DayPartition, type HourBand } from './bands.js';
import { deriveShiftTimes, shiftDurationOn, shiftTypeVersionOn, type ShiftType, type ShiftTypeVersion } from './duration.js';
import { LEAVE_HALF_FIRST, LEAVE_HALF_SECOND, type LeaveHalf } from './leave.js';
import { datesOfMonth, memberScheduleOfMonth, type MemberScheduleInput, type MemberShift } from './schedule.js';

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
  /**
   * The member's half-day records (story 13.5): each date and the half they
   * were absent, in any order, at most one per date. Absent or empty, no
   * shift is split.
   */
  readonly halfDays?: readonly HalfDay[];
}

/** One half-day record of a member, by its date and half (story 13.5). */
export interface HalfDay {
  readonly date: string;
  readonly half: LeaveHalf;
}

/** One half of a shift: the interval `[startMinute, startMinute + durationMinutes)`, which may run past midnight. */
export interface ShiftHalf {
  readonly startMinute: number;
  readonly durationMinutes: number;
}

/** A shift split at its nominal midpoint (story 13.5): the first half, then the second. */
export interface ShiftHalves {
  readonly first: ShiftHalf;
  readonly second: ShiftHalf;
  /** The midpoint, minutes after the start of the shift's date (may be 1440 or more past midnight). */
  readonly midpointMinute: number;
}

/**
 * A shift's two halves (story 13.5, R4.12, PO 2026-11-12): split at start +
 * ⌊duration/2⌋ on its nominal interval, so an odd minute goes to the second
 * half. 07:00–19:00 splits at 13:00; 19:00–07:00 at 01:00 the next day;
 * 07:00–07:59 gives 29 and 30 minutes.
 *
 * @throws RangeError on any precondition of {@link deriveShiftTimes}.
 */
export function shiftHalvesOf(startMinute: number, endMinute: number): ShiftHalves {
  const times = deriveShiftTimes(startMinute, endMinute);
  const firstMinutes = Math.floor(times.durationMinutes / 2);
  const midpointMinute = times.startMinute + firstMinutes;
  return {
    first: { startMinute: times.startMinute, durationMinutes: firstMinutes },
    second: { startMinute: midpointMinute, durationMinutes: times.durationMinutes - firstMinutes },
    midpointMinute,
  };
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

/** How a shift came to be on the member's schedule (story 7.14). */
export const HOURS_SOURCE_ROTATION = 'ROTATION';
export const HOURS_SOURCE_CHANGE = 'CHANGE';
export const HOURS_SOURCE_REPLACEMENT = 'REPLACEMENT';

/**
 * The rotation's projection (`ROTATION`), a shift-type override that replaced
 * it (`CHANGE`), or a roster override that put the member on another team's
 * shift (`REPLACEMENT`, which wins when both apply).
 */
export type HoursSource =
  | typeof HOURS_SOURCE_ROTATION
  | typeof HOURS_SOURCE_CHANGE
  | typeof HOURS_SOURCE_REPLACEMENT;

/** What a shift is in the month's hours: worked, leave, or worked with no times. */
const HOURS_KIND_WORKED = 'WORKED';
const HOURS_KIND_LEAVE = 'LEAVE';
const HOURS_KIND_UNTIMED = 'UNTIMED';

type HoursKind = typeof HOURS_KIND_WORKED | typeof HOURS_KIND_LEAVE | typeof HOURS_KIND_UNTIMED;

/** The part of one shift that falls in one band; `bandId` is `null` for the uncovered day (no bands). */
interface HoursShare {
  readonly bandId: string | null;
  readonly minutes: number;
}

/**
 * One working shift of the month, the unit every figure is a sum of: the
 * month's walk produces exactly these (story 7.14), so a figure and its
 * explanation cannot differ. `minutes` is the shift's duration, 0 for an
 * untimed shift; `shares` split a worked shift over the bands and sum to
 * `minutes`, and are empty for leave and untimed ones.
 */
interface HoursTerm {
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly source: HoursSource;
  readonly kind: HoursKind;
  readonly minutes: number;
  readonly shares: readonly HoursShare[];
}

/** Which figure of the month an explanation is of. */
export const HOURS_FIGURE_TOTAL = 'TOTAL';
export const HOURS_FIGURE_BAND = 'BAND';
export const HOURS_FIGURE_LEAVE = 'LEAVE';

export type HoursFigureCode =
  | { readonly code: typeof HOURS_FIGURE_TOTAL }
  | { readonly code: typeof HOURS_FIGURE_BAND; readonly bandId: string }
  | { readonly code: typeof HOURS_FIGURE_LEAVE };

/** One operand of an equation: a shift and the minutes it adds to the figure. */
export interface HoursOperand {
  readonly date: string;
  readonly teamId: string;
  readonly shiftTypeId: string;
  readonly source: HoursSource;
  readonly minutes: number;
}

/**
 * A figure as codes and operands (AD-8): `minutes` is the figure and equals
 * the sum of the operands' minutes exactly (DI-7). The operands are in date
 * order, a shift per operand; a figure of 0 has none.
 */
export interface HoursExplanation {
  readonly figure: HoursFigureCode;
  readonly minutes: number;
  readonly operands: readonly HoursOperand[];
}

interface MonthWalk {
  readonly bandIds: readonly string[];
  readonly terms: readonly HoursTerm[];
}

function sourceOf(shift: MemberShift): HoursSource {
  if (shift.viaOverride) return HOURS_SOURCE_REPLACEMENT;
  return shift.overridden ? HOURS_SOURCE_CHANGE : HOURS_SOURCE_ROTATION;
}

/**
 * The month's one walk: every working shift as a term, the band ids in
 * {@link deriveHourBands} order. Every precondition is checked here.
 */
function walkMonth(input: MemberHoursInput, month: string): MonthWalk {
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
  const leaveShifts = new Set((input.leaveShifts ?? []).map((shift) => JSON.stringify([shift.date, shift.teamId])));
  const halfDays = new Map<string, LeaveHalf>();
  for (const halfDay of input.halfDays ?? []) {
    if (halfDay.half !== LEAVE_HALF_FIRST && halfDay.half !== LEAVE_HALF_SECOND) {
      throw new RangeError(`the half day on ${halfDay.date} is half ${JSON.stringify(halfDay.half)}, neither FIRST nor SECOND`);
    }
    if (halfDays.has(halfDay.date)) throw new RangeError(`two half days are given on ${halfDay.date}`);
    halfDays.set(halfDay.date, halfDay.half);
  }
  const terms: HoursTerm[] = [];
  const sharesOf = (startMinute: number, durationMinutes: number): readonly HoursShare[] =>
    [...minutesByBand(partition, startMinute, durationMinutes)].map(([bandId, minutes]) => ({ bandId, minutes }));

  for (const day of memberScheduleOfMonth(input, month)) {
    const half = halfDays.get(day.date);
    // A half day splits the date's shift only when it holds exactly one working one.
    const workingShifts =
      half === undefined
        ? 0
        : day.shifts.filter((shift) => shift.shiftTypeId !== null && typesById.get(shift.shiftTypeId)?.type.isWorking === true)
            .length;
    for (const shift of day.shifts) {
      if (shift.shiftTypeId === null) continue;
      const entry = typesById.get(shift.shiftTypeId);
      if (entry === undefined) {
        throw new RangeError(`the schedule names shift type ${shift.shiftTypeId} on ${day.date}, which is not given`);
      }
      if (!entry.type.isWorking) continue;

      const version = shiftTypeVersionOn(entry.versions, day.date);
      const base = { date: day.date, teamId: shift.teamId, shiftTypeId: shift.shiftTypeId, source: sourceOf(shift) };
      if (half !== undefined && workingShifts === 1 && version !== null) {
        // A half day: the absent half is leave, the worked half is worked, by intersection.
        const halves = shiftHalvesOf(version.startMinute, version.endMinute);
        const absent = half === LEAVE_HALF_FIRST ? halves.first : halves.second;
        const worked = half === LEAVE_HALF_FIRST ? halves.second : halves.first;
        if (absent.durationMinutes > 0) terms.push({ ...base, kind: HOURS_KIND_LEAVE, minutes: absent.durationMinutes, shares: [] });
        terms.push({
          ...base,
          kind: HOURS_KIND_WORKED,
          minutes: worked.durationMinutes,
          shares: sharesOf(worked.startMinute, worked.durationMinutes),
        });
        continue;
      }
      if (half !== undefined && workingShifts === 1) {
        // An untimed shift on a half day is untimed, as ever: no leave minutes.
        terms.push({ ...base, kind: HOURS_KIND_UNTIMED, minutes: 0, shares: [] });
        continue;
      }
      if (leaveShifts.has(JSON.stringify([day.date, shift.teamId]))) {
        // A leave shift is not worked: only its duration, as leave.
        if (version !== null) {
          const { durationMinutes } = deriveShiftTimes(version.startMinute, version.endMinute);
          terms.push({ ...base, kind: HOURS_KIND_LEAVE, minutes: durationMinutes, shares: [] });
        }
        continue;
      }

      if (version === null) {
        terms.push({ ...base, kind: HOURS_KIND_UNTIMED, minutes: 0, shares: [] });
        continue;
      }
      const times = deriveShiftTimes(version.startMinute, version.endMinute);
      terms.push({
        ...base,
        kind: HOURS_KIND_WORKED,
        minutes: times.durationMinutes,
        shares: sharesOf(times.startMinute, times.durationMinutes),
      });
    }
  }

  return { bandIds: windows.map((window) => window.bandId), terms };
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
  const { bandIds, terms } = walkMonth(input, month);
  const bandMinutes = new Map<string, number>(bandIds.map((id) => [id, 0]));
  const bandShifts = new Map<string, number>(bandIds.map((id) => [id, 0]));
  let shiftCount = 0;
  let untimedShiftCount = 0;
  let unbandedMinutes = 0;
  let totalMinutes = 0;
  let leaveMinutes = 0;

  for (const term of terms) {
    if (term.kind === HOURS_KIND_LEAVE) {
      leaveMinutes += term.minutes;
      continue;
    }
    shiftCount += 1;
    if (term.kind === HOURS_KIND_UNTIMED) {
      untimedShiftCount += 1;
      continue;
    }
    totalMinutes += term.minutes;
    for (const share of term.shares) {
      if (share.bandId === null) {
        unbandedMinutes += share.minutes;
      } else {
        bandMinutes.set(share.bandId, (bandMinutes.get(share.bandId) ?? 0) + share.minutes);
        bandShifts.set(share.bandId, (bandShifts.get(share.bandId) ?? 0) + 1);
      }
    }
  }

  return {
    shiftCount,
    bands: bandIds.map((bandId) => ({
      bandId,
      minutes: bandMinutes.get(bandId) ?? 0,
      shiftCount: bandShifts.get(bandId) ?? 0,
    })),
    unbandedMinutes,
    totalMinutes,
    leaveMinutes,
    untimedShiftCount,
  };
}

/**
 * One figure of `month` as an equation (story 7.14; FR-42b): the shifts that
 * compose it, each with the minutes it adds. The total is every worked
 * shift's duration, a band's the part of each worked shift inside it (a
 * shift across a band edge appears in each band it touches), the leave the
 * duration of each leave shift. The operands sum exactly to
 * `memberHoursOfMonth`'s figure — both come from one walk.
 *
 * @throws RangeError on any precondition of {@link memberHoursOfMonth}, and
 *   when a band figure names a band that is not given.
 */
export function explainMemberHours(input: MemberHoursInput, month: string, figure: HoursFigureCode): HoursExplanation {
  const { bandIds, terms } = walkMonth(input, month);
  if (figure.code === HOURS_FIGURE_BAND && !bandIds.includes(figure.bandId)) {
    throw new RangeError(`hour band ${figure.bandId} is not given`);
  }

  const operands: HoursOperand[] = [];
  for (const term of terms) {
    let minutes = 0;
    if (figure.code === HOURS_FIGURE_LEAVE) {
      if (term.kind === HOURS_KIND_LEAVE) minutes = term.minutes;
    } else if (term.kind === HOURS_KIND_WORKED) {
      minutes =
        figure.code === HOURS_FIGURE_TOTAL
          ? term.minutes
          : (term.shares.find((share) => share.bandId === figure.bandId)?.minutes ?? 0);
    }
    if (minutes > 0) {
      operands.push({ date: term.date, teamId: term.teamId, shiftTypeId: term.shiftTypeId, source: term.source, minutes });
    }
  }

  return { figure, minutes: operands.reduce((sum, operand) => sum + operand.minutes, 0), operands };
}
