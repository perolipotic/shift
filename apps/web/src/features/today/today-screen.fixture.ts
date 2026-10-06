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
  // Story 6.2: the duty-block, drawn in the today card's place on a 24 h duty.
  dutyBlock: ['features', 'today', 'components', 'duty-block.tsx'],
  // SINCE STORY 6.3: an admin's own body, the hook holding its three reads
  // (and the role the page picks the body by), its four blocks and its
  // skeleton.
  adminHook: ['features', 'today', 'hooks', 'use-admin-today.ts'],
  adminBody: ['features', 'today', 'components', 'admin-today-body.tsx'],
  needsYouCard: ['features', 'today', 'components', 'needs-you-card.tsx'],
  coverageCard: ['features', 'today', 'components', 'coverage-card.tsx'],
  absentCard: ['features', 'today', 'components', 'absent-card.tsx'],
  weekGrid: ['features', 'today', 'components', 'week-grid.tsx'],
  adminSkeleton: ['features', 'today', 'components', 'admin-today-skeleton.tsx'],
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
  {
    file: 'services/today-duty.ts',
    why: "today's 24 h duty (story 6.2): the window, the legs and their notes, and the duty-block's lines; a key source of its own, executed by today.test.ts",
  },
  {
    file: 'services/admin-today.ts',
    why: "an admin's Danas (story 6.3): the queue's gating, Treba tebe, the coverage, the absences, the week and the subtitle's status; a key source of its own, executed by admin-today.test.ts",
  },
];
