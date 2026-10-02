import { Link, createRoute, redirect, useLocation } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { MemberLeaveCard } from '@/features/leave/components/member-leave-card';
import { leaveHandoffOf, leaveHandoffOriginOf } from '@/features/leave/services/leave-section';
import { MemberBasicsCard } from '@/features/members/components/member-basics-card';
import { MemberResetCard } from '@/features/members/components/member-reset-card';
import { MemberStatusCard } from '@/features/members/components/member-status-card';
import { MemberTeamCard } from '@/features/members/components/member-team-card';
import { useMemberEdit } from '@/features/members/hooks/use-member-edit';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/ljudi/$id` — an admin edits one member (story 1.5b). This file composes
 * the screen; its state, reads and handlers are `useMemberEdit`, its cards are
 * components in `@/features/members/components`, and every rule is
 * `@/features/members/services/write`'s.
 *
 * THIS IS NOT A DESTINATION, so `type="reset"` is not an exit — it restores the
 * fields. The way back to the list is a link that says so.
 */

/** Where a session that is not an administrator's is sent. The FIRST
 *  destination, read off the table — the same answer `/` and `/ljudi` give. */
const FIRST_DESTINATION = DESTINATIONS[0];

export function LjudiMemberScreen() {
  const { id } = ljudiMemberRoute.useParams();
  const edit = useMemberEdit(id);
  // STORY 5.4d: reached from a conflict's third card, in router state only.
  const state = useLocation().state;
  const handoff = leaveHandoffOf(state);
  /** Kept on the entry after the hand-off has opened, for the way back. */
  const fromConflict = leaveHandoffOriginOf(state) !== null;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <div className="grid min-w-0 justify-items-start gap-1">
          {/* THE WAY BACK, always rendered — including while the read is
              pending and after it has settled failed. A screen reachable only
              by URL that can be left only by the browser's Back button is a
              dead end. Above the title, where a way back is looked for
              (design refresh C). */}
          {/* Each link carries the same `-ml-3`, so on a phone, where the two
              wrap, both line up with the title. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-5">
            <Button asChild variant="ghost" className="-ml-3 h-11 px-3">
              <Link to="/ljudi">
                <ArrowLeft aria-hidden />
                {t('ljudi.form.back')}
              </Link>
            </Button>
            {/* THE WAY BACK TO THE CONFLICTS (story 5.4d), while the page was
                reached from one: the queue re-reads, so a saved amend's
                conflict is gone from it and a cancelled one still stands. */}
            {fromConflict ? (
              <Button asChild variant="ghost" className="-ml-3 h-11 px-3">
                <Link to="/raspored">
                  <ArrowLeft aria-hidden />
                  {t('ljudi.form.backToConflicts')}
                </Link>
              </Button>
            ) : null}
          </div>
          <PageTitle asChild>
            <h1>
              {t('ljudi.form.editHeading')}
            </h1>
          </PageTitle>
        </div>
      </PageHeader>
      <MemberBasicsCard edit={edit} />
      {/* EACH OTHER DECISION IN ITS OWN CARD (design refresh C), and every one
          outside the `<form>`: inside it a `<Button>` submits, and
          `key={memberFormKey(member)}` remounts that subtree on every refetch —
          which would wipe a credential nobody had finished reading. A card is
          drawn only around a block that renders, so none stands empty — the
          status block renders nothing on one's own row, for instance. */}
      {/* STORY 1.7b. */}
      <MemberTeamCard edit={edit} />
      {/* STORY 1.6. */}
      <MemberStatusCard edit={edit} />
      {/* STORY 5.1c: the member's leave — figures, the od–do form and what
          a range costs before it is saved. Keyed by the member, so nothing it
          raised about one member stands over another's. */}
      <MemberLeaveCard key={id} memberId={id} handoff={handoff} />
      <MemberResetCard edit={edit} />
    </main>
  );
}

export const ljudiMemberRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/$id',
  /**
   * The same role guard `/ljudi` carries, copied VERBATIM — and
   * `router.test.ts` drives all three copies by execution rather than by
   * reading any of them. See `pages/ljudi.novi.tsx` for the whole argument;
   * the short version is that the reader arrives through the router context, so
   * every branch runs in the node suite with no environment at all, and a level
   * that cannot be read fails closed.
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
  component: LjudiMemberScreen,
});
