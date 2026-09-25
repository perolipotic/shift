import { createRoute } from '@tanstack/react-router';

import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/i18n';
import { appLayoutRoute } from '@/routes/_app';

/**
 * `Kalendar` — a titled placeholder, and nothing more.
 *
 * Member and admin alike (UX-DR31/UX-DR32). The path this screen registers is
 * also the one `router.test.ts`'s unmatched-deep-link assertion names, and
 * registering it CHANGED that assertion — verified by running rather than by
 * reasoning, which is the only way it could have been noticed. Against the flat
 * tree `/kalendar/2026-09/does-not-exist` resolved to `['__root__']` alone;
 * `/kalendar` is a real route now, so TanStack matches the prefix and the chain
 * is `['__root__', '/_app', '/_app/kalendar']`. The single-match shape survives
 * only for a path with no registered prefix at all, which `router.test.ts` keeps
 * as its own case.
 *
 * What did NOT move is which match owns the not-found: `_notFound` stays on the
 * root at index 0, and `Outlet` renders that match's `notFoundComponent` without
 * descending past it, so the screen is still `NotFoundScreen` and this heading
 * never appears on a URL it does not own.
 *
 * It renders its own `nav.kalendar` heading and no other element, because the
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
export function KalendarScreen() {
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.kalendar')}</h1>
        </PageTitle>
      </PageHeader>
    </main>
  );
}

export const kalendarRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/kalendar',
  component: KalendarScreen,
});
