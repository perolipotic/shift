import { isShortStaffed, newlyShortStaffedOf, peopleAtWorkOn, type CollisionLeaveRecord } from '@shift/domain';

import { minimumOfCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { readsOrganizationLeave } from '@/features/calendar/services/snapshot-skew';
import { dayMonthOf, staffingInputOf } from '@/features/calendar/utils/month';
import { organizationLeaveRecordsOf, type OrganizationLeaveRecord } from '@/features/leave/services/leave-list';
import { splitTeams } from '@/features/teams/services/list';
import { nextIsoDate } from '@/lib/i18n/format';

/**
 * STORY 11.2: the short-staffed report of one save, before it is saved, as a
 * pure view model in a `.ts` that renders nothing (AD-15). Codes, names and
 * numbers only; `components/short-staffed-block` words them.
 *
 * ONE DIFF FOR EVERY SURFACE ({@link shortStaffedReportOf}). "Before" is the
 * calendar snapshot and the organization's live leave as the surface holds
 * them; "after" is the same as the save would leave them — each surface's own,
 * and always the one its erasure check (or, for a leave save, its conflict
 * preview) already builds: nothing is projected here. Both go through one
 * input recipe ({@link staffingInputOf}: `snapshotScheduleInputOf`, as
 * `collisionInputOf`'s, with the active teams and the minimum), and the
 * domain's `newlyShortStaffedOf` decides: no staffing arithmetic lives here
 * (AD-7).
 *
 * THE SETTING EMPTY REPORTS NOTHING: `null` — no block, no line — before any
 * leave is looked at, so a surface reads the organization's leave only while
 * the minimum is set ({@link readsStaffingLeaveOf}).
 *
 * NEVER A GUESS, NEVER A GATE. The leave read pending or failed, a row that
 * cannot be trusted, or any `RangeError` of the derivation is *unknown*: one
 * neutral line, logged, and the save stays offered. Nothing here ever holds a
 * save, and a save's own fresh reads never re-derive it (R10.4): a stale cache
 * can at worst show a stale warning.
 */

/** What a report that cannot be derived logs: never shown. */
export const SHORT_STAFFED_UNAVAILABLE = 'SHORT_STAFFED_UNAVAILABLE';

/** The report is known: zero or more newly short-staffed shifts. */
export const SHORT_STAFFED_KNOWN = 'known';
/** The leave read is pending or failed, or the derivation threw: one neutral line says so. */
export const SHORT_STAFFED_UNKNOWN = 'unknown';

/**
 * How many days an open-ended change (a deactivation, a team move, a rotation)
 * is reported over, its own date included: *Danas*'s next-shift horizon
 * (`NEXT_SHIFT_HORIZON_DAYS`), so a year of shifts at most.
 */
export const SHORT_STAFFED_HORIZON_DAYS = 366;

/** How many rows the block lists; the rest are counted (`i još {n}`). */
export const SHORT_STAFFED_SHOWN_ROWS = 5;

/** An inclusive window of calendar dates, `YYYY-MM-DD`. */
export interface StaffingWindow {
  readonly from: string;
  readonly to: string;
}

/** One side of a change: the calendar snapshot and the organization's live leave, or `null` while the leave is not known. */
export interface StaffingSide {
  readonly calendar: CalendarSnapshot;
  readonly records: readonly CollisionLeaveRecord[] | null;
}

/** One shift the change would newly make short-staffed: `Smjena B, 14.10. Dan: rade 2 od najmanje 3`. */
export interface ShortStaffedRow {
  /** The team and the date: a row's stable identity. */
  readonly key: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly teamId: string;
  readonly teamName: string;
  /** `14.10.` */
  readonly dayMonth: string;
  readonly shiftTypeName: string;
  readonly atWork: number;
  readonly minimum: number;
}

export type ShortStaffedReport =
  | {
      readonly kind: typeof SHORT_STAFFED_KNOWN;
      /** The first {@link SHORT_STAFFED_SHOWN_ROWS}, by date and then team. */
      readonly rows: readonly ShortStaffedRow[];
      /** How many more there are beyond `rows`: the `i još {n}`. */
      readonly more: number;
    }
  | { readonly kind: typeof SHORT_STAFFED_UNKNOWN };

/** Whether `report` draws anything: the unknown line, or at least one row. */
export function shortStaffedShownOf(report: ShortStaffedReport | null): boolean {
  return report !== null && (report.kind === SHORT_STAFFED_UNKNOWN || report.rows.length > 0);
}

/** TanStack's answer of the organization's leave read, as far as the report reads it. */
export interface StaffingLeaveSource {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data: readonly unknown[] | undefined;
}

/**
 * The snapshot's Minimum Members and the staffing rule's one input recipe,
 * re-exported from their homes beside `calendarMinimumMembersOf` and
 * `snapshotScheduleInputOf` (Epic 11 retro A2, R2), so `calendar/utils/month`
 * reads them without importing this module back.
 */
export { minimumOfCalendar, staffingInputOf };

/**
 * Whether a surface over `calendar` reads the organization's leave for the
 * report: only an admin's — whose read is the organization's — and only while
 * the minimum is set. The setting empty reads nothing more.
 */
export function readsStaffingLeaveOf(calendar: CalendarSnapshot | null): boolean {
  return calendar !== null && readsOrganizationLeave(calendar.viewer.role) && minimumOfCalendar(calendar) !== null;
}

/** The member a leave row names, when it names one as text. */
function rowMemberOf(row: unknown): string | null {
  const memberId = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)['member_id'] : null;

  return typeof memberId === 'string' ? memberId : null;
}

/**
 * The organization's live leave as `leave` answered it, parsed against the
 * snapshot's members, or `null` — not known — while the read is pending,
 * failed or not observed, or when a row cannot be trusted. A pending read is
 * an ordinary wait and logs nothing; a failed read and an untrusted row are
 * logged.
 *
 * A ROW OF A MEMBER THE SNAPSHOT DOES NOT HOLD YET is left out, never a
 * refusal: the two reads are two requests, so a member created between them
 * is a race, and one the snapshot does not hold is on none of its rosters, so
 * their leave changes no shift's staffing. Every other row is checked.
 */
export function staffingRecordsOf(
  calendar: CalendarSnapshot,
  leave: StaffingLeaveSource | null,
): readonly OrganizationLeaveRecord[] | null {
  if (leave === null || leave.isPending) return null;
  if (leave.isError || leave.data === undefined) {
    console.error(SHORT_STAFFED_UNAVAILABLE, 'the leave read failed');

    return null;
  }

  const memberIds = calendar.members.map((member) => member.id);
  const known = new Set(memberIds);

  const records = organizationLeaveRecordsOf(
    leave.data.filter((row) => {
      const memberId = rowMemberOf(row);

      return memberId === null || known.has(memberId);
    }),
    memberIds,
  );

  if (records === null) console.error(SHORT_STAFFED_UNAVAILABLE, 'a leave record row cannot be trusted');

  return records;
}

/**
 * The window of an open-ended change from `from`: {@link SHORT_STAFFED_HORIZON_DAYS}
 * days, `from` included.
 *
 * @throws RangeError when `from` is not a calendar date.
 */
export function horizonWindowOf(from: string): StaffingWindow {
  let to = from;

  for (let day = 1; day < SHORT_STAFFED_HORIZON_DAYS; day += 1) {
    const next = nextIsoDate(to);

    if (next === null) throw new RangeError(`the date ${to} has no next day`);

    to = next;
  }

  return { from, to };
}

/** The window of one date. */
export function dayWindowOf(date: string): StaffingWindow {
  return { from: date, to: date };
}

/** The report cannot be checked now: the one neutral line. Logs nothing (a pending read is a wait, not a fault). */
export const SHORT_STAFFED_UNKNOWN_REPORT: ShortStaffedReport = Object.freeze({ kind: SHORT_STAFFED_UNKNOWN });

/** Logs why the report is unknown and says so: for a surface whose own "after" threw a `RangeError` too. */
export function unknownReportOf(cause: unknown): ShortStaffedReport {
  console.error(SHORT_STAFFED_UNAVAILABLE, cause);

  return { kind: SHORT_STAFFED_UNKNOWN };
}

/**
 * THE REPORT: the working shifts from `window.from` to `window.to` that
 * `after` makes short-staffed and `before` did not, named and numbered, by
 * date and then team — the first {@link SHORT_STAFFED_SHOWN_ROWS} and how many
 * more. `null` while the minimum is empty (`after`'s, the current setting),
 * whatever the leave. Unknown while either side's leave is not known (logged
 * where `staffingRecordsOf` found a fault), and unknown, logged, on any
 * `RangeError`; anything else is rethrown.
 */
export function shortStaffedReportOf(
  before: StaffingSide,
  after: StaffingSide,
  window: StaffingWindow,
): ShortStaffedReport | null {
  if (minimumOfCalendar(after.calendar) === null) return null;
  if (before.records === null || after.records === null) return SHORT_STAFFED_UNKNOWN_REPORT;

  try {
    const shifts = newlyShortStaffedOf(
      staffingInputOf(before.calendar, before.records),
      staffingInputOf(after.calendar, after.records),
      window.from,
      window.to,
    );
    const teams = new Map(after.calendar.teams.map((team) => [team.id, team.name]));
    const types = new Map(after.calendar.types.map((type) => [type.id, type.name]));
    const rows = shifts.slice(0, SHORT_STAFFED_SHOWN_ROWS).map((shift): ShortStaffedRow => {
      const teamName = teams.get(shift.teamId);
      const shiftTypeName = types.get(shift.shiftTypeId);

      if (teamName === undefined) throw new RangeError(`team ${shift.teamId} is not in the snapshot`);
      if (shiftTypeName === undefined) throw new RangeError(`shift type ${shift.shiftTypeId} is not in the snapshot`);

      return {
        key: JSON.stringify([shift.date, shift.teamId]),
        date: shift.date,
        teamId: shift.teamId,
        teamName,
        dayMonth: dayMonthOf(shift.date),
        shiftTypeName,
        atWork: shift.atWork,
        minimum: shift.minimum,
      };
    });

    return { kind: SHORT_STAFFED_KNOWN, rows, more: shifts.length - rows.length };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    return unknownReportOf(cause);
  }
}

/**
 * A CONFIGURATION CHANGE'S REPORT (a roster or type change, a removal, a
 * deactivation, a team move, a rotation): `before` and `after` snapshots over
 * the SAME live leave, as the erasure check diffs them. `null` while the
 * minimum is empty, before the leave is looked at, and for a viewer who is
 * not an admin, whose surface observes no organization leave by design.
 */
export function configurationReportOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  window: StaffingWindow,
  leave: StaffingLeaveSource | null,
): ShortStaffedReport | null {
  if (minimumOfCalendar(after) === null || !readsStaffingLeaveOf(before)) return null;

  const records = staffingRecordsOf(before, leave);

  return shortStaffedReportOf({ calendar: before, records }, { calendar: after, records }, window);
}

/** The leave change previewed, shaped as `leaveConflictsOf` shapes it. */
export interface StaffingLeaveChange {
  /** Whose record it is. */
  readonly memberId: string;
  /** The record amended, by its id; `null` for a new record. */
  readonly targetId: string | null;
  /** The id a new record's candidate carries (`LEAVE_CANDIDATE_ID`): one no stored record can carry. */
  readonly candidateId: string;
  /** The range the change leaves. */
  readonly next: StaffingWindow;
}

/**
 * A LEAVE SAVE'S REPORT (a new record, an amend, a request's approval): the
 * organization's live leave as read, then the same with the candidate added or
 * the target's range replaced (same id), over one snapshot. The window is the
 * new range. `null` while the minimum is empty, for a viewer who is not an
 * admin (no organization leave is observed), and — as `leaveConflictsOf`
 * says nothing then — for a range that shares a date with another of the
 * member's records, which the database will refuse.
 */
export function leaveChangeReportOf(
  calendar: CalendarSnapshot,
  leave: StaffingLeaveSource | null,
  change: StaffingLeaveChange,
): ShortStaffedReport | null {
  if (minimumOfCalendar(calendar) === null || !readsStaffingLeaveOf(calendar)) return null;

  const records = staffingRecordsOf(calendar, leave);
  const id = change.targetId ?? change.candidateId;
  const { from, to } = change.next;

  if (records?.some((record) => record.memberId === change.memberId && record.id !== id && record.from <= to && from <= record.to)) {
    return null;
  }

  const after =
    records === null
      ? null
      : [
          ...records.filter((record) => record.id !== id),
          { id, memberId: change.memberId, from: change.next.from, to: change.next.to },
        ];

  return shortStaffedReportOf({ calendar, records }, { calendar, records: after }, change.next);
}

// ------------------------------------------------- the resolution strip

/** One resolution option's coverage against the minimum: `rade 2 od najmanje 3`. */
export interface CoverageAgainstMinimum {
  readonly atWork: number;
  readonly minimum: number;
  /** Fewer at work than the minimum: the strip adds the glyph and the words. */
  readonly short: boolean;
}

/**
 * The people at work on `teamId`'s shift on `date` over one option's own
 * after (`records` as that option leaves the leave, `calendar` as it leaves
 * the roster), against the minimum — the domain's `peopleAtWorkOn`. `null`
 * while the minimum is empty (the strip stays as shipped), on a shift that is
 * not working, or on a `RangeError` (logged).
 */
export function coverageAgainstMinimumOf(
  calendar: CalendarSnapshot,
  records: readonly CollisionLeaveRecord[],
  teamId: string,
  date: string,
): CoverageAgainstMinimum | null {
  const minimum = minimumOfCalendar(calendar);

  if (minimum === null) return null;

  try {
    const staffing = peopleAtWorkOn(staffingInputOf(calendar, records), teamId, date);

    if (staffing === null) return null;

    return { atWork: staffing.atWork, minimum, short: isShortStaffed(staffing.atWork, minimum) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(SHORT_STAFFED_UNAVAILABLE, cause);

    return null;
  }
}

// ------------------------------------------------- the calendar's day detail

/**
 * STORY 11.3: the day detail's line under *Sastav*, `rade 2 od najmanje 3`,
 * for `teamId`'s working shift on `date`, from the calendar's own snapshot and
 * the organization's leave its marks carry (`staffingLeave`) — the same
 * records the month's short-staffed marks are derived from, so the line and
 * the cell agree. `short` adds the glyph and `Premalo ljudi:`.
 *
 * `null` — no line — for a member and while the setting is empty
 * (`staffingLeave` is `null` then), on a team that is not active (an archived
 * team's day opened from the person view: the grid, which draws the active
 * teams alone, never marks it, so the line never says it either), on a shift
 * that is not working, and on a `RangeError` (logged), through
 * {@link coverageAgainstMinimumOf}: the domain's `peopleAtWorkOn` and
 * `isShortStaffed`, no arithmetic here (AD-7).
 */
export function dayStaffingOf(
  calendar: CalendarSnapshot,
  staffingLeave: readonly CollisionLeaveRecord[] | null,
  teamId: string,
  date: string,
): CoverageAgainstMinimum | null {
  if (staffingLeave === null) return null;
  if (!splitTeams(calendar.teams).active.some((team) => team.id === teamId)) return null;

  return coverageAgainstMinimumOf(calendar, staffingLeave, teamId, date);
}
