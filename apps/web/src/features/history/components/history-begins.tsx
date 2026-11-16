import type { ReactNode } from 'react';

import { Info } from '@/components/ui/icon';
import { historyBeginsMessageKey, type HistoryBeginsView } from '@/features/history/services/history-rows';
import { t } from '@/lib/i18n';

/**
 * Where history begins (story 14.2; AD-11 Backfill), stated when the period
 * reaches back to it. From 0061's marker: since when changes are recorded,
 * that earlier hard deletes and current-state edits were never recorded and
 * cannot be recovered, and what a reconstructed entry carries; it never
 * claims nothing precedes the marker. From the organization's own INSERT
 * (an organization created after 0061): only that history is recorded from
 * its creation — nothing was lost.
 */
export function HistoryBegins({ begins }: { readonly begins: HistoryBeginsView }): ReactNode {
  return (
    <p className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground" data-history-begins>
      <Info aria-hidden className="mt-0.5 shrink-0" />
      <span>
        {t(historyBeginsMessageKey(begins.source), { date: begins.date, time: begins.time })}
      </span>
    </p>
  );
}
