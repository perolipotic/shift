import { activeOn, memberScheduleOfMonth, membershipOn, monthOf, rosterOn, shiftRoster } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import type { RosterOutCandidate } from '@/features/calendar/utils/day-detail';
import {
  memberScheduleInputOf,
  rosterStandingOfCalendar,
  workingShiftTypeIdsOf,
} from '@/features/calendar/utils/month';

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
 *     shifts *Sati* counts, overrides in force included;
 *   - {@link CANDIDATES_ON_LEAVE}: live leave covers the date. This takes
 *     precedence over the other two.
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
/** Working a shift that date, on any team: 24 h without a break. */
export const CANDIDATES_WORKING = 'working';
/** On leave that date. */
export const CANDIDATES_ON_LEAVE = 'onLeave';

/** The groups, in their fixed order. */
export const CANDIDATE_GROUPS = [CANDIDATES_FREE, CANDIDATES_WORKING, CANDIDATES_ON_LEAVE] as const;

export type CandidateGroupKind = (typeof CANDIDATE_GROUPS)[number];

/** One candidate: as a roster line reads them (`outOptionOf`), their position in their own team that date. */
export type ReplacementCandidate = RosterOutCandidate;

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
  const month = monthOf(date);
  const groups: Record<CandidateGroupKind, ReplacementCandidate[]> = {
    [CANDIDATES_FREE]: [],
    [CANDIDATES_WORKING]: [],
    [CANDIDATES_ON_LEAVE]: [],
  };

  for (const member of snapshot.members) {
    if (excluded.has(member.id) || !activeOn(member.statuses, date)) continue;

    const candidate: ReplacementCandidate = {
      id: member.id,
      name: member.name,
      fireRank: member.fireRank,
      position: membershipOn(member.memberships, date)?.position ?? null,
    };

    if (onLeave.has(member.id)) {
      groups[CANDIDATES_ON_LEAVE].push(candidate);
      continue;
    }

    const day = memberScheduleOfMonth(
      memberScheduleInputOf(snapshot, { memberId: member.id, memberships: member.memberships, statuses: member.statuses }),
      month,
    ).find((one) => one.date === date);
    const works = day?.shifts.some((shift) => shift.shiftTypeId !== null && working.has(shift.shiftTypeId)) ?? false;

    groups[works ? CANDIDATES_WORKING : CANDIDATES_FREE].push(candidate);
  }

  return CANDIDATE_GROUPS.map((kind) => ({ kind, candidates: groups[kind] }));
}
