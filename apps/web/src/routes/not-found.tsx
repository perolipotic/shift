import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/**
 * What an unknown path renders (story 1.1d).
 *
 * A COMPONENT, not a route, and that distinction is load-bearing. AD-14 has the
 * host answer every path with `index.html` at 200, so the client is what decides
 * a path is unknown — and `router.test.ts` pins that decision as `_notFound`
 * being true on the ROOT match, at index 0. A catch-all route (`/$`) would
 * satisfy the URL and invert that: the chain would end in `/$` and `_notFound`
 * would go falsy, so the guard would pass while asserting the opposite of its
 * purpose. `notFoundComponent` on the root route changes no route id and no
 * `matchRoutes` output.
 *
 * RE-DERIVED by the navigation shell's route skeleton, which is when the
 * original wording — `matchRoutes('/kalendar/2026-09/does-not-exist')` yielding
 * `['__root__']` — stopped being true. `/kalendar` is a registered route now, so
 * that path's chain carries the prefix matches behind the root. The claim that
 * matters was never the length of the chain but which match owns the not-found,
 * and `Outlet` renders that match's `notFoundComponent` without descending past
 * it — so this component still renders, and `router.test.ts` keeps a path with
 * no registered prefix as the case that still resolves to `['__root__']` alone.
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
