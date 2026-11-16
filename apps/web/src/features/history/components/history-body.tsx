import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { StackedSkeletonRow } from '@/components/ui/stacked-list';
import { HistoryBegins } from '@/features/history/components/history-begins';
import { HistoryExport } from '@/features/history/components/history-export';
import { HistoryFilters } from '@/features/history/components/history-filters';
import { HistoryStackedRows } from '@/features/history/components/history-rows';
import { HistoryTable } from '@/features/history/components/history-table';
import type { ChangeHistoryScreen } from '@/features/history/hooks/use-change-history';
import { HISTORY_LOADING, HISTORY_OFFLINE, HISTORY_READY } from '@/features/history/services/history-states';
import { usePhone } from '@/hooks/viewport';
import { t } from '@/lib/i18n';
import { keepFocusOnAlert } from '@/utils/retry-focus';

const SKELETON_ROWS = [0, 1, 2, 3];

/**
 * *Povijest promjena* under its heading (story 14.2): the chips, where
 * history begins when the period reaches it, the *Izvezi u PDF* action (story
 * 14.3), and the rows — a table from 640 px, stacked rows below. The
 * skeleton while the reads are unanswered; offline, one notice and no rows
 * (the history is never kept on the device); a failed read, one alert with a
 * retry; in place of no rows, one line that says why.
 */
export function HistoryBody({ screen }: { readonly screen: ChangeHistoryScreen }): ReactNode {
  const { view, retryable, retry, clearFilters } = screen;
  const isPhone = usePhone();

  function renderBody(): ReactNode {
    if (view.kind === HISTORY_OFFLINE) {
      return (
        <div className="grid min-w-0 gap-2 px-4 pb-4">
          <Notice role="status" variant="offline">
            {t('history.offline')}
          </Notice>
        </div>
      );
    }

    if (view.kind === HISTORY_LOADING) {
      return isPhone ? (
        <ul aria-hidden className="grid divide-y border-y pb-4">
          {SKELETON_ROWS.map((row) => (
            <StackedSkeletonRow key={row} figures={2} />
          ))}
        </ul>
      ) : (
        <div aria-hidden className="grid gap-3 px-4 pb-4">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      );
    }

    if (view.kind !== HISTORY_READY) {
      return (
        <div className="grid min-w-0 gap-2 px-4 pb-4">
          <Notice role="alert">{t('history.unavailable')}</Notice>
          {retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={retry}
            >
              {t('history.retry')}
            </Button>
          ) : null}
        </div>
      );
    }

    // The chips left none of the period's entries: say so, and offer the way back.
    const empty = emptyLineOf(view.filteredOut, clearFilters);

    return (
      <div className="grid min-w-0 gap-3 pb-4">
        {view.begins === null ? null : (
          <div className="px-4">
            <HistoryBegins begins={view.begins} />
          </div>
        )}
        <div className="px-4">
          <HistoryExport view={view} filters={screen.filters} />
        </div>
        {isPhone ? <HistoryStackedRows rows={view.rows} empty={empty} /> : <HistoryTable rows={view.rows} empty={empty} />}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 px-4 pt-4">
        <HistoryFilters screen={screen} />
      </div>
      {renderBody()}
    </div>
  );
}

/** In place of no rows: the period's own emptiness, or the chips' with *Poništi filtre*. */
function emptyLineOf(filteredOut: boolean, onClear: () => void): ReactNode {
  if (filteredOut) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
        <p className="text-base">{t('history.filtered')}</p>
        <Button className="h-11" type="button" variant="outline" onClick={onClear}>
          {t('filter.clear')}
        </Button>
      </div>
    );
  }

  return <p className="py-2 text-base">{t('history.empty')}</p>;
}
