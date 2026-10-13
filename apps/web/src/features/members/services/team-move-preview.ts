import { adjacentMonth, memberScheduleOfMonth, membershipOn, monthOf, type MemberScheduleDay } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { memberScheduleInputOf, typeRangeOn } from '@/features/calendar/utils/month';
import { MEMBER_CHANGE_MOVE, memberChangeSnapshotOf } from '@/features/members/services/member-erasures';
import { chosenTeam, type TeamMoveOffer } from '@/features/members/services/write';
import { formatIsoDayMonth, formatIsoWeekdayShortName, isIsoDate } from '@/lib/i18n/format';

/**
 * THE TEAM DIALOG'S *ŠTO SE MIJENJA* (decision 16): a member's move across
 * teams from a date, as the last shift they work in the team they leave and
 * the first they work in the team they join — "Zadnja u A · čet 01.10. · Noć ·
 * 19:00–07:00 / Prva u B · sub 03.10. · Dan · 07:00–19:00". Codes and
 * operands only (names, ISO dates, ranges); the dialog words them.
 *
 * ONE COMPUTATION, from the one calendar snapshot (AD-13), every rule the
 * domain's or the 5.5e guard's own:
 * - the team left is the member's team on the day as read (`membershipOn`);
 * - the LAST shift is the member's own schedule as read
 *   (`memberScheduleOfMonth` through `memberScheduleInputOf`), the latest
 *   working shift on that team strictly before the day;
 * - the FIRST shift is the same schedule in the "after" snapshot of
 *   `memberChangeSnapshotOf` — the erasure guard's one "after" — the earliest
 *   working shift on the team joined on or after the day.
 * A shift a roster override put the member on (`viaOverride`) is another
 * team's, never counted; one they were taken off is not in the schedule.
 * Each side looks {@link SEARCH_MONTHS} months from the day's own, and a side
 * with no shift there — no team on it, or none worked — is `null`.
 *
 * `null` — the dialog then shows no *Što se mijenja* — when the snapshot is
 * not ready, the member is not in it, the guard refuses the change, neither
 * side has a shift, or the domain throws (logged, never rethrown: a missing
 * preview never gates the save).
 */

/** How many months each side looks through, the day's own included. */
export const SEARCH_MONTHS = 2;

/** One shift of the preview, as data. */
export interface MoveShift {
  /** The team's name as stored: a data name, in apposition. */
  readonly team: string;
  /** `YYYY-MM-DD`: the date the shift starts. */
  readonly date: string;
  /** The shift type's name as stored. */
  readonly type: string;
  /** `19:00–07:00`, or `null` for a type with no times in effect that date. */
  readonly range: string | null;
}

/** What a move changes: the last shift in the team left and the first in the team joined. */
export interface TeamMovePreview {
  readonly last: MoveShift | null;
  readonly first: MoveShift | null;
}

/** The months to walk from `day`'s own, `step` at a time: never past year 9999 or before year 1. */
function monthsFrom(day: string, step: 1 | -1): readonly string[] {
  const months = [monthOf(day)];

  while (months.length < SEARCH_MONTHS) {
    const next = adjacentMonth(months[months.length - 1] as string, step);

    if (next === null) break;
    months.push(next);
  }

  return months;
}

/**
 * The member's working shift on `teamId` the walk meets first: from `day`
 * backwards (strictly before it) for `step` -1, forwards (on or after it) for 1.
 *
 * @throws RangeError on any precondition of `memberScheduleOfMonth` or `typeRangeOn`.
 */
function shiftOn(
  snapshot: CalendarSnapshot,
  memberId: string,
  teamId: string,
  day: string,
  step: 1 | -1,
): MoveShift | null {
  const member = snapshot.members.find((candidate) => candidate.id === memberId);
  const team = snapshot.teams.find((candidate) => candidate.id === teamId);

  if (member === undefined || team === undefined) return null;

  const input = memberScheduleInputOf(snapshot, {
    memberId,
    memberships: member.memberships,
    statuses: member.statuses,
  });

  for (const month of monthsFrom(day, step)) {
    const schedule: readonly MemberScheduleDay[] = memberScheduleOfMonth(input, month);
    const ordered = step === 1 ? schedule : [...schedule].reverse();

    for (const scheduled of ordered) {
      if (step === 1 ? scheduled.date < day : scheduled.date >= day) continue;

      for (const shift of scheduled.shifts) {
        if (shift.viaOverride || shift.teamId !== teamId || shift.shiftTypeId === null) continue;

        const type = snapshot.types.find((candidate) => candidate.id === shift.shiftTypeId);

        if (type === undefined || !type.isWorking) continue;

        return { team: team.name, date: scheduled.date, type: type.name, range: typeRangeOn(type, scheduled.date) };
      }
    }
  }

  return null;
}

/**
 * See the module's header. `teamId` is the team joined, `null` for no team;
 * `day` and `today` are `YYYY-MM-DD`, `today` the organization's.
 */
export function teamMovePreviewOf(
  snapshot: CalendarSnapshot | null,
  memberId: string,
  teamId: string | null,
  day: string,
  today: string,
): TeamMovePreview | null {
  if (snapshot === null) return null;

  try {
    const member = snapshot.members.find((candidate) => candidate.id === memberId);

    if (member === undefined) return null;

    const left = membershipOn(member.memberships, day)?.teamId ?? null;

    // THE SAME TEAM is a position-only change: no shift moves.
    if (left === teamId) return null;

    const applied = memberChangeSnapshotOf(
      snapshot,
      { kind: MEMBER_CHANGE_MOVE, memberId, teamId, position: null, day },
      today,
    );

    if (!applied.ok) return null;

    const last = left === null ? null : shiftOn(snapshot, memberId, left, day, -1);
    const first = teamId === null ? null : shiftOn(applied.after, memberId, teamId, day, 1);

    return last === null && first === null ? null : { last, first };
  } catch (cause) {
    console.error(cause);

    return null;
  }
}

/**
 * The preview the team dialog shows, or `null` for none: only while a team —
 * or "no team" — is picked, `day` is a valid date on or after the offer's
 * minimum (a date the preflight would refuse states nothing), and the
 * organization's today is known.
 */
export function shownTeamMovePreviewOf(
  snapshot: CalendarSnapshot | null,
  memberId: string,
  offer: TeamMoveOffer | null,
  picked: string,
  day: string,
  today: string | null,
): TeamMovePreview | null {
  if (offer === null || today === null || !isIsoDate(day) || day < offer.minimum) return null;

  const choice = chosenTeam(picked, offer);

  if (choice === undefined) return null;

  return teamMovePreviewOf(snapshot, memberId, choice?.id ?? null, day, today);
}

/** Which side of the move a line is: the last shift in the team left, or the first in the team joined. */
export const MOVE_LAST = 'last';
export const MOVE_FIRST = 'first';
export type MoveSide = typeof MOVE_LAST | typeof MOVE_FIRST;

/** A side's line, with the range or, for a type with no times that date, without it. */
export function moveShiftMessageKey(
  side: MoveSide,
  shift: MoveShift,
):
  | 'smjene.membership.lastIn'
  | 'smjene.membership.lastInNoRange'
  | 'smjene.membership.firstIn'
  | 'smjene.membership.firstInNoRange' {
  if (side === MOVE_LAST) return shift.range === null ? 'smjene.membership.lastInNoRange' : 'smjene.membership.lastIn';

  return shift.range === null ? 'smjene.membership.firstInNoRange' : 'smjene.membership.firstIn';
}

/** What a side's line interpolates: a type alias, since an interface has no implicit index signature for `t()`. */
export type MoveShiftValues = {
  readonly team: string;
  readonly weekday: string;
  readonly date: string;
  readonly type: string;
  readonly range: string;
};

/** A side's operands, its date as `čet` and `01.10.` (the ISO date only for one `isIsoDate` refuses, which none here is). */
export function moveShiftValuesOf(shift: MoveShift): MoveShiftValues {
  return {
    team: shift.team,
    weekday: formatIsoWeekdayShortName(shift.date) ?? shift.date,
    date: formatIsoDayMonth(shift.date) ?? shift.date,
    type: shift.type,
    range: shift.range ?? '',
  };
}
