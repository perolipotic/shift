import { collisionKeyOf, erasedCollisionsOf, scheduledShiftTypeOn } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayMonthOf, overrideStandingOfCalendar, weekdayOf, workingShiftTypeIdsOf } from '@/features/calendar/utils/month';
import { collisionInputOf, resolutionsOf } from '@/features/conflicts/services/conflicts-queue';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { instantMicrosOf } from '@/features/rotation/services/list';
import { compareText } from '@/lib/i18n/format';

/**
 * THE ERASURE GUARD, SURFACE-NEUTRAL (stories 5.5a, 5.5b; AD-5, UX-DR23), as
 * a pure view model in a `.ts` that renders nothing (AD-15).
 *
 * A CONFIGURATION CHANGE CAN QUIETLY ERASE A DECISION. When it makes a member
 * stop working a date they are on leave, the unresolved conflict on that date
 * disappears from the queue though nobody decided it. Before such a change
 * writes, this derives which ones would go, and the surface asks the admin to
 * confirm each.
 *
 * ONE DIFF FOR EVERY SURFACE ({@link erasuresOf}). "Before" is the calendar
 * snapshot as read; "after" is the same snapshot as the change would leave it,
 * which is each surface's own to build (the rotation builder's draft, a
 * calendar roster change). Both go through the one collision recipe the
 * queue uses (`collisionInputOf`) and the live resolutions; the domain
 * (`erasedCollisionsOf`) bounds both to the leave from the change's date on.
 *
 * NOTHING IS WRITTEN. An erasure is confirmed, never recorded: the conflict
 * goes because its cause does.
 *
 * NEVER A PARTIAL ANSWER. A row that cannot be trusted, and any `RangeError`
 * of the derivation, refuse the whole check ({@link erasuresOutcomeOf}); the
 * surface then writes nothing unchecked.
 */

/** The check could not be derived: the change is refused, with a retry. */
export const ERASURES_UNAVAILABLE = 'unavailable';

/** One conflict the change would erase, as the confirmation dialog lists it. */
export interface ErasureRow {
  /** `collisionKeyOf`'s key: what a decision on this row is held by. */
  readonly key: string;
  readonly memberId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly teamId: string;
  readonly memberName: string;
  readonly teamName: string;
  /** `petak`. */
  readonly weekday: string;
  /** `06.11.`. */
  readonly dayMonth: string;
  /** The shift type the team works on the date before the change. */
  readonly shiftTypeName: string;
  /**
   * Whether the team still works a shift on the date after the change: then
   * the member is no longer on it ("taj dan bez {member}"); otherwise the
   * team is free that day ("taj dan slobodna").
   */
  readonly teamWorks: boolean;
}

/**
 * The latest instant the snapshot holds, in epoch microseconds: every
 * rotation version's save stamp, every shift-type override's
 * `confirmedAt ?? createdAt`, and every roster override's `createdAt`. `0`
 * when it holds none. What an "after" snapshot stamps its change newer than,
 * so the change stands as a real write would make it (`overrideStandingOf`).
 */
export function latestInstantOf(calendar: CalendarSnapshot): number {
  const instants: readonly (number | null)[] = [
    ...calendar.assignmentStamps.map((stamp) => stamp.createdAt),
    ...calendar.overrides.map((override) => instantMicrosOf(override.confirmedAt ?? override.createdAt)),
    ...calendar.rosterOverrides.map((override) => instantMicrosOf(override.createdAt)),
  ];

  // A REDUCE, not a spread into `Math.max`: an organization's every override
  // must never meet the engine's argument limit.
  return instants.reduce<number>(
    (most, instant) => (instant !== null && Number.isSafeInteger(instant) && instant > most ? instant : most),
    0,
  );
}

const MICROS_PER_SECOND = 1_000_000;
const SECONDS_PER_DAY = 86_400;
const MICRO_DIGITS = 6;

/** Two digits, zero-padded. */
function two(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The proleptic Gregorian `[year, month, day]` of `days` since 1970-01-01, by
 * arithmetic alone (H. Hinnant's `civil_from_days`): no `Date`, no device
 * zone, nothing formatted for a reader.
 */
function civilOf(days: number): readonly [number, number, number] {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth < 10 ? shiftedMonth + 3 : shiftedMonth - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);

  return [year, month, day];
}

/**
 * An epoch-microsecond instant written as the database answers one, in UTC —
 * `2026-11-06T08:00:00.000001Z` — so `instantMicrosOf` reads it back exactly.
 * A machine value for an "after" snapshot, never shown to anyone.
 *
 * @throws RangeError when `micros` is not a non-negative safe integer.
 */
export function isoInstantOf(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new RangeError(`${String(micros)} is not an instant (µs)`);

  const seconds = Math.floor(micros / MICROS_PER_SECOND);
  const fraction = String(micros % MICROS_PER_SECOND).padStart(MICRO_DIGITS, '0');
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const ofDay = seconds - days * SECONDS_PER_DAY;
  const [year, month, day] = civilOf(days);
  const time = `${two(Math.floor(ofDay / 3600))}:${two(Math.floor((ofDay % 3600) / 60))}:${two(ofDay % 60)}`;

  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}T${time}.${fraction}Z`;
}

/** Two rows by date, then team name, then member name, under the Croatian collation. */
function byDateAndTeam(first: ErasureRow, second: ErasureRow): number {
  if (first.date !== second.date) return first.date < second.date ? -1 : 1;

  return compareText(first.teamName, second.teamName) || compareText(first.memberName, second.memberName);
}

/**
 * Every unresolved conflict of `before` that `after` no longer raises, from
 * `from` on, ordered by date and then team, from the organization's leave and
 * resolution rows as read. Empty when the change erases none. Whether the
 * team still works is `after`'s own — its versions, steps and shift-type
 * overrides in force, organization-wide — never any member's schedule.
 *
 * @throws RangeError when a leave or resolution row cannot be trusted, on any
 *   precondition of the domain's derivation, or when an erasure names a
 *   member, team or shift type the snapshot lacks, or a date that cannot be
 *   formatted.
 */
export function erasuresOf(
  before: CalendarSnapshot,
  after: CalendarSnapshot,
  from: string,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): readonly ErasureRow[] {
  const records = organizationLeaveRecordsOf(
    recordRows,
    before.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  // ONE LIST FOR BOTH SIDES (story 5.5d): `resolutionsOf(before, …)` now
  // filters — it drops every replacement `before` holds pending or inert —
  // and that one list is matched against both sides, so a replacement that
  // does not apply before the change hides nothing on either side, and a
  // change that makes it apply again erases nothing.
  const erased = erasedCollisionsOf(
    collisionInputOf(before, records),
    collisionInputOf(after, records),
    resolutionsOf(before, resolutionRows),
    from,
  );

  if (erased.length === 0) return [];

  const members = new Map(before.members.map((member) => [member.id, member.name]));
  const teams = new Map(before.teams.map((team) => [team.id, team.name]));
  const types = new Map(before.types.map((type) => [type.id, type]));
  const inForce = overrideStandingOfCalendar(after).inForce;
  const working = new Set(workingShiftTypeIdsOf(after));

  return erased
    .map((collision): ErasureRow => {
      const memberName = members.get(collision.memberId);
      const teamName = teams.get(collision.teamId);
      const type = types.get(collision.shiftTypeId);

      if (memberName === undefined) throw new RangeError(`member ${collision.memberId} is not in the snapshot`);
      if (teamName === undefined) throw new RangeError(`team ${collision.teamId} is not in the snapshot`);
      if (type === undefined) throw new RangeError(`shift type ${collision.shiftTypeId} is not in the snapshot`);

      const now = scheduledShiftTypeOn(
        after.assignments.filter((assignment) => assignment.teamId === collision.teamId),
        after.steps,
        inForce,
        collision.teamId,
        collision.date,
      );

      return {
        key: collisionKeyOf(collision),
        memberId: collision.memberId,
        date: collision.date,
        teamId: collision.teamId,
        memberName,
        teamName,
        weekday: weekdayOf(collision.date),
        dayMonth: dayMonthOf(collision.date),
        shiftTypeName: type.name,
        teamWorks: now !== null && working.has(now.shiftTypeId),
      };
    })
    .sort(byDateAndTeam);
}

export type ErasuresOutcome =
  | { readonly ok: true; readonly rows: readonly ErasureRow[] }
  | { readonly ok: false; readonly code: typeof ERASURES_UNAVAILABLE };

/**
 * `derive`'s rows, GUARDED as the queue is: a `RangeError` refuses the whole
 * check — never a partial list — and is logged. Anything else is rethrown.
 */
export function erasuresOutcomeOf(derive: () => readonly ErasureRow[]): ErasuresOutcome {
  try {
    return { ok: true, rows: derive() };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(ERASURES_UNAVAILABLE, cause);

    return { ok: false, code: ERASURES_UNAVAILABLE };
  }
}

/** Everything a row shows, as one comparable string. */
function shownOf(row: ErasureRow): string {
  return JSON.stringify([row.key, row.memberName, row.teamName, row.weekday, row.dayMonth, row.shiftTypeName, row.teamWorks]);
}

/**
 * Whether two checks list the same conflicts AS SHOWN: the same keys, and on
 * each the same names, date, shift type and whether the team still works. The
 * dialog's decisions stand only while they do; a row that reads differently
 * was not the one decided.
 */
export function sameErasuresOf(first: readonly ErasureRow[], second: readonly ErasureRow[]): boolean {
  const shown = new Set(first.map(shownOf));

  return first.length === second.length && shown.size === second.length && second.every((row) => shown.has(shownOf(row)));
}

/** A re-derivation lists the same conflicts as shown, or none any more: the write may go. */
export const RECHECK_PROCEED = 'proceed';
/** A re-derivation lists other conflicts: the list is shown again, every row undecided. */
export const RECHECK_CHANGED = 'changed';

export type Recheck = typeof RECHECK_PROCEED | typeof RECHECK_CHANGED;

/**
 * THE FRESHNESS RULE of a confirmation (5.5a, carried to 5.5b): the rows a
 * re-derivation answers, against the rows the admin decided.
 */
export function recheckOf(decided: readonly ErasureRow[], fresh: readonly ErasureRow[]): Recheck {
  return fresh.length > 0 && !sameErasuresOf(decided, fresh) ? RECHECK_CHANGED : RECHECK_PROCEED;
}

/**
 * The ids a confirmation's title, lede and kept hint carry, from the prefix
 * its surface names: `{id}-title`, `{id}-lede`, `{id}-kept`.
 */
export function erasureDialogIdsOf(id: string): { readonly title: string; readonly lede: string; readonly kept: string } {
  return { title: `${id}-title`, lede: `${id}-lede`, kept: `${id}-kept` };
}

// ------------------------------------------------------------ the decisions

/** "Potvrdi brisanje": the admin lets this conflict go with the change. */
export const ERASURE_CONFIRMED = 'confirmed';
/** "Zadrži": the admin keeps this conflict, so the change cannot be saved as it is. */
export const ERASURE_KEPT = 'kept';

export type ErasureDecision = typeof ERASURE_CONFIRMED | typeof ERASURE_KEPT;

/** Each row's decision by key; a row with none is undecided. Nothing is preselected. */
export type ErasureDecisions = Readonly<Record<string, ErasureDecision>>;

/** Whether the change may go ahead: every row is confirmed, none kept and none undecided. */
export function erasuresConfirmedOf(rows: readonly ErasureRow[], decisions: ErasureDecisions): boolean {
  return rows.every((row) => decisions[row.key] === ERASURE_CONFIRMED);
}

/** Whether any row is kept: the hint then says to change the change or go back. */
export function erasureKeptOf(rows: readonly ErasureRow[], decisions: ErasureDecisions): boolean {
  return rows.some((row) => decisions[row.key] === ERASURE_KEPT);
}
