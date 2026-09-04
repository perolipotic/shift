import { createRoute, redirect } from '@tanstack/react-router';

import { rootRoute } from '@/routes/__root';

/**
 * The deployed root, which is a redirect rather than a screen (story 1.1d).
 *
 * `/` renders nothing of its own: it throws a redirect to `/prijava` before the
 * route loads, so the deployed root is a real screen instead of the blank
 * `<main>` this file used to be. It carries no `component` at all — one would
 * never render, and an unrenderable component reads like a screen someone
 * forgot to finish.
 *
 * `search: true` and `hash: true` carry the current values through rather than
 * dropping them. AD-14 has the host answer every path with `index.html` at 200,
 * so `/?invite=…#section` is a shape a real link can take, and a redirect that
 * discarded them would make those parameters unrecoverable — silently, since
 * the user lands on a working screen either way. They cost nothing today (no
 * route declares a search schema) and are the only chance to keep them.
 *
 * This is the one seam story 1.3 turns conditional: a session check there
 * chooses between `/prijava` and the signed-in landing destination, in this
 * function, without any other route learning about authentication. Whichever
 * way it goes, `/` must keep resolving to something — a conditional that falls
 * through to no redirect and no component is the blank page again.
 */
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/prijava', search: true, hash: true });
  },
});
