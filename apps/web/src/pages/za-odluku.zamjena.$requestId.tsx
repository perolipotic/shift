import { createRoute } from '@tanstack/react-router';

import { SwapDecisionBody } from '@/features/swaps/components/swap-decision-body';
import { useSwapDecision } from '@/features/swaps/hooks/use-swap-decision';
import { SWAP_DECISION_HEADING_ID } from '@/features/swaps/utils/element-ids';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/za-odluku/zamjena/$requestId` — one swap a colleague accepted, decided on
 * its own screen (story 12.4, UX-DR33/46): who gives which shift to whom, and
 * what approval does — each member's hours, leave, a double booking and the
 * shifts it leaves short of people, never a gate — with *Odobri* and *Odbij*.
 * A swap no longer waiting reads only its status, and who decided and when.
 *
 * THIS FILE COMPOSES. The reads and the decision are `useSwapDecision`; the
 * screen is `@/features/swaps/components/swap-decision-body`; every rule is
 * in `@/features/swaps/services/swap-decision`, which the node suite
 * executes.
 *
 * KEYED BY THE SWAP, so another one starts with no refusal carried over.
 *
 * ADMIN ONLY, with the admin guard `/za-odluku` carries; `router.test.ts`
 * drives it. A member who types this URL is forwarded as from `/za-odluku`.
 * Not a destination: the `Za odluku` tab lights for it. The main region is
 * named by the heading, drawn in every state. Offline it reads as one
 * snapshot under the as-of note, and both decisions are gated.
 */

function DecisionScreen({ requestId }: { readonly requestId: string }) {
  const state = useSwapDecision(requestId);

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-busy={state.loading}
      aria-labelledby={SWAP_DECISION_HEADING_ID}
    >
      <SwapDecisionBody state={state} />
    </main>
  );
}

export function ZaOdlukuSwapScreen() {
  const { requestId } = zaOdlukuSwapRoute.useParams();

  return <DecisionScreen key={requestId} requestId={requestId} />;
}

export const zaOdlukuSwapRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/za-odluku/zamjena/$requestId',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: ZaOdlukuSwapScreen,
});
