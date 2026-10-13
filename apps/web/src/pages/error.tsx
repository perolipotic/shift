import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { reportRouteFailure } from '@/lib/route-failure';

/**
 * What a route that FAILED renders (A148): a component that threw during
 * render, or a `beforeLoad` or loader that threw something other than a
 * redirect. Registered as the ROOT route's `errorComponent`, so it catches what
 * every route below it lets escape.
 *
 * Without it, TanStack Router's default rendered an untranslated English
 * message with the error's text — a stack trace's worth of source detail, in
 * the wrong language, to a person who can do nothing with it. This says
 * something failed, in `hr.json`'s words, and NOTHING MORE SPECIFIC: no
 * message, no code, no stack. The cause goes to the console, where whoever is
 * debugging looks for it, under a stable code (`@/lib/route-failure`).
 *
 * *Pokušaj ponovno* re-runs the current location (`router.invalidate()`), which
 * also resets the boundary; a fault that persists lands here again.
 *
 * A COMPONENT, not a route, for the reason `not-found.tsx` is one.
 */
export function ErrorScreen({ error }: ErrorComponentProps) {
  const router = useRouter();

  useEffect(() => {
    reportRouteFailure(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('error.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('error.lede')}</PageDescription>
        </div>
        <PageActions>
          <Button type="button" className="h-11" onClick={() => void router.invalidate()}>
            {t('error.retry')}
          </Button>
        </PageActions>
      </PageHeader>
    </main>
  );
}
