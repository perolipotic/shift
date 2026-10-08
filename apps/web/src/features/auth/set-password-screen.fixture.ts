/**
 * THE SET-PASSWORD SCREEN'S FILE SET, written once (story 7.8).
 *
 * The first sign-in's one step, on `/postavi-lozinku`: a page that only
 * composes, the hook holding its refs, its state and its one exchange, and the
 * form that draws it. DISJOINT from `sign-in-screen.fixture.ts`'s set — the
 * two screens share the auth feature and no part — and read by
 * `pages/prijava.test.ts`, which walks the feature and requires every module
 * in it to belong to one set or be exempt for a stated reason.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing. The page comes first.
 */
export const SET_PASSWORD_PARTS = {
  page: ['pages', 'postavi-lozinku.tsx'],
  hook: ['features', 'auth', 'hooks', 'use-set-password.ts'],
  form: ['features', 'auth', 'components', 'set-password-form.tsx'],
} as const;

/**
 * Modules under the auth feature that belong to neither screen's set because
 * of this story, each with the reason. Relative to the feature.
 */
export const SET_PASSWORD_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'set-password-screen.fixture.ts',
    why: 'this file: the set itself, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/set-password.ts',
    why: 'the flag the layout guards on, the local checks, the three-step save and the failure-to-message mapping; a key source of its own, executed by set-password.test.ts',
  },
];
