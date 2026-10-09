import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { LeaveOverviewBody } from '@/features/leave/components/leave-overview-body';
import { MyLeaveBody } from '@/features/leave/components/my-leave-body';
import { MyLeaveSkeleton } from '@/features/leave/components/my-leave-skeleton';
import { useLeaveOverview, type GodisnjiNavigate } from '@/features/leave/hooks/use-leave-overview';
import { useMyLeave } from '@/features/leave/hooks/use-my-leave';
import {
  GODISNJI_LOADING,
  GODISNJI_OVERVIEW,
  GODISNJI_OWN,
  godisnjiSearchOf,
  godisnjiSearchRewriteOf,
  type GodisnjiSearch,
} from '@/features/leave/services/leave-overview';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Godišnji` — ONE DESTINATION WHOSE CONTENT IS ROLE-SCOPED, as *Sati* is
 * (story 7.15). A member reads their own allowance, the days used in the
 * current leave year and the balance (story 5.2c), and nobody else's. An
 * admin reads the overview of every member active today — *Osoba* (a link to
 * the member page, where leave is recorded), *Smjena*, *Pravo*,
 * *Iskorišteno* and *Preostalo* — and no tiles of their own (decision of
 * 2026-10-09). This file composes the screen; the role gate and the overview
 * are `useLeaveOverview`, the member's tiles `useMyLeave`, and every rule is
 * in `@/features/leave/services/leave-overview` and `.../my-leave`, which the
 * node suite executes.
 *
 * THE ROLE is the calendar snapshot's (`snapshot.viewer.role`), read inside
 * the hook — no `beforeLoad` read. A member's session never asks for the
 * overview's records, and the database refuses it if it did (0034). An
 * unknown role is the unavailable notice, never the overview.
 *
 * The overview's search and sort live in the URL: `?trazi=&sort=`, the sort
 * one of `ime|smjena|pravo|iskoristeno|preostalo`, `-` for descending; a bad
 * value falls back to its default and is rewritten out of the URL. The path drops the diacritics the label
 * carries: a URL segment is not a label, and `hr.json` is where the `š`
 * belongs.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */
export function GodisnjiScreen() {
  const search = godisnjiRoute.useSearch();
  const navigate = useNavigate({ from: godisnjiRoute.fullPath });
  // ONE FUNCTION FOR THE SCREEN'S LIFE: typing replaces the entry, a sort pushes one.
  const write = useCallback<GodisnjiNavigate>(
    (next, { replace }) => {
      void navigate({ search: next, replace });
    },
    [navigate],
  );
  const screen = useLeaveOverview(search, write);

  if (screen.view === GODISNJI_OWN) {
    return <GodisnjiOwn />;
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={screen.view === GODISNJI_LOADING || screen.loading}
    >
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('nav.godisnji')}</h1>
          </PageTitle>
          {screen.view === GODISNJI_OVERVIEW ? <PageDescription>{t('godisnji.overview.lede')}</PageDescription> : null}
        </div>
      </PageHeader>
      {screen.view === GODISNJI_OVERVIEW ? (
        <Card className="min-w-0">
          <LeaveOverviewBody screen={screen} />
        </Card>
      ) : (
        <Card className="min-w-0 p-4">
          {screen.view === GODISNJI_LOADING ? (
            <MyLeaveSkeleton />
          ) : (
            <div className="grid min-w-0 gap-2">
              <Notice role="alert">{t('godisnji.unavailable')}</Notice>
              <Button
                className="h-11 w-full sm:w-auto sm:justify-self-start"
                type="button"
                variant="outline"
                onClick={screen.retry}
              >
                {t('godisnji.retry')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </main>
  );
}

/** A member-role session's *Godišnji*: their own three figures, as since story 5.2c. */
function GodisnjiOwn() {
  const { leave, loading, retry } = useMyLeave();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.godisnji')}</h1>
        </PageTitle>
      </PageHeader>
      <Card className="min-w-0 p-4">
        <MyLeaveBody leave={leave} onRetry={retry} />
      </Card>
    </main>
  );
}

export const godisnjiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/godisnji',
  validateSearch: (search: Record<string, unknown>): GodisnjiSearch => godisnjiSearchOf(search),
  // A BAD VALUE IS REWRITTEN OUT of the URL — `?sort=xyz` becomes `/godisnji` —
  // REPLACING the entry, so Back skips it. No read here: the role stays the hook's.
  beforeLoad: ({ location }) => {
    const rewrite = godisnjiSearchRewriteOf(location.search as Record<string, unknown>);

    if (rewrite !== null) throw redirect({ to: '/godisnji', search: rewrite, replace: true });
  },
  component: GodisnjiScreen,
});
