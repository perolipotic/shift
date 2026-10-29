import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { ITEM_COLLISION } from '@/features/conflicts/services/conflicts-queue';
import { ACCEPT_UNCOVERED, REPLACE_MEMBER } from '@/features/conflicts/services/resolutions';
import {
  RESOLVED_COUNT_HEADING_ID,
  type ResolvedConflictRow,
  type ResolvedConflictsView,
  type ResolvedRequestRow,
} from '@/features/conflicts/services/resolved-conflicts';
import {
  REQUEST_APPROVED,
  REQUEST_CLOSED_ON_DEACTIVATION,
  REQUEST_REJECTED,
  type DecidedLeaveRequestStatus,
} from '@/features/leave/services/leave-request-list';
import { t } from '@/lib/i18n';

/** The decision in words: the kind's, naming the replacement where there is one. */
function decisionOf(row: ResolvedConflictRow): string {
  if (row.kind === REPLACE_MEMBER) {
    return row.replacementName === null
      ? t('zaOdluku.resolved.replace_memberUnknown')
      : t('zaOdluku.resolved.replace_member', { replacement: row.replacementName });
  }

  return row.kind === ACCEPT_UNCOVERED ? t('zaOdluku.resolved.accept_uncovered') : t('zaOdluku.resolved.amend_leave');
}

/**
 * The line every *Odlučeno* entry opens with (story 9.5), alike for both
 * kinds: the date in tabular numerals, the decision's badge, and the kind in
 * words.
 */
function EntryHead({ dateShown, decision, kind }: { readonly dateShown: string; readonly decision: string; readonly kind: string }): ReactNode {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="font-semibold tabular-nums">{dateShown}</span>
      <Badge>{decision}</Badge>
      <span className="text-sm text-muted-foreground">{kind}</span>
    </span>
  );
}

/**
 * One resolved conflict (FR-48a): date, member and team, the shift type, the
 * decision, and who decided it and when. Read-only: no link, no action, and
 * no history beyond the one decision.
 */
function ResolvedItem({ row }: { readonly row: ResolvedConflictRow }): ReactNode {
  return (
    <li className="grid min-w-0 gap-1 rounded-md border bg-card p-3">
      <EntryHead dateShown={row.dateShown} decision={decisionOf(row)} kind={t('zaOdluku.kind.collision')} />
      <span className="min-w-0 break-words font-medium">{t('zaOdluku.who', { member: row.memberName, team: row.teamName })}</span>
      <span className="min-w-0 break-words text-sm text-muted-foreground">
        {row.shiftTypeName === null
          ? t('zaOdluku.resolved.shiftGone')
          : row.times === null
            ? row.shiftTypeName
            : `${row.shiftTypeName} ${row.times}`}
      </span>
      <span className="min-w-0 break-words text-sm text-muted-foreground">
        {t('zaOdluku.resolved.decided', {
          actor: row.actorName ?? t('zaOdluku.resolved.actorGone'),
          date: row.decidedOn,
          time: row.decidedAt,
        })}
      </span>
    </li>
  );
}

/** A decided request's outcome as its badge's word. Exhaustive. */
function requestOutcomeWord(outcome: DecidedLeaveRequestStatus): string {
  switch (outcome) {
    case REQUEST_APPROVED:
      return t('godisnji.request.status.approved');
    case REQUEST_REJECTED:
      return t('godisnji.request.status.rejected');
    case REQUEST_CLOSED_ON_DEACTIVATION:
      return t('godisnji.request.status.closedOnDeactivation');
    default: {
      const unhandled: never = outcome;

      return unhandled;
    }
  }
}

/**
 * One decided leave request (story 9.5): its first day, its outcome's badge
 * and its kind, as a resolved conflict opens, then the member —
 * or that they are gone — the range, and who decided it and when. Read-only,
 * as a resolved conflict is. A withdrawn request is never listed; one closed
 * on its member's deactivation (0041) is, as *Zatvoren deaktivacijom*.
 */
function ResolvedRequestItem({ row }: { readonly row: ResolvedRequestRow }): ReactNode {
  return (
    <li className="grid min-w-0 gap-1 rounded-md border bg-card p-3">
      <EntryHead
        dateShown={row.dateShown}
        decision={requestOutcomeWord(row.outcome)}
        kind={t('zaOdluku.kind.request')}
      />
      <span className="min-w-0 break-words font-medium">{row.memberName ?? t('zaOdluku.request.memberGone')}</span>
      <span className="min-w-0 break-words text-sm text-muted-foreground">
        {t('zaOdluku.request.range', { from: row.from, to: row.to })}
      </span>
      <span className="min-w-0 break-words text-sm text-muted-foreground">
        {t('zaOdluku.resolved.decided', {
          actor: row.actorName ?? t('zaOdluku.resolved.actorGone'),
          date: row.decidedOn,
          time: row.decidedAt,
        })}
      </span>
    </li>
  );
}

/**
 * The *Odlučeno* list: its count, always — zero included — then the entries,
 * resolved conflicts and decided requests together, newest decision first.
 */
export function ResolvedList({ view }: { readonly view: ResolvedConflictsView }): ReactNode {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={RESOLVED_COUNT_HEADING_ID}>
      <h2 id={RESOLVED_COUNT_HEADING_ID} className="text-base font-semibold">
        {t('zaOdluku.resolved.count', { count: view.rows.length })}
      </h2>
      {view.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('zaOdluku.resolved.empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {view.rows.map((row) =>
            row.item === ITEM_COLLISION ? (
              <ResolvedItem key={row.key} row={row} />
            ) : (
              <ResolvedRequestItem key={row.key} row={row} />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
