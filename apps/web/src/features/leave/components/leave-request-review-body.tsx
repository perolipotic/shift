import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { OfflineNote } from '@/components/offline-note';
import { OfflineWriteNote } from '@/components/offline-write-note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CaretLeft, Check, X } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { LeaveConflictLines } from '@/features/leave/components/leave-conflict-lines';
import type { LeaveRequestReviewState } from '@/features/leave/hooks/use-leave-request-review';
import {
  PREVIEW_BASE,
  PREVIEW_REASON,
  PREVIEW_REFRESHING,
  REVIEW_CLOSED,
  REVIEW_LOADING,
  REVIEW_MISSING,
  REVIEW_PENDING,
  REVIEW_UNAVAILABLE,
  reviewFailureMessageKey,
  type ReviewClosedLine,
  type ReviewFacts,
  type ReviewPreview,
} from '@/features/leave/services/leave-request-review';
import { REQUEST_APPROVED, REQUEST_PENDING, REQUEST_REJECTED } from '@/features/leave/services/leave-request-list';
import { myLeaveRequestStatusMessageKey } from '@/features/leave/services/my-leave';
import {
  LEAVE_REQUEST_REVIEW_HEADING_ID,
  LEAVE_REQUEST_REVIEW_PREVIEW_ID,
} from '@/features/leave/utils/element-ids';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { keepFocusOnAlert } from '@/utils/retry-focus';

/** The way back to the queue, drawn in every state; held while a decision is in flight. */
function BackLink({ disabled = false }: { readonly disabled?: boolean }): ReactNode {
  return (
    <Button asChild variant="ghost" className="-ml-3 h-11 px-3 aria-disabled:opacity-50">
      <Link to="/za-odluku" disabled={disabled}>
        <CaretLeft aria-hidden />
        {t('zaOdluku.resolution.backToQueue')}
      </Link>
    </Button>
  );
}

/** Who asked, for which range, and where the request stands, as a word in a badge. */
function RequestFacts({ facts }: { readonly facts: ReviewFacts }): ReactNode {
  return (
    <div className="grid min-w-0 gap-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-base font-semibold">
          {facts.memberName ?? t('zaOdluku.request.memberGone')}
        </span>
        <Badge variant={facts.request.status === REQUEST_PENDING ? 'default' : 'outline'}>
          {t(myLeaveRequestStatusMessageKey(facts.request.status))}
        </Badge>
      </p>
      <p className="min-w-0 break-words text-sm tabular-nums text-muted-foreground">
        {t('zaOdluku.request.range', { from: facts.from, to: facts.to })}
      </p>
    </div>
  );
}

/**
 * The preview, the admin leave dialog's (story 7.12): the cost in days, the
 * in-year charge when it differs, the balance after approval, the overlap and
 * over-balance notes, and the collisions approval would create, in the
 * dialog's wording — or the base's line, or the range's reason. NEVER A GATE.
 */
function RequestPreview({ preview }: { readonly preview: ReviewPreview }): ReactNode {
  if (preview.kind === PREVIEW_REFRESHING) return null;

  if (preview.kind === PREVIEW_BASE || preview.kind === PREVIEW_REASON) {
    return <p className="text-sm text-muted-foreground">{t(preview.key)}</p>;
  }

  const { figures, inYearDays, conflicts } = preview;

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
      {inYearDays === null ? null : <p className="text-sm">{t('godisnji.request.costInYear', { count: inYearDays })}</p>}
      {figures.overlapsRecord ? <p className="text-sm font-medium">{t('ljudi.leaveRecord.overlap')}</p> : null}
      {figures.exceedsBalance ? (
        <p className="text-sm font-medium">{t('godisnji.request.exceeds', { count: figures.balanceAfterDays })}</p>
      ) : null}
      <LeaveConflictLines conflicts={conflicts} amend={false} />
    </div>
  );
}

/** A closed request's line: who decided and when, or the date it was withdrawn. */
function ClosedLine({ line }: { readonly line: ReviewClosedLine }): ReactNode {
  return (
    <p className="min-w-0 break-words text-sm tabular-nums text-muted-foreground">
      {line.decided
        ? t('zaOdluku.request.decided', { actor: line.actor ?? t('zaOdluku.resolved.actorGone'), date: line.date, time: line.time })
        : t('godisnji.request.withdrawnOn', { date: line.date })}
    </p>
  );
}

/** The refusal of the last decision, under the heading, which takes focus once drawn. */
function FailureNotice({ state }: { readonly state: LeaveRequestReviewState }): ReactNode {
  if (state.failure === null) return null;

  return (
    <Notice ref={state.alertField} role="alert" tabIndex={-1}>
      {t(reviewFailureMessageKey(state.failure))}
    </Notice>
  );
}

/** A pending request's decisions: *Odbij* and *Odobri*, one in flight at a time, gated offline. */
function Decisions({ state }: { readonly state: LeaveRequestReviewState }): ReactNode {
  // STORY 8.3a: offline, both are gated and the note says why.
  const gate = useWriteGate();
  const busy = state.pending !== null;
  // The queue's line names a member gone from both lists as the screen does.
  const memberGone = t('zaOdluku.request.memberGone');

  return (
    <>
      <OfflineWriteNote gate={gate} />
      <div className="flex min-w-0 flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto aria-disabled:opacity-50"
          aria-disabled={gate.disabled ?? (busy ? true : undefined)}
          aria-describedby={gate.describedBy()}
          aria-busy={state.pending === REQUEST_REJECTED}
          onClick={() => {
            if (!gate.online) return;
            void state.decide(REQUEST_REJECTED, memberGone);
          }}
        >
          <X aria-hidden />
          {t('zaOdluku.request.reject')}
        </Button>
        <Button
          type="button"
          className="h-11 w-full sm:w-auto aria-disabled:opacity-50"
          aria-disabled={gate.disabled ?? (busy ? true : undefined)}
          aria-describedby={gate.describedBy()}
          aria-busy={state.pending === REQUEST_APPROVED}
          onClick={() => {
            if (!gate.online) return;
            void state.decide(REQUEST_APPROVED, memberGone);
          }}
        >
          <Check aria-hidden />
          {t('zaOdluku.request.approve')}
        </Button>
      </div>
    </>
  );
}

/**
 * What one leave request's decision screen shows (story 9.4): the skeleton
 * while its reads are unanswered, one alert with a retry when a read failed,
 * "Zahtjev ne postoji." for an unknown id, a pending request with its preview
 * and both decisions, or a closed one read-only — its status, and who decided
 * and when, or the date it was withdrawn. `leaveRequestReviewOf` decides
 * which; this only draws it. The way back and the heading are drawn in every
 * state, and the as-of note under them while the cached snapshot is drawn
 * offline.
 */
export function LeaveRequestReviewBody({ state }: { readonly state: LeaveRequestReviewState }): ReactNode {
  const { screen } = state;

  return (
    <>
      <PageHeader>
        <div className="grid min-w-0 justify-items-start gap-1">
          <BackLink disabled={state.pending !== null} />
          <PageTitle asChild>
            <h1 ref={state.heading} id={LEAVE_REQUEST_REVIEW_HEADING_ID} tabIndex={-1} className="outline-none">
              {t('zaOdluku.request.heading')}
            </h1>
          </PageTitle>
        </div>
      </PageHeader>
      <OfflineNote offline={state.offline} />
      {/* ONE PLACE FOR A REFUSAL, in every state its re-read may leave: pending, closed, or unavailable. */}
      {screen.kind === REVIEW_LOADING || screen.kind === REVIEW_MISSING ? null : <FailureNotice state={state} />}
      {screen.kind === REVIEW_LOADING ? <div aria-hidden className="h-40 animate-pulse rounded-md bg-muted" /> : null}
      {screen.kind === REVIEW_MISSING ? <Notice role="status">{t('zaOdluku.request.missing')}</Notice> : null}
      {screen.kind === REVIEW_UNAVAILABLE ? (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t('zaOdluku.request.unavailable')}</Notice>
          {state.retryable ? (
            <Button
              ref={keepFocusOnAlert}
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={state.retry}
            >
              {t('zaOdluku.resolution.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {screen.kind === REVIEW_CLOSED ? (
        <Card className="grid min-w-0 gap-3 p-4">
          <RequestFacts facts={screen.facts} />
          <ClosedLine line={screen.line} />
        </Card>
      ) : null}
      {screen.kind === REVIEW_PENDING ? (
        <Card className="grid min-w-0 gap-4 p-4">
          <RequestFacts facts={screen.facts} />
          <div id={LEAVE_REQUEST_REVIEW_PREVIEW_ID} aria-live="polite" className="grid min-w-0 gap-2 border-t pt-4">
            <RequestPreview preview={screen.preview} />
          </div>
          <Decisions state={state} />
        </Card>
      ) : null}
    </>
  );
}
