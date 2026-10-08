import { CalendarDays } from 'lucide-react';
import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import type { MemberListRow } from '@/features/members/services/list';
import { LEAVE_ALLOWANCE_MAX } from '@/features/members/services/write';
import {
  MEMBER_ALLOWANCE_DIALOG_HEADING_ID,
  MEMBER_ALLOWANCE_FIELD_ID,
  MEMBER_FORM_ERROR_ID,
} from '@/features/members/utils/element-ids';
import { refusalText } from '@/features/members/utils/refusal-text';

/** `0002:145` — the column is `smallint not null check (>= 0)`: no allowance
 *  below zero. The upper bound is `LEAVE_ALLOWANCE_MAX`, what a `smallint` holds. */
const ALLOWANCE_MINIMUM = 0;
const ALLOWANCE_STEP = 1;

/**
 * *Pravo · Promijeni pravo* (story 7.11): the allowance's action, which the
 * page hands the leave card as a slot — so `leave` never imports `members` —
 * beside the allowance the card already shows: the button, the notice a
 * landed save leaves, and {@link MemberAllowanceDialog}.
 */
export function MemberAllowanceAction({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, pending, allowanceConfirmed, allowanceDialog } = edit;
  const member = form.member;

  if (member === null) return null;

  return (
    <>
      <Button
        ref={allowanceDialog.opener}
        className="h-11 w-full sm:w-auto sm:justify-self-start"
        type="button"
        variant="outline"
        aria-label={t('ljudi.allowance.changeName', { name: member.name })}
        disabled={pending}
        onClick={allowanceDialog.open}
      >
        {t('ljudi.allowance.change')}
      </Button>
      {allowanceConfirmed ? <Notice role="status">{t('ljudi.allowance.saved')}</Notice> : null}
      <MemberAllowanceDialog edit={edit} />
    </>
  );
}

/**
 * `Promijeni pravo na godišnji odmor`: the allowance and nothing else, behind
 * one Spremi — the member page's one member write, `submit`, which sends only
 * the allowance from here. A value that is no allowance is refused before
 * anything is sent and the field is marked; a landed save closes the dialog,
 * and the leave card's *Pravo* and *Preostalo* move together, from one
 * snapshot.
 */
export function MemberAllowanceDialog({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, leaveField, pending, invalidField, refusal, submit, allowanceDialog } = edit;
  const member = form.member;
  const opening = allowanceDialog.opening;

  /** The dialog's form: the allowance, its refusal, and one Spremi. */
  function renderForm(shown: MemberListRow): ReactNode {
    return (
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-5"
      >
        {/* NOT VALIDATED BY THE BROWSER: the handler refuses a value that is
            no allowance itself, names it, and marks the field. */}
        <div className="grid gap-2">
          <Label htmlFor={MEMBER_ALLOWANCE_FIELD_ID}>{t('ljudi.leave')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <CalendarDays />
            </InputGroupIcon>
            <Input
              ref={leaveField}
              id={MEMBER_ALLOWANCE_FIELD_ID}
              name="leaveAllowanceDays"
              type="number"
              min={ALLOWANCE_MINIMUM}
              max={LEAVE_ALLOWANCE_MAX}
              step={ALLOWANCE_STEP}
              aria-invalid={invalidField === MEMBER_ALLOWANCE_FIELD_ID}
              required
              defaultValue={shown.leaveAllowanceDays}
              aria-describedby={refusal === null ? undefined : MEMBER_FORM_ERROR_ID}
              className="h-11"
            />
          </InputGroup>
        </div>
        {refusal === null ? null : (
          <Notice id={MEMBER_FORM_ERROR_ID} role="alert">
            {refusalText(refusal)}
          </Notice>
        )}
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={allowanceDialog.close}>
            {t('ljudi.form.cancel')}
          </Button>
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {t('ljudi.form.save')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <Dialog
      open={opening !== null && member !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) allowanceDialog.close();
      }}
      // ESCAPE closes through the screen's state, never while a save is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) allowanceDialog.close();
      }}
      aria-labelledby={MEMBER_ALLOWANCE_DIALOG_HEADING_ID}
    >
      {opening === null || member === null ? null : (
        <>
          <DialogHeader closeLabel={t('ljudi.page.close')} onClose={allowanceDialog.close}>
            <DialogTitle id={MEMBER_ALLOWANCE_DIALOG_HEADING_ID}>{t('ljudi.allowance.dialogHeading')}</DialogTitle>
            <DialogDescription>{member.name}</DialogDescription>
          </DialogHeader>
          <Fragment key={opening.key}>
            {renderForm(member)}
          </Fragment>
        </>
      )}
    </Dialog>
  );
}
