/**
 * THE RASPORED SCREEN'S FILE SET, written once (story 5.3b), on the *Sati*
 * screen's terms (`hours-screen.fixture.ts`): a page that only composes, the
 * hook holding its reads, and the components that draw the conflicts
 * queue. `pages/prijava.test.ts` reads it as source.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 * The page is first: the "the page itself renders" check reads it.
 */
export const CONFLICTS_SCREEN_PARTS = {
  page: ['pages', 'raspored.tsx'],
  hook: ['features', 'conflicts', 'hooks', 'use-conflicts-queue.ts'],
  body: ['features', 'conflicts', 'components', 'conflicts-body.tsx'],
  list: ['features', 'conflicts', 'components', 'conflicts-list.tsx'],
  skeleton: ['features', 'conflicts', 'components', 'conflicts-skeleton.tsx'],
} as const;

/**
 * Non-test modules under the conflicts feature that are NOT part of the set,
 * each with the reason. Everything else found there must be listed above.
 * Paths are relative to the feature.
 */
export const CONFLICTS_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'conflicts-screen.fixture.ts',
    why: 'this file: the set itself, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/conflicts-queue.ts',
    why: 'every rule of the queue — its input, order, rows and guard; renders nothing, executed by conflicts-queue.test.ts',
  },
  {
    file: 'services/resolutions.ts',
    why: 'the live conflict resolutions (story 5.4a) — their two reads, keys and parser; renders nothing, executed by resolutions.test.ts',
  },
];
