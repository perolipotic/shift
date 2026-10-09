/**
 * THE TEAM SCREENS' FILE SETS, written once (source structure B6, and the
 * roster since B7).
 *
 * `/ljudi/smjene`, `/ljudi/smjene/$id` and `/smjene/$id` are more than one
 * file each: a page that only composes, the hook holding its reads, its state
 * and its handlers, and the components that draw it. The sign-in suite (`pages/prijava.test.ts`)
 * reads each set as one source, and `test/localization-applied.test.ts` checks
 * that its folder read holds every part, so both build their paths from this.
 *
 * THE THREE SETS ARE DISJOINT. The edit screen renders the list behind its
 * dialog, but no part belongs to two sets: a file in two would have its
 * strings, controls and handlers counted twice. Each set's handler names
 * (`submit` on the list and on the edit form) are declared once within it,
 * so the first-match extractors read the one they mean. The roster is
 * read-only and declares no handler at all.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing and runs in neither the browser nor a
 * test on its own.
 *
 * The order is the order a set is read in: the page first, which is what the
 * "the page itself renders" check reads.
 */
export const TEAM_LIST_PARTS = {
  page: ['pages', 'ljudi.smjene.tsx'],
  hook: ['features', 'teams', 'hooks', 'use-team-list.ts'],
  addDialog: ['features', 'teams', 'components', 'team-add-dialog.tsx'],
  section: ['features', 'teams', 'components', 'team-list-section.tsx'],
  table: ['features', 'teams', 'components', 'team-table.tsx'],
} as const;

export const TEAM_EDIT_PARTS = {
  page: ['pages', 'ljudi.smjene.$id.tsx'],
  hook: ['features', 'teams', 'hooks', 'use-team-edit.ts'],
  body: ['features', 'teams', 'components', 'team-edit-body.tsx'],
  archive: ['features', 'teams', 'components', 'team-archive.tsx'],
} as const;

/**
 * The roster (story 1.8, source structure B7): read-only, reached from Danas,
 * for every role. Its rules stay in `services/roster.ts`, exempt below.
 */
export const TEAM_ROSTER_PARTS = {
  page: ['pages', 'smjene.$id.tsx'],
  hook: ['features', 'teams', 'hooks', 'use-team-roster.ts'],
  roster: ['features', 'teams', 'components', 'team-roster.tsx'],
  // STORY 7.17: the member lines, lifted out of the roster so the member
  // directory on `/ljudi` says a person the same way.
  lines: ['features', 'teams', 'components', 'roster-lines.tsx'],
} as const;

/**
 * Non-test modules anywhere under the feature that are in NONE of the three sets, each
 * with the reason. The walk covers the WHOLE feature, recursively — its root
 * and every folder at any depth, not only `services/`, `components/`, `hooks/`
 * and `utils/`. Everything else found there must be listed above, and
 * everything listed above must exist. Paths are relative to the feature.
 */
export const TEAM_SCREENS_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'team-screens.fixture.ts',
    why: 'this file: the three sets themselves, read by two suites and rendered by nothing',
  },
  {
    file: 'services/list.ts',
    why: 'the one read (AD-13), the split into groups and the row and heading keys; a key source of its own in the sign-in suite, executed by list.test.ts',
  },
  {
    file: 'services/write.ts',
    why: 'the three writes, the refusals, the archive stages and the confirmations; a key source of its own in the sign-in suite, executed by write.test.ts',
  },
  {
    file: 'services/roster.ts',
    why: 'the roster read, its refusals and the Danas line (story 1.8); a key source of its own in the sign-in suite, executed by roster.test.ts',
  },
  {
    file: 'services/directory.ts',
    why: 'the member directory\'s groups, order, counts, search and states (story 7.17); renders nothing, executed by directory.test.ts',
  },
  {
    file: 'hooks/use-member-directory.ts',
    why: 'the member directory\'s reads and search box (story 7.17); swept as the sign-in suite\'s MEMBER_DIRECTORY set, composed by `/ljudi`',
  },
  {
    file: 'components/member-directory.tsx',
    why: 'the member directory\'s markup (story 7.17); swept as the sign-in suite\'s MEMBER_DIRECTORY set, composed by `/ljudi`',
  },
  {
    file: 'services/dependents.ts',
    why: 'the reads a team or membership write makes stale, and the one re-read over them; renders nothing, executed by dependents.test.ts',
  },
];
