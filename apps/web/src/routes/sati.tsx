import { createRoute } from '@tanstack/react-router';

import { t } from '@/i18n';
import { appLayoutRoute } from '@/routes/_app';

/**
 * `Sati` — a titled placeholder, and nothing more.
 *
 * ONE destination, not two. UX-DR31 lists `Sati` for the member role and
 * UX-DR32 lists it again for an admin; the human decision of 2026-09-04 resolved
 * that overlap as one destination whose CONTENT is role-scoped, which is why
 * there are eight routes here and not nine.
 *
 * It renders its own `nav.sati` heading and no other element, because the
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
export function SatiScreen() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <h1 className="text-xl font-semibold leading-none tracking-tight">{t('nav.sati')}</h1>
    </main>
  );
}

export const satiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/sati',
  component: SatiScreen,
});
