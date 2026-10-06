/**
 * THE DANAS SCREEN'S FILE SET, written once (story 6.1a), on *Godišnji*'s
 * terms (`leave-screen.fixture.ts`): a page that composes, the hook holding
 * its reads, and the components that draw it — the tiles since story 6.1b. `pages/prijava.test.ts`
 * reads it as source.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 * The page is first: the "the page itself renders" check reads it.
 */
export const TODAY_SCREEN_PARTS = {
  page: ['pages', 'danas.tsx'],
  hook: ['features', 'today', 'hooks', 'use-today.ts'],
  body: ['features', 'today', 'components', 'today-body.tsx'],
  todayCard: ['features', 'today', 'components', 'today-card.tsx'],
  nextShiftCard: ['features', 'today', 'components', 'next-shift-card.tsx'],
  weekList: ['features', 'today', 'components', 'week-list.tsx'],
  skeleton: ['features', 'today', 'components', 'today-skeleton.tsx'],
  // Story 6.1b: the two tiles; their skeleton is `today-skeleton.tsx`'s.
  hoursTile: ['features', 'today', 'components', 'hours-tile.tsx'],
  leaveTile: ['features', 'today', 'components', 'leave-tile.tsx'],
} as const;

/**
 * Non-test modules under the today feature that are NOT part of the set,
 * each with the reason. Everything else found there must be listed above.
 * Paths are relative to the feature.
 */
export const TODAY_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'today-screen.fixture.ts',
    why: 'this file: the set itself, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/today.ts',
    why: "every rule of the screen and its lines; a key source of its own, executed by today.test.ts",
  },
  {
    file: 'services/today-tiles.ts',
    why: "the two tiles' states, picked from Sati's and Godišnji's own derivations; executed by today-tiles.test.ts",
  },
];
