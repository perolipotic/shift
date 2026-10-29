import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { useMyLeave } from '@/features/leave/hooks/use-my-leave';
import { useMyLeaveRequestsRead } from '@/features/leave/hooks/use-my-leave-requests';
import {
  LEAVE_FROM_FIELD,
  LEAVE_NO_DATE,
  LEAVE_PREVIEW_REASON,
  LEAVE_TO_FIELD,
  type LeaveField,
} from '@/features/leave/services/leave-section';
import { GODISNJI_OVERVIEW, GODISNJI_UNAVAILABLE, godisnjiViewOf } from '@/features/leave/services/leave-overview';
import { LEAVE_REQUESTS_TABLE, MY_LEAVE_REQUESTS_KEY } from '@/features/leave/services/leave-request-list';
import {
  REQUEST_FAILED,
  sendLeaveRequest,
  type LeaveRequestInsertTable,
  type LeaveRequestSendFailure,
} from '@/features/leave/services/leave-request-write';
import {
  MY_LEAVE_READY,
  myLeaveRequestPreviewOf,
  withLeaveRequestSent,
} from '@/features/leave/services/my-leave';
import { LEAVE_REQUEST_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { ZONE_FROM_CALENDAR } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * Which body `/godisnji/zatrazi` draws (story 9.3), from the calendar
 * snapshot's role as *Godišnji* reads it (`godisnjiViewOf`) — no `beforeLoad`
 * read of its own. An ADMIN is sent to `/godisnji`, the overview, replacing
 * the entry: the form is a member's alone. Until the role is known, no other
 * read is made. When the snapshot cannot name a role, the view is
 * unavailable, and — online — its retry reads the calendar snapshot again,
 * as *Godišnji*'s does (story 8.2e).
 */
export function useLeaveRequestView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const calendarRead = useCalendarSnapshot();
  const { clock, answerFor } = useSnapshotFreshness([CALENDAR_KEY], [[CALENDAR_KEY, calendarRead]], ZONE_FROM_CALENDAR);
  const view = godisnjiViewOf(calendarSurfaceStateOf(answerFor(CALENDAR_KEY, calendarRead)));

  useEffect(() => {
    if (view === GODISNJI_OVERVIEW) void navigate({ to: '/godisnji', replace: true });
  }, [view, navigate]);

  /** Read the calendar snapshot again, from the unavailable notice's retry. */
  function retry(): void {
    void queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
  }

  return {
    view,
    // STORY 8.2e: "show the read retry now" — the role cannot be read, and online.
    retryable: clock.online && view === GODISNJI_UNAVAILABLE,
    retry,
  };
}

/**
 * *Zatraži godišnji* (story 9.3): the member's own figures' reads, the
 * entered range, its preview and the one send. Wiring only — every decision
 * is `@/features/leave/services/my-leave`'s, `.../leave-request-list`'s and
 * `.../leave-request-write`'s, which the node suite executes.
 *
 * ONE SNAPSHOT (story 8.2b): the figures' four reads (`useMyLeave`) and the
 * viewer's own requests, mounted here so the freshness decides over all five,
 * as on *Godišnji*. Offline the form is drawn from the cached snapshot under
 * the as-of note, and *Pošalji* is gated.
 *
 * THE PREVIEW is `leavePreviewOf` over the very balance input the figures
 * stand on, and NEVER A GATE: over the balance or over the member's own leave
 * the request is still sent, and the database decides. Only a range with no
 * preview — incomplete, reversed, longer than 366 days — is refused here,
 * before any request, with its reason and its field focused.
 *
 * THE FIELDS ARE UNCONTROLLED, so a refusal keeps every entered value; their
 * values are mirrored into state only so the preview can follow them. One send
 * in flight (a ref, no mutation, nothing optimistic). After any outcome the
 * requests are read again (`refreshAfterWrite`); a landed send returns to
 * `/godisnji`, whose status line names the range, and a refusal stays here
 * with its alert focused.
 */
export function useLeaveRequestForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { leave, loading, offline, retryable, retry } = useMyLeave();
  useMyLeaveRequestsRead();
  const [from, setFrom] = useState(LEAVE_NO_DATE);
  const [to, setTo] = useState(LEAVE_NO_DATE);
  const [refusedField, setRefusedField] = useState<LeaveField | null>(null);
  const [failure, setFailure] = useState<LeaveRequestSendFailure | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const fromField = useRef<HTMLInputElement>(null);
  const toField = useRef<HTMLInputElement>(null);
  const alertField = useRef<HTMLParagraphElement>(null);
  const preview = myLeaveRequestPreviewOf(leave, from, to);
  // The field a reason names is marked only once a send was refused for it.
  const invalidField = preview !== null && preview.kind === LEAVE_PREVIEW_REASON ? refusedField : null;

  /**
   * A date typed: mirrored so the preview follows it. A refusal standing
   * from the last send is about the range it was sent for, so it goes: no
   * alert, and no field described by one, over a range that changed.
   */
  function change(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.currentTarget;

    setFailure(null);

    if (name === LEAVE_FROM_FIELD) setFrom(value);
    else if (name === LEAVE_TO_FIELD) setTo(value);
  }

  function fieldOf(field: LeaveField): HTMLInputElement | null {
    return field === LEAVE_FROM_FIELD ? fromField.current : toField.current;
  }

  /** *Pošalji*: the entered range as a request, refused here only when it has no preview. */
  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (leave.kind !== MY_LEAVE_READY || preview === null || sending.current) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    setFailure(null);

    if (preview.kind === LEAVE_PREVIEW_REASON) {
      const field = preview.field;

      setRefusedField(field);
      focusLater([() => fieldOf(field)], () => alertField.current);

      return;
    }

    const range = preview.range;
    let landed = false;

    sending.current = true;
    setRefusedField(null);
    setPending(true);

    try {
      const outcome = await sendLeaveRequest(
        // Structurally, for the reason the requests read is.
        supabaseClient().from(LEAVE_REQUESTS_TABLE) as unknown as LeaveRequestInsertTable,
        leave.organizationId,
        leave.memberId,
        range.from,
        range.to,
      );

      // A REFUSAL KEEPS EVERY ENTERED VALUE: nothing here resets the fields.
      if (!outcome.ok) setFailure(outcome.code);
      landed = outcome.ok;

      try {
        await refreshAfterWrite(queryClient, MY_LEAVE_REQUESTS_KEY, outcome.ok ? LEAVE_REQUEST_WRITE_DEPENDENTS : NO_DEPENDENTS);
      } catch (cause) {
        console.error(REQUEST_FAILED, cause);
      }
    } catch (cause) {
      console.error(REQUEST_FAILED, cause);
      setFailure(REQUEST_FAILED);
    } finally {
      sending.current = false;
      setPending(false);
    }

    if (landed) {
      await navigate({ to: '/godisnji', state: (entry) => withLeaveRequestSent(entry, range) });

      return;
    }

    // The refusal's alert takes focus once drawn.
    focusLater([() => alertField.current], () => fromField.current);
  }

  return {
    leave,
    loading,
    offline,
    retryable,
    retry,
    preview,
    invalidField,
    failure,
    pending,
    change,
    send,
    fromField,
    toField,
    alertField,
  };
}
