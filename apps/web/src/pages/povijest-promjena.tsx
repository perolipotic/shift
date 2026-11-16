import { createRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

import { Card } from '@/components/ui/card';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { HistoryBody } from '@/features/history/components/history-body';
import { useChangeHistory, type HistoryNavigate } from '@/features/history/hooks/use-change-history';
import {
  historyLocationRewriteOf,
  historySearchOf,
  type HistorySearch,
} from '@/features/history/services/history-search';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Povijest promjena` — the change history (story 14.2; CAP-24; D4). An
 * admin reads who changed what, and when, in one period: *Vrijeme*,
 * *Autor*, *Vrsta*, *Predmet* and *Bilo → sada*, newest first, narrowed by
 * Razdoblje, Osoba, Smjena and Vrsta. This file composes the screen; the
 * wiring is `useChangeHistory`, every rule is in `features/history/services`
 * and `@shift/domain`'s history, which the node suites execute.
 *
 * ADMIN ONLY: the shared admin guard forwards a member, or a level that
 * cannot be read, to the first destination; and RLS returns nothing to
 * anybody but an active admin anyway (0061).
 *
 * ONLINE ONLY: not an offline-readable path, and nothing it reads is kept on
 * the device.
 *
 * THE URL is `?razdoblje=&osoba=&smjena=&vrsta=`; a value of the wrong shape
 * is rewritten out, replacing the entry, and so is a period, person, team or
 * kind the period does not offer (the hook).
 */
export function PovijestPromjenaScreen() {
  const search = povijestPromjenaRoute.useSearch();
  const navigate = useNavigate({ from: povijestPromjenaRoute.fullPath });
  const write = useCallback<HistoryNavigate>(
    (next, { replace }) => {
      void navigate({ search: next, replace });
    },
    [navigate],
  );
  const screen = useChangeHistory(search, write);
  // A VALUE OF THE WRONG SHAPE (`?razdoblje=abc`, `?vrsta=x`) or a key the
  // page does not read is rewritten out of the URL, replacing the entry. The
  // location's search is the URL's own, before `validateSearch` cleaned it.
  const raw = useLocation({ select: (location) => location.search });

  useEffect(() => {
    const rewrite = historyLocationRewriteOf(raw);

    if (rewrite !== null) write(rewrite, { replace: true });
  }, [raw, write]);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={screen.loading}>
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('nav.povijestPromjena')}</h1>
          </PageTitle>
          <PageDescription>{t('history.lede')}</PageDescription>
        </div>
      </PageHeader>
      <Card className="min-w-0">
        <HistoryBody screen={screen} />
      </Card>
    </main>
  );
}

export const povijestPromjenaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/povijest-promjena',
  validateSearch: (search: Record<string, unknown>): HistorySearch => historySearchOf(search),
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: PovijestPromjenaScreen,
});
