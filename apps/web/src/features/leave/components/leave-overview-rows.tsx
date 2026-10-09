import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { SortControl } from '@/components/sort-control';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import type { ReadyLeaveOverview } from '@/features/leave/components/leave-overview-table';
import {
  OVERVIEW_SORT_ALLOWANCE,
  OVERVIEW_SORT_BALANCE,
  OVERVIEW_SORT_NAME,
  OVERVIEW_SORT_TEAM,
  OVERVIEW_SORT_USED,
  type LeaveOverviewSortKey,
} from '@/features/leave/services/leave-overview';
import { t } from '@/lib/i18n';
import type { SortControlColumn } from '@/utils/sort-control';

/**
 * The admin's leave overview on a phone (story 7.15): the table's own view
 * model as stacked rows (story 7.6), so no figure can differ between the two
 * forms. A row is the name (the link to the member page) with the team under
 * it and *Preostalo* at the top right, then *Pravo* and *Iskorišteno* — or,
 * for a member with no schedule, *Pravo* and the unscheduled line.
 *
 * EVERY VALUE IS A `StackedField`, announced with its column's own label. The
 * sort is the shared `SortControl`, one `Poredano` control, whose pick is the
 * heading press; an empty result stands in place of the list and the control.
 */
export function LeaveOverviewRows({
  overview,
  empty,
  onPress,
}: {
  readonly overview: ReadyLeaveOverview;
  readonly empty: ReactNode;
  readonly onPress: (key: LeaveOverviewSortKey) => void;
}): ReactNode {
  const columns: readonly SortControlColumn<LeaveOverviewSortKey>[] = [
    { key: OVERVIEW_SORT_NAME, label: t('godisnji.overview.person') },
    { key: OVERVIEW_SORT_TEAM, label: t('godisnji.overview.team') },
    { key: OVERVIEW_SORT_ALLOWANCE, label: t('godisnji.overview.allowance') },
    { key: OVERVIEW_SORT_USED, label: t('godisnji.overview.used') },
    { key: OVERVIEW_SORT_BALANCE, label: t('godisnji.overview.balance') },
  ];

  if (overview.empty !== null) {
    return <div className="px-4">{empty}</div>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SortControl columns={columns} active={overview.sort.key} direction={overview.sort.direction} onPick={onPress} />
      <StackedList aria-label={t('godisnji.overview.caption')} className="border-y">
        {overview.rows.map((row) => (
          <StackedRow key={row.memberId}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <StackedFields className="min-w-0 text-sm text-muted-foreground">
                <StackedField label={t('godisnji.overview.person')} labelHidden>
                  <Link
                    to="/ljudi/$id"
                    params={{ id: row.memberId }}
                    className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                </StackedField>
                <StackedField label={t('godisnji.overview.team')} labelHidden>
                  {row.team?.name ?? t('godisnji.overview.noTeam')}
                </StackedField>
              </StackedFields>
              {row.figures === null ? null : (
                <StackedFields className="shrink-0 text-right">
                  <StackedField label={t('godisnji.overview.balance')}>
                    <span className="text-xl font-bold">{row.figures.balanceDays}</span>
                  </StackedField>
                </StackedFields>
              )}
            </div>
            <StackedFields className="grid grid-cols-2 gap-2">
              <StackedField label={t('godisnji.overview.allowance')} className="rounded-md bg-muted px-2 py-1.5">
                <span className="font-semibold">{row.allowanceDays}</span>
              </StackedField>
              {row.figures === null ? null : (
                <StackedField label={t('godisnji.overview.used')} className="rounded-md bg-muted px-2 py-1.5">
                  <span className="font-semibold">{row.figures.usedDays}</span>
                </StackedField>
              )}
            </StackedFields>
            {row.figures === null ? (
              <p className="text-sm text-muted-foreground">{t('ljudi.leaveRecord.unscheduled')}</p>
            ) : null}
          </StackedRow>
        ))}
      </StackedList>
    </div>
  );
}
