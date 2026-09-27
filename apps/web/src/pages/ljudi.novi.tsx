import { Link, createRoute, redirect } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { MemberCreateAbout } from '@/features/members/components/member-create-about';
import { MemberCreateCard } from '@/features/members/components/member-create-card';
import { useMemberCreate } from '@/features/members/hooks/use-member-create';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/ljudi/novi` — an admin issues an account (story 1.5b). This file composes
 * the screen; its state, read and submit are `useMemberCreate`, its cards are
 * components in `@/features/members/components`, and every rule is
 * `@/features/members/services/write`'s.
 *
 * THIS IS NOT A DESTINATION, so `type="reset"` is not an exit: cancelling
 * restores the fields, and the way back to the list is a link that says so.
 */

/** Where a session that is not an administrator's is sent. The FIRST
 *  destination, read off the table — the same answer `/` and `/ljudi` give. */
const FIRST_DESTINATION = DESTINATIONS[0];

export function LjudiNoviScreen() {
  const create = useMemberCreate();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <div className="grid min-w-0 justify-items-start gap-1">
          {/* THE WAY BACK, and it is always here — including while the read is
              pending and after it has settled failed. A screen that can only be
              left by the browser's own Back button is a dead end on a phone,
              where the chrome's tab bar is the only other navigation. Above the
              title, where a way back is looked for (design refresh C). */}
          <Button asChild variant="ghost" className="-ml-3 h-11 px-3">
            <Link to="/ljudi">
              <ArrowLeft aria-hidden />
              {t('ljudi.form.back')}
            </Link>
          </Button>
          <PageTitle asChild>
            <h1>
              {t('ljudi.form.newHeading')}
            </h1>
          </PageTitle>
          <PageDescription>{t('ljudi.form.newLede')}</PageDescription>
        </div>
      </PageHeader>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <MemberCreateCard create={create} />
        <MemberCreateAbout />
      </div>
    </main>
  );
}

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
   */
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
  component: LjudiNoviScreen,
});
