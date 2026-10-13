import { createRoute, redirect } from '@tanstack/react-router';

import { MEMBERS_ADD_OPEN } from '@/features/members/services/list';
import { adminGuard } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/ljudi/novi` — an old link to the add form (story 1.5b), now a redirect to
 * *Dodaj osobu*'s dialog on Ljudi, `/ljudi?dodaj=1` (story 7.13b). It renders
 * nothing: an admin is sent on, replacing the entry, and every other session
 * is sent where `/ljudi` sends it.
 */

export const ljudiNoviRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/novi',
  /**
   * The shared admin guard (`@/features/navigation/services/admin-guard`):
   * a member, or a level that cannot be read, is forwarded to the first
   * destination. AN ADMIN IS SENT ON TOO: to the dialog on Ljudi, replacing
   * this entry so Back does not land on a redirect.
   */
  beforeLoad: adminGuard(() => {
    throw redirect({ to: '/ljudi', search: { dodaj: MEMBERS_ADD_OPEN }, replace: true });
  }),
});
