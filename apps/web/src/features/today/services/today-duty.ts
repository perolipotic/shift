import {
  DUTY_DONE,
  DUTY_RUNNING,
  DUTY_UPCOMING,
  absoluteMinuteOf,
  dutiesOf,
  dutyProgressOf,
  momentOf,
  type Duty,
  type DutyLeg,
  type DutyPhase,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  dayMonthOf,
  rosterStandingOfCalendar,
  shiftLegOn,
  weekdayOf,
  type CalendarDay,
  type CalendarDayShift,
} from '@/features/calendar/utils/month';
import { durationMessageKey, durationValuesOf, type DurationValues } from '@/features/hour-bands/services/list';
import { formatMinuteOfDay, nextIsoDate, previousIsoDate, type WallClock } from '@/lib/i18n/format';

/**
 * Today's 24 h duty (story 6.2): the viewer's working shifts that touch, read
 * as one duty-block on *Danas* — PRESENTATION ONLY. The data stays two
 * scheduled shifts on their own dates, and nothing here is stored.
 *
 * THE CALENDAR'S DAYS. Every candidate leg is a working shift of
 * `calendarDayListOf`'s day list — *Kalendar*'s own day, through the lookup
 * `today.ts` hands in — on a date the viewer's own leave does not cover. Its
 * minutes are the type's version on that date (`shiftLegOn`, the calendar's
 * one leg recipe), as the day's own range is. The grouping and the
 * progress are the domain's `dutiesOf` and `dutyProgressOf`.
 *
 * THE WINDOW is yesterday through tomorrow, widened a day at a time while a
 * duty touches its edge — or, at the start, while yesterday's edge holds a
 * leg running now — at most {@link DUTY_WINDOW_MAX_DAYS} days each way.
 *
 * TODAY'S DUTY is the one running now; when none is, the earliest UPCOMING
 * duty with a leg dated today, and only then the earliest DONE one — a duty
 * that ended this morning never hides the one that starts tonight. A duty
 * running now whose legs are all dated yesterday is still today's. Codes,
 * data and formatted parts only; the components translate.
 */

/** How far the window may widen from today, in days, each way. */
export const DUTY_WINDOW_MAX_DAYS = 7;

/** The viewer's own team's shift. */
export const NOTE_OWN = 'own';
/** Another team's shift, through a roster override that took a member off it. */
export const NOTE_REPLACING = 'replacing';
/** Another team's shift, through a roster override that took nobody off it. */
export const NOTE_ADDED = 'added';

/** What a leg says beside its type: whose shift it is. */
export type DutyLegNote =
  | { readonly kind: typeof NOTE_OWN; readonly team: string }
  | {
      readonly kind: typeof NOTE_REPLACING;
      readonly team: string;
      /** The member replaced, in the nominative: names are not declined. */
      readonly member: string;
    }
  | { readonly kind: typeof NOTE_ADDED; readonly team: string };

/** A duration as `durationMessageKey` reads it: `9 h 50 min`. */
export interface DutyDuration {
  readonly key: ReturnType<typeof durationMessageKey>;
  readonly values: DurationValues;
}

/** One end of the duty as the screen states it. */
export interface DutyPoint {
  /** `petak` */
  readonly weekday: string;
  /** `02.10.` */
  readonly dayMonth: string;
  /** `07:00` */
  readonly time: string;
}

/** One leg: one scheduled shift of the duty. */
export interface TodayDutyLeg {
  readonly state: DutyPhase;
  readonly name: string;
  /** `07:00–19:00`, the day list's own range. */
  readonly range: string | null;
  readonly note: DutyLegNote;
}

/** Today's duty, worked out at one minute. */
export interface TodayDuty {
  readonly phase: DutyPhase;
  readonly totalMinutes: number;
  readonly elapsedMinutes: number;
  readonly total: DutyDuration;
  readonly elapsed: DutyDuration;
  readonly remaining: DutyDuration;
  readonly start: DutyPoint;
  readonly end: DutyPoint;
  readonly legs: readonly TodayDutyLeg[];
}

/** What the duty is read from: `today.ts`'s day lookup, its leave and its working types. */
export interface DutySources {
  /** *Moj raspored*'s day on `date`. */
  on(date: string): CalendarDay;
  /** Whether the viewer's own leave covers `date`. */
  onLeave(date: string): boolean;
  /** The ids of the working shift types. */
  readonly working: ReadonlySet<string>;
}

/** Today's duty, and the key of each of its legs (`legKeyOf`), for the next shift to skip. */
export interface TodayDutyFound {
  readonly duty: TodayDuty;
  readonly legKeys: ReadonlySet<string>;
}

/** A leg with the day list's shift it is. */
interface ShiftLeg extends DutyLeg {
  readonly shift: CalendarDayShift;
}

/** The key a scheduled shift is known by: its date and its team. */
export function legKeyOf(date: string, teamId: string): string {
  return `${date}\u0000${teamId}`;
}

/** The day before `date`. @throws RangeError at the start of the calendar. */
function dayBefore(date: string): string {
  const previous = previousIsoDate(date);

  if (previous === null) throw new RangeError(`the date ${date} has no previous day`);

  return previous;
}

/** The day after `date`. @throws RangeError at the end of the calendar. */
function dayAfter(date: string): string {
  const next = nextIsoDate(date);

  if (next === null) throw new RangeError(`the date ${date} has no next day`);

  return next;
}

/**
 * The working shifts of `date` as legs, each with its version's minutes; a
 * date own leave covers has none, and a shift whose type has no version in
 * effect has no times and is no leg.
 *
 * @throws RangeError on any precondition of `shiftTypeVersionOn`, or a type
 *   the snapshot lacks.
 */
function legsOn(snapshot: CalendarSnapshot, sources: DutySources, date: string): readonly ShiftLeg[] {
  if (sources.onLeave(date)) return [];

  const legs: ShiftLeg[] = [];

  for (const shift of sources.on(date).shifts) {
    const typeId = shift.cell.shiftTypeId;

    if (typeId === null || !sources.working.has(typeId)) continue;

    const leg = shiftLegOn(snapshot, typeId, date);

    if (leg === null) continue;

    legs.push({ ...leg, shift });
  }

  return legs;
}

/** Whether `leg` runs at the absolute minute `now`. */
function runsAt(leg: DutyLeg, now: number): boolean {
  const start = absoluteMinuteOf(leg.date, leg.startMinute);

  return start <= now && now < start + leg.durationMinutes;
}

/** A duration for `durationMessageKey`. */
function durationOf(minutes: number): DutyDuration {
  return { key: durationMessageKey(minutes), values: durationValuesOf(minutes) };
}

/** An absolute minute as the screen states it. */
function pointOf(absolute: number): DutyPoint {
  const { date, minute } = momentOf(absolute);

  return { weekday: weekdayOf(date), dayMonth: dayMonthOf(date), time: formatMinuteOfDay(minute) };
}

/**
 * Whose shift a leg is: the own team's, a replacement for the member a
 * roster override in force took off it, or an added shift — which is also
 * what a replacement reads as when the snapshot does not name the member
 * replaced: one missing name never blanks *Danas*.
 *
 * Exported for its test alone: the day list and this read the same member
 * list, so a replaced member it lacks cannot reach here through a duty.
 *
 * @throws RangeError for a team the snapshot lacks.
 */
export function legNoteOf(
  snapshot: CalendarSnapshot,
  leg: { readonly date: string; readonly shift: CalendarDayShift },
): DutyLegNote {
  const { teamId, viaOverride } = leg.shift;
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);

  if (team === undefined) throw new RangeError(`the team ${teamId} is not in the snapshot`);

  if (!viaOverride) return { kind: NOTE_OWN, team: team.name };

  const replaced = rosterStandingOfCalendar(snapshot).inForce.find(
    (override) =>
      override.teamId === teamId &&
      override.date === leg.date &&
      override.memberInId === snapshot.viewer.memberId &&
      override.memberOutId !== null,
  );

  const memberOutId = replaced?.memberOutId ?? null;

  if (memberOutId === null) return { kind: NOTE_ADDED, team: team.name };

  const member = snapshot.members.find((candidate) => candidate.id === memberOutId);

  if (member === undefined) return { kind: NOTE_ADDED, team: team.name };

  return { kind: NOTE_REPLACING, team: team.name, member: member.name };
}

/**
 * Today's duty at `now`, the organization's wall clock: the duty running
 * now, else the earliest with a leg dated `today`; `null` when neither
 * exists, and today is a shift, a free day or leave as before.
 *
 * @throws RangeError on any precondition of the domain's or the calendar's
 *   derivations.
 */
export function todayDutyOf(
  snapshot: CalendarSnapshot,
  sources: DutySources,
  today: string,
  now: WallClock,
): TodayDutyFound | null {
  const nowMinute = absoluteMinuteOf(now.date, now.minute);
  const byDate = new Map<string, readonly ShiftLeg[]>();
  const at = (date: string): readonly ShiftLeg[] => {
    let known = byDate.get(date);

    if (known === undefined) {
      known = legsOn(snapshot, sources, date);
      byDate.set(date, known);
    }

    return known;
  };
  const between = (from: string, to: string): ShiftLeg[] => {
    const legs: ShiftLeg[] = [];

    for (let date = from; date <= to; date = dayAfter(date)) legs.push(...at(date));

    return legs;
  };

  let from = dayBefore(today);
  let to = dayAfter(today);
  let duties = dutiesOf(between(from, to));
  const touches = (date: string): boolean => duties.some((duty) => duty.legs.some((leg) => leg.date === date));

  // Backwards: a duty on the edge, or a leg of the edge running now that may
  // be the last of a duty begun before it.
  for (let widened = 1; widened < DUTY_WINDOW_MAX_DAYS; widened += 1) {
    if (!touches(from) && !at(from).some((leg) => runsAt(leg, nowMinute))) break;

    from = dayBefore(from);
    duties = dutiesOf(between(from, to));
  }

  for (let widened = 1; widened < DUTY_WINDOW_MAX_DAYS; widened += 1) {
    if (!touches(to)) break;

    to = dayAfter(to);
    duties = dutiesOf(between(from, to));
  }

  const phaseOf = (duty: Duty<ShiftLeg>) => dutyProgressOf(duty, nowMinute).phase;
  const running = duties.find((duty) => phaseOf(duty) === DUTY_RUNNING);
  const todays = duties.filter((duty) => duty.legs.some((leg) => leg.date === today));
  // `dutiesOf` answers in start order, so the first of each phase is the earliest.
  const chosen =
    running ??
    todays.find((duty) => phaseOf(duty) === DUTY_UPCOMING) ??
    todays.find((duty) => phaseOf(duty) === DUTY_DONE);

  return chosen === undefined ? null : foundOf(snapshot, chosen, nowMinute);
}

/**
 * Yesterday's working shifts still running at `now`, the organization's wall
 * clock (the lone-Noć carry-over): the legs of yesterday by the duty's own
 * recipe (`legsOn`, so a date own leave covers has none), each running on
 * its half-open `[start, start + duration)`. The case and the duty read the
 * same legs, so they can never disagree. A leg that touches another is a
 * duty's (`dutiesOf`), and a running duty comes first; this is only ever
 * read after it.
 *
 * @throws RangeError on any precondition of `shiftLegOn`, or at the start of
 *   the calendar.
 */
export function runningFromYesterdayOf(
  snapshot: CalendarSnapshot,
  sources: DutySources,
  today: string,
  now: WallClock,
): readonly CalendarDayShift[] {
  const nowMinute = absoluteMinuteOf(now.date, now.minute);

  return legsOn(snapshot, sources, dayBefore(today))
    .filter((leg) => runsAt(leg, nowMinute))
    .map((leg) => leg.shift);
}

/** The chosen duty as the screen states it. */
function foundOf(snapshot: CalendarSnapshot, duty: Duty<ShiftLeg>, nowMinute: number): TodayDutyFound {
  const progress = dutyProgressOf(duty, nowMinute);
  const legs = duty.legs.map((leg, index): TodayDutyLeg => {
    const { name, range } = leg.shift.cell;

    if (name === null) throw new RangeError(`the shift on ${leg.date} has no type name`);

    return { state: progress.legs[index] ?? DUTY_UPCOMING, name, range, note: legNoteOf(snapshot, leg) };
  });

  return {
    duty: {
      phase: progress.phase,
      totalMinutes: duty.totalMinutes,
      elapsedMinutes: progress.elapsedMinutes,
      total: durationOf(duty.totalMinutes),
      elapsed: durationOf(progress.elapsedMinutes),
      remaining: durationOf(progress.remainingMinutes),
      start: pointOf(duty.startMinute),
      end: pointOf(duty.endMinute),
      legs,
    },
    legKeys: new Set(duty.legs.map((leg) => legKeyOf(leg.date, leg.shift.teamId))),
  };
}

/**
 * The date the end line names: the END's while the duty runs (`petak,
 * 02.10. · još 9 h 50 min`), the START's before it begins (`četvrtak,
 * 01.10. · počinje u 07:00`). A duty done has no end line.
 */
export function endLinePointOf(duty: TodayDuty): DutyPoint {
  return duty.phase === DUTY_UPCOMING ? duty.start : duty.end;
}

/** The duty's headline: until its end, or that it ended. Exhaustive. */
export function dutyHeadlineMessageKey(phase: DutyPhase): 'danas.duty.until' | 'danas.duty.ended' {
  switch (phase) {
    case DUTY_UPCOMING:
    case DUTY_RUNNING:
      return 'danas.duty.until';
    case DUTY_DONE:
      return 'danas.duty.ended';
    default: {
      const unhandled: never = phase;

      return unhandled;
    }
  }
}

/** The line under the headline: what remains, or when it starts. A duty done has none. Exhaustive. */
export function dutyEndLineMessageKey(
  phase: typeof DUTY_UPCOMING | typeof DUTY_RUNNING,
): 'danas.duty.remaining' | 'danas.duty.startsAt' {
  if (phase === DUTY_RUNNING) return 'danas.duty.remaining';
  if (phase === DUTY_UPCOMING) return 'danas.duty.startsAt';

  const unhandled: never = phase;

  return unhandled;
}

/** A leg's state in words. Exhaustive. */
export function dutyLegStateMessageKey(
  state: DutyPhase,
): 'danas.duty.legDone' | 'danas.duty.legRunning' | 'danas.duty.legUpcoming' {
  switch (state) {
    case DUTY_DONE:
      return 'danas.duty.legDone';
    case DUTY_RUNNING:
      return 'danas.duty.legRunning';
    case DUTY_UPCOMING:
      return 'danas.duty.legUpcoming';
    default: {
      const unhandled: never = state;

      return unhandled;
    }
  }
}

/** Whose shift a leg is, in words. Exhaustive. */
export function dutyNoteMessageKey(
  kind: DutyLegNote['kind'],
): 'danas.duty.noteOwn' | 'danas.duty.noteReplacing' | 'danas.duty.noteAdded' {
  switch (kind) {
    case NOTE_OWN:
      return 'danas.duty.noteOwn';
    case NOTE_REPLACING:
      return 'danas.duty.noteReplacing';
    case NOTE_ADDED:
      return 'danas.duty.noteAdded';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}
