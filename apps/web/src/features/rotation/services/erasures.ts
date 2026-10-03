import { collisionKeyOf, erasedCollisionsOf, scheduledShiftTypeOn, type RotationVersionStamp } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayMonthOf, overrideStandingOfCalendar, weekdayOf, workingShiftTypeIdsOf } from '@/features/calendar/utils/month';
import { collisionInputOf, resolutionsOf } from '@/features/conflicts/services/conflicts-queue';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import { instantMicrosOf, rotationTeamsOf, type RotationSnapshot } from '@/features/rotation/services/list';
import { draftAssignmentOf, draftStepsOf, normalizedDraftOf, type RotationDraft } from '@/features/rotation/utils/draft';
import { splitTeams } from '@/features/teams/services/list';
import { compareText } from '@/lib/i18n/format';

/**
 * The rotation save's erasure guard (story 5.5a; AD-5, UX-DR23), as a pure
 * view model in a `.ts` that renders nothing (AD-15).
 *
 * A NEW ROTATION CAN QUIETLY ERASE A DECISION. When it makes a member stop
 * working a date they are on leave, the unresolved conflict on that date
 * disappears from the queue though nobody decided it. Before "Spremi
 * rotaciju" writes, this derives which ones would go, and the builder asks the
 * admin to confirm each.
 *
 * THE DIFF IS THE DOMAIN'S (`erasedCollisionsOf`). "Before" is the calendar
 * snapshot as read; "after" is the same snapshot as the save would leave it
 * ({@link draftCalendarSnapshotOf}). Both go through the one collision recipe
 * the queue uses (`collisionInputOf`) and the live resolutions; the domain
 * bounds both to the leave from the draft's effective date on.
 *
 * NOTHING IS WRITTEN. An erasure is confirmed, never recorded: the conflict
 * goes because its cause does.
 *
 * NEVER A PARTIAL ANSWER. A row that cannot be trusted, and any `RangeError`
 * of the derivation, refuse the whole check ({@link rotationErasuresOutcomeOf});
 * the builder then saves nothing unchecked.
 */

/** The check could not be derived: the save is refused, with a retry. */
export const ERASURES_UNAVAILABLE = 'unavailable';

/** One conflict the save would erase, as the confirmation dialog lists it. */
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
   * Whether the team still works a shift on the date under the new rotation:
   * then the member is no longer on it ("taj dan bez {member}"); otherwise
   * the team is free that day ("taj dan slobodna").
   */
  readonly teamWorks: boolean;
}

/**
 * The calendar snapshot as the save of `entered` would leave it (AD-5): the
 * draft's steps, one version per team the save binds — the active teams of
 * the rotation snapshot, as `saveRotation` normalizes the draft — effective
 * from the draft's date, and one save stamp per such version, NEWER than
 * every stamp and every override of the snapshot. That stamp is what makes
 * each shift-type and roster override on or after the effective date pending,
 * exactly as a real save does (`overrideStandingOf`): an override that put the
 * member on a shift no longer applies.
 *
 * A new object, so the calendar's per-snapshot standings are worked out
 * afresh for it.
 */
export function draftCalendarSnapshotOf(
  calendar: CalendarSnapshot,
  rotation: RotationSnapshot,
  entered: RotationDraft,
): CalendarSnapshot {
  const teams = rotationTeamsOf(rotation);
  const draft = normalizedDraftOf(entered, teams);
  const instants: readonly (number | null)[] = [
    ...calendar.assignmentStamps.map((stamp) => stamp.createdAt),
    ...calendar.overrides.map((override) => instantMicrosOf(override.confirmedAt ?? override.createdAt)),
    ...calendar.rosterOverrides.map((override) => instantMicrosOf(override.createdAt)),
  ];
  // A REDUCE, not a spread into `Math.max`: an organization's every override
  // must never meet the engine's argument limit.
  const latest = instants.reduce<number>(
    (most, instant) => (instant !== null && Number.isSafeInteger(instant) && instant > most ? instant : most),
    0,
  );
  const savedAt = latest + 1;
  const stamps: RotationVersionStamp[] = teams.map((team) => ({
    teamId: team.id,
    effectiveFrom: draft.effectiveFrom,
    createdAt: savedAt,
  }));

  return {
    ...calendar,
    steps: [...calendar.steps, ...draftStepsOf(draft)],
    assignments: [
      ...calendar.assignments,
      ...teams.map((team) => ({ ...draftAssignmentOf(draft, team.id), effectiveFrom: draft.effectiveFrom })),
    ],
    assignmentStamps: [...calendar.assignmentStamps, ...stamps],
  };
}

/** Two rows by date, then team name, then member name, under the Croatian collation. */
function byDateAndTeam(first: ErasureRow, second: ErasureRow): number {
  if (first.date !== second.date) return first.date < second.date ? -1 : 1;

  return compareText(first.teamName, second.teamName) || compareText(first.memberName, second.memberName);
}

/**
 * Every unresolved conflict saving `entered` would erase, ordered by date and
 * then team, from the calendar snapshot, the organization's leave and
 * resolution rows as read, and the rotation snapshot the save is built from.
 * Empty when it erases none.
 *
 * @throws RangeError when a leave or resolution row cannot be trusted, on any
 *   precondition of the domain's derivation — two versions of one team on the
 *   effective date included — or when an erasure names a member, team or
 *   shift type the snapshot lacks, or a date that cannot be formatted.
 */
export function rotationErasuresOf(
  calendar: CalendarSnapshot,
  rotation: RotationSnapshot,
  entered: RotationDraft,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): readonly ErasureRow[] {
  const records = organizationLeaveRecordsOf(
    recordRows,
    calendar.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  // ONE TEAM SET: the save binds the rotation read's active teams, and the
  // diff is the calendar read's. Two reads that disagree cannot be checked.
  const bound = new Set(rotationTeamsOf(rotation).map((team) => team.id));
  const drawn = splitTeams(calendar.teams).active.map((team) => team.id);

  if (bound.size !== drawn.length || drawn.some((id) => !bound.has(id))) {
    throw new RangeError('the rotation and the calendar disagree on the active teams');
  }

  const after = draftCalendarSnapshotOf(calendar, rotation, entered);
  const erased = erasedCollisionsOf(
    collisionInputOf(calendar, records),
    collisionInputOf(after, records),
    resolutionsOf(calendar, resolutionRows),
    entered.effectiveFrom,
  );

  if (erased.length === 0) return [];

  const members = new Map(calendar.members.map((member) => [member.id, member.name]));
  const teams = new Map(calendar.teams.map((team) => [team.id, team.name]));
  const types = new Map(calendar.types.map((type) => [type.id, type]));
  // WHETHER THE TEAM STILL WORKS is the team's own: its versions, the steps
  // and the shift-type overrides in force under the save, organization-wide —
  // never any member's schedule.
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

export type RotationErasuresOutcome =
  | { readonly ok: true; readonly rows: readonly ErasureRow[] }
  | { readonly ok: false; readonly code: typeof ERASURES_UNAVAILABLE };

/**
 * {@link rotationErasuresOf}, GUARDED as the queue is: a `RangeError` refuses
 * the whole check — never a partial list — and is logged.
 */
export function rotationErasuresOutcomeOf(
  calendar: CalendarSnapshot,
  rotation: RotationSnapshot,
  entered: RotationDraft,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): RotationErasuresOutcome {
  try {
    return { ok: true, rows: rotationErasuresOf(calendar, rotation, entered, recordRows, resolutionRows) };
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

// ------------------------------------------------------------ the decisions

/** "Potvrdi brisanje": the admin lets this conflict go with the change. */
export const ERASURE_CONFIRMED = 'confirmed';
/** "Zadrži": the admin keeps this conflict, so the change cannot be saved as it is. */
export const ERASURE_KEPT = 'kept';

export type ErasureDecision = typeof ERASURE_CONFIRMED | typeof ERASURE_KEPT;

/** Each row's decision by key; a row with none is undecided. Nothing is preselected. */
export type ErasureDecisions = Readonly<Record<string, ErasureDecision>>;

/** Whether the save may go ahead: every row is confirmed, none kept and none undecided. */
export function erasuresConfirmedOf(rows: readonly ErasureRow[], decisions: ErasureDecisions): boolean {
  return rows.every((row) => decisions[row.key] === ERASURE_CONFIRMED);
}

/** Whether any row is kept: the hint then says to change the rotation or go back. */
export function erasureKeptOf(rows: readonly ErasureRow[], decisions: ErasureDecisions): boolean {
  return rows.some((row) => decisions[row.key] === ERASURE_KEPT);
}
