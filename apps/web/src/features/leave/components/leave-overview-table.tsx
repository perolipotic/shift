import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  type LeaveOverviewSortArrow,
  type LeaveOverviewSortKey,
} from '@/features/leave/services/leave-overview';
import { t } from '@/lib/i18n';

/** The overview once ready: what the table and the rows draw. */
export type ReadyLeaveOverview = Extract<LeaveOverview, { kind: typeof OVERVIEW_READY }>;

/**
 * The glyph each sort direction draws. A RECORD keyed by the rule module's
 * own names, never a ternary: which way the arrow points is
 * `leaveOverviewSortArrowOf`'s decision, pinned by execution beside
 * `leaveOverviewAriaSortOf`.
 */
const SORT_GLYPHS: Record<LeaveOverviewSortArrow, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
};

/** One sortable heading: a ghost button, `aria-sort` on the cell, the arrow hidden from readers. */
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
  const arrow = leaveOverviewSortArrowOf(overview.sort, sortKey);
  const Glyph = arrow === null ? null : SORT_GLYPHS[arrow];

  return (
    <TableHead aria-sort={leaveOverviewAriaSortOf(overview.sort, sortKey)} className="px-2">
      <Button
        variant="ghost"
        // Figures align right, and so do their headings.
        data-numeric={numeric}
        className="h-auto min-h-11 w-full justify-start gap-2 whitespace-nowrap px-2 py-1 text-left data-[numeric=true]:justify-end data-[numeric=true]:text-right"
        onClick={() => {
          onPress(sortKey);
        }}
      >
        <span>{label}</span>
        {Glyph === null ? null : <Glyph aria-hidden className="size-4 shrink-0" />}
      </Button>
    </TableHead>
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
