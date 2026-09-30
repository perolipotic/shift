/**
 * A month of the schedule (story 3.1; AD-7, AD-13).
 *
 * The schedule is the projection plus the shift-type override layer (story
 * 3.5a): for every date of a month and every team asked for, the shift type
 * that team's rotation projects on that date, through
 * {@link projectedShiftTypeOn}, replaced by the team's override on that date
 * when there is one ({@link scheduledShiftTypeOn}). Each cell carries the
 * projected type beside the scheduled one, so with no overrides the month IS
 * the pure projection, day by day.
 *
 * ROSTER OVERRIDES (story 3.6a) change who works a shift, never its type. A
 * cell says whether one applies on it (`rosterChanged`), by `rosterOn`'s rule,
 * and a member's month follows them: a working shift of their own team they
 * were taken off is dropped, and a shift they were put on appears. With none,
 * every cell and every member's month is the pure projection's.
 *
 * A month is a `YYYY-MM` string in years 0001–9999, as a date is a
 * `YYYY-MM-DD` one: civil, never an instant. The functions return ids, never
 * prose, and nothing here reads a name, a fire rank or a team position.
 *
 * Every breached precondition throws a `RangeError` naming the offending value.
 */

import { checkDate, civilDayNumber, dateOfCivilDay } from './calendar.js';
import { applyOverride, overridesByTeamAndDate, type ScheduledShiftType, type ShiftTypeOverride } from './overrides.js';
import { projectedShiftTypeOn, type RotationAssignment, type RotationStep } from './projection.js';
import {
  orderedVersions,
  rosterOverrideApplies,
  rosterOverridesAt,
  rosterOverridesByTeamAndDate,
  shiftRoster,
  versionOn,
  type MembershipVersion,
  type RosterMember,
  type RosterOverride,
  type StatusVersion,
} from './roster.js';

const MONTH_SHAPE = /^(\d{4})-(\d{2})$/;

/** What a month of the schedule is derived from: the configuration alone. */
export interface ScheduleInput {
  /** The teams to show, in column order. Each at most once. */
  readonly teamIds: readonly string[];
  /** Every rotation version, of any team; versions of teams not asked for are ignored. */
  readonly assignments: readonly RotationAssignment[];
  /** The steps of every pattern a version names. */
  readonly steps: readonly RotationStep[];
  /** Every live shift-type override, of any team and date; at most one per team and date. */
  readonly overrides: readonly ShiftTypeOverride[];
  /** Every member, whose default rosters decide whether a roster override applies (story 3.6a). */
  readonly members: readonly RosterMember[];
  /** Every live roster override IN FORCE, of any team and date (story 3.6a). */
  readonly rosterOverrides: readonly RosterOverride[];
  /** The ids of the working shift types: a roster override applies only on a working shift. */
  readonly workingShiftTypeIds: readonly string[];
}

/**
 * One team on one date: the shift type it works and the one its rotation
 * projects — both `null` when no rotation version is in effect yet — whether
 * an override replaced the projected type, and whether a roster override
 * applies on it (story 3.6a).
 */
export interface ScheduleCell {
  readonly teamId: string;
  readonly shiftTypeId: string | null;
  readonly projectedShiftTypeId: string | null;
  readonly overridden: boolean;
  readonly rosterChanged: boolean;
}

/** One date of a month, with a cell per team in the order asked for. */
export interface ScheduleRow {
  readonly date: string;
  readonly cells: readonly ScheduleCell[];
}

/**
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999.
 */
function checkMonth(month: string): { readonly year: number; readonly month: number } {
  const match = MONTH_SHAPE.exec(month);
  const year = Number(match?.[1]);
  const number = Number(match?.[2]);
  if (match === null || year < 1 || number < 1 || number > 12) {
    throw new RangeError(`the month is ${JSON.stringify(month)}, not a calendar month as YYYY-MM`);
  }
  return { year, month: number };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Every date of `month`, in order, as `YYYY-MM-DD`.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999.
 */
export function datesOfMonth(month: string): readonly string[] {
  checkMonth(month);
  const first = civilDayNumber(`${month}-01`);
  const dates: string[] = [];
  for (let offset = 0; offset < 31; offset += 1) {
    const date = dateOfCivilDay(first + offset);
    if (date === null || date.slice(0, 7) !== month) break;
    dates.push(date);
  }
  return dates;
}

/**
 * The month `date` falls in, as `YYYY-MM`.
 *
 * @throws RangeError when `date` is not a calendar `YYYY-MM-DD`.
 */
export function monthOf(date: string): string {
  checkDate('the date', date);
  return date.slice(0, 7);
}

/**
 * The month before (`-1`) or after (`1`) `month`, or `null` where the calendar
 * ends: there is no month before 0001-01 and none after 9999-12.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999, or
 *   when `step` is neither `1` nor `-1`.
 */
export function adjacentMonth(month: string, step: 1 | -1): string | null {
  const parsed = checkMonth(month);
  if (step !== 1 && step !== -1) {
    throw new RangeError(`the step between months is ${String(step)}, not 1 or -1`);
  }
  const index = parsed.year * 12 + (parsed.month - 1) + step;
  const year = Math.floor(index / 12);
  if (year < 1 || year > 9999) return null;
  return `${pad(year, 4)}-${pad(index - year * 12 + 1, 2)}`;
}

/**
 * The schedule of `month`: a row per date, in order, each with a cell per team
 * of `input.teamIds`, in that order. Each cell is {@link scheduledShiftTypeOn}
 * for that team's versions and overrides on that date — `null` before its
 * first version, whatever override that date has.
 *
 * `rosterChanged` is true exactly where a roster override applies: the cell's
 * type is a working one, and the override passes `rosterOn`'s rule against
 * the team's default roster on that date.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999, when
 *   a team is asked for twice, when an override's date is not a calendar date
 *   or two overrides name one team and date, on any precondition of
 *   {@link projectedShiftTypeOn} for a team asked for, and on any of
 *   `checkRosterOverrides` or `shiftRoster`.
 */
export function scheduleOfMonth(input: ScheduleInput, month: string): readonly ScheduleRow[] {
  const dates = datesOfMonth(month);

  const versionsOf = new Map<string, RotationAssignment[]>();
  for (const teamId of input.teamIds) {
    if (versionsOf.has(teamId)) {
      throw new RangeError(`team ${teamId} is asked for twice; each team is one column`);
    }
    versionsOf.set(teamId, []);
  }
  for (const assignment of input.assignments) {
    versionsOf.get(assignment.teamId)?.push(assignment);
  }
  const overrides = overridesByTeamAndDate(input.overrides);
  const rosterOverrides = rosterOverridesByTeamAndDate(input.rosterOverrides);
  const working = new Set(input.workingShiftTypeIds);

  return dates.map((date) => ({
    date,
    cells: input.teamIds.map((teamId) => {
      const scheduled = applyOverride(overrides, teamId, date, projectedShiftTypeOn(versionsOf.get(teamId) ?? [], input.steps, date));
      const changed = appliedRosterOverrides(rosterOverrides, input.members, working, scheduled, teamId, date).length > 0;
      return { ...cellOf(teamId, scheduled), rosterChanged: changed };
    }),
  }));
}

/**
 * The roster overrides of `teamId` on `date` that APPLY: none unless the
 * scheduled type is a working one, and of the rest those passing the rule of
 * `rosterOn` against the default roster — computed only when there is one to
 * judge.
 */
function appliedRosterOverrides(
  indexed: ReadonlyMap<string, readonly RosterOverride[]>,
  members: readonly RosterMember[],
  working: ReadonlySet<string>,
  scheduled: ScheduledShiftType | null,
  teamId: string,
  date: string,
): readonly RosterOverride[] {
  const candidates = rosterOverridesAt(indexed, teamId, date);
  if (candidates.length === 0 || scheduled === null || !working.has(scheduled.shiftTypeId)) return [];
  const base = shiftRoster(members, teamId, date);
  return candidates.filter((override) => rosterOverrideApplies(base, members, override));
}

/** What one member's month is derived from: their membership and status histories and the configuration. */
export interface MemberScheduleInput {
  /** The member's id, which a roster override names (story 3.6a). */
  readonly memberId: string;
  /** Every membership version of ONE member, in any order. */
  readonly memberships: readonly MembershipVersion[];
  /** Every status version of the same member, in any order; none means always active. */
  readonly statuses: readonly StatusVersion[];
  /** Every rotation version, of any team; only the teams the member belongs to are read. */
  readonly assignments: readonly RotationAssignment[];
  /** The steps of every pattern a version names. */
  readonly steps: readonly RotationStep[];
  /** Every live shift-type override, of any team and date; at most one per team and date. */
  readonly overrides: readonly ShiftTypeOverride[];
  /**
   * Every member, this one included, whose default rosters decide whether a
   * roster override applies (story 3.6a): a replacement applies to the member
   * put on only if the member taken off is on the default roster.
   */
  readonly members: readonly RosterMember[];
  /** Every live roster override IN FORCE, of any team and date (story 3.6a). */
  readonly rosterOverrides: readonly RosterOverride[];
  /** The ids of the working shift types: a roster override applies only on a working shift. */
  readonly workingShiftTypeIds: readonly string[];
}

/**
 * One shift of a member's day (story 3.6a): the team, the shift type it works
 * and the one its rotation projects (both `null` when no rotation version is
 * in effect yet), whether a shift-type override replaced it, whether a roster
 * override applies on it, and whether the member holds it only through a
 * roster override (`viaOverride`) rather than as a member of the team.
 */
export interface MemberShift {
  readonly teamId: string;
  readonly shiftTypeId: string | null;
  readonly projectedShiftTypeId: string | null;
  readonly overridden: boolean;
  readonly rosterChanged: boolean;
  readonly viaOverride: boolean;
}

/**
 * One date of a member's month: their shifts on it. Their own team's comes
 * first — absent when they are on no team or inactive that day, or when a
 * roster override took them off its working shift — then each shift a roster
 * override put them on, in the overrides' order.
 */
export interface MemberScheduleDay {
  readonly date: string;
  readonly shifts: readonly MemberShift[];
}

/**
 * One member's schedule of `month`: a row per date, in order. The team on a
 * date is the membership version with the greatest `effectiveFrom` on or
 * before it (none before the first version) — the rule of `membershipOn` —
 * and no team at all on a date the member is inactive (`activeOn`); the shift
 * type is {@link scheduledShiftTypeOn} for that team's rotation versions and
 * overrides. The roster overrides that APPLY (the rule of `rosterOn`) then
 * drop the own team's working shift the member was taken off, and add each
 * working shift of another team they were put on.
 *
 * @throws RangeError when `month` is not a `YYYY-MM` in years 0001–9999, when
 *   a membership or status version's `effectiveFrom` is not a calendar
 *   `YYYY-MM-DD`, when two membership versions or two status versions share
 *   an `effectiveFrom`, when an override's date is not a calendar date or two
 *   overrides name one team and date, on any precondition of
 *   {@link projectedShiftTypeOn} for a team the member is in or is put on, and
 *   on any of `checkRosterOverrides` or `shiftRoster`.
 */
export function memberScheduleOfMonth(input: MemberScheduleInput, month: string): readonly MemberScheduleDay[] {
  const dates = datesOfMonth(month);

  const memberships = orderedVersions('team membership', input.memberships);
  const statuses = orderedVersions('member status', input.statuses);

  const versionsOf = new Map<string, RotationAssignment[]>();
  for (const assignment of input.assignments) {
    const versions = versionsOf.get(assignment.teamId);
    if (versions === undefined) versionsOf.set(assignment.teamId, [assignment]);
    else versions.push(assignment);
  }
  const overrides = overridesByTeamAndDate(input.overrides);
  const rosterOverrides = rosterOverridesByTeamAndDate(input.rosterOverrides);
  const working = new Set(input.workingShiftTypeIds);
  const scheduledOf = (teamId: string, date: string): ScheduledShiftType | null =>
    applyOverride(overrides, teamId, date, projectedShiftTypeOn(versionsOf.get(teamId) ?? [], input.steps, date));

  // The roster overrides putting this member on a shift, by date.
  const putOn = new Map<string, RosterOverride[]>();
  for (const override of input.rosterOverrides) {
    if (override.memberInId !== input.memberId) continue;
    const known = putOn.get(override.date);
    if (known === undefined) putOn.set(override.date, [override]);
    else known.push(override);
  }

  return dates.map((date) => {
    const shifts: MemberShift[] = [];
    const active = versionOn(statuses, date)?.active ?? true;
    const teamId = active ? (versionOn(memberships, date)?.teamId ?? null) : null;

    if (teamId !== null) {
      const scheduled = scheduledOf(teamId, date);
      const applied = appliedRosterOverrides(rosterOverrides, input.members, working, scheduled, teamId, date);
      if (!applied.some((override) => override.memberOutId === input.memberId)) {
        shifts.push({ ...cellOf(teamId, scheduled), rosterChanged: applied.length > 0, viaOverride: false });
      }
    }

    for (const override of putOn.get(date) ?? []) {
      const scheduled = scheduledOf(override.teamId, date);
      const applied = appliedRosterOverrides(rosterOverrides, input.members, working, scheduled, override.teamId, date);
      if (applied.includes(override)) {
        shifts.push({ ...cellOf(override.teamId, scheduled), rosterChanged: true, viaOverride: true });
      }
    }

    return { date, shifts };
  });
}

/** A cell's type fields from a scheduled type, or the empty cell when there is none. */
function cellOf<Team extends string | null>(
  teamId: Team,
  scheduled: ScheduledShiftType | null,
): { readonly teamId: Team; readonly shiftTypeId: string | null; readonly projectedShiftTypeId: string | null; readonly overridden: boolean } {
  return scheduled === null
    ? { teamId, shiftTypeId: null, projectedShiftTypeId: null, overridden: false }
    : { teamId, ...scheduled };
}
