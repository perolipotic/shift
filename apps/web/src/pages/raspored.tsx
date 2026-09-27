import { createRoute, redirect } from '@tanstack/react-router';

import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Raspored` — a titled placeholder, and nothing more.
 *
 * ADMIN ONLY (UX-DR32). The navigation never offers it to a member
 * (`@/features/navigation/utils/destinations`), and the route carries the admin
 * guard `/ljudi/smjene` does, so a member who types this URL is forwarded
 * rather than shown an admin screen shell. `router.test.ts` derives the guarded
 * routes from the destination table's `ADMIN_ONLY` rows and drives this copy.
 *
 * It renders its own `nav.raspored` heading and no other element, because the
 * destination it names is a LATER story's and putting anything else here would
 * be that story's work done without its review. What this file is for is that
 * the route EXISTS: TanStack Router typechecks `<Link to>` against the route
 * tree, so part B's navigation cannot compile until every destination it points
 * at is registered.
 *
 * No literal — the heading resolves through `t()` (L1/L2), and the key was
 * authored in `hr.json` first because `lib/i18n/index.ts` types the argument off
 * that file.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function RasporedScreen() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.raspored')}</h1>
        </PageTitle>
      </PageHeader>
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
