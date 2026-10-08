import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { CredentialLine } from '@/features/members/components/credential-line';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import type { MemberListRow } from '@/features/members/services/list';
import {
  RESET_ARMED,
  RESET_BUSY,
  RESET_IDLE,
  RESET_SHOWN,
  type ResetCredential,
} from '@/features/members/services/write';
import { MEMBER_RESET_ERROR_ID, MEMBER_SIGN_IN_HEADING_ID } from '@/features/members/utils/element-ids';
import { refusalText } from '@/features/members/utils/refusal-text';

/**
 * The member page's *Prijava* card (story 7.11; the reset since story 1.5b):
 * the username the person signs in with, and `Dodijeli novu lozinku` in its header —
 * its confirmation first, then the new password shown once.
 *
 * Every piece of its state is scoped through `raisedForMember` in the hook,
 * so an armed confirmation or a shown password cannot cross from one member
 * to another. WHICH OF ITS FOUR STAGES IS SHOWING IS `resetStageOf`'s
 * DECISION, in `@/features/members/services/write`, where a test executes it.
 */
export function MemberResetCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, armedFor, credential, stage, resetRefusal, resetOpener, focusResetOpener, setArmed, setIssued, issue } =
    edit;

  /**
   * The card, at whichever of its four stages the reset is.
   *
   * THE SHOWN CREDENTIAL IS TESTED FIRST, above every gate on the read. This
   * inverts the rule the rest of the screen follows and it is deliberate:
   * everything else here can be recovered by looking again, and the password
   * cannot. Returning `null` when the row is absent — the ordinary gate, one
   * line higher — erases the only copy on the next refetch.
   */
  function renderReset(): ReactNode {
    const shown = stage === RESET_SHOWN && credential !== null ? renderIssued(credential) : null;
    // ARMED AND BUSY ARE ONE ELEMENT IN TWO STATES, which is why they share a
    // branch: the confirmation has to stay MOUNTED across the request.
    const confirming =
      (stage === RESET_ARMED || stage === RESET_BUSY) && armedFor !== null ? renderConfirmation(armedFor) : null;
    const member = form.member;

    if (member === null) return shown === null && confirming === null ? null : renderCard(null, null, shown ?? confirming);

    // THE OFFER IS PRESSABLE ONLY THROUGH `RESET_IDLE`, read off the stage
    // rather than re-derived from `armedFor`: with a request in flight and the
    // armed flag already cleared, `resetStageOf` answers `busy`, and a
    // re-derived copy would enable it. It STAYS MOUNTED, so a cancel returns
    // focus to it. Its accessible name carries the member: it replaces
    // somebody's credential. One press only arms the confirmation.
    const idle = stage === RESET_IDLE;

    return renderCard(
      member,
      <Button
        ref={resetOpener}
        className="h-11"
        type="button"
        variant="outline"
        aria-label={t('ljudi.form.reset', { name: member.name })}
        aria-describedby={resetRefusal === null ? undefined : MEMBER_RESET_ERROR_ID}
        disabled={!idle}
        onClick={() => {
          setArmed({ member: member.id, raised: member.name });
        }}
      >
        {t('ljudi.form.resetAction')}
      </Button>,
      shown ?? confirming,
    );
  }

  /** The card itself: its heading and offer, the username, the refusal, and the stage's own part. */
  function renderCard(member: MemberListRow | null, offer: ReactNode, body: ReactNode): ReactNode {
    return (
      <Card role="region" aria-labelledby={MEMBER_SIGN_IN_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={MEMBER_SIGN_IN_HEADING_ID} tabIndex={-1}>
              {t('ljudi.form.signInHeading')}
            </h2>
          </CardTitle>
          {offer}
        </CardHeader>
        <CardContent className="grid gap-4">
          {member === null ? null : (
            <p className="text-sm">{t('ljudi.form.signInLine', { username: member.username })}</p>
          )}
          {resetRefusal === null ? null : (
            <Notice id={MEMBER_RESET_ERROR_ID} role="alert">
              {refusalText(resetRefusal)}
            </Notice>
          )}
          {body}
        </CardContent>
      </Card>
    );
  }

  /**
   * The confirmation, and the busy state it keeps carrying.
   *
   * ONE PRESS RESETS NOTHING. The offer arms this; only the confirm below sends
   * anything, and it names the member so the second press is a distinct, more
   * specific decision rather than the same press twice.
   *
   * IT STAYS MOUNTED WHILE THE REQUEST IS OUTSTANDING, disabled and
   * `aria-busy`. The offer does not come back underneath it, so there is no
   * moment at which an enabled control could start a second reset.
   */
  function renderConfirmation(name: string): ReactNode {
    const busy = stage === RESET_BUSY;

    // IN A MODAL (design refresh C), open for as long as it is rendered.
    // Escape or the backdrop cancel except while the request is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setArmed(null);
          focusResetOpener();
        }}
        aria-labelledby="member-reset-prompt"
      >
        <p id="member-reset-prompt" className="text-sm font-medium">
          {t('ljudi.form.resetPrompt', { name })}
        </p>
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setArmed(null);
              focusResetOpener();
            }}
          >
            {t('ljudi.form.resetCancel')}
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void issue();
            }}
          >
            {t('ljudi.form.resetConfirm', { name })}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  /**
   * The new credential, shown once.
   *
   * `role="status"` AND NOT `role="alert"`: the assertive region on this screen
   * belongs to the refusal. THE DISMISS IS THE ONLY WAY OUT, and it is what
   * makes a second reset possible at all.
   */
  function renderIssued(shown: ResetCredential): ReactNode {
    return (
      <div className="grid gap-4">
        <Notice role="status">
          {t('ljudi.form.resetIssued')}
        </Notice>
        <div className="grid gap-2">
          {/* ITS OWN LABEL, never the create form's `Početna lozinka`: this is
              not an initial credential. */}
          <p className="text-sm text-muted-foreground">{t('ljudi.form.resetCredential')}</p>
          {/* DATA, never a key, with `Kopiraj` beside it (story 7.8). */}
          <CredentialLine password={shown.password} />
        </div>
        {/* ITS OWN SENTENCE: a reset is not the first sign-in, so it names
            the NEXT one (story 7.8). */}
        <p className="text-sm font-medium">{t('ljudi.form.resetCredentialOnce')}</p>
        <Button
          className="h-11 w-full sm:w-auto sm:justify-self-start"
          type="button"
          variant="outline"
          onClick={() => {
            setIssued(null);
          }}
        >
          {t('ljudi.form.resetDismiss')}
        </Button>
      </div>
    );
  }

  return renderReset();
}
