import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { currentSession, supabaseClient } from '@/lib/supabase/client';
import {
  OWN_TEAM_KEY,
  OWN_TEAM_TABLE,
  TEAM_ROSTER_READ_STALE_MS,
  ownTeamLineMessageKey,
  ownTeamMessageKey,
  ownTeamSurfaceStateOf,
  readOwnTeamToday,
  type OwnTeamLine,
} from '@/features/teams/services/roster';
import { TodayBody } from '@/features/today/components/today-body';
import { useToday } from '@/features/today/hooks/use-today';

/**
 * `Danas` — the heading with today's weekday and date, today in words, the
 * next shift and the next seven days (story 6.1a), and one line naming the
 * caller's team today.
 *
 * Member and admin alike (UX-DR31/UX-DR32): an admin on a team reads the
 * same screen; story 6.3 replaces the admin's.
 *
 * STORY 6.1a ADDS THE CARDS above the line, in phone priority order. Their
 * reads and state are `useToday`, their rules
 * `@/features/today/services/today`, which the node suite executes, and
 * their markup `@/features/today/components`.
 *
 * STORY 1.8 ADDS THE LINE and nothing else: "Tvoja smjena" and the team's name,
 * linked to that team's roster, or "Bez smjene" when the caller is on no team
 * today. The rest of this destination is a later story's.
 *
 * ONE READ UNDER ONE KEY (AD-13): the caller's own `members` row with its team
 * history embedded, read and derived by `@/features/teams/services/roster` — the same parser and
 * the same derivation the member list uses, as at the organization's today.
 *
 * No literal — every string resolves through `t()` (L1/L2).
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */
export function DanasScreen() {
  const { today, date, loading: todayLoading, retry } = useToday();
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

  /** The heading's subline: today's weekday and date, its placeholder while loading, or nothing. */
  function renderDateLine(): ReactNode {
    if (date !== null) {
      return (
        <PageDescription className="tabular-nums">
          {t('danas.dateLine', { weekday: date.weekday, date: date.text })}
        </PageDescription>
      );
    }

    return todayLoading ? <div aria-hidden className="mt-1.5 h-5 w-48 max-w-full animate-pulse rounded-sm bg-muted" /> : null;
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={todayLoading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.danas')}</h1>
        </PageTitle>
        {renderDateLine()}
      </PageHeader>
      <div className="grid w-full min-w-0 max-w-lg gap-4">
        <TodayBody today={today} onRetry={retry} />
      </div>
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
