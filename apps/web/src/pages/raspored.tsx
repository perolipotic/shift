import { createRoute } from '@tanstack/react-router';

import { OfflineNote } from '@/components/offline-note';
import { Card } from '@/components/ui/card';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { ConflictsBody } from '@/features/conflicts/components/conflicts-body';
import { useConflictsQueue } from '@/features/conflicts/hooks/use-conflicts-queue';
import { t } from '@/lib/i18n';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Raspored` — the conflicts queue (story 5.3b): every unresolved collision of
 * leave with a rostered working shift, upcoming soonest first and past ones
 * still listed, with the count shown at zero too. This file composes the
 * screen; its two reads and its state are `useConflictsQueue`, its list is a
 * component in `@/features/conflicts/components`, and every rule is in
 * `@/features/conflicts/services/conflicts-queue`, which the node suite
 * executes.
 *
 * ADMIN ONLY (UX-DR32). The navigation never offers it to a member
 * (`@/features/navigation/utils/destinations`), and the route carries the admin
 * guard `/ljudi/smjene` does, so a member who types this URL is forwarded
 * rather than shown an admin screen. `router.test.ts` derives the guarded
 * routes from the destination table's `ADMIN_ONLY` rows and drives this copy.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 *
 * STORY 8.2c: offline, the queue — and *Riješeni*, once read online — is
 * drawn whole from the device's snapshot under the as-of note (`OfflineNote`,
 * under the heading, on both tabs), or its unavailable state is.
 */

export function RasporedScreen() {
  const { queue, resolved, tab, setTab, saved, savedField, loading, retry, offline } = useConflictsQueue();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.raspored')}</h1>
        </PageTitle>
      </PageHeader>
      <OfflineNote offline={offline} />
      <Card className="min-w-0 p-4">
        <ConflictsBody queue={queue} resolved={resolved} tab={tab} onTab={setTab} saved={saved} savedField={savedField} onRetry={retry} />
      </Card>
    </main>
  );
}

export const rasporedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/raspored',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: RasporedScreen,
});
