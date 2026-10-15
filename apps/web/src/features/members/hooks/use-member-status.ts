import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import {
  byId,
  type CheckedMemberChange,
  type DialogOpening,
  type HeldStatusChange,
  type MemberScreen,
} from '@/features/members/hooks/member-edit-context';
import { shownDeactivationConsequenceOf } from '@/features/members/services/deactivation-consequence';
import { MEMBERS_LIST_KEY, membersTodayOf, type MemberListRow } from '@/features/members/services/list';
import { memberErasureCheckOf, statusChangeOf } from '@/features/members/services/member-erasures';
import {
  MEMBER_STATUS_STALE,
  MEMBER_STATUS_TABLE,
  MEMBER_WRITE_UNAVAILABLE,
  WITHDRAW,
  changeMemberStatus,
  raisedForMember,
  standingConfirmation,
  statusBlockKey,
  statusOfferOf,
  statusPreflightOf,
  statusRefusalBeforeErasuresOf,
  statusStageOf,
  type RaisedForMember,
  type MemberWriteFailure,
  type MemberWriteRefusal,
  type StatusConfirmation,
  type StatusOffer,
  type StatusChangeOffer,
} from '@/features/members/services/write';
import { dateMarkFor, dateMarked, type DateMark } from '@/features/members/utils/date-refusal';
import { MEMBER_STATUS_HEADING_ID } from '@/features/members/utils/element-ids';
import { MEMBERSHIP_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { supabaseClient } from '@/lib/supabase/client';
import { firstEnabledOf, focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';

/**
 * The member page's status card (stories 1.6, 5.5e, 7.11, 7.13c; split out
 * of `useMemberEdit` by the epics 5–7 retro, A16): the status dialog — a
 * deactivation or reactivation from a date, with the deactivation's
 * consequence in numbers — the card's withdrawal of a scheduled change, and
 * the erasure guard over both, with its own in-flight ref, pending flag and
 * refusal. Every rule it applies is a pure function in
 * `@/features/members/services/write`.
 */
export function useMemberStatus(screen: MemberScreen) {
  const { id, openings, form, today, organizationMembers, callerAuthUserId, calendarSnapshot, latest, readErasures } =
    screen;
  const queryClient = useQueryClient();
  // THE STATUS BLOCK'S OWN STATE and its own in-flight ref.
  const statusing = useRef(false);
  const dateField = useRef<HTMLInputElement>(null);
  const statusOpener = useRef<HTMLButtonElement>(null);
  const statusWithdrawButton = useRef<HTMLButtonElement>(null);
  const statusSaveButton = useRef<HTMLButtonElement>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [statusOpen, setStatusOpen] = useState<RaisedForMember<DialogOpening<HeldStatusChange>> | null>(
    null,
  );
  /** The date the status dialog holds, so its question names it as it is typed. Keyed to the member. */
  const [statusDay, setStatusDay] = useState<RaisedForMember<string> | null>(null);
  /** The armed WITHDRAWAL of a scheduled change, carrying the name and the
   *  date it is about, so what is confirmed is exactly what is sent. */
  const [statusArmed, setStatusArmed] = useState<RaisedForMember<StatusConfirmation> | null>(
    null,
  );
  /** That a status change landed. Keyed to the member it confirms. */
  const [statusSaved, setStatusSaved] = useState<RaisedForMember<true> | null>(null);
  /** Why the last status change did not land. Keyed to the member. */
  const [statusFailure, setStatusFailure] =
    useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  /** The date the last status refusal named, if it named one. */
  const [statusDateMark, setStatusDateMark] = useState<DateMark | null>(null);
  // THE ERASURE GUARD (story 5.5e), as the team card's.
  const statusRetryButton = useRef<HTMLButtonElement>(null);
  const [statusUnchecked, setStatusUnchecked] = useState<RaisedForMember<true> | null>(null);
  const [statusErased, setStatusErased] = useState<RaisedForMember<number> | null>(null);
  const statusErasures = useErasureConfirmation<CheckedMemberChange<StatusConfirmation>>(statusPending, () =>
    firstEnabledOf<HTMLElement>(
      () => statusSaveButton.current,
      () => statusWithdrawButton.current,
      () => statusOpener.current,
    ),
  );

  // The erasure confirmation as last drawn, for the effect below.
  const erasureDialog = useRef(statusErasures);

  useEffect(() => {
    erasureDialog.current = statusErasures;
  });

  // ANOTHER MEMBER, or none: as the team card's.
  useEffect(() => {
    const status = erasureDialog.current;

    if (status.shown !== null && status.shown.subject.member !== id) status.drop();
    setStatusOpen(null);
    setStatusDay(null);
  }, [id]);

  // CLEARED BY A REFETCH THAT CHANGES THIS MEMBER'S VERSIONS: a confirmation
  // armed against one history is not confirmed against another.
  const statusArmedFor = standingConfirmation(
    raisedForMember(statusArmed, id),
    form.member,
    statusPending,
  );
  const statusConfirmed = raisedForMember(statusSaved, id) !== null;
  const statusRefusal = raisedForMember(statusFailure, id);
  // THE DATE IS MARKED INVALID only while the refusal that named it stands, on
  // the history it was named on, as the leave field is through `invalidField`.
  const statusDateInvalid = dateMarked(
    statusDateMark,
    statusRefusal,
    form.member === null ? null : statusBlockKey(form.member),
  );
  const statusStage = statusStageOf(statusArmedFor !== null, statusPending);
  const offer = form.member === null ? null : statusOfferOf(form.member, callerAuthUserId, today);
  /** The status dialog's offer: a deactivation or a reactivation from a date. */
  const statusOffer: StatusChangeOffer | null = offer !== null && offer.change !== WITHDRAW ? offer : null;
  const statusOpening = raisedForMember(statusOpen, id);
  // STILL OFFERED ONLY AS THE CHANGE IT WAS OPENED FOR: a re-read that offers
  // another change closes it rather than relabelling it under the admin's hand.
  const statusStillOffered =
    statusOpening !== null && statusOffer !== null && statusOffer.change === statusOpening.held.offer.change;
  // AN OUTSTANDING WRITE OUTLIVES ITS OFFER: the dialog stays, busy, until it settles.
  const statusDialogOpen = statusOpening !== null && (statusStillOffered || statusPending);
  const statusDayEntered = raisedForMember(statusDay, id) ?? NO_TEXT;
  // THE DEACTIVATION'S CONSEQUENCE IN NUMBERS (story 7.13c), from the calendar
  // snapshot the member page already reads under its one key and arguments
  // (the leave card's, `@/features/leave/hooks/use-member-leave`): no request
  // of its own, and nothing optimistic. `null` — a reactivation, a date before
  // the offer's minimum, no team — asks the question alone, and never gates
  // the save.
  //
  // HELD FOR THE OPENING (the Dialog rule: a re-read never redraws an open
  // dialog): the first snapshot seen while this opening is open, kept until it
  // closes — so the line stands through a refetch, while the write is pending
  // and after it lands, and a fresh opening reads afresh.
  const statusOpeningKey = statusDialogOpen ? statusOpening.key : null;
  const [heldCalendar, setHeldCalendar] = useState<{ readonly key: number; readonly snapshot: CalendarSnapshot } | null>(
    null,
  );

  if (statusOpeningKey === null) {
    if (heldCalendar !== null) setHeldCalendar(null);
  } else if (calendarSnapshot !== null && (heldCalendar === null || heldCalendar.key !== statusOpeningKey)) {
    setHeldCalendar({ key: statusOpeningKey, snapshot: calendarSnapshot });
  }

  const statusCalendar =
    heldCalendar !== null && heldCalendar.key === statusOpeningKey ? heldCalendar.snapshot : null;
  const statusDialogOffer = statusDialogOpen ? statusOpening.held.offer : null;
  const consequence = useMemo(
    () => shownDeactivationConsequenceOf(statusCalendar, id, statusDialogOffer, statusDayEntered, today),
    [statusCalendar, id, statusDialogOffer, statusDayEntered, today],
  );

  // THE DIALOG'S OFFER GONE ON A RE-READ (story 7.11): the change it was
  // opened for is no longer offered — another admin scheduled one. It closes,
  // its erasure dialog with it, and the card says the record moved, as the
  // team card's does. Never while its own write is pending.
  const statusGone = statusOpening !== null && !statusStillOffered && !statusPending;

  useEffect(() => {
    if (!statusGone) return;
    setStatusOpen(null);
    if (erasureDialog.current.shown !== null) erasureDialog.current.drop();
    setStatusFailure({ member: id, raised: { code: MEMBER_STATUS_STALE, saved: false } });
    setStatusDateMark(null);
    focusStatusLanded();
  }, [statusGone, id]);

  /** After a landed status write, or a dialog that closed by itself: the opener, the withdrawal, or the card. */
  function focusStatusLanded(): void {
    focusLater([() => statusOpener.current, () => statusWithdrawButton.current], byId(MEMBER_STATUS_HEADING_ID));
  }

  /** `Deaktiviraj` / `Ponovno aktiviraj`: the status dialog opens on the earliest date it admits. */
  function openStatus(): void {
    const member = form.member;

    if (statusing.current || statusOffer === null || member === null) return;

    setStatusFailure(null);
    setStatusSaved(null);
    setStatusErased(null);
    setStatusUnchecked(null);
    setStatusDateMark(null);
    setStatusDay({ member: id, raised: statusOffer.minimum });
    openings.current += 1;
    setStatusOpen({ member: id, raised: { key: openings.current, held: { offer: statusOffer, name: member.name } } });
  }

  /** The status dialog's cancel, close button and Escape: never while a write is in flight. */
  function closeStatus(): void {
    if (statusing.current) return;

    setStatusOpen(null);
    setStatusFailure(null);
    setStatusUnchecked(null);
    focusStatusLanded();
  }

  /** The status dialog's date as it is typed, so its question names it. */
  function enterStatusDay(event: ChangeEvent<HTMLInputElement>): void {
    setStatusDay({ member: id, raised: event.currentTarget.value });
  }

  /**
   * The confirmation the status dialog's date — or the card's withdrawal —
   * earns, or `null`, with the refusal it already earns said and the date
   * focused. Nothing is sent from here. A withdrawal is ARMED, for its
   * confirmation; a dialog's change goes straight on from its one button.
   */
  function armStatus(member: MemberListRow, offered: StatusOffer): StatusConfirmation | null {
    if (callerAuthUserId === null) return null;

    const field = dateField.current;
    // A CANCELLATION NAMES THE SCHEDULED VERSION'S DATE; the other two name
    // the entered one.
    const day = offered.change === WITHDRAW ? offered.scheduled.effectiveFrom : field?.value;

    if (day === undefined) return null;

    // THE ORGANIZATION'S TODAY AS AT SUBMIT, as the rotation builder takes
    // it: a screen left open across its midnight drew yesterday's minimum.
    const refusal = statusPreflightOf(offered.change, day, {
      member,
      members: organizationMembers,
      callerAuthUserId,
      today: membersTodayOf(organizationMembers, new Date()) ?? offered.today,
    });

    setStatusSaved(null);
    setStatusErased(null);
    setStatusUnchecked(null);

    if (refusal !== null) {
      // FOCUS MOVES TO THE DATE, which the dialog's own alert names; that
      // alert is what the field's `aria-describedby` points at.
      const raised = { code: refusal, saved: false };

      setStatusFailure({ member: member.id, raised });
      setStatusDateMark(dateMarkFor(raised, statusBlockKey(member), true));
      field?.focus();

      return null;
    }

    setStatusFailure(null);

    const confirmation: StatusConfirmation = {
      name: member.name,
      change: offered.change,
      day,
      history: statusBlockKey(member),
    };

    if (offered.change === WITHDRAW) setStatusArmed({ member: member.id, raised: confirmation });

    return confirmation;
  }

  /**
   * THE STATUS WRITE ITSELF (story 5.5e: split out of `changeStatus`, which
   * the erasure dialog's save shares), under the in-flight ref its caller
   * already holds: exactly what `confirmation` names. `erased` is how many
   * conflicts the admin confirmed it removes; 0 for none. A landed write
   * closes the status dialog.
   */
  async function writeStatus(
    member: MemberListRow,
    confirmation: StatusConfirmation,
    members: readonly MemberListRow[],
    caller: string,
    on: string,
    erased: number,
  ): Promise<void> {
    const outcome = await changeMemberStatus(
      supabaseClient().from(MEMBER_STATUS_TABLE),
      confirmation.change,
      confirmation.day,
      { member, members, callerAuthUserId: caller, today: on },
    );

    if (!outcome.ok) {
      setStatusFailure({ member: member.id, raised: outcome.refusal });
      setStatusDateMark(dateMarkFor(outcome.refusal, statusBlockKey(member), false));
    } else {
      setStatusSaved({ member: member.id, raised: true });
      setStatusErased({ member: member.id, raised: erased });
      setStatusOpen(null);
      focusStatusLanded();
    }

    // THE LIST CARRIES THE VERSIONS, so the marker, the status line and the
    // next offer all move with it — and it is refetched on a REFUSAL too,
    // because the likeliest reason for one is a list behind the database
    // (`MEMBER_STATUS_STALE`). A LANDED CHANGE is re-read wherever it shows,
    // as a move is.
    try {
      await refreshAfterWrite(
        queryClient,
        MEMBERS_LIST_KEY,
        outcome.ok ? MEMBERSHIP_WRITE_DEPENDENTS : NO_DEPENDENTS,
      );
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Send a status change — the dialog's deactivation or reactivation, or the
   * card's confirmed withdrawal.
   *
   * A CHANGE NEVER QUIETLY ERASES A CONFLICT (story 5.5e): a deactivation,
   * and the withdrawal of a scheduled reactivation, are checked first exactly
   * as a team move is (see `changeTeam`). A reactivation, and the withdrawal
   * of a scheduled deactivation, only add, and run no check.
   */
  async function changeStatus(member: MemberListRow, confirmation: StatusConfirmation): Promise<void> {
    if (callerAuthUserId === null || today === null || statusing.current) return;

    // Disarmed when this settles, except while it asks for a retry.
    let disarm = true;

    statusing.current = true;
    setStatusFailure(null);
    setStatusSaved(null);
    setStatusErased(null);
    setStatusUnchecked(null);
    setStatusPending(true);

    // Taken again at submit, as `armStatus` does.
    const on = membersTodayOf(organizationMembers, new Date()) ?? today;

    try {
      const change = statusChangeOf(member.id, confirmation);

      if (change !== null) {
        const check = await memberErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());

        if (check.kind === CHECK_UNAVAILABLE) {
          disarm = false;
          setStatusUnchecked({ member: member.id, raised: true });
          focusLater([() => statusRetryButton.current], () =>
            firstEnabledOf<HTMLElement>(() => statusSaveButton.current, () => statusWithdrawButton.current),
          );

          return;
        }

        // REFUSED ANYWAY: the card's own refusal, said here, and nothing sent.
        if (check.kind === CHECK_REFUSED) {
          await refuseStatusChecked(member, check.code);

          return;
        }

        if (check.rows.length > 0) {
          // THE LAST-ADMIN RULE BEFORE THE DIALOG: otherwise the admin decides
          // every row and only then meets the refusal.
          const refused = statusRefusalBeforeErasuresOf(confirmation.change, confirmation.day, {
            member,
            members: organizationMembers,
            callerAuthUserId,
            today: on,
          });

          if (refused !== null) {
            await refuseStatusChecked(member, refused);

            return;
          }

          statusErasures.show(check.rows, { member: member.id, confirmation, change });

          return;
        }
      }

      await writeStatus(member, confirmation, organizationMembers, callerAuthUserId, on, 0);
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setStatusFailure({
        member: member.id,
        raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
      });
    } finally {
      // On EVERY path. Disarmed here and NOT before the await: the confirmation
      // carries the busy state, so it has to outlive the request it started.
      statusing.current = false;
      setStatusPending(false);
      if (disarm) setStatusArmed(null);
    }
  }

  /**
   * The status dialog's final button (story 7.11), labelled with its action:
   * the same preflight, then the erasure check, then the write.
   */
  async function saveStatus(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    const member = form.member;

    if (member === null || statusOffer === null || !statusStillOffered || statusing.current) return;

    const confirmation = armStatus(member, statusOffer);

    if (confirmation !== null) await changeStatus(member, confirmation);
  }

  /** The withdrawal confirmation's confirm: sends what it names. */
  function confirmStatus(): void {
    const member = form.member;

    if (member !== null && statusArmedFor !== null) void changeStatus(member, statusArmedFor);
  }

  /** "Pokušaj ponovno": the same status change, asked again from where it was made. */
  function retryStatus(): void {
    if (statusDialogOpen) void saveStatus();
    else confirmStatus();
  }

  /** Focus after a status change was refused once its erasure dialog closed: the dialog's date, else the card. */
  function focusStatusRefused(): void {
    focusLater(
      [() => dateField.current, () => statusWithdrawButton.current, () => statusOpener.current],
      byId(MEMBER_STATUS_HEADING_ID),
    );
  }

  /**
   * A status change the database would refuse anyway, as the erasure check
   * found it (story 5.5e), or the last-admin rule before its dialog:
   * `refuseTeamChecked`'s twin.
   */
  async function refuseStatusChecked(member: MemberListRow, code: MemberWriteFailure): Promise<void> {
    const refusal = { code, saved: false };

    setStatusFailure({ member: member.id, raised: refusal });
    setStatusDateMark(dateMarkFor(refusal, statusBlockKey(member), false));
    focusStatusRefused();

    try {
      await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * The status erasure dialog's own save, once every row is confirmed (story
   * 5.5e): `confirmTeamErasures`'s twin.
   */
  async function confirmStatusErasures(
    shown: ShownErasures<CheckedMemberChange<StatusConfirmation>>,
  ): Promise<void> {
    if (statusing.current || !statusErasures.confirmed) return;

    const { member: memberId, confirmation, change } = shown.subject;
    const before = latest.current;

    if (before.member === null || before.member.id !== memberId) {
      statusErasures.drop();

      return;
    }

    statusing.current = true;
    setStatusPending(true);

    try {
      const check = await memberErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());
      const { member: current, members, caller } = latest.current;
      // The organization's today as at this save, not as last drawn.
      const on = membersTodayOf(members, new Date());

      if (current === null || current.id !== memberId) {
        statusErasures.drop();

        return;
      }

      await statusErasures.follow(shown, check, {
        stopped: () => {
          if (statusBlockKey(current) === confirmation.history) return false;

          statusErasures.drop();
          setStatusFailure({ member: memberId, raised: { code: MEMBER_STATUS_STALE, saved: false } });
          focusStatusRefused();

          return true;
        },
        unavailable: () => {
          statusErasures.drop();
          // A WITHDRAWAL'S CONFIRMATION, armed again, refuses with the retry; a
          // dialog's change is still open beneath and says it there.
          if (confirmation.change === WITHDRAW) setStatusArmed({ member: memberId, raised: confirmation });
          setStatusUnchecked({ member: memberId, raised: true });
          focusLater([() => statusRetryButton.current], () =>
            firstEnabledOf<HTMLElement>(() => statusSaveButton.current, () => statusWithdrawButton.current),
          );
        },
        refused: async ({ code }) => {
          statusErasures.drop();
          await refuseStatusChecked(current, code);
        },
        write: async ({ rows }) => {
          statusErasures.drop();

          if (caller === null || on === null) {
            setStatusFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
            focusStatusRefused();

            return;
          }

          await writeStatus(current, confirmation, members, caller, on, rows.length);
        },
      });
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      statusErasures.drop();
      setStatusFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
      focusStatusRefused();
    } finally {
      statusing.current = false;
      setStatusPending(false);
    }
  }

  return {
    dateField,
    offer,
    statusArmedFor,
    statusConfirmed,
    statusRefusal,
    statusDateInvalid,
    statusStage,
    statusPending,
    setStatusArmed,
    armStatus,
    confirmStatus,
    statusRetryButton,
    retryStatus,
    statusUnchecked: raisedForMember(statusUnchecked, id) !== null,
    statusErased: raisedForMember(statusErased, id) ?? 0,
    statusErasures,
    confirmStatusErasures,
    statusDialog: {
      /** What the card's header offers now. */
      available: statusOffer,
      /** What the open dialog was opened on: it draws from this. */
      opening: statusDialogOpen ? statusOpening : null,
      opener: statusOpener,
      withdrawButton: statusWithdrawButton,
      saveButton: statusSaveButton,
      day: statusDayEntered,
      /** A deactivation's consequence in numbers on the entered day, or `null` (story 7.13c). */
      consequence,
      enterDay: enterStatusDay,
      open: openStatus,
      close: closeStatus,
      save: saveStatus,
    },
  };
}
