import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import {
  LEAVE_RECORDS_KEY,
  leaveRecordsAfterWriteOf,
  leaveRecordsQueryOptions,
  leaveRecordsStateOf,
  type LeaveRecord,
  type LeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import {
  LEAVE_AMEND_ACTION,
  LEAVE_FROM_FIELD,
  LEAVE_NO_DATE,
  LEAVE_PREVIEW_REASON,
  LEAVE_READY,
  LEAVE_RECORD_ACTION,
  LEAVE_REMOVE_ACTION,
  leaveAmendedOf,
  leaveConflictOf,
  leaveFormFailureOf,
  leaveHandoffKeyOf,
  leaveHandoffOpeningOf,
  leaveInvalidFieldOf,
  leavePreviewStateOf,
  leaveSavedOf,
  memberLeaveBaseOf,
  withoutLeaveHandoffOpening,
  type LeaveFailure,
  type LeaveField,
  type LeaveHandoff,
  type LeaveRecordRow,
  type LeaveSaved,
} from '@/features/leave/services/leave-section';
import {
  LEAVE_FAILED,
  LEAVE_GONE,
  LEAVE_RECORDS_TABLE,
  amendLeave,
  recordLeave,
  removeLeave,
  type LeaveRecordRpc,
  type LeaveTable,
} from '@/features/leave/services/leave-write';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  membersQueryOptions,
  membersSurfaceStateOf,
} from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { LEAVE_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * The member page's leave card: its four reads, the entered range and the one
 * write (story 5.1c). Wiring only — every decision is a pure function in
 * `@/features/leave/services/leave-section`, which the node suite executes.
 *
 * THE READS, each under its own key and shared with the screens that own it
 * (AD-13): the member list (the allowance), the organization snapshot (the
 * leave year), the calendar snapshot (the schedule and today) and the
 * member's live leave records.
 *
 * THE FIELDS ARE UNCONTROLLED, so a refused save keeps every entered value;
 * their values are mirrored into state — on mount too, for a value the
 * browser restored or autofilled — only so the preview can follow them. The
 * whole form is disabled while a save is outstanding, so nothing typed after
 * the press can be lost to the reset that follows a landed save.
 *
 * THE WRITE has its own in-flight ref, pending flag and failure. After any
 * outcome the records are re-read, and the leave write's declared dependents
 * with them when it landed; a landed save's line is computed from what that
 * re-read answered, never from the records held before it. No figure is
 * optimistic, and no preview is drawn while a re-read is under way.
 *
 * AMEND AND REMOVE (story 5.2b). `startAmend` puts the one od–do form into
 * amend mode for one record — prefilled with its range, previewed without it —
 * and `amend` sends it through `amendLeave`; `cancelAmend` returns the form to
 * a new record. `openRemove` arms one confirmation for one record, and
 * `remove` sends it through `removeLeave`. Each write has its own in-flight
 * ref and pending flag, and after every outcome the records and the leave
 * write's dependents are re-read: an amend that failed may still have landed
 * (`amendLeave`'s doc). A record found gone closes amend mode or the
 * confirmation, and the list says so over the records it re-read.
 *
 * THE HAND-OFF FROM A CONFLICT (story 5.4d). Reached from a resolution
 * screen's third card, the card opens ONCE, after its rows are first ready:
 * amend mode for the record with the computed range in the fields and the od
 * field focused, or that record's removal confirmation — by the rule applied
 * to the record as it is now. A record already gone, or no longer covering
 * the conflict's date, opens nothing, and the card stays as it was. Either
 * way the history entry is then replaced without the opening, so a reload or
 * Back never reopens it; the origin stays, for "Natrag na konflikte". Nothing
 * is written here until the admin saves; cancelling leaves the conflict open.
 *
 * The component is keyed by the member, so nothing raised here outlives the
 * member it was raised about.
 */
export function useMemberLeave(memberId: string, handoff: LeaveHandoff | null = null) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const formField = useRef<HTMLFormElement>(null);
  const fromField = useRef<HTMLInputElement>(null);
  const toField = useRef<HTMLInputElement>(null);
  /** The alert or status line the last save raised: `Notice` renders a `<p>`. */
  const noticeField = useRef<HTMLParagraphElement>(null);
  /** What the list says after an amend or a removal: the removed line, or that the record is gone. */
  const listNoticeField = useRef<HTMLParagraphElement>(null);
  /** The removal confirmation's cancel, which a refused removal focuses. */
  const removeCancel = useRef<HTMLButtonElement>(null);
  /** The list's heading, where focus lands when nothing nearer is left to take it. */
  const listHeading = useRef<HTMLHeadingElement>(null);
  /** The Izmijeni that opened amend mode, which a cancel returns focus to. */
  const amendReturn = useRef<HTMLButtonElement | null>(null);
  /** The Ukloni that opened the confirmation, which a cancel returns focus to. */
  const removeReturn = useRef<HTMLButtonElement | null>(null);
  // A REF as well as state: state drives the disabled form, and state is
  // stale inside a handler already called once this tick.
  const recording = useRef(false);
  const amending = useRef(false);
  const removing = useRef(false);
  const [recordPending, setRecordPending] = useState(false);
  const [amendPending, setAmendPending] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  /** The record the form amends, or null for a new record. One at a time. */
  const [amendTarget, setAmendTarget] = useState<LeaveRecord | null>(null);
  /** The row whose removal is being confirmed, or null. */
  const [confirming, setConfirming] = useState<LeaveRecordRow | null>(null);
  const [removeFailure, setRemoveFailure] = useState<LeaveFailure | null>(null);
  /** The row a landed removal took away, for the list's status line. */
  const [leaveRemoved, setLeaveRemoved] = useState<LeaveRecordRow | null>(null);
  /** What a landed amend cost, for the form's status line. */
  const [leaveAmended, setLeaveAmended] = useState<LeaveSaved | null>(null);
  const [from, setFrom] = useState(LEAVE_NO_DATE);
  const [to, setTo] = useState(LEAVE_NO_DATE);
  const [leaveFailure, setLeaveFailure] = useState<LeaveFailure | null>(null);
  const [leaveSaved, setLeaveSaved] = useState<LeaveSaved | null>(null);
  /** The field a save refused before any request named, until it is edited. */
  const [refusedField, setRefusedField] = useState<LeaveField | null>(null);
  /** The hand-off already looked at once the rows were ready, by its identity: each opens once. */
  const handedOff = useRef<string | null>(null);

  const members = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  const organization = useQuery(
    organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)),
  );
  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const records = useQuery(
    leaveRecordsQueryOptions(
      // Named structurally, as the calendar's `rpc` is: checking supabase-js's
      // builder against the interface instantiates too deep for the compiler.
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as LeaveRecordsTable,
      memberId,
    ),
  );

  // A VALUE ALREADY IN A FIELD when it mounts — restored by the browser on
  // back-navigation, or autofilled — is previewed like a typed one.
  useEffect(() => {
    setFrom(fromField.current?.value ?? LEAVE_NO_DATE);
    setTo(toField.current?.value ?? LEAVE_NO_DATE);
  }, []);

  const recordsState = leaveRecordsStateOf(records);
  const base = memberLeaveBaseOf(
    {
      members: membersSurfaceStateOf(members),
      calendar: calendarSurfaceStateOf(calendar),
      organization,
      records: recordsState,
    },
    memberId,
    new Date(),
  );
  // NO PREVIEW WHILE THE RECORDS ARE BEING RE-READ: what they cost may be about to change.
  const preview =
    base.kind === LEAVE_READY && !recordsState.refreshing
      ? leavePreviewStateOf(base.input, from, to, amendTarget)
      : null;
  const invalidField = leaveInvalidFieldOf(leaveFormFailureOf(leaveFailure), refusedField);
  /** Any leave write outstanding: every leave control waits for it. */
  const writePending = recordPending || amendPending || removePending;
  const formDisabled = base.kind !== LEAVE_READY || writePending || recordsState.refreshing;
  /** The live records' ids, or null while the card is not ready. */
  const liveIds = base.kind === LEAVE_READY ? base.rows.map((row) => row.record.id) : null;
  /** What the effect below follows: the ids change, not the array's identity each render. */
  const liveKey = JSON.stringify(liveIds);

  // A RECORD THAT LEFT THE LIST — removed or amended elsewhere, seen on a
  // re-read — takes amend mode and its confirmation with it, and so does a
  // card that is no longer ready. Never while that record's own write is in
  // flight: its handler settles what it leaves, and this runs again after.
  useEffect(() => {
    const live = liveIds;

    if (amendTarget !== null && !amendPending && (live === null || !live.includes(amendTarget.id))) {
      setAmendTarget(null);
      formField.current?.reset();
      setFrom(LEAVE_NO_DATE);
      setTo(LEAVE_NO_DATE);
    }
    if (confirming !== null && !removePending && (live === null || !live.includes(confirming.record.id))) {
      setConfirming(null);
    }
  }, [liveKey, amendTarget, amendPending, confirming, removePending]);

  const handoffReady = base.kind === LEAVE_READY && !recordsState.refreshing;
  const handoffKey = leaveHandoffKeyOf(handoff);

  // THE HAND-OFF OPENS ONCE, the first time the rows are ready — after the
  // effect above, so its clearing never closes what this opens — and the
  // entry is then replaced without it, so a reload or Back never reopens it.
  useEffect(() => {
    if (handoffKey === null || handedOff.current === handoffKey || !handoffReady || base.kind !== LEAVE_READY) return;

    handedOff.current = handoffKey;

    const opening = leaveHandoffOpeningOf(handoff, memberId, base.rows);

    void navigate({
      to: '/ljudi/$id',
      params: { id: memberId },
      replace: true,
      state: (entry) => withoutLeaveHandoffOpening(entry),
    });

    if (opening === null) return;

    // No row action opened it, so a cancel has nothing to return to but the card's own fallbacks.
    amendReturn.current = null;
    removeReturn.current = null;
    clearRaised();

    if (opening.kind === LEAVE_AMEND_ACTION) {
      setAmendTarget(opening.row.record);
      fillFields(opening.range);
      focusLater([() => fromField.current], () => toField.current);
    } else {
      setConfirming(opening.row);
    }
    // `handoff` and the rows are read through their key and readiness: the
    // objects are new on every render.
  }, [handoffKey, handoffReady, liveKey, memberId]);

  /** Clear everything the last write raised, before another is armed or sent. */
  function clearRaised(): void {
    setRefusedField(null);
    setLeaveSaved(null);
    setLeaveAmended(null);
    setLeaveFailure(null);
    setRemoveFailure(null);
    setLeaveRemoved(null);
  }

  /** Put the od and do fields, and the state the preview follows, to `range`; empty for none. */
  function fillFields(range: { readonly from: string; readonly to: string } | null): void {
    const nextFrom = range?.from ?? LEAVE_NO_DATE;
    const nextTo = range?.to ?? LEAVE_NO_DATE;

    if (range === null) formField.current?.reset();
    if (fromField.current !== null) fromField.current.value = nextFrom;
    if (toField.current !== null) toField.current.value = nextTo;
    setFrom(nextFrom);
    setTo(nextTo);
  }

  /** Mirror an edited date into state, for the preview; an edit clears everything raised. */
  function change(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.value;

    if (event.currentTarget.name === LEAVE_FROM_FIELD) setFrom(value);
    else setTo(value);
    clearRaised();
  }

  /**
   * Put the form into amend mode for `row`'s record: its range in the
   * fields, the preview without it, and the od field focused. Only one record
   * at a time; another row's Izmijeni moves amend mode to that record.
   */
  function startAmend(row: LeaveRecordRow, event: MouseEvent<HTMLButtonElement>): void {
    if (recording.current || amending.current || removing.current) return;

    amendReturn.current = event.currentTarget;
    clearRaised();
    setAmendTarget(row.record);
    fillFields(row.record);
    focusLater([() => fromField.current], () => toField.current);
  }

  /** Return the form to a new record, empty, and focus back on the row action that opened amend mode. */
  function cancelAmend(): void {
    if (amending.current) return;

    clearRaised();
    setAmendTarget(null);
    fillFields(null);
    // Its Izmijeni, unless its row left the list meanwhile: then the od field.
    focusLater([() => amendReturn.current, () => fromField.current], () => fromField.current);
  }

  /** Arm the one confirmation for `row`'s removal. */
  function openRemove(row: LeaveRecordRow, event: MouseEvent<HTMLButtonElement>): void {
    if (recording.current || amending.current || removing.current) return;

    removeReturn.current = event.currentTarget;
    clearRaised();
    setConfirming(row);
  }

  /** Close the confirmation with nothing sent, focus back on Ukloni. */
  function cancelRemove(): void {
    if (removing.current) return;

    setConfirming(null);
    setRemoveFailure(null);
    // Its Ukloni, unless its row left the list meanwhile: then what the list says, or its heading.
    focusLater(
      [() => removeReturn.current, () => listNoticeField.current, () => listHeading.current],
      () => fromField.current,
    );
  }

  /** Read again every read the card stands on, from the unavailable line's retry. */
  function retry(): void {
    for (const queryKey of [MEMBERS_LIST_KEY, ORGANIZATION_SNAPSHOT_KEY, CALENDAR_KEY, LEAVE_RECORDS_KEY(memberId)]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  function fieldOf(field: LeaveField): HTMLInputElement | null {
    return field === LEAVE_FROM_FIELD ? fromField.current : toField.current;
  }

  /**
   * Save the entered range. A range the preview does not cost — incomplete,
   * reversed, longer than a year, or refused by the domain — is refused here
   * before any request, with its reason shown and its field focused; the
   * database decides everything else.
   */
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (base.kind !== LEAVE_READY || preview === null || recording.current) return;

    clearRaised();

    if (preview.kind === LEAVE_PREVIEW_REASON) {
      const field = preview.field;

      setRefusedField(field);
      focusLater([() => fieldOf(field)], () => fromField.current);

      return;
    }

    const sent = preview;
    const sentInput = base.input;
    // Focus moves once the form is enabled again, after the `finally`.
    let focusNotice = true;

    recording.current = true;
    setRefusedField(null);
    setRecordPending(true);

    try {
      const outcome = await recordLeave(
        // Structurally, for the reason the records read is.
        supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as LeaveTable,
        base.organizationId,
        memberId,
        sent.range.from,
        sent.range.to,
      );

      // A REFUSAL KEEPS EVERY ENTERED VALUE: nothing here resets the fields.
      if (!outcome.ok) {
        setLeaveFailure({ code: outcome.code, action: LEAVE_RECORD_ACTION, conflict: leaveConflictOf(outcome) });
        focusNotice = false;
      }

      try {
        await refreshAfterWrite(
          queryClient,
          LEAVE_RECORDS_KEY(memberId),
          outcome.ok ? LEAVE_WRITE_DEPENDENTS : NO_DEPENDENTS,
        );
      } catch (cause) {
        console.error(LEAVE_FAILED, cause);
      }

      if (outcome.ok) {
        // FROM THE RE-READ, never the records held before the write: a re-read
        // that did not answer gives the plain line, and the card goes unavailable.
        const fresh = leaveRecordsAfterWriteOf(queryClient.getQueryState(LEAVE_RECORDS_KEY(memberId)));

        setLeaveSaved(leaveSavedOf(sentInput, fresh, sent.range));
        formField.current?.reset();
        setFrom(LEAVE_NO_DATE);
        setTo(LEAVE_NO_DATE);
      }
    } catch (cause) {
      console.error(LEAVE_FAILED, cause);
      setLeaveFailure({ code: LEAVE_FAILED, action: LEAVE_RECORD_ACTION, conflict: null });
      focusNotice = false;
    } finally {
      recording.current = false;
      setRecordPending(false);
    }

    if (focusNotice) focusLater([() => noticeField.current], () => fromField.current);
    else focusLater([() => fromField.current], () => noticeField.current);
  }

  /** Re-read the records and the leave write's dependents, after any amend or removal outcome. */
  async function refreshAfterChange(): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, LEAVE_RECORDS_KEY(memberId), LEAVE_WRITE_DEPENDENTS);
    } catch (cause) {
      console.error(LEAVE_FAILED, cause);
    }
  }

  /**
   * Save the amend of the record in amend mode. A range the preview does not
   * cost, or the record's own range unchanged, is refused here before any
   * request, as a new record's is. An overlap or a refusal keeps every value
   * and amend mode; a gone record closes amend mode and the list says so.
   */
  async function amend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (base.kind !== LEAVE_READY || preview === null || amendTarget === null || amending.current) return;

    clearRaised();

    if (preview.kind === LEAVE_PREVIEW_REASON) {
      const field = preview.field;

      setRefusedField(field);
      focusLater([() => fieldOf(field)], () => fromField.current);

      return;
    }

    const sent = preview;
    const sentInput = base.input;
    const target = amendTarget;
    // Where focus goes once the form is enabled again, after the `finally`:
    // the status line, else the od field, else the list's gone line.
    let focusField = false;
    let focusList = false;

    amending.current = true;
    setRefusedField(null);
    setAmendPending(true);

    try {
      const outcome = await amendLeave(
        // Structurally, for the reason the records read is.
        supabaseClient() as unknown as LeaveRecordRpc,
        supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as LeaveTable,
        base.organizationId,
        memberId,
        target.id,
        sent.range.from,
        sent.range.to,
      );

      if (!outcome.ok) {
        setLeaveFailure({ code: outcome.code, action: LEAVE_AMEND_ACTION, conflict: leaveConflictOf(outcome) });
        focusList = outcome.code === LEAVE_GONE;
        focusField = !focusList;
      }

      // AFTER EVERY OUTCOME, a failure too: an amend that answered no id may have landed.
      await refreshAfterChange();

      if (outcome.ok) {
        // FROM THE RE-READ, by the id the amend returned.
        const fresh = leaveRecordsAfterWriteOf(queryClient.getQueryState(LEAVE_RECORDS_KEY(memberId)));

        setLeaveAmended(leaveAmendedOf(sentInput, fresh, outcome.id));
        setAmendTarget(null);
        fillFields(null);
      } else if (outcome.code === LEAVE_GONE) {
        setAmendTarget(null);
        fillFields(null);
      }
    } catch (cause) {
      console.error(LEAVE_FAILED, cause);
      setLeaveFailure({ code: LEAVE_FAILED, action: LEAVE_AMEND_ACTION, conflict: null });
      focusField = true;
      focusList = false;
      // A THROWN AMEND IS RE-READ TOO: it may have landed before the throw.
      await refreshAfterChange();
    } finally {
      amending.current = false;
      setAmendPending(false);
    }

    if (focusList) focusLater([() => listNoticeField.current], () => fromField.current);
    else if (focusField) focusLater([() => fromField.current], () => noticeField.current);
    else focusLater([() => noticeField.current], () => fromField.current);
  }

  /**
   * Remove the record whose confirmation is open. A refusal keeps the
   * confirmation open with its alert and focuses its cancel; a gone record
   * closes it and the list says so; a landed removal closes it and the list
   * says what was removed. Amend mode on the same record ends with it.
   */
  async function remove(): Promise<void> {
    if (confirming === null || removing.current || base.kind !== LEAVE_READY || recordsState.refreshing) return;

    const target = confirming;
    let landed = false;

    removing.current = true;
    setRemoveFailure(null);
    setLeaveRemoved(null);
    setRemovePending(true);

    try {
      const outcome = await removeLeave(supabaseClient() as unknown as LeaveRecordRpc, target.record.id);

      if (!outcome.ok) {
        setRemoveFailure({ code: outcome.code, action: LEAVE_REMOVE_ACTION, conflict: null });
      }

      await refreshAfterChange();

      landed = outcome.ok || outcome.code === LEAVE_GONE;
      if (outcome.ok) setLeaveRemoved(target);
      if (landed) {
        setConfirming(null);
        if (amendTarget?.id === target.record.id) {
          setAmendTarget(null);
          fillFields(null);
        }
      }
    } catch (cause) {
      console.error(LEAVE_FAILED, cause);
      setRemoveFailure({ code: LEAVE_FAILED, action: LEAVE_REMOVE_ACTION, conflict: null });
      // A THROWN REMOVAL IS RE-READ TOO; its alert stands in the open confirmation.
      await refreshAfterChange();
    } finally {
      removing.current = false;
      setRemovePending(false);
    }

    if (landed) focusLater([() => listNoticeField.current, () => listHeading.current], () => fromField.current);
    else focusLater([() => removeCancel.current], () => fromField.current);
  }

  return {
    base,
    preview,
    invalidField,
    leaveFailure,
    leaveSaved,
    leaveAmended,
    leaveRemoved,
    removeFailure,
    amendTarget,
    confirming,
    recordPending,
    amendPending,
    removePending,
    formDisabled,
    listHeading,
    formField,
    fromField,
    toField,
    noticeField,
    listNoticeField,
    removeCancel,
    change,
    retry,
    save,
    startAmend,
    cancelAmend,
    amend,
    openRemove,
    cancelRemove,
    remove,
  };
}

export type MemberLeave = ReturnType<typeof useMemberLeave>;
