import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useHoursExport } from '@/features/hours/hooks/use-hours-export';
import type { OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { t } from '@/lib/i18n';

/**
 * The organization table's one export (story 4.3): a secondary action that
 * downloads exactly the rows shown as an `.xlsx`: closed (`disabled`) when no
 * row is shown, inert but focusable (`aria-disabled`) while the file is
 * built, the line a failed build shows and, after a download, a status line
 * naming the file (story 7.14, FR-42a). It is
 * drawn only beside the admin's table, so a member-role viewer never has it.
 */
export function OrganizationHoursExport({
  view,
  organizationName,
}: {
  readonly view: OrganizationHoursView;
  readonly organizationName: string;
}): ReactNode {
  const { empty, disabled, labelKey, pending, failed, written, start } = useHoursExport(view, organizationName);

  return (
    <div className="grid min-w-0 justify-items-start gap-3 px-4 pb-4">
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
      {failed ? <Notice role="alert">{t('sati.organization.export.failed')}</Notice> : null}
      {written === null ? null : <Notice role="status">{t('sati.organization.export.done', written)}</Notice>}
    </div>
  );
}
