import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { useMemberLeave } from '@/features/leave/hooks/use-member-leave';
import {
  LeaveReplacementLines,
  MemberLeaveRecords,
  MemberLeaveRemoveConfirm,
} from '@/features/leave/components/member-leave-records';
import {
  LEAVE_ABSENT,
  LEAVE_ERROR_ID,
  LEAVE_FROM_FIELD,
  LEAVE_HEADING_ID,
  LEAVE_PREVIEW_ID,
  LEAVE_PREVIEW_REASON,
  LEAVE_READY,
  LEAVE_REASON_ID,
  LEAVE_TO_FIELD,
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  leaveBaseMessageKey,
  leaveDescribedByOf,
  leaveFormFailureOf,
  leaveInYearChargeOf,
  leaveOverlapNoteShown,
  leaveRangeValuesOf,
  leaveReasonMessageKey,
  leaveRefusalMessageKey,
  leaveRefusalValuesOf,
  type LeaveHandoff,
} from '@/features/leave/services/leave-section';

/**
 * The member page's *Godišnji* card (story 5.1c): the member's allowance, the
 * days used in the current leave year and the balance, then an od–do form
 * that shows what the range would cost before anything is saved. Between
 * the two, the member's live records (story 5.2b), each of which the form
 * can amend in place and its own confirmation can remove.
 *
 * Every figure, reason and message is
 * `@/features/leave/services/leave-section`'s decision; this renders them.
 * Neutral styling throughout: `destructive` is reserved for conflicts, and an
 * over-balance range is a note, never a refusal. Day counts render through
 * `count.days`, so `−2 dana` reads as a number.
 *
 * Reached from a conflict (story 5.4d), `handoff` opens amend mode with the
 * computed range, or the record's removal confirmation, once.
 */
export function MemberLeaveCard({
  memberId,
  handoff = null,
}: {
  readonly memberId: string;
  readonly handoff?: LeaveHandoff | null;
}): ReactNode {
  const leave = useMemberLeave(memberId, handoff);
  const {
    base,
    preview,
    invalidField,
    leaveSaved,
    leaveAmended,
    amendedReplacements,
    amendGuard,
    amendTarget,
    recordPending,
    amendPending,
    formDisabled,
    fromField,
    toField,
  } = leave;
  /** What the form says went wrong: never that an amended record is gone, which the list says. */
  const leaveFailure = leaveFormFailureOf(leave.leaveFailure);
  const formPending = recordPending || amendPending;

  if (base.kind === LEAVE_ABSENT) return null;

  /** The three figures, a skeleton for each while the reads are pending; or the line in their place. */
  function renderFigures(): ReactNode {
    if (base.kind === LEAVE_UNAVAILABLE || base.kind === LEAVE_UNSCHEDULED) {
      return (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(leaveBaseMessageKey(base.kind))}</Notice>
          {base.kind === LEAVE_UNAVAILABLE ? (
            <Button className="h-11 w-full sm:w-auto sm:justify-self-start" type="button" variant="outline" onClick={leave.retry}>
              {t('ljudi.leaveRecord.retry')}
            </Button>
          ) : null}
        </div>
      );
    }

    const balance = base.kind === LEAVE_READY ? base.balance : null;

    return (
      <dl className="grid min-w-0 gap-3 sm:grid-cols-3">
        <div className="grid min-w-0 gap-1 rounded-md bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t('ljudi.leave')}</dt>
          {renderFigure(balance?.allowanceDays ?? null)}
        </div>
        <div className="grid min-w-0 gap-1 rounded-md bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.used')}</dt>
          {renderFigure(balance?.usedDays ?? null)}
        </div>
        <div className="grid min-w-0 gap-1 rounded-md bg-muted p-3">
          <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.balance')}</dt>
          {renderFigure(balance?.balanceDays ?? null)}
        </div>
      </dl>
    );
  }

  /** One figure in whole days, or its skeleton. Body face, not Syne: its
   *  digits are tabular Shift Figures (story 7.2). */
  function renderFigure(days: number | null): ReactNode {
    if (days === null) {
      return (
        <dd>
          <div className="h-6 w-16 animate-pulse rounded-md bg-muted-foreground/20" />
        </dd>
      );
    }

    return <dd className="text-lg font-bold tabular-nums">{t('count.days', { count: days })}</dd>;
  }

  /**
   * What the entered range would do: its cost, the part charged to this leave
   * year when that differs, the balance after it, and a note for an overlap
   * or an over-balance range, and in amend mode each replacement the amend
   * would leave rostered (story 5.4e); or the short reason there is no preview. The
   * reason sits in a polite live region and describes the field it names
   * whenever that field is marked. Nothing while there is no preview to draw.
   */
  function renderPreview(): ReactNode {
    if (preview === null) return null;

    if (preview.kind === LEAVE_PREVIEW_REASON) {
      return (
        <p id={LEAVE_REASON_ID} className="text-sm text-muted-foreground">
          {t(leaveReasonMessageKey(preview.reason))}
        </p>
      );
    }

    const figures = preview.preview;
    const inYear = leaveInYearChargeOf(figures);

    return (
      <div className="grid min-w-0 gap-2">
        <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.cost')}</dt>
            <dd className="text-base font-semibold tabular-nums">{t('count.days', { count: figures.costDays })}</dd>
          </div>
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.balanceAfter')}</dt>
            <dd className="text-base font-semibold tabular-nums">
              {t('count.days', { count: figures.balanceAfterDays })}
            </dd>
          </div>
        </dl>
        {inYear === null ? null : <p className="text-sm">{t('ljudi.leaveRecord.costInYear', { count: inYear })}</p>}
        {leaveOverlapNoteShown(figures, leaveFailure) ? (
          <p className="text-sm font-medium">{t('ljudi.leaveRecord.overlap')}</p>
        ) : null}
        {figures.exceedsBalance ? (
          <p className="text-sm font-medium">{t('ljudi.leaveRecord.exceeds', { count: figures.balanceAfterDays })}</p>
        ) : null}
        {/* STORY 5.4e: inside the polite live region, a note and never a gate. */}
        <LeaveReplacementLines guard={amendGuard} />
      </div>
    );
  }

  /** The outcome of the last save: the refusal, or what the landed save cost. */
  function renderOutcome(): ReactNode {
    if (leaveFailure !== null) {
      const key = leaveRefusalMessageKey(leaveFailure);
      const values = leaveRefusalValuesOf(leaveFailure);

      return (
        <Notice id={LEAVE_ERROR_ID} ref={leave.noticeField} role="alert" tabIndex={-1}>
          {values === undefined ? t(key) : t(key, values)}
        </Notice>
      );
    }

    if (leaveAmended !== null) {
      return (
        <Notice ref={leave.noticeField} role="status" tabIndex={-1}>
          {leaveAmended.costDays === null
            ? t('ljudi.leaveRecord.amendedPlain')
            : t('ljudi.leaveRecord.amended', { count: leaveAmended.costDays })}
          {leaveAmended.overBalanceDays === null ? null : (
            <span className="mt-1 block">
              {t('ljudi.leaveRecord.savedExceeds', { count: leaveAmended.overBalanceDays })}
            </span>
          )}
          <LeaveReplacementLines guard={amendedReplacements} inline />
        </Notice>
      );
    }

    if (leaveSaved === null) return null;

    return (
      <Notice ref={leave.noticeField} role="status" tabIndex={-1}>
        {leaveSaved.costDays === null
          ? t('ljudi.leaveRecord.savedPlain')
          : t('ljudi.leaveRecord.saved', { count: leaveSaved.costDays })}
        {leaveSaved.overBalanceDays === null ? null : (
          <span className="mt-1 block">
            {t('ljudi.leaveRecord.savedExceeds', { count: leaveSaved.overBalanceDays })}
          </span>
        )}
      </Notice>
    );
  }

  return (
    <>
      <Card role="region" aria-labelledby={LEAVE_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader>
          <CardTitle asChild>
            <h2 id={LEAVE_HEADING_ID}>{t('ljudi.leaveRecord.heading')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {renderFigures()}
          <MemberLeaveRecords leave={leave} />
          <form
            ref={leave.formField}
            noValidate
            className="grid min-w-0 gap-4"
            onSubmit={(event) => void (amendTarget === null ? leave.save(event) : leave.amend(event))}
          >
            {/* DISABLED WHILE A SAVE IS OUTSTANDING, the fields included, so
                nothing typed after the press is lost to the reset after it. */}
            <fieldset disabled={formDisabled} aria-busy={formPending} className="grid min-w-0 gap-4">
              {/* ONE FORM, TWO MODES (story 5.2b): the legend names the record
                  being amended, so the one od/do pair keeps its labels. */}
              <legend className="mb-2 text-sm font-semibold">
                {amendTarget === null
                  ? t('ljudi.leaveRecord.newHeading')
                  : t('ljudi.leaveRecord.amendHeading', leaveRangeValuesOf(amendTarget))}
              </legend>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="member-leave-from">{t('ljudi.leaveRecord.from')}</Label>
                  <Input
                    ref={fromField}
                    id="member-leave-from"
                    name={LEAVE_FROM_FIELD}
                    type="date"
                    required
                    onChange={leave.change}
                    aria-invalid={invalidField === LEAVE_FROM_FIELD}
                    aria-describedby={leaveDescribedByOf(LEAVE_FROM_FIELD, leaveFailure, invalidField)}
                    className="h-11 min-w-0"
                  />
                </div>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="member-leave-to">{t('ljudi.leaveRecord.to')}</Label>
                  <Input
                    ref={toField}
                    id="member-leave-to"
                    name={LEAVE_TO_FIELD}
                    type="date"
                    required
                    onChange={leave.change}
                    aria-invalid={invalidField === LEAVE_TO_FIELD}
                    aria-describedby={leaveDescribedByOf(LEAVE_TO_FIELD, leaveFailure, invalidField)}
                    className="h-11 min-w-0"
                  />
                </div>
              </div>
              <div id={LEAVE_PREVIEW_ID} aria-live="polite" className="grid min-w-0 gap-2">
                {renderPreview()}
              </div>
              {renderOutcome()}
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <Button className="h-11 w-full sm:w-auto" type="submit" aria-busy={formPending}>
                  {amendTarget === null ? t('ljudi.leaveRecord.save') : t('ljudi.leaveRecord.amendSave')}
                </Button>
                {amendTarget === null ? null : (
                  <Button className="h-11 w-full sm:w-auto" type="button" variant="outline" onClick={leave.cancelAmend}>
                    {t('ljudi.leaveRecord.amendCancel')}
                  </Button>
                )}
              </div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <MemberLeaveRemoveConfirm leave={leave} />
    </>
  );
}
