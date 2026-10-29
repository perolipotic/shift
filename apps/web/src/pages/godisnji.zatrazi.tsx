import { createRoute } from '@tanstack/react-router';

import { OfflineNote } from '@/components/offline-note';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { LeaveRequestBack, LeaveRequestFormBody } from '@/features/leave/components/leave-request-form';
import { MyLeaveSkeleton } from '@/features/leave/components/my-leave-skeleton';
import { useLeaveRequestForm, useLeaveRequestView } from '@/features/leave/hooks/use-leave-request-form';
import { GODISNJI_LOADING, GODISNJI_OVERVIEW, GODISNJI_OWN } from '@/features/leave/services/leave-overview';
import { LEAVE_REQUEST_HEADING_ID } from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * `/godisnji/zatrazi` — *Zatraži godišnji odmor* (story 9.3, UX-DR47): a
 * member asks for a range of leave and sees what it would cost before sending
 * it. A SURFACE OF ITS OWN, with a URL (UX-DR33 counts it among the new
 * surfaces), reached from a member's *Godišnji*; the *Godišnji* tab lights
 * for it. This file composes the screen; the role gate is
 * `useLeaveRequestView`, the form `useLeaveRequestForm`, and every rule is in
 * `@/features/leave/services/my-leave`, `.../leave-request-list` and
 * `.../leave-request-write`.
 *
 * THE ROLE is the calendar snapshot's, as on *Godišnji*: an admin is sent to
 * `/godisnji`, the overview; only a member's view mounts the form's reads. An
 * unknown role is the unavailable notice with its retry (online), and every
 * state has *Natrag na Godišnji* above the title, so none is a dead end.
 *
 * Offline the form is drawn from the cached snapshot under the as-of note,
 * and *Pošalji* is gated. The session guard is the `_app` layout's.
 */
export function GodisnjiZatraziScreen() {
  const { view, retryable, retry } = useLeaveRequestView();

  if (view === GODISNJI_OWN) {
    return <LeaveRequestScreen />;
  }

  const waiting = view === GODISNJI_LOADING || view === GODISNJI_OVERVIEW;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6" aria-busy={waiting}>
      <PageHeader>
        <div className="grid min-w-0 gap-1">
          <LeaveRequestBack />
          <PageTitle asChild>
            <h1>{t('godisnji.request.heading')}</h1>
          </PageTitle>
        </div>
      </PageHeader>
      <Card className="min-w-0 p-4">
        {/* An admin on the way to the overview, or an unknown role: never the form. */}
        {waiting ? (
          <MyLeaveSkeleton />
        ) : (
          <div className="grid min-w-0 gap-2">
            <Notice role="alert">{t('godisnji.unavailable')}</Notice>
            {retryable ? (
              <Button
                ref={keepFocusOnAlert}
                className="h-11 w-full sm:w-auto sm:justify-self-start"
                type="button"
                variant="outline"
                onClick={retry}
              >
                {t('godisnji.retry')}
              </Button>
            ) : null}
          </div>
        )}
      </Card>
    </main>
  );
}

/** A member's form: the heading, the as-of note while offline, and the form's body. */
function LeaveRequestScreen() {
  const form = useLeaveRequestForm();

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col gap-6 p-6"
      aria-busy={form.loading}
      aria-labelledby={LEAVE_REQUEST_HEADING_ID}
    >
      <PageHeader>
        <div className="grid min-w-0 gap-1">
          <LeaveRequestBack />
          <PageTitle asChild>
            <h1 id={LEAVE_REQUEST_HEADING_ID}>{t('godisnji.request.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('godisnji.request.lede')}</PageDescription>
        </div>
      </PageHeader>
      <OfflineNote offline={form.offline} />
      <Card className="min-w-0 p-4">
        <LeaveRequestFormBody form={form} />
      </Card>
    </main>
  );
}

export const godisnjiZatraziRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/godisnji/zatrazi',
  component: GodisnjiZatraziScreen,
});
