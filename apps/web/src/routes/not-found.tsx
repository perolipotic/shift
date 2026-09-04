import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/**
 * What an unknown path renders (story 1.1d).
 *
 * A COMPONENT, not a route, and that distinction is load-bearing. AD-14 has the
 * host answer every path with `index.html` at 200, so the client is what decides
 * a path is unknown — and `router.test.ts` pins that decision as
 * `matchRoutes('/kalendar/2026-09/does-not-exist')` yielding `['__root__']` with
 * `_notFound === true`. A catch-all route (`/$`) would satisfy the URL and
 * invert that assertion: the list would gain a second id and `_notFound` would
 * go falsy, so the guard would pass while asserting the opposite of its purpose.
 * `notFoundComponent` on the root route changes no route id and no
 * `matchRoutes` output.
 *
 * The link names where it goes rather than a destination: the navigation shell
 * owns every destination label, and this story ships no destination.
 */
export function NotFoundScreen() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-xl font-semibold leading-none tracking-tight">{t('notFound.heading')}</h1>
      <Button asChild className="h-11">
        <Link to="/prijava">{t('notFound.back')}</Link>
      </Button>
    </main>
  );
}
