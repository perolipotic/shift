import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { LeaveConflictLines } from '@/features/leave/components/leave-conflict-lines';
import { LeaveReplacementLines } from '@/features/leave/components/member-leave-records';
import type { LeaveDialogOpening, MemberLeave } from '@/features/leave/hooks/use-member-leave';
import type { LeaveRecord } from '@/features/leave/services/leave-list';
import {
  LEAVE_DIALOG_HEADING_ID,
  LEAVE_ERROR_ID,
  LEAVE_FROM_FIELD,
  LEAVE_PREVIEW_ID,
  LEAVE_PREVIEW_REASON,
  LEAVE_READY,
  LEAVE_REASON_ID,
  LEAVE_TO_FIELD,
  leaveDescribedByOf,
  leaveFormFailureOf,
  leaveInYearChargeOf,
  leaveOverlapNoteShown,
  leaveRangeValuesOf,
  leaveReasonMessageKey,
  leaveRefusalMessageKey,
  leaveRefusalValuesOf,
} from '@/features/leave/services/leave-section';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

/**
 * `Upiši godišnji odmor` and `Izmijeni godišnji odmor {od}–{do}` (story
 * 7.12): the leave card's od–do fields, behind one Spremi, in one dialog the
 * card's header button or a row's Izmijeni opens. Before anything is sent it
 * shows what the range costs, the balance after it and the conflicts it
 * creates — and, for an amend, *Bilo / Sada* and which conflicts clear and
 * which stay. None of it gates the save, an over-balance range included
 * (UX-DR23).
 *
 * Every figure, reason and message is `@/features/leave/services/leave-section`'s
 * or `leave-conflicts`'s decision; this renders them. Each opening draws its
 * body afresh; while the write is in flight nothing dismisses it; a refusal
 * keeps it open with the entered values and its alert above the buttons.
 */
export function MemberLeaveDialog({ leave }: { readonly leave: MemberLeave }): ReactNode {
  const {
    base,
    preview,
    invalidField,
    amendGuard,
    conflicts,
    recordPending,
    amendPending,
    formDisabled,
    fromField,
    toField,
    memberName,
    recordDialog,
    amendDialog,
  } = leave;
  const opening = recordDialog.opening ?? amendDialog.opening;
  const pending = recordPending || amendPending;
  /** What the dialog says went wrong: never that an amended record is gone, which the list says. */
  const leaveFailure = leaveFormFailureOf(leave.leaveFailure);
  // STORY 8.3a: offline, the record's or the amendment's save is gated and the note says why.
  const gate = useWriteGate();

  /** Either dialog's close: its own hook handler, which refuses while a write is in flight. */
  function close(): void {
    if (amendDialog.opening === null) recordDialog.close();
    else amendDialog.close();
  }

  /** *Bilo*: the amended record's range and what it costs now, as its row says it. */
  function renderBefore(target: LeaveRecord | null): ReactNode {
    if (target === null || base.kind !== LEAVE_READY) return null;

    const row = base.rows.find((one) => one.record.id === target.id);

    if (row === undefined) return null;

    return (
      <div className="grid min-w-0 gap-1">
        <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.before')}</dt>
        <dd className="break-words text-base font-semibold tabular-nums">
          {t('ljudi.leaveRecord.rangeCost', { from: row.from, to: row.to, cost: t('count.days', { count: row.costDays }) })}
        </dd>
      </div>
    );
  }

  /**
   * What the entered range would do: its cost (for an amend, *Bilo* and
   * *Sada*), the part charged to this leave year when that differs, the
   * balance after it, the notes for an overlap or an over-balance range, the
   * replacement lines (5.4e) and the conflict lines; or the short reason
   * there is no preview, which describes the field it names while that field
   * is marked. Nothing while there is no preview to draw.
   */
  function renderPreview(target: LeaveRecord | null): ReactNode {
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
    const cost = t('count.days', { count: figures.costDays });
    const range = leaveRangeValuesOf(preview.range);

    return (
      <div className="grid min-w-0 gap-2">
        {target === null ? null : <p className="text-sm font-semibold">{t('ljudi.leaveRecord.changes')}</p>}
        <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
          {renderBefore(target)}
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-muted-foreground">
              {target === null ? t('ljudi.leaveRecord.cost') : t('ljudi.leaveRecord.after')}
            </dt>
            <dd className="break-words text-base font-semibold tabular-nums">
              {target === null ? cost : t('ljudi.leaveRecord.rangeCost', { from: range.from, to: range.to, cost })}
            </dd>
          </div>
          <div className="grid min-w-0 gap-1">
            <dt className="text-xs text-muted-foreground">{t('ljudi.leaveRecord.balanceAfter')}</dt>
            <dd className="text-base font-semibold tabular-nums">{t('count.days', { count: figures.balanceAfterDays })}</dd>
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
        {/* STORY 7.12: the conflicts, beside them, neutral and never a gate. */}
        <LeaveConflictLines conflicts={conflicts} amend={target !== null} />
      </div>
    );
  }

  /** The refusal of the last save or amend, above the buttons. */
  function renderAlert(): ReactNode {
    if (leaveFailure === null) return null;

    const key = leaveRefusalMessageKey(leaveFailure);
    const values = leaveRefusalValuesOf(leaveFailure);

    return (
      <Notice id={LEAVE_ERROR_ID} ref={leave.alertField} role="alert" tabIndex={-1}>
        {values === undefined ? t(key) : t(key, values)}
      </Notice>
    );
  }

  /** The dialog's form: od and do, the preview, the alert, and one Spremi. */
  function renderForm(shown: LeaveDialogOpening): ReactNode {
    const amend = shown.target !== null;

    return (
      <form
        noValidate
        className="grid min-w-0 gap-4"
        onSubmit={(event) => {
          if (!gate.online) {
            event.preventDefault();
            return;
          }
          void (amend ? leave.amend(event) : leave.save(event));
        }}
      >
        {/* REACHED FROM A CONFLICT (story 5.4d): od and do are the rule's, not the record's. */}
        {shown.handed ? <Notice role="status">{t('ljudi.leaveRecord.handoffPrefilled')}</Notice> : null}
        {/* DISABLED WHILE A SAVE IS OUTSTANDING, the fields included. */}
        <fieldset disabled={formDisabled} aria-busy={pending} className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="member-leave-from">{t('ljudi.leaveRecord.from')}</Label>
              <Input
                ref={fromField}
                id="member-leave-from"
                name={LEAVE_FROM_FIELD}
                type="date"
                required
                defaultValue={shown.range?.from}
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
                defaultValue={shown.range?.to}
                onChange={leave.change}
                aria-invalid={invalidField === LEAVE_TO_FIELD}
                aria-describedby={leaveDescribedByOf(LEAVE_TO_FIELD, leaveFailure, invalidField)}
                className="h-11 min-w-0"
              />
            </div>
          </div>
          <div id={LEAVE_PREVIEW_ID} aria-live="polite" className="grid min-w-0 gap-2">
            {renderPreview(shown.target)}
          </div>
        </fieldset>
        {renderAlert()}
        <OfflineWriteNote gate={gate} />
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={close}>
            {amend ? t('ljudi.leaveRecord.amendCancel') : t('ljudi.leaveRecord.cancel')}
          </Button>
          <Button
            className="h-11 aria-disabled:opacity-50"
            type="submit"
            disabled={formDisabled}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy()}
            aria-busy={pending}
          >
            {amend ? t('ljudi.leaveRecord.amendSave') : t('ljudi.leaveRecord.save')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <Dialog
      open={opening !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      // ESCAPE closes through the card's state, never while a write is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby={LEAVE_DIALOG_HEADING_ID}
    >
      {opening === null ? null : (
        <>
          <DialogHeader closeLabel={t('ljudi.page.close')} onClose={close}>
            <DialogTitle id={LEAVE_DIALOG_HEADING_ID}>
              {opening.target === null
                ? t('ljudi.leaveRecord.recordDialogHeading')
                : t('ljudi.leaveRecord.amendDialogHeading', leaveRangeValuesOf(opening.target))}
            </DialogTitle>
            {memberName === null ? null : <DialogDescription>{memberName}</DialogDescription>}
          </DialogHeader>
          <Fragment key={opening.key}>{renderForm(opening)}</Fragment>
        </>
      )}
    </Dialog>
  );
}
