import {
  DUTY_RUNNING,
  LEAVE_HALF_FIRST,
  activeOn,
  halfFieldOf,
  isHalfDay,
  leaveRangeCostOf,
  leaveSpanOf,
  loanAheadOf,
  membershipOn,
  monthOf,
  type LeaveHalf,
  type LeaveRange,
} from '@shift/domain';

import { absenceTypesOfCalendar, type CalendarSnapshot, type CalendarSurfaceState } from '@/features/calendar/services/snapshot';
import {
  calendarDayListOf,
  calendarTodayOf,
  dayMonthOf,
  memberScheduleInputOf,
  weekdayOf,
  workingShiftTypeIdsOf,
  type CalendarDay,
  type CalendarMarks,
} from '@/features/calendar/utils/month';
import { loanNoticeShownOf, type LoanNotice } from '@/features/calendar/utils/loan-marks';
import { leaveRecordsOf, type LeaveRecord } from '@/features/leave/services/leave-list';
import { leaveHalfOptionsOf } from '@/features/leave/services/leave-section';
import type { MemberTeam } from '@/features/members/services/list';
import {
  legKeyOf,
  runningFromYesterdayOf,
  todayDutyOf,
  type DutySources,
  type TodayDuty,
} from '@/features/today/services/today-duty';
import { RANGE_DASH, formatIsoDate, nextIsoDate, organizationWallClock } from '@/lib/i18n/format';
import { dayAfter } from '@/utils/dates';

/**
 * *Danas* for the viewer (story 6.1a): today in words — on leave, with what
 * the absence costs in leave days since story 6.1b — the next working
 * shift and the next seven days, as a pure view model in a `.ts` that
 * renders nothing (AD-15). The hook only wires it; the node suite executes it.
 *
 * THE CALENDAR'S OWN READS AND DERIVATIONS. The calendar snapshot under
 * `CALENDAR_KEY` and the viewer's own live leave under `MY_LEAVE_RECORDS_KEY`
 * — the same query options *Kalendar* uses — and every day is
 * `calendarDayListOf`'s, so a day here is *Moj raspored*'s day: the same
 * projection (`memberScheduleOfMonth` over `memberScheduleInputOf`), the same
 * type names and ranges, the same leave marks. Nothing is projected here.
 *
 * THE MARKS ARE MEMBER-SHAPED FOR EVERY ROLE: no collision, and the viewer's
 * own leave alone, parsed by `leaveRecordsOf` against the viewer's id — the
 * calendar's member branch (`calendarMarksOf`). An admin who belongs to a
 * team reads the same screen as a member; `my_leave_records()` (0030)
 * answers an admin's own rows too.
 *
 * EXACTLY ONE CASE TODAY, chosen in this order: on a duty running now
 * (story 6.2: touching working shifts read as one, `today-duty.ts`'s — on a
 * day of leave too, since leave drops only today's legs); working with a
 * shift from yesterday still running now (the lone-Noć carry-over, marked
 * `fromYesterday`, listed before today's own working shifts, which a day of
 * leave hides); on leave (over any duty not yet running or already done,
 * on a working or a non-working day); on any other duty; working (a working
 * shift today); or free (only non-working types, or none). Once the
 * carried-over shift ends, today is the free or the leave case again. A
 * viewer with no membership at all and no loan ahead (story 18.5) is
 * unscheduled, and has no next shift
 * and no week.
 *
 * A HALF DAY IS AT WORK (story 13.7, R10.1). A half-day record is an
 * absence of its own date alone: it joins no neighbour, and nothing joins
 * across it. The duty legs, the next shift, the week and `Vraćaš se` read it
 * as a working day. Today, on a date with a working shift, it is the working
 * case — or the duty, which still wins as on any working day — and one line
 * names the type, the absent half and what it costs; on the one working shift
 * a half splits, its row shows the worked half's times, and on two each row
 * keeps its own. With no working shift left, it stays the leave case, its
 * date named with its half, and no cost.
 *
 * THE VIEWER'S TEAM TODAY ("Tvoja smjena ‹tim›") comes from the same
 * snapshot — the viewer's membership history and the teams it names — so
 * one fact on the screen has one read (AD-13); the today card states it.
 *
 * NEVER A GUESS. A read that failed or is paused offline is unavailable with
 * a retry; a row that cannot be trusted or any error the derivation throws
 * is unavailable without one, logged. Codes, data and formatted dates only;
 * the components translate.
 *
 * OFFLINE, THE WHOLE SNAPSHOT OR NOTHING (story 8.2). The hooks hand this
 * module every read through the surface's freshness
 * (`@/lib/offline/freshness`'s `snapshotAnswerOf`): offline with every read
 * cached, each arrives settled, so today is drawn from the device under the
 * page's as-of note — and so, just after a reconnect, until every read is
 * fresh; offline with any read missing or failed, each arrives FAILED, so the
 * `isError` branch below is the unavailable state it always was; online after
 * the app's start, a read older than the session's network arrives pending —
 * the skeleton.
 */

/**
 * TanStack Query's name for a fetch it has not started (offline). Since story
 * 8.2 *Danas*'s hooks hand no paused read here: a whole offline snapshot
 * arrives settled, and a partial one arrives FAILED, which takes the
 * `isError` branch, not this one. Kept so a read handed in raw is still
 * refused rather than drawn without its as-of time.
 */
const FETCH_PAUSED = 'paused';

/** How far ahead the next working shift is looked for, in days. */
export const NEXT_SHIFT_HORIZON_DAYS = 366;

/** How many days after today the week lists. */
export const WEEK_DAYS = 7;

/** Still waiting on a read: the skeleton, never a figure. */
export const TODAY_LOADING = 'loading';
/** A read failed, or what it answered cannot be trusted: one alert, no case. */
export const TODAY_UNAVAILABLE = 'unavailable';
/** The viewer has no membership at all, and no loan ahead: their own sentence, no next shift and no week. */
export const TODAY_UNSCHEDULED = 'unscheduled';
/** Everything read: today's case, the next shift and the week. */
export const TODAY_READY = 'ready';

/** On leave today: wins over every other case. */
export const CASE_LEAVE = 'leave';
/** On a duty (story 6.2): working shifts that touch, one of them today or running now. */
export const CASE_DUTY = 'duty';
/** A working shift today, or one from yesterday still running now. */
export const CASE_WORKING = 'working';
/** Only non-working types today, or no shift at all. */
export const CASE_FREE = 'free';

/** One shift of today: its type's name (`null` where no rotation is in effect), its range, and its team. */
export interface TodayShift {
  readonly teamId: string;
  readonly teamName: string;
  readonly name: string | null;
  /** `19:00–07:00`; `null` for a non-working type or one with no times. */
  readonly range: string | null;
  /** A shift dated yesterday still running now (`od jučer`); today's own are `false`. */
  readonly fromYesterday: boolean;
}

/**
 * A half day today with its working shift (story 13.7): the type of the
 * record, the half the viewer is absent for, and what it costs in leave days
 * — 0.5 for a drawing type, 0 for one that does not draw (no cost is said).
 */
export interface TodayHalf {
  readonly typeName: string;
  readonly half: LeaveHalf;
  readonly costDays: number;
}

/** Today, as exactly one case. */
export type TodayCase =
  | {
      readonly kind: typeof CASE_LEAVE;
      /** The whole absence's first and last day, `28.09.2026`: back-to-back records read as one. */
      readonly from: string;
      readonly to: string;
      /**
       * The stored name of the absence type of TODAY's record (story 13.2b):
       * the viewer's own, so theirs to see.
       */
      readonly typeName: string;
      /**
       * What the absence costs in leave days (story 6.1b): the domain's
       * `leaveRangeCostOf` over each own record it joins that DRAWS down the
       * allowance (story 13.2b), each on its own range, summed — only the
       * days the viewer would have worked count, a half day's at 0.5
       * (story 13.5). Zero when none draws, and
       * the card then states no cost.
       */
      readonly costDays: number;
      /**
       * STORY 13.7: a stored half whose date no longer holds a working shift:
       * the date is named with its half, and no cost is said. Absent for a
       * whole day.
       */
      readonly half?: LeaveHalf;
    }
  | {
      readonly kind: typeof CASE_DUTY;
      readonly duty: TodayDuty;
      /** STORY 13.7: a half day today, named under the duty-block. Absent on a whole working day. */
      readonly half?: TodayHalf;
    }
  | {
      readonly kind: typeof CASE_WORKING;
      readonly shifts: readonly TodayShift[];
      /**
       * STORY 13.7: a half day today. On its one working shift the row shows
       * the worked half's times; on two, each keeps its own. Absent on a whole
       * working day.
       */
      readonly half?: TodayHalf;
    }
  | {
      readonly kind: typeof CASE_FREE;
      /** The non-working type and its team, or `null` for no shift (`Bez smjene`, or `Neaktivno`). */
      readonly shift: TodayShift | null;
      /** Inactive today (B449): no shift then says so, never "no team". */
      readonly inactive: boolean;
    };

/** A date as the screen states it: `četvrtak` and `01.10.2026`. */
export interface TodayDate {
  readonly date: string;
  readonly weekday: string;
  readonly text: string;
}

/** The first working shift after today that leave does not cover. */
export interface NextShift extends TodayDate {
  /** Days from today: `za 4 dana`. */
  readonly inDays: number;
  readonly name: string;
  /** `null` when the type has no times on that date: the name alone. */
  readonly range: string | null;
}

/** One of the next seven days: *Moj raspored*'s day, and whether own leave covers it. */
export interface TodayWeekDay {
  readonly day: CalendarDay;
  readonly onLeave: boolean;
}

/** The ready screen. */
export interface TodayView {
  readonly today: TodayDate;
  readonly todayCase: TodayCase;
  /** `null` when no working shift falls within {@link NEXT_SHIFT_HORIZON_DAYS}. */
  readonly next: NextShift | null;
  /** Whether the next shift is the viewer's return from leave (`Vraćaš se`). */
  readonly returning: boolean;
  readonly week: readonly TodayWeekDay[];
  /** The viewer's team today, `null` for none (`Bez smjene`): {@link ownTeamOf}. */
  readonly ownTeam: MemberTeam | null;
  /**
   * STORY 18.5 (UX-DR59): the viewer's loan covering today, else their next
   * one (`U timu {tim} do {datum}.`). ABSENT with none, so a view with no
   * loan is the view it was.
   */
  readonly loan?: LoanNotice;
}

/** The `loan` field of a view: present only with a notice. */
function loanFieldOf(notice: LoanNotice | null): { readonly loan?: LoanNotice } {
  return notice === null ? {} : { loan: notice };
}

export type Today =
  | { readonly kind: typeof TODAY_LOADING }
  | {
      readonly kind: typeof TODAY_UNAVAILABLE;
      /** True for a read that failed or is paused offline; reading again cannot mend a refused row. */
      readonly retryable: boolean;
    }
  | { readonly kind: typeof TODAY_UNSCHEDULED; readonly today: TodayDate }
  | { readonly kind: typeof TODAY_READY; readonly view: TodayView };

/** The own-leave query result, as far as it is read here. */
export interface TodayRowsAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly unknown[] | undefined;
}

/** The two reads *Danas* stands on. */
export interface TodaySources {
  /** `calendarSurfaceStateOf`'s answer over the calendar snapshot. */
  readonly calendar: CalendarSurfaceState;
  readonly records: TodayRowsAnswer;
}

/** Whether a read failed or is paused offline, a failed refetch over cached rows included. */
function rowsFailed(answer: TodayRowsAnswer): boolean {
  return answer.isError || answer.fetchStatus === FETCH_PAUSED || (!answer.isPending && answer.data === undefined);
}

/**
 * What *Danas* shows from its two reads at `now`: unavailable (with a retry)
 * when either read failed or is paused — first, so a failure is never hidden
 * behind the other's skeleton — loading while either is pending, and
 * otherwise {@link todayViewOf}'s answer.
 */
export function todayOf({ calendar, records }: TodaySources, now: Date): Today {
  if (calendar.refusal !== null || rowsFailed(records) || (!calendar.loading && calendar.snapshot === null)) {
    return { kind: TODAY_UNAVAILABLE, retryable: true };
  }

  if (calendar.snapshot === null || records.data === undefined) return { kind: TODAY_LOADING };

  return todayViewOf(calendar.snapshot, records.data, now);
}

/**
 * *Danas* from the snapshot and the viewer's own leave rows as
 * `my_leave_records()` answered them, at `now`: unscheduled for a viewer with
 * no membership, unavailable when a row cannot be trusted or the derivation
 * throws a `RangeError` — logged, never a crashed route — and otherwise
 * ready. Anything else thrown is a defect, and is not caught here.
 *
 * `now` is read as the organization's wall clock (story 6.2): the minute a
 * duty's progress is measured at.
 */
export function todayViewOf(snapshot: CalendarSnapshot, rows: readonly unknown[], now: Date): Today {
  try {
    const viewer = snapshot.viewer;
    const today = calendarTodayOf(snapshot, now);
    const shown = todayDateOf(today);

    // STORY 18.5: a viewer with no team is scheduled while a loan of theirs
    // covers today or lies ahead; with none, or only past ones, unscheduled.
    if (viewer.memberships.length === 0 && loanAheadOf(viewer.loans, today) === null) {
      return { kind: TODAY_UNSCHEDULED, today: shown };
    }

    const records = leaveRecordsOf(rows, viewer.memberId);

    if (records === null) {
      console.error(TODAY_UNAVAILABLE, 'row');

      return { kind: TODAY_UNAVAILABLE, retryable: false };
    }

    const days = dayLookupOf(snapshot, today, records);
    const working = new Set(workingShiftTypeIdsOf(snapshot));
    const leaveToday = absenceOn(records, today);
    // STORY 13.7: a half day counts at work (R10.1); only a whole day of leave is leave here.
    const wholeToday = leaveToday === null || isHalfDay(leaveToday) ? null : leaveToday;
    const sources: DutySources = {
      on: (date) => days.on(date),
      onLeave: (date) => wholeLeaveOn(records, date) !== null,
      working,
    };
    const wallClock = organizationWallClock(now, snapshot.timeZone);
    // On a day of leave today's legs are dropped, so only a duty running now
    // — begun on an earlier date — can be found.
    const duty = todayDutyOf(snapshot, sources, today, wallClock);
    // Read only when no duty runs: a running duty never depends on it.
    const carried =
      duty !== null && duty.duty.phase === DUTY_RUNNING ? [] : runningFromYesterdayOf(snapshot, sources, today, wallClock);
    // STORY 13.7: a half day today, or null for a whole day or no leave.
    let halfWork: HalfWork | null = null;

    if (leaveToday !== null && isHalfDay(leaveToday)) {
      // The half-day line names the record's type, as the leave case does.
      const halfType = leaveTypeNameOn(snapshot, records, today);

      if (halfType === null) {
        console.error(TODAY_UNAVAILABLE, 'type');

        return { kind: TODAY_UNAVAILABLE, retryable: true };
      }

      halfWork = halfWorkOf(snapshot, records, days.on(today), working, halfType);
    }

    let todayCase: TodayCase;
    // The legs of the duty shown, which are today's and never the next shift.
    let skip = NO_LEGS;

    if (duty !== null && duty.duty.phase === DUTY_RUNNING) {
      // STORY 13.7: a half day today is named under the duty-block.
      todayCase = { kind: CASE_DUTY, duty: duty.duty, ...halfCaseFieldOf(halfWork) };
      skip = duty.legKeys;
    } else if (carried.length > 0) {
      // A carry-over never joins a duty: today's shifts, a duty's or not, are rows.
      const own =
        wholeToday === null ? days.on(today).shifts.filter((shift) => isWorking(working, shift)) : [];

      todayCase = {
        kind: CASE_WORKING,
        shifts: [
          ...carried.map((shift) => todayShiftOf(snapshot, shift, true)),
          ...own.map((shift) => halfShiftOf(todayShiftOf(snapshot, shift), halfWork)),
        ],
        ...halfCaseFieldOf(halfWork),
      };
      // Today's duty still to come is listed as rows, and its legs stay
      // today's: one dated tomorrow is never the next shift.
      if (duty !== null && wholeToday === null) skip = duty.legKeys;
    } else if (duty !== null && wholeToday === null) {
      // STORY 13.7: a half day is at work, so its duty stands, the half named under it.
      todayCase = { kind: CASE_DUTY, duty: duty.duty, ...halfCaseFieldOf(halfWork) };
      skip = duty.legKeys;
    } else if (halfWork !== null && halfWork.atWork) {
      // STORY 13.7: a half day on a date with a working shift is the working case.
      todayCase = {
        kind: CASE_WORKING,
        shifts: days.on(today)
          .shifts.filter((shift) => isWorking(working, shift))
          .map((shift) => halfShiftOf(todayShiftOf(snapshot, shift), halfWork)),
        ...halfCaseFieldOf(halfWork),
      };
    } else {
      // STORY 13.2b: on leave today, the case names today's record's type. A
      // snapshot cached before 13.2 holds no catalog: unavailable until read again.
      const typeName = leaveToday === null ? null : leaveTypeNameOn(snapshot, records, today);

      if (leaveToday !== null && typeName === null) {
        console.error(TODAY_UNAVAILABLE, 'type');

        return { kind: TODAY_UNAVAILABLE, retryable: true };
      }

      todayCase = todayCaseOf(snapshot, days.on(today), leaveToday, working, records, typeName ?? '');
    }

    return {
      kind: TODAY_READY,
      view: {
        today: shown,
        todayCase,
        next: nextShiftOf(days, today, records, working, skip),
        // A half day is no absence to return from (story 13.7).
        returning: todayCase.kind === CASE_LEAVE && todayCase.half === undefined,
        week: weekOf(days, today, records),
        ownTeam: ownTeamOf(snapshot, today),
        ...loanFieldOf(loanNoticeShownOf(snapshot, viewer.loans, today)),
      },
    };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(TODAY_UNAVAILABLE, cause);

    return { kind: TODAY_UNAVAILABLE, retryable: false };
  }
}

/** `četvrtak` and `01.10.2026`. @throws RangeError when the date cannot be formatted. */
function todayDateOf(date: string): TodayDate {
  const text = formatIsoDate(date);

  if (text === null) throw new RangeError(`the date ${date} could not be formatted`);

  return { date, weekday: weekdayOf(date), text };
}

/** The record of `records` that covers `date`, every date of a range inclusive, or `null`. */
function leaveOn(records: readonly LeaveRecord[], date: string): LeaveRecord | null {
  return records.find((record) => record.from <= date && date <= record.to) ?? null;
}

/** The own record of a WHOLE day covering `date`, or `null`: a half day counts at work (story 13.7, R10.1). */
function wholeLeaveOn(records: readonly LeaveRecord[], date: string): LeaveRecord | null {
  const record = leaveOn(records, date);

  return record === null || isHalfDay(record) ? null : record;
}

/** The whole absence covering a date, and the own records it joins, each with its own range. */
export interface Absence extends LeaveRange {
  readonly records: readonly LeaveRange[];
}

/**
 * The whole absence that covers `date`: the record covering it, extended
 * across every own record that overlaps it or starts the day after it ends —
 * back-to-back records are one absence, and the next shift is the return
 * after all of them — with the records it joins. `null` when no record
 * covers `date`. EXPORTED for story 6.3: *Odsutnost danas* states each
 * member's absence the same way, over that member's records alone.
 *
 * A HALF DAY (story 13.7) is an absence of its own: its one date, carrying
 * its half. It joins no neighbour, and nothing joins across it — the whole
 * days either side of it are two absences.
 */
export function absenceOn(records: readonly LeaveRecord[], date: string): Absence | null {
  const covering = leaveOn(records, date);

  if (covering === null) return null;

  if (isHalfDay(covering)) {
    const own = leaveSpanOf(covering);

    return { ...own, records: [own] };
  }

  // A half day joins nothing: never a link between the whole days either side of it.
  const ordered = records.filter((record) => !isHalfDay(record)).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  let { from, to } = covering;
  let grown = true;

  while (grown) {
    grown = false;

    for (const record of ordered) {
      const joinsAfter = record.from <= to || record.from === nextIsoDate(to);
      const joinsBefore = record.to >= from || nextIsoDate(record.to) === from;

      if (!(joinsAfter && joinsBefore)) continue;

      if (record.from < from) {
        from = record.from;
        grown = true;
      }

      if (record.to > to) {
        to = record.to;
        grown = true;
      }
    }
  }

  // Every record inside the absence is one it joined: the absence is the
  // contiguous union of its records, and records of one member never overlap.
  const joined = ordered
    .filter((record) => from <= record.from && record.to <= to)
    .map((record) => leaveSpanOf(record));

  return { from, to, records: joined };
}

/** The viewer's days by date, each month worked out once, on demand. */
interface DayLookup {
  /** *Moj raspored*'s day on `date`; a day with no shift where the month has none. */
  on(date: string): CalendarDay;
}

/**
 * The viewer's day list, month by month, as *Moj raspored* builds it: one
 * `calendarDayListOf` per month, over the member-shaped marks — no
 * collision, the viewer's own leave alone.
 */
function dayLookupOf(snapshot: CalendarSnapshot, today: string, records: readonly LeaveRecord[]): DayLookup {
  const viewer = snapshot.viewer;
  const marks: CalendarMarks = {
    collisions: [],
    uncovered: [],
    leave: new Map([[viewer.memberId, records.map(({ from, to }) => ({ from, to }))]]),
    staffingLeave: null,
  };
  const months = new Map<string, ReadonlyMap<string, CalendarDay>>();

  return {
    on(date) {
      const month = monthOf(date);
      let known = months.get(month);

      if (known === undefined) {
        const list = calendarDayListOf(snapshot, viewer, month, today, marks);

        known = new Map((list ?? []).map((day) => [day.date, day]));
        months.set(month, known);
      }

      // A month with no shift on any date: `calendarDayListOf` answers `null`,
      // and the day is a day with no shift.
      return (
        known.get(date) ?? {
          date,
          dayMonth: dayMonthOf(date),
          weekday: weekdayOf(date),
          isToday: date === today,
          shifts: [],
          inactive: !activeOn(viewer.statuses, date),
        }
      );
    },
  };
}

/**
 * The viewer's team on `date` from the snapshot: their membership version in
 * effect then (the domain's `membershipOn`, as the member list judges it),
 * named from the snapshot's teams; `null` for no team.
 *
 * @throws RangeError on any precondition of `membershipOn`, or for a team the
 *   snapshot does not carry.
 */
export function ownTeamOf(snapshot: CalendarSnapshot, date: string): MemberTeam | null {
  const membership = membershipOn(snapshot.viewer.memberships, date);

  if (membership === null) return null;

  const team = snapshot.teams.find((candidate) => candidate.id === membership.teamId);

  if (team === undefined) throw new RangeError(`the team ${membership.teamId} is not in the snapshot`);

  return { id: team.id, name: team.name };
}

/** A day's shift as today states it, its team named; `fromYesterday` for a carried-over one. */
function todayShiftOf(
  snapshot: CalendarSnapshot,
  shift: CalendarDay['shifts'][number],
  fromYesterday = false,
): TodayShift {
  const team = snapshot.teams.find((candidate) => candidate.id === shift.teamId);

  if (team === undefined) throw new RangeError(`the team ${shift.teamId} is not in the snapshot`);

  return { teamId: shift.teamId, teamName: team.name, name: shift.cell.name, range: shift.cell.range, fromYesterday };
}

/** Whether a shift of a day is a working one. */
function isWorking(working: ReadonlySet<string>, shift: CalendarDay['shifts'][number]): boolean {
  return shift.cell.shiftTypeId !== null && working.has(shift.cell.shiftTypeId);
}

/** A half day today (story 13.7): the line's facts, whether the date holds a working shift, and the worked half's times. */
interface HalfWork {
  readonly half: TodayHalf;
  /** Whether the date holds a working shift: the working case. Without one, the leave case names the half. */
  readonly atWork: boolean;
  /**
   * Whether the date holds the one working shift a half splits: its row then
   * shows {@link range}. With two, no half is split and each row keeps its
   * whole times.
   */
  readonly split: boolean;
  /** `14:00–20:00`, or `null` when the snapshot holds no times for the shift that date. */
  readonly range: string | null;
}

/**
 * The half day of the own record covering `day` (story 13.7): its type, its
 * absent half, its cost — `leaveRangeCostOf`, 0.5 on a working date, when its
 * type draws — whether the date still holds a working shift, and, on the one
 * working shift a half splits (`leaveHalfOptionsOf`, over `halfDayShiftOf`
 * and `shiftHalvesOf`), the times of the half worked. `null` when no half-day
 * record covers the date.
 *
 * @throws RangeError on any precondition of the domain.
 */
function halfWorkOf(
  snapshot: CalendarSnapshot,
  records: readonly LeaveRecord[],
  day: CalendarDay,
  working: ReadonlySet<string>,
  typeName: string,
): HalfWork | null {
  const record = leaveOn(records, day.date);

  if (record === null || record.half === undefined || record.half === null) return null;

  const atWork = day.shifts.some((shift) => isWorking(working, shift));
  const input = memberScheduleInputOf(snapshot, snapshot.viewer);
  const options = atWork ? leaveHalfOptionsOf(snapshot, input, day.date) : null;
  const times = options?.find((option) => option.half !== record.half)?.times ?? null;

  return {
    half: {
      typeName,
      half: record.half,
      costDays: record.drawsAllowance ? leaveRangeCostOf(input, record) : 0,
    },
    atWork,
    split: options !== null,
    range: times === null ? null : `${times.from}${RANGE_DASH}${times.to}`,
  };
}

/** A shift's row on a half day (story 13.7): the worked half's times in place of the whole shift's, where one is split. */
function halfShiftOf(shift: TodayShift, halfWork: HalfWork | null): TodayShift {
  return halfWork === null || !halfWork.split ? shift : { ...shift, range: halfWork.range };
}

/** `{ half }` for the working or duty case on a half day, `{}` otherwise, so a whole day never gains the key. */
function halfCaseFieldOf(halfWork: HalfWork | null): { readonly half?: TodayHalf } {
  return halfWork === null ? {} : { half: halfWork.half };
}

/**
 * The stored name of the type of the own record covering `date` (story
 * 13.2b), or null when no record covers it, the snapshot holds no type
 * catalog, or the catalog lacks the record's type.
 */
function leaveTypeNameOn(snapshot: CalendarSnapshot, records: readonly LeaveRecord[], date: string): string | null {
  const record = leaveOn(records, date);
  const types = absenceTypesOfCalendar(snapshot);

  if (record === null || types === null) return null;

  return types.find((type) => type.id === record.absenceTypeId)?.name ?? null;
}

/**
 * Today's one case: leave first, then working, then free. The leave's cost is
 * the domain's `leaveRangeCostOf` over the viewer's schedule, each joined
 * DRAWING record (story 13.2b) costed on its own range with its half (story
 * 13.5), never the merged one; the
 * leave names today's record's type, `typeName`.
 *
 * @throws RangeError on any precondition of `leaveRangeCostOf`.
 */
function todayCaseOf(
  snapshot: CalendarSnapshot,
  day: CalendarDay,
  leave: Absence | null,
  working: ReadonlySet<string>,
  records: readonly LeaveRecord[],
  typeName: string,
): TodayCase {
  if (leave !== null) {
    const from = formatIsoDate(leave.from);
    const to = formatIsoDate(leave.to);

    if (from === null || to === null) throw new RangeError(`the leave ${leave.from}–${leave.to} could not be formatted`);

    const input = memberScheduleInputOf(snapshot, snapshot.viewer);
    // The absence's joined records are exactly the own records inside it; only the drawing ones cost.
    const drawing = records.filter((record) => leave.from <= record.from && record.to <= leave.to && record.drawsAllowance);
    // A half day costs 0.5 (story 13.5).
    const costDays = drawing.reduce((sum, record) => sum + leaveRangeCostOf(input, record), 0);

    // STORY 13.7: a stored half whose shift is gone keeps its half, and says no cost.
    return { kind: CASE_LEAVE, from, to, typeName, costDays, ...halfFieldOf(leave) };
  }

  const shifts = day.shifts.filter((shift) => isWorking(working, shift));

  if (shifts.length > 0) {
    return { kind: CASE_WORKING, shifts: shifts.map((shift) => todayShiftOf(snapshot, shift)) };
  }

  const free = day.shifts[0];

  return { kind: CASE_FREE, shift: free === undefined ? null : todayShiftOf(snapshot, free), inactive: day.inactive };
}

/** No leg to skip: today is no duty. */
const NO_LEGS: ReadonlySet<string> = new Set();

/**
 * The first date after today, at most {@link NEXT_SHIFT_HORIZON_DAYS} days
 * on, with a working shift that the viewer's own leave does not cover — its
 * first such shift, the own team's before any a roster override added. A
 * leg of today's duty (`skip`, by `legKeyOf`) is today's, never the next
 * shift (story 6.2).
 */
function nextShiftOf(
  days: DayLookup,
  today: string,
  records: readonly LeaveRecord[],
  working: ReadonlySet<string>,
  skip: ReadonlySet<string>,
): NextShift | null {
  let date = today;

  for (let inDays = 1; inDays <= NEXT_SHIFT_HORIZON_DAYS; inDays += 1) {
    date = dayAfter(date);

    // A half day is a working day (story 13.7): its shift can be the next one.
    if (wholeLeaveOn(records, date) !== null) continue;

    const shift = days
      .on(date)
      .shifts.find((candidate) => isWorking(working, candidate) && !skip.has(legKeyOf(date, candidate.teamId)));

    if (shift !== undefined && shift.cell.name !== null) {
      return { ...todayDateOf(date), inDays, name: shift.cell.name, range: shift.cell.range };
    }
  }

  return null;
}

/** Today + 1 through today + {@link WEEK_DAYS}, across a month boundary as it falls. */
function weekOf(days: DayLookup, today: string, records: readonly LeaveRecord[]): readonly TodayWeekDay[] {
  const week: TodayWeekDay[] = [];
  let date = today;

  for (let index = 0; index < WEEK_DAYS; index += 1) {
    date = dayAfter(date);
    // A half day is a working day (story 13.7), never a day of leave in the week.
    week.push({ day: days.on(date), onLeave: wholeLeaveOn(records, date) !== null });
  }

  return week;
}

/** The heading's subline, `četvrtak, 01.10.2026`: today's date once the snapshot names it, else `null`. */
export function todayDateShownOf(today: Today): TodayDate | null {
  if (today.kind === TODAY_READY) return today.view.today;
  if (today.kind === TODAY_UNSCHEDULED) return today.today;

  return null;
}

/** The absent half as the half-day line names it, lower case (story 13.7). */
export function todayHalfMessageKey(half: LeaveHalf): 'danas.today.halfFirst' | 'danas.today.halfSecond' {
  return half === LEAVE_HALF_FIRST ? 'danas.today.halfFirst' : 'danas.today.halfSecond';
}

/** The half-day line: with its cost when the type draws, or ending at the half (story 13.7). */
export function todayHalfLineMessageKey(half: Pick<TodayHalf, 'costDays'>): 'danas.today.halfLeaveCost' | 'danas.today.halfLeave' {
  return half.costDays === 0 ? 'danas.today.halfLeave' : 'danas.today.halfLeaveCost';
}

/** The sentence today's case is stated in; a duty states itself in its duty-block. Exhaustive. */
export function todayCaseMessageKey(
  kind: Exclude<TodayCase['kind'], typeof CASE_DUTY>,
): 'danas.today.leave' | 'danas.today.working' | 'danas.today.free' {
  switch (kind) {
    case CASE_LEAVE:
      return 'danas.today.leave';
    case CASE_WORKING:
      return 'danas.today.working';
    case CASE_FREE:
      return 'danas.today.free';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}

/** The next shift's heading: the return from leave, or the next shift. */
export function nextShiftHeadingMessageKey(returning: boolean): 'danas.next.returnHeading' | 'danas.next.heading' {
  return returning ? 'danas.next.returnHeading' : 'danas.next.heading';
}

/** The line a screen with no case shows in its place. Exhaustive. */
export function todayMessageKey(
  kind: typeof TODAY_UNAVAILABLE | typeof TODAY_UNSCHEDULED,
): 'danas.unavailable' | 'danas.unscheduled' {
  if (kind === TODAY_UNSCHEDULED) return 'danas.unscheduled';
  if (kind === TODAY_UNAVAILABLE) return 'danas.unavailable';

  const unhandled: never = kind;

  return unhandled;
}

/** The viewer's team today once the snapshot answers it — the admin subtitle's link — else `null`. */
export function ownTeamShownOf(today: Today): MemberTeam | null {
  return today.kind === TODAY_READY ? today.view.ownTeam : null;
}
