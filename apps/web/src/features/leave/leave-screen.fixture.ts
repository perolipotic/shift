/**
 * THE GODIŠNJI SCREEN'S FILE SET, written once (story 5.2c), on the *Sati*
 * screen's terms (`hours-screen.fixture.ts`): a page that only composes, the
 * hook holding its reads, and the components that draw it.
 * `pages/prijava.test.ts` reads it as source.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 * The page is first: the "the page itself renders" check reads it.
 */
export const LEAVE_SCREEN_PARTS = {
  page: ['pages', 'godisnji.tsx'],
  hook: ['features', 'leave', 'hooks', 'use-my-leave.ts'],
  body: ['features', 'leave', 'components', 'my-leave-body.tsx'],
  summary: ['features', 'leave', 'components', 'my-leave-summary.tsx'],
  skeleton: ['features', 'leave', 'components', 'my-leave-skeleton.tsx'],
} as const;

/**
 * Non-test modules under the leave feature that are NOT part of the set, each
 * with the reason. Everything else found there must be listed above. Paths
 * are relative to the feature.
 */
export const LEAVE_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'leave-screen.fixture.ts',
    why: 'this file: the set itself, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/my-leave.ts',
    why: 'every rule of the screen and its two lines; a key source of its own, executed by my-leave.test.ts',
  },
  {
    file: 'services/leave-list.ts',
    why: "the leave reads — a member's records for the admin card, the viewer's own for this screen; renders nothing",
  },
  {
    file: 'services/leave-section.ts',
    why: "every rule of the admin's leave card on the member page; a key source of its own, executed by leave-section.test.ts",
  },
  {
    file: 'services/leave-write.ts',
    why: "the admin card's record, amend and removal writes; renders nothing, executed by leave-write.test.ts",
  },
  {
    file: 'hooks/use-member-leave.ts',
    why: "the admin card's hook, a part of the member edit screen's set in pages/prijava.test.ts",
  },
  {
    file: 'components/member-leave-card.tsx',
    why: "the admin card on the member page, a part of the member edit screen's set in pages/prijava.test.ts",
  },
  {
    file: 'components/member-leave-records.tsx',
    why: "the admin card's records and removal confirmation, a part of the member edit screen's set",
  },
];
