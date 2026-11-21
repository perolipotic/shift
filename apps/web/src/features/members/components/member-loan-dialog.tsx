import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import {
  LOAN_FIELD_FROM,
  LOAN_FIELD_REASON,
  LOAN_FIELD_TEAM,
  LOAN_FIELD_TO,
  LOAN_UNPICKED_VALUE,
  loanDateValuesOf,
  loanInertMessageKey,
  loanRefusalMessageKey,
  loanShiftMessageKey,
  type LoanPerson,
  type LoanPreview,
} from '@/features/members/services/loan';
import {
  MEMBER_LOAN_DIALOG_HEADING_ID,
  MEMBER_LOAN_ERROR_ID,
  MEMBER_LOAN_REASON_HINT_AND_ERROR,
  MEMBER_LOAN_REASON_HINT_ID,
} from '@/features/members/utils/element-ids';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import { shiftTypeDurationMessageKey } from '@/features/shift-types/services/list';
import { ShortStaffedBlock } from '@/features/staffing/components/short-staffed-block';
import { t } from '@/lib/i18n';
import { formatList } from '@/lib/i18n/format';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { NO_TEXT } from '@/utils/text';
import { durationValuesOf } from '@/utils/time';

/**
 * *Posudi drugom timu* (story 18.3; UX-DR58): the team, *Od*, *Do* and
 * *Razlog*, then *Što se mijenja* — the shifts lost and gained per date, two
 * teams at once, work joined with no rest, the short-staffed block of both
 * teams, and the roster changes the loan leaves inapplicable (kept, with
 * where to remove them) — and one *Spremi*. Built as the team dialog
 * (`MemberTeamDialog`): not dismissible while its write is in flight, a
 * refusal keeps it open with what was entered, a landed loan closes it.
 * Keyed to the opening, so each one starts empty. Nothing it shows gates the
 * save.
 */
export function MemberLoanDialog({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, loanPending: pending, loanDialog: dialog } = edit;
  const gate = useWriteGate();
  const opening = dialog.opening;
  const { picker, loanFromField, loanToField, loanReasonField } = dialog;
  const describedBy = dialog.refusal === null ? undefined : MEMBER_LOAN_ERROR_ID;
  const invalid = (field: string): boolean => dialog.invalidField === field;

  /** An override's side by name, or the neutral words for a member the snapshot does not name. */
  function personText(person: LoanPerson | null): string {
    if (person === null) return NO_TEXT;

    return person.name ?? t('loans.unknownMember');
  }

  /** One shift, double, rest-gap and inert line each, in that order. */
  function renderPreview(preview: LoanPreview | null): ReactNode {
    if (preview === null) return null;

    return (
      <span className="grid gap-1 text-sm">
        <span className="block font-medium">{t('loans.changes')}</span>
        {preview.shifts.map((line) => (
          <span key={`${line.side}${line.date}${line.team}${line.type}`} className="block">
            {t(loanShiftMessageKey(line), {
              team: line.team,
              type: line.type,
              range: line.range ?? NO_TEXT,
              ...loanDateValuesOf(line.date),
            })}
          </span>
        ))}
        {preview.moreShifts === 0 ? null : (
          <span className="block">{t('loans.more', { count: preview.moreShifts })}</span>
        )}
        {preview.doubles.map((line) => (
          <span key={line.key} className="block">
            {t('loans.double', {
              firstTeam: line.first.team,
              firstType: line.first.type,
              secondTeam: line.second.team,
              secondType: line.second.type,
              ...loanDateValuesOf(line.date),
            })}
          </span>
        ))}
        {preview.restGaps.map((line) => (
          <span key={line.key} className="block">
            {t('loans.restGap', {
              teams: formatList(line.teams),
              duration: t(shiftTypeDurationMessageKey(line.totalMinutes), durationValuesOf(line.totalMinutes)),
              ...loanDateValuesOf(line.date),
            })}
          </span>
        ))}
        {preview.inert.length === 0 ? null : (
          <>
            <span className="mt-2 block font-medium">{t('loans.inertHeading')}</span>
            {preview.inert.map((line) => (
              <span key={line.key} className="block">
                {t(loanInertMessageKey(line), {
                  team: line.team,
                  out: personText(line.out),
                  in: personText(line.in),
                  ...loanDateValuesOf(line.date),
                })}
              </span>
            ))}
            <span className="block">{t('loans.inertNote')}</span>
          </>
        )}
      </span>
    );
  }

  function renderForm(): ReactNode {
    if (opening === null) return null;

    return (
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          if (!gate.online) {
            event.preventDefault();
            return;
          }
          void dialog.save(event);
        }}
        className="grid gap-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="member-loan-team">{t('loans.team')}</Label>
          <Select
            ref={picker}
            id="member-loan-team"
            name="team"
            defaultValue={LOAN_UNPICKED_VALUE}
            disabled={pending}
            onChange={dialog.pickTeam}
            aria-invalid={invalid(LOAN_FIELD_TEAM)}
            aria-describedby={describedBy}
            className="h-11"
          >
            <option value={LOAN_UNPICKED_VALUE}>{t('loans.choose')}</option>
            {opening.held.choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="member-loan-from">{t('loans.from')}</Label>
            <Input
              ref={loanFromField}
              id="member-loan-from"
              name="loanFrom"
              type="date"
              required
              defaultValue={dialog.from}
              readOnly={pending}
              onChange={dialog.enterFrom}
              aria-invalid={invalid(LOAN_FIELD_FROM)}
              aria-describedby={describedBy}
              className="h-11"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="member-loan-to">{t('loans.to')}</Label>
            <Input
              ref={loanToField}
              id="member-loan-to"
              name="loanTo"
              type="date"
              required
              defaultValue={dialog.to}
              readOnly={pending}
              onChange={dialog.enterTo}
              aria-invalid={invalid(LOAN_FIELD_TO)}
              aria-describedby={describedBy}
              className="h-11"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-loan-reason">{t('loans.reason')}</Label>
          <Input
            ref={loanReasonField}
            id="member-loan-reason"
            name="reason"
            type="text"
            required
            autoComplete="off"
            readOnly={pending}
            aria-invalid={invalid(LOAN_FIELD_REASON)}
            aria-describedby={describedBy === undefined ? MEMBER_LOAN_REASON_HINT_ID : MEMBER_LOAN_REASON_HINT_AND_ERROR}
            className="h-11 w-full"
          />
          <p id={MEMBER_LOAN_REASON_HINT_ID} className="text-sm text-muted-foreground">
            {t('loans.reasonHint')}
          </p>
        </div>
        {/* COMPUTED, as the team dialog's: a polite live region, always there.
            Neutral text: it never gates the save. */}
        <output aria-live="polite" className="grid gap-2">
          {renderPreview(dialog.preview)}
          <ShortStaffedBlock report={dialog.shortStaffed} />
        </output>
        {dialog.refusal === null ? null : (
          <Notice id={MEMBER_LOAN_ERROR_ID} role="alert">
            {t(loanRefusalMessageKey(dialog.refusal))}
          </Notice>
        )}
        {dialog.unchecked ? (
          <Notice id="member-loan-unchecked" role="alert">
            {t('ljudi.erasures.unavailable')}
            <Button
              ref={dialog.retryButton}
              className="mt-3 flex h-11 aria-disabled:opacity-50"
              type="button"
              variant="outline"
              disabled={pending}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              onClick={() => {
                if (!gate.online) return;
                dialog.retry();
              }}
            >
              {t('ljudi.erasures.retry')}
            </Button>
          </Notice>
        ) : null}
        <OfflineWriteNote gate={gate} />
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={dialog.close}>
            {t('loans.cancel')}
          </Button>
          <Button
            ref={dialog.saveButton}
            className="h-11 aria-disabled:opacity-50"
            type="submit"
            disabled={pending}
            aria-disabled={gate.disabled}
            aria-describedby={gate.describedBy()}
            aria-busy={pending}
          >
            {t('loans.save')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  const name = form.member?.name ?? opening?.held.name ?? NO_TEXT;
  const current = opening?.held.current ?? null;

  return (
    <>
      <Dialog
        open={opening !== null}
        dismissible={!pending}
        onOpenChange={(next) => {
          if (!next) dialog.close();
        }}
        // ESCAPE closes through the screen's state, never while a write is in flight.
        onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
          event.preventDefault();
          if (!pending) dialog.close();
        }}
        aria-labelledby={MEMBER_LOAN_DIALOG_HEADING_ID}
      >
        {opening === null ? null : (
          <>
            <DialogHeader closeLabel={t('ljudi.page.close')} onClose={dialog.close}>
              <DialogTitle id={MEMBER_LOAN_DIALOG_HEADING_ID}>{t('loans.dialogHeading')}</DialogTitle>
              <DialogDescription>
                {current === null ? t('loans.nowNone', { name }) : t('loans.now', { name, team: current })}
              </DialogDescription>
            </DialogHeader>
            <Fragment key={opening.key}>{renderForm()}</Fragment>
          </>
        )}
      </Dialog>
      <MemberLoanErasures edit={edit} />
    </>
  );
}

/**
 * THE LOAN'S ERASURE DIALOG (AD-5): the shared `ErasureDialog`, one row per
 * conflict the loan would erase, opened over the loan dialog, which keeps
 * what was entered. Its save is `Potvrdi posudbu osobe {name}`.
 */
function MemberLoanErasures({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, loanErasures, loanPending, confirmLoanErasures, loanErasuresSave } = edit;
  const shown = loanErasures.shown;
  const gate = useWriteGate();

  if (shown === null || form.member === null || shown.subject.member !== form.member.id) return null;

  return (
    <ErasureDialog
      saveButton={loanErasuresSave}
      id="member-loan-erasures"
      rows={shown.rows}
      changed={shown.changed}
      decisions={loanErasures.decisions}
      busy={loanPending}
      firstErasure={loanErasures.firstErasure}
      copy={memberErasureCopyOf(shown.rows, t('loans.confirm', { name: shown.subject.name }))}
      scrollRows
      gate={gate}
      onDecide={loanErasures.decide}
      onBack={loanErasures.close}
      onSave={() => {
        void confirmLoanErasures(shown);
      }}
    />
  );
}
