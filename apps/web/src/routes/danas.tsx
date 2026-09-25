import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/i18n';
import { appLayoutRoute } from '@/routes/_app';
import { currentSession, supabaseClient } from '@/supabase/client';
import {
  OWN_TEAM_KEY,
  OWN_TEAM_TABLE,
  TEAM_ROSTER_READ_STALE_MS,
  ownTeamLineMessageKey,
  ownTeamMessageKey,
  ownTeamSurfaceStateOf,
  readOwnTeamToday,
  type OwnTeamLine,
} from '@/teams/roster';

/**
 * `Danas` — the heading, and one line naming the caller's team today.
 *
 * Member and admin alike (UX-DR31/UX-DR32).
 *
 * STORY 1.8 ADDS THE LINE and nothing else: "Tvoja smjena" and the team's name,
 * linked to that team's roster, or "Bez smjene" when the caller is on no team
 * today. The rest of this destination is a later story's.
 *
 * ONE READ UNDER ONE KEY (AD-13): the caller's own `members` row with its team
 * history embedded, read and derived by `@/teams/roster` — the same parser and
 * the same derivation the member list uses, as at the organization's today.
 *
 * No literal — every string resolves through `t()` (L1/L2).
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */
export function DanasScreen() {
  const answer = useQuery({
    queryKey: OWN_TEAM_KEY,
    queryFn: () => readOwnTeamToday(supabaseClient().from(OWN_TEAM_TABLE), currentSession),
    staleTime: TEAM_ROSTER_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const { line, refusal, loading } = ownTeamSurfaceStateOf(answer, new Date());

  function renderLine(shown: OwnTeamLine): ReactNode {
    if (shown.team === null) {
      return <p className="text-base">{t(ownTeamLineMessageKey(shown))}</p>;
    }

    return (
      <p className="flex flex-wrap items-center gap-x-2 text-base">
        <span>{t(ownTeamLineMessageKey(shown))}</span>
        <Link
          to="/smjene/$id"
          params={{ id: shown.team.id }}
          className="inline-flex h-11 items-center break-words font-medium underline underline-offset-4"
        >
          {shown.team.name}
        </Link>
      </p>
    );
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.danas')}</h1>
        </PageTitle>
      </PageHeader>
      {/* ONE CARD, holding the refusal as the form screens hold theirs, then
          the line or its skeleton while it loads. */}
      <Card className="w-full min-w-0 max-w-lg">
        <CardContent className="grid gap-4">
          {refusal === null ? null : <Notice role="alert">{t(ownTeamMessageKey(refusal))}</Notice>}
          {line === null ? null : renderLine(line)}
          {line === null && loading ? (
            <div className="h-11 w-48 max-w-full animate-pulse rounded-md bg-muted" />
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

export const danasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/danas',
  component: DanasScreen,
});
