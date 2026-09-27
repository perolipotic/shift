import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamTable } from '@/features/teams/components/team-table';
import type { TeamListScreen } from '@/features/teams/hooks/use-team-list';
import { t } from '@/lib/i18n';

const SKELETON_ROWS = [0, 1, 2];

/**
 * The list's body below the page's notices and the add dialog: the skeleton
 * while the one read is pending, then the active and the archived groups, both
 * split from that one answer and neither shown until it has arrived.
 */
export function TeamListSection({ screen }: { readonly screen: TeamListScreen }): ReactNode {
  const { loading, split } = screen;

  return (
    <>
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {split === null ? null : (
        <Card className="min-w-0">
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <CardTitle asChild>
              <h2>{t('smjene.activeHeading')}</h2>
            </CardTitle>
            {/* STATED, AND STATED AT ZERO (UX-DR20). NOT a live region: only
                confirmations announce, and a count announced on every refetch
                is noise that buries them. */}
            <Badge variant="secondary">{t('smjene.count', { count: split.active.length })}</Badge>
          </CardHeader>
          <TeamTable group={split.active} />
        </Card>
      )}
      {split === null ? null : (
        <Card className="min-w-0">
          <CardHeader>
            {/* The count IS the heading: `Arhivirano: 2 smjene`. A separate
                `Arhivirano` above it would say the same word twice. */}
            <CardTitle asChild>
              <h2>{t('smjene.archivedCount', { count: split.archived.length })}</h2>
            </CardTitle>
          </CardHeader>
          <TeamTable group={split.archived} />
        </Card>
      )}
    </>
  );
}
