/**
 * THE SETTINGS SURFACE'S FILE SET, written once (source structure B2).
 *
 * `/organizacija` is more than one file: a page that only composes, the hook
 * holding its read and its five writes, the components that draw it, and one
 * helper. Two suites read it as source — `pages/prijava.test.ts` and
 * `features/organization/services/snapshot.test.ts` — and two hand-written
 * copies of the list would be two answers to "what is the screen". Both build
 * their paths from this.
 *
 * Paths are SEGMENTS under `apps/web/src`, joined by each suite against its own
 * root, so this module imports nothing and runs in neither the browser nor a
 * test on its own.
 *
 * The order is the order a set is read in: the page first, which is what the
 * "the page itself renders" check reads.
 */
export const SETTINGS_SCREEN_PARTS = {
  page: ['pages', 'organizacija.tsx'],
  hook: ['features', 'organization', 'hooks', 'use-organization-settings.ts'],
  card: ['features', 'organization', 'components', 'organization-settings-card.tsx'],
  // STORY 7.18: the three fact cards, the dialog every change opens in, and
  // the two dialogs that have files of their own.
  dialog: ['features', 'organization', 'components', 'organization-dialog.tsx'],
  profile: ['features', 'organization', 'components', 'organization-profile-card.tsx'],
  logo: ['features', 'organization', 'components', 'organization-logo-dialog.tsx'],
  accent: ['features', 'organization', 'components', 'organization-accent-dialog.tsx'],
  time: ['features', 'organization', 'components', 'organization-time-card.tsx'],
  fireRanks: ['features', 'organization', 'components', 'organization-fire-ranks-card.tsx'],
  accentLabel: ['features', 'organization', 'utils', 'accent-label.ts'],
} as const;

/**
 * Files under the feature's `components/`, `hooks/` and `utils/` that are NOT
 * part of the set, each with the reason. Everything else found there must be
 * listed above, and everything listed above must exist.
 */
export const SETTINGS_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'components/lockup.tsx',
    why: 'shared with the navigation chrome and swept on its own (LOCKUP); in the set its strings and controls would count twice',
  },
  {
    file: 'hooks/logo-url.ts',
    why: 'the one signed-URL read shared with the chrome, swept on its own (LOGO_URL)',
  },
  {
    file: 'utils/accent.ts',
    why: 'the curated accent set, shared with the chrome and the lockup; a key source of its own (ACCENT_KEYS)',
  },
  {
    file: 'utils/messages.ts',
    why: 'the refusal-to-message mapping; a key source of its own (ORGANIZATION_MESSAGE_KEYS)',
  },
  {
    file: 'utils/element-ids.ts',
    why: 'the page’s element ids, named once (story 7.18); identifiers rather than copy, as the member page’s are',
  },
  {
    file: 'utils/dialogs.ts',
    why: 'the five dialog names (story 7.18); identifiers that say which dialog is open, never a string the page renders',
  },
  {
    file: 'utils/leave-start.ts',
    why: 'a rule module that predates B2, executed by leave-start.test.ts; its reference zone is a literal no screen may hold',
  },
];
