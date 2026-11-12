import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LEAVE_HALF_FIRST, LEAVE_HALF_SECOND } from '@shift/domain';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { useMyLeave } from '@/features/leave/hooks/use-my-leave';
import { useMyLeaveRequestsRead } from '@/features/leave/hooks/use-my-leave-requests';
import {
  LEAVE_FROM_FIELD,
  LEAVE_HALF_FIELD,
  LEAVE_NO_DATE,
  LEAVE_PREVIEW_REASON,
  LEAVE_TO_FIELD,
  LEAVE_TYPE_FIELD,
  LEAVE_WHOLE_DAY,
  leaveHalfOfferedOf,
  type LeaveField,
  type LeaveHalfChoice,
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
  LEAVE_REQUEST_HALF_OPTIONS_FAILED,
  MY_LEAVE_READY,
  myLeaveRequestHalfOptionsOf,
  myLeaveRequestHalfPreviewOf,
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
 * *Zatraži odsutnost* (story 9.3): the member's own figures' reads, the
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
 * THE TYPE (story 13.2b): a radio card group of the organization's absence
 * types, held in state, none preselected; any type may be requested. A send
 * with none chosen marks and focuses the group and sends nothing.
 *
 * THE HALF DAY (story 13.5b), as the admin dialog's (story 13.5): while Od =
 * Do, *Pola dana*; when it is on, the two half cards with their times from
 * the figures' own snapshot, neither preselected. A send with the switch on
 * and no half chosen, or on a date without exactly one working shift, is
 * refused here with its reason; a range of more than one date clears the
 * half. The chosen half goes with the send.
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
  const { leave, snapshot, loading, offline, retryable, retry } = useMyLeave();
  useMyLeaveRequestsRead();
  const [from, setFrom] = useState(LEAVE_NO_DATE);
  const [to, setTo] = useState(LEAVE_NO_DATE);
  /** The chosen absence type's id (story 13.2b), or null while none is chosen. */
  const [typeId, setTypeId] = useState<string | null>(null);
  /** *Pola dana* and the chosen half (story 13.5b): off until switched on, neither half preselected. */
  const [half, setHalf] = useState<LeaveHalfChoice>(LEAVE_WHOLE_DAY);
  const [refusedField, setRefusedField] = useState<LeaveField | null>(null);
  const [failure, setFailure] = useState<LeaveRequestSendFailure | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  const fromField = useRef<HTMLInputElement>(null);
  const toField = useRef<HTMLInputElement>(null);
  /** The type group's first card, which a send refused for want of a type focuses. */
  const typeField = useRef<HTMLButtonElement>(null);
  /** *Pola dana* (story 13.5b), which a refused half day focuses when no card is drawn. */
  const halfSwitch = useRef<HTMLButtonElement>(null);
  /** The half group's first card, which a send refused for want of a half focuses (story 13.5b). */
  const halfField = useRef<HTMLButtonElement>(null);
  const alertField = useRef<HTMLParagraphElement>(null);
  const halfOffered = leaveHalfOfferedOf(from, to);
  /** The half cards and their times (story 13.5b), or why none: not offered, refused, or failed. */
  const halfCards = useMemo(
    () => myLeaveRequestHalfOptionsOf(leave, snapshot, from, to, half),
    [leave, snapshot, from, to, half],
  );
  /** The cards to draw: none when they are not offered, refused, or could not be drawn. */
  const halfOptions = halfCards === LEAVE_REQUEST_HALF_OPTIONS_FAILED ? null : halfCards;
  // STORY 13.5b: cards that could not be drawn are the half day's refusal, never "choose a half".
  const preview = myLeaveRequestHalfPreviewOf(myLeaveRequestPreviewOf(leave, from, to, typeId, half), halfCards);
  // The field a reason names is marked only once a send was refused for it.
  // STORY 13.2b: and only while the reason standing is about that field, so a
  // later date reason never leaves the type group marked, or the reverse.
  const invalidField =
    preview !== null && preview.kind === LEAVE_PREVIEW_REASON && preview.field === refusedField ? refusedField : null;

  /**
   * A date typed: mirrored so the preview follows it. A refusal standing
   * from the last send is about the range it was sent for, so it goes: no
   * alert, and no field described by one, over a range that changed.
   */
  function change(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.currentTarget;
    const nextFrom = name === LEAVE_FROM_FIELD ? value : from;
    const nextTo = name === LEAVE_TO_FIELD ? value : to;

    setFailure(null);

    if (name === LEAVE_FROM_FIELD) setFrom(value);
    else if (name === LEAVE_TO_FIELD) setTo(value);
    // STORY 13.5b: a range of more than one date clears the half day.
    if (nextFrom !== nextTo) setHalf(LEAVE_WHOLE_DAY);
  }

  /** *Pola dana* switched (story 13.5b): on with no half chosen, or off; a standing refusal goes. */
  function switchHalf(on: boolean): void {
    setFailure(null);
    setHalf(on ? { on: true, half: null } : LEAVE_WHOLE_DAY);
  }

  /** A half card chosen (story 13.5b): the preview follows it, and a standing refusal goes. */
  function chooseHalf(value: string): void {
    if (value !== LEAVE_HALF_FIRST && value !== LEAVE_HALF_SECOND) return;

    setFailure(null);
    setHalf({ on: true, half: value });
  }

  /** A type card chosen: the preview follows it, and a standing refusal goes, as after a typed date. */
  function chooseType(value: string): void {
    setFailure(null);
    setTypeId(value);
  }

  function fieldOf(field: LeaveField): HTMLElement | null {
    if (field === LEAVE_TYPE_FIELD) return typeField.current;
    // A refused half day draws no card: the switch carries the refusal (story 13.5b).
    if (field === LEAVE_HALF_FIELD) return halfOptions === null ? halfSwitch.current : (halfField.current ?? halfSwitch.current);

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
        preview.type.id,
        // STORY 13.5b: the half `leaveSentHalfOf` put on the range; none for a whole day.
        range.half ?? null,
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
    typeId,
    chooseType,
    /** *Pola dana* and the chosen half (story 13.5b). */
    half,
    /** Whether *Pola dana* is offered: while Od = Do. */
    halfOffered,
    /** The half cards with their times, or null (story 13.5b). */
    halfOptions,
    switchHalf,
    chooseHalf,
    halfSwitch,
    halfField,
    send,
    fromField,
    toField,
    typeField,
    alertField,
  };
}
