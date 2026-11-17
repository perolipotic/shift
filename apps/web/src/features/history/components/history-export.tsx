import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useHistoryExport } from '@/features/history/hooks/use-history-export';
import type { HistoryExportView } from '@/features/history/services/history-export';
import type { HistorySearchFilters } from '@/features/history/services/history-search';
import { t } from '@/lib/i18n';

/**
 * *Povijest promjena*'s one export (story 14.3), as the hours table's
 * (`OrganizationHoursExport`): a secondary action that downloads exactly the
 * rows shown as a PDF — closed (`disabled`) when no row is shown, inert but
 * focusable (`aria-disabled`) while the file is built, the line a failed
 * build shows, the refusal of more changes than one file takes (epic 14
 * retro A9) and, after a download, a status line naming the file and its
 * changes. It is drawn only in the ready state of the admin-guarded page, so
 * a member-role viewer never has it.
 */
export function HistoryExport({
  view,
  filters,
}: {
  readonly view: HistoryExportView;
  readonly filters: HistorySearchFilters;
}): ReactNode {
  const { empty, disabled, labelKey, pending, failed, refused, written, start } = useHistoryExport(view, filters);

  return (
    <div className="grid min-w-0 justify-items-start gap-3">
      {/* Building keeps the focus: `aria-disabled`, the press refused by the hook. */}
      <Button
        type="button"
        variant="secondary"
        className="h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        disabled={empty}
        aria-disabled={disabled}
        aria-busy={pending}
        onClick={start}
      >
        {t(labelKey)}
      </Button>
      {refused === null ? null : <Notice role="alert">{t('history.export.tooLarge', refused)}</Notice>}
      {failed ? <Notice role="alert">{t('history.export.failed')}</Notice> : null}
      {written === null ? null : <Notice role="status">{t('history.export.done', written)}</Notice>}
    </div>
  );
}
