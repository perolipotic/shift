import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { ConflictsList } from '@/features/conflicts/components/conflicts-list';
import { ConflictsSkeleton } from '@/features/conflicts/components/conflicts-skeleton';
import {
  CONFLICTS_LOADING,
  CONFLICTS_UNAVAILABLE,
  type ConflictsQueue,
} from '@/features/conflicts/services/conflicts-queue';
import { t } from '@/lib/i18n';

/**
 * What *Raspored* shows under its heading (story 5.3b): the skeleton while
 * the reads are unanswered, one alert with a retry when a read failed or the
 * queue was refused — never a partial list — and otherwise the queue.
 * `conflictsQueueOf` decides which; this only draws it.
 */
export function ConflictsBody({ queue, onRetry }: { readonly queue: ConflictsQueue; readonly onRetry: () => void }): ReactNode {
  if (queue.kind === CONFLICTS_LOADING) return <ConflictsSkeleton />;

  if (queue.kind === CONFLICTS_UNAVAILABLE) {
    return (
      <div className="grid min-w-0 gap-2">
        <Notice role="alert">{t('raspored.unavailable')}</Notice>
        <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={onRetry}>
          {t('raspored.retry')}
        </Button>
      </div>
    );
  }

  return <ConflictsList view={queue.view} />;
}
