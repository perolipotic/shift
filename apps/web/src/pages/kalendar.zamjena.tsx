import { createRoute } from '@tanstack/react-router';

import { OfflineNote } from '@/components/offline-note';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import {
  SwapProposalBack,
  SwapProposalFormBody,
  SwapProposalSkeleton,
} from '@/features/swaps/components/swap-proposal-form';
import { useSwapProposal, useSwapProposalView } from '@/features/swaps/hooks/use-swap-proposal';
import { SWAP_VIEW_UNAVAILABLE, swapSearchOf, type SwapSearch } from '@/features/swaps/services/swap-proposal';
import { SWAP_PROPOSAL_HEADING_ID, SWAP_PROPOSAL_WAIT_HEADING_ID } from '@/features/swaps/utils/element-ids';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * `/kalendar/zamjena?dan=…&smjena=…` — *Predloži zamjenu* (story 12.2,
 * UX-DR47): a member offers one of their own working shifts to a colleague,
 * optionally taking one of the colleague's in return, and sees who would work
 * which date and what it does to each one's hours before sending it. A
 * SURFACE OF ITS OWN (UX-DR33 counts request swap among the surfaces),
 * reached from the day detail's footer; the *Kalendar* tab lights for it.
 * This file composes the screen; the role gate is `useSwapProposalView`, the
 * form `useSwapProposal`, and every rule is
 * `@/features/swaps/services/swap-proposal`'s.
 *
 * THE ROLE is the calendar snapshot's: an admin is sent to `/kalendar`; only
 * a member's view mounts the form's reads. An unknown role is the unavailable
 * notice with its retry (online), and every state has *Natrag na Kalendar*
 * above the title, so none is a dead end.
 *
 * Offline the form is drawn from the cached snapshot under the as-of note,
 * and *Pošalji* is gated. The session guard is the `_app` layout's.
 */
export function KalendarZamjenaScreen() {
  const search = kalendarZamjenaRoute.useSearch();
  const { view, member, retryable, retry } = useSwapProposalView();

  if (member) {
    return <SwapProposalScreen search={search} />;
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-busy={view !== SWAP_VIEW_UNAVAILABLE}
      aria-labelledby={SWAP_PROPOSAL_WAIT_HEADING_ID}
    >
      <PageHeader>
        <div className="grid min-w-0 gap-1">
          <SwapProposalBack date={search.dan} />
          <PageTitle asChild>
            <h1 id={SWAP_PROPOSAL_WAIT_HEADING_ID}>{t('kalendar.swap.heading')}</h1>
          </PageTitle>
        </div>
      </PageHeader>
      <Card className="min-w-0 p-4">
        {/* An admin on the way to the calendar, or an unknown role: never the form. */}
        {view !== SWAP_VIEW_UNAVAILABLE ? (
          <SwapProposalSkeleton />
        ) : (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t('kalendar.swap.unavailable')}</Notice>
            {retryable ? (
              <Button
                ref={keepFocusOnAlert}
                className="h-11 w-full sm:w-auto sm:justify-self-start"
                type="button"
                variant="outline"
                onClick={retry}
              >
                {t('kalendar.retry')}
              </Button>
            ) : null}
          </div>
        )}
      </Card>
    </main>
  );
}

/** A member's form: the heading, the as-of note while offline, and the form's body. */
function SwapProposalScreen({ search }: { readonly search: SwapSearch }) {
  const form = useSwapProposal(search);

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-busy={form.loading}
      aria-labelledby={SWAP_PROPOSAL_HEADING_ID}
    >
      <PageHeader>
        <div className="grid min-w-0 gap-1">
          <SwapProposalBack date={search.dan} />
          <PageTitle asChild>
            <h1 id={SWAP_PROPOSAL_HEADING_ID}>{t('kalendar.swap.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('kalendar.swap.lede')}</PageDescription>
        </div>
      </PageHeader>
      <OfflineNote offline={form.offline} />
      <Card className="min-w-0 p-4">
        <SwapProposalFormBody form={form} />
      </Card>
    </main>
  );
}

export const kalendarZamjenaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/kalendar/zamjena',
  validateSearch: (search: Record<string, unknown>): SwapSearch => swapSearchOf(search),
  component: KalendarZamjenaScreen,
});
