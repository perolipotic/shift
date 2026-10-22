import { createRoute } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';

import { OfflineNote } from '@/components/offline-note';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { AdminTodayBody } from '@/features/today/components/admin-today-body';
import { TodayBody } from '@/features/today/components/today-body';
import { useTodayRole } from '@/features/today/hooks/use-admin-today';
import { OwnTeamLink } from '@/features/today/components/own-team-line';
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
 * `Danas` — the heading with today's weekday and date, today in words (its
 * card closing on the caller's team today), the next shift and the next
 * seven days (story 6.1a), and the month's hours and the leave balance
 * (story 6.1b).
 *
 * STORY 6.3 GIVES AN ADMIN THEIR OWN BODY (UX-DR31/UX-DR32): *Treba tebe*,
 * today's coverage, who is absent and the week, with their reads and rules
 * in `AdminTodayBody` and `@/features/today/services/admin-today`. The page
 * only PICKS the body — by the snapshot's role, or the chrome's cached one
 * before it lands (`useTodayRole`) — and states the admin's own today as one
 * line in the subtitle, from `useToday`'s case, with their team as the same
 * one link to its roster — none while they are on no team. `main` is busy
 * while either body's reads are pending.
 *
 * STORY 6.1a ADDS THE CARDS, in phone priority order. Their reads and state
 * are `useToday`, their rules `@/features/today/services/today`, which the
 * node suite executes, and their markup `@/features/today/components`.
 *
 * STORY 1.8'S LINE — "Tvoja smjena" and the team's name, linked to that
 * team's roster, or "Bez smjene" — sits in the today card and comes from the
 * calendar snapshot like everything else on the screen (AD-13: one fact, one
 * read): the viewer's membership history, judged at the organization's today.
 * The member directory keeps its own `OWN_TEAM_KEY` read.
 *
 * STORY 8.2: offline, the whole cached snapshot is drawn under the as-of
 * note (`OfflineNote`, under the heading), its time the oldest of every read
 * the page stands on — an admin's body's included (`useToday`'s freshness).
 *
 * No literal — every string resolves through `t()` (L1/L2).
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */
export function DanasScreen() {
  const { today, tiles, date, ownTeam, role: snapshotRole, loading: todayLoading, offline, retryable, retry } = useToday();
  const admin = showsAdminToday(useTodayRole(snapshotRole));
  // Whether the admin body's own reads are pending: `main` is busy then too.
  const [adminBusy, setAdminBusy] = useState(false);
  // Whether the admin body shows its alert: then no as-of note stands above it.
  const [adminUnavailable, setAdminUnavailable] = useState(false);
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
          {status === null || status.kind === STATUS_UNSCHEDULED || ownTeam === null ? null : (
            <>
              <span aria-hidden>{t('danas.admin.separator')}</span>
              <OwnTeamLink team={ownTeam} />
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
      <OfflineNote offline={admin && adminUnavailable ? null : offline} />
      {admin ? (
        <div className="grid w-full min-w-0 max-w-3xl grid-cols-1 gap-4">
          <AdminTodayBody onBusy={setAdminBusy} onUnavailable={setAdminUnavailable} />
        </div>
      ) : (
        <div className="grid w-full min-w-0 max-w-lg gap-4">
          <TodayBody today={today} tiles={tiles} retryable={retryable} onRetry={retry} />
        </div>
      )}
    </main>
  );
}

export const danasRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/danas',
  component: DanasScreen,
});
