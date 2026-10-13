import { redirect } from '@tanstack/react-router';

import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import {
  MEMBER_ROLE_UNAVAILABLE,
  isAdministrator,
  type MemberRoleOutcome,
  type MemberRoleReader,
} from '@/features/navigation/services/role';

/**
 * The admin route guard, ONCE (B393).
 *
 * About ten admin-only routes carried the same `beforeLoad` copied verbatim —
 * read the level, fail closed on a rejection, admit an administrator, forward
 * anybody else to the first destination — and decided it with a predicate
 * named for reading members. Copies drift, and `router.test.ts` had to drive
 * each one to stop that. Now every admin-only route registers
 * {@link requireAdmin} (or, for `/ljudi/novi`, a guard from
 * {@link adminGuard} whose admitted branch redirects), and the decision is
 * `isAdministrator`'s.
 *
 * THE READER ARRIVES THROUGH THE ROUTER CONTEXT, as before: it keeps every
 * branch executable from the node suite and keeps `supabaseClient()` — which
 * throws on a fresh clone with no `.env.local` — out of the guard.
 *
 * IT FORWARDS, IT DOES NOT REFUSE: a member who types an admin URL is sent to
 * the first destination with `replace: true`, so Back is not a loop.
 */

/** Where a refused session is sent: the FIRST destination, read from the table
 *  rather than written as a path, the same one `/` forwards to. */
const FIRST_DESTINATION = DESTINATIONS[0];

/** As much of a `beforeLoad`'s options as the role read uses. */
export interface RoleGuardOptions {
  readonly context: { readonly currentMemberRole: MemberRoleReader };
  /** TanStack's reason for the run; `stay` is a search-only navigation. */
  readonly cause?: 'preload' | 'enter' | 'stay' | undefined;
}

/**
 * The signed-in member's level for a route guard, never a rejection.
 *
 * THREE OUTCOMES, and the third is why the read is wrapped: the reader can
 * REJECT — the client throws on a build with no environment, storage can be
 * blocked, and a read over its time budget rejects too — and an escaping
 * rejection resolves the route to the error screen rather than to a decision.
 * FAILING CLOSED, and not silently: the cause is logged and the outcome is
 * `MEMBER_ROLE_UNAVAILABLE`, which no guard admits.
 *
 * A ROUTE THAT STAYS (`cause: 'stay'`, a search-only navigation such as typing
 * in `/ljudi`'s search) reuses the cached answer rather than reading the level
 * per keystroke (E878). Entering a route still reads it fresh.
 */
export async function guardMemberRole({ context, cause }: RoleGuardOptions): Promise<MemberRoleOutcome> {
  try {
    return await context.currentMemberRole({ reuse: cause === 'stay' });
  } catch (failure) {
    console.error(MEMBER_ROLE_UNAVAILABLE, failure);

    return { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
  }
}

/**
 * An admin-only route's `beforeLoad`.
 *
 * `admitted` runs for an administrator and may throw a redirect of its own
 * (`/ljudi/novi` sends an admin on to the add dialog); without it an
 * administrator is let through. Anybody else — a member, or a level that
 * could not be read — is forwarded to the first destination, replacing the
 * entry.
 */
export function adminGuard(admitted?: () => void): (options: RoleGuardOptions) => Promise<void> {
  return async (options) => {
    if (isAdministrator(await guardMemberRole(options))) {
      admitted?.();

      return;
    }

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  };
}

/** The guard every admin-only screen registers, by identity (`router.test.ts`). */
export const requireAdmin = adminGuard();
