import { createRoute } from '@tanstack/react-router';

import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/i18n';
import { appLayoutRoute } from '@/routes/_app';

/**
 * `Raspored` — a titled placeholder, and nothing more.
 *
 * ADMIN ONLY (UX-DR32). The route itself does not say so — `_app`'s guard asks
 * only whether anyone is signed in, and role enforcement lives in the database
 * (AD-10), never in a route. What decides that a member never SEES this
 * destination is `@/navigation/destinations`, which part B renders from. The
 * decision and its expiry live in `_app.tsx`, where the guard is, and
 * `router.test.ts` pins it.
 *
 * It renders its own `nav.raspored` heading and no other element, because the
 * destination it names is a LATER story's and putting anything else here would
 * be that story's work done without its review. What this file is for is that
 * the route EXISTS: TanStack Router typechecks `<Link to>` against the route
 * tree, so part B's navigation cannot compile until every destination it points
 * at is registered.
 *
 * No literal — the heading resolves through `t()` (L1/L2), and the key was
 * authored in `hr.json` first because `i18n/index.ts` types the argument off
 * that file.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */
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
  component: RasporedScreen,
});
