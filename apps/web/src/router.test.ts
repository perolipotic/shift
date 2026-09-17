import { readFileSync } from 'node:fs';

import { isRedirect } from '@tanstack/react-router';
import type { Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { router } from '@/router';
import { DESTINATIONS, destinationsFor } from '@/navigation/destinations';
import { currentSession, SESSION_UNRESOLVED } from '@/supabase/client';
import { AppLayout, appLayoutRoute } from '@/routes/_app';
import { DanasScreen, danasRoute } from '@/routes/danas';
import { GodisnjiScreen, godisnjiRoute } from '@/routes/godisnji';
import { indexRoute } from '@/routes/index';
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
 * Every quoted string in a source, read PAST comments rather than through them.
 *
 * For the one sweep that has to ask what a route module STATES: a destination
 * path hard-coded into `routes/index.tsx` is behaviourally identical to the same
 * path read from the table, so the source is the only place the two differ.
 *
 * A substring search over the raw text cannot ask that question — it fires on a
 * legitimate `import … from '@/navigation/destinations'` — and the regex comment
 * stripper used elsewhere in this file cannot be used first: it eats real code
 * from the first `//` inside any string. So this walks the source once,
 * skipping both comment forms and collecting each quoted string whole.
 *
 * It does not know regex literals from division, which is why it is used on one
 * route module and not offered as a general tool; a quote inside a regex there
 * would confuse it, and the case below is what would say so.
 */
function stringLiterals(source: string): string[] {
  const found: string[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index);

      if (newline === -1) break;

      index = newline + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2);

      index = close === -1 ? source.length : close + 2;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      let cursor = index + 1;
      let value = '';

      while (cursor < source.length && source[cursor] !== char) {
        if (source[cursor] === '\\') cursor += 1;

        value += source[cursor] ?? '';
        cursor += 1;
      }

      found.push(value);
      index = cursor + 1;
      continue;
    }

    index += 1;
  }

  return found;
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
   * `/` decides where a signed-in person belongs, and the invariant 1.1d wrote
   * down is that every branch of it RESOLVES. All of them resolve the same way:
   * each throws a redirect — signed out to the sign-in path, signed in on to the
   * first destination, which is where the navigation chrome and the sign-out
   * are. A branch falling through to neither a redirect nor a component is the
   * blank page at HTTP 200 that invariant exists to prevent, so every assertion
   * below names which branch it is about.
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

  it('forwards a signed-in visitor on rather than resolving to a screen', async () => {
    // The branch that makes the other one worth having. Without it, a
    // `beforeLoad` that threw the SIGNED-OUT redirect unconditionally would pass
    // every assertion above and no one signing in could reach a destination.
    const thrown = await beforeLoad(SESSION);

    expect(thrown, '/ resolved a signed-in visitor to neither a redirect nor a screen').not.toBeNull();
    expect(isRedirect(thrown), '/ threw something that is not a redirect').toBe(true);
  });

  it('forwards to the first destination in binding order, read from the table', async () => {
    // FROM THE TABLE, never a literal on either side. A path written here would
    // agree with the same path hard-coded in the route and with nothing else,
    // and the day the first row of `@/navigation/destinations` changes both
    // would keep naming the old one.
    const thrown = (await beforeLoad(SESSION)) as { options: { to?: string } };

    expect(
      thrown.options.to,
      '/ forwards somewhere other than the first destination in binding order',
    ).toBe(DESTINATIONS[0].path);
  });

  it('carries no search and no hash onto the forward', async () => {
    // THE ASYMMETRY, pinned. `search: true, hash: true` added to this branch
    // passes every other case in this file, so without this one the property is
    // held by a comment. They belong to the signed-out redirect, where the
    // visitor continues to `/prijava` and a dropped parameter is unrecoverable;
    // a destination knows nothing about parameters addressed to `/`, so
    // forwarding them invents a meaning rather than preserving one.
    const { options } = (await beforeLoad(SESSION)) as {
      options: { search?: unknown; hash?: unknown };
    };

    expect(options.search, 'the forward carries / own search onto a destination').toBeUndefined();
    expect(options.hash, 'the forward carries / own hash onto a destination').toBeUndefined();
  });

  it.each([
    { name: 'the signed-in forward', session: SESSION },
    { name: 'the signed-out redirect', session: null },
  ])('replaces the history entry on $name', async ({ session }) => {
    // `/` IS A DECISION, and a decision has no business in the history stack.
    // Left there, Back from wherever the visitor landed returns to `/`, which
    // decides again and sends them straight back — a dead Back button, and
    // everything before `/` unreachable. It could not happen while `/` rendered
    // a screen, because a screen is somewhere Back can legitimately return to,
    // so nothing in this file asked about it until `/` stopped being one.
    //
    // BOTH branches, in one table: the defect is a property of `/` rather than
    // of either outcome, and a case covering only the forward would leave the
    // signed-out visitor bouncing between `/` and `/prijava` on Back.
    const { options } = (await beforeLoad(session)) as { options: { replace?: unknown } };

    expect(options.replace, '/ pushes a history entry nobody can go back through').toBe(true);
  });

  it('forwards to a destination every role reaches, and to the same one', () => {
    // WHY the first destination is a safe target for a session-only guard. `/`
    // never asks who is signed in — AD-10 puts role enforcement in the database
    // — so the one place it can send everybody has to be reachable by
    // everybody, and has to be the SAME place for everybody: a first row that
    // became admin-only would send every member to a destination the chrome
    // does not offer them.
    //
    // Asserted through `destinationsFor`, which is what the chrome renders
    // from, rather than by copying this file's own idea of which roles exist.
    // Comparing the filtered first entry per role says the thing that matters —
    // the forward target is where each role's navigation starts — and says it
    // without pinning the order of the roles array behind it.
    for (const role of ['member_role', 'admin'] as const) {
      expect(
        destinationsFor(role)[0],
        `/ forwards to a destination ${role} does not reach`,
      ).toBe(DESTINATIONS[0]);
    }
  });

  it('forwards to a path that takes no parameters', () => {
    // A `$param` segment in the first row would make the forward resolve to
    // not-found for every signed-in visitor, because `/` has nothing to fill it
    // from — the same reason the signed-out branch cannot name a tenant slug.
    // Nothing else refuses it: all eight destinations are static today, so the
    // day one is not, this is what says so.
    expect(
      DESTINATIONS[0].path,
      '/ forwards to a parameterized path it has no parameters for',
    ).not.toContain('$');
  });

  it('accepts the same session at the destination it forwards to', async () => {
    // THE OTHER HALF OF "one hop and it ends", and until this case it rested on
    // reading two files. Every destination nests under `_app`, so the guard the
    // forwarded visitor meets next is the layout's — and if it threw for the
    // session `/` just accepted, the two would bounce the visitor between them
    // with every assertion in this file still green.
    const run = (appLayoutRoute.options as unknown as { beforeLoad?: BeforeLoad }).beforeLoad;

    await expect(
      run?.({ context: { currentSession: () => Promise.resolve(SESSION) } }),
      'the layout refuses the session / forwarded — the two guards disagree',
    ).resolves.toBeUndefined();
  });

  it('names no destination itself — it reads the table', () => {
    // THE MUTATION THIS EXISTS FOR, and it is invisible to every behavioural
    // assertion above: the first row's path written into `index.tsx` as a
    // literal produces exactly the redirect the cases above assert, because it
    // is what the table says today. The two would agree with each other and
    // with nothing else, and the day the first row changes the route forwards
    // to the old one with the suite green. The source is the only place the
    // difference is observable.
    //
    // THE `not.toContain` LOOP IS WHERE THE GUARANTEE LIVES. The assertions
    // around it are vacuity guards on the extractor, not claims about the route:
    // a reader that found no strings at all would make the loop pass having
    // examined nothing.
    //
    // STRING LITERALS rather than raw text, which matters in both directions. A
    // substring sweep over the source would fire on a future
    // `import … from '@/navigation/destinations'` — a legitimate line naming no
    // path — and a comment stripper run over raw text eats real code from the
    // first `//` inside any string. Reading the quoted strings out and comparing
    // them WHOLE asks the only question worth asking: does this file state a
    // destination path itself?
    //
    // `/prijava` is not on the list and must not be: the signed-out branch names
    // it deliberately, and `/` has no slug in scope to build anything else from.
    const literals = stringLiterals(
      readFileSync(new URL('./routes/index.tsx', import.meta.url), 'utf8'),
    );

    expect(literals.length, 'no string literal was read out of index.tsx at all').toBeGreaterThan(0);
    expect(
      literals,
      "the reader did not find /'s own signed-out redirect target — it is reading something other than this route",
    ).toContain('/prijava');

    for (const { path } of DESTINATIONS) {
      expect(
        literals,
        `/ names ${path} itself — the destination table is the only thing that may say where a person belongs first`,
      ).not.toContain(path);
    }
  });

  it('reads string literals past comments rather than through them', () => {
    // THE DETECTOR, SELF-TESTED on synthetic sources, the idiom
    // `packages/domain/test/purity.test.ts` established and `prijava.test.ts`
    // follows: a reader that quietly stopped finding strings would make the
    // sweep above pass having proved nothing, and both of its vacuity guards
    // would still hold on a reader that found only the first literal.
    //
    // Each case is one of the two failure modes the sweep exists to avoid: a
    // path named in a COMMENT is not the route stating it, and a comment
    // stripper run first would eat the code after a `//` inside a string.
    expect(stringLiterals("// '/danas'\nconst path = '/prijava';")).toEqual(['/prijava']);
    expect(stringLiterals("/* '/danas' */ const path = '/prijava';")).toEqual(['/prijava']);
    expect(stringLiterals("const link = 'https://example.test/danas';")).toEqual([
      'https://example.test/danas',
    ]);
    expect(stringLiterals("const it = 'it\\'s';")).toEqual(["it's"]);
    expect(stringLiterals('const nothing = 1;')).toEqual([]);
  });

  it('names no role, and nothing that would let it read one', () => {
    // SESSION ONLY, exactly as `routes/_app.tsx` is, and swept the same way and
    // for the same reason: a role check written here would be unreachable
    // against these stubs, so no behavioural assertion could see it. `/` sends
    // every role to the same destination — the case above is why that is safe —
    // so there is nothing here for a role to decide.
    const source = readFileSync(new URL('./routes/index.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[\s;,{}()[\]])\/\/[^\n]*/g, '$1');

    for (const forbidden of ['role', 'admin', 'member_role', 'destinationsFor']) {
      expect(
        source,
        `/ reaches for ${forbidden} — role enforcement belongs in the database (AD-10)`,
      ).not.toContain(forbidden);
    }
  });

  it('registers no component for /', () => {
    // RESTORED from 1.1d, which asserted exactly this: a redirect-only route
    // can never render a component, so registering one is a screen nobody can
    // reach. 1.3b inverted it for the signed-in placeholder; the placeholder is
    // gone and so is the inversion.
    const registered = (indexRoute.options as { component?: unknown }).component;

    expect(
      registered,
      '/ registers a component — a redirect-only route can never render one',
    ).toBeUndefined();
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

    // The call is WRAPPED now, and it was not before: every branch of `/` ends
    // in a thrown redirect since the placeholder went, so the signed-in path
    // that this case drives throws too. Letting it escape would fail the case
    // on the very behaviour it is not about.
    let thrown: unknown = null;

    try {
      await run?.({
        context: {
          currentSession: () => {
            asked += 1;

            return Promise.resolve(SESSION);
          },
        },
      });
    } catch (caught) {
      thrown = caught;
    }

    // CAUGHT AND NAMED, never swallowed. Every branch of `/` throws now, so this
    // case has to tolerate a throw — and a bare `catch {}` tolerates the wrong
    // ones too: a `beforeLoad` crashing with a TypeError would pass here as long
    // as it had asked the context first.
    expect(isRedirect(thrown), '/ threw something that is not a redirect').toBe(true);
    expect(asked, '/ never asked the router context whether anyone is signed in').toBe(1);
  });
});


describe('a slug that cannot be one never reaches the credential form', () => {
  /**
   * The guard became ASYNC and gained a context, and both tests below had to
   * follow it there.
   *
   * `/prijava/$slug` now answers two questions rather than one — is this segment
   * a slug at all, and is somebody already signed in — and the second needs the
   * router context and an `await`. A synchronous `guard` reading the return
   * value of an async `beforeLoad` would see a PROMISE for every case: the
   * redirects would stop being thrown where this file could catch them, and
   * every row below would report "let through" while the guard worked
   * perfectly. So the helper awaits, and the rows await it.
   *
   * SIGNED OUT BY DEFAULT, because these rows are about the slug and nothing
   * else. The signed-in half is its own block further down.
   */
  type SlugBeforeLoad = (options: {
    params: { slug: string };
    context: AppRouterContext;
  }) => unknown;

  /** Enough of a session to be distinguishable from `null`. */
  const SIGNED_IN = { access_token: 'token', user: { id: 'member' } } as unknown as Session;

  async function guard(slug: string, session: Session | null = null): Promise<unknown> {
    const run = (prijavaRoute.options as unknown as { beforeLoad?: SlugBeforeLoad }).beforeLoad;

    // ASSERTED AND NARROWED, exactly as the signed-in block below does it. This
    // read `run?.(…)` for three stories, which means deleting `beforeLoad` from
    // this route entirely left the optional call resolving to `undefined`, every
    // "was let through" row reading that as a pass, and the three "was turned
    // away" rows as the only thing red — three failures explaining the wrong
    // problem. The guard vanishing is a different fact from the guard being
    // wrong, and it should say so once.
    if (typeof run !== 'function') {
      throw new Error('/prijava/$slug has no beforeLoad — every segment reaches the form');
    }

    try {
      await run({
        params: { slug },
        context: { currentSession: () => Promise.resolve(session) },
      });
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
  ])('redirects $row to the organization prompt', async ({ slug }) => {
    // REVIEW DECISION, 2026-09-08. Normalization already rescued the case a URL
    // produces most often — a capital letter, from a phone's autocapitalization
    // or a shared link — but a segment no normalization can rescue rendered a
    // perfectly ordinary form that then refused every correct credential
    // forever, with the message that says the password is wrong. There was no
    // way for the person to discover why, because the screen may not say which.
    const thrown = await guard(slug);

    expect(thrown, `/prijava/${slug} still renders the credential form`).not.toBeNull();
    expect(isRedirect(thrown), 'the guard threw something that is not a redirect').toBe(true);
    expect((thrown as { options: { to?: string } }).options.to).toBe('/prijava');
  });

  it.each([
    { row: 'the pilot organization', slug: 'dvd-kastel-novi' },
    { row: 'a slug nobody has registered', slug: 'no-such-org' },
    { row: 'a slug a phone autocapitalized', slug: 'DVD-Kastel-Novi' },
    { row: 'a single-label slug', slug: 'kastel' },
  ])('lets $row through to the form', async ({ slug }) => {
    // THE OTHER POLARITY, and the one that keeps the guard from becoming an
    // oracle. Well-formedness is the DNS-label rule in
    // `0002_organizations_and_members.sql` — anyone can compute it without
    // asking this application anything. EXISTENCE is the question that stays
    // unanswered: `no-such-org` is well formed, so it renders the form and
    // fails with the ordinary refusal, exactly as the I/O matrix specifies. A
    // guard that turned an unknown slug away would answer "does this
    // organization exist?" for an anonymous caller.
    expect(await guard(slug), `/prijava/${slug} was turned away`).toBeNull();
  });

  it('judges the slug before it asks about the session', async () => {
    // The ORDER, pinned. A malformed segment goes to the organization prompt
    // whether or not anybody is signed in — the 2026-09-08 decision, unchanged
    // and deliberately not made conditional on a session read that can fail.
    // Asked the other way round, `/prijava/under_score` opened for a signed-out
    // visitor would depend on a read succeeding, and the guard would have two
    // behaviours where it had one.
    const thrown = (await guard('under_score', SIGNED_IN)) as { options: { to?: string } };

    expect(isRedirect(thrown), 'a malformed slug stopped being turned away').toBe(true);
    expect(thrown.options.to, 'the slug guard deferred to the session guard').toBe('/prijava');
  });
});

describe('a signed-in visitor is never offered a credential form', () => {
  /**
   * THE GUARD THAT SHIPS WITH THE EXIT, and the pairing is the argument rather
   * than a coincidence of scheduling.
   *
   * Neither sign-in route checked for a session: `/prijava/$slug` had a
   * slug-shape guard and no session check, and bare `/prijava` had no
   * `beforeLoad` at all — which made it the likelier of the two to be reached,
   * since `/`'s redirect, a typed URL and `not-found.tsx`'s link back all land
   * there. A session that already exists was therefore offered a form whose only
   * possible outcome is to replace that session with the same one.
   *
   * On a shared shift-work device that is not merely redundant. The person
   * reading the form may not be the person signed in, and until the chrome
   * shipped an exit there was no way for them to discover that or to do anything
   * about it — which is exactly why a guard added without the affordance would
   * have made the missing exit HARDER to notice, not easier. Both ship here.
   */

  /** Enough of a session to be distinguishable from `null`. */
  const SESSION = { access_token: 'token', user: { id: 'member' } } as unknown as Session;

  type SignInBeforeLoad = (options: {
    params: { slug: string };
    context: AppRouterContext;
  }) => unknown;

  /**
   * Both sign-in routes, swept together.
   *
   * A table rather than two blocks, because the claim is the same claim twice
   * and a hand-copied block is where the route that was missed hides — which is
   * the shape this very story is fixing. `prijava.test.ts` records the same
   * finding about its own form sweeps: covering one screen of an identical pair
   * left the other protected by nothing.
   */
  const SIGN_IN_ROUTES = [
    { name: 'the credential form at /prijava/$slug', route: prijavaRoute },
    { name: 'the organization prompt at bare /prijava', route: prijavaOrganizacijaRoute },
  ];

  async function beforeLoad(
    route: { options: unknown },
    currentSession: () => Promise<Session | null>,
  ): Promise<unknown> {
    const run = (route.options as { beforeLoad?: SignInBeforeLoad }).beforeLoad;

    // ASSERTED AND NARROWED in one place, the idiom the layout block below uses:
    // `run?.(…)` on an absent guard resolves to `undefined`, which every "was
    // not redirected" assertion here would read as a pass. A route with no
    // `beforeLoad` at all is precisely the state bare `/prijava` was in.
    if (typeof run !== 'function') {
      throw new Error('a sign-in route has no beforeLoad — a signed-in visitor is offered a form');
    }

    try {
      await run({
        params: { slug: 'dvd-kastel-novi' },
        context: { currentSession },
      });
    } catch (thrown) {
      return thrown;
    }

    return null;
  }

  it.each(SIGN_IN_ROUTES)('sends a signed-in visitor away from $name', async ({ route }) => {
    const thrown = await beforeLoad(route, () => Promise.resolve(SESSION));

    expect(thrown, 'a signed-in visitor was offered the form').not.toBeNull();
    expect(isRedirect(thrown), 'the guard threw something that is not a redirect').toBe(true);
    // `/` and not a destination: `/` is the one path that decides where a
    // signed-in person belongs, and naming a destination here would be this file
    // deciding it instead.
    expect((thrown as { options: { to?: string } }).options.to).toBe('/');
  });

  it.each(SIGN_IN_ROUTES)('leaves a signed-out visitor on $name', async ({ route }) => {
    // The branch that makes the other one worth having. A guard that redirected
    // unconditionally would satisfy every assertion above and leave nobody able
    // to sign in at all — the whole application unreachable, with the suite
    // green.
    expect(await beforeLoad(route, () => Promise.resolve(null))).toBeNull();
  });

  it.each(SIGN_IN_ROUTES)('fails OPEN on $name when the session cannot be read', async ({ route }) => {
    // THE OPPOSITE DEFAULT to `routes/_app.tsx`, and the asymmetry is the
    // decision. The layout treats an unreadable session as no session, because
    // letting somebody through puts them on screens every query refuses. Here
    // the same unreadable session must render the FORM: redirecting on a failed
    // read would put the one path that can repair a session behind the session
    // working, which is a deployment nobody can sign into.
    //
    // NOT SILENTLY, though — the cause is logged, for the reason `client.ts`
    // exists: a build with no environment must not read as an ordinary outage.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(
        await beforeLoad(route, () => Promise.reject(new Error('SecurityError'))),
        'an unreadable session turned somebody away from the only screen that could fix it',
      ).toBeNull();
      expect(logged, 'the guard swallowed the reason the session could not be read').toHaveBeenCalledWith(
        SESSION_UNRESOLVED,
        expect.anything(),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('asks the context exactly once per route, rather than reaching for a client', async () => {
    // What makes every branch above assertable at all, and the regression
    // `router.ts` records: a guard that imported the Supabase client would
    // ignore these stubs entirely and be untestable without a browser and a
    // running stack. Once, not twice — a second read per resolution is a second
    // storage round trip on the one screen a person is waiting on.
    for (const { route } of SIGN_IN_ROUTES) {
      let asked = 0;

      await beforeLoad(route, () => {
        asked += 1;

        return Promise.resolve(null);
      });

      expect(asked, 'a sign-in route never asked the context whether anyone is signed in').toBe(1);
    }
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

  it('renders the component that holds the outlet and the chrome', () => {
    // IDENTITY again. A layout resolved to `() => null` renders no outlet, so
    // every destination beneath it goes blank while every path still resolves.
    //
    // The title used to read "renders an outlet and nothing else", which stopped
    // being true the moment the navigation chrome landed — and what this
    // assertion actually pins is neither: `matchRoutes` resolves a path from the
    // route id alone, so this says the route names `AppLayout` and says nothing
    // about what `AppLayout` renders. `prijava.test.ts` owns that half, and owns
    // it in two assertions now, because reverting the layout to a bare outlet
    // passed this one unchanged.
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
