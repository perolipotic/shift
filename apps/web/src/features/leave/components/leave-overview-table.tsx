import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { SortableHead } from '@/components/sortable-head';
import { Table, TableBody, TableCaption, TableCell, TableHeader, TableRow } from '@/components/ui/table';
import {
  OVERVIEW_READY,
  OVERVIEW_SORT_ALLOWANCE,
  OVERVIEW_SORT_BALANCE,
  OVERVIEW_SORT_NAME,
  OVERVIEW_SORT_TEAM,
  OVERVIEW_SORT_USED,
  leaveOverviewAriaSortOf,
  leaveOverviewSortArrowOf,
  type LeaveOverview,
  type LeaveOverviewSortKey,
} from '@/features/leave/services/leave-overview';
import { t } from '@/lib/i18n';

/** The overview once ready: what the table and the rows draw. */
export type ReadyLeaveOverview = Extract<LeaveOverview, { kind: typeof OVERVIEW_READY }>;

/** One sortable heading of the overview: the shared `SortableHead`, its sort state the overview's. */
function SortHead({
  overview,
  sortKey,
  label,
  numeric,
  onPress,
}: {
  readonly overview: ReadyLeaveOverview;
  readonly sortKey: LeaveOverviewSortKey;
  readonly label: string;
  readonly numeric: boolean;
  readonly onPress: (key: LeaveOverviewSortKey) => void;
}): ReactNode {
  return (
    <SortableHead
      sortKey={sortKey}
      label={label}
      ariaSort={leaveOverviewAriaSortOf(overview.sort, sortKey)}
      direction={leaveOverviewSortArrowOf(overview.sort, sortKey)}
      numeric={numeric}
      onPress={onPress}
    />
  );
}

/**
 * The admin's leave overview from 640 px (story 7.15): *Osoba* (the link to
 * the member page, where leave is recorded), *Smjena*, *Pravo*,
 * *Iskorišteno* and *Preostalo*, every heading sortable, every figure in
 * tabular numerals. A member with no schedule shows their *Pravo* and the
 * unscheduled line across the other two. It scrolls inside its own
 * container, never the page; below 640 px `LeaveOverviewRows` draws the same
 * view model as stacked rows. Every figure is `leaveOverviewOf`'s.
 */
export function LeaveOverviewTable({
  overview,
  empty,
  onPress,
}: {
  readonly overview: ReadyLeaveOverview;
  /** What stands in place of the rows when there are none. */
  readonly empty: ReactNode;
  readonly onPress: (key: LeaveOverviewSortKey) => void;
}): ReactNode {
  return (
    <Table>
      <TableCaption className="sr-only">{t('godisnji.overview.caption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <SortHead overview={overview} sortKey={OVERVIEW_SORT_NAME} label={t('godisnji.overview.person')} numeric={false} onPress={onPress} />
          <SortHead overview={overview} sortKey={OVERVIEW_SORT_TEAM} label={t('godisnji.overview.team')} numeric={false} onPress={onPress} />
          <SortHead overview={overview} sortKey={OVERVIEW_SORT_ALLOWANCE} label={t('godisnji.overview.allowance')} numeric onPress={onPress} />
          <SortHead overview={overview} sortKey={OVERVIEW_SORT_USED} label={t('godisnji.overview.used')} numeric onPress={onPress} />
          <SortHead overview={overview} sortKey={OVERVIEW_SORT_BALANCE} label={t('godisnji.overview.balance')} numeric onPress={onPress} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {overview.rows.map((row) => (
          <TableRow key={row.memberId}>
            <TableCell className="whitespace-nowrap">
              <Link
                to="/ljudi/$id"
                params={{ id: row.memberId }}
                className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
              >
                {row.name}
              </Link>
            </TableCell>
            <TableCell className="whitespace-nowrap">{row.team?.name ?? t('godisnji.overview.noTeam')}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{row.allowanceDays}</TableCell>
            {row.figures === null ? (
              <TableCell colSpan={2} className="text-sm text-muted-foreground">
                {t('ljudi.leaveRecord.unscheduled')}
              </TableCell>
            ) : (
              <>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{row.figures.usedDays}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                  {row.figures.balanceDays}
                </TableCell>
              </>
            )}
          </TableRow>
        ))}
        {overview.empty === null ? null : (
          <TableRow>
            <TableCell colSpan={5}>{empty}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
