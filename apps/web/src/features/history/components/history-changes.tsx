import type { ReactNode } from 'react';

import type { HistoryRowChange } from '@/features/history/services/history-rows';
import { t } from '@/lib/i18n';

/** One field's line: `Naziv: A → B`, or one side alone where the other has no value. */
function lineOf({ field, before, after }: HistoryRowChange): string {
  if (before === null) return t('history.added', { field, after });
  if (after === null) return t('history.removedValue', { field, before });

  return t('history.change', { field, before, after });
}

/**
 * One row's *bilo → sada* (story 14.2), the same in the table and the stacked
 * rows: a line per field — `Naziv: A → B`, an addition's `sada` alone and a
 * deletion's `bilo` alone — or one muted line when no visible field changed.
 */
export function HistoryChanges({ changes }: { readonly changes: readonly HistoryRowChange[] }): ReactNode {
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('history.noChanges')}</p>;
  }

  return (
    <ul className="grid min-w-0 gap-0.5 text-sm">
      {changes.map((change) => (
        // KEYED BY THE DOMAIN'S COLUMN, never by the translated label.
        <li key={change.column} className="wrap-anywhere">
          {lineOf(change)}
        </li>
      ))}
    </ul>
  );
}
