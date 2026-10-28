import type { ReactNode } from 'react';

import {
  LEAVE_CONFLICTS_UNKNOWN,
  type LeaveConflictLine,
  type LeaveConflicts,
} from '@/features/leave/services/leave-conflicts';
import { t } from '@/lib/i18n';
import { formatList } from '@/lib/i18n/format';

/** A conflict as the dialog names it: `pon 21.12. Dan`. */
function conflictText(line: LeaveConflictLine): string {
  return t('ljudi.leaveRecord.conflictLine', { weekday: line.weekday, date: line.date, type: line.type });
}

/** A group of conflicts as one run of text: `uto 06.10. Dan i sri 07.10. Noć`. */
function conflictListText(lines: readonly LeaveConflictLine[]): string {
  return formatList(lines.map(conflictText));
}

/** A group's count and its conflicts: `Uklanjaju se 2 stavke koje čekaju odluku (uto 06.10. Dan i sri 07.10. Noć).` */
function conflictGroupText(summary: string, lines: readonly LeaveConflictLine[]): string {
  return t('ljudi.leaveRecord.conflictsGroup', { summary, lines: conflictListText(lines) });
}

/**
 * THE CONFLICT LINES (story 7.12): what the change would create, clear and
 * keep, as `leaveConflictsOf` derived them, or that they cannot be checked
 * now. NEUTRAL TEXT — no `destructive`, no ⚠ — and never a gate: they sit in
 * the preview's polite live region beside the replacement lines (5.4e).
 *
 * SHARED SINCE STORY 9.4, unchanged: the admin leave dialog draws them, and so
 * does a leave request's decision screen, for the collisions its approval
 * would create — one wording for both.
 */
export function LeaveConflictLines({
  conflicts,
  amend,
}: {
  readonly conflicts: LeaveConflicts | null;
  readonly amend: boolean;
}): ReactNode {
  if (conflicts === null) return null;

  if (conflicts.kind === LEAVE_CONFLICTS_UNKNOWN) {
    return <p className="text-sm">{t('ljudi.leaveRecord.conflictsUnknown')}</p>;
  }

  const { created, cleared, kept } = conflicts;

  if (created.length === 0 && cleared.length === 0 && kept.length === 0) {
    return <p className="text-sm">{t('ljudi.leaveRecord.conflictsNone')}</p>;
  }

  const where =
    created.length === 0 ? null : <p className="text-sm">{t('ljudi.leaveRecord.conflictsWhere', { count: created.length })}</p>;

  if (!amend) {
    return (
      <div className="grid min-w-0 gap-1">
        <p className="text-sm">{t('ljudi.leaveRecord.conflictsCreated', { count: created.length })}</p>
        <ul className="grid min-w-0 gap-0.5 ps-4 text-sm tabular-nums [list-style:disc]">
          {created.map((line) => (
            <li key={line.key} className="min-w-0 break-words">
              {conflictText(line)}
            </li>
          ))}
        </ul>
        {where}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1">
      {cleared.length === 0 ? null : (
        <p className="break-words text-sm">
          {conflictGroupText(t('ljudi.leaveRecord.conflictsCleared', { count: cleared.length }), cleared)}
        </p>
      )}
      {kept.length === 0 ? null : (
        <p className="break-words text-sm">
          {conflictGroupText(t('ljudi.leaveRecord.conflictsKept', { count: kept.length }), kept)}
        </p>
      )}
      {created.length === 0 ? null : (
        <p className="break-words text-sm">
          {conflictGroupText(t('ljudi.leaveRecord.conflictsNew', { count: created.length }), created)}
        </p>
      )}
      {where}
    </div>
  );
}
