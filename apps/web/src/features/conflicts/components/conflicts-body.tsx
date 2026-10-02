import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { ConflictsList } from '@/features/conflicts/components/conflicts-list';
import { ConflictsSkeleton } from '@/features/conflicts/components/conflicts-skeleton';
import {
  CONFLICTS_LOADING,
  CONFLICTS_UNAVAILABLE,
  type ConflictsQueue,
} from '@/features/conflicts/services/conflicts-queue';
import { resolutionSavedMessageKey, type ResolutionSaved } from '@/features/conflicts/services/resolution-screen';
import { REPLACE_MEMBER } from '@/features/conflicts/services/resolutions';
import { t } from '@/lib/i18n';

/**
 * What *Raspored* shows under its heading (story 5.3b): the skeleton while
 * the reads are unanswered, one alert with a retry when a read failed or the
 * queue was refused — never a partial list — and otherwise the queue.
 * Above whichever it is, the status line a decision just saved returns with
 * (story 5.4b), which takes focus so it is announced. `conflictsQueueOf`
 * decides which; this only draws it.
 */
export function ConflictsBody({
  queue,
  saved,
  savedField,
  onRetry,
}: {
  readonly queue: ConflictsQueue;
  readonly saved: ResolutionSaved | null;
  readonly savedField: RefObject<HTMLParagraphElement | null>;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {saved === null ? null : (
        <Notice role="status" ref={savedField} tabIndex={-1} className="outline-none">
          {t(resolutionSavedMessageKey(saved.kind), {
            type: saved.shiftTypeName,
            team: saved.teamName,
            date: saved.dateShown,
            member: saved.memberName,
            replacement: saved.kind === REPLACE_MEMBER ? saved.replacementName : undefined,
          })}
        </Notice>
      )}
      <ConflictsQueueState queue={queue} onRetry={onRetry} />
    </div>
  );
}

/** The queue's own state: the skeleton, the alert with its retry, or the list. */
function ConflictsQueueState({ queue, onRetry }: { readonly queue: ConflictsQueue; readonly onRetry: () => void }): ReactNode {
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
