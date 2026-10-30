import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { ArrowLeft, PaperPlaneRight } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { MyLeaveSkeleton } from '@/features/leave/components/my-leave-skeleton';
import type { useLeaveRequestForm } from '@/features/leave/hooks/use-leave-request-form';
import {
  LEAVE_FROM_FIELD,
  LEAVE_PREVIEW_REASON,
  LEAVE_TO_FIELD,
  leaveInYearChargeOf,
  type LeaveField,
} from '@/features/leave/services/leave-section';
import {
  LEAVE_REQUEST_ERROR_ID,
  LEAVE_REQUEST_FROM_ID,
  LEAVE_REQUEST_PREVIEW_ID,
  LEAVE_REQUEST_REASON_ID,
  LEAVE_REQUEST_TO_ID,
  MY_LEAVE_LOADING,
  MY_LEAVE_READY,
  MY_LEAVE_UNAVAILABLE,
  myLeaveMessageKey,
  myLeaveRequestEarliestOf,
  myLeaveRequestReasonMessageKey,
  myLeaveRequestSendMessageKey,
} from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';

type LeaveRequestForm = ReturnType<typeof useLeaveRequestForm>;

/**
 * *Natrag na Godišnji*, above the form's title in every state — loading,
 * unavailable, unscheduled and the form — the member page's back-link idiom,
 * so the surface is never a dead end.
 */
export function LeaveRequestBack(): ReactNode {
  return (
    <Button asChild variant="ghost" className="-ml-3 h-11 justify-self-start px-3">
      <Link to="/godisnji">
        <ArrowLeft aria-hidden />
        {t('godisnji.request.back')}
      </Link>
    </Button>
  );
}

/**
 * *Zatraži godišnji odmor* (story 9.3): od and do, what the range would cost
 * and the balance after it, and one *Pošalji*. The preview shows the cost in
 * days, the part charged to the current leave year when the range crosses it,
 * the balance after it, and — as notes, NEVER A GATE — that it goes over the
 * balance or overlaps the member's own leave. Pending requests charge
 * nothing, so no figure here counts them. Offline *Pošalji* is gated and the
 * note says why. Every figure, reason and message is
 * `@/features/leave/services/my-leave`'s decision; this renders them.
 */
export function LeaveRequestFormBody({ form }: { readonly form: LeaveRequestForm }): ReactNode {
  const { leave, preview, invalidField, failure, pending } = form;
  // STORY 8.3a: offline, *Pošalji* is gated and the note says why.
  const gate = useWriteGate();

  if (leave.kind === MY_LEAVE_LOADING) return <MyLeaveSkeleton />;

  if (leave.kind === MY_LEAVE_UNAVAILABLE) {
    return (
      <div className="grid min-w-0 gap-2">
        <Notice role="alert">{t(myLeaveMessageKey(leave.kind))}</Notice>
        {form.retryable ? (
          <Button
            ref={keepFocusOnAlert}
            className="h-11 w-full sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            onClick={form.retry}
          >
            {t('godisnji.retry')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (leave.kind !== MY_LEAVE_READY) {
    return <p className="text-sm text-muted-foreground">{t(myLeaveMessageKey(leave.kind))}</p>;
  }

  // 0047: no date before the organization's today; past leave is an admin's to record.
  const earliest = myLeaveRequestEarliestOf(leave) ?? undefined;

  /** What a field is described by: the od field by a standing refusal, a marked field by its reason. */
  function describedBy(field: LeaveField): string | undefined {
    if (failure !== null && field === LEAVE_FROM_FIELD) return LEAVE_REQUEST_ERROR_ID;

    return invalidField === field ? LEAVE_REQUEST_REASON_ID : undefined;
  }

  /** The cost, the in-year part, the balance after it and the two notes; or the reason there is none. */
  function renderPreview(): ReactNode {
    if (preview === null) return null;

    if (preview.kind === LEAVE_PREVIEW_REASON) {
      return (
        <p id={LEAVE_REQUEST_REASON_ID} className="text-sm text-muted-foreground">
          {t(myLeaveRequestReasonMessageKey(preview.reason))}
        </p>
      );
    }

    const figures = preview.preview;
    const inYear = leaveInYearChargeOf(figures);

    return (
      <div className="grid min-w-0 gap-2">
        <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-muted-foreground">{t('godisnji.request.cost')}</dt>
            <dd className="text-base font-semibold tabular-nums">{t('count.days', { count: figures.costDays })}</dd>
          </div>
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-muted-foreground">{t('godisnji.request.balanceAfter')}</dt>
            <dd className="text-base font-semibold tabular-nums">{t('count.days', { count: figures.balanceAfterDays })}</dd>
          </div>
        </dl>
        {inYear === null ? null : <p className="text-sm">{t('godisnji.request.costInYear', { count: inYear })}</p>}
        {figures.overlapsRecord ? <p className="text-sm font-medium">{t('godisnji.request.overlapNote')}</p> : null}
        {figures.exceedsBalance ? (
          <p className="text-sm font-medium">{t('godisnji.request.exceeds', { count: figures.balanceAfterDays })}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      noValidate
      className="grid min-w-0 gap-4"
      onSubmit={(event) => {
        if (!gate.online) {
          event.preventDefault();
          return;
        }
        void form.send(event);
      }}
    >
      {/* DISABLED WHILE THE SEND IS OUTSTANDING, the fields included. */}
      <fieldset disabled={pending} aria-busy={pending} className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={LEAVE_REQUEST_FROM_ID}>{t('godisnji.request.from')}</Label>
            <Input
              ref={form.fromField}
              id={LEAVE_REQUEST_FROM_ID}
              name={LEAVE_FROM_FIELD}
              type="date"
              required
              min={earliest}
              onChange={form.change}
              aria-invalid={invalidField === LEAVE_FROM_FIELD}
              aria-describedby={describedBy(LEAVE_FROM_FIELD)}
              className="h-11 min-w-0"
            />
          </div>
          <div className="grid min-w-0 gap-2">
            <Label htmlFor={LEAVE_REQUEST_TO_ID}>{t('godisnji.request.to')}</Label>
            <Input
              ref={form.toField}
              id={LEAVE_REQUEST_TO_ID}
              name={LEAVE_TO_FIELD}
              type="date"
              required
              min={earliest}
              onChange={form.change}
              aria-invalid={invalidField === LEAVE_TO_FIELD}
              aria-describedby={describedBy(LEAVE_TO_FIELD)}
              className="h-11 min-w-0"
            />
          </div>
        </div>
        <div id={LEAVE_REQUEST_PREVIEW_ID} aria-live="polite" className="grid min-w-0 gap-2">
          {renderPreview()}
        </div>
      </fieldset>
      {failure === null ? null : (
        <Notice id={LEAVE_REQUEST_ERROR_ID} ref={form.alertField} role="alert" tabIndex={-1}>
          {t(myLeaveRequestSendMessageKey(failure))}
        </Notice>
      )}
      <OfflineWriteNote gate={gate} />
      <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" className="h-11">
          <Link to="/godisnji">{t('godisnji.request.cancel')}</Link>
        </Button>
        <Button
          className="h-11 aria-disabled:opacity-50"
          type="submit"
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          <PaperPlaneRight aria-hidden />
          {t('godisnji.request.submit')}
        </Button>
      </div>
    </form>
  );
}
