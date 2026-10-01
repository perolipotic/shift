import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { MyLeaveSkeleton } from '@/features/leave/components/my-leave-skeleton';
import { MyLeaveSummary } from '@/features/leave/components/my-leave-summary';
import {
  MY_LEAVE_LOADING,
  MY_LEAVE_UNAVAILABLE,
  MY_LEAVE_UNSCHEDULED,
  myLeaveMessageKey,
  type MyLeave,
} from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';

/**
 * What *Godišnji* shows under its heading (story 5.2c): the skeleton while
 * the reads are unanswered, one alert with a retry when a read failed or what
 * it answered cannot be trusted, the viewer's own line when they have never
 * been on a team — a fact, so no retry and no figure — and otherwise the three
 * figures. `myLeaveOf` decides which; this only draws it.
 */
export function MyLeaveBody({ leave, onRetry }: { readonly leave: MyLeave; readonly onRetry: () => void }): ReactNode {
  if (leave.kind === MY_LEAVE_LOADING) return <MyLeaveSkeleton />;

  if (leave.kind === MY_LEAVE_UNAVAILABLE) {
    return (
      <div className="grid min-w-0 gap-2">
        <Notice role="alert">{t(myLeaveMessageKey(leave.kind))}</Notice>
        <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={onRetry}>
          {t('godisnji.retry')}
        </Button>
      </div>
    );
  }

  if (leave.kind === MY_LEAVE_UNSCHEDULED) {
    return <p className="text-sm text-muted-foreground">{t(myLeaveMessageKey(leave.kind))}</p>;
  }

  return <MyLeaveSummary balance={leave.balance} />;
}
