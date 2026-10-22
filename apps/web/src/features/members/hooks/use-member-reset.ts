import { useRef, useState } from 'react';

import { byId, type MemberScreen } from '@/features/members/hooks/member-edit-context';
import {
  MEMBER_WRITE_UNAVAILABLE,
  raisedForMember,
  resetPassword,
  resetStageOf,
  type RaisedForMember,
  type MemberFunctions,
  type MemberWriteRefusal,
  type ResetCredential,
} from '@/features/members/services/write';
import { MEMBER_RESET_DIALOG_HEADING_ID, MEMBER_SIGN_IN_HEADING_ID } from '@/features/members/utils/element-ids';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';
import { writesOnline } from '@/lib/offline/use-write-gate';

/**
 * The member page's sign-in card (stories 1.5b, 7.8; split out of
 * `useMemberEdit` by the epics 5–7 retro, A21): the password reset, armed,
 * issued and said, with its own in-flight ref, pending flag and refusal.
 */
export function useMemberReset(screen: MemberScreen) {
  const { id, form, latest } = screen;
  // THE RESET'S OWN STATE, and its own in-flight ref: sharing either with
  // another action would make one request disable the other's controls.
  const resetting = useRef(false);
  /** `Dodijeli novu lozinku`, where focus returns when the confirmation is cancelled or refused. */
  const resetOpener = useRef<HTMLButtonElement>(null);
  const [resetPending, setResetPending] = useState(false);
  /**
   * The armed confirmation, carrying the NAME it is about, so the
   * confirmation and the busy state stay truthful through a refetch that drops
   * the row underneath them.
   */
  const [armed, setArmed] = useState<RaisedForMember<string> | null>(null);
  /**
   * The issued credential, and THE ONLY COPY OF IT THERE IS. It survives a
   * refetch, a read that re-settles failed, and a row that vanishes, because
   * looking again cannot recover it. Cleared by the dismiss control and by
   * nothing else — and until it is, a second reset is impossible.
   */
  const [issued, setIssued] = useState<RaisedForMember<ResetCredential> | null>(null);
  /** Why the last reset did not land, said on the *Prijava* card. */
  const [resetFailure, setResetFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  const armedFor = raisedForMember(armed, id);
  const credential = raisedForMember(issued, id);
  // FOUR STAGES FROM THREE INPUTS, decided in `@/features/members/services/write` where a test
  // runs it. `resetPending` is one of them rather than only a `disabled`
  // attribute, which is what makes the in-flight stage representable at all.
  const stage = resetStageOf(armedFor !== null, resetPending, credential);

  /**
   * Send the reset, and keep the confirmation on screen while it is outstanding.
   *
   * NOTHING CLEARS `armed` BEFORE THE AWAIT. Clearing it there is what unmounts
   * the confirm pair mid-request and renders the plain, ENABLED offer in its
   * place — the state in which `resetPending` is read by no control at all and
   * a second press starts a second reset.
   */
  async function issue(): Promise<void> {
    const member = form.member;

    if (member === null || resetting.current) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    resetting.current = true;
    // The reset's own answer replaces whatever it last said.
    setResetFailure(null);
    setResetPending(true);

    let landed = false;

    try {
      const outcome = await resetPassword(
        supabaseClient().functions as MemberFunctions,
        member.id,
      );

      // NO `invalidateQueries` HERE, and that is a decision rather than an
      // omission: a reset writes no `members` row, so a refetch would change
      // nothing on the list and would only be one more render the shown
      // credential has to survive.
      landed = outcome.ok;
      if (outcome.ok) setIssued({ member: member.id, raised: outcome.credential });
      else setResetFailure({ member: member.id, raised: outcome.refusal });
    } catch (cause) {
      // The CAUSE is logged and never the credential — the success path does
      // not throw, so there is none to leak here.
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setResetFailure({ member: member.id, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
    } finally {
      // On EVERY path, including the successful one. Disarmed here and NOT
      // before the await: the confirmation is what carries the busy state, so
      // it has to outlive the request it started.
      resetting.current = false;
      setResetPending(false);
      setArmed(null);
      // FOCUS STAYS WITH THE MEMBER IT WAS ABOUT: the shown password's dialog
      // title, the button again over a refusal; nowhere once the route has
      // moved on to another member.
      if (latest.current.member?.id === member.id) {
        focusLater(
          landed ? [] : [() => resetOpener.current],
          byId(landed ? MEMBER_RESET_DIALOG_HEADING_ID : MEMBER_SIGN_IN_HEADING_ID),
        );
      }
    }
  }

  /** The reset confirmation's cancel and Escape: focus goes back to the button that armed it. */
  function focusResetOpener(): void {
    focusLater([() => resetOpener.current], byId(MEMBER_SIGN_IN_HEADING_ID));
  }

  return {
    armedFor,
    credential,
    stage,
    resetRefusal: raisedForMember(resetFailure, id),
    resetOpener,
    focusResetOpener,
    setArmed,
    setIssued,
    issue,
  };
}
