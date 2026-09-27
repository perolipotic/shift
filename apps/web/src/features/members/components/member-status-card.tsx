import { CalendarClock } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Callout, CalloutBody } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import { shownDate, type MemberListRow } from '@/features/members/services/list';
import {
  STATUS_ARMED,
  STATUS_BUSY,
  STATUS_IDLE,
  WITHDRAW,
  statusBlockKey,
  statusConfirmMessageKey,
  statusOfferMessageKey,
  statusPromptKeyOf,
  statusScheduledMessageKey,
  statusSinceOf,
  statusTodayMessageKey,
  type StatusOffer,
} from '@/features/members/services/write';
import { refusalText } from '@/features/members/utils/refusal-text';

/**
 * The member edit screen's status card (story 1.6), drawn only while its block
 * renders — never on the caller's own row.
 *
 * DEACTIVATION is a plain PostgREST insert of a status version, never the
 * privileged function, and every rule of it is `0008`'s insert policy. What it
 * offers, whether it renders at all, which stage shows and what a refusal is
 * called are all `@/features/members/services/write`'s decisions. The date
 * control defaults to, and may not go below, the ORGANIZATION's today; it stays
 * mounted through the confirmation, so a refusal keeps the date that was entered.
 */
export function MemberStatusCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const {
    form,
    offer,
    dateField,
    statusArmedFor,
    statusConfirmed,
    statusRefusal,
    statusDateInvalid,
    statusStage,
    setStatusArmed,
    armStatus,
    changeStatus,
  } = edit;

  /**
   * The status block: today's status, the change scheduled after it, and the
   * one thing offered — a change from a date, or the scheduled change's
   * cancellation — or its confirmation.
   *
   * ABSENT ON THE CALLER'S OWN ROW, and while the organization's today or the
   * caller's identity is unknown — `statusOfferOf`'s decision.
   *
   * THE DATE CONTROL STAYS MOUNTED across every stage, disabled while a
   * confirmation stands, so a refused change returns to the offer with the date
   * that was entered still in it. The block is keyed to the member's history,
   * so it remounts — and the date returns to the new minimum — only once a
   * version lands.
   */
  function renderStatus(): ReactNode {
    const member = form.member;

    if (member === null || offer === null) return null;

    const idle = statusStage === STATUS_IDLE;
    const { status } = offer;

    return (
      <div key={statusBlockKey(member)} className="grid gap-2">
        <p className="text-sm font-medium">
          {t(statusTodayMessageKey(status.activeToday), {
            date: shownDate(statusSinceOf(status, offer.today)),
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
        {statusRefusal === null ? null : (
          <Notice id="member-status-error" role="alert">
            {refusalText(statusRefusal)}
          </Notice>
        )}
        {renderStatusDate(offer, idle)}
        {idle ? renderStatusOffer(member, offer) : renderStatusConfirmation()}
        {statusConfirmed ? (
          <Notice role="status">
            {t('ljudi.status.saved')}
          </Notice>
        ) : null}
      </div>
    );
  }

  /**
   * The date control, for the two changes that take one. A cancellation names
   * the scheduled version's own date and offers no control.
   *
   * DESCRIBED BY THE STATUS BLOCK'S OWN ALERT and by nothing else: the form's
   * refusal is about other fields, and pointing this control at it would read
   * an unrelated error out as the reason the date was refused.
   */
  function renderStatusDate(offered: StatusOffer, idle: boolean): ReactNode {
    if (offered.change === WITHDRAW) return null;

    return (
      <>
        <Label htmlFor="member-status-date">{t('ljudi.status.date')}</Label>
        <Input
          ref={dateField}
          id="member-status-date"
          name="effectiveFrom"
          type="date"
          required
          min={offered.minimum}
          defaultValue={offered.minimum}
          disabled={!idle}
          aria-describedby={statusRefusal === null ? undefined : 'member-status-error'}
          aria-invalid={statusDateInvalid}
          className="h-11"
        />
      </>
    );
  }

  /** The offer, naming the member it acts on. One press sends nothing. */
  function renderStatusOffer(member: MemberListRow, offered: StatusOffer): ReactNode {
    return (
      <Button
        className="h-11 w-full"
        type="button"
        variant="outline"
        onClick={() => {
          armStatus(member, offered);
        }}
      >
        {t(statusOfferMessageKey(offered.change), { name: member.name })}
      </Button>
    );
  }

  /**
   * The confirmation, naming the member and the date, and the busy state it
   * keeps carrying while the write is outstanding.
   */
  function renderStatusConfirmation(): ReactNode {
    if (statusArmedFor === null || offer === null) return null;

    const busy = statusStage === STATUS_BUSY;
    const armedName = statusArmedFor.name;

    // IN A MODAL (design refresh C), open for as long as it is rendered: the
    // armed state is the screen's as before, and Escape or the backdrop cancel
    // except while the write is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setStatusArmed(null);
        }}
        aria-labelledby="member-status-prompt"
      >
        <p id="member-status-prompt" className="text-sm font-medium">
          {t(statusPromptKeyOf(statusArmedFor, offer.today), {
            name: armedName,
            date: shownDate(statusArmedFor.day),
          })}
        </p>
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
            onClick={() => {
              void changeStatus();
            }}
          >
            {t(statusConfirmMessageKey(statusArmedFor.change), { name: armedName })}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  const statusBlock = renderStatus();

  return statusBlock === null ? null : (
    <Card className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('ljudi.status.heading')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{statusBlock}</CardContent>
    </Card>
  );
}
