import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_KEY,
  leaveRecordsAfterWriteOf,
  leaveRecordsQueryOptions,
  leaveRecordsStateOf,
  type LeaveRecord,
  type LeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { leaveConflictsOf, type LeaveConflicts } from '@/features/leave/services/leave-conflicts';
import {
  LEAVE_AMEND_ACTION,
  LEAVE_FROM_FIELD,
  LEAVE_NO_DATE,
  LEAVE_PREVIEW_READY,
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
  REPLACEMENTS_UNKNOWN,
  replacementGuardOf,
  withoutLeaveHandoffOpening,
  type LeaveFailure,
  type LeaveField,
  type LeaveHandoff,
  type LeaveRecordRow,
  type LeaveSaved,
  type ReplacementGuard,
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
 * One opening of a leave dialog (story 7.12; the member page's
 * `DialogOpening` from 7.11): a fresh key, so each opening renders its body
 * anew, the record it amends — null for a new record — and the range its
 * fields start at, null for empty.
 */
export interface LeaveDialogOpening {
  readonly key: number;
  readonly target: LeaveRecord | null;
  readonly range: { readonly from: string; readonly to: string } | null;
}

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
 * THE DIALOGS (story 7.12, the member page's pattern from 7.11). The od–do
 * fields live only in a dialog: `recordDialog` (*Upiši godišnji* in the
 * card's header) and `amendDialog` (a row's *Izmijeni*, or the hand-off).
 * The hook owns which is open and the button that opened it; each opening
 * renders a fresh keyed body whose fields start from the opening's range.
 * While a write is pending neither can be dismissed; a refusal keeps it open
 * with the entered values; a landed save or amend closes it, says so on the
 * card and returns focus to the opener — the list's heading when there is
 * none. An amended record a re-read finds gone closes it, and the list says so.
 *
 * THE FIELDS ARE UNCONTROLLED, so a refused save keeps every entered value;
 * their values are mirrored into state only so the preview can follow them.
 * The whole form is disabled while a save is outstanding.
 *
 * THE CONFLICT PREVIEW (story 7.12): `conflicts` is what the ready range
 * would create, clear and keep, and `removeConflicts` what the open removal
 * clears — both `leaveConflictsOf`, over the queue's own recipe. A note,
 * never a gate.
 *
 * THE WRITE has its own in-flight ref, pending flag and failure. After any
 * outcome the records are re-read, and the leave write's declared dependents
 * with them when it landed; a landed save's line is computed from what that
 * re-read answered, never from the records held before it. No figure is
 * optimistic, and no preview is drawn while a re-read is under way.
 *
 * AMEND AND REMOVE (story 5.2b). `amendDialog.open` opens the amend dialog for
 * one record — prefilled with its range, previewed without it — and `amend`
 * sends it through `amendLeave`. `openRemove` arms one confirmation for one
 * record, and `remove` sends it through `removeLeave`. Each write has its own
 * in-flight ref and pending flag, and after every outcome the records and the
 * leave write's dependents are re-read: an amend that failed may still have
 * landed (`amendLeave`'s doc). A record found gone closes the amend dialog or
 * the confirmation, and the list says so over the records it re-read.
 *
 * THE HAND-OFF FROM A CONFLICT (story 5.4d). Reached from a resolution
 * screen's third card, the card opens ONCE, after its rows are first ready:
 * the amend dialog for the record with the computed range in the fields and
 * the od field focused, or that record's removal confirmation — by the rule
 * applied to the record as it is now. A record already gone, or no longer
 * covering the conflict's date, opens nothing, and the card stays as it was.
 * Either way the history entry is then replaced without the opening, so a
 * reload or Back never reopens it; the origin stays, for "Natrag na
 * konflikte". Nothing is written here until the admin saves; cancelling leaves
 * the conflict open.
 *
 * THE REPLACEMENT GUARD (story 5.4e). The organization's live resolutions
 * are read too, and they and the calendar snapshot (whose live overrides the
 * guard joins to) are re-read whenever an amend or a removal confirmation
 * opens — by a row action or by the hand-off. While an amend range is
 * previewed, or a removal confirmation is open, `amendGuard` / `removeGuard`
 * name each replacement the change would leave rostered, or that they cannot
 * be checked; during a re-read the cached answer stays on screen. A note
 * only: nothing here waits for it or is disabled by it. The lines are
 * captured just before the write, because the write removes the resolutions
 * they come from — as unknown when either read is still fetching then, never
 * from rows the re-read is about to replace — and a landed write's notice
 * repeats them. A removal in flight, or refused, keeps the lines it was sent
 * with on its open confirmation.
 *
 * The component is keyed by the member, so nothing raised here outlives the
 * member it was raised about.
 */
export function useMemberLeave(memberId: string, handoff: LeaveHandoff | null = null) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fromField = useRef<HTMLInputElement>(null);
  const toField = useRef<HTMLInputElement>(null);
  /** The card's status line a landed save or amend raised: `Notice` renders a `<p>`. */
  const noticeField = useRef<HTMLParagraphElement>(null);
  /** The open dialog's alert: a refused save or amend, above its buttons (story 7.12). */
  const alertField = useRef<HTMLParagraphElement>(null);
  /** What the list says after an amend or a removal: the removed line, or that the record is gone. */
  const listNoticeField = useRef<HTMLParagraphElement>(null);
  /** The removal confirmation's cancel, which a refused removal focuses. */
  const removeCancel = useRef<HTMLButtonElement>(null);
  /** The list's heading, where focus lands when nothing nearer is left to take it. */
  const listHeading = useRef<HTMLHeadingElement>(null);
  /**
   * The card's heading, where focus lands when the list is not drawn — a card
   * no longer ready closes its dialog, and its unavailable line says why.
   */
  const cardHeading = useRef<HTMLHeadingElement>(null);
  /** *Upiši godišnji*, which opens the record dialog and takes focus back when it closes (story 7.12). */
  const recordOpener = useRef<HTMLButtonElement>(null);
  /** The Izmijeni that opened the amend dialog, which takes focus back when it closes; null after a hand-off. */
  const amendOpener = useRef<HTMLButtonElement | null>(null);
  /** How many dialogs have opened: each opening's key, so its body is drawn afresh. */
  const openings = useRef(0);
  /** Each drawn row's Izmijeni by its record's id, so focus can find a re-keyed row's after an amend. */
  const amendButtons = useRef(new Map<string, HTMLButtonElement>());
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
  /** The open leave dialog — a new record's, or an amend's — or null. One at a time. */
  const [opening, setOpening] = useState<LeaveDialogOpening | null>(null);
  /** The record the open dialog amends, or null for a new record or none. */
  const amendTarget = opening?.target ?? null;
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
  /** The replacement lines captured before a landed amend, for its notice (story 5.4e). */
  const [amendedReplacements, setAmendedReplacements] = useState<ReplacementGuard | null>(null);
  /** The replacement lines captured before a landed removal, for the list's notice (story 5.4e). */
  const [removedReplacements, setRemovedReplacements] = useState<ReplacementGuard | null>(null);
  /**
   * The lines a sent removal was captured with, held on its open confirmation
   * while it is in flight and after a refusal, so the re-read after it never
   * changes them under the admin (story 5.4e). Cleared when a confirmation opens.
   */
  const [sentRemoveGuard, setSentRemoveGuard] = useState<ReplacementGuard | null>(null);
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
  const resolutions = useQuery(
    organizationConflictResolutionsQueryOptions(
      // Named structurally, as the queue's read is.
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
  );

  const recordsState = leaveRecordsStateOf(records);
  const calendarState = calendarSurfaceStateOf(calendar);
  const base = memberLeaveBaseOf(
    {
      members: membersSurfaceStateOf(members),
      calendar: calendarState,
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
  const snapshot = base.kind === LEAVE_READY ? calendarState.snapshot : null;
  /** What the previewed amend would leave rostered (story 5.4e), or null while no amend range is previewed. */
  // ONLY A READY PREVIEW CAN BE SAVED (`amend` returns before any request
  // otherwise), so a guard over the ready preview's range guards every amend sent.
  const amendFrom = amendTarget !== null && preview?.kind === LEAVE_PREVIEW_READY ? preview.range.from : null;
  const amendTo = amendTarget !== null && preview?.kind === LEAVE_PREVIEW_READY ? preview.range.to : null;
  const { isPending: resolutionsPending, isError: resolutionsFailed, fetchStatus: resolutionsFetch, data: resolutionRows } =
    resolutions;
  const resolutionsRead = useMemo(
    () => ({ isPending: resolutionsPending, isError: resolutionsFailed, fetchStatus: resolutionsFetch, data: resolutionRows }),
    [resolutionsPending, resolutionsFailed, resolutionsFetch, resolutionRows],
  );
  const amendGuard = useMemo(
    () =>
      snapshot !== null && amendTarget !== null && amendFrom !== null && amendTo !== null
        ? replacementGuardOf(resolutionsRead, snapshot, memberId, amendTarget, { from: amendFrom, to: amendTo })
        : null,
    [resolutionsRead, snapshot, memberId, amendTarget, amendFrom, amendTo],
  );
  /** What the confirmed removal would leave rostered (story 5.4e), or null while no confirmation is open. */
  const liveRemoveGuard = useMemo(
    () =>
      snapshot !== null && confirming !== null
        ? replacementGuardOf(resolutionsRead, snapshot, memberId, confirming.record, null)
        : null,
    [resolutionsRead, snapshot, memberId, confirming],
  );
  // A SENT REMOVAL'S LINES stand on its confirmation until it closes or another opens.
  const removeGuard = confirming !== null && sentRemoveGuard !== null ? sentRemoveGuard : liveRemoveGuard;
  const liveRecords = base.kind === LEAVE_READY ? base.input.records : null;
  // WHAT THE MEMOS FOLLOW: the records' and the range's values, not the
  // objects, which are new on every render.
  const recordsKey = JSON.stringify(liveRecords);
  const rangeFrom = opening !== null && preview?.kind === LEAVE_PREVIEW_READY ? preview.range.from : null;
  const rangeTo = opening !== null && preview?.kind === LEAVE_PREVIEW_READY ? preview.range.to : null;
  /** The calendar snapshot is being re-read — as every opening asks for — so the conflicts wait for it. */
  const calendarFetching = calendar.isFetching;
  /** What the ready range in the open dialog would create, clear and keep (story 7.12); null while none is ready. */
  const conflicts = useMemo<LeaveConflicts | null>(
    () =>
      snapshot !== null && liveRecords !== null && opening !== null && rangeFrom !== null && rangeTo !== null
        ? leaveConflictsOf(
            resolutionsRead,
            snapshot,
            memberId,
            liveRecords,
            { target: opening.target, next: { from: rangeFrom, to: rangeTo } },
            calendarFetching,
          )
        : null,
    [resolutionsRead, snapshot, memberId, recordsKey, opening, rangeFrom, rangeTo, calendarFetching],
  );
  /** What the open removal would clear (story 7.12); null while no confirmation is open. */
  const removeConflicts = useMemo<LeaveConflicts | null>(
    () =>
      snapshot !== null && liveRecords !== null && confirming !== null
        ? leaveConflictsOf(
            resolutionsRead,
            snapshot,
            memberId,
            liveRecords,
            { target: confirming.record, next: null },
            calendarFetching,
          )
        : null,
    [resolutionsRead, snapshot, memberId, recordsKey, confirming, calendarFetching],
  );
  /** The member's name as the calendar reads it, for the opener's accessible name and the dialog; null when not read. */
  // FROM THE MEMBER LIST first, which the card reads anyway; the calendar's otherwise.
  const memberName =
    membersSurfaceStateOf(members).members?.find((member) => member.id === memberId)?.name ??
    snapshot?.members.find((member) => member.id === memberId)?.name ??
    null;
  /** Either read the guard stands on is being re-read: a capture now would be of rows about to be replaced. */
  const guardFetching = resolutions.isFetching || calendar.isFetching;

  /** The guard to send a write with: unknown while a read it stands on is still fetching. */
  function capturedGuard(guard: ReplacementGuard | null): ReplacementGuard | null {
    return guard !== null && guardFetching ? { kind: REPLACEMENTS_UNKNOWN } : guard;
  }
  const invalidField = leaveInvalidFieldOf(leaveFormFailureOf(leaveFailure), refusedField);
  /** Any leave write outstanding: every leave control waits for it. */
  const writePending = recordPending || amendPending || removePending;
  const formDisabled = base.kind !== LEAVE_READY || writePending || recordsState.refreshing;
  /** The live records' ids, or null while the card is not ready. */
  const liveIds = base.kind === LEAVE_READY ? base.rows.map((row) => row.record.id) : null;
  /** What the effect below follows: the ids change, not the array's identity each render. */
  const liveKey = JSON.stringify(liveIds);

  // A RECORD THAT LEFT THE LIST — removed or amended elsewhere, seen on a
  // re-read — closes its amend dialog and its confirmation, and so does a
  // card that is no longer ready. Never while that record's own write is in
  // flight: its handler settles what it leaves, and this runs again after.
  // An amend dialog closed by a re-read that still lists the others says so
  // on the list (story 7.12), as an amend that found its record gone does.
  // The record dialog is no longer offered once the card is not ready (story
  // 7.12): it closes, and the card's unavailable line says why. With no list
  // drawn then, focus goes to the card's heading.
  useEffect(() => {
    const live = liveIds;

    if (amendTarget !== null && !amendPending && (live === null || !live.includes(amendTarget.id))) {
      setOpening(null);
      setFrom(LEAVE_NO_DATE);
      setTo(LEAVE_NO_DATE);
      setRefusedField(null);
      if (live !== null) {
        setLeaveFailure({ code: LEAVE_GONE, action: LEAVE_AMEND_ACTION, conflict: null });
        focusLater([() => listNoticeField.current, () => listHeading.current], () => cardHeading.current);
      } else {
        setLeaveFailure(null);
        focusLater([() => listHeading.current, () => cardHeading.current], () => cardHeading.current);
      }
    }
    if (opening !== null && opening.target === null && !recordPending && live === null) {
      setOpening(null);
      setFrom(LEAVE_NO_DATE);
      setTo(LEAVE_NO_DATE);
      setRefusedField(null);
      setLeaveFailure(null);
      focusLater([() => cardHeading.current], () => cardHeading.current);
    }
    if (confirming !== null && !removePending && (live === null || !live.includes(confirming.record.id))) {
      setConfirming(null);
    }
  }, [liveKey, amendTarget, amendPending, confirming, removePending, opening, recordPending]);

  const handoffReady = base.kind === LEAVE_READY && !recordsState.refreshing;
  const handoffKey = leaveHandoffKeyOf(handoff);

  // THE HAND-OFF OPENS ONCE, the first time the rows are ready — after the
  // effect above, so its clearing never closes what this opens — and the
  // entry is then replaced without it, so a reload or Back never reopens it.
  useEffect(() => {
    if (handoffKey === null || handedOff.current === handoffKey || !handoffReady || base.kind !== LEAVE_READY) return;

    handedOff.current = handoffKey;

    const handedOpening = leaveHandoffOpeningOf(handoff, memberId, base.rows);

    void navigate({
      to: '/ljudi/$id',
      params: { id: memberId },
      replace: true,
      state: (entry) => withoutLeaveHandoffOpening(entry),
    });

    if (handedOpening === null) return;

    // No row action opened it, so a close has nothing to return to but the list's heading.
    amendOpener.current = null;
    removeReturn.current = null;
    clearRaised();
    rereadResolutions();

    if (handedOpening.kind === LEAVE_AMEND_ACTION) {
      openDialog(handedOpening.row.record, handedOpening.range);
    } else {
      setConfirming(handedOpening.row);
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
    setAmendedReplacements(null);
    setRemovedReplacements(null);
  }

  /**
   * Read the organization's resolutions and the calendar snapshot again, as a
   * leave dialog or a removal confirmation opens (stories 5.4e, 7.12): the
   * replacement guard and the conflict preview join the one to the other's
   * live schedule, so both must be fresh.
   */
  function rereadResolutions(): void {
    setSentRemoveGuard(null);
    void queryClient.invalidateQueries({ queryKey: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY });
    void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
  }

  /**
   * Open a leave dialog — for a new record (`target` null) or an amend of
   * `target` — with a fresh body whose fields start at `range`, the preview
   * following them, and the od field focused once it is drawn.
   */
  function openDialog(target: LeaveRecord | null, range: { readonly from: string; readonly to: string } | null): void {
    openings.current += 1;
    setOpening({ key: openings.current, target, range });
    setFrom(range?.from ?? LEAVE_NO_DATE);
    setTo(range?.to ?? LEAVE_NO_DATE);
    focusLater([() => fromField.current], () => toField.current);
  }

  /** The ref a row's Izmijeni registers itself under its record's id with, while it is drawn. */
  function amendButtonRef(id: string): (element: HTMLButtonElement | null) => () => void {
    return (element) => {
      if (element !== null) amendButtons.current.set(id, element);

      return () => {
        amendButtons.current.delete(id);
      };
    };
  }

  /** Mirror an edited date into state, for the preview; an edit clears everything raised. */
  function change(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.value;

    if (event.currentTarget.name === LEAVE_FROM_FIELD) setFrom(value);
    else setTo(value);
    clearRaised();
  }

  /** *Upiši godišnji*: the record dialog, empty. */
  function openRecord(): void {
    if (recording.current || amending.current || removing.current) return;

    clearRaised();
    rereadResolutions();
    openDialog(null, null);
  }

  /**
   * A row's *Izmijeni*: the amend dialog for `row`'s record — its range in
   * the fields, the preview without it, and the od field focused.
   */
  function openAmend(row: LeaveRecordRow, event: MouseEvent<HTMLButtonElement>): void {
    if (recording.current || amending.current || removing.current) return;

    amendOpener.current = event.currentTarget;
    clearRaised();
    rereadResolutions();
    openDialog(row.record, row.record);
  }

  /**
   * Either dialog's cancel, close button, Escape and backdrop: nothing is
   * sent, and focus goes back to its opener — never while its write is in flight.
   */
  function closeDialog(): void {
    if (recording.current || amending.current || opening === null) return;

    const amendClosed = opening.target !== null;

    clearRaised();
    setOpening(null);
    setFrom(LEAVE_NO_DATE);
    setTo(LEAVE_NO_DATE);
    focusLater(
      [amendClosed ? () => amendOpener.current : () => recordOpener.current, () => listHeading.current],
      () => cardHeading.current,
    );
  }

  /** Arm the one confirmation for `row`'s removal. */
  function openRemove(row: LeaveRecordRow, event: MouseEvent<HTMLButtonElement>): void {
    if (recording.current || amending.current || removing.current) return;

    removeReturn.current = event.currentTarget;
    clearRaised();
    rereadResolutions();
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
      () => cardHeading.current,
    );
  }

  /** Read again every read the card stands on, from the unavailable line's retry. */
  function retry(): void {
    for (const queryKey of [
      MEMBERS_LIST_KEY,
      ORGANIZATION_SNAPSHOT_KEY,
      CALENDAR_KEY,
      LEAVE_RECORDS_KEY(memberId),
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ]) {
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
      focusLater([() => fieldOf(field)], () => alertField.current);

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
        setOpening(null);
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

    // LANDED: the dialog has closed, so back to its opener. REFUSED: the od
    // field, which the alert describes, once the fields are enabled again.
    if (focusNotice) focusLater([() => recordOpener.current, () => listHeading.current], () => cardHeading.current);
    else focusLater([() => fromField.current], () => alertField.current);
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
   * Save the amend in the open amend dialog. A range the preview does not
   * cost, or the record's own range unchanged, is refused here before any
   * request, as a new record's is. An overlap or a refusal keeps the dialog
   * open with every value; a gone record closes it and the list says so; a
   * landed amend closes it, says so on the card, and returns focus to the
   * row's Izmijeni — the replacement record's, since an amend re-keys its row.
   */
  async function amend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (base.kind !== LEAVE_READY || preview === null || amendTarget === null || amending.current) return;

    clearRaised();

    if (preview.kind === LEAVE_PREVIEW_REASON) {
      const field = preview.field;

      setRefusedField(field);
      focusLater([() => fieldOf(field)], () => alertField.current);

      return;
    }

    const sent = preview;
    const sentInput = base.input;
    const target = amendTarget;
    // BEFORE THE WRITE, which removes the resolutions these lines come from.
    const replacements = capturedGuard(amendGuard);
    // Where focus goes once the form is enabled again, after the `finally`:
    // the opener, else the od field, else the list's gone line.
    let focusField = false;
    let focusList = false;
    /** The replacement record's id, whose row's Izmijeni takes focus after a landed amend. */
    let landedId: string | null = null;

    amending.current = true;
    setRefusedField(null);
    // No earlier amend's lines carry into this one's failure or gone line.
    setAmendedReplacements(null);
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
        setAmendedReplacements(replacements);
        setOpening(null);
        setFrom(LEAVE_NO_DATE);
        setTo(LEAVE_NO_DATE);
        landedId = outcome.id;
      } else if (outcome.code === LEAVE_GONE) {
        setOpening(null);
        setFrom(LEAVE_NO_DATE);
        setTo(LEAVE_NO_DATE);
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

    const replaced = landedId;

    if (focusList) focusLater([() => listNoticeField.current, () => listHeading.current], () => cardHeading.current);
    else if (focusField) focusLater([() => fromField.current], () => alertField.current);
    else {
      // THE REPLACEMENT RECORD'S Izmijeni — an amend re-keys its row, so the
      // one that opened it is gone — whether a row or a hand-off opened the
      // dialog, waited for frame by frame until its row is drawn; the list's
      // heading only when it never is.
      focusLater(
        [() => (replaced === null ? null : (amendButtons.current.get(replaced) ?? null)), () => amendOpener.current],
        () => listHeading.current ?? cardHeading.current,
      );
    }
  }

  /**
   * Remove the record whose confirmation is open. A refusal keeps the
   * confirmation open with its alert and focuses its cancel; a gone record
   * closes it and the list says so; a landed removal closes it and the list
   * says what was removed.
   */
  async function remove(): Promise<void> {
    if (confirming === null || removing.current || base.kind !== LEAVE_READY || recordsState.refreshing) return;

    const target = confirming;
    // BEFORE THE WRITE, which removes the resolutions these lines come from.
    const replacements = capturedGuard(removeGuard);
    let landed = false;

    removing.current = true;
    setRemoveFailure(null);
    setLeaveRemoved(null);
    setRemovedReplacements(null);
    setSentRemoveGuard(replacements);
    setRemovePending(true);

    try {
      const outcome = await removeLeave(supabaseClient() as unknown as LeaveRecordRpc, target.record.id);

      if (!outcome.ok) {
        setRemoveFailure({ code: outcome.code, action: LEAVE_REMOVE_ACTION, conflict: null });
      }

      await refreshAfterChange();

      landed = outcome.ok || outcome.code === LEAVE_GONE;
      if (outcome.ok) {
        setLeaveRemoved(target);
        setRemovedReplacements(replacements);
      }
      if (landed) {
        setConfirming(null);
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

    if (landed) focusLater([() => listNoticeField.current, () => listHeading.current], () => cardHeading.current);
    else focusLater([() => removeCancel.current], () => cardHeading.current);
  }

  return {
    base,
    preview,
    invalidField,
    leaveFailure,
    leaveSaved,
    leaveAmended,
    leaveRemoved,
    amendGuard,
    removeGuard,
    amendedReplacements,
    removedReplacements,
    removeFailure,
    amendTarget,
    confirming,
    recordPending,
    amendPending,
    removePending,
    formDisabled,
    listHeading,
    cardHeading,
    fromField,
    toField,
    noticeField,
    alertField,
    listNoticeField,
    removeCancel,
    amendButtonRef,
    conflicts,
    removeConflicts,
    memberName,
    change,
    retry,
    save,
    amend,
    /** The record dialog (story 7.12): *Upiši godišnji* opens it. */
    recordDialog: {
      opener: recordOpener,
      opening: opening !== null && opening.target === null ? opening : null,
      open: openRecord,
      close: closeDialog,
    },
    /** The amend dialog (story 7.12): a row's *Izmijeni*, or the hand-off, opens it. */
    amendDialog: {
      opener: amendOpener,
      opening: opening !== null && opening.target !== null ? opening : null,
      open: openAmend,
      close: closeDialog,
    },
    openRemove,
    cancelRemove,
    remove,
  };
}

export type MemberLeave = ReturnType<typeof useMemberLeave>;
