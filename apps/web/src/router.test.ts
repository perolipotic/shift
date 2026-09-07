import { isRedirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { router } from '@/router';
import { currentSession } from '@/supabase/client';
import { indexRoute, SignedInScreen } from '@/routes/index';
import { NotFoundScreen } from '@/routes/not-found';
import { OrganizationPromptScreen, prijavaOrganizacijaRoute } from '@/routes/prijava-organizacija';
import { prijavaRoute, SignInScreen } from '@/routes/prijava';
import type { AppRouterContext } from '@/routes/__root';
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
  it('assembles the root route and its three children', () => {
    // Exhaustive on purpose: a new route has to be added here to exist, which
    // is what makes an accidentally unregistered route a failing test rather
    // than a link that resolves to nothing. EXTENDED by story 1.3b rather than
    // relaxed — the credential form moved to `/prijava/$slug` and bare
    // `/prijava` became the organization prompt, so both ids must be named.
    expect(Object.keys(router.routesById).sort()).toEqual([
      '/',
      '/prijava',
      '/prijava/$slug',
      '__root__',
    ]);
  });

  it('resolves / to the index route inside the root layout', () => {
    expect(match('/').map((matched) => matched.routeId)).toEqual(['__root__', '/']);
  });

  it('resolves /prijava to the organization prompt inside the root layout', () => {
    expect(match('/prijava').map((matched) => matched.routeId)).toEqual(['__root__', '/prijava']);
  });

  it('resolves a per-tenant /prijava/<slug> to the credential form', () => {
    // The static sibling must not swallow the parameterized one, and the
    // parameterized one must not swallow the static one (the assertion above).
    expect(match('/prijava/dvd-kastel-novi').map((matched) => matched.routeId)).toEqual([
      '__root__',
      '/prijava/$slug',
    ]);
  });

  it('renders SignInScreen on /prijava/<slug> rather than an empty layout', () => {
    // IDENTITY, the same shape as the `notFoundComponent` assertion below.
    // `matchRoutes` resolves the path from the route id alone, so a `component`
    // swap or removal is invisible to the assertions above it — the route
    // still resolves, and the screen never renders.
    const registered = (prijavaRoute.options as { component?: unknown }).component;

    expect(
      registered,
      '/prijava/$slug does not render SignInScreen — it renders an empty layout',
    ).toBe(SignInScreen);
  });

  it('renders the organization prompt on bare /prijava, not the credential form', () => {
    // The SPLIT of 1.1d's single identity assertion, and both halves are
    // needed: one route swapped for the other would keep every path resolving
    // while putting a two-field credential form on a URL that carries no
    // organization, where every sign-in it accepted would fail.
    const registered = (prijavaOrganizacijaRoute.options as { component?: unknown }).component;

    expect(registered, '/prijava does not render the organization prompt').toBe(
      OrganizationPromptScreen,
    );
    expect(registered, '/prijava renders the credential form, which has no slug').not.toBe(
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

describe('the deployed root resolves both ways and is never a blank page', () => {
  /**
   * `/` is the one seam story 1.3b turned conditional, and the invariant 1.1d
   * wrote down is that BOTH branches resolve: signed out it throws a redirect,
   * signed in it renders a component. A conditional that fell through to
   * neither is the blank page 1.1d removed, so every assertion below names
   * which branch it is about.
   *
   * Asserted by calling `beforeLoad` directly — `matchRoutes` above resolves
   * paths and never runs a route's lifecycle, so the redirect is invisible to
   * it, and AD-15 rules out driving a real navigation through a rendered
   * router.
   *
   * The helper gained a CONTEXT parameter, which is what makes the signed-in
   * branch reachable at all. 1.1d passed `{}` as the entire context and
   * asserted the function ALWAYS threw; a session-aware `beforeLoad` reads
   * `context.currentSession`, so the session it should see has to be something
   * this file supplies. Note the shape is a reader rather than a value
   * (`__root.tsx` explains why), so the stub is a function too.
   */

  /** Enough of a session to be distinguishable from `null`. */
  const SESSION = { access_token: 'token', user: { id: 'member' } } as unknown as Session;

  type BeforeLoad = (options: { context: AppRouterContext }) => unknown;

  async function beforeLoad(session: Session | null): Promise<unknown> {
    const run = (indexRoute.options as unknown as { beforeLoad?: BeforeLoad }).beforeLoad;

    expect(run, '/ has no beforeLoad — the redirect is gone').toBeTypeOf('function');

    try {
      await run?.({ context: { currentSession: () => Promise.resolve(session) } });
    } catch (thrown) {
      return thrown;
    }

    return null;
  }

  it('throws a redirect from / while signed out, rather than rendering it', async () => {
    const thrown = await beforeLoad(null);

    expect(thrown, '/ resolved without redirecting while signed out').not.toBeNull();
    expect(isRedirect(thrown)).toBe(true);
  });

  it('sends a signed-out visitor to the sign-in path', async () => {
    const thrown = (await beforeLoad(null)) as { options: { to?: string } };

    // Bare `/prijava`, which is the organization prompt: `/` has no slug in
    // scope, and inventing one would send everybody to one tenant.
    expect(thrown.options.to).toBe('/prijava');
  });

  it('carries the search and the hash through on that redirect', async () => {
    // `search: true` / `hash: true` are TanStack's "retain the current values".
    // Dropping them makes a deep link's parameters unrecoverable, and silently:
    // the user lands on a working screen either way, so nothing looks wrong.
    // They survive the conditional — the signed-out branch is the only one that
    // redirects, so it is the only one that can keep them.
    const { options } = (await beforeLoad(null)) as { options: { search?: unknown; hash?: unknown } };

    expect(options.search, 'the redirect drops the search parameters').toBe(true);
    expect(options.hash, 'the redirect drops the hash').toBe(true);
  });

  it('does not redirect while signed in', async () => {
    // The other half of the split. Without it, a `beforeLoad` that still threw
    // unconditionally would pass every assertion above and no one signing in
    // could ever reach a screen.
    expect(await beforeLoad(SESSION), '/ redirected a signed-in visitor away').toBeNull();
  });

  it('registers the signed-in placeholder as the component for /', () => {
    // INVERTED from 1.1d, which asserted `component` was undefined because a
    // redirect-only route can never render one. IDENTITY rather than
    // `toBeDefined`: the weaker form is satisfied by `() => null`, which
    // resolves the route to a blank page — the exact defect the branch
    // invariant exists to prevent.
    const registered = (indexRoute.options as { component?: unknown }).component;

    expect(registered, '/ renders no screen, so a signed-in visitor sees nothing').toBe(
      SignedInScreen,
    );
  });

  it('resolves to the redirect when the session cannot be read at all', async () => {
    // THE THIRD OUTCOME. `currentSession` can reject: the client throws its
    // stable code on a build with no environment, and `getSession` rejects
    // wherever storage is blocked (Safari private mode, a locked-down
    // profile). An escaping rejection resolves `/` to neither a redirect nor a
    // component — the blank page at HTTP 200 the branch invariant exists to
    // prevent, and `__root.tsx` registers no `errorComponent` to catch it.
    //
    // FAIL CLOSED: a session that cannot be read is not a session.
    const run = (indexRoute.options as unknown as { beforeLoad?: BeforeLoad }).beforeLoad;
    let thrown: unknown = null;

    try {
      await run?.({
        context: { currentSession: () => Promise.reject(new Error('SecurityError')) },
      });
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown, '/ resolved to neither a redirect nor a component').not.toBeNull();
    expect(
      isRedirect(thrown),
      '/ let the read failure escape instead of sending the visitor to sign in',
    ).toBe(true);
    expect((thrown as { options: { to?: string } }).options.to).toBe('/prijava');
  });

  it('binds the real reader into the router context, by identity', () => {
    // The mutation this exists for: `router.ts` held the reader as an inline
    // arrow, executed by nothing, so `async () => null` there kept the whole
    // suite green while every signed-in visitor bounced endlessly between `/`
    // and `/prijava`. The assertions above supply their own context and cannot
    // see it — only naming the shipped function can.
    //
    // IDENTITY, not `toBeTypeOf('function')`: the weaker form is satisfied by
    // exactly the mutation it must refuse.
    const context = (router.options as { context?: { currentSession?: unknown } }).context;

    expect(
      context?.currentSession,
      'the router does not resolve sessions through @/supabase/client',
    ).toBe(currentSession);
  });

  it('reads the session through the context rather than reaching for a client', async () => {
    // What makes both branches assertable at all. A `beforeLoad` that imported
    // the Supabase client would ignore this stub entirely, and the signed-in
    // case above would be untestable without a browser and a running stack.
    let asked = 0;

    const run = (indexRoute.options as unknown as { beforeLoad?: BeforeLoad }).beforeLoad;

    await run?.({
      context: {
        currentSession: () => {
          asked += 1;

          return Promise.resolve(SESSION);
        },
      },
    });

    expect(asked, '/ never asked the router context whether anyone is signed in').toBe(1);
  });
});
