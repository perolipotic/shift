import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { byId, type DialogOpening, type MemberScreen } from '@/features/members/hooks/member-edit-context';
import { MEMBERS_LIST_KEY, memberTeamOf, type MemberListRow } from '@/features/members/services/list';
import {
  LOAN_FAILED,
  LOAN_FIELD_FROM,
  LOAN_FIELD_REASON,
  LOAN_FIELD_TEAM,
  LOAN_FIELD_TO,
  LOAN_STALE,
  LOAN_UNAVAILABLE,
  LOAN_UNPICKED_VALUE,
  TEAM_LOANS_TABLE,
  enteredSpanOf,
  lendMember,
  loanChoicesOf,
  loanErasureCheckOf,
  loanFieldOf,
  loanPreflightOf,
  previewableSpanOf,
  shownLoanPreviewOf,
  shownLoanShortStaffedOf,
  type LoanChoice,
  type LoanDraft,
  type LoanRefusal,
  type LoanSnapshotRefusal,
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

/** What the loan dialog was opened on: the teams offered then, and who. */
export interface HeldLoan {
  readonly choices: readonly LoanChoice[];
  readonly name: string;
  /** The member's team today, by name, or `null` for none. */
  readonly current: string | null;
}

/**
 * What a refused insert re-reads beside the calendar: the teams and the
 * members, because a 42501 may be a team archived or a move written meanwhile
 * (0062's policy), as a refused team change re-reads them.
 */
const LOAN_REFUSAL_REREADS = [TEAMS_LIST_KEY, MEMBERS_LIST_KEY] as const;

/** What the loan's erasure check stood on: the member and the draft. */
export interface CheckedLoan {
  readonly member: string;
  readonly name: string;
  readonly draft: LoanDraft;
}

/**
 * *Posudi drugom timu* (story 18.3; UX-DR58): the member page's loan dialog
 * — team, *Od*, *Do*, *Razlog*, *Što se mijenja* and one *Spremi* — built as
 * the team dialog is (`useMemberTeam`): its own in-flight ref, pending flag
 * and refusal, every piece raised for its member (`raisedForMember`), the
 * shared erasure confirmation, the offline gate (`writesOnline`), and a
 * landed write re-reading the calendar and its dependents. Every rule is a
 * pure function in `@/features/members/services/loan`.
 */
export function useMemberLoan(screen: MemberScreen) {
  const { id, openings, form, today, activeTeams, calendarSnapshot, latest, readErasures } = screen;
  const queryClient = useQueryClient();
  const loaning = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
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
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RaisedForMember<LoanRefusal> | null>(null);
  const [saved, setSaved] = useState<RaisedForMember<true> | null>(null);
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
  const opening = raisedForMember(open, id);
  const choices = opening?.held.choices ?? null;
  const picked = raisedForMember(team, id) ?? LOAN_UNPICKED_VALUE;
  const enteredFrom = raisedForMember(from, id) ?? NO_TEXT;
  const enteredTo = raisedForMember(to, id) ?? NO_TEXT;
  const refusal = raisedForMember(failure, id);
  const invalidField = refusal === null ? null : loanFieldOf(refusal);
  // ONE SPAN, the fields as typed: the preview and the block follow it.
  const span = useMemo(
    () => (opening === null ? null : enteredSpanOf(id, choices, picked, enteredFrom, enteredTo)),
    [opening, id, choices, picked, enteredFrom, enteredTo],
  );
  const preview = useMemo(() => shownLoanPreviewOf(calendarSnapshot, span), [calendarSnapshot, span]);
  // The organization's leave is observed only while a span the dialog derives for is entered.
  const staffingLeave = useStaffingLeave(previewableSpanOf(span) ? calendarSnapshot : null);
  const shortStaffed = useMemo(
    () => shownLoanShortStaffedOf(calendarSnapshot, span, staffingLeave),
    [calendarSnapshot, span, staffingLeave],
  );

  // THE OFFER GONE ON A RE-READ (as the team dialog's `teamGone`): the member
  // or every team to lend to went. The dialog closes, its erasure dialog with
  // it, and the card says the record moved. Never while its write is pending.
  const gone = opening !== null && (member === null || available === null) && !pending;

  useEffect(() => {
    if (!gone) return;
    setOpen(null);
    if (erasureDialog.current.shown !== null) erasureDialog.current.drop();
    setFailure({ member: id, raised: LOAN_STALE });
    setUnchecked(null);
    focusLanded();
  }, [gone, id]);

  /** After a landed loan, or a closed dialog: the opener, else the card. */
  function focusLanded(): void {
    focusLater([() => opener.current], byId(MEMBER_TEAM_HEADING_ID));
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

  /** *Posudi drugom timu*: the dialog opens with no team, *Od* and *Do* today. */
  function openLoan(): void {
    if (loaning.current || member === null || available === null || today === null) return;

    setFailure(null);
    setSaved(null);
    setErased(null);
    setUnchecked(null);
    setTeam(null);
    setFrom({ member: id, raised: today });
    setTo({ member: id, raised: today });
    openings.current += 1;
    setOpen({
      member: id,
      raised: {
        key: openings.current,
        held: { choices: available, name: member.name, current: memberTeamOf(member, today).team?.name ?? null },
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

  /** A refusal said in the dialog, focus on what it names. */
  function refuse(memberId: string, code: LoanRefusal): void {
    setFailure({ member: memberId, raised: code });
    focusRefused(code);
  }

  /** A loan the fresh snapshot refuses: said, and the calendar and teams read again. */
  async function refuseChecked(memberId: string, code: LoanSnapshotRefusal): Promise<void> {
    refuse(memberId, code);

    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
      await queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
    } catch (cause) {
      console.error(LOAN_UNAVAILABLE, cause);
    }
  }

  /** THE WRITE, under the in-flight ref its caller holds. A landed loan closes the dialog. */
  async function writeLoan(lent: MemberListRow, draft: LoanDraft, removed: number): Promise<void> {
    const outcome = await lendMember(supabaseClient().from(TEAM_LOANS_TABLE), lent.organizationId, draft);

    if (!outcome.ok) {
      refuse(lent.id, outcome.code);
    } else {
      setSaved({ member: lent.id, raised: true });
      setErased({ member: lent.id, raised: removed });
      setOpen(null);
      focusLanded();
    }

    // A LANDED LOAN is re-read wherever a roster shows, and the leave and
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
  async function lend(lent: MemberListRow, draft: LoanDraft): Promise<void> {
    if (loaning.current || !writesOnline()) return;

    loaning.current = true;
    setFailure(null);
    setSaved(null);
    setErased(null);
    setUnchecked(null);
    setPending(true);

    try {
      const check = await loanErasureCheckOf(readErasures.readAndShare, draft, onlineManager.isOnline());

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
        erasures.show(check.rows, { member: lent.id, name: lent.name, draft });

        return;
      }

      await writeLoan(lent, draft, 0);
    } catch (cause) {
      console.error(LOAN_UNAVAILABLE, cause);
      refuse(lent.id, LOAN_FAILED);
    } finally {
      loaning.current = false;
      setPending(false);
    }
  }

  /** *Spremi*: the preflight, then the check, then the write. No second confirm. */
  async function saveLoan(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    if (member === null || opening === null || loaning.current || !writesOnline()) return;

    setSaved(null);
    setErased(null);
    setUnchecked(null);

    const preflight = loanPreflightOf(member.id, opening.held.choices, {
      teamId: picked,
      from: loanFromField.current?.value ?? enteredFrom,
      to: loanToField.current?.value ?? enteredTo,
      reason: loanReasonField.current?.value ?? NO_TEXT,
    });

    if (!preflight.ok) {
      refuse(member.id, preflight.code);

      return;
    }

    await lend(member, preflight.draft);
  }

  /**
   * The erasure confirmation's own save, once every row is confirmed: the
   * check derived again from fresh reads for the very draft it was shown
   * for, judged against the screen as it is then (`latest`).
   */
  async function confirmErasures(shown: ShownErasures<CheckedLoan>): Promise<void> {
    if (loaning.current || !erasures.confirmed || !writesOnline()) return;

    const { member: memberId, draft } = shown.subject;

    if (latest.current.member?.id !== memberId) {
      erasures.drop();

      return;
    }

    loaning.current = true;
    setPending(true);

    try {
      const check = await loanErasureCheckOf(readErasures.readAndShare, draft, onlineManager.isOnline());
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
          await writeLoan(current, draft, rows.length);
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

  return {
    loanPending: pending,
    loanSaved: raisedForMember(saved, id) !== null,
    /** The loan's refusal while no dialog says it: the dialog closed because the record moved. */
    loanCardRefusal: opening === null ? refusal : null,
    loanErased: raisedForMember(erased, id) ?? 0,
    loanErasures: erasures,
    confirmLoanErasures: confirmErasures,
    loanErasuresSave: erasuresSave,
    loanDialog: {
      /** The teams the card's button offers now, or `null` for no button. */
      available,
      /** What the open dialog was opened on, or `null`. */
      opening,
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
      close: closeLoan,
      pickTeam,
      enterFrom,
      enterTo,
      save: saveLoan,
      retry: () => {
        void saveLoan();
      },
    },
  };
}
