import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

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
  type LeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import {
  LEAVE_FROM_FIELD,
  LEAVE_NO_DATE,
  LEAVE_PREVIEW_REASON,
  LEAVE_READY,
  leaveConflictOf,
  leaveInvalidFieldOf,
  leavePreviewStateOf,
  leaveSavedOf,
  memberLeaveBaseOf,
  type LeaveFailure,
  type LeaveField,
  type LeaveSaved,
} from '@/features/leave/services/leave-section';
import {
  LEAVE_FAILED,
  LEAVE_RECORDS_TABLE,
  recordLeave,
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
 * The component is keyed by the member, so nothing raised here outlives the
 * member it was raised about.
 */
export function useMemberLeave(memberId: string) {
  const queryClient = useQueryClient();
  const formField = useRef<HTMLFormElement>(null);
  const fromField = useRef<HTMLInputElement>(null);
  const toField = useRef<HTMLInputElement>(null);
  /** The alert or status line the last save raised: `Notice` renders a `<p>`. */
  const noticeField = useRef<HTMLParagraphElement>(null);
  // A REF as well as state: state drives the disabled form, and state is
  // stale inside a handler already called once this tick.
  const recording = useRef(false);
  const [recordPending, setRecordPending] = useState(false);
  const [from, setFrom] = useState(LEAVE_NO_DATE);
  const [to, setTo] = useState(LEAVE_NO_DATE);
  const [leaveFailure, setLeaveFailure] = useState<LeaveFailure | null>(null);
  const [leaveSaved, setLeaveSaved] = useState<LeaveSaved | null>(null);
  /** The field a save refused before any request named, until it is edited. */
  const [refusedField, setRefusedField] = useState<LeaveField | null>(null);

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
    base.kind === LEAVE_READY && !recordsState.refreshing ? leavePreviewStateOf(base.input, from, to) : null;
  const invalidField = leaveInvalidFieldOf(leaveFailure, refusedField);
  const formDisabled = base.kind !== LEAVE_READY || recordPending || recordsState.refreshing;

  /** Mirror an edited date into state, for the preview; an edit clears everything raised. */
  function change(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.value;

    if (event.currentTarget.name === LEAVE_FROM_FIELD) setFrom(value);
    else setTo(value);
    setRefusedField(null);
    setLeaveSaved(null);
    setLeaveFailure(null);
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

    setLeaveSaved(null);
    setLeaveFailure(null);

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
        setLeaveFailure({ code: outcome.code, conflict: leaveConflictOf(outcome) });
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
      setLeaveFailure({ code: LEAVE_FAILED, conflict: null });
      focusNotice = false;
    } finally {
      recording.current = false;
      setRecordPending(false);
    }

    if (focusNotice) focusLater([() => noticeField.current], () => fromField.current);
    else focusLater([() => fromField.current], () => noticeField.current);
  }

  return {
    base,
    preview,
    invalidField,
    leaveFailure,
    leaveSaved,
    recordPending,
    formDisabled,
    formField,
    fromField,
    toField,
    noticeField,
    change,
    retry,
    save,
  };
}

export type MemberLeave = ReturnType<typeof useMemberLeave>;
