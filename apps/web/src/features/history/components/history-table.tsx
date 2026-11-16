import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { HistoryChanges } from '@/features/history/components/history-changes';
import type { HistoryRow } from '@/features/history/services/history-rows';
import { t } from '@/lib/i18n';

/**
 * *Povijest promjena* from 640 px (story 14.2): *Vrijeme*, *Autor*, *Vrsta*,
 * *Predmet* and *Bilo → sada*, newest first, exactly the rows the hook
 * filtered, in their order. A reconstructed row carries its badge beside the
 * kind, and the start of history its own badge on a muted row. Below 640 px `HistoryStackedRows` draws the same rows.
 */
export function HistoryTable({
  rows,
  empty,
}: {
  readonly rows: readonly HistoryRow[];
  /** What stands in place of the rows when there are none. */
  readonly empty: ReactNode;
}): ReactNode {
  return (
    <Table>
      <TableCaption className="sr-only">{t('history.caption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('history.column.time')}</TableHead>
          <TableHead>{t('history.column.author')}</TableHead>
          <TableHead>{t('history.column.kind')}</TableHead>
          <TableHead>{t('history.column.subject')}</TableHead>
          <TableHead>{t('history.column.changes')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className={row.marker ? 'bg-muted' : undefined}>
            <TableCell className="whitespace-nowrap align-top tabular-nums">{row.time}</TableCell>
            <TableCell className="align-top">{row.author}</TableCell>
            <TableCell className="align-top">
              <span className="grid justify-items-start gap-1">
                <span>{row.kind}</span>
                {row.marker ? <Badge>{t('history.markerBadge')}</Badge> : null}
                {row.reconstructed ? <Badge variant="outline">{t('history.reconstructed')}</Badge> : null}
              </span>
            </TableCell>
            <TableCell className="align-top">{row.subject}</TableCell>
            <TableCell className="min-w-48 align-top">
              <HistoryChanges changes={row.changes} />
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5}>{empty}</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
