import { createRoute, redirect } from '@tanstack/react-router';

import { adminGuard } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/raspored/$memberId/$date/$teamId` — the old URL of one conflict's
 * resolution screen, now a redirect to `/za-odluku/$memberId/$date/$teamId`
 * with the same three params, search and hash (story 9.1). It renders
 * nothing: an admin is sent on, replacing the entry, and every other session
 * is refused as on any admin-only path.
 */

export const rasporedCollisionRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/raspored/$memberId/$date/$teamId',
  /**
   * The shared admin guard, as `/raspored` carries it. Past it an admin is
   * sent on to the same conflict under `/za-odluku`, replacing this entry.
   */
  beforeLoad: (options) =>
    adminGuard(() => {
      throw redirect({
        to: '/za-odluku/$memberId/$date/$teamId',
        params: options.params,
        search: true,
        hash: true,
        replace: true,
      });
    })(options),
});
