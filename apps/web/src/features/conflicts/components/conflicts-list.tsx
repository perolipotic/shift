import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  CONFLICTS_COUNT_HEADING_ID,
  type ConflictRow,
  type ConflictsQueueView,
} from '@/features/conflicts/services/conflicts-queue';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * One conflict: the date, the member and their team, the shift type with its
 * times, and the causing record's range. A PAST row is told apart by more
 * than colour: a dashed border, muted text and the words `Prošli datum`.
 * Neutral styling throughout — `destructive` belongs to the calendar's
 * conflict cells (story 5.3c) — and no action: resolving is story 5.4's.
 */
function ConflictItem({ row }: { readonly row: ConflictRow }): ReactNode {
  return (
    <li
      className={cn(
        'grid min-w-0 gap-1 rounded-md border bg-card p-3',
        row.past && 'border-dashed bg-transparent text-muted-foreground',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={cn('tabular-nums', row.past ? 'font-normal' : 'font-semibold')}>{row.dateShown}</span>
        {row.past ? <Badge variant="outline">{t('raspored.past')}</Badge> : null}
      </div>
      <p className={cn('min-w-0 break-words', !row.past && 'font-medium')}>
        {t('raspored.who', { member: row.memberName, team: row.teamName })}
      </p>
      <p className="min-w-0 break-words text-sm text-muted-foreground">
        {row.times === null
          ? t('raspored.detail', { type: row.shiftTypeName, from: row.leaveFrom, to: row.leaveTo })
          : t('raspored.detailTimed', { type: row.shiftTypeName, times: row.times, from: row.leaveFrom, to: row.leaveTo })}
      </p>
    </li>
  );
}

/**
 * The queue: its count, always — `0 neriješenih konflikata` included — and
 * then the rows in the order the view model gave them, or the true sentence
 * a queue with no conflicts states.
 */
export function ConflictsList({ view }: { readonly view: ConflictsQueueView }): ReactNode {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={CONFLICTS_COUNT_HEADING_ID}>
      <h2 id={CONFLICTS_COUNT_HEADING_ID} className="text-base font-semibold">
        {t('raspored.count', { count: view.count })}
      </h2>
      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('raspored.empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {view.rows.map((row) => (
            <ConflictItem key={row.key} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
