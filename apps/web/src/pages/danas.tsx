import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

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
import { AdminTodayBody } from '@/features/today/components/admin-today-body';
import { TodayBody } from '@/features/today/components/today-body';
import { useTodayRole } from '@/features/today/hooks/use-admin-today';
import { useToday } from '@/features/today/hooks/use-today';
import {
  STATUS_DUTY,
  STATUS_UNSCHEDULED,
  STATUS_WORKING,
  adminStatusMessageKey,
  adminStatusOf,
  adminStatusShiftMessageKey,
  showsAdminToday,
  type AdminStatus,
} from '@/features/today/services/admin-today';

/**
 * `Danas` — the heading with today's weekday and date, today in words, the
 * next shift and the next seven days (story 6.1a), the month's hours and the
 * leave balance (story 6.1b), and, below them, one line naming the caller's
 * team today.
 *
 * STORY 6.3 GIVES AN ADMIN THEIR OWN BODY (UX-DR31/UX-DR32): *Treba tebe*,
 * today's coverage, who is absent and the week, with their reads and rules
 * in `AdminTodayBody` and `@/features/today/services/admin-today`. The page
 * only PICKS the body — by the snapshot's role, or the chrome's cached one
 * before it lands (`useTodayRole`) — and states the admin's own today as one
 * line in the subtitle, from `useToday`'s case, with their team as the same
 * one link to its roster — none while they are on no team. No "Tvoja
 * smjena" card for an admin, but the own-team read's refusal still shows,
 * above their body, so the missing link is explained. `main` is busy while
 * either body's reads are pending.
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
  const { today, tiles, date, role: snapshotRole, loading: todayLoading, retry } = useToday();
  const admin = showsAdminToday(useTodayRole(snapshotRole));
  // Whether the admin body's own reads are pending: `main` is busy then too.
  const [adminBusy, setAdminBusy] = useState(false);
  const answer = useQuery({
    queryKey: OWN_TEAM_KEY,
    queryFn: () => readOwnTeamToday(supabaseClient().from(OWN_TEAM_TABLE), currentSession),
    staleTime: TEAM_ROSTER_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const { line, refusal, loading } = ownTeamSurfaceStateOf(answer, new Date());

  /** THE ONE LINK, to the roster of the team the line names: in the member's card, or the admin's subtitle. */
  function renderTeamLink(shown: OwnTeamLine): ReactNode {
    if (shown.team === null) return null;

    return (
      <Link
        to="/smjene/$id"
        params={{ id: shown.team.id }}
        className="inline-flex h-11 items-center break-words font-medium underline underline-offset-4"
      >
        {shown.team.name}
      </Link>
    );
  }

  function renderLine(shown: OwnTeamLine): ReactNode {
    if (shown.team === null) {
      return <p className="text-base">{t(ownTeamLineMessageKey(shown))}</p>;
    }

    return (
      <p className="flex flex-wrap items-center gap-x-2 text-base">
        <span>{t(ownTeamLineMessageKey(shown))}</span>
        {renderTeamLink(shown)}
      </p>
    );
  }

  /** The admin's own today in words: each shift worked, the duty's end, leave, free, or no team. */
  function statusText(status: AdminStatus): string {
    if (status.kind === STATUS_WORKING) {
      return status.shifts
        .map((shift) =>
          t(adminStatusShiftMessageKey(shift), { type: shift.name ?? t('kalendar.noRotation'), range: shift.range }),
        )
        .join(t('danas.admin.separator'));
    }

    if (status.kind === STATUS_DUTY) return t(adminStatusMessageKey(status.kind), { time: status.until });

    return t(adminStatusMessageKey(status.kind));
  }

  /**
   * The heading's subline: today's weekday and date — for an admin, then
   * their own today and their team's link — its placeholder while loading,
   * or nothing.
   */
  function renderDateLine(): ReactNode {
    if (date !== null && admin) {
      const status = adminStatusOf(today);

      return (
        <PageDescription className="flex flex-wrap items-center gap-x-2 tabular-nums">
          <span>
            {status === null
              ? t('danas.dateLine', { weekday: date.weekday, date: date.text })
              : t('danas.admin.subtitle', { weekday: date.weekday, date: date.text, status: statusText(status) })}
          </span>
          {status === null || status.kind === STATUS_UNSCHEDULED || line === null || line.team === null ? null : (
            <>
              <span aria-hidden>{t('danas.admin.separator')}</span>
              {renderTeamLink(line)}
            </>
          )}
        </PageDescription>
      );
    }

    if (date !== null) {
      return (
        <PageDescription className="tabular-nums">
          {t('danas.dateLine', { weekday: date.weekday, date: date.text })}
        </PageDescription>
      );
    }

    return todayLoading ? <div aria-hidden className="mt-1.5 h-5 w-48 max-w-full animate-pulse rounded-sm bg-muted" /> : null;
  }

  /** The own-team read's refusal: in the member's card, or above the admin's body. */
  function renderRefusal(): ReactNode {
    return refusal === null ? null : <Notice role="alert">{t(ownTeamMessageKey(refusal))}</Notice>;
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={todayLoading || (admin && adminBusy)}
    >
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.danas')}</h1>
        </PageTitle>
        {renderDateLine()}
      </PageHeader>
      {admin ? (
        <div className="grid w-full min-w-0 max-w-3xl grid-cols-1 gap-4">
          {renderRefusal()}
          <AdminTodayBody onBusy={setAdminBusy} />
        </div>
      ) : (
        <>
          <div className="grid w-full min-w-0 max-w-lg gap-4">
            <TodayBody today={today} tiles={tiles} onRetry={retry} />
          </div>
          {/* ONE CARD, holding the refusal as the form screens hold theirs, then
              the line or its skeleton while it loads. */}
          <Card className="w-full min-w-0 max-w-lg">
            <CardContent className="grid gap-4">
              {renderRefusal()}
              {line === null ? null : renderLine(line)}
              {line === null && loading ? (
                <div className="h-11 w-48 max-w-full animate-pulse rounded-md bg-muted" />
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

export const danasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/danas',
  component: DanasScreen,
});
