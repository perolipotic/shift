import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { ACCEPT_UNCOVERED, REPLACE_MEMBER } from '@/features/conflicts/services/resolutions';
import {
  RESOLVED_COUNT_HEADING_ID,
  type ResolvedConflictRow,
  type ResolvedConflictsView,
} from '@/features/conflicts/services/resolved-conflicts';
import { t } from '@/lib/i18n';

/** The decision in words: the kind's, naming the replacement where there is one. */
function decisionOf(row: ResolvedConflictRow): string {
  if (row.kind === REPLACE_MEMBER) {
    return row.replacementName === null
      ? t('raspored.resolved.replace_memberUnknown')
      : t('raspored.resolved.replace_member', { replacement: row.replacementName });
  }

  return row.kind === ACCEPT_UNCOVERED ? t('raspored.resolved.accept_uncovered') : t('raspored.resolved.amend_leave');
}

/**
 * One resolved conflict (FR-48a): date, member and team, the shift type, the
 * decision, and who decided it and when. Read-only: no link, no action, and
 * no history beyond the one decision.
 */
function ResolvedItem({ row }: { readonly row: ResolvedConflictRow }): ReactNode {
  return (
    <li className="grid min-w-0 gap-1 rounded-md border bg-card p-3">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="font-semibold tabular-nums">{row.dateShown}</span>
        <Badge>{decisionOf(row)}</Badge>
      </span>
      <span className="min-w-0 break-words font-medium">{t('raspored.who', { member: row.memberName, team: row.teamName })}</span>
      <span className="min-w-0 break-words text-sm text-muted-foreground">
        {row.shiftTypeName === null
          ? t('raspored.resolved.shiftGone')
          : row.times === null
            ? row.shiftTypeName
            : `${row.shiftTypeName} ${row.times}`}
      </span>
      <span className="min-w-0 break-words text-sm text-muted-foreground">
        {t('raspored.resolved.decided', {
          actor: row.actorName ?? t('raspored.resolved.actorGone'),
          date: row.decidedOn,
          time: row.decidedAt,
        })}
      </span>
    </li>
  );
}

/** The *Riješeni* list: its count, always — zero included — then the entries, newest decision first. */
export function ResolvedList({ view }: { readonly view: ResolvedConflictsView }): ReactNode {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={RESOLVED_COUNT_HEADING_ID}>
      <h2 id={RESOLVED_COUNT_HEADING_ID} className="text-base font-semibold">
        {t('raspored.resolved.count', { count: view.rows.length })}
      </h2>
      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('raspored.resolved.empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {view.rows.map((row) => (
            <ResolvedItem key={row.key} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
