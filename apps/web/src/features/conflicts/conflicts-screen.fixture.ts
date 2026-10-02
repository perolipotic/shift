/**
 * THE RASPORED SCREENS' FILE SETS, written once (stories 5.3b, 5.4b), on the
 * hour band screens' terms (`hour-band-screens.fixture.ts`): each a page that
 * only composes, the hook holding its reads and handlers, and the components
 * that draw it. `pages/prijava.test.ts` reads each set as one source.
 *
 * THE TWO SETS ARE DISJOINT: the conflicts queue (`/raspored`) and one
 * conflict's resolution screen (`/raspored/$memberId/$date/$teamId`). No part
 * belongs to both, so no string, control or handler is counted twice.
 *
 * Paths are SEGMENTS under `apps/web/src`, so this module imports nothing.
 * The page is first in each: the "the page itself renders" check reads it.
 */
export const CONFLICTS_QUEUE_PARTS = {
  page: ['pages', 'raspored.tsx'],
  hook: ['features', 'conflicts', 'hooks', 'use-conflicts-queue.ts'],
  body: ['features', 'conflicts', 'components', 'conflicts-body.tsx'],
  list: ['features', 'conflicts', 'components', 'conflicts-list.tsx'],
  skeleton: ['features', 'conflicts', 'components', 'conflicts-skeleton.tsx'],
} as const;

export const CONFLICT_RESOLUTION_PARTS = {
  page: ['pages', 'raspored.$memberId.$date.$teamId.tsx'],
  hook: ['features', 'conflicts', 'hooks', 'use-conflict-resolution.ts'],
  body: ['features', 'conflicts', 'components', 'conflict-resolution-body.tsx'],
  option: ['features', 'conflicts', 'components', 'resolution-option.tsx'],
  picker: ['features', 'conflicts', 'components', 'replacement-picker.tsx'],
  skeleton: ['features', 'conflicts', 'components', 'resolution-skeleton.tsx'],
} as const;

/**
 * Non-test modules under the conflicts feature that are in NEITHER set, each
 * with the reason. Everything else found there must be listed above.
 * Paths are relative to the feature.
 */
export const CONFLICTS_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'conflicts-screen.fixture.ts',
    why: 'this file: the two sets themselves, read by the sign-in suite and rendered by nothing',
  },
  {
    file: 'services/conflicts-queue.ts',
    why: 'every rule of the queue — its input, order, rows and guard; renders nothing, executed by conflicts-queue.test.ts',
  },
  {
    file: 'services/resolutions.ts',
    why: 'the live conflict resolutions (story 5.4a) — their two reads, keys and parser; renders nothing, executed by resolutions.test.ts',
  },
  {
    file: 'services/resolution-screen.ts',
    why: 'every rule of the resolution screen (story 5.4b) — its place in the queue, facts, strip and status line; a key source of its own, executed by resolution-screen.test.ts',
  },
  {
    file: 'services/resolution-write.ts',
    why: 'the two resolution writes (stories 5.4b, 5.4c) and their refusals; a key source of its own, executed by resolution-write.test.ts',
  },
];
