import { createRoute, redirect } from '@tanstack/react-router';

import { adminGuard } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/raspored` — the old URL of the queue, now a redirect to *Za odluku*,
 * `/za-odluku` (story 9.1). It renders nothing: an admin is sent on with any
 * search and hash, replacing the entry so history keeps no `/raspored`, and
 * every other session is refused as on any admin-only path.
 */

export const rasporedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/raspored',
  /**
   * The shared admin guard (`@/features/navigation/services/admin-guard`):
   * a member, or a level that cannot be read, is forwarded to the first
   * destination. AN ADMIN IS SENT ON TOO: to `/za-odluku`, replacing this
   * entry so Back does not land on a redirect.
   */
  beforeLoad: adminGuard(() => {
    throw redirect({ to: '/za-odluku', search: true, hash: true, replace: true });
  }),
});
