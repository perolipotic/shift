import { Link } from '@tanstack/react-router';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  needsYouBadgeMessageKey,
  needsYouShiftMessageKey,
  type NeedsYou,
  type NeedsYouRow,
} from '@/features/today/services/admin-today';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * One of the queue's rows: the date, the type and team, the member, and
 * `prošlo` or `danas` in words — the whole row the link to its conflict's
 * resolution screen, as on *Raspored*.
 */
function renderRow(row: NeedsYouRow): ReactNode {
  return (
    <li key={row.key} className="min-w-0">
      <Link
        to="/raspored/$memberId/$date/$teamId"
        params={{ memberId: row.memberId, date: row.date, teamId: row.teamId }}
        className="flex min-h-11 min-w-0 items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm tabular-nums">
              {t('danas.admin.needsYou.date', { weekday: row.weekday, date: row.dayMonth })}
            </span>
            {row.badge === null ? null : <Badge variant="outline">{t(needsYouBadgeMessageKey(row.badge))}</Badge>}
          </span>
          <span className="min-w-0 break-words font-medium tabular-nums">
            {t(needsYouShiftMessageKey(row), { type: row.shiftTypeName, times: row.times, team: row.teamName })}
          </span>
          <span className="min-w-0 break-words text-sm text-muted-foreground">{row.memberName}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * *Treba tebe* (story 6.3): the same shape at every count. The count always
 * shows, `0 neriješenih konflikata` included; above zero a `destructive`
 * left edge and ⚠, the past share with its earliest date, and the earliest
 * rows; at zero neutral, with a check and the sentence that states what is
 * true. It always ends with the way to *Raspored*, carrying the same count.
 */
export function NeedsYouCard({ needsYou }: { readonly needsYou: NeedsYou }): ReactNode {
  const headingId = useId();
  const waiting = needsYou.count !== 0;
  const Icon = waiting ? TriangleAlert : CircleCheck;

  return (
    <Card className={cn('min-w-0', waiting && 'border-l-4 border-l-destructive')}>
      <section aria-labelledby={headingId} className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <Icon aria-hidden className="mt-1 size-6 shrink-0" />
          <div className="grid min-w-0 gap-1">
            <h2 id={headingId} className="text-sm font-semibold text-muted-foreground">
              {t('danas.admin.needsYou.heading')}
            </h2>
            <p className="text-2xl font-bold tabular-nums">{t('raspored.count', { count: needsYou.count })}</p>
            {waiting ? null : <p className="text-sm text-muted-foreground">{t('danas.admin.needsYou.calm')}</p>}
            {needsYou.earliestPast === null ? null : (
              <p className="text-sm text-muted-foreground tabular-nums">
                {t('danas.admin.needsYou.pastLine', { count: needsYou.pastCount, date: needsYou.earliestPast })}
              </p>
            )}
          </div>
        </div>
        {needsYou.rows.length === 0 ? null : <ul className="grid min-w-0 gap-2">{needsYou.rows.map(renderRow)}</ul>}
        <Link
          to="/raspored"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md border-[1.5px] border-input bg-card px-4 text-sm font-semibold tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {t('danas.admin.needsYou.open', { count: needsYou.count })}
        </Link>
      </section>
    </Card>
  );
}
