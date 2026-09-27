/**
 * THE SIGN-IN SCREEN'S FILE SET, written once (source structure B7).
 *
 * `/prijava/$slug` is more than one file: a page that only composes, the hook
 * holding its refs, its state and its one exchange, and the form that draws
 * it. The sign-in suite (`pages/prijava.test.ts`) reads the set as one source,
 * and `test/localization-applied.test.ts` checks that its folder read holds
 * every part, so both build their paths from this.
 *
 * The organization prompt at bare `/prijava` is ONE file within budget, and is
 * in no set: it stays `pages/prijava-organizacija.tsx`.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing and runs in neither the browser nor a
 * test on its own.
 *
 * The order is the order the set is read in: the page first, which is what the
 * "the page itself renders" check reads.
 */
export const SIGN_IN_PARTS = {
  page: ['pages', 'prijava.tsx'],
  hook: ['features', 'auth', 'hooks', 'use-sign-in.ts'],
  form: ['features', 'auth', 'components', 'sign-in-form.tsx'],
} as const;

/**
 * Non-test modules anywhere under the feature that are NOT in the set, each
 * with the reason. The walk covers the WHOLE feature, recursively — its root
 * and every folder at any depth. Everything else found there must be listed
 * above, and everything listed above must exist. Paths are relative to the
 * feature.
 */
export const SIGN_IN_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'sign-in-screen.fixture.ts',
    why: 'this file: the set itself, read by two suites and rendered by nothing',
  },
  {
    file: 'services/address.ts',
    why: 'the AD-12 address and the slug rule both sign-in routes guard on; executed by address.test.ts',
  },
  {
    file: 'services/sign-in.ts',
    why: 'the exchange, its refusals and the failure-to-message mapping; a key source of its own in the sign-in suite, executed by sign-in.test.ts',
  },
  {
    file: 'services/sign-out.ts',
    why: 'the exit the navigation chrome offers, which the sign-in screen never renders; executed by sign-out.test.ts',
  },
];
