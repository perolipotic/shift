import { describe, expect, it } from 'vitest';

import { router } from '@/router';

/**
 * The shell's route tree, asserted in the node environment (AD-15).
 *
 * There is no jsdom, so nothing here renders — and nothing needs to. What can
 * silently break without a render is the wiring: a route that never joins the
 * tree, or a tree the router cannot resolve a path against. Both would ship a
 * blank page that no test noticed.
 */

/** `matchRoutes` is the resolution path `RouterProvider` itself takes. */
function match(pathname: string): { routeId: string; _notFound?: boolean }[] {
  return (
    router as unknown as {
      matchRoutes: (path: string, search: object) => { routeId: string; _notFound?: boolean }[];
    }
  ).matchRoutes(pathname, {});
}

describe('the shell route tree', () => {
  it('assembles the root route and its one child', () => {
    expect(Object.keys(router.routesById).sort()).toEqual(['/', '__root__']);
  });

  it('resolves / to the index route inside the root layout', () => {
    expect(match('/').map((matched) => matched.routeId)).toEqual(['__root__', '/']);
  });

  // AD-14: the host answers every unmatched path with index.html at 200, so the
  // client router is what decides an unknown path is unknown. It must land on
  // the root layout and report not-found — never fail to resolve at all, which
  // is how a deep link turns into a blank page.
  it('lands an unmatched deep link on the root layout and marks it not found', () => {
    const matched = match('/kalendar/2026-09/does-not-exist');

    expect(matched.map((one) => one.routeId)).toEqual(['__root__']);
    expect(matched[0]?._notFound).toBe(true);
  });
});
