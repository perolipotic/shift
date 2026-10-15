import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import type { MemberTeam } from '@/features/members/services/list';
import { ownTeamLineMessageKey } from '@/features/teams/services/roster';
import { t } from '@/lib/i18n';

/**
 * The viewer's team today (story 1.8's line, kept by 6.1a): "Tvoja smjena"
 * and the team's name, linked to its roster, or "Bez smjene" — inside the
 * today card, from the calendar snapshot (`TodayView.ownTeam`).
 */
export function OwnTeamLine({ team }: { readonly team: MemberTeam | null }): ReactNode {
  return (
    <p className="flex flex-wrap items-center gap-x-2 border-t pt-3">
      <span className="text-muted-foreground">{t(ownTeamLineMessageKey({ team }))}</span>
      {team === null ? null : <OwnTeamLink team={team} />}
    </p>
  );
}

/** THE ONE LINK to the roster of the viewer's team: in the member's today card, or the admin's subtitle. */
export function OwnTeamLink({ team }: { readonly team: MemberTeam }): ReactNode {
  return (
    <Link
      to="/smjene/$id"
      params={{ id: team.id }}
      className="inline-flex h-11 items-center break-words font-medium underline underline-offset-4"
    >
      {team.name}
    </Link>
  );
}
