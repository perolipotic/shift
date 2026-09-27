import { Link, createRoute } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageActions, PageHeader, PageTitle } from '@/components/ui/page-header';
import { Notice } from '@/components/ui/notice';
import { TeamRoster } from '@/features/teams/components/team-roster';
import { useTeamRoster } from '@/features/teams/hooks/use-team-roster';
import { teamRosterMessageKey } from '@/features/teams/services/roster';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

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
 * THE RANK BESIDE A NAME (member rank) is shown only when the organization
 * uses fire ranks, from the one organization snapshot under its shared key.
 * Until it arrives, or if it fails, the roster shows names only.
 *
 * THIS FILE COMPOSES (source structure B7). The two reads and their
 * derivations are `useTeamRoster`; the members are
 * `@/features/teams/components/team-roster`; every rule is in
 * `@/features/teams/services/roster`, which the node suite executes.
 */

export function SmjenaScreen() {
  const { id } = smjenaRoute.useParams();

  return <RosterScreen key={id} id={id} />;
}

function RosterScreen({ id }: { readonly id: string }) {
  const screen = useTeamRoster(id);
  const { roster, refusal } = screen;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <PageTitle asChild>
          <h1>{roster === null ? t('smjene.heading') : roster.name}</h1>
        </PageTitle>
        <PageActions>
          <Button asChild className="h-11" variant="outline">
            <Link to="/danas">{t('smjene.roster.back')}</Link>
          </Button>
        </PageActions>
      </PageHeader>
      <Card className="w-full min-w-0 max-w-lg">
        <CardContent className="grid gap-6">
          {refusal === null ? null : (
            <Notice role="alert">
              {t(teamRosterMessageKey(refusal))}
            </Notice>
          )}
          <TeamRoster screen={screen} />
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
