import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { useMemberLeave } from '@/features/leave/hooks/use-member-leave';
import { MemberLeaveDialog } from '@/features/leave/components/member-leave-dialog';
import {
  LeaveReplacementLines,
  MemberLeaveRecords,
  MemberLeaveRemoveConfirm,
} from '@/features/leave/components/member-leave-records';
import {
  LEAVE_ABSENT,
  LEAVE_HEADING_ID,
  LEAVE_READY,
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  leaveBaseMessageKey,
  leaveHeadingYearsOf,
  type LeaveHandoff,
} from '@/features/leave/services/leave-section';

/**
 * The member page's *Godišnji* card (story 5.1c): the member's allowance, the
 * days used in the current leave year and the balance, then the member's
 * live records (story 5.2b). Facts only (story 7.12): *Upiši godišnji* in the
 * header opens the record dialog, and each record's Izmijeni its amend
 * dialog (`member-leave-dialog`), where a range shows what it costs, the
 * balance after it and the conflicts it creates before anything is saved;
 * each record's Ukloni opens its own confirmation. No od–do field is mounted
 * on the card.
 *
 * Every figure, reason and message is
 * `@/features/leave/services/leave-section`'s decision; this renders them.
 * Neutral styling throughout: `destructive` is reserved for conflicts, and an
 * over-balance range is a note, never a refusal. Day counts render through
 * `count.days`, so `−2 dana` reads as a number.
 *
 * Reached from a conflict (story 5.4d), `handoff` opens the amend dialog with
 * the computed range, or the record's removal confirmation, once.
 *
 * `allowanceAction` (story 7.11) is *Promijeni pravo*, which the page hands in
 * as a slot beside *Pravo* — the allowance is a member's field and its dialog
 * is `members`'s, so this feature never imports it.
 */
export function MemberLeaveCard({
  memberId,
  handoff = null,
  allowanceAction = null,
}: {
  readonly memberId: string;
  readonly handoff?: LeaveHandoff | null;
  readonly allowanceAction?: ReactNode;
}): ReactNode {
  const leave = useMemberLeave(memberId, handoff);
  const { base, leaveSaved, leaveAmended, amendedReplacements, formDisabled, memberName, recordDialog } = leave;

  if (base.kind === LEAVE_ABSENT) return null;

  /** *Godišnji odmor 2026.*, by the leave year the figures count. */
  function renderHeading(): string {
    const years = leaveHeadingYearsOf(base);

    if (years === null) return t('ljudi.leaveRecord.heading');

    return years.to === null
      ? t('ljudi.leaveRecord.headingYear', { year: years.from })
      : t('ljudi.leaveRecord.headingYears', { from: years.from, to: years.to });
  }

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
          <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.allowance')}</dt>
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

  /** What the last landed save or amend left the card saying; its dialog has closed. */
  function renderStatus(): ReactNode {
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
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 ref={leave.cardHeading} id={LEAVE_HEADING_ID} tabIndex={-1}>
              {renderHeading()}
            </h2>
          </CardTitle>
          {/* *UPIŠI GODIŠNJI* (story 7.12): the record dialog's opener, its
              accessible name naming the member once the calendar has read them. */}
          <Button
            ref={recordDialog.opener}
            className="h-11"
            type="button"
            variant="outline"
            aria-label={memberName === null ? undefined : t('ljudi.leaveRecord.recordName', { name: memberName })}
            disabled={formDisabled}
            onClick={recordDialog.open}
          >
            {t('ljudi.leaveRecord.record')}
          </Button>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          {renderFigures()}
          {/* *PROMIJENI PRAVO* (story 7.11), in ONE place whatever the
              figures' state — ready, loading, unavailable or unscheduled — so
              its open dialog never remounts and loses what is typed, and the
              allowance stays changeable without a schedule to cost against. */}
          {allowanceAction === null ? null : <div className="grid min-w-0 gap-2 sm:flex sm:items-center">{allowanceAction}</div>}
          {/* A LANDED SAVE OR AMEND, said on the card its dialog closed back onto. */}
          {renderStatus()}
          <MemberLeaveRecords leave={leave} />
        </CardContent>
      </Card>
      <MemberLeaveDialog leave={leave} />
      <MemberLeaveRemoveConfirm leave={leave} />
    </>
  );
}
