import {
  activeOn,
  dutiesOf,
  memberScheduleOfMonth,
  membershipOn,
  monthOf,
  rosterOn,
  shiftRoster,
  type DutyLeg,
  type LeaveRange,
  type MemberScheduleDay,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import type { RosterOutCandidate } from '@/features/calendar/utils/day-detail';
import {
  memberScheduleInputOf,
  rosterStandingOfCalendar,
  shiftLegOn,
  workingShiftTypeIdsOf,
} from '@/features/calendar/utils/month';
import { durationMessageKey } from '@/features/hour-bands/services/list';
import { nextIsoDate, previousIsoDate } from '@/lib/i18n/format';
import { durationValuesOf, type DurationValues } from '@/utils/time';

/**
 * WHO MAY BE PUT ON ONE TEAM'S SHIFT ON ONE DATE, grouped (story 5.4c; reused
 * by story 7.9's roster dialog), as a pure helper in a `.ts` that renders
 * nothing (AD-15). Numbers, ids and codes only: no string is chosen here.
 *
 * THE CANDIDATES are the members active that date (`activeOn`) less:
 *
 *   - the members on the team's roster that date — the default roster
 *     (`shiftRoster`) and the roster with the overrides in force (`rosterOn`)
 *     alike, so a member on leave whose conflict is being resolved is never
 *     offered for their own shift, and a member an override took off is not
 *     put back on through a second one the domain would treat as inert;
 *   - anyone a LIVE roster override of the team and date already puts on it —
 *     applied, pending review or inert — which 0026's live key would refuse.
 *
 * THREE GROUPS, IN THIS ORDER (human, 2026-10-02), each by name — the
 * snapshot's own order, the Croatian collation:
 *
 *   - {@link CANDIDATES_FREE}: no working shift that date and not on leave;
 *   - {@link CANDIDATES_WORKING}: a working shift that date, on any team —
 *     `memberScheduleOfMonth`'s answer through `memberScheduleInputOf`, the
 *     shifts *Sati* counts, overrides in force included — or a shift on an
 *     adjacent date that touches this one (a Noć ending as it starts);
 *   - {@link CANDIDATES_ON_LEAVE}: live leave covers the date. This takes
 *     precedence over the other two.
 *
 * THE CONTINUOUS DUTY (D717): each candidate not on leave carries how long
 * they would be on duty without a break if put on this shift —
 * `continuousMinutes`, the duty (story 6.2, the domain's `dutiesOf` over the
 * calendar's one leg recipe `shiftLegOn`) that the shift joins among their
 * own working shifts within {@link CONTINUOUS_WINDOW_DAYS} days either side —
 * or `null` when the shift would join nothing: it is then just the shift
 * itself. A shift that overlaps one of theirs (a double booking) joins no
 * duty, as the domain rules, so it claims no figure either.
 *
 * A GROUP ONLY INFORMS. Every candidate is offered; nothing here blocks,
 * disables, recommends or orders by rank, position or group beyond the
 * grouping itself. Rank and position ride along to be shown, never used.
 *
 * The database computes no candidate list (AD-4): its keys and checks stay
 * authoritative.
 */

/** Not working that date and not on leave. */
export const CANDIDATES_FREE = 'free';
/** Working a shift that date, on any team, or one that touches this shift. */
export const CANDIDATES_WORKING = 'working';
/** On leave that date. */
export const CANDIDATES_ON_LEAVE = 'onLeave';

/** The groups, in their fixed order. */
export const CANDIDATE_GROUPS = [CANDIDATES_FREE, CANDIDATES_WORKING, CANDIDATES_ON_LEAVE] as const;

export type CandidateGroupKind = (typeof CANDIDATE_GROUPS)[number];

/**
 * How far either side of the date a candidate's own shifts are read for the
 * duty the shift would join: three days holds a chain of 24 h shifts on each
 * side, longer than any rotation the pilot runs.
 */
export const CONTINUOUS_WINDOW_DAYS = 3;

/**
 * One candidate: as a roster line reads them (`outOptionOf`), their position
 * in their own team that date, and the continuous duty the shift would make.
 */
export interface ReplacementCandidate extends RosterOutCandidate {
  /**
   * Minutes on duty without a break if put on the shift, when that runs
   * longer than the shift itself; `null` when the shift joins none of their
   * shifts, for a member on leave, or when the shift has no times that date.
   */
  readonly continuousMinutes: number | null;
}

/** One group of candidates; an empty group is kept, so the order is fixed. */
export interface CandidateGroup {
  readonly kind: CandidateGroupKind;
  readonly candidates: readonly ReplacementCandidate[];
}

/** A live leave record, as far as covering a date goes. */
export interface CandidateLeave {
  readonly memberId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The leave records the calendar marks' `leave` holds, by member, as the
 * candidates are grouped by (story 7.9): the calendar's own marks, never a
 * read of their own.
 */
export function candidateLeaveOf(leave: ReadonlyMap<string, readonly LeaveRange[]>): readonly CandidateLeave[] {
  return [...leave].flatMap(([memberId, ranges]) => ranges.map(({ from, to }) => ({ memberId, from, to })));
}

/**
 * The candidates to put on `teamId`'s shift on `date`, in the three groups
 * and their fixed order, every group present.
 *
 * @throws RangeError on any precondition of `activeOn`, `membershipOn`,
 *   `shiftRoster`, `rosterOn` or `memberScheduleOfMonth`.
 */
export function replacementCandidatesOf(
  snapshot: CalendarSnapshot,
  leave: readonly CandidateLeave[],
  teamId: string,
  date: string,
  shiftTypeId: string | null,
): readonly CandidateGroup[] {
  const excluded = new Set<string>();

  for (const entry of shiftRoster(snapshot.members, teamId, date)) excluded.add(entry.memberId);
  for (const entry of rosterOn(snapshot.members, rosterStandingOfCalendar(snapshot).inForce, teamId, date).roster) {
    excluded.add(entry.memberId);
  }
  for (const one of snapshot.rosterOverrides) {
    if (one.teamId === teamId && one.date === date && one.memberInId !== null) excluded.add(one.memberInId);
  }

  const onLeave = new Set(
    leave.filter((record) => record.from <= date && date <= record.to).map((record) => record.memberId),
  );
  const working = new Set(workingShiftTypeIdsOf(snapshot));
  const shiftLeg = shiftTypeId === null ? null : shiftLegOn(snapshot, shiftTypeId, date);
  const window = windowOf(date);
  const groups: Record<CandidateGroupKind, ReplacementCandidate[]> = {
    [CANDIDATES_FREE]: [],
    [CANDIDATES_WORKING]: [],
    [CANDIDATES_ON_LEAVE]: [],
  };

  for (const member of snapshot.members) {
    if (excluded.has(member.id) || !activeOn(member.statuses, date)) continue;

    const line: RosterOutCandidate = {
      id: member.id,
      name: member.name,
      fireRank: member.fireRank,
      position: membershipOn(member.memberships, date)?.position ?? null,
    };

    if (onLeave.has(member.id)) {
      groups[CANDIDATES_ON_LEAVE].push({ ...line, continuousMinutes: null });
      continue;
    }

    const input = memberScheduleInputOf(snapshot, {
      memberId: member.id,
      memberships: member.memberships,
      statuses: member.statuses,
    });
    const months = new Map<string, readonly MemberScheduleDay[]>();
    const scheduleOf = (one: string): readonly MemberScheduleDay[] => {
      let known = months.get(one);

      if (known === undefined) {
        known = memberScheduleOfMonth(input, one);
        months.set(one, known);
      }

      return known;
    };
    const workingOn = (one: string) =>
      (scheduleOf(monthOf(one)).find((day) => day.date === one)?.shifts ?? []).filter(
        (shift) => shift.shiftTypeId !== null && working.has(shift.shiftTypeId),
      );
    const works = workingOn(date).length > 0;
    const continuousMinutes =
      shiftLeg === null ? null : continuousMinutesOf(snapshot, shiftLeg, window, workingOn);

    groups[works || continuousMinutes !== null ? CANDIDATES_WORKING : CANDIDATES_FREE].push({
      ...line,
      continuousMinutes,
    });
  }

  return CANDIDATE_GROUPS.map((kind) => ({ kind, candidates: groups[kind] }));
}

/** `date` and the {@link CONTINUOUS_WINDOW_DAYS} days either side, in order; fewer at the calendar's ends. */
function windowOf(date: string): readonly string[] {
  const before: string[] = [];
  const after: string[] = [];
  let back: string | null = date;
  let ahead: string | null = date;

  for (let step = 0; step < CONTINUOUS_WINDOW_DAYS; step += 1) {
    back = back === null ? null : previousIsoDate(back);
    ahead = ahead === null ? null : nextIsoDate(ahead);
    if (back !== null) before.unshift(back);
    if (ahead !== null) after.push(ahead);
  }

  return [...before, date, ...after];
}

/**
 * The minutes of the duty `shiftLeg` would join among a candidate's own
 * working shifts on `window`'s dates (`dutiesOf`), or `null` when it joins
 * none — then the shift is all there is.
 *
 * @throws RangeError on any precondition of `shiftLegOn` or `dutiesOf`.
 */
function continuousMinutesOf(
  snapshot: CalendarSnapshot,
  shiftLeg: DutyLeg,
  window: readonly string[],
  workingOn: (date: string) => readonly { readonly shiftTypeId: string | null }[],
): number | null {
  const legs: DutyLeg[] = [shiftLeg];

  for (const one of window) {
    for (const shift of workingOn(one)) {
      if (shift.shiftTypeId === null) continue;

      const leg = shiftLegOn(snapshot, shift.shiftTypeId, one);

      if (leg !== null) legs.push(leg);
    }
  }

  return dutiesOf(legs).find((duty) => duty.legs.includes(shiftLeg))?.totalMinutes ?? null;
}

/**
 * A candidate's continuous duty as its line adds it — `· 24 h bez pauze`,
 * {@link candidateContinuousMessageKey} over the duration's key and values —
 * or `null`, which adds nothing (D717).
 */
export function candidateContinuousOf(
  continuousMinutes: number | null,
): { readonly key: ReturnType<typeof durationMessageKey>; readonly values: DurationValues } | null {
  if (continuousMinutes === null) return null;

  return { key: durationMessageKey(continuousMinutes), values: durationValuesOf(continuousMinutes) };
}

/** A candidate's line with their continuous duty after it: `{line} · {hours} bez pauze`. */
export function candidateContinuousMessageKey(): 'raspored.resolution.candidates.continuous' {
  return 'raspored.resolution.candidates.continuous';
}

/** A candidate group's heading, by its kind. Exhaustive. */
export function candidateGroupMessageKey(
  kind: CandidateGroupKind,
):
  | 'raspored.resolution.candidates.free'
  | 'raspored.resolution.candidates.working'
  | 'raspored.resolution.candidates.onLeave' {
  switch (kind) {
    case CANDIDATES_FREE:
      return 'raspored.resolution.candidates.free';
    case CANDIDATES_WORKING:
      return 'raspored.resolution.candidates.working';
    case CANDIDATES_ON_LEAVE:
      return 'raspored.resolution.candidates.onLeave';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}
