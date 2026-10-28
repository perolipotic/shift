import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  CONFLICTS_COUNT_HEADING_ID,
  ITEM_COLLISION,
  type ConflictRow,
  type ConflictsQueueView,
  type RequestRow,
} from '@/features/conflicts/services/conflicts-queue';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** The date line every row opens with: the date, the past badge, and the item's kind in words (story 9.5). */
function DateLine({ dateShown, past, kind }: { readonly dateShown: string; readonly past: boolean; readonly kind: string }): ReactNode {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className={cn('tabular-nums', past ? 'font-normal' : 'font-semibold')}>{dateShown}</span>
      {past ? <Badge variant="outline">{t('zaOdluku.past')}</Badge> : null}
      <span className="text-sm text-muted-foreground">{kind}</span>
    </span>
  );
}

/**
 * One conflict (*Odsutnost u smjeni*): the date, the member and their team, the shift type with its
 * times, and the causing record's range. A PAST row is told apart by more
 * than colour: a dashed border, muted text and the words `Prošli datum`.
 * Neutral styling throughout — `destructive` belongs to the calendar's
 * conflict cells (story 5.3c). The whole row is the link to the conflict's
 * own resolution screen (story 5.4b): no checkbox, and no bulk action.
 */
function ConflictItem({ row }: { readonly row: ConflictRow }): ReactNode {
  return (
    <li className="min-w-0">
      <Link
        to="/za-odluku/$memberId/$date/$teamId"
        params={{ memberId: row.memberId, date: row.date, teamId: row.teamId }}
        className={cn(
          'flex min-h-11 min-w-0 items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          row.past && 'border-dashed bg-transparent text-muted-foreground',
        )}
      >
        <span className="grid min-w-0 flex-1 gap-1">
          <DateLine dateShown={row.dateShown} past={row.past} kind={t('zaOdluku.kind.collision')} />
          <span className={cn('min-w-0 break-words', !row.past && 'font-medium')}>
            {t('zaOdluku.who', { member: row.memberName, team: row.teamName })}
          </span>
          <span className="min-w-0 break-words text-sm text-muted-foreground">
            {row.times === null
              ? t('zaOdluku.detail', { type: row.shiftTypeName, from: row.leaveFrom, to: row.leaveTo })
              : t('zaOdluku.detailTimed', { type: row.shiftTypeName, times: row.times, from: row.leaveFrom, to: row.leaveTo })}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </Link>
    </li>
  );
}

/**
 * One pending leave request (*Zahtjev za godišnji odmor*, story 9.5): the
 * range's first date, the member — or that they are gone — and the range.
 * The whole row is the link to the request's own decision screen (story 9.4).
 * No cost or balance here: those are the decision screen's.
 */
function RequestItem({ row }: { readonly row: RequestRow }): ReactNode {
  return (
    <li className="min-w-0">
      <Link
        to="/za-odluku/zahtjev/$requestId"
        params={{ requestId: row.requestId }}
        className={cn(
          'flex min-h-11 min-w-0 items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          row.past && 'border-dashed bg-transparent text-muted-foreground',
        )}
      >
        <span className="grid min-w-0 flex-1 gap-1">
          <DateLine dateShown={row.dateShown} past={row.past} kind={t('zaOdluku.kind.request')} />
          <span className={cn('min-w-0 break-words', !row.past && 'font-medium')}>
            {row.memberName ?? t('zaOdluku.request.memberGone')}
          </span>
          <span className="min-w-0 break-words text-sm text-muted-foreground">
            {t('zaOdluku.request.range', { from: row.from, to: row.to })}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </Link>
    </li>
  );
}

/**
 * The queue: its count, always — `0 čeka odluku` included — and
 * then the rows in the order the view model gave them — collisions and
 * pending requests under one count (story 9.5) — or the true sentence an
 * empty queue states.
 */
export function ConflictsList({ view }: { readonly view: ConflictsQueueView }): ReactNode {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={CONFLICTS_COUNT_HEADING_ID}>
      <h2 id={CONFLICTS_COUNT_HEADING_ID} className="text-base font-semibold">
        {t('zaOdluku.count', { count: view.count })}
      </h2>
      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('zaOdluku.empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {view.rows.map((row) =>
            row.kind === ITEM_COLLISION ? <ConflictItem key={row.key} row={row} /> : <RequestItem key={row.key} row={row} />,
          )}
        </ul>
      )}
    </section>
  );
}
