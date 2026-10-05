import type { RotationAssignment, RotationVersionStamp } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  erasuresOf,
  erasuresOutcomeOf,
  latestInstantOf,
  type ErasureRow,
  type ErasuresOutcome,
} from '@/features/conflicts/services/erasures';
import { rotationTeamsOf, type RotationSnapshot } from '@/features/rotation/services/list';
import { draftAssignmentOf, draftStepsOf, normalizedDraftOf, type RotationDraft } from '@/features/rotation/utils/draft';
import { splitTeams } from '@/features/teams/services/list';

/**
 * The rotation save's erasure guard (story 5.5a; AD-5, UX-DR23): the
 * rotation-only half — the "after" snapshot of a draft and the team-set
 * cross-check — over the surface-neutral diff, rows and decisions of
 * `@/features/conflicts/services/erasures` (story 5.5b), as a pure view model
 * in a `.ts` that renders nothing (AD-15).
 *
 * A NEW ROTATION CAN QUIETLY ERASE A DECISION. When it makes a member stop
 * working a date they are on leave, the unresolved conflict on that date
 * disappears from the queue though nobody decided it. Before "Spremi
 * rotaciju" writes, this derives which ones would go, and the builder asks the
 * admin to confirm each.
 *
 * NEVER A PARTIAL ANSWER. A row that cannot be trusted, and any `RangeError`
 * of the derivation, refuse the whole check ({@link rotationErasuresOutcomeOf});
 * the builder then saves nothing unchecked.
 */

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
  const savedAt = latestInstantOf(calendar) + 1;
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

/**
 * ONE TEAM SET: a rotation write binds the rotation read's active teams, and
 * the diff is the calendar read's. Two reads that disagree cannot be checked.
 *
 * @throws RangeError when they disagree.
 */
function sameActiveTeamsOf(calendar: CalendarSnapshot, rotation: RotationSnapshot): void {
  const bound = new Set(rotationTeamsOf(rotation).map((team) => team.id));
  const drawn = splitTeams(calendar.teams).active.map((team) => team.id);

  if (bound.size !== drawn.length || drawn.some((id) => !bound.has(id))) {
    throw new RangeError('the rotation and the calendar disagree on the active teams');
  }
}

/**
 * Every unresolved conflict saving `entered` would erase, ordered by date and
 * then team, from the calendar snapshot, the organization's leave and
 * resolution rows as read, and the rotation snapshot the save is built from.
 * Empty when it erases none.
 *
 * @throws RangeError when a leave or resolution row cannot be trusted, on any
 *   precondition of the domain's derivation — two versions of one team on the
 *   effective date included — when the rotation and the calendar disagree on
 *   the active teams, or when an erasure names a member, team or shift type
 *   the snapshot lacks, or a date that cannot be formatted.
 */
export function rotationErasuresOf(
  calendar: CalendarSnapshot,
  rotation: RotationSnapshot,
  entered: RotationDraft,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): readonly ErasureRow[] {
  sameActiveTeamsOf(calendar, rotation);

  return erasuresOf(
    calendar,
    draftCalendarSnapshotOf(calendar, rotation, entered),
    entered.effectiveFrom,
    recordRows,
    resolutionRows,
  );
}

export type RotationErasuresOutcome = ErasuresOutcome;

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
  return erasuresOutcomeOf(() => rotationErasuresOf(calendar, rotation, entered, recordRows, resolutionRows));
}

// ------------------------------------------------------------ the cancel (5.5g)

/**
 * The calendar snapshot as cancelling the change scheduled on `scheduled`
 * would leave it (story 5.5g; AD-5): without the ACTIVE teams' versions dated
 * that day, and without their save stamps — exactly what
 * `cancelScheduledRotation` deletes. An archived team's version is kept, as
 * the delete keeps it. The steps stay (a pattern outlives its versions), and
 * no stamp is added: the previous version governs from then on, so every
 * override the cancelled stamp had made pending is in force again.
 *
 * A new object, so the calendar's per-snapshot standings are worked out
 * afresh for it.
 */
export function cancelledCalendarSnapshotOf(calendar: CalendarSnapshot, scheduled: string): CalendarSnapshot {
  const active = new Set(splitTeams(calendar.teams).active.map((team) => team.id));
  const cancelled = (version: { readonly teamId: string; readonly effectiveFrom: string }): boolean =>
    active.has(version.teamId) && version.effectiveFrom === scheduled;

  return {
    ...calendar,
    assignments: calendar.assignments.filter((assignment) => !cancelled(assignment)),
    assignmentStamps: calendar.assignmentStamps.filter((stamp) => !cancelled(stamp)),
  };
}

/**
 * The versions of the active teams `assignments` date on `scheduled`, each as
 * one comparable string — its team, pattern, offset step and anchor — sorted.
 */
function scheduledVersionsOf(
  assignments: readonly RotationAssignment[],
  active: ReadonlySet<string>,
  scheduled: string,
): readonly string[] {
  return assignments
    .filter((assignment) => active.has(assignment.teamId) && assignment.effectiveFrom === scheduled)
    .map((assignment) =>
      JSON.stringify([assignment.teamId, assignment.patternId, assignment.offsetStepId, assignment.anchorDate]),
    )
    .sort();
}

/**
 * Every unresolved conflict cancelling the change scheduled on `scheduled`
 * would erase, from that date on, ordered by date and then team, from the
 * calendar snapshot, the organization's leave and resolution rows as read,
 * and the rotation snapshot the cancel is sent from. Empty when it erases
 * none.
 *
 * @throws RangeError when a leave or resolution row cannot be trusted, on any
 *   precondition of the domain's derivation, when the rotation and the
 *   calendar disagree on the active teams or on their versions dated
 *   `scheduled`, or when an erasure names a member, team or shift
 *   type the snapshot lacks, or a date that cannot be formatted.
 */
export function rotationCancelErasuresOf(
  calendar: CalendarSnapshot,
  rotation: RotationSnapshot,
  scheduled: string,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): readonly ErasureRow[] {
  sameActiveTeamsOf(calendar, rotation);

  // ONE SCHEDULED CHANGE: the cancel deletes the rotation read's versions on
  // the date, and the diff removes the calendar read's. Two reads that
  // disagree on them — which teams, or what each version is — cannot be
  // checked.
  const active = new Set(rotationTeamsOf(rotation).map((team) => team.id));

  const drawn = scheduledVersionsOf(calendar.assignments, active, scheduled);
  const bound = scheduledVersionsOf(rotation.assignments, active, scheduled);

  if (drawn.length !== bound.length || drawn.some((version, index) => version !== bound[index])) {
    throw new RangeError('the rotation and the calendar disagree on the scheduled versions');
  }

  return erasuresOf(calendar, cancelledCalendarSnapshotOf(calendar, scheduled), scheduled, recordRows, resolutionRows);
}

/**
 * {@link rotationCancelErasuresOf}, GUARDED as the queue is: a `RangeError`
 * refuses the whole check — never a partial list — and is logged.
 */
export function rotationCancelErasuresOutcomeOf(
  calendar: CalendarSnapshot,
  rotation: RotationSnapshot,
  scheduled: string,
  recordRows: readonly unknown[],
  resolutionRows: readonly unknown[],
): RotationErasuresOutcome {
  return erasuresOutcomeOf(() => rotationCancelErasuresOf(calendar, rotation, scheduled, recordRows, resolutionRows));
}
