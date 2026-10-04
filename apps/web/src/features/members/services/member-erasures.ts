import type { MembershipVersion, StatusVersion } from '@shift/domain';

import type { CalendarMember, CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  checkedOf,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { erasuresOf, erasuresOutcomeOf, type ErasureRow } from '@/features/conflicts/services/erasures';
import {
  DEACTIVATE,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_EFFECT,
  MEMBER_STATUS_STALE,
  MEMBER_TEAM_ARCHIVED,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_EFFECT,
  MEMBER_TEAM_STALE,
  TEAM_MOVE,
  WITHDRAW,
  type StatusChange,
  type TeamChange,
} from '@/features/members/services/write';

/**
 * THE MEMBER PAGE'S ERASURE GUARD (story 5.5e; AD-5, UX-DR23): the "after"
 * snapshot of the team card's and the status card's writes, over the
 * surface-neutral diff of `@/features/conflicts/services/erasures`, and one
 * run of the check, as a `.ts` the node suite executes (AD-15). Renders
 * nothing and declares no key.
 *
 * Moving a member on leave to another team or to no team, deactivating them,
 * or withdrawing a scheduled move onto a team or a scheduled reactivation
 * would otherwise take their unresolved conflicts out of the queue without
 * anyone deciding them.
 *
 * "AFTER" IS THE SNAPSHOT AS THE WRITE WOULD LEAVE IT, and only the target
 * member's entry in `calendar.members` changes (human, 2026-10-04): a move
 * appends a membership version, a deactivation or reactivation a status
 * version, and a withdrawal removes the scheduled version. The diff runs from
 * the change's day on.
 *
 * REFUSED BEFORE DERIVING, judged against the fresh snapshot and the
 * organization's today in its zone: a version already dated the change's day
 * (which `orderedVersions` would throw on); a move or a status change while
 * another version is already scheduled; a withdrawal whose version is gone,
 * or no longer in the future; and a target team that is missing or archived.
 * The card then shows its own refusal. Any other fault is unavailable.
 *
 * A STATUS WITHDRAWAL IS GUARDED ONLY FOR A SCHEDULED REACTIVATION, and the
 * fresh member's version dated the day decides it: withdrawing a scheduled
 * deactivation only adds the member back, and erases nothing.
 */

/** A move onto a team, or onto no team (`teamId` `null`), from `day`. */
export const MEMBER_CHANGE_MOVE = 'move';
/** The scheduled membership version dated `day`, withdrawn. */
export const MEMBER_CHANGE_TEAM_WITHDRAW = 'team-withdraw';
/** A deactivation (`active` false) or a reactivation (`active` true) from `day`. */
export const MEMBER_CHANGE_STATUS = 'status';
/** The scheduled status version dated `day`, withdrawn. */
export const MEMBER_CHANGE_STATUS_WITHDRAW = 'status-withdraw';

export type MemberChange =
  | {
      readonly kind: typeof MEMBER_CHANGE_MOVE;
      readonly memberId: string;
      readonly teamId: string | null;
      readonly position: string | null;
      /** `YYYY-MM-DD`. */
      readonly day: string;
    }
  | { readonly kind: typeof MEMBER_CHANGE_TEAM_WITHDRAW; readonly memberId: string; readonly day: string }
  | { readonly kind: typeof MEMBER_CHANGE_STATUS; readonly memberId: string; readonly active: boolean; readonly day: string }
  | { readonly kind: typeof MEMBER_CHANGE_STATUS_WITHDRAW; readonly memberId: string; readonly day: string };

/** Why the database would refuse the write anyway: the card's own refusal code. */
export type MemberChangeRefusal =
  | typeof MEMBER_TEAM_DATE_TAKEN
  | typeof MEMBER_TEAM_STALE
  | typeof MEMBER_TEAM_ARCHIVED
  | typeof MEMBER_TEAM_IN_EFFECT
  | typeof MEMBER_STATUS_DATE_TAKEN
  | typeof MEMBER_STATUS_STALE
  | typeof MEMBER_STATUS_IN_EFFECT;

export type MemberChangeApplied =
  | {
      readonly ok: true;
      readonly after: CalendarSnapshot;
      readonly from: string;
      /** `false` for a change that only adds (a withdrawn scheduled deactivation): nothing to derive. */
      readonly guarded: boolean;
    }
  | { readonly ok: false; readonly code: MemberChangeRefusal };

/**
 * The guarded change a team confirmation sends, or `null` when it runs no
 * check: a position-only change (`keepsTeam`) only repositions the member on
 * the team they are on.
 */
export function teamChangeOf(
  memberId: string,
  confirmation: {
    readonly change: TeamChange;
    readonly team: { readonly id: string } | null;
    readonly position: string | null;
    readonly keepsTeam: boolean;
    readonly day: string;
  },
): MemberChange | null {
  if (confirmation.change === WITHDRAW) return { kind: MEMBER_CHANGE_TEAM_WITHDRAW, memberId, day: confirmation.day };
  if (confirmation.change !== TEAM_MOVE || confirmation.keepsTeam) return null;

  const teamId = confirmation.team?.id ?? null;

  return {
    kind: MEMBER_CHANGE_MOVE,
    memberId,
    teamId,
    position: teamId === null ? null : confirmation.position,
    day: confirmation.day,
  };
}

/**
 * The guarded change a status confirmation sends, or `null` when it runs no
 * check: a reactivation only ever adds a member back to a roster. A
 * withdrawal is always handed to the check, which decides from the fresh
 * member's scheduled version whether it is guarded (only a scheduled
 * reactivation is).
 */
export function statusChangeOf(
  memberId: string,
  confirmation: { readonly change: StatusChange; readonly day: string },
): MemberChange | null {
  if (confirmation.change === DEACTIVATE) {
    return { kind: MEMBER_CHANGE_STATUS, memberId, active: false, day: confirmation.day };
  }
  if (confirmation.change === WITHDRAW) return { kind: MEMBER_CHANGE_STATUS_WITHDRAW, memberId, day: confirmation.day };

  return null;
}

/** Whether `versions` hold one scheduled after `today` on another date than `day`. */
function scheduledElsewhere(versions: readonly { readonly effectiveFrom: string }[], day: string, today: string): boolean {
  return versions.some((version) => version.effectiveFrom > today && version.effectiveFrom !== day);
}

/** The target member's entry with its versions replaced, every other member as read. */
function withMember(calendar: CalendarSnapshot, changed: CalendarMember): CalendarSnapshot {
  return { ...calendar, members: calendar.members.map((member) => (member.id === changed.id ? changed : member)) };
}

/**
 * The calendar snapshot as `change` would leave it, and the date the diff
 * runs from — or the refusal the write would meet anyway (see the module's
 * header). `today` is the organization's. A new object, so the calendar's
 * per-snapshot standings are worked out afresh for it.
 *
 * @throws RangeError when the snapshot holds no member `change` names.
 */
export function memberChangeSnapshotOf(
  calendar: CalendarSnapshot,
  change: MemberChange,
  today: string,
): MemberChangeApplied {
  const member = calendar.members.find((candidate) => candidate.id === change.memberId);

  if (member === undefined) throw new RangeError(`member ${change.memberId} is not in the snapshot`);

  const applied = (changed: CalendarMember, guarded = true): MemberChangeApplied => ({
    ok: true,
    after: withMember(calendar, changed),
    from: change.day,
    guarded,
  });

  switch (change.kind) {
    case MEMBER_CHANGE_MOVE: {
      if (member.memberships.some((version) => version.effectiveFrom === change.day)) {
        return { ok: false, code: MEMBER_TEAM_DATE_TAKEN };
      }
      if (scheduledElsewhere(member.memberships, change.day, today)) return { ok: false, code: MEMBER_TEAM_STALE };
      if (change.teamId !== null) {
        const team = calendar.teams.find((candidate) => candidate.id === change.teamId);

        if (team === undefined) return { ok: false, code: MEMBER_TEAM_STALE };
        if (team.archived) return { ok: false, code: MEMBER_TEAM_ARCHIVED };
      }

      const added: MembershipVersion = { teamId: change.teamId, position: change.position, effectiveFrom: change.day };

      return applied({ ...member, memberships: [...member.memberships, added] });
    }
    case MEMBER_CHANGE_TEAM_WITHDRAW: {
      if (!member.memberships.some((version) => version.effectiveFrom === change.day)) {
        return { ok: false, code: MEMBER_TEAM_STALE };
      }
      if (change.day <= today) return { ok: false, code: MEMBER_TEAM_IN_EFFECT };

      return applied({ ...member, memberships: member.memberships.filter((version) => version.effectiveFrom !== change.day) });
    }
    case MEMBER_CHANGE_STATUS: {
      if (member.statuses.some((version) => version.effectiveFrom === change.day)) {
        return { ok: false, code: MEMBER_STATUS_DATE_TAKEN };
      }
      if (scheduledElsewhere(member.statuses, change.day, today)) return { ok: false, code: MEMBER_STATUS_STALE };

      const added: StatusVersion = { active: change.active, effectiveFrom: change.day };

      return applied({ ...member, statuses: [...member.statuses, added] });
    }
    case MEMBER_CHANGE_STATUS_WITHDRAW: {
      const scheduled = member.statuses.find((version) => version.effectiveFrom === change.day);

      if (scheduled === undefined) return { ok: false, code: MEMBER_STATUS_STALE };
      if (change.day <= today) return { ok: false, code: MEMBER_STATUS_IN_EFFECT };

      // ONLY A SCHEDULED REACTIVATION IS GUARDED: withdrawing a deactivation adds the member back.
      return applied(
        { ...member, statuses: member.statuses.filter((version) => version.effectiveFrom !== change.day) },
        scheduled.active,
      );
    }
  }
}

export type MemberErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: MemberChangeRefusal }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

/**
 * The check of `change` over `read`'s answer (the three core reads, fresh),
 * judged at the organization's today as `now` reads it. Never throws: anything that goes wrong is unavailable, and logged. A write
 * refused anyway answers `refused`, and the card takes the write's own
 * refusal path, never "cannot check".
 */
export async function memberErasureCheckOf(
  read: () => Promise<ErasureReads>,
  change: MemberChange,
  online: boolean,
  now: () => Date = () => new Date(),
): Promise<MemberErasureCheck> {
  return checkedOf(
    read,
    ({ calendar, records, resolutions }): MemberErasureCheck => {
      const applied = memberChangeSnapshotOf(calendar, change, calendarTodayOf(calendar, now()));

      if (!applied.ok) return { kind: CHECK_REFUSED, code: applied.code };
      if (!applied.guarded) return { kind: CHECK_READY, rows: [] };

      const outcome = erasuresOutcomeOf(() => erasuresOf(calendar, applied.after, applied.from, records, resolutions));

      return outcome.ok ? { kind: CHECK_READY, rows: outcome.rows } : { kind: CHECK_UNAVAILABLE };
    },
    online,
  );
}
