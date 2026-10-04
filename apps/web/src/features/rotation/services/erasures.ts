import type { RotationVersionStamp } from '@shift/domain';

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
  // ONE TEAM SET: the save binds the rotation read's active teams, and the
  // diff is the calendar read's. Two reads that disagree cannot be checked.
  const bound = new Set(rotationTeamsOf(rotation).map((team) => team.id));
  const drawn = splitTeams(calendar.teams).active.map((team) => team.id);

  if (bound.size !== drawn.length || drawn.some((id) => !bound.has(id))) {
    throw new RangeError('the rotation and the calendar disagree on the active teams');
  }

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
