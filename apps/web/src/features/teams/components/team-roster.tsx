import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { rosterLineOf, rosterPositionMessageKey } from '@/features/members/utils/position';
import { rosterRankMessageKey } from '@/features/members/utils/rank';
import type { TeamRosterScreen } from '@/features/teams/hooks/use-team-roster';
import type { TeamRoster as TeamRosterAnswer } from '@/features/teams/services/roster';
import { t } from '@/lib/i18n';
import { initialsOf } from '@/utils/initials';

const SKELETON_ROWS = [0, 1, 2];

/**
 * The roster's body below the page's refusal: the team's members once the one
 * read has answered, the skeleton while it is pending, and nothing after a
 * refusal. READ-ONLY: no form, no field and no write.
 *
 * The two helpers are declared inside the component, at its two-space
 * indentation, so the sign-in suite's scoped extraction reads each one.
 */
export function TeamRoster({ screen }: { readonly screen: TeamRosterScreen }): ReactNode {
  const { roster, loading, shown, positionShown } = screen;

  function renderRoster(team: TeamRosterAnswer): ReactNode {
    return (
      <div className="grid gap-4">
        {team.archived ? (
          <p className="text-sm text-muted-foreground">{t('smjene.roster.archived')}</p>
        ) : null}
        <p className="text-sm font-medium">
          {t('smjene.roster.count', { count: team.members.length })}
        </p>
        {team.members.length === 0 ? null : (
          <ul className="grid gap-2">
            {team.members.map((member) => {
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
        )}
      </div>
    );
  }

  function renderBody(): ReactNode {
    if (roster !== null) return renderRoster(roster);

    return loading ? (
      <div className="grid gap-2">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="h-6 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    ) : null;
  }

  return renderBody();
}
