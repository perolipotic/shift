import { createRoute } from '@tanstack/react-router';

import { ConflictResolutionBody } from '@/features/conflicts/components/conflict-resolution-body';
import { useConflictResolution } from '@/features/conflicts/hooks/use-conflict-resolution';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/za-odluku/$memberId/$date/$teamId` — one conflict, decided on its own
 * screen (story 5.4b; under `/raspored` until story 9.1, whose old URL now
 * redirects here): the facts, the one outcome this story ships —
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
 * ADMIN ONLY, with the admin guard `/za-odluku` carries;
 * `router.test.ts` drives it. A member who types this URL is forwarded as
 * from `/za-odluku`. Not a destination: the `Za odluku` tab lights for it.
 *
 * STORY 8.2c: offline, the five cached reads are drawn whole under the as-of
 * note — under the heading the body draws in each of its states — or the
 * unavailable state is. Saving still refuses through the write's own failure.
 */

function ResolutionScreen({ params }: { readonly params: Parameters<typeof useConflictResolution>[0] }) {
  const state = useConflictResolution(params);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6" aria-busy={state.loading}>
      <ConflictResolutionBody state={state} />
    </main>
  );
}

export function ZaOdlukuCollisionScreen() {
  const { memberId, date, teamId } = zaOdlukuCollisionRoute.useParams();

  return <ResolutionScreen key={JSON.stringify([memberId, date, teamId])} params={{ memberId, date, teamId }} />;
}

export const zaOdlukuCollisionRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/za-odluku/$memberId/$date/$teamId',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: ZaOdlukuCollisionScreen,
});
