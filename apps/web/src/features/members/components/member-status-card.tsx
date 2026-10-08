import { CalendarClock } from 'lucide-react';
import { Fragment, type ReactNode, type SyntheticEvent } from 'react';

import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';

import { Button } from '@/components/ui/button';
import { Callout, CalloutBody } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConfirmDialog,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { isIsoDate } from '@/lib/i18n/format';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { memberErasureCopyOf } from '@/features/members/utils/erasure-copy';
import { NO_TEXT, shownDate, type MemberListRow } from '@/features/members/services/list';
import {
  STATUS_ARMED,
  STATUS_BUSY,
  WITHDRAW,
  statusActionMessageKey,
  statusBlockKey,
  statusConfirmMessageKey,
  statusDialogHeadingMessageKey,
  statusOfferMessageKey,
  statusPromptKeyOf,
  statusScheduledMessageKey,
  statusSinceOf,
  statusTodayMessageKey,
  type StatusChangeOffer,
  type StatusOffer,
} from '@/features/members/services/write';
import {
  MEMBER_STATUS_DIALOG_HEADING_ID,
  MEMBER_STATUS_ERROR_ID,
  MEMBER_STATUS_HEADING_ID,
  MEMBER_STATUS_PROMPT_ID,
  MEMBER_STATUS_WITHDRAW_PROMPT_ID,
} from '@/features/members/utils/element-ids';
import { refusalText } from '@/features/members/utils/refusal-text';

/**
 * The member page's *Status* card (story 1.6; facts and a dialog since story
 * 7.11), drawn only while its block renders — never on the caller's own row.
 * Today's status, the change scheduled after it, and in its header the change
 * offered — `Deaktiviraj` or `Ponovno aktiviraj` — which opens
 * {@link MemberStatusDialog}. A scheduled change is withdrawn from the card
 * itself, behind its own confirmation.
 *
 * DEACTIVATION is a plain PostgREST insert of a status version, never the
 * privileged function, and every rule of it is `0008`'s insert policy. What it
 * offers, whether it renders at all, which stage shows and what a refusal is
 * called are all `@/features/members/services/write`'s decisions. NEVER
 * `destructive`: the action is a neutral button with one question.
 */
export function MemberStatusCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    form,
    offer,
    statusConfirmed,
    statusRefusal,
    statusPending,
    armStatus,
    statusErased,
    statusDialog,
  } = edit;

  /**
   * The card's body: today's status, the change scheduled after it, the
   * card's own refusal, the withdrawal, and what a landed change said. Keyed
   * to the member's history, so it redraws once a version lands.
   */
  function renderStatus(member: MemberListRow, offered: StatusOffer): ReactNode {
    const { status } = offered;

    return (
      <CardContent key={statusBlockKey(member)} className="grid gap-4">
        <p className="text-sm font-medium">
          {t(statusTodayMessageKey(status.activeToday), {
            date: shownDate(statusSinceOf(status, offered.today)),
          })}
        </p>
        {/* A SCHEDULED CHANGE STANDS OUT (design refresh C): it is the one
            line here about the future, so it sits in a callout of its own. */}
        {status.scheduled === null ? null : (
          <Callout>
            <CalloutBody>
              <IconTile variant="primary">
                <CalendarClock />
              </IconTile>
              <p className="self-center text-sm font-medium">
                {t(statusScheduledMessageKey(status.scheduled.active), {
                  date: shownDate(status.scheduled.effectiveFrom),
                })}
              </p>
            </CalloutBody>
          </Callout>
        )}
        {/* THE CARD'S OWN REFUSAL — a withdrawal refused, or a dialog that
            closed because the record moved — while no dialog says it. */}
        {statusDialog.opening !== null || statusRefusal === null ? null : (
          <Notice id={MEMBER_STATUS_ERROR_ID} role="alert">
            {refusalText(statusRefusal)}
          </Notice>
        )}
        {offered.change === WITHDRAW ? (
          <Button
            ref={statusDialog.withdrawButton}
            className="h-11 w-full sm:w-auto sm:justify-self-start"
            type="button"
            variant="outline"
            disabled={statusPending}
            onClick={() => {
              armStatus(member, offered);
            }}
          >
            {t(statusOfferMessageKey(WITHDRAW), { name: member.name })}
          </Button>
        ) : null}
        {statusConfirmed ? (
          <Notice role="status">
            <span className="block">{t('ljudi.status.saved')}</span>
            {/* WHAT THE GUARDED WRITE REMOVED (story 5.5e), as confirmed in its dialog. */}
            {statusErased === 0 ? null : (
              <span className="mt-2 block">{t('ljudi.erasures.removed', { count: statusErased })}</span>
            )}
          </Notice>
        ) : null}
      </CardContent>
    );
  }

  const member = form.member;

  if (member === null || offer === null) return null;

  const action = statusDialog.available;

  return (
    <>
      <Card role="region" aria-labelledby={MEMBER_STATUS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={MEMBER_STATUS_HEADING_ID} tabIndex={-1}>
              {t('ljudi.status.heading')}
            </h2>
          </CardTitle>
          {/* ITS ACCESSIBLE NAME CARRIES THE MEMBER; its visible word is the action. */}
          {action === null ? null : (
            <Button
              ref={statusDialog.opener}
              className="h-11"
              type="button"
              variant="outline"
              aria-label={t(statusOfferMessageKey(action.change), { name: member.name })}
              disabled={statusPending}
              onClick={statusDialog.open}
            >
              {t(statusActionMessageKey(action.change))}
            </Button>
          )}
        </CardHeader>
        {renderStatus(member, offer)}
      </Card>
      <MemberStatusDialog edit={edit} />
      <MemberStatusWithdrawal edit={edit} />
      <MemberStatusErasures edit={edit} />
    </>
  );
}

/** "Pokušaj ponovno", when what the change would erase could not be checked (story 5.5e). */
function StatusUnchecked({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { statusUnchecked, statusRetryButton, statusPending, retryStatus } = edit;

  if (!statusUnchecked) return null;

  // NOTHING WAS WRITTEN: said here, with a retry of the same change.
  return (
    <Notice id="member-status-unchecked" role="alert">
      {t('ljudi.erasures.unavailable')}
      <Button
        ref={statusRetryButton}
        className="mt-3 flex h-11"
        type="button"
        variant="outline"
        disabled={statusPending}
        onClick={retryStatus}
      >
        {t('ljudi.erasures.retry')}
      </Button>
    </Notice>
  );
}

/**
 * `Deaktivacija osobe` / `Ponovna aktivacija osobe` (story 7.11): *Vrijedi
 * od* and the one neutral question naming the person and the date as it is
 * entered. Its final button is the action itself — `Deaktiviraj` or
 * `Ponovno aktiviraj` — and never `destructive`. It runs the preflight, then
 * the erasure check, then the write. Not dismissible while that is in flight;
 * a refusal keeps it open, with the date focused when the refusal names it.
 *
 * THE DATE CONTROL IS DESCRIBED BY THE DIALOG'S OWN ALERT and by nothing else.
 */
export function MemberStatusDialog({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, dateField, statusRefusal, statusDateInvalid, statusPending, statusDialog } = edit;
  const opening = statusDialog.opening;
  // THE CHANGE THE DIALOG WAS OPENED ON: it stays, busy, while its write is out.
  const action = opening?.held.offer ?? null;
  const name = form.member?.name ?? opening?.held.name ?? NO_TEXT;
  /** The question exists only while the field holds a date; nothing points at an empty element. */
  const asked = action !== null && isIsoDate(statusDialog.day);

  /** The one neutral question, naming the person and the date as it stands in the field. */
  function renderQuestion(offered: StatusChangeOffer): ReactNode {
    return (
      <p id={MEMBER_STATUS_PROMPT_ID} className="text-sm font-medium">
        {t(statusPromptKeyOf({ change: offered.change, day: statusDialog.day }, offered.today), {
          name,
          date: shownDate(statusDialog.day),
        })}
      </p>
    );
  }

  /** The dialog's form: the date, the question, and the one final button. */
  function renderChange(offered: StatusChangeOffer): ReactNode {
    return (
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          void statusDialog.save(event);
        }}
        className="grid gap-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="member-status-date">{t('ljudi.status.date')}</Label>
          <Input
            ref={dateField}
            id="member-status-date"
            name="effectiveFrom"
            type="date"
            required
            min={offered.minimum}
            defaultValue={offered.minimum}
            readOnly={statusPending}
            onChange={statusDialog.enterDay}
            aria-describedby={statusRefusal === null ? undefined : MEMBER_STATUS_ERROR_ID}
            aria-invalid={statusDateInvalid}
            className="h-11"
          />
        </div>
        {asked ? renderQuestion(offered) : null}
        {statusRefusal === null ? null : (
          <Notice id={MEMBER_STATUS_ERROR_ID} role="alert">
            {refusalText(statusRefusal)}
          </Notice>
        )}
        <StatusUnchecked edit={edit} />
        <DialogFooter>
          <Button className="h-11" type="button" variant="outline" disabled={statusPending} onClick={statusDialog.close}>
            {t('ljudi.status.cancel')}
          </Button>
          <Button
            ref={statusDialog.saveButton}
            className="h-11"
            type="submit"
            disabled={statusPending}
            aria-busy={statusPending}
          >
            {t(statusActionMessageKey(offered.change))}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  return (
    <Dialog
      open={opening !== null && action !== null}
      dismissible={!statusPending}
      onOpenChange={(next) => {
        if (!next) statusDialog.close();
      }}
      // ESCAPE closes through the screen's state, never while a write is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!statusPending) statusDialog.close();
      }}
      aria-labelledby={MEMBER_STATUS_DIALOG_HEADING_ID}
      aria-describedby={asked ? MEMBER_STATUS_PROMPT_ID : undefined}
    >
      {opening === null || action === null ? null : (
        <>
          <DialogHeader closeLabel={t('ljudi.page.close')} onClose={statusDialog.close}>
            <DialogTitle id={MEMBER_STATUS_DIALOG_HEADING_ID}>
              {t(statusDialogHeadingMessageKey(action.change))}
            </DialogTitle>
            <DialogDescription>{name}</DialogDescription>
          </DialogHeader>
          <Fragment key={opening.key}>{renderChange(action)}</Fragment>
        </>
      )}
    </Dialog>
  );
}

/**
 * The withdrawal of a scheduled status change: its own confirmation, naming
 * the member and the date, open for as long as it is armed. Escape and the
 * backdrop cancel except while the write is outstanding.
 */
function MemberStatusWithdrawal({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { offer, statusArmedFor, statusStage, setStatusArmed, confirmStatus } = edit;

  if (statusArmedFor === null || statusArmedFor.change !== WITHDRAW || offer === null) return null;

  const busy = statusStage === STATUS_BUSY;
  const armedName = statusArmedFor.name;

  return (
    <ConfirmDialog
      busy={busy}
      onCancel={() => {
        setStatusArmed(null);
      }}
      aria-labelledby={MEMBER_STATUS_WITHDRAW_PROMPT_ID}
    >
      <p id={MEMBER_STATUS_WITHDRAW_PROMPT_ID} className="text-sm font-medium">
        {t(statusPromptKeyOf(statusArmedFor, offer.today), {
          name: armedName,
          date: shownDate(statusArmedFor.day),
        })}
      </p>
      <StatusUnchecked edit={edit} />
      <DialogFooter>
        <Button
          className="h-11"
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setStatusArmed(null);
          }}
        >
          {t('ljudi.status.cancel')}
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={busy || statusStage !== STATUS_ARMED}
          aria-busy={busy}
          onClick={confirmStatus}
        >
          {t(statusConfirmMessageKey(WITHDRAW), { name: armedName })}
        </Button>
      </DialogFooter>
    </ConfirmDialog>
  );
}

/**
 * THE STATUS CHANGE'S ERASURE DIALOG (story 5.5e): the team card's twin, for
 * a deactivation or the withdrawal of a scheduled reactivation, opened over
 * the status dialog. A deactivation can erase many conflicts, so the rows
 * scroll inside it.
 */
function MemberStatusErasures({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, statusErasures, statusPending, confirmStatusErasures } = edit;
  const shown = statusErasures.shown;

  if (shown === null || form.member === null || shown.subject.member !== form.member.id) return null;

  const { confirmation } = shown.subject;

  return (
    <ErasureDialog
      id="member-status-erasures"
      rows={shown.rows}
      changed={shown.changed}
      decisions={statusErasures.decisions}
      busy={statusPending}
      firstErasure={statusErasures.firstErasure}
      copy={memberErasureCopyOf(
        shown.rows,
        t(statusConfirmMessageKey(confirmation.change), { name: confirmation.name }),
      )}
      scrollRows
      onDecide={statusErasures.decide}
      onBack={statusErasures.close}
      onSave={() => {
        void confirmStatusErasures(shown);
      }}
    />
  );
}
