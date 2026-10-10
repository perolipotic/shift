import { dutiesOf, memberScheduleOfMonth, membershipOn, monthOf, shiftRoster, type DutyLeg } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, shiftLegOn } from '@/features/calendar/utils/month';
import { MEMBER_CHANGE_STATUS, memberChangeSnapshotOf } from '@/features/members/services/member-erasures';
import { DEACTIVATE, type REACTIVATE } from '@/features/members/services/wire';
import { isIsoDate } from '@/lib/i18n/format';

/**
 * Story 7.13c: what a deactivation costs the member's team, in numbers, for
 * the status dialog's question (AC3, UX-DR27). Codes and operands only; the
 * dialog words them.
 *
 * ONE COMPUTATION, from the one calendar snapshot (AD-13), every rule the
 * domain's or the 5.5e guard's own:
 * - `team` is the member's team on `day` (`membershipOn`);
 * - `total` is that team's roster on `day` as read (`shiftRoster`);
 * - `members` is the same roster in the "after" snapshot of
 *   `memberChangeSnapshotOf` — the erasure guard's one "after", never `total − 1`;
 * - `duties` counts the member's own DUTIES on that team (not `viaOverride`)
 *   from `day` through the end of its month (human decision 2026-10-10): the
 *   working shifts of the member's schedule as read (`memberScheduleOfMonth`
 *   through `memberScheduleInputOf`), as legs by the calendar's one leg
 *   recipe (`shiftLegOn`), grouped by the domain's `dutiesOf` (story 6.2). A
 *   duty of touching shifts (Dan + Noć) counts once, and so does a shift in
 *   no duty. Only the legs in range are grouped, so a duty split by the
 *   month's end counts once here. Leave days are not excluded.
 *
 * `null` — the dialog then asks its question alone — when the snapshot is not
 * ready, the member is in no team that day, the member is not on that team's
 * roster that day as read (so the deactivation shrinks nothing: never "4 od
 * 4"), the guard refuses the change, or the domain throws (logged, never rethrown: a missing consequence never
 * gates the save).
 */
export interface DeactivationConsequence {
  /** The team's name as stored: a data name, in apposition. */
  readonly team: string;
  /** The team's roster on the day once the member is deactivated. */
  readonly members: number;
  /** The team's roster on the day as read. */
  readonly total: number;
  /** The day's month, `YYYY-MM`. */
  readonly month: string;
  /** The member's own duties on the team from the day through the end of the month: a shift in no duty is one. */
  readonly duties: number;
}

/** See {@link DeactivationConsequence}. `day` and `today` are `YYYY-MM-DD`, `today` the organization's. */
export function deactivationConsequenceOf(
  snapshot: CalendarSnapshot | null,
  memberId: string,
  day: string,
  today: string,
): DeactivationConsequence | null {
  if (snapshot === null) return null;

  try {
    const member = snapshot.members.find((candidate) => candidate.id === memberId);

    if (member === undefined) return null;

    const membership = membershipOn(member.memberships, day);

    if (membership === null) return null;

    const team = snapshot.teams.find((candidate) => candidate.id === membership.teamId);

    if (team === undefined) return null;

    const applied = memberChangeSnapshotOf(
      snapshot,
      { kind: MEMBER_CHANGE_STATUS, memberId, active: false, day },
      today,
    );

    if (!applied.ok) return null;

    const month = monthOf(day);
    const schedule = memberScheduleOfMonth(
      memberScheduleInputOf(snapshot, { memberId, memberships: member.memberships, statuses: member.statuses }),
      month,
    );
    const legs: DutyLeg[] = [];

    for (const scheduled of schedule) {
      if (scheduled.date < day) continue;

      for (const shift of scheduled.shifts) {
        if (shift.viaOverride || shift.teamId !== team.id || shift.shiftTypeId === null) continue;

        const leg = shiftLegOn(snapshot, shift.shiftTypeId, scheduled.date);

        if (leg !== null) legs.push(leg);
      }
    }

    const grouped = dutiesOf(legs);
    const inDuty = new Set<DutyLeg>(grouped.flatMap((duty) => duty.legs));
    const members = shiftRoster(applied.after.members, team.id, day).length;
    const total = shiftRoster(snapshot.members, team.id, day).length;

    // NOT ON THE ROSTER THAT DAY AS READ: the deactivation shrinks nothing.
    if (members >= total) return null;

    return {
      team: team.name,
      members,
      total,
      month,
      duties: grouped.length + legs.filter((leg) => !inDuty.has(leg)).length,
    };
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

/**
 * The consequence the status dialog shows, or `null` for none (story 7.13c):
 * only for a DEACTIVATION offer, only while `day` is a valid date on or after
 * the offer's minimum — a date the preflight would refuse states nothing —
 * and only once the organization's today is known. A reactivation never has
 * one.
 */
export function shownDeactivationConsequenceOf(
  snapshot: CalendarSnapshot | null,
  memberId: string,
  offer: { readonly change: typeof DEACTIVATE | typeof REACTIVATE; readonly minimum: string } | null,
  day: string,
  today: string | null,
): DeactivationConsequence | null {
  if (offer === null || offer.change !== DEACTIVATE || today === null || !isIsoDate(day) || day < offer.minimum) {
    return null;
  }

  return deactivationConsequenceOf(snapshot, memberId, day, today);
}
