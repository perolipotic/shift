import type { ReactNode, RefObject } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUUpLeft } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import type {
  LeaveRequestWithdrawRefusal,
  LeaveRequestWithdrawn,
} from '@/features/leave/hooks/use-my-leave-requests';
import { REQUEST_PENDING } from '@/features/leave/services/leave-request-list';
import {
  MY_LEAVE_REQUESTS_HEADING_ID,
  MY_REQUESTS_LOADING,
  MY_REQUESTS_READY,
  MY_REQUESTS_UNAVAILABLE,
  myLeaveRequestClosedMessageKey,
  myLeaveRequestStatusMessageKey,
  myLeaveRequestWithdrawMessageKey,
  type MyLeaveRequestRow,
  type MyLeaveRequests,
} from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/**
 * *Moji zahtjevi za godišnji* (story 9.3): the viewer's own leave requests,
 * soonest first — each its range, what it would cost, its status as a WORD in
 * a badge (*Čeka odluku*, *Odobren*, *Odbijen*, *Povučen*) and, once closed,
 * the date — and *Povuci zahtjev* on a pending one, with no confirmation: a
 * withdrawn range can be sent again. Offline the button is gated and the note
 * says why. `myLeaveRequestsOf` decides every row; this only draws them.
 */
export function MyLeaveRequests({
  list,
  retryable,
  pendingId,
  refusal,
  withdrawn,
  outcomeField,
  listHeading,
  onWithdraw,
  onRetry,
}: {
  readonly list: MyLeaveRequests;
  /** Whether to show the read retry now: the list unavailable, online (story 8.2e). */
  readonly retryable: boolean;
  readonly pendingId: string | null;
  readonly refusal: LeaveRequestWithdrawRefusal | null;
  readonly withdrawn: LeaveRequestWithdrawn | null;
  readonly outcomeField: RefObject<HTMLParagraphElement | null>;
  readonly listHeading: RefObject<HTMLHeadingElement | null>;
  readonly onWithdraw: (row: MyLeaveRequestRow) => void;
  readonly onRetry: () => void;
}): ReactNode {
  // STORY 8.3a: offline, *Povuci zahtjev* is gated and the note says why.
  const gate = useWriteGate();

  /** One request's row: the range and cost, the status word, the closing date, and the withdrawal. */
  function renderRow(row: MyLeaveRequestRow): ReactNode {
    const pending = pendingId === row.request.id;
    const cost = row.costDays === null ? null : t('count.days', { count: row.costDays });
    const closed = myLeaveRequestClosedMessageKey(row.request.status);

    return (
      <li key={row.request.id} className="grid min-w-0 gap-2 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="grid min-w-0 gap-1">
          <dl className="grid min-w-0 gap-1">
            <div className="min-w-0">
              <dt className="sr-only">{t('godisnji.request.range')}</dt>
              <dd className="break-words text-base font-semibold tabular-nums">
                {cost === null ? row.label : t('godisnji.request.rangeCost', { range: row.label, cost })}
              </dd>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <dt className="sr-only">{t('godisnji.request.state')}</dt>
              <dd className="min-w-0">
                <Badge variant={row.request.status === REQUEST_PENDING ? 'default' : 'outline'}>
                  {t(myLeaveRequestStatusMessageKey(row.request.status))}
                </Badge>
              </dd>
            </div>
          </dl>
          {closed === null || row.closedOn === null ? null : (
            <p className="text-sm text-muted-foreground tabular-nums">{t(closed, { date: row.closedOn })}</p>
          )}
        </div>
        {row.withdrawable ? (
          <Button
            className="h-11 w-full aria-disabled:opacity-50 sm:w-auto sm:shrink-0"
            type="button"
            variant="outline"
            disabled={pendingId !== null}
            aria-busy={pending}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy()}
            aria-label={t('godisnji.request.withdrawName', { from: row.from, to: row.to })}
            onClick={() => {
              if (!gate.online) return;
              onWithdraw(row);
            }}
          >
            <ArrowUUpLeft aria-hidden />
            {t('godisnji.request.withdraw')}
          </Button>
        ) : null}
      </li>
    );
  }

  /** The list, its empty line, its unavailable line with a retry, or nothing while it loads. */
  function renderBody(): ReactNode {
    if (list.kind === MY_REQUESTS_LOADING) return <div aria-hidden className="h-16 animate-pulse rounded-md bg-muted" />;

    if (list.kind === MY_REQUESTS_UNAVAILABLE) {
      return (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('godisnji.request.listUnavailable')}</Notice>
          {retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={onRetry}
            >
              {t('godisnji.retry')}
            </Button>
          ) : null}
        </div>
      );
    }

    if (list.rows.length === 0) {
      return <p className="text-sm text-muted-foreground">{t('godisnji.request.empty')}</p>;
    }

    return (
      <ul aria-labelledby={MY_LEAVE_REQUESTS_HEADING_ID} className="grid min-w-0 divide-y">
        {list.rows.map(renderRow)}
      </ul>
    );
  }

  return (
    <section aria-labelledby={MY_LEAVE_REQUESTS_HEADING_ID} className="grid min-w-0 gap-3">
      <h2 ref={listHeading} id={MY_LEAVE_REQUESTS_HEADING_ID} tabIndex={-1} className="text-lg font-semibold">
        {t('godisnji.request.listHeading')}
      </h2>
      {refusal === null ? null : (
        <Notice ref={outcomeField} role="alert" tabIndex={-1}>
          {t(myLeaveRequestWithdrawMessageKey(refusal.code), { from: refusal.from, to: refusal.to })}
        </Notice>
      )}
      {withdrawn === null ? null : (
        <Notice ref={outcomeField} role="status" tabIndex={-1}>
          {t('godisnji.request.withdrawn', { from: withdrawn.from, to: withdrawn.to })}
        </Notice>
      )}
      {list.kind === MY_REQUESTS_READY && list.rows.some((row) => row.withdrawable) ? <OfflineWriteNote gate={gate} /> : null}
      {renderBody()}
    </section>
  );
}
