import { createRoute } from '@tanstack/react-router';

import { LeaveRequestReviewBody } from '@/features/leave/components/leave-request-review-body';
import { useLeaveRequestReview } from '@/features/leave/hooks/use-leave-request-review';
import { LEAVE_REQUEST_REVIEW_HEADING_ID } from '@/features/leave/utils/element-ids';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/za-odluku/zahtjev/$requestId` — one leave request, decided on its own
 * screen (story 9.4, UX-DR33/46): who asked, the range, what it costs, the
 * balance after it and the collisions approval would create, with *Odobri*
 * and *Odbij*. A closed request reads only its status, and who decided and
 * when, or the date it was withdrawn. Until story 9.5 lists requests in the
 * queue, it is reached by URL.
 *
 * THIS FILE COMPOSES. The reads and the decision are
 * `useLeaveRequestReview`; the screen is
 * `@/features/leave/components/leave-request-review-body`; every rule is in
 * `@/features/leave/services/leave-request-review`, `.../leave-request-list`
 * and `.../leave-request-write`, which the node suite executes.
 *
 * KEYED BY THE REQUEST, so another one starts with no refusal carried over.
 *
 * ADMIN ONLY, with the admin guard `/za-odluku` carries; `router.test.ts`
 * drives it. A member who types this URL is forwarded as from `/za-odluku`.
 * Not a destination: the `Za odluku` tab lights for it. The main region is
 * named by the heading, drawn in every state. Offline it reads as
 * one snapshot under the as-of note, and both decisions are gated.
 */

function ReviewScreen({ requestId }: { readonly requestId: string }) {
  const state = useLeaveRequestReview(requestId);

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-busy={state.loading}
      aria-labelledby={LEAVE_REQUEST_REVIEW_HEADING_ID}
    >
      <LeaveRequestReviewBody state={state} />
    </main>
  );
}

export function ZaOdlukuRequestScreen() {
  const { requestId } = zaOdlukuRequestRoute.useParams();

  return <ReviewScreen key={requestId} requestId={requestId} />;
}

export const zaOdlukuRequestRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/za-odluku/zahtjev/$requestId',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: ZaOdlukuRequestScreen,
});
