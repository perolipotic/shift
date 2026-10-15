import type { ReactNode } from 'react';

import { EmptyMark } from '@/components/ui/empty-mark';
import { leaveShownOf, type LeaveDaysFigure } from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';

/**
 * A leave as *Sati* renders it, on the summary, in the table and in its
 * stacked rows alike: its days, `3 dana`, or the empty mark — `—` to the eye
 * and `nema` to a screen reader (deferred-work C587).
 */
export function LeaveFigure({ leave }: { readonly leave: LeaveDaysFigure | null }): ReactNode {
  const shown = leaveShownOf(leave);

  return leave === null ? (
    <EmptyMark glyph={t(shown.key, shown.values)} word={t('sati.noFigureWord')} />
  ) : (
    t(shown.key, shown.values)
  );
}

/**
 * A row's team on the admin's table and its stacked rows: the name as stored,
 * or the empty mark — `—` to the eye and `bez smjene` to a screen reader.
 */
export function TeamName({ team }: { readonly team: { readonly name: string } | null }): ReactNode {
  return team === null ? (
    <EmptyMark glyph={t('sati.organization.noTeam')} word={t('sati.organization.noTeamWord')} />
  ) : (
    team.name
  );
}
