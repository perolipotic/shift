import {
  memberLevelMessageKey,
  memberStatusOf,
  memberTeamOf,
  memberTeamVersionOn,
  type MemberBadge,
  type MemberListRow,
} from '@/features/members/services/list';
import { positionMessageKey } from '@/features/members/utils/position';
import { rankMessageKey } from '@/features/members/utils/rank';

/**
 * What the member page's header says about the person (story 7.11), decided
 * here rather than in the `.tsx`: the subline under the name — rank, position
 * and team, each only where it is used — and the status badge's word.
 */
export interface MemberHeaderFacts {
  /** The rank's label key, only while ranks are shown and the member has one. */
  readonly rank: ReturnType<typeof rankMessageKey> | null;
  /** The position's label key, only while positions are shown and today's version carries one. */
  readonly position: ReturnType<typeof positionMessageKey> | null;
  /** Today's team, or `null` for no team. */
  readonly team: string | null;
  /** The role badge's word, and its variant: administrators in the primary tint, as on the list. */
  readonly role: ReturnType<typeof memberLevelMessageKey>;
  readonly roleBadge: MemberBadge;
  /** The status badge: the member active today, or not. */
  readonly status: ReturnType<typeof memberStatusBadgeMessageKey>;
}

/** The status badge's word: today's status, in words, never by colour alone. */
export function memberStatusBadgeMessageKey(activeToday: boolean): 'ljudi.page.active' | 'ljudi.page.inactive' {
  return activeToday ? 'ljudi.page.active' : 'ljudi.page.inactive';
}

/**
 * The header's facts for one member at `today`. `shown` is the organization's
 * "uses fire ranks and positions": off, neither is said, although both are
 * kept in the record.
 */
export function memberHeaderFactsOf(member: MemberListRow, today: string, shown: boolean): MemberHeaderFacts {
  const team = memberTeamOf(member, today).team;
  const position = shown && team !== null ? (memberTeamVersionOn(member, today)?.position ?? null) : null;

  return {
    rank: shown && member.fireRank !== null ? rankMessageKey(member.fireRank) : null,
    position: position === null ? null : positionMessageKey(position),
    team: team?.name ?? null,
    role: memberLevelMessageKey(member.role),
    roleBadge: member.role === 'admin' ? 'default' : 'secondary',
    status: memberStatusBadgeMessageKey(memberStatusOf(member, today).activeToday),
  };
}
