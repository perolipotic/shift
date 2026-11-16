import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import { HistoryChanges } from '@/features/history/components/history-changes';
import type { HistoryRow } from '@/features/history/services/history-rows';
import { t } from '@/lib/i18n';

/**
 * *Povijest promjena* below 640 px (story 14.2): the table's own rows,
 * stacked — the kind as the title with the time under it, then *Autor*,
 * *Predmet* and *Bilo → sada*, every value announced with its column's
 * label. Nothing scrolls sideways.
 */
export function HistoryStackedRows({
  rows,
  empty,
}: {
  readonly rows: readonly HistoryRow[];
  readonly empty: ReactNode;
}): ReactNode {
  if (rows.length === 0) {
    return <div className="px-4">{empty}</div>;
  }

  return (
    <StackedList aria-label={t('history.caption')} className="border-y">
      {rows.map((row) => (
        <StackedRow key={row.id} className={row.marker ? 'bg-muted' : undefined}>
          <StackedFields className="min-w-0">
            <StackedField label={t('history.column.kind')} labelHidden>
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {row.kind}
                {row.marker ? <Badge>{t('history.markerBadge')}</Badge> : null}
                {row.reconstructed ? <Badge variant="outline">{t('history.reconstructed')}</Badge> : null}
              </span>
            </StackedField>
            <StackedField label={t('history.column.time')} labelHidden className="text-sm text-muted-foreground">
              {row.time}
            </StackedField>
          </StackedFields>
          <StackedFields className="grid gap-2">
            <StackedField label={t('history.column.author')}>{row.author}</StackedField>
            <StackedField label={t('history.column.subject')}>{row.subject}</StackedField>
            <StackedField label={t('history.column.changes')}>
              <HistoryChanges changes={row.changes} />
            </StackedField>
          </StackedFields>
        </StackedRow>
      ))}
    </StackedList>
  );
}
