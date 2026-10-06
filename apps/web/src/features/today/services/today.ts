import { leaveCostOf, monthOf, type LeaveRange } from '@shift/domain';

import type { CalendarSnapshot, CalendarSurfaceState } from '@/features/calendar/services/snapshot';
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
import { leaveRecordsOf, type LeaveRecord } from '@/features/leave/services/leave-list';
import { legKeyOf, todayDutyOf, type TodayDuty } from '@/features/today/services/today-duty';
import { formatIsoDate, nextIsoDate, organizationWallClock } from '@/lib/i18n/format';

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
 * EXACTLY ONE CASE TODAY: on leave (wins over the rest, on a working or a
 * non-working day), on a duty (story 6.2: touching working shifts read as
 * one, `today-duty.ts`'s), working (a working shift today), or free (only
 * non-working types, or none). A viewer with no membership at all is
 * unscheduled, and has no next shift and no week.
 *
 * NEVER A GUESS. A read that failed or is paused offline is unavailable with
 * a retry; a row that cannot be trusted or any error the derivation throws
 * is unavailable without one, logged. Codes, data and formatted dates only;
 * the components translate.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** How far ahead the next working shift is looked for, in days. */
export const NEXT_SHIFT_HORIZON_DAYS = 366;

/** How many days after today the week lists. */
export const WEEK_DAYS = 7;

/** Still waiting on a read: the skeleton, never a figure. */
export const TODAY_LOADING = 'loading';
/** A read failed, or what it answered cannot be trusted: one alert, no case. */
export const TODAY_UNAVAILABLE = 'unavailable';
/** The viewer has no membership at all: their own sentence, no next shift and no week. */
export const TODAY_UNSCHEDULED = 'unscheduled';
/** Everything read: today's case, the next shift and the week. */
export const TODAY_READY = 'ready';

/** On leave today: wins over every other case. */
export const CASE_LEAVE = 'leave';
/** On a duty (story 6.2): working shifts that touch, one of them today or running now. */
export const CASE_DUTY = 'duty';
/** A working shift today. */
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
}

/** Today, as exactly one case. */
export type TodayCase =
  | {
      readonly kind: typeof CASE_LEAVE;
      /** The whole absence's first and last day, `28.09.2026`: back-to-back records read as one. */
      readonly from: string;
      readonly to: string;
      /**
       * What the absence costs in leave days (story 6.1b): the domain's
       * `leaveCostOf` over each own record it joins, each on its own range,
       * summed — only the days the viewer would have worked count.
       */
      readonly costDays: number;
    }
  | { readonly kind: typeof CASE_DUTY; readonly duty: TodayDuty }
  | { readonly kind: typeof CASE_WORKING; readonly shifts: readonly TodayShift[] }
  | {
      readonly kind: typeof CASE_FREE;
      /** The non-working type and its team, or `null` for no shift (`Bez smjene`). */
      readonly shift: TodayShift | null;
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

    if (viewer.memberships.length === 0) return { kind: TODAY_UNSCHEDULED, today: shown };

    const records = leaveRecordsOf(rows, viewer.memberId);

    if (records === null) {
      console.error(TODAY_UNAVAILABLE, 'row');

      return { kind: TODAY_UNAVAILABLE, retryable: false };
    }

    const days = dayLookupOf(snapshot, today, records);
    const working = new Set(workingShiftTypeIdsOf(snapshot));
    const leaveToday = absenceOn(records, today);
    // Leave wins: no duty is looked for on a day of leave.
    const found =
      leaveToday === null
        ? todayDutyOf(
            snapshot,
            { on: (date) => days.on(date), onLeave: (date) => leaveOn(records, date) !== null, working },
            today,
            organizationWallClock(now, snapshot.timeZone),
          )
        : null;
    const todayCase: TodayCase =
      found === null
        ? todayCaseOf(snapshot, days.on(today), leaveToday, working)
        : { kind: CASE_DUTY, duty: found.duty };

    return {
      kind: TODAY_READY,
      view: {
        today: shown,
        todayCase,
        next: nextShiftOf(days, today, records, working, found?.legKeys ?? NO_LEGS),
        returning: todayCase.kind === CASE_LEAVE,
        week: weekOf(days, today, records),
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

/** The whole absence covering a date, and the own records it joins, each with its own range. */
export interface Absence extends LeaveRange {
  readonly records: readonly LeaveRange[];
}

/**
 * The whole absence that covers `date`: the record covering it, extended
 * across every own record that overlaps it or starts the day after it ends —
 * back-to-back records are one absence, and the next shift is the return
 * after all of them — with the records it joins. `null` when no record
 * covers `date`. EXPORTED for story 6.3: *Odsutni danas* states each
 * member's absence the same way, over that member's records alone.
 */
export function absenceOn(records: readonly LeaveRecord[], date: string): Absence | null {
  const covering = leaveOn(records, date);

  if (covering === null) return null;

  const ordered = [...records].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
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
    .map((record) => ({ from: record.from, to: record.to }));

  return { from, to, records: joined };
}

/** The day after `date`. @throws RangeError at the end of the calendar. */
function dayAfter(date: string): string {
  const next = nextIsoDate(date);

  if (next === null) throw new RangeError(`the date ${date} has no next day`);

  return next;
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
        }
      );
    },
  };
}

/** A day's shift as today states it, its team named. */
function todayShiftOf(snapshot: CalendarSnapshot, shift: CalendarDay['shifts'][number]): TodayShift {
  const team = snapshot.teams.find((candidate) => candidate.id === shift.teamId);

  if (team === undefined) throw new RangeError(`the team ${shift.teamId} is not in the snapshot`);

  return { teamId: shift.teamId, teamName: team.name, name: shift.cell.name, range: shift.cell.range };
}

/** Whether a shift of a day is a working one. */
function isWorking(working: ReadonlySet<string>, shift: CalendarDay['shifts'][number]): boolean {
  return shift.cell.shiftTypeId !== null && working.has(shift.cell.shiftTypeId);
}

/**
 * Today's one case: leave first, then working, then free. The leave's cost is
 * the domain's `leaveCostOf` over the viewer's schedule, each joined
 * record costed on its own range, never the merged one.
 *
 * @throws RangeError on any precondition of `leaveCostOf`.
 */
function todayCaseOf(
  snapshot: CalendarSnapshot,
  day: CalendarDay,
  leave: Absence | null,
  working: ReadonlySet<string>,
): TodayCase {
  if (leave !== null) {
    const from = formatIsoDate(leave.from);
    const to = formatIsoDate(leave.to);

    if (from === null || to === null) throw new RangeError(`the leave ${leave.from}–${leave.to} could not be formatted`);

    const input = memberScheduleInputOf(snapshot, snapshot.viewer);
    const costDays = leave.records.reduce((sum, record) => sum + leaveCostOf(input, record.from, record.to), 0);

    return { kind: CASE_LEAVE, from, to, costDays };
  }

  const shifts = day.shifts.filter((shift) => isWorking(working, shift));

  if (shifts.length > 0) {
    return { kind: CASE_WORKING, shifts: shifts.map((shift) => todayShiftOf(snapshot, shift)) };
  }

  const free = day.shifts[0];

  return { kind: CASE_FREE, shift: free === undefined ? null : todayShiftOf(snapshot, free) };
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

    if (leaveOn(records, date) !== null) continue;

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
    week.push({ day: days.on(date), onLeave: leaveOn(records, date) !== null });
  }

  return week;
}

/** The heading's subline, `četvrtak, 01.10.2026`: today's date once the snapshot names it, else `null`. */
export function todayDateShownOf(today: Today): TodayDate | null {
  if (today.kind === TODAY_READY) return today.view.today;
  if (today.kind === TODAY_UNSCHEDULED) return today.today;

  return null;
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
