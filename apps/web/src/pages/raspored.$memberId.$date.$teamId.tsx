import { createRoute, redirect } from '@tanstack/react-router';

import { ConflictResolutionBody } from '@/features/conflicts/components/conflict-resolution-body';
import { useConflictResolution } from '@/features/conflicts/hooks/use-conflict-resolution';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/raspored/$memberId/$date/$teamId` — one conflict, decided on its own
 * screen (story 5.4b): the facts, the one outcome this story ships —
 * "Prihvati kao nepokriveno" — as a radio card with its consequence strip,
 * ‹ › to the adjacent unresolved conflict, and Spremi odluku. The three
 * params are the conflict's key, `collisionKeyOf`'s `(member, date, team)`.
 *
 * THIS FILE COMPOSES. The reads, the choice and the write are
 * `useConflictResolution`; the screen is components in
 * `@/features/conflicts/components`; every rule is in
 * `@/features/conflicts/services/resolution-screen` and
 * `@/features/conflicts/services/resolution-write`, which the node suite
 * executes.
 *
 * KEYED BY THE CONFLICT, so ‹ › to another one starts with nothing chosen
 * and no refusal carried over.
 *
 * ADMIN ONLY, with the guard `/raspored` carries, copied verbatim;
 * `router.test.ts` drives it. A member who types this URL is forwarded as
 * from `/raspored`. Not a destination: the `Raspored` tab lights for it.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

function ResolutionScreen({ params }: { readonly params: Parameters<typeof useConflictResolution>[0] }) {
  const state = useConflictResolution(params);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6" aria-busy={state.loading}>
      <ConflictResolutionBody state={state} />
    </main>
  );
}

export function RasporedKonfliktScreen() {
  const { memberId, date, teamId } = rasporedKonfliktRoute.useParams();

  return <ResolutionScreen key={JSON.stringify([memberId, date, teamId])} params={{ memberId, date, teamId }} />;
}

export const rasporedKonfliktRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/raspored/$memberId/$date/$teamId',
  /** The guard `/raspored` carries, copied verbatim; `router.test.ts` drives it. */
  beforeLoad: async ({ context }) => {
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) return;

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
  component: RasporedKonfliktScreen,
});
