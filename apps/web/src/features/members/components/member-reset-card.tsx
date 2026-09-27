import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { MemberEdit } from '@/features/members/hooks/use-member-edit';
import {
  RESET_ARMED,
  RESET_BUSY,
  RESET_IDLE,
  RESET_SHOWN,
  type ResetCredential,
} from '@/features/members/services/write';

/**
 * The member edit screen's password card, drawn only while its block renders.
 *
 * THE PASSWORD RESET IS OUTSIDE THE `<form>`, deliberately. Inside the actions
 * grid a `<Button>` submits, so the offer would save the edit instead; and
 * `key={memberFormKey(member)}` remounts that subtree after every refetch, which
 * would wipe a credential the admin has not finished reading. Every piece of its
 * state is scoped through `raisedForMember` in the hook, so an armed
 * confirmation or a shown password cannot cross from one member to another.
 *
 * WHICH OF ITS FOUR STAGES IS SHOWING IS `resetStageOf`'s DECISION, in
 * `@/features/members/services/write`, where a test executes it.
 */
export function MemberResetCard({ edit }: { readonly edit: MemberEdit }): ReactNode {
  const { form, armedFor, credential, stage, setArmed, setIssued, issue } = edit;

  /**
   * The reset, at whichever of its four stages it is.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, for the
   * reason `renderForm` is one: `eslint.config.js`'s L2 block refuses a string
   * literal inside a branch nested in a branch that is an element's own child.
   *
   * THE SHOWN CREDENTIAL IS TESTED FIRST, above every gate on the read. This
   * inverts the rule the rest of the screen follows and it is deliberate:
   * everything else here can be recovered by looking again, and the password
   * cannot. Returning `null` when the row is absent — the ordinary gate, one
   * line higher — erases the only copy on the next refetch.
   */
  function renderReset(): ReactNode {
    if (stage === RESET_SHOWN && credential !== null) return renderIssued(credential);
    // ARMED AND BUSY ARE ONE ELEMENT IN TWO STATES, which is why they share a
    // branch: the confirmation has to stay MOUNTED across the request, and a
    // separate busy branch is how it stops being the same element and remounts.
    if ((stage === RESET_ARMED || stage === RESET_BUSY) && armedFor !== null) {
      return renderConfirmation(armedFor);
    }
    // THE OFFER IS REACHED ONLY THROUGH `RESET_IDLE`, and reading the stage
    // here rather than re-deriving `armedFor !== null` one line up is the whole
    // point of the decision being a function. Re-derived, the screen holds a
    // second, unexecuted copy of the rule — and the copy disagrees: with a
    // request in flight and the armed flag already cleared, `resetStageOf`
    // answers `busy` while `armedFor !== null` answers "render the plain,
    // ENABLED offer". `write.test.ts` pins that exact combination, and the
    // screen was the half the pin could not reach.
    //
    // Only now does the row matter: with nothing read there is nobody to offer
    // a reset for, and an offer over a blank name is a control that cannot say
    // what it would do.
    const member = stage === RESET_IDLE ? form.member : null;

    if (member === null) return null;

    return (
      <div className="grid gap-2">
        {/* ITS ACCESSIBLE NAME CARRIES THE MEMBER, for the reason the list's row
            action does: several screens' worth of identically named controls is
            what a screen-reader user cannot tell apart — and here the control
            replaces somebody's credential. */}
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          onClick={() => {
            setArmed({ member: member.id, raised: member.name });
          }}
        >
          {t('ljudi.form.reset', { name: member.name })}
        </Button>
      </div>
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

    // IN A MODAL (design refresh C), open for as long as it is rendered: the
    // armed state is the screen's as before, and Escape or the backdrop cancel
    // except while the request is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setArmed(null);
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
   * belongs to the refusal, and a second one would be a second thing competing
   * to be announced.
   *
   * THE DISMISS IS THE ONLY WAY OUT, and it is what makes a second reset
   * possible at all — a panel that could not be cleared would block the one
   * recovery route an account with no address has, for as long as the screen
   * stayed open.
   */
  function renderIssued(shown: ResetCredential): ReactNode {
    return (
      <div className="grid gap-4">
        <Notice role="status">
          {t('ljudi.form.resetIssued')}
        </Notice>
        <div className="grid gap-2">
          {/* ITS OWN LABEL, never the create form's `Početna lozinka`: this is
              not an initial credential and calling it one would be wrong on the
              one screen where the distinction decides what somebody writes
              down. */}
          <p className="text-sm text-muted-foreground">{t('ljudi.form.resetCredential')}</p>
          {/* DATA, never a key. `break-all font-mono` is what makes a generated
              string readable aloud off a phone. */}
          <p className="break-all font-mono text-base">{shown.password}</p>
        </div>
        <p className="text-sm font-medium">{t('ljudi.form.credentialOnce')}</p>
        <Button
          className="h-11 w-full"
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

  const resetBlock = renderReset();

  return resetBlock === null ? null : (
    <Card className="w-full min-w-0 max-w-2xl">
      <CardHeader>
        <CardTitle asChild>
          <h2>{t('ljudi.form.passwordHeading')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">{resetBlock}</CardContent>
    </Card>
  );
}
