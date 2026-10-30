/**
 * STORY 10.3: THE NOTIFICATION SETTINGS SCREEN'S FILE SET, `/obavijesti` —
 * its page, the hook holding its read and its one write, and the card. The
 * page is first. Segments under `apps/web/src`, joined by each suite against
 * its own root, so this module imports nothing.
 */
export const NOTIFICATIONS_SCREEN_PARTS = {
  page: ['pages', 'obavijesti.tsx'],
  hook: ['features', 'notifications', 'hooks', 'use-notification-settings.ts'],
  card: ['features', 'notifications', 'components', 'notification-settings-card.tsx'],
  // Story 10.4: this device's push section, its hook and its card.
  pushHook: ['features', 'notifications', 'hooks', 'use-push-settings.ts'],
  pushCard: ['features', 'notifications', 'components', 'push-settings-card.tsx'],
} as const;

/**
 * Non-test modules under the notifications feature that are NOT part of the
 * set, each with the reason. Everything else found there must be listed
 * above. Paths are relative to the feature.
 */
export const NOTIFICATIONS_SCREEN_EXEMPT: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'notifications-screen.fixture.ts',
    why: 'this file: the set itself, read by the source sweeps and rendered by nothing',
  },
  {
    file: 'utils/element-ids.ts',
    why: 'the screen’s element ids, named once; identifiers rather than copy, as the settings page’s are',
  },
  {
    file: 'services/settings.ts',
    why: 'the read, the write and the view rule; a key source of its own, executed by settings.test.ts',
  },
  {
    file: 'services/push.ts',
    why: 'the device read, the push on and off, sign-out’s forgetting and the view rule; a key source of its own, executed by push.test.ts',
  },
  {
    file: 'services/page-push.ts',
    why: 'binds push.ts to `window`, the one client and the build’s VAPID public key; no copy',
  },
];
