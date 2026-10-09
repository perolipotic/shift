import { createRoute, redirect } from '@tanstack/react-router';

import { MEMBERS_ADD_OPEN, mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/ljudi/novi` — an old link to the add form (story 1.5b), now a redirect to
 * *Dodaj osobu*'s dialog on Ljudi, `/ljudi?dodaj=1` (story 7.13b). It renders
 * nothing: an admin is sent on, replacing the entry, and every other session
 * is sent where `/ljudi` sends it.
 */

/** Where a session that is not an administrator's is sent. The FIRST
 *  destination, read off the table — the same answer `/` and `/ljudi` give. */
const FIRST_DESTINATION = DESTINATIONS[0];

export const ljudiNoviRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/novi',
  /**
   * The same role guard `/ljudi` carries, and it is written out rather than
   * shared — copied VERBATIM, and `router.test.ts` drives all three copies by
   * execution rather than by reading any of them.
   *
   * THE READER ARRIVES THROUGH THE ROUTER CONTEXT, which is what keeps this
   * guard out of the build environment: a `supabaseClient()` call here throws
   * `SUPABASE_ENVIRONMENT_MISSING` synchronously on a fresh clone with no
   * `.env.local`, and the whole point of the context reader is that every branch
   * runs in the node suite with nothing running.
   *
   * FAILING CLOSED: a level that cannot be read is not an administrator's, so
   * the visitor is forwarded like any other refused one. Not silently — a
   * swallowed cause is how a misconfiguration reads as an ordinary redirect.
   *
   * AN ADMIN IS SENT ON TOO, after the guard: to the dialog on Ljudi, replacing
   * this entry so Back does not land on a redirect.
   */
  beforeLoad: async ({ context }) => {
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) {
      throw redirect({ to: '/ljudi', search: { dodaj: MEMBERS_ADD_OPEN }, replace: true });
    }

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
});
