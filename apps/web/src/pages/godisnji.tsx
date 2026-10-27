import { Link, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CalendarPlus } from 'lucide-react';
import { useCallback } from 'react';

import { OfflineNote } from '@/components/offline-note';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { LeaveOverviewBody } from '@/features/leave/components/leave-overview-body';
import { MyLeaveBody } from '@/features/leave/components/my-leave-body';
import { MyLeaveRequests } from '@/features/leave/components/my-leave-requests';
import { MyLeaveSkeleton } from '@/features/leave/components/my-leave-skeleton';
import { useLeaveOverview, type GodisnjiNavigate } from '@/features/leave/hooks/use-leave-overview';
import { useMyLeave } from '@/features/leave/hooks/use-my-leave';
import { useMyLeaveRequests } from '@/features/leave/hooks/use-my-leave-requests';
import {
  GODISNJI_LOADING,
  GODISNJI_OVERVIEW,
  GODISNJI_OWN,
  godisnjiSearchOf,
  godisnjiSearchRewriteOf,
  type GodisnjiSearch,
} from '@/features/leave/services/leave-overview';
import { MY_LEAVE_READY, leaveRequestSentValuesOf } from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { keepFocusOnAlert } from '@/utils/retry-focus';

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
 * The overview's search, chips and sort live in the URL:
 * `?trazi=&smjena=&stanje=&sort=`, the sort one of
 * `ime|smjena|pravo|iskoristeno|preostalo`, `-` for descending, the state one
 * of `na-godisnjem|upisano|bez-upisa|u-minusu` (E884); a bad value falls back
 * to its default and is rewritten out of the URL. The path drops the diacritics the label
 * carries: a URL segment is not a label, and `hr.json` is where the `š`
 * belongs.
 *
 * STORY 9.3: a member's view also offers *Zatraži godišnji*, which opens the
 * request form at `/godisnji/zatrazi`, and lists the member's own requests
 * with their status — a pending one with *Povuci zahtjev* — and, after a
 * landed send, a status line naming the range. An admin's view does not.
 *
 * STORY 8.2b: offline, the whole cached snapshot — the overview's, or a
 * member's own figures' — is drawn under the as-of note (`OfflineNote`, under
 * the heading), its time the oldest of the reads it stands on.
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
      <OfflineNote offline={screen.offline} />
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
              {screen.retryable ? (
                <Button
                  ref={keepFocusOnAlert}
                  className="h-11 w-full sm:w-auto sm:justify-self-start"
                  type="button"
                  variant="outline"
                  onClick={screen.retry}
                >
                  {t('godisnji.retry')}
                </Button>
              ) : null}
            </div>
          )}
        </Card>
      )}
    </main>
  );
}

/**
 * A member-role session's *Godišnji*: their own three figures, as since story
 * 5.2c, and since story 9.3 *Zatraži godišnji* (offered once the figures are
 * ready, which the form previews against), the sent line and their own
 * requests, which stand on their own read whatever the figures' state.
 */
function GodisnjiOwn() {
  const { leave, loading, offline, retryable, retry } = useMyLeave();
  const requests = useMyLeaveRequests(leave);
  const { sent, sentField } = requests;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.godisnji')}</h1>
        </PageTitle>
        {leave.kind === MY_LEAVE_READY ? (
          <PageActions>
            <Button asChild className="h-11">
              <Link to="/godisnji/zatrazi">
                <CalendarPlus aria-hidden />
                {t('godisnji.request.action')}
              </Link>
            </Button>
          </PageActions>
        ) : null}
      </PageHeader>
      <OfflineNote offline={offline} />
      {sent === null ? null : (
        <Notice ref={sentField} role="status" tabIndex={-1}>
          {t('godisnji.request.sent', leaveRequestSentValuesOf(sent))}
        </Notice>
      )}
      <Card className="min-w-0 p-4">
        <MyLeaveBody leave={leave} retryable={retryable} onRetry={retry} />
      </Card>
      {requests.list === null ? null : (
        <Card className="min-w-0 p-4">
          <MyLeaveRequests
            list={requests.list}
            retryable={requests.retryable}
            pendingId={requests.pendingId}
            refusal={requests.refusal}
            withdrawn={requests.withdrawn}
            outcomeField={requests.outcomeField}
            listHeading={requests.listHeading}
            onWithdraw={(row) => {
              void requests.withdraw(row);
            }}
            onRetry={requests.retry}
          />
        </Card>
      )}
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
