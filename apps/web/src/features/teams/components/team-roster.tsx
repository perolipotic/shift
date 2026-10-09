import type { ReactNode } from 'react';

import { RosterLines } from '@/features/teams/components/roster-lines';
import type { TeamRosterScreen } from '@/features/teams/hooks/use-team-roster';
import type { TeamRoster as TeamRosterAnswer } from '@/features/teams/services/roster';
import { t } from '@/lib/i18n';

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
        <RosterLines members={team.members} shown={shown} positionShown={positionShown} />
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
