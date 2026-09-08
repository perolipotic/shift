import { readFileSync } from 'node:fs';

import { isRedirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { router } from '@/router';
import { DESTINATIONS } from '@/navigation/destinations';
import { currentSession, SESSION_UNRESOLVED } from '@/supabase/client';
import { AppLayout, appLayoutRoute } from '@/routes/_app';
import { DanasScreen, danasRoute } from '@/routes/danas';
import { GodisnjiScreen, godisnjiRoute } from '@/routes/godisnji';
import { indexRoute, SignedInScreen } from '@/routes/index';
import { KalendarScreen, kalendarRoute } from '@/routes/kalendar';
import { LjudiScreen, ljudiRoute } from '@/routes/ljudi';
import { NotFoundScreen } from '@/routes/not-found';
import { OrganizacijaScreen, organizacijaRoute } from '@/routes/organizacija';
import { PostavkeRotacijeScreen, postavkeRotacijeRoute } from '@/routes/postavke-rotacije';
import { OrganizationPromptScreen, prijavaOrganizacijaRoute } from '@/routes/prijava-organizacija';
import { prijavaRoute, SignInScreen } from '@/routes/prijava';
import { RasporedScreen, rasporedRoute } from '@/routes/raspored';
import { SatiScreen, satiRoute } from '@/routes/sati';
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

/**
 * The eight destinations, each paired with what must render on it.
 *
 * A table rather than eight blocks, because the eight claims are the same claim
 * eight times and a hand-copied block is where the one that was missed hides.
 * The component is named by IDENTITY — `toBeDefined` is satisfied by
 * `() => null`, which resolves the route to a blank page, and the whole reason
 * these routes exist before their screens do is that a link can be typechecked
 * against them.
 */
const DESTINATION_ROUTES = [
  { id: '/_app/danas', path: '/danas', route: danasRoute, component: DanasScreen },
  { id: '/_app/kalendar', path: '/kalendar', route: kalendarRoute, component: KalendarScreen },
  { id: '/_app/sati', path: '/sati', route: satiRoute, component: SatiScreen },
  { id: '/_app/godisnji', path: '/godisnji', route: godisnjiRoute, component: GodisnjiScreen },
  { id: '/_app/raspored', path: '/raspored', route: rasporedRoute, component: RasporedScreen },
  { id: '/_app/ljudi', path: '/ljudi', route: ljudiRoute, component: LjudiScreen },
  {
    id: '/_app/postavke-rotacije',
    path: '/postavke-rotacije',
    route: postavkeRotacijeRoute,
    component: PostavkeRotacijeScreen,
  },
  {
    id: '/_app/organizacija',
    path: '/organizacija',
    route: organizacijaRoute,
    component: OrganizacijaScreen,
  },
];

describe('the shell route tree', () => {
  it('assembles the root route and its children', () => {
    // Exhaustive on purpose: a new route has to be added here to exist, which
    // is what makes an accidentally unregistered route a failing test rather
    // than a link that resolves to nothing. EXTENDED by story 1.3b rather than
    // relaxed — the credential form moved to `/prijava/$slug` and bare
    // `/prijava` became the organization prompt, so both ids must be named.
    //
    // EXTENDED AGAIN, by nine, for the navigation shell's route skeleton: the
    // pathless `_app` layout and the eight destinations that nest under it.
    // Note the shape of the ids — `/_app` carries no segment of its own and its
    // children read `/_app/danas` while their URLs stay `/danas`. That is the
    // pathless layout doing what it is there for, and naming the ids here is
    // what would notice it turning into a real segment.
    expect(Object.keys(router.routesById).sort()).toEqual([
      '/',
      '/_app',
      '/_app/danas',
      '/_app/godisnji',
      '/_app/kalendar',
      '/_app/ljudi',
      '/_app/organizacija',
      '/_app/postavke-rotacije',
      '/_app/raspored',
      '/_app/sati',
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
    // RE-DERIVED by the route skeleton, and verified by running rather than by
    // reasoning — this is the assertion the story was most likely to break
    // while still looking like a pass. `/kalendar` is now a real route, so
    // TanStack matches the prefix and the chain is no longer the single
    // `['__root__']` it was against a flat tree: the layout and the destination
    // appear behind the root as partial matches.
    //
    // WHAT MUST NOT MOVE is which match owns the not-found, and it is asserted
    // by INDEX rather than by "somewhere in the list". `Outlet` renders
    // `renderRouteNotFound` for the route whose match carries `_notFound` and
    // never descends past it (`@tanstack/react-router`'s `Match.js`), and
    // loading stops at the same boundary — so `_notFound` on the root means the
    // root's `notFoundComponent` renders and the two matches behind it are
    // never asked for. `_notFound` on the destination instead would put a
    // `Kalendar` heading on `/kalendar/2026-09/does-not-exist`.
    const matched = match('/kalendar/2026-09/does-not-exist');

    expect(matched.findIndex((one) => one._notFound === true)).toBe(0);
    expect(matched[0]?.routeId).toBe('__root__');
    expect(matched[0]?._notFound).toBe(true);
    // No route in the chain satisfied the URL: the deepest match is the
    // destination whose prefix matched, and the two extra segments belong to
    // nothing. A catch-all would make this list end in `/$` and clear
    // `_notFound` altogether, which the assertion above and the one below
    // refuse from two directions.
    expect(matched.map((one) => one.routeId)).toEqual(['__root__', '/_app', '/_app/kalendar']);
  });

  it('still lands a path with no registered prefix on the root alone', () => {
    // The polarity the assertion above lost when `/kalendar` became real. A
    // path matching no route at any depth must still produce the single
    // `['__root__']` chain — if this one started growing matches too, the
    // fuzzy-prefix explanation above would be wrong and something else would be
    // resolving unknown paths.
    const matched = match('/ne-postoji/nikako');

    expect(matched.map((one) => one.routeId)).toEqual(['__root__']);
    expect(matched[0]?._notFound).toBe(true);
  });
});

describe('the eight destinations are registered and each renders its own screen', () => {
  /**
   * The route skeleton's whole purpose. TanStack Router 1.170.32 typechecks
   * `<Link to>` against the route tree, so part B's navigation cannot compile
   * until every destination it points at exists — and a destination that
   * resolves to nothing is a link that reads as working and lands on a blank
   * page.
   */
  it.each(DESTINATION_ROUTES)('resolves $path inside the signed-in layout', ({ path, id }) => {
    // THREE ids, and the middle one is the point: the layout is in the chain,
    // which is what makes its session guard run before the destination's
    // component is ever asked for. A destination registered on the ROOT instead
    // would resolve identically to a reader of the URL and be reachable signed
    // out.
    expect(match(path).map((matched) => matched.routeId)).toEqual(['__root__', '/_app', id]);
  });

  it.each(DESTINATION_ROUTES)('renders its own screen on $path', ({ route, component }) => {
    // IDENTITY, the same shape as the `notFoundComponent` and `SignInScreen`
    // assertions. `matchRoutes` resolves a path from the route id alone, so a
    // `component` swap or removal is invisible to the assertion above — the
    // route still resolves and the screen never renders. `toBeDefined` loses
    // exactly that: it is satisfied by `() => null`.
    const registered = (route.options as { component?: unknown }).component;

    expect(registered, 'a destination renders no screen of its own').toBe(component);
  });

  it('renders eight DISTINCT screens', () => {
    // The assertion above passes for eight routes wired to the same component:
    // every one would name a component that is indeed the one it names. Eight
    // destinations that all render `Danas` is a navigation nobody can use.
    const rendered = DESTINATION_ROUTES.map(
      ({ route }) => (route.options as { component?: unknown }).component,
    );

    expect(new Set(rendered).size).toBe(DESTINATION_ROUTES.length);
  });

  it('registers exactly the paths the destination table names', () => {
    // The seam between the two halves of this story. `@/navigation/destinations`
    // is what part B renders links from, and a path typo'd on either side is a
    // link to nowhere that neither file can notice alone: the table's test
    // resolves keys against `hr.json` and never sees the router, and the
    // assertions above read the router and never see the table.
    expect([...DESTINATIONS.map((destination) => destination.path)].sort()).toEqual(
      [...DESTINATION_ROUTES.map((destination) => destination.path)].sort(),
    );
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


describe('a slug that cannot be one never reaches the credential form', () => {
  type SlugBeforeLoad = (options: { params: { slug: string } }) => unknown;

  function guard(slug: string): unknown {
    const run = (prijavaRoute.options as unknown as { beforeLoad?: SlugBeforeLoad }).beforeLoad;

    try {
      run?.({ params: { slug } });
    } catch (caught) {
      return caught;
    }

    return null;
  }

  it.each([
    { row: 'an underscore, which no DNS label may hold', slug: 'under_score' },
    { row: 'a leading hyphen', slug: '-kastel' },
    { row: 'a doubled hyphen run', slug: 'dvd--kastel' },
    { row: 'a path segment longer than a DNS label', slug: 'a'.repeat(64) },
    { row: 'an empty-looking segment', slug: '%20' },
  ])('redirects $row to the organization prompt', ({ slug }) => {
    // REVIEW DECISION, 2026-09-08. Normalization already rescued the case a URL
    // produces most often — a capital letter, from a phone's autocapitalization
    // or a shared link — but a segment no normalization can rescue rendered a
    // perfectly ordinary form that then refused every correct credential
    // forever, with the message that says the password is wrong. There was no
    // way for the person to discover why, because the screen may not say which.
    const thrown = guard(slug);

    expect(thrown, `/prijava/${slug} still renders the credential form`).not.toBeNull();
    expect(isRedirect(thrown), 'the guard threw something that is not a redirect').toBe(true);
    expect((thrown as { options: { to?: string } }).options.to).toBe('/prijava');
  });

  it.each([
    { row: 'the pilot organization', slug: 'dvd-kastel-novi' },
    { row: 'a slug nobody has registered', slug: 'no-such-org' },
    { row: 'a slug a phone autocapitalized', slug: 'DVD-Kastel-Novi' },
    { row: 'a single-label slug', slug: 'kastel' },
  ])('lets $row through to the form', ({ slug }) => {
    // THE OTHER POLARITY, and the one that keeps the guard from becoming an
    // oracle. Well-formedness is the DNS-label rule in
    // `0002_organizations_and_members.sql` — anyone can compute it without
    // asking this application anything. EXISTENCE is the question that stays
    // unanswered: `no-such-org` is well formed, so it renders the form and
    // fails with the ordinary refusal, exactly as the I/O matrix specifies. A
    // guard that turned an unknown slug away would answer "does this
    // organization exist?" for an anonymous caller.
    expect(guard(slug), `/prijava/${slug} was turned away`).toBeNull();
  });
});

describe('the signed-in layout guards every destination once, and is pathless', () => {
  /**
   * The whole reason `_app` exists.
   *
   * Eight destinations need the identical session guard, and eight copies of it
   * are eight places for the next reviewer to check and one place for the next
   * author to forget. `beforeLoad` on a parent runs before every child's, so
   * registering it once here is what makes "a signed-out visitor reaches no
   * destination" a property of the TREE rather than of eight files that happen
   * to agree today.
   *
   * Asserted by calling `beforeLoad` directly, exactly as the deployed-root
   * block above does and for the same reason: `matchRoutes` resolves paths and
   * never runs a route's lifecycle, and AD-15 rules out driving a real
   * navigation through a rendered router.
   *
   * The context handed in is the BARE shape — `{ context: { currentSession } }`
   * and nothing else. The real router passes far more, so a guard reaching for
   * anything but the reader would pass here and fail in a browser; keeping the
   * stub minimal is what makes that a test failure rather than a discovery.
   */

  /** Enough of a session to be distinguishable from `null`. */
  const SESSION = { access_token: 'token', user: { id: 'member' } } as unknown as Session;

  type BeforeLoad = (options: { context: AppRouterContext }) => unknown;

  /** What running the guard did: it either threw something, or returned
   *  something. Collapsing "returned normally" to `null` made a guard that
   *  returned a VALUE indistinguishable from a clean pass, which matters here
   *  because `beforeLoad`'s return value becomes route context. */
  type Outcome = { readonly thrown: unknown } | { readonly returned: unknown };

  function guard(): BeforeLoad {
    const run = (appLayoutRoute.options as unknown as { beforeLoad?: BeforeLoad }).beforeLoad;

    // `toBeTypeOf` then `run?.(…)` reported the real failure and then a second,
    // misleading one from the optional call resolving to `undefined`. Asserting
    // and NARROWING in one place means a missing guard fails exactly once, with
    // the explanation that is true.
    if (typeof run !== 'function') {
      throw new Error('the layout has no beforeLoad — every destination is reachable signed out');
    }

    return run;
  }

  async function beforeLoad(currentSession: () => Promise<Session | null>): Promise<Outcome> {
    try {
      return { returned: await guard()({ context: { currentSession } }) };
    } catch (thrown) {
      return { thrown };
    }
  }

  /** The thrown value, or a failure naming what happened instead. */
  function thrownBy(outcome: Outcome): unknown {
    expect(
      'thrown' in outcome,
      `the guard resolved instead of redirecting, returning ${JSON.stringify(
        'returned' in outcome ? outcome.returned : undefined,
      )}`,
    ).toBe(true);

    return 'thrown' in outcome ? outcome.thrown : null;
  }

  it('adds a level to the tree and no segment to any URL', () => {
    // PATHLESS, asserted on the registration rather than inferred from the ids.
    // A `path` here would move all eight destinations under a real segment —
    // `/_app/danas` as a URL — and every link in part B would 404.
    const options = appLayoutRoute.options as { path?: unknown; id?: unknown };

    expect(options.path, 'the layout declares a path, so it is not pathless').toBeUndefined();
    expect(options.id).toBe('_app');
  });

  it('is not a catch-all wearing a different name', () => {
    // The shape `router.test.ts` has refused since 1.1d, restated against the
    // one route that could reintroduce it. A `/$` layout would swallow every
    // unmatched path and invert the not-found assertions above.
    expect(String((appLayoutRoute.options as { id?: unknown }).id)).not.toContain('$');
    expect(Object.keys(router.routesById)).not.toContain('/$');
  });

  it('renders an outlet and nothing else', () => {
    // IDENTITY again. A layout resolved to `() => null` renders no outlet, so
    // every destination beneath it goes blank while every path still resolves.
    const registered = (appLayoutRoute.options as { component?: unknown }).component;

    expect(registered, 'the layout renders no component, so its destinations render nothing').toBe(
      AppLayout,
    );
  });

  it('does not redirect a signed-in visitor away from a destination', async () => {
    // The branch that makes the other one worth having. A guard that threw
    // unconditionally would satisfy every redirect assertion below and no
    // signed-in person could reach any of the eight.
    //
    // The outcome is asserted as RETURNED rather than as "not a throw": what
    // `beforeLoad` returns becomes route context for every destination beneath
    // it, so a guard quietly returning a value is a different thing from a
    // guard letting the visitor through, and this pins which one ships.
    expect(await beforeLoad(() => Promise.resolve(SESSION))).toEqual({ returned: undefined });
  });

  it('says nothing to the console on the way through', async () => {
    // The other polarity of the logging assertion below, and it has to be
    // stated: a guard that logged on EVERY resolution would satisfy the
    // failure case and fill a real console with a line per navigation, which
    // is how the one line that matters stops being noticed.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await beforeLoad(() => Promise.resolve(SESSION));

      expect(logged, 'the layout logs on the ordinary signed-in path').not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('asks whether anyone is signed in, and nothing about who they are', () => {
    // P9's decision, pinned so the story that changes it has to change a test.
    // The guard is SESSION-ONLY: a signed-in member typing `/organizacija`
    // reaches it, and today that is correct — AD-10 puts isolation and role
    // enforcement in the database, and these eight screens hold no data for a
    // role check to protect. What decides that a member never SEES the
    // destination is `@/navigation/destinations`.
    //
    // Read off the SOURCE, because a role check that never fires against these
    // stubs is invisible to a behavioural assertion: every branch of it would
    // be unreachable while the screens are empty, so the suite would stay green
    // whichever way it was written.
    const layout = readFileSync(new URL('./routes/_app.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[\s;,{}()[\]])\/\/[^\n]*/g, '$1');

    for (const forbidden of ['role', 'admin', 'member_role', 'destinationsFor']) {
      expect(
        layout,
        `the layout reaches for ${forbidden} — role enforcement belongs in the database (AD-10)`,
      ).not.toContain(forbidden);
    }
  });

  it('sends a signed-out visitor to the sign-in path rather than rendering', async () => {
    const thrown = thrownBy(await beforeLoad(() => Promise.resolve(null)));

    expect(isRedirect(thrown), 'the layout threw something that is not a redirect').toBe(true);
    // Bare `/prijava`, the organization prompt: a destination URL carries no
    // slug, and inventing one would send everybody to one tenant.
    expect((thrown as { options: { to?: string } }).options.to).toBe('/prijava');
  });

  it('carries the search and the hash through on that redirect', async () => {
    // AD-14 has the host answer every path with `index.html` at 200, so
    // `/kalendar?tim=2#tjedan` is a shape a real link takes. Dropping them makes
    // a deep link's parameters unrecoverable, and silently — the visitor lands
    // on a working screen either way.
    const { options } = thrownBy(await beforeLoad(() => Promise.resolve(null))) as {
      options: { search?: unknown; hash?: unknown };
    };

    expect(options.search, 'the redirect drops the search parameters').toBe(true);
    expect(options.hash, 'the redirect drops the hash').toBe(true);
  });

  it('resolves to the same redirect when the session cannot be read at all', async () => {
    // THE THIRD OUTCOME, and the one that decides whether a misconfiguration
    // looks like an outage. `currentSession` can REJECT: the client throws its
    // stable code on a build with no environment, and `getSession` rejects
    // wherever storage is blocked. An escaping rejection resolves the
    // destination to neither a redirect nor a component — the blank page at
    // HTTP 200 that `__root.tsx` registers no `errorComponent` to catch.
    //
    // FAIL CLOSED, and NOT SILENTLY: the cause is logged, which is the promise
    // `client.ts` exists to keep and the one a bare catch quietly breaks.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const thrown = thrownBy(await beforeLoad(() => Promise.reject(new Error('SecurityError'))));

      expect(
        isRedirect(thrown),
        'the layout let the read failure escape instead of sending the visitor to sign in',
      ).toBe(true);
      expect((thrown as { options: { to?: string } }).options.to).toBe('/prijava');
      expect(logged, 'the layout swallowed the reason the session could not be read').toHaveBeenCalledWith(
        SESSION_UNRESOLVED,
        expect.anything(),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('reads the session through the context rather than reaching for a client', async () => {
    // What makes both branches assertable at all, and the regression `router.ts`
    // records: a `beforeLoad` that imported the Supabase client would ignore
    // this stub entirely, and the signed-in case above would be untestable
    // without a browser and a running stack.
    let asked = 0;

    await beforeLoad(() => {
      asked += 1;

      return Promise.resolve(SESSION);
    });

    expect(asked, 'the layout never asked the router context whether anyone is signed in').toBe(1);
  });

  it('leaves the guard on the layout rather than on each destination', () => {
    // The claim the branch assertions cannot make. Eight destinations each
    // carrying their own copy would pass every test above — the layout would
    // still guard — while the ninth destination added later would silently ship
    // without one. The guard belongs in exactly one place, and this is it.
    for (const { path, route } of DESTINATION_ROUTES) {
      expect(
        (route.options as { beforeLoad?: unknown }).beforeLoad,
        `${path} carries a guard of its own instead of inheriting the layout's`,
      ).toBeUndefined();
    }
  });
});
