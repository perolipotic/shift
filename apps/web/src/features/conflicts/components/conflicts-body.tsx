import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { ConflictsTabs } from '@/features/conflicts/components/conflicts-tabs';
import { ConflictsList } from '@/features/conflicts/components/conflicts-list';
import { ResolvedList } from '@/features/conflicts/components/resolved-list';
import { ConflictsSkeleton } from '@/features/conflicts/components/conflicts-skeleton';
import {
  CONFLICTS_LOADING,
  CONFLICTS_READY,
  CONFLICTS_UNAVAILABLE,
  type ConflictsQueue,
} from '@/features/conflicts/services/conflicts-queue';
import {
  CONFLICTS_PANEL_ID,
  RESOLVED_LOADING,
  RESOLVED_UNAVAILABLE,
  TAB_UNRESOLVED,
  conflictsTabId,
  type ConflictsTab,
  type ResolvedConflicts,
} from '@/features/conflicts/services/resolved-conflicts';
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
 *
 * TWO TABS (story 7.16): *Neriješeni*, the default, whose count stays on its
 * tab at zero, and *Riješeni* (`resolvedConflictsOf`). Both panels' reads
 * fail the same way: one alert with a retry.
 */
export function ConflictsBody({
  queue,
  resolved,
  tab,
  onTab,
  saved,
  savedField,
  onRetry,
}: {
  readonly queue: ConflictsQueue;
  readonly resolved: ResolvedConflicts;
  readonly tab: ConflictsTab;
  readonly onTab: (tab: ConflictsTab) => void;
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
      <ConflictsTabs tab={tab} unresolvedCount={queue.kind === CONFLICTS_READY ? queue.view.count : null} onTab={onTab} />
      <div id={CONFLICTS_PANEL_ID} role="tabpanel" aria-labelledby={conflictsTabId(tab)} className="min-w-0">
        {tab === TAB_UNRESOLVED ? (
          <ConflictsQueueState queue={queue} onRetry={onRetry} />
        ) : (
          <ResolvedState resolved={resolved} onRetry={onRetry} />
        )}
      </div>
    </div>
  );
}

/** The *Riješeni* tab's own state: the skeleton, the alert with its retry, or the list. */
function ResolvedState({ resolved, onRetry }: { readonly resolved: ResolvedConflicts; readonly onRetry: () => void }): ReactNode {
  if (resolved.kind === RESOLVED_LOADING) return <ConflictsSkeleton />;

  if (resolved.kind === RESOLVED_UNAVAILABLE) {
    return <UnavailableAlert onRetry={onRetry} />;
  }

  return <ResolvedList view={resolved.view} />;
}

function UnavailableAlert({ onRetry }: { readonly onRetry: () => void }): ReactNode {
  return (
    <div className="grid min-w-0 gap-2">
      <Notice role="alert">{t('raspored.unavailable')}</Notice>
      <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={onRetry}>
        {t('raspored.retry')}
      </Button>
    </div>
  );
}

/** The queue's own state: the skeleton, the alert with its retry, or the list. */
function ConflictsQueueState({ queue, onRetry }: { readonly queue: ConflictsQueue; readonly onRetry: () => void }): ReactNode {
  if (queue.kind === CONFLICTS_LOADING) return <ConflictsSkeleton />;

  if (queue.kind === CONFLICTS_UNAVAILABLE) {
    return <UnavailableAlert onRetry={onRetry} />;
  }

  return <ConflictsList view={queue.view} />;
}
