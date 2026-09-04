import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';

import { router } from '@/router';
import { indexRoute } from '@/routes/index';
import { NotFoundScreen } from '@/routes/not-found';
import { prijavaRoute, SignInScreen } from '@/routes/prijava';
import { rootRoute } from '@/routes/__root';

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
  it('assembles the root route and its two children', () => {
    // Exhaustive on purpose: a new route has to be added here to exist, which
    // is what makes an accidentally unregistered route a failing test rather
    // than a link that resolves to nothing.
    expect(Object.keys(router.routesById).sort()).toEqual(['/', '/prijava', '__root__']);
  });

  it('resolves / to the index route inside the root layout', () => {
    expect(match('/').map((matched) => matched.routeId)).toEqual(['__root__', '/']);
  });

  it('resolves /prijava to the sign-in route inside the root layout', () => {
    expect(match('/prijava').map((matched) => matched.routeId)).toEqual(['__root__', '/prijava']);
  });

  it('renders SignInScreen on /prijava rather than an empty layout', () => {
    // IDENTITY, the same shape as the `notFoundComponent` assertion below.
    // `matchRoutes` resolves the path from the route id alone, so a `component`
    // swap or removal is invisible to the two assertions above it — the route
    // still resolves, and the screen never renders.
    const registered = (prijavaRoute.options as { component?: unknown }).component;

    expect(registered, '/prijava does not render SignInScreen — it renders an empty layout').toBe(
      SignInScreen,
    );
  });

  // AD-14: the host answers every unmatched path with index.html at 200, so the
  // client router is what decides an unknown path is unknown. It must land on
  // the root layout and report not-found — never fail to resolve at all, which
  // is how a deep link turns into a blank page.
  //
  // UNCHANGED by story 1.1d, deliberately. It is the proof that the not-found
  // screen did not become a route: a catch-all (`/$`) would make this list
  // `['__root__', '/$']` and `_notFound` falsy, so the guard would pass while
  // asserting the opposite of its purpose. `notFoundComponent` on the root
  // route leaves both values exactly as they were.
  it('lands an unmatched deep link on the root layout and marks it not found', () => {
    const matched = match('/kalendar/2026-09/does-not-exist');

    expect(matched.map((one) => one.routeId)).toEqual(['__root__']);
    expect(matched[0]?._notFound).toBe(true);
  });
});

describe('an unknown path renders a screen rather than an empty layout', () => {
  /**
   * The companion to the `_notFound` assertion above, and it has to be here:
   * `matchRoutes` reports `_notFound` from path resolution alone, so it stays
   * true whether or not anything is registered to RENDER the not-found case.
   * Deleting `notFoundComponent` therefore left the whole suite green while an
   * unknown path went back to painting the bare root layout — a blank page at
   * HTTP 200, which is the exact defect AD-14 makes possible.
   */
  it('registers the not-found screen itself on the root route', () => {
    // IDENTITY, not `toBeTypeOf('function')`. The weaker form was satisfied by
    // `notFoundComponent: () => null`, which is a function, renders nothing,
    // and returns an unknown path to the blank page at HTTP 200 that this
    // assertion exists to prevent.
    const registered = (rootRoute.options as { notFoundComponent?: unknown }).notFoundComponent;

    expect(
      registered,
      'the root route does not render NotFoundScreen — an unknown path renders an empty shell',
    ).toBe(NotFoundScreen);
  });

  it('registers it on the root route rather than as a route of its own', () => {
    // A catch-all route would also render something, and would invert the
    // `_notFound` assertion above. Naming the route ids here says which of the
    // two shapes is in force, so a later refactor to `/$` fails twice with two
    // different explanations rather than once with a confusing one.
    expect(Object.keys(router.routesById)).not.toContain('/$');
  });
});

describe('the deployed root is a screen rather than a blank page', () => {
  /**
   * `/` carries no component: it throws a redirect from `beforeLoad`, which is
   * where story 1.3 makes the choice conditional on a session. Asserted by
   * calling that function directly — `matchRoutes` above resolves paths and
   * never runs a route's lifecycle, so the redirect is invisible to it, and
   * AD-15 rules out driving a real navigation through a rendered router.
   */
  function beforeLoad(): unknown {
    const run = (indexRoute.options as { beforeLoad?: (context: unknown) => unknown }).beforeLoad;

    expect(run, '/ has no beforeLoad — the redirect is gone').toBeTypeOf('function');

    try {
      run?.({});
    } catch (thrown) {
      return thrown;
    }

    return null;
  }

  it('throws a redirect from / rather than rendering it', () => {
    const thrown = beforeLoad();

    expect(thrown, '/ resolved without redirecting').not.toBeNull();
    expect(isRedirect(thrown)).toBe(true);
  });

  it('sends / to the sign-in screen', () => {
    expect((beforeLoad() as { options: { to?: string } }).options.to).toBe('/prijava');
  });

  it('carries the search and the hash through', () => {
    // `search: true` / `hash: true` are TanStack's "retain the current values".
    // Dropping them makes a deep link's parameters unrecoverable, and silently:
    // the user lands on a working screen either way, so nothing looks wrong.
    const { options } = beforeLoad() as { options: { search?: unknown; hash?: unknown } };

    expect(options.search, 'the redirect drops the search parameters').toBe(true);
    expect(options.hash, 'the redirect drops the hash').toBe(true);
  });

  it('registers no component on /, because one would never render', () => {
    expect((indexRoute.options as { component?: unknown }).component).toBeUndefined();
  });
});
