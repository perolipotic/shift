import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { byId, type DialogOpening, type MemberScreen } from '@/features/members/hooks/member-edit-context';
import { MEMBERS_LIST_KEY, MEMBERS_TABLE } from '@/features/members/services/list';
import {
  MEMBER_ENTRY_EMAIL,
  MEMBER_ENTRY_NAME,
  MEMBER_ENTRY_USERNAME,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  chosenRole,
  enteredAllowance,
  memberEntryRefusalOf,
  raisedForMember,
  saveMember,
  storedEmail,
  type RaisedForMember,
  ALLOWANCE_SAVE,
  BASICS_SAVE,
  type MemberEdits,
  type MemberSaveScope,
  type MemberFunctions,
  type MemberWriteRefusal,
} from '@/features/members/services/write';
import { MEMBER_PAGE_HEADING_ID } from '@/features/members/utils/element-ids';
import { rankEditOf } from '@/features/members/utils/rank';
import { MEMBER_SAVE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';

/**
 * The member page's basics card and the allowance's dialog (stories 1.5b,
 * 7.11; split out of `useMemberEdit` by the epics 5–7 retro, A21): the one
 * member write, `saveMember`, for whichever of its two dialogs is open, with
 * its own in-flight ref, pending flag and refusal.
 */
export function useMemberBasics(screen: MemberScreen) {
  const { id, openings, form, offersRank } = screen;
  const queryClient = useQueryClient();
  // THE MEMBER WRITE'S FIELDS: the basics dialog's five, and the allowance
  // dialog's one (`member-leave`). Only one of the two dialogs is open at once.
  const nameField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const leaveField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);
  const rankField = useRef<HTMLSelectElement>(null);
  const basicsOpener = useRef<HTMLButtonElement>(null);
  const allowanceOpener = useRef<HTMLButtonElement>(null);
  // A REF as well as state: state drives the disabled button, and state is
  // stale inside a handler already called once this tick.
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [basicsOpen, setBasicsOpen] = useState<RaisedForMember<DialogOpening> | null>(null);
  const [allowanceOpen, setAllowanceOpen] = useState<RaisedForMember<DialogOpening> | null>(null);
  // SCOPED TO THE MEMBER IT WAS RAISED ABOUT. One component instance serves
  // every row — navigating between two members changes a route param, not the
  // component — so unscoped state outlives the record it describes.
  const [failure, setFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  /** Which field a locally-detected refusal is about. See the create screen. */
  const [invalidField, setInvalidField] = useState<string | null>(null);
  /**
   * That a save landed, and on which card it is said: the dialog closed, so
   * the card it closed back onto says so. KEYED TO THE MEMBER it confirms.
   */
  const [saved, setSaved] = useState<RaisedForMember<MemberSaveScope> | null>(null);

  // ANOTHER MEMBER, or none: the dialogs close — scoped to their member, they
  // would otherwise open again, unprompted, on the way back (A → B → A).
  useEffect(() => {
    setBasicsOpen(null);
    setAllowanceOpen(null);
  }, [id]);

  // THE DIALOG'S REFUSAL, and the read's own, which the basics card says.
  const refusal = raisedForMember(failure, id);
  const readRefusal: MemberWriteRefusal | null =
    form.refusal === null ? null : { code: form.refusal, saved: false };
  const savedOn = raisedForMember(saved, id);
  const basicsOpening = raisedForMember(basicsOpen, id);
  const allowanceOpening = raisedForMember(allowanceOpen, id);

  // THE DIALOG'S RECORD GONE ON A RE-READ (story 7.11): the member left the
  // list under the basics or the allowance dialog. It closes, and focus goes
  // to the page. Never while its own write is pending: that settles first.
  const basicsGone = (basicsOpening !== null || allowanceOpening !== null) && form.member === null && !pending;

  useEffect(() => {
    if (!basicsGone) return;
    setBasicsOpen(null);
    setAllowanceOpen(null);
    focusLater([], byId(MEMBER_PAGE_HEADING_ID));
  }, [basicsGone]);

  /** `Uredi` or `Promijeni pravo`: its dialog opens on the record as it is now. */
  function openMemberDialog(scope: MemberSaveScope): void {
    if (saving.current || form.member === null) return;

    setFailure(null);
    setInvalidField(null);
    setSaved(null);
    openings.current += 1;

    const opening = { member: id, raised: { key: openings.current, held: null } };

    if (scope === ALLOWANCE_SAVE) setAllowanceOpen(opening);
    else setBasicsOpen(opening);
  }

  /** Either dialog's cancel, close button and Escape: never while a save is in flight. */
  function closeMemberDialog(): void {
    if (saving.current) return;

    const opener = allowanceOpening === null ? basicsOpener : allowanceOpener;

    setBasicsOpen(null);
    setAllowanceOpen(null);
    // A PARTIAL SAVE STAYS SAID: the other fields did land, so the card keeps
    // saying so (and why the rename did not) once the dialog is gone.
    setFailure((said) => (said !== null && said.raised.saved ? said : null));
    setInvalidField(null);
    focusLater([() => opener.current], byId(MEMBER_PAGE_HEADING_ID));
  }

  /**
   * THE ONE MEMBER WRITE, for whichever of its two dialogs is open (story
   * 7.11): the basics dialog sends name, username, address, role and — while
   * offered — rank, and never the allowance; the allowance dialog sends the
   * allowance and nothing else. `saveMember` sends only the fields the edit
   * carries, so neither writes back a value another admin may have changed
   * since this page was read. A refusal keeps the dialog open with what was
   * entered; a landed save closes it and says so on its card.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const member = form.member;
    const scope: MemberSaveScope = allowanceOpening === null ? BASICS_SAVE : ALLOWANCE_SAVE;
    const name = nameField.current;
    const username = usernameField.current;
    const email = emailField.current;
    const leave = leaveField.current;
    const role = roleField.current;
    const rank = rankField.current;

    if (
      member === null ||
      (scope === ALLOWANCE_SAVE && leave === null) ||
      (scope === BASICS_SAVE && (name === null || username === null || email === null || role === null)) ||
      (scope === BASICS_SAVE && offersRank && rank === null) ||
      saving.current
    ) {
      return;
    }

    let edits: MemberEdits;

    if (scope === ALLOWANCE_SAVE) {
      const leaveAllowanceDays = enteredAllowance(leave?.value ?? NO_TEXT);

      if (leaveAllowanceDays === null) {
        setFailure({ member: member.id, raised: { code: MEMBER_WRITE_INVALID, saved: false } });
        setInvalidField(leave?.id ?? null);
        leave?.focus();

        return;
      }

      edits = { leaveAllowanceDays };
    } else {
      // THE FORM'S OWN REFUSALS (B298), in field order: the dialog is
      // `noValidate`, so nothing in the browser's language stops them.
      const fields = { [MEMBER_ENTRY_NAME]: name, [MEMBER_ENTRY_USERNAME]: username, [MEMBER_ENTRY_EMAIL]: email };
      const refused = memberEntryRefusalOf({
        name: name?.value ?? NO_TEXT,
        username: username?.value ?? NO_TEXT,
        email: email?.value ?? NO_TEXT,
      });

      if (refused !== null) {
        const field = fields[refused];

        setFailure({ member: member.id, raised: { code: MEMBER_WRITE_INVALID, saved: false } });
        setInvalidField(field?.id ?? null);
        field?.focus();

        return;
      }

      edits = {
        name: name?.value ?? NO_TEXT,
        email: storedEmail(email?.value ?? NO_TEXT),
        role: chosenRole(role?.value ?? NO_TEXT),
        username: username?.value ?? NO_TEXT,
        // ONLY WHILE THE CONTROL IS OFFERED. Absent, the PATCH leaves the
        // stored rank alone: the setting hides ranks and never deletes them.
        ...rankEditOf(member.fireRank, rank?.value ?? null, offersRank),
      };
    }

    saving.current = true;
    setFailure(null);
    setInvalidField(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await saveMember(
        supabaseClient().from(MEMBERS_TABLE),
        supabaseClient().functions as MemberFunctions,
        member,
        edits,
      );

      // THE OUTCOME FIRST, AND THE CACHE AFTER. A failed or paused re-read
      // resolves rather than rejects (`refreshAfterWrite`), so it cannot
      // replace the specific refusal.
      if (!outcome.ok) setFailure({ member: member.id, raised: outcome.refusal });
      else {
        setSaved({ member: member.id, raised: scope });
        setBasicsOpen(null);
        setAllowanceOpen(null);
        focusLater(
          [() => (scope === ALLOWANCE_SAVE ? allowanceOpener : basicsOpener).current],
          byId(MEMBER_PAGE_HEADING_ID),
        );
      }

      // INVALIDATED ON BOTH OUTCOMES, and the failing one is the reason. A
      // refused RENAME still wrote the ordinary fields, so a cache left alone
      // would show the old values beside a message saying they were saved.
      // Whatever LANDED is re-read wherever the row shows (`MEMBER_SAVE_DEPENDENTS`).
      try {
        await refreshAfterWrite(
          queryClient,
          MEMBERS_LIST_KEY,
          outcome.ok || outcome.refusal.saved ? MEMBER_SAVE_DEPENDENTS : NO_DEPENDENTS,
        );
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setFailure({ member: member.id, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
    } finally {
      // On EVERY path, including the successful one.
      saving.current = false;
      setPending(false);
    }
  }

  return {
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    pending,
    invalidField,
    refusal,
    readRefusal,
    confirmed: savedOn === BASICS_SAVE,
    allowanceConfirmed: savedOn === ALLOWANCE_SAVE,
    submit,
    basicsDialog: {
      opener: basicsOpener,
      opening: basicsOpening,
      open: () => {
        openMemberDialog(BASICS_SAVE);
      },
      close: closeMemberDialog,
    },
    allowanceDialog: {
      opener: allowanceOpener,
      opening: allowanceOpening,
      open: () => {
        openMemberDialog(ALLOWANCE_SAVE);
      },
      close: closeMemberDialog,
    },
  };
}
