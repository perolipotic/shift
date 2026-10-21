import { Link, createRoute } from '@tanstack/react-router';
import { Plus, UsersRound } from 'lucide-react';

import { OfflineNote } from '@/components/offline-note';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { TeamAddDialog } from '@/features/teams/components/team-add-dialog';
import { TeamListSection } from '@/features/teams/components/team-list-section';
import { useTeamList } from '@/features/teams/hooks/use-team-list';
import { teamsMessageKey, teamsRetryMessageKey } from '@/features/teams/services/list';
import { t } from '@/lib/i18n';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
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
 *
 * STORY 8.2d: offline, the list is drawn from the device's snapshot under the
 * as-of note, or the unavailable message is — with no read retry until the
 * connection is back.
 */

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
      {/* STORY 8.2d: the as-of note while the cached list is drawn offline;
          the editor's dialog over it adds none. */}
      <OfflineNote offline={screen.offline} />
      {created ? <Notice role="status">{t('smjene.created')}</Notice> : null}
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">
            {t(teamsMessageKey(refusal))}
          </Notice>
          {/* STORY 8.2d: no read retry offline; it comes back with the connection. */}
          {screen.retryable ? (
            <Button
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={screen.retry}
            >
              {t(teamsRetryMessageKey(refusal))}
            </Button>
          ) : null}
        </div>
      )}
      <TeamAddDialog screen={screen} />
      <TeamListSection screen={screen} />
    </main>
  );
}

export const ljudiSmjeneRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/smjene',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: LjudiSmjeneScreen,
});
