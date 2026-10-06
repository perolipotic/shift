import {
  activeOn,
  collisionKeyOf,
  deriveShiftTimes,
  membershipOn,
  rosterOn,
  shiftTypeVersionOn,
  type MembershipVersion,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarMarksOf } from '@/features/calendar/services/marks';
import { MODIFIER_CONFLICT } from '@/features/calendar/utils/modifiers';
import {
  CALENDAR_CELL_CLASS,
  NO_ROTATION_CELL_CLASS,
  calendarMonthOutcomeOf,
  calendarTodayOf,
  dayMonthOf,
  rosterStandingOfCalendar,
  weekdayOf,
  workingShiftTypeIdsOf,
  type CalendarMarks,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import {
  CONFLICTS_LOADING,
  CONFLICTS_READY,
  conflictsQueueOf,
  resolutionsOf,
  type ConflictRow,
  type ConflictsQueueSources,
} from '@/features/conflicts/services/conflicts-queue';
import { ACCEPT_UNCOVERED, REPLACE_MEMBER } from '@/features/conflicts/services/resolutions';
import { organizationLeaveRecordsOf, type OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import type { MemberRole } from '@/features/navigation/utils/destinations';
import {
  CASE_DUTY,
  CASE_FREE,
  CASE_LEAVE,
  CASE_WORKING,
  TODAY_READY,
  TODAY_UNSCHEDULED,
  absenceOn,
  type Today,
} from '@/features/today/services/today';
import { formatIsoWeekdayShortName, formatMinuteOfDay, nextIsoDate, organizationWallClock } from '@/lib/i18n/format';

/**
 * *Danas* for an admin (story 6.3): what needs them (*Treba tebe*), today's
 * coverage per working team, who is absent today and from tomorrow, and the
 * week across every active team — as a pure view model in a `.ts` that
 * renders nothing (AD-15). The hook only wires it; the node suite executes it.
 *
 * THE QUEUE'S OWN READS AND GATING. The calendar snapshot under
 * `CALENDAR_KEY`, the organization's live leave under
 * `ORGANIZATION_LEAVE_RECORDS_KEY` and its live resolutions under
 * `ORGANIZATION_CONFLICT_RESOLUTIONS_KEY` — the three *Raspored* reads, through
 * the same query options — and `conflictsQueueOf` decides loading,
 * unavailable and ready. The count IS the queue's `view.count`, and every
 * row of *Treba tebe* is one of the queue's rows, so the card equals
 * *Raspored* at every count, 0 included.
 *
 * THE CALENDAR'S OWN DERIVATIONS for the rest. The week and today's coverage
 * are `calendarMonthOutcomeOf`'s cells under the admin's marks
 * (`calendarMarksOf`, which derives every collision through the queue's
 * `unresolvedOf`), so a ⚠ in the week is exactly a queue row. Who works a
 * shift is the domain's `rosterOn`, with the roster overrides in force.
 *
 * NEVER A PARTIAL SCREEN. A read that failed or is paused is the queue's
 * unavailable; a row that cannot be trusted or any `RangeError` of the
 * derivation is unavailable too, logged. Nothing is stored, and everything is
 * derived again at every minute the hook passes in. Codes, data and formatted
 * dates only; the components translate.
 */

/** The role whose *Danas* is this one. */
const ADMIN_ROLE: MemberRole = 'admin';

/**
 * Whether *Danas* shows the admin's body: for an admin, by the snapshot's
 * role, or the chrome's cached one before it lands. `null` — no role known
 * yet — is the member's skeleton, as *Kalendar*'s grid is its default.
 */
export function showsAdminToday(role: MemberRole | null): boolean {
  return role === ADMIN_ROLE;
}

/** Still waiting on a read: the skeleton, never a figure. */
export const ADMIN_TODAY_LOADING = 'loading';
/** A read failed, or what it answered cannot be trusted: one alert with a retry, no figure. */
export const ADMIN_TODAY_UNAVAILABLE = 'unavailable';
/** Everything read: the four blocks. */
export const ADMIN_TODAY_READY = 'ready';

/** How many of the queue's rows *Treba tebe* lists. */
export const NEEDS_YOU_ROWS = 3;

/** How many days the week shows: today and the six after it. */
export const ADMIN_WEEK_DAYS = 7;

/** A row's date is before today. */
export const BADGE_PAST = 'past';
/** A row's date is today. */
export const BADGE_TODAY = 'today';

export type NeedsYouBadge = typeof BADGE_PAST | typeof BADGE_TODAY;

/** One of the queue's rows, as *Treba tebe* lists it. */
export interface NeedsYouRow {
  readonly key: string;
  /** With `date` and `teamId`, what opens the row's resolution screen. */
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
  /** `srijeda` */
  readonly weekday: string;
  /** `30.09.` */
  readonly dayMonth: string;
  readonly shiftTypeName: string;
  readonly times: string | null;
  readonly teamName: string;
  readonly memberName: string;
  /** `prošlo`, `danas`, or none for a later date. */
  readonly badge: NeedsYouBadge | null;
}

/** *Treba tebe*: the queue's count, its past share and its earliest rows. */
export interface NeedsYou {
  /** The queue's `view.count`, every unresolved conflict, past ones included. */
  readonly count: number;
  /** How many of them are dated before today: a subset of `count`, never an addition. */
  readonly pastCount: number;
  /** The earliest past row's `30.09.`, or `null` when none is past. */
  readonly earliestPast: string | null;
  /** At most {@link NEEDS_YOU_ROWS}, the earliest date first, past ones included. */
  readonly rows: readonly NeedsYouRow[];
}

/** The shift has not started yet: `počinje u 19:00`. */
export const PHASE_STARTS = 'starts';
/** The shift is under way: `u tijeku, do 19:00`. */
export const PHASE_RUNNING = 'running';
/** The shift is over: `završeno u 19:00`. */
export const PHASE_ENDED = 'ended';

export type CoveragePhaseKind = typeof PHASE_STARTS | typeof PHASE_RUNNING | typeof PHASE_ENDED;

/** Where a shift is at the minute read, with the time the sentence names. */
export interface CoveragePhase {
  readonly kind: CoveragePhaseKind;
  /** `19:00`: the start for {@link PHASE_STARTS}, the end otherwise. */
  readonly time: string;
}

/** The absent member's conflict is on the queue. */
export const ABSENT_UNRESOLVED = 'unresolved';
/** The absent member's conflict was accepted as uncovered. */
export const ABSENT_ACCEPTED = 'accepted';
/** The absent member's conflict was resolved another way. */
export const ABSENT_RESOLVED = 'resolved';

export type CoverageAbsentState = typeof ABSENT_UNRESOLVED | typeof ABSENT_ACCEPTED | typeof ABSENT_RESOLVED;

/** A rostered member whose leave covers today, and what was decided about it. */
export interface CoverageAbsent {
  readonly memberId: string;
  readonly name: string;
  readonly state: CoverageAbsentState;
}

/** Every rostered member is present. */
export const STAFFING_FULL = 'full';
/** Nobody is rostered on the shift at all: never read as full. */
export const STAFFING_NOBODY = 'nobody';
/** Someone rostered is absent on leave: each one is named. */
export const STAFFING_SHORT = 'short';

export type CoverageStaffing = typeof STAFFING_FULL | typeof STAFFING_NOBODY | typeof STAFFING_SHORT;

/** One working team today. */
export interface CoverageRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly shiftTypeName: string;
  /** `19:00–07:00`, or `null` for a working type with no times in effect today. */
  readonly range: string | null;
  /** `null` with the range: no times, no phase. */
  readonly phase: CoveragePhase | null;
  /** Rostered and not on leave: `3` of `3 od 4 člana`. */
  readonly present: number;
  /**
   * `rosterOn`'s roster, less each absent member a replacement stands in for:
   * the replacement is on the roster in their place, so the shift is whole.
   */
  readonly total: number;
  readonly absent: readonly CoverageAbsent[];
  /** Full, nobody rostered, or short with `absent` named. */
  readonly staffing: CoverageStaffing;
}

/** *Pokrivenost danas*. */
export interface Coverage {
  /** Every active team whose type today is a working one, in team order. */
  readonly rows: readonly CoverageRow[];
  /** The active teams off today — a non-working type — by name, in team order. */
  readonly off: readonly string[];
  /**
   * The active teams with no rotation in effect today, by name, in team
   * order: neither working nor off, and still named, so every active team
   * appears somewhere.
   */
  readonly noRotation: readonly string[];
}

/** A member on leave, as *Odsutni danas* names them. */
export interface AbsentMember {
  readonly memberId: string;
  readonly name: string;
  /** Their team on the day read, or `null` for none. */
  readonly teamName: string | null;
  /** The whole absence, back-to-back records as one: `28.09.` and `04.10.`. */
  readonly from: string;
  readonly to: string;
  /** Whether the absence is one day: then it is stated as that one date, never `01.10.–01.10.`. */
  readonly oneDay: boolean;
}

/** *Odsutni danas*. */
export interface Absences {
  /** Active members whose leave covers today, in the snapshot's name order. */
  readonly today: readonly AbsentMember[];
  /** Active members whose leave starts tomorrow. */
  readonly tomorrow: readonly AbsentMember[];
}

/** One date of the week, as its column header reads it. */
export interface WeekDay {
  readonly date: string;
  /** `četvrtak` */
  readonly weekday: string;
  /** `čet`, the column head's: `formatIsoWeekdayShortName`'s, never a cut of `weekday`. */
  readonly weekdayShort: string;
  /** `01.10.` */
  readonly dayMonth: string;
  readonly isToday: boolean;
}

/** One team on one date of the week. */
export interface WeekCell {
  readonly date: string;
  /** `N`; `null` where no rotation is in effect. */
  readonly letter: string | null;
  /** `Noć`; `null` where no rotation is in effect. */
  readonly name: string | null;
  readonly range: string | null;
  /** Whether an unresolved conflict falls on it: exactly where the queue lists one. */
  readonly conflict: boolean;
  /** The calendar's own fill and shape. */
  readonly className: string;
  /** The calendar's own marks, for the ring and hatch. */
  readonly modifiers: CalendarMonth['rows'][number]['cells'][number]['modifiers'];
}

/** One active team across the week. */
export interface WeekRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly cells: readonly WeekCell[];
}

/** A letter the week shows and the type it stands for. */
export interface WeekLegendEntry {
  readonly letter: string;
  readonly name: string;
}

/** *Ovaj tjedan*. */
export interface Week {
  readonly days: readonly WeekDay[];
  readonly rows: readonly WeekRow[];
  readonly legend: readonly WeekLegendEntry[];
  /** Whether any cell carries ⚠, so the legend names it. */
  readonly anyConflict: boolean;
}

/** The ready screen. */
export interface AdminTodayView {
  readonly today: string;
  readonly needsYou: NeedsYou;
  readonly coverage: Coverage;
  readonly absences: Absences;
  readonly week: Week;
}

export type AdminToday =
  | { readonly kind: typeof ADMIN_TODAY_LOADING }
  | { readonly kind: typeof ADMIN_TODAY_UNAVAILABLE }
  | { readonly kind: typeof ADMIN_TODAY_READY; readonly view: AdminTodayView };

/**
 * What *Danas* shows an admin from the queue's three reads at `now`: the
 * queue's own gating first — unavailable when a read failed or is paused, or
 * the queue refused its rows; loading while a read is pending — and then
 * {@link adminTodayViewOf}, unavailable when it throws a `RangeError`, logged.
 * Anything else thrown is a defect, and is not caught here.
 */
export function adminTodayOf(sources: ConflictsQueueSources, now: Date): AdminToday {
  const queue = conflictsQueueOf(sources, now);

  if (queue.kind === CONFLICTS_LOADING) return { kind: ADMIN_TODAY_LOADING };
  if (queue.kind !== CONFLICTS_READY) return { kind: ADMIN_TODAY_UNAVAILABLE };

  const { snapshot } = sources.calendar;
  const rows = sources.records.data;
  const resolutionRows = sources.resolutions.data;

  // The queue answered ready, so all three are in; the guard is the type's.
  if (snapshot === null || rows === undefined || resolutionRows === undefined) return { kind: ADMIN_TODAY_LOADING };

  try {
    return {
      kind: ADMIN_TODAY_READY,
      view: adminTodayViewOf(snapshot, rows, resolutionRows, queue.view.rows, queue.view.count, now),
    };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(ADMIN_TODAY_UNAVAILABLE, cause);

    return { kind: ADMIN_TODAY_UNAVAILABLE };
  }
}

/**
 * The four blocks from the snapshot, the rows as read, the queue's rows and
 * count, at `now`.
 *
 * @throws RangeError when a row cannot be trusted, a month cannot be drawn,
 *   or on any precondition of the domain.
 */
export function adminTodayViewOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
  queueRows: readonly ConflictRow[],
  count: number,
  now: Date,
): AdminTodayView {
  const today = calendarTodayOf(snapshot, now);
  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const marks = calendarMarksOf(snapshot, rows, resolutionRows);
  const dates = datesFrom(today, ADMIN_WEEK_DAYS);
  const months = monthsOf(snapshot, dates, today, marks);
  const todayMonth = monthFor(months, today);

  return {
    today,
    needsYou: needsYouOf(queueRows, count, today),
    coverage: coverageOf(snapshot, todayMonth, records, resolutionRows, queueRows, today, now),
    absences: absencesOf(snapshot, records, today),
    week: weekOf(dates, months, today),
  };
}

/** `date` and the `count − 1` days after it. @throws RangeError at the end of the calendar. */
function datesFrom(date: string, count: number): readonly string[] {
  const dates = [date];

  while (dates.length < count) dates.push(dayAfter(dates[dates.length - 1] ?? date));

  return dates;
}

/** The day after `date`. @throws RangeError at the end of the calendar. */
function dayAfter(date: string): string {
  const next = nextIsoDate(date);

  if (next === null) throw new RangeError(`the date ${date} has no next day`);

  return next;
}

/**
 * Every month the dates fall in, each drawn once by `calendarMonthOutcomeOf`
 * under the admin's marks — two when the week crosses one.
 *
 * @throws RangeError when the calendar refuses a month.
 */
function monthsOf(
  snapshot: CalendarSnapshot,
  dates: readonly string[],
  today: string,
  marks: CalendarMarks,
): ReadonlyMap<string, CalendarMonth> {
  const months = new Map<string, CalendarMonth>();

  for (const month of new Set(dates.map((date) => date.slice(0, 7)))) {
    const outcome = calendarMonthOutcomeOf(snapshot, { mjesec: month }, today, marks);

    if (!outcome.ok) throw new RangeError(`the month ${month} could not be drawn`);

    months.set(month, outcome.month);
  }

  return months;
}

/** The month `date` falls in. @throws RangeError when it was not drawn. */
function monthFor(months: ReadonlyMap<string, CalendarMonth>, date: string): CalendarMonth {
  const month = months.get(date.slice(0, 7));

  if (month === undefined) throw new RangeError(`the month of ${date} was not drawn`);

  return month;
}

/** The row of `date` in its month. @throws RangeError when the month has none. */
function rowOn(month: CalendarMonth, date: string): CalendarMonth['rows'][number] {
  const row = month.rows.find((candidate) => candidate.date === date);

  if (row === undefined) throw new RangeError(`the date ${date} is not in its month`);

  return row;
}

/** Two rows by date alone, ascending; 0 within one date, so the queue's order stays. */
function byDate(first: ConflictRow, second: ConflictRow): number {
  return first.date < second.date ? -1 : first.date > second.date ? 1 : 0;
}

/**
 * *Treba tebe* from the queue's own rows and count: the count as the queue
 * states it, how many rows are past and the earliest of them, and the
 * earliest {@link NEEDS_YOU_ROWS} rows — the earliest date first, past ones
 * included (the mockup's order; the set and the count are the queue's).
 *
 * @throws RangeError when a date cannot be formatted.
 */
export function needsYouOf(queueRows: readonly ConflictRow[], count: number, today: string): NeedsYou {
  const ordered = [...queueRows].sort(byDate);
  const past = ordered.filter((row) => row.past);
  const earliest = past[0];

  return {
    count,
    pastCount: past.length,
    earliestPast: earliest === undefined ? null : dayMonthOf(earliest.date),
    rows: ordered.slice(0, NEEDS_YOU_ROWS).map((row) => ({
      key: row.key,
      memberId: row.memberId,
      date: row.date,
      teamId: row.teamId,
      weekday: weekdayOf(row.date),
      dayMonth: dayMonthOf(row.date),
      shiftTypeName: row.shiftTypeName,
      times: row.times,
      teamName: row.teamName,
      memberName: row.memberName,
      badge: row.past ? BADGE_PAST : row.date === today ? BADGE_TODAY : null,
    })),
  };
}

/**
 * Where a shift of `startMinute`–`endMinute` dated today is at `minute` of
 * today: not started, under way until its end (a span past midnight runs to
 * the end of the day and beyond), or over.
 *
 * @throws RangeError when a minute is not a whole minute of the day.
 */
export function coveragePhaseOf(startMinute: number, endMinute: number, minute: number): CoveragePhase {
  const times = deriveShiftTimes(startMinute, endMinute);

  if (minute < times.startMinute) return { kind: PHASE_STARTS, time: formatMinuteOfDay(times.startMinute) };
  if (minute < times.startMinute + times.durationMinutes) {
    return { kind: PHASE_RUNNING, time: formatMinuteOfDay(times.endMinute) };
  }

  return { kind: PHASE_ENDED, time: formatMinuteOfDay(times.endMinute) };
}

/** Whether `memberId`'s live leave covers `date`. */
function onLeave(records: readonly OrganizationLeaveRecord[], memberId: string, date: string): boolean {
  return records.some((record) => record.memberId === memberId && record.from <= date && date <= record.to);
}

/**
 * *Pokrivenost danas*: one row per active team whose type today is a working
 * one, in team order — its type and range, its phase at the organization's
 * minute, who of its roster (`rosterOn`, the overrides in force) is present,
 * and each one absent on leave with what was decided: on the queue, accepted
 * as uncovered, or resolved. An absent member a replacement stands in for is
 * not counted: the replacement is on the roster. The active teams on a
 * non-working type are named as off.
 *
 * @throws RangeError when a resolution row cannot be trusted, or on any
 *   precondition of the domain.
 */
function coverageOf(
  snapshot: CalendarSnapshot,
  month: CalendarMonth,
  records: readonly OrganizationLeaveRecord[],
  resolutionRows: readonly unknown[],
  queueRows: readonly ConflictRow[],
  today: string,
  now: Date,
): Coverage {
  const working = new Set(workingShiftTypeIdsOf(snapshot));
  const types = new Map(snapshot.types.map((type) => [type.id, type]));
  const names = new Map(snapshot.members.map((member) => [member.id, member.name]));
  const unresolved = new Set(queueRows.filter((row) => row.date === today).map((row) => row.key));
  const decided = new Map(
    resolutionsOf(snapshot, resolutionRows).map((resolution) => [collisionKeyOf(resolution), resolution.kind]),
  );
  const inForce = rosterStandingOfCalendar(snapshot).inForce;
  const minute = organizationWallClock(now, snapshot.timeZone).minute;
  const cells = rowOn(month, today).cells;
  const rows: CoverageRow[] = [];
  const off: string[] = [];
  const noRotation: string[] = [];

  for (const team of month.columns) {
    const cell = cells.find((candidate) => candidate.teamId === team.id);

    if (cell === undefined || cell.shiftTypeId === null || cell.name === null) {
      noRotation.push(team.name);
      continue;
    }

    if (!working.has(cell.shiftTypeId)) {
      off.push(team.name);
      continue;
    }

    const type = types.get(cell.shiftTypeId);

    if (type === undefined) throw new RangeError(`shift type ${cell.shiftTypeId} is not in the snapshot`);

    const version = shiftTypeVersionOn(type.versions, today);
    const roster = rosterOn(snapshot.members, inForce, team.id, today).roster;
    const absent: CoverageAbsent[] = [];
    let replaced = 0;

    for (const entry of roster) {
      if (!onLeave(records, entry.memberId, today)) continue;

      const key = collisionKeyOf({ memberId: entry.memberId, date: today, teamId: team.id });
      const kind = decided.get(key);

      if (!unresolved.has(key) && kind === REPLACE_MEMBER) {
        replaced += 1;
        continue;
      }

      const name = names.get(entry.memberId);

      if (name === undefined) throw new RangeError(`member ${entry.memberId} is not in the snapshot`);

      absent.push({
        memberId: entry.memberId,
        name,
        state: unresolved.has(key) ? ABSENT_UNRESOLVED : kind === ACCEPT_UNCOVERED ? ABSENT_ACCEPTED : ABSENT_RESOLVED,
      });
    }

    const total = roster.length - replaced;

    rows.push({
      teamId: team.id,
      teamName: team.name,
      shiftTypeName: cell.name,
      range: cell.range,
      phase: version === null ? null : coveragePhaseOf(version.startMinute, version.endMinute, minute),
      present: total - absent.length,
      total,
      absent,
      staffing: total === 0 ? STAFFING_NOBODY : absent.length === 0 ? STAFFING_FULL : STAFFING_SHORT,
    });
  }

  return { rows, off, noRotation };
}

/** The team `memberships` name on `date`, by name, or `null` for none. */
function teamNameOn(
  snapshot: CalendarSnapshot,
  memberships: readonly MembershipVersion[],
  date: string,
): string | null {
  const membership = membershipOn(memberships, date);

  if (membership === null) return null;

  const team = snapshot.teams.find((candidate) => candidate.id === membership.teamId);

  if (team === undefined) throw new RangeError(`team ${membership.teamId} is not in the snapshot`);

  return team.name;
}

/**
 * *Odsutni danas*: every active member whose leave covers today — back-to-back
 * records read as one absence — with their team today; then every active
 * member not on leave today whose leave starts tomorrow, with their team
 * tomorrow.
 *
 * @throws RangeError on any precondition of the domain, or a date that
 *   cannot be formatted.
 */
function absencesOf(snapshot: CalendarSnapshot, records: readonly OrganizationLeaveRecord[], today: string): Absences {
  const tomorrow = dayAfter(today);
  const absentToday: AbsentMember[] = [];
  const fromTomorrow: AbsentMember[] = [];

  for (const member of snapshot.members) {
    const own = records.filter((record) => record.memberId === member.id);

    if (own.length === 0) continue;

    const current = activeOn(member.statuses, today) ? absenceOn(own, today) : null;

    if (current !== null) {
      absentToday.push({
        memberId: member.id,
        name: member.name,
        teamName: teamNameOn(snapshot, member.memberships, today),
        from: dayMonthOf(current.from),
        to: dayMonthOf(current.to),
        oneDay: current.from === current.to,
      });
      continue;
    }

    const next = activeOn(member.statuses, tomorrow) ? absenceOn(own, tomorrow) : null;

    if (next !== null && next.from === tomorrow) {
      fromTomorrow.push({
        memberId: member.id,
        name: member.name,
        teamName: teamNameOn(snapshot, member.memberships, tomorrow),
        from: dayMonthOf(next.from),
        to: dayMonthOf(next.to),
        oneDay: next.from === next.to,
      });
    }
  }

  return { today: absentToday, tomorrow: fromTomorrow };
}

/** `čet`. @throws RangeError when the date cannot be formatted. */
function weekdayShortOf(date: string): string {
  const shown = formatIsoWeekdayShortName(date);

  if (shown === null) throw new RangeError(`the short weekday of ${date} could not be formatted`);

  return shown;
}

/** A date a team has no cell on: no rotation, no letter, no mark. */
function emptyWeekCellOf(date: string): WeekCell {
  return {
    date,
    letter: null,
    name: null,
    range: null,
    conflict: false,
    className: `${CALENDAR_CELL_CLASS} ${NO_ROTATION_CELL_CLASS}`,
    modifiers: [],
  };
}

/**
 * *Ovaj tjedan*: every active team across today and the six days after it,
 * each cell the calendar's own for that team and date — month by month as
 * the week crosses one — with ⚠ where the queue lists a conflict, and the
 * letters it shows with the types they stand for.
 *
 * EXPORTED for the node suite, which hands it a month that lacks a team.
 *
 * @throws RangeError when a date is missing from its month.
 */
export function weekOf(dates: readonly string[], months: ReadonlyMap<string, CalendarMonth>, today: string): Week {
  const first = monthFor(months, today);
  const legend: WeekLegendEntry[] = [];
  const seen = new Set<string>();
  let anyConflict = false;

  const rows = first.columns.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    cells: dates.map((date): WeekCell => {
      const cell = rowOn(monthFor(months, date), date).cells.find((candidate) => candidate.teamId === team.id);

      // A team the later month does not draw — created, archived or moved
      // across the month boundary inside the week — is an empty cell that
      // date, named as no rotation, never the whole screen refused.
      if (cell === undefined) return emptyWeekCellOf(date);

      const conflict = cell.modifiers.includes(MODIFIER_CONFLICT);

      anyConflict ||= conflict;

      if (cell.letter !== null && cell.name !== null && !seen.has(`${cell.letter}\u0000${cell.name}`)) {
        seen.add(`${cell.letter}\u0000${cell.name}`);
        legend.push({ letter: cell.letter, name: cell.name });
      }

      return {
        date,
        letter: cell.letter,
        name: cell.name,
        range: cell.range,
        conflict,
        className: cell.className,
        modifiers: cell.modifiers,
      };
    }),
  }));

  return {
    days: dates.map((date) => ({
      date,
      weekday: weekdayOf(date),
      weekdayShort: weekdayShortOf(date),
      dayMonth: dayMonthOf(date),
      isToday: date === today,
    })),
    rows,
    legend,
    anyConflict,
  };
}

/** Today in the admin's own words, for the subtitle. */
export const STATUS_WORKING = 'working';
export const STATUS_DUTY = 'duty';
export const STATUS_LEAVE = 'leave';
export const STATUS_FREE = 'free';
export const STATUS_UNSCHEDULED = 'unscheduled';

/** One of today's shifts, as the subtitle names it. */
export interface AdminStatusShift {
  /** `null` where no rotation is in effect. */
  readonly name: string | null;
  readonly range: string | null;
}

/** The admin's own today, as the subtitle states it after the date. */
export type AdminStatus =
  | { readonly kind: typeof STATUS_WORKING; readonly shifts: readonly AdminStatusShift[] }
  | { readonly kind: typeof STATUS_DUTY; readonly until: string }
  | { readonly kind: typeof STATUS_LEAVE }
  | { readonly kind: typeof STATUS_FREE }
  | { readonly kind: typeof STATUS_UNSCHEDULED };

/**
 * The admin's own today from `useToday`'s case: working with each shift, on
 * a duty until its end, on leave, free, or on no team at all; `null` while
 * that case is loading or unavailable — the subtitle then states the date
 * alone.
 */
export function adminStatusOf(today: Today): AdminStatus | null {
  if (today.kind === TODAY_UNSCHEDULED) return { kind: STATUS_UNSCHEDULED };
  if (today.kind !== TODAY_READY) return null;

  const todayCase = today.view.todayCase;

  switch (todayCase.kind) {
    case CASE_WORKING:
      return { kind: STATUS_WORKING, shifts: todayCase.shifts.map(({ name, range }) => ({ name, range })) };
    case CASE_DUTY:
      return { kind: STATUS_DUTY, until: todayCase.duty.end.time };
    case CASE_LEAVE:
      return { kind: STATUS_LEAVE };
    case CASE_FREE:
      return { kind: STATUS_FREE };
    default: {
      const unhandled: never = todayCase;

      return unhandled;
    }
  }
}

/** The sentence a status without shifts is stated in. Exhaustive. */
export function adminStatusMessageKey(
  kind: Exclude<AdminStatus['kind'], typeof STATUS_WORKING>,
):
  | 'danas.admin.status.duty'
  | 'danas.admin.status.leave'
  | 'danas.admin.status.free'
  | 'danas.admin.status.unscheduled' {
  switch (kind) {
    case STATUS_DUTY:
      return 'danas.admin.status.duty';
    case STATUS_LEAVE:
      return 'danas.admin.status.leave';
    case STATUS_FREE:
      return 'danas.admin.status.free';
    case STATUS_UNSCHEDULED:
      return 'danas.admin.status.unscheduled';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}

/** One working shift of the subtitle: with its range, or its name alone. */
export function adminStatusShiftMessageKey(
  shift: AdminStatusShift,
): 'danas.admin.status.working' | 'danas.admin.status.workingUntimed' {
  return shift.range === null ? 'danas.admin.status.workingUntimed' : 'danas.admin.status.working';
}

/** A row's badge in words: past, or today. Exhaustive. */
export function needsYouBadgeMessageKey(badge: NeedsYouBadge): 'danas.admin.needsYou.past' | 'danas.admin.needsYou.today' {
  if (badge === BADGE_PAST) return 'danas.admin.needsYou.past';
  if (badge === BADGE_TODAY) return 'danas.admin.needsYou.today';

  const unhandled: never = badge;

  return unhandled;
}

/** A row's shift: with its times, or its type alone. */
export function needsYouShiftMessageKey(
  row: Pick<NeedsYouRow, 'times'>,
): 'danas.admin.needsYou.shiftTimed' | 'danas.admin.needsYou.shift' {
  return row.times === null ? 'danas.admin.needsYou.shift' : 'danas.admin.needsYou.shiftTimed';
}

/** A shift's phase in words. Exhaustive. */
export function coveragePhaseMessageKey(
  kind: CoveragePhaseKind,
): 'danas.admin.coverage.starts' | 'danas.admin.coverage.running' | 'danas.admin.coverage.ended' {
  switch (kind) {
    case PHASE_STARTS:
      return 'danas.admin.coverage.starts';
    case PHASE_RUNNING:
      return 'danas.admin.coverage.running';
    case PHASE_ENDED:
      return 'danas.admin.coverage.ended';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}

/** An absent member on a working shift, in words. Exhaustive. */
export function coverageAbsentMessageKey(
  state: CoverageAbsentState,
):
  | 'danas.admin.coverage.absentUnresolved'
  | 'danas.admin.coverage.absentAccepted'
  | 'danas.admin.coverage.absentResolved' {
  switch (state) {
    case ABSENT_UNRESOLVED:
      return 'danas.admin.coverage.absentUnresolved';
    case ABSENT_ACCEPTED:
      return 'danas.admin.coverage.absentAccepted';
    case ABSENT_RESOLVED:
      return 'danas.admin.coverage.absentResolved';
    default: {
      const unhandled: never = state;

      return unhandled;
    }
  }
}

/** A coverage row's type: with its range, or its name alone. */
export function coverageShiftMessageKey(
  row: Pick<CoverageRow, 'range'>,
): 'danas.admin.coverage.shiftTimed' | 'danas.admin.coverage.shift' {
  return row.range === null ? 'danas.admin.coverage.shift' : 'danas.admin.coverage.shiftTimed';
}

/** An absent member's line: with their team or without one, over a range or one day. */
export function absentLineMessageKey(
  member: Pick<AbsentMember, 'teamName' | 'oneDay'>,
):
  | 'danas.admin.absent.line'
  | 'danas.admin.absent.lineNoTeam'
  | 'danas.admin.absent.lineDay'
  | 'danas.admin.absent.lineDayNoTeam' {
  if (member.oneDay) return member.teamName === null ? 'danas.admin.absent.lineDayNoTeam' : 'danas.admin.absent.lineDay';

  return member.teamName === null ? 'danas.admin.absent.lineNoTeam' : 'danas.admin.absent.line';
}

/** A member whose leave starts tomorrow: with their team or without one, over a range or one day. */
export function absentTomorrowMessageKey(
  member: Pick<AbsentMember, 'teamName' | 'oneDay'>,
):
  | 'danas.admin.absent.tomorrow'
  | 'danas.admin.absent.tomorrowNoTeam'
  | 'danas.admin.absent.tomorrowDay'
  | 'danas.admin.absent.tomorrowDayNoTeam' {
  if (member.oneDay) {
    return member.teamName === null ? 'danas.admin.absent.tomorrowDayNoTeam' : 'danas.admin.absent.tomorrowDay';
  }

  return member.teamName === null ? 'danas.admin.absent.tomorrowNoTeam' : 'danas.admin.absent.tomorrow';
}

/** A working team's staffing in words, where no absence is named. Exhaustive. */
export function coverageStaffingMessageKey(
  staffing: Exclude<CoverageStaffing, typeof STAFFING_SHORT>,
): 'danas.admin.coverage.full' | 'danas.admin.coverage.nobody' {
  if (staffing === STAFFING_FULL) return 'danas.admin.coverage.full';
  if (staffing === STAFFING_NOBODY) return 'danas.admin.coverage.nobody';

  const unhandled: never = staffing;

  return unhandled;
}

/** A week cell's accessible name: with or without times, with or without the conflict. */
export function weekCellMessageKey(
  cell: Pick<WeekCell, 'range' | 'conflict'>,
):
  | 'danas.admin.week.cellTimed'
  | 'danas.admin.week.cell'
  | 'danas.admin.week.cellTimedConflict'
  | 'danas.admin.week.cellConflict' {
  if (cell.conflict) return cell.range === null ? 'danas.admin.week.cellConflict' : 'danas.admin.week.cellTimedConflict';

  return cell.range === null ? 'danas.admin.week.cell' : 'danas.admin.week.cellTimed';
}
