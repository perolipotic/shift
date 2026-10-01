import { createRoute } from '@tanstack/react-router';

import { Card } from '@/components/ui/card';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { MyLeaveBody } from '@/features/leave/components/my-leave-body';
import { useMyLeave } from '@/features/leave/hooks/use-my-leave';
import { t } from '@/lib/i18n';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Godišnji` — the viewer's own leave (story 5.2c): their allowance, the days
 * used in the current leave year and the balance, and nobody else's. This
 * file composes the screen; its reads and its state are `useMyLeave`, its
 * figures are components in `@/features/leave/components`, and every rule is
 * in `@/features/leave/services/my-leave`, which the node suite executes.
 *
 * Member and admin alike (UX-DR31/UX-DR32): an admin reads their own member
 * row's figures here, as a member does. The path drops the diacritics the
 * label carries: a URL segment is not a label, and `hr.json` is where the `š`
 * belongs.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under, so a signed-out visitor opening this URL is
 * redirected before the component is ever asked for.
 */
export function GodisnjiScreen() {
  const { leave, loading, retry } = useMyLeave();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <PageHeader>
        <PageTitle asChild>
          <h1>{t('nav.godisnji')}</h1>
        </PageTitle>
      </PageHeader>
      <Card className="min-w-0 p-4">
        <MyLeaveBody leave={leave} onRetry={retry} />
      </Card>
    </main>
  );
}

export const godisnjiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/godisnji',
  component: GodisnjiScreen,
});
