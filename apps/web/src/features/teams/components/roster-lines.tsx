import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { rosterRankMessageKey } from '@/features/members/utils/rank';
import type { TeamRosterMember } from '@/features/teams/services/roster';
import { t } from '@/lib/i18n';
import { initialsOf } from '@/utils/initials';

/**
 * Today's members of one team as lines: `Ime`, `Ime · čin`, `Ime · položaj`
 * or `Ime · čin · položaj`, each beside its initials. Shared by the roster
 * (`/smjene/$id`, story 1.8) and the member directory on `/ljudi` (story
 * 7.17), so the two say a person the same way.
 *
 * READ-ONLY: no link, no field, no write. `shown` and `positionShown` are the
 * organization's setting; with it off, a line is the name alone.
 */
export function RosterLines({
  members,
  shown,
  positionShown,
}: {
  readonly members: readonly TeamRosterMember[];
  readonly shown: boolean;
  readonly positionShown: boolean;
}): ReactNode {
  if (members.length === 0) return null;

  return (
    <ul className="grid gap-2">
      {members.map((member) => {
        const initials = initialsOf(member.name);
        const rank = rosterRankMessageKey(member.fireRank, shown);
        const position = rosterPositionMessageKey(member.position, positionShown);
        // WHICH SENTENCE is `rosterLineOf`'s decision, executed in a test.
        const line = rosterLineOf(member.name, rank, position, (key) => t(key));

        return (
          <li key={member.id} className="flex min-w-0 items-center gap-3 text-base">
            {/* EMPTY for a name with no letter, so the names stay aligned. */}
            <Avatar>{initials}</Avatar>
            {/* TEXT, never a colour or an icon: rank and position are words. */}
            <span className="min-w-0 break-words">
              {line.key === null ? line.text : t(line.key, line.values)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
