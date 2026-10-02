import { createRoute, redirect } from '@tanstack/react-router';

import { Card } from '@/components/ui/card';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { ConflictsBody } from '@/features/conflicts/components/conflicts-body';
import { useConflictsQueue } from '@/features/conflicts/hooks/use-conflicts-queue';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
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
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function RasporedScreen() {
  const { queue, saved, savedField, loading, retry } = useConflictsQueue();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.raspored')}</h1>
        </PageTitle>
      </PageHeader>
      <Card className="min-w-0 p-4">
        <ConflictsBody queue={queue} saved={saved} savedField={savedField} onRetry={retry} />
      </Card>
    </main>
  );
}

export const rasporedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/raspored',
  /** The guard `/ljudi/smjene` carries, copied verbatim; `router.test.ts` drives it. */
  beforeLoad: async ({ context }) => {
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) return;

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
  component: RasporedScreen,
});
