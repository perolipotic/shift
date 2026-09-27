import { Link, createRoute, redirect } from '@tanstack/react-router';
import { Plus, UsersRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { TeamAddDialog } from '@/features/teams/components/team-add-dialog';
import { TeamListSection } from '@/features/teams/components/team-list-section';
import { useTeamList } from '@/features/teams/hooks/use-team-list';
import { teamsMessageKey } from '@/features/teams/services/list';
import { t } from '@/lib/i18n';
import { mayReadMembers } from '@/features/members/services/list';
import { DESTINATIONS } from '@/features/navigation/utils/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/features/navigation/services/role';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/ljudi/smjene` — the organization's teams (story 1.7a).
 *
 * ADMIN ONLY, under the same guard `/ljudi` carries, and NOT a destination: it
 * is reached from the member list, which lights the `Ljudi` tab.
 *
 * ONE READ (AD-13). The rows, both counts and both groups come from the single
 * read under `TEAMS_LIST_KEY`, split by `splitTeams`. The create needs the
 * caller's organization, which is read from the session's own claim at submit
 * time — not a second query — and the database pins it again.
 *
 * ANY COUNT (DI-8). Nothing here knows how many teams there are; zero renders
 * `0 smjena` in words, and the add dialog is offered all the same.
 *
 * THIS FILE COMPOSES (source structure B6). The state, the one read and the
 * add are `useTeamList`; the add dialog and the two groups are components in
 * `@/features/teams/components`; every rule is in
 * `@/features/teams/services/list` and `@/features/teams/services/write`,
 * which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function LjudiSmjeneScreen() {
  const screen = useTeamList();
  const { loading, openAdding, created, refusal } = screen;

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('smjene.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('smjene.lede')}</PageDescription>
        </div>
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/ljudi">
              <UsersRound aria-hidden />
              {t('nav.ljudi')}
            </Link>
          </Button>
          <Button className="h-11" type="button" onClick={openAdding}>
            <Plus aria-hidden />
            {t('smjene.open')}
          </Button>
        </PageActions>
      </PageHeader>
      {created ? <Notice role="status">{t('smjene.created')}</Notice> : null}
      {refusal === null ? null : (
        <Notice role="alert">
          {t(teamsMessageKey(refusal))}
        </Notice>
      )}
      <TeamAddDialog screen={screen} />
      <TeamListSection screen={screen} />
    </main>
  );
}

export const ljudiSmjeneRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/smjene',
  /** The guard `/ljudi` carries, copied verbatim; `router.test.ts` drives it. */
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
  component: LjudiSmjeneScreen,
});
