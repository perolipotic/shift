import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { t } from '@/i18n';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';
import {
  TEAM_ROSTER_KEY,
  TEAM_ROSTER_READ_STALE_MS,
  readTeamRoster,
  teamRosterMessageKey,
  teamRosterSurfaceStateOf,
  type TeamRoster,
  type TeamRosterRpc,
} from '@/teams/roster';

/**
 * `/smjene/$id` — who is on one team today, for every role (story 1.8).
 *
 * READ-ONLY AND NOT A DESTINATION. It is reached from the Danas line naming the
 * caller's own team, and from nowhere else; the session guard on the `_app`
 * layout is the only guard it needs, because the database decides what a
 * session may read (`team_roster`, `0011`).
 *
 * ONE READ UNDER ONE KEY (AD-13): the team's name, its archived flag and its
 * members all come from the single RPC, so the heading and the count can never
 * disagree with the names beside them.
 *
 * KEYED BY THE ROUTE'S ID, as `/ljudi/smjene/$id` is, so moving between two
 * teams remounts the screen and starts it clean.
 *
 * THIS FILE HOLDS MARKUP. Every rule is in `@/teams/roster`, which the node
 * suite executes.
 */

const SKELETON_ROWS = [0, 1, 2];

export function SmjenaScreen() {
  const { id } = smjenaRoute.useParams();

  return <RosterScreen key={id} id={id} />;
}

function RosterScreen({ id }: { readonly id: string }) {
  const answer = useQuery({
    queryKey: TEAM_ROSTER_KEY(id),
    queryFn: () => readTeamRoster(supabaseClient() as unknown as TeamRosterRpc, id),
    staleTime: TEAM_ROSTER_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const { roster, refusal, loading } = teamRosterSurfaceStateOf(answer);

  function renderRoster(team: TeamRoster): ReactNode {
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
            {team.members.map((member) => (
              <li key={member.id} className="break-words text-base">
                {member.name}
              </li>
            ))}
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

  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full min-w-0 max-w-lg">
        <CardHeader>
          <h1 className="break-words text-xl font-semibold leading-none tracking-tight">
            {roster === null ? t('smjene.heading') : roster.name}
          </h1>
        </CardHeader>
        <CardContent className="grid gap-6">
          {refusal === null ? null : (
            <p role="alert" className="rounded-md border border-input px-3 py-2 text-sm font-medium">
              {t(teamRosterMessageKey(refusal))}
            </p>
          )}
          {renderBody()}
          <Button asChild className="h-11 w-full" variant="outline">
            <Link to="/danas">{t('smjene.roster.back')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export const smjenaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/smjene/$id',
  component: SmjenaScreen,
});
