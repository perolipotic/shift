import type { Loan } from '@shift/domain';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { byId, type DialogOpening, type MemberScreen } from '@/features/members/hooks/member-edit-context';
import { MEMBERS_LIST_KEY, memberTeamOf, type MemberListRow } from '@/features/members/services/list';
import {
  LOAN_AMEND,
  LOAN_FAILED,
  LOAN_FIELD_FROM,
  LOAN_FIELD_REASON,
  LOAN_FIELD_TEAM,
  LOAN_FIELD_TO,
  LOAN_LEND,
  LOAN_REMOVE,
  LOAN_STALE,
  LOAN_UNAVAILABLE,
  LOAN_UNPICKED_VALUE,
  TEAM_LOANS_TABLE,
  amendLoan,
  enteredSpanOf,
  lendMember,
  loanAmendChoicesOf,
  loanAmendPreflightOf,
  loanChoicesOf,
  loanEditWindowOf,
  loanEndsTodayOfferedOf,
  loanErasureCheckOf,
  loanFieldOf,
  loanPreflightOf,
  loanWriteEditOf,
  memberLoansOf,
  previewableSpanOf,
  removeLoan,
  shownLoanPreviewOf,
  shownLoanShortStaffedOf,
  type LoanChoice,
  type LoanEdit,
  type LoanRefusal,
  type LoanRpc,
  type LoanSnapshotRefusal,
  type LoanWrite,
  type LoanWriteKind,
  type LoanWriteOutcome,
} from '@/features/members/services/loan';
import { raisedForMember, type RaisedForMember } from '@/features/members/services/write';
import { MEMBER_TEAM_HEADING_ID } from '@/features/members/utils/element-ids';
import { useStaffingLeave } from '@/features/staffing/hooks/use-staffing-leave';
import { MEMBERSHIP_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { firstEnabledOf, focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';

/** What the loan dialog was opened on: the teams offered then, who, and the loan amended (story 18.4) or none. */
export interface HeldLoan {
  readonly choices: readonly LoanChoice[];
  readonly name: string;
  /** The member's team today, by name, or `null` for none. */
  readonly current: string | null;
  /** The live loan the dialog amends or removes, or `null` for a new loan. */
  readonly replaces: Loan | null;
  /** Whether *Završi danas* is offered: the amended loan has begun and ends after today. */
  readonly endsToday: boolean;
}

/**
 * What a refused write re-reads beside the calendar: the teams and the
 * members, because a 42501 may be a team archived or a move written meanwhile
 * (0062's policy, 0064's re-check), as a refused team change re-reads them.
 */
const LOAN_REFUSAL_REREADS = [TEAMS_LIST_KEY, MEMBERS_LIST_KEY] as const;

/** What the loan's erasure check stood on: the member and the write. */
export interface CheckedLoan {
  readonly member: string;
  readonly name: string;
  readonly write: LoanWrite;
}

/**
 * *Posudi drugom timu* (story 18.3; UX-DR58) and its amend (story 18.4;
 * FR-91): the member page's loan dialog — team, *Od*, *Do*, *Razlog*, *Što
 * se mijenja* and one *Spremi* — built as the team dialog is
 * (`useMemberTeam`): its own in-flight ref, pending flag and refusal, every
 * piece raised for its member (`raisedForMember`), the shared erasure
 * confirmation, the offline gate (`writesOnline`), and a landed write
 * re-reading the calendar and its dependents. Opened on a live loan, the
 * same dialog amends it (an earlier *Do* ends it early; *Završi danas* sets
 * it) or, with *Ukloni posudbu*, removes it, and derives everything over the
 * edit's window. Every rule is a pure function in
 * `@/features/members/services/loan`.
 */
export function useMemberLoan(screen: MemberScreen) {
  const { id, openings, form, today, activeTeams, calendarSnapshot, latest, readErasures } = screen;
  const queryClient = useQueryClient();
  const loaning = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  /** The opener of the last amend, for focus after it lands or closes. */
  const amendOpener = useRef<HTMLButtonElement | null>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const loanFromField = useRef<HTMLInputElement>(null);
  const loanToField = useRef<HTMLInputElement>(null);
  const loanReasonField = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const erasuresSave = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<RaisedForMember<DialogOpening<HeldLoan>> | null>(null);
  const [team, setTeam] = useState<RaisedForMember<string> | null>(null);
  const [from, setFrom] = useState<RaisedForMember<string> | null>(null);
  const [to, setTo] = useState<RaisedForMember<string> | null>(null);
  const [removal, setRemoval] = useState<RaisedForMember<boolean> | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RaisedForMember<LoanRefusal> | null>(null);
  const [saved, setSaved] = useState<RaisedForMember<LoanWriteKind> | null>(null);
  const [erased, setErased] = useState<RaisedForMember<number> | null>(null);
  const [unchecked, setUnchecked] = useState<RaisedForMember<true> | null>(null);
  const erasures = useErasureConfirmation<CheckedLoan>(pending, () =>
    firstEnabledOf<HTMLElement>(
      () => saveButton.current,
      () => opener.current,
    ),
  );
  const erasureDialog = useRef(erasures);

  useEffect(() => {
    erasureDialog.current = erasures;
  });

  // ANOTHER MEMBER: the dialog and its erasure confirmation were about the last one.
  useEffect(() => {
    const shown = erasureDialog.current;

    if (shown.shown !== null && shown.shown.subject.member !== id) shown.drop();
    setOpen(null);
  }, [id]);

  const member = form.member;
  const available = member === null ? null : loanChoicesOf(member, activeTeams, today);
  const loans = useMemo(() => memberLoansOf(calendarSnapshot, id), [calendarSnapshot, id]);
  const opening = raisedForMember(open, id);
  const choices = opening?.held.choices ?? null;
  const replaces = opening?.held.replaces ?? null;
  const picked = raisedForMember(team, id) ?? LOAN_UNPICKED_VALUE;
  const enteredFrom = raisedForMember(from, id) ?? NO_TEXT;
  const enteredTo = raisedForMember(to, id) ?? NO_TEXT;
  const removing = replaces !== null && raisedForMember(removal, id) === true;
  const refusal = raisedForMember(failure, id);
  const invalidField = refusal === null ? null : loanFieldOf(refusal);
  // ONE EDIT, the fields as typed (or the removal): the preview and the block follow it.
  const edit = useMemo((): LoanEdit | null => {
    if (opening === null) return null;
    if (removing && replaces !== null) return { memberId: id, replaces, span: null };

    const span = enteredSpanOf(id, choices, picked, enteredFrom, enteredTo);

    return span === null ? null : { memberId: id, replaces, span };
  }, [opening, removing, replaces, id, choices, picked, enteredFrom, enteredTo]);
  const preview = useMemo(() => shownLoanPreviewOf(calendarSnapshot, edit), [calendarSnapshot, edit]);
  // The organization's leave is observed only while an edit the dialog derives for is entered.
  const staffingLeave = useStaffingLeave(edit !== null && previewableSpanOf(loanEditWindowOf(edit)) ? calendarSnapshot : null);
  const shortStaffed = useMemo(
    () => shownLoanShortStaffedOf(calendarSnapshot, edit, staffingLeave),
    [calendarSnapshot, edit, staffingLeave],
  );

  // THE OFFER GONE ON A RE-READ (as the team dialog's `teamGone`): the member
  // went, every team to lend to went, or the amended loan is no longer live.
  // The dialog closes, its erasure dialog with it, and the card says the
  // record moved. Never while its write is pending.
  const loanGone = replaces !== null && calendarSnapshot !== null && !loans.some((listed) => listed.loan.id === replaces.id);
  const gone = opening !== null && (member === null || (replaces === null ? available === null : loanGone)) && !pending;

  useEffect(() => {
    if (!gone) return;
    setOpen(null);
    if (erasureDialog.current.shown !== null) erasureDialog.current.drop();
    setFailure({ member: id, raised: LOAN_STALE });
    setUnchecked(null);
    focusLanded();
  }, [gone, id]);

  /**
   * After a landed write, or a closed dialog: the opener, else the card. An
   * amend's row may be gone (its loan was replaced), so an amend falls back to
   * the card, never to *Posudi drugom timu*.
   */
  function focusLanded(): void {
    const amended = amendOpener.current;

    focusLater(amended === null ? [() => opener.current] : [() => (amended.isConnected ? amended : null)], byId(MEMBER_TEAM_HEADING_ID));
  }

  /** The field a refusal names, else the dialog's save. */
  function focusRefused(code: LoanRefusal): void {
    const field = loanFieldOf(code);
    const target =
      field === LOAN_FIELD_TEAM
        ? picker
        : field === LOAN_FIELD_FROM
          ? loanFromField
          : field === LOAN_FIELD_TO
            ? loanToField
            : field === LOAN_FIELD_REASON
              ? loanReasonField
              : saveButton;

    focusLater([() => target.current, () => saveButton.current], byId(MEMBER_TEAM_HEADING_ID));
  }

  /** Every opening starts with no refusal, notice or removal. */
  function resetOpening(): void {
    setFailure(null);
    setSaved(null);
    setErased(null);
    setUnchecked(null);
    setRemoval(null);
  }

  /** *Posudi drugom timu*: the dialog opens with no team, *Od* and *Do* today. */
  function openLoan(): void {
    if (loaning.current || member === null || available === null || today === null) return;

    resetOpening();
    amendOpener.current = null;
    setTeam(null);
    setFrom({ member: id, raised: today });
    setTo({ member: id, raised: today });
    openings.current += 1;
    setOpen({
      member: id,
      raised: {
        key: openings.current,
        held: {
          choices: available,
          name: member.name,
          current: memberTeamOf(member, today).team?.name ?? null,
          replaces: null,
          endsToday: false,
        },
      },
    });
  }

  /** *Izmijeni posudbu* (story 18.4): the same dialog, filled with the loan as it stands. */
  function openAmend(loan: Loan, button: HTMLButtonElement | null): void {
    if (loaning.current || member === null || today === null) return;

    const offered = loanAmendChoicesOf(member, activeTeams, today, loan);

    if (offered === null) return;

    resetOpening();
    amendOpener.current = button;
    setTeam({ member: id, raised: offered.some((choice) => choice.id === loan.teamId) ? loan.teamId : LOAN_UNPICKED_VALUE });
    setFrom({ member: id, raised: loan.from });
    setTo({ member: id, raised: loan.to });
    openings.current += 1;
    setOpen({
      member: id,
      raised: {
        key: openings.current,
        held: {
          choices: offered,
          name: member.name,
          current: memberTeamOf(member, today).team?.name ?? null,
          replaces: loan,
          endsToday: loanEndsTodayOfferedOf(loan, today),
        },
      },
    });
  }

  /** Cancel, the close button and Escape: never while a write is in flight. */
  function closeLoan(): void {
    if (loaning.current) return;

    setOpen(null);
    setFailure(null);
    setUnchecked(null);
    focusLanded();
  }

  function pickTeam(event: ChangeEvent<HTMLSelectElement>): void {
    setTeam({ member: id, raised: event.currentTarget.value });
  }

  function enterFrom(event: ChangeEvent<HTMLInputElement>): void {
    setFrom({ member: id, raised: event.currentTarget.value });
  }

  function enterTo(event: ChangeEvent<HTMLInputElement>): void {
    setTo({ member: id, raised: event.currentTarget.value });
  }

  /** *Završi danas*: *Do* becomes today, the loan's last day. */
  function endToday(): void {
    if (loaning.current || today === null) return;

    if (loanToField.current !== null) loanToField.current.value = today;
    setTo({ member: id, raised: today });
  }

  /** *Ukloni posudbu*: the preview and *Spremi* switch to the removal. */
  function toggleRemoval(checked: boolean): void {
    if (loaning.current) return;

    setFailure(null);
    setRemoval({ member: id, raised: checked });
  }

  /** A refusal said in the dialog, focus on what it names. */
  function refuse(memberId: string, code: LoanRefusal): void {
    setFailure({ member: memberId, raised: code });
    focusRefused(code);
  }

  /**
   * A write the fresh snapshot refuses: said, and the calendar, teams and
   * members read again (as the team move's `refuseTeamChecked`): a home-team
   * or stale refusal can come from a team move written meanwhile, and the
   * members list decides the offer and *sada u timu*.
   */
  async function refuseChecked(memberId: string, code: LoanSnapshotRefusal): Promise<void> {
    refuse(memberId, code);

    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
      for (const queryKey of LOAN_REFUSAL_REREADS) await queryClient.invalidateQueries({ queryKey });
    } catch (cause) {
      console.error(LOAN_UNAVAILABLE, cause);
    }
  }

  /** The write itself: 0062's insert, or one of 0064's two definers. */
  async function sent(lent: MemberListRow, write: LoanWrite): Promise<LoanWriteOutcome> {
    switch (write.kind) {
      case LOAN_LEND:
        return lendMember(supabaseClient().from(TEAM_LOANS_TABLE), lent.organizationId, write.draft);
      case LOAN_AMEND:
        return amendLoan(supabaseClient() as unknown as LoanRpc, write.loan.id, write.draft);
      case LOAN_REMOVE:
        return removeLoan(supabaseClient() as unknown as LoanRpc, write.loan.id);
    }
  }

  /** THE WRITE, under the in-flight ref its caller holds. A landed write closes the dialog. */
  async function writeLoan(lent: MemberListRow, write: LoanWrite, removed: number): Promise<void> {
    const outcome = await sent(lent, write);

    if (!outcome.ok) {
      refuse(lent.id, outcome.code);
    } else {
      setSaved({ member: lent.id, raised: write.kind });
      setErased({ member: lent.id, raised: removed });
      setOpen(null);
      focusLanded();
    }

    // A LANDED WRITE is re-read wherever a roster shows, and the leave and
    // resolutions its erasure check stands on; a refusal re-reads the calendar.
    try {
      await refreshAfterWrite(queryClient, CALENDAR_KEY, outcome.ok ? MEMBERSHIP_WRITE_DEPENDENTS : LOAN_REFUSAL_REREADS);
    } catch (cause) {
      console.error(LOAN_UNAVAILABLE, cause);
    }
  }

  /**
   * A LOAN NEVER QUIETLY ERASES A CONFLICT (AD-5): the three core reads,
   * fresh, the same "after", then the write at once, or the erasure
   * confirmation over the dialog. Unavailable: nothing written, a retry.
   * Refused: the dialog's own refusal.
   */
  async function guarded(lent: MemberListRow, write: LoanWrite): Promise<void> {
    if (loaning.current || !writesOnline()) return;

    loaning.current = true;
    setFailure(null);
    setSaved(null);
    setErased(null);
    setUnchecked(null);
    setPending(true);

    try {
      const check = await loanErasureCheckOf(readErasures.readAndShare, loanWriteEditOf(write), onlineManager.isOnline());

      if (check.kind === CHECK_UNAVAILABLE) {
        if (!writesOnline()) {
          focusLater([() => saveButton.current], () => saveButton.current);

          return;
        }
        setUnchecked({ member: lent.id, raised: true });
        focusLater([() => retryButton.current], () => saveButton.current);

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await refuseChecked(lent.id, check.code);

        return;
      }

      if (check.rows.length > 0) {
        erasures.show(check.rows, { member: lent.id, name: lent.name, write });

        return;
      }

      await writeLoan(lent, write, 0);
    } catch (cause) {
      console.error(LOAN_UNAVAILABLE, cause);
      refuse(lent.id, LOAN_FAILED);
    } finally {
      loaning.current = false;
      setPending(false);
    }
  }

  /** What *Spremi* would write, or the field's refusal: the lend's or the amend's preflight, or the removal. */
  function writeOf(lent: MemberListRow, held: HeldLoan): { ok: true; write: LoanWrite } | { ok: false; code: LoanRefusal } {
    if (held.replaces !== null && removing) return { ok: true, write: { kind: LOAN_REMOVE, memberId: lent.id, loan: held.replaces } };

    const entered = {
      teamId: picked,
      from: loanFromField.current?.value ?? enteredFrom,
      to: loanToField.current?.value ?? enteredTo,
      reason: loanReasonField.current?.value ?? NO_TEXT,
    };

    if (held.replaces !== null) {
      const amend = loanAmendPreflightOf(lent.id, held.choices, entered, held.replaces);

      return amend.ok ? { ok: true, write: { kind: LOAN_AMEND, loan: held.replaces, draft: amend.draft } } : amend;
    }

    const lend = loanPreflightOf(lent.id, held.choices, entered);

    return lend.ok ? { ok: true, write: { kind: LOAN_LEND, draft: lend.draft } } : lend;
  }

  /** *Spremi*: the preflight, then the check, then the write. No second confirm. */
  async function saveLoan(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    if (member === null || opening === null || loaning.current || !writesOnline()) return;

    setSaved(null);
    setErased(null);
    setUnchecked(null);

    const prepared = writeOf(member, opening.held);

    if (!prepared.ok) {
      refuse(member.id, prepared.code);

      return;
    }

    await guarded(member, prepared.write);
  }

  /**
   * The erasure confirmation's own save, once every row is confirmed: the
   * check derived again from fresh reads for the very write it was shown
   * for, judged against the screen as it is then (`latest`).
   */
  async function confirmErasures(shown: ShownErasures<CheckedLoan>): Promise<void> {
    if (loaning.current || !erasures.confirmed || !writesOnline()) return;

    const { member: memberId, write } = shown.subject;

    if (latest.current.member?.id !== memberId) {
      erasures.drop();

      return;
    }

    loaning.current = true;
    setPending(true);

    try {
      const check = await loanErasureCheckOf(readErasures.readAndShare, loanWriteEditOf(write), onlineManager.isOnline());
      const current = latest.current.member;

      if (current === null || current.id !== memberId) {
        erasures.drop();

        return;
      }

      await erasures.follow(shown, check, {
        unavailable: () => {
          if (!writesOnline()) {
            focusLater([() => erasuresSave.current], () => saveButton.current);

            return;
          }
          erasures.drop();
          setUnchecked({ member: memberId, raised: true });
          focusLater([() => retryButton.current], () => saveButton.current);
        },
        refused: async ({ code }) => {
          erasures.drop();
          await refuseChecked(memberId, code);
        },
        write: async ({ rows }) => {
          erasures.drop();
          await writeLoan(current, write, rows.length);
        },
      });
    } catch (cause) {
      console.error(LOAN_UNAVAILABLE, cause);
      erasures.drop();
      refuse(memberId, LOAN_FAILED);
    } finally {
      loaning.current = false;
      setPending(false);
    }
  }

  const savedKind = raisedForMember(saved, id);

  return {
    loanPending: pending,
    loanSaved: savedKind !== null,
    /** What landed: a lend, an amend or a removal, or `null`. */
    loanSavedKind: savedKind,
    /** The loan's refusal while no dialog says it: the dialog closed because the record moved. */
    loanCardRefusal: opening === null ? refusal : null,
    loanErased: raisedForMember(erased, id) ?? 0,
    loanErasures: erasures,
    confirmLoanErasures: confirmErasures,
    loanErasuresSave: erasuresSave,
    /** The member's live loans, by first date, each with *Izmijeni posudbu* (story 18.4). */
    memberLoans: loans,
    loanDialog: {
      /** The teams the card's button offers now, or `null` for no button. */
      available,
      /** What the open dialog was opened on, or `null`. */
      opening,
      /** Whether the open dialog removes its loan (*Ukloni posudbu*). */
      removing,
      refusal,
      invalidField,
      unchecked: raisedForMember(unchecked, id) !== null,
      picked,
      from: enteredFrom,
      to: enteredTo,
      preview,
      shortStaffed,
      opener,
      picker,
      loanFromField,
      loanToField,
      loanReasonField,
      saveButton,
      retryButton,
      open: openLoan,
      openAmend,
      close: closeLoan,
      pickTeam,
      enterFrom,
      enterTo,
      endToday,
      toggleRemoval,
      save: saveLoan,
      retry: () => {
        void saveLoan();
      },
    },
  };
}
