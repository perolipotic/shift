import { leaveBalanceOf, leaveCostOf, type LeaveBalance, type LeaveYearStart } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf, memberScheduleInputOf } from '@/features/calendar/utils/month';
import { leaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  LEAVE_FROM_FIELD,
  LEAVE_PREVIEW_REASON,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_RANGE_UNCHANGED,
  leavePreviewStateOf,
  leaveRangeValuesOf,
  type LeaveCalendarSource,
  type LeaveMembersSource,
  type LeaveOrganizationAnswer,
  type LeaveOrganizationSource,
  type LeavePreviewState,
  type LeaveRangeReason,
  type LeaveRecordsInput,
} from '@/features/leave/services/leave-section';
import {
  REQUEST_APPROVED,
  REQUEST_CLOSED_ON_DEACTIVATION,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_WITHDRAWN,
  leaveRequestsOf,
  type LeaveRequest,
  type LeaveRequestStatus,
} from '@/features/leave/services/leave-request-list';
import {
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_IN_PAST,
  REQUEST_MEMBER_INACTIVE,
  REQUEST_NOT_PENDING,
  REQUEST_OVERLAPS_LEAVE,
  REQUEST_OVERLAPS_REQUEST,
  type LeaveRequestSendFailure,
  type LeaveRequestWithdrawFailure,
} from '@/features/leave/services/leave-request-write';
import { RANGE_DASH, formatIsoDate, isIsoDate, organizationIsoDate } from '@/lib/i18n/format';

/**
 * *Godišnji* (story 5.2c): the viewer's own allowance, the days used in the
 * current leave year and the balance, as a pure view model in a `.ts` that
 * renders nothing (AD-15). The hook only wires it; the node suite executes it.
 *
 * ONE COMPUTATION. The three figures are `leaveBalanceOf`'s from
 * `@shift/domain`, over the calendar's one schedule recipe
 * (`memberScheduleInputOf`) for the snapshot's VIEWER, the viewer's own
 * members row (the allowance), the organization's leave year, today in the
 * organization's zone, and the viewer's own live records — the rows
 * `my_leave_records()` (0030) answered, parsed by `leaveRecordsOf` against the
 * viewer's id. They are the admin card's figures for the same member, from
 * the same inputs.
 *
 * NEVER A GUESS. A read that failed or is paused offline, an own row the
 * members read did not return, a record row of anybody else or one that does
 * not parse, and any error the domain throws each make the screen unavailable; no
 * figure is drawn from rows that cannot be trusted. Codes and numbers only;
 * the components format.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** Still waiting on a read: the skeleton, never a figure. */
export const MY_LEAVE_LOADING = 'loading';
/** A read failed, or what it answered breaches a rule: one alert with a retry, no figure. */
export const MY_LEAVE_UNAVAILABLE = 'unavailable';
/**
 * The viewer has never been on a team, so there is no schedule to count
 * leave days against. Not a failure, so no retry: their own line, no figure.
 */
export const MY_LEAVE_UNSCHEDULED = 'unscheduled';
/** Everything read: the three figures. */
export const MY_LEAVE_READY = 'ready';

export type MyLeave =
  | { readonly kind: typeof MY_LEAVE_LOADING }
  | { readonly kind: typeof MY_LEAVE_UNAVAILABLE }
  | { readonly kind: typeof MY_LEAVE_UNSCHEDULED }
  | {
      readonly kind: typeof MY_LEAVE_READY;
      readonly balance: LeaveBalance;
      /**
       * STORY 9.3: the one balance input the three figures were computed
       * over, so the request form previews a range against exactly it and
       * never recomputes one. Pending requests are no part of it.
       */
      readonly input: LeaveRecordsInput;
      /** The organization and the member a request is sent for: the calendar snapshot's viewer. */
      readonly organizationId: string;
      readonly memberId: string;
      /** The organization's zone, in which a closed request's instant is a date. */
      readonly timeZone: string;
    };

/** The query result the own rows' state is derived from. */
export interface MyLeaveRowsAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: readonly unknown[] | undefined;
}

/** What the own-records read gives the screen: the rows, or still loading, or neither (failed). */
export interface MyLeaveRowsState {
  readonly rows: readonly unknown[] | null;
  readonly loading: boolean;
}

/**
 * One query result as the rows to compute from. A FAILURE, a failed refetch
 * over cached rows, or a fetch paused offline gives none, so no balance is
 * drawn from records the database may no longer hold.
 */
export function myLeaveRowsStateOf(answer: MyLeaveRowsAnswer): MyLeaveRowsState {
  if (answer.isError || answer.fetchStatus === FETCH_PAUSED) return { rows: null, loading: false };

  return { rows: answer.data ?? null, loading: answer.isPending };
}

/** The four reads *Godišnji* stands on, each as far as it is read here. */
export interface MyLeaveSources {
  readonly members: LeaveMembersSource;
  readonly calendar: LeaveCalendarSource;
  readonly organization: LeaveOrganizationSource;
  readonly records: MyLeaveRowsState;
}

/** Where the leave year begins, or null while it is not known. */
function leaveYearStartOf(answer: LeaveOrganizationAnswer): LeaveYearStart | null {
  return answer !== undefined && answer.ok
    ? { month: answer.snapshot.leaveYearStartMonth, day: answer.snapshot.leaveYearStartDay }
    : null;
}

/**
 * The viewer's balance input (story 9.3, factored out of {@link myLeaveOf}):
 * the calendar's one schedule recipe for the snapshot's viewer, their
 * allowance, their own live records, today in the organization's zone and the
 * leave year. The three figures and the request form's preview both stand on
 * this one value. Throws what the schedule recipe throws.
 */
export function myLeaveInputOf(
  snapshot: CalendarSnapshot,
  allowanceDays: number,
  records: LeaveRecordsInput['records'],
  leaveYearStart: LeaveYearStart,
  now: Date,
): LeaveRecordsInput {
  return {
    input: memberScheduleInputOf(snapshot, snapshot.viewer),
    allowanceDays,
    records,
    today: calendarTodayOf(snapshot, now),
    leaveYearStart,
  };
}

/**
 * What *Godišnji* shows from its four reads at `now`: unavailable when any
 * read failed or is paused offline — first, so a failure is never hidden
 * behind another's skeleton — loading while any read is pending, unavailable
 * when the members read holds no row of the viewer's, unscheduled when the
 * viewer has never been on a team, unavailable when a record row is not the
 * viewer's or does not parse, and otherwise the three figures. Any error the
 * computation throws — a domain `RangeError` or anything else — is logged and
 * is unavailable, as the admin card's is, so *Godišnji* never crashes in render.
 */
export function myLeaveOf(sources: MyLeaveSources, now: Date): MyLeave {
  const { members, calendar, organization, records } = sources;
  const leaveYearStart = leaveYearStartOf(organization.data);
  const failed =
    members.paused ||
    (!members.loading && (members.refusal !== null || members.members === null)) ||
    (!calendar.loading && calendar.snapshot === null) ||
    organization.fetchStatus === FETCH_PAUSED ||
    (!organization.isPending && (organization.isError || leaveYearStart === null)) ||
    (!records.loading && records.rows === null);

  if (failed) return { kind: MY_LEAVE_UNAVAILABLE };

  const snapshot = calendar.snapshot;
  const rows = records.rows;

  if (members.members === null || snapshot === null || leaveYearStart === null || rows === null) {
    return { kind: MY_LEAVE_LOADING };
  }

  const viewer = snapshot.viewer;
  const own = members.members.find((candidate) => candidate.id === viewer.memberId);

  // A member-role session reads its own row (0011); an admin reads every row.
  // Either way the viewer's is there, so its absence is a fault, not a state.
  if (own === undefined) return { kind: MY_LEAVE_UNAVAILABLE };

  if (viewer.memberships.length === 0) return { kind: MY_LEAVE_UNSCHEDULED };

  const recorded = leaveRecordsOf(rows, viewer.memberId);

  if (recorded === null) {
    console.error(MY_LEAVE_UNAVAILABLE, 'row');

    return { kind: MY_LEAVE_UNAVAILABLE };
  }

  try {
    const input = myLeaveInputOf(snapshot, own.leaveAllowanceDays, recorded, leaveYearStart, now);

    return {
      kind: MY_LEAVE_READY,
      balance: leaveBalanceOf(input),
      input,
      organizationId: snapshot.organizationId,
      memberId: viewer.memberId,
      timeZone: snapshot.timeZone,
    };
  } catch (cause) {
    // AS THE ADMIN CARD DOES (`memberLeaveBaseOf`): any failure — the domain's
    // `RangeError` above all — is logged and is unavailable, never a crashed route.
    console.error(MY_LEAVE_UNAVAILABLE, cause);

    return { kind: MY_LEAVE_UNAVAILABLE };
  }
}

/** The three tiles' labels. */
export type MyLeaveTileKey = 'godisnji.allowance' | 'godisnji.used' | 'godisnji.balance';

/** One of the three tiles: its label's key and its figure in whole days. */
export interface MyLeaveTile {
  readonly label: MyLeaveTileKey;
  readonly days: number;
}

/**
 * The three tiles in their fixed order — the allowance, the days used in the
 * current leave year, the balance — each the domain's figure as it came. A
 * balance below zero stays a number: an over-balance year is a fact, not an
 * error.
 */
export function myLeaveTilesOf(balance: LeaveBalance): readonly MyLeaveTile[] {
  return [
    { label: 'godisnji.allowance', days: balance.allowanceDays },
    { label: 'godisnji.used', days: balance.usedDays },
    { label: 'godisnji.balance', days: balance.balanceDays },
  ];
}

/** The line a screen with no figures shows in their place. Exhaustive. */
export function myLeaveMessageKey(
  kind: typeof MY_LEAVE_UNAVAILABLE | typeof MY_LEAVE_UNSCHEDULED,
): 'godisnji.unavailable' | 'godisnji.unscheduled' {
  if (kind === MY_LEAVE_UNSCHEDULED) return 'godisnji.unscheduled';
  if (kind === MY_LEAVE_UNAVAILABLE) return 'godisnji.unavailable';

  const unhandled: never = kind;

  return unhandled;
}

// ------------------------------------------------------- the request (9.3)

/** The request form's heading (story 9.3), which names its region. Never a `member-leave-*` id. */
export const LEAVE_REQUEST_HEADING_ID = 'leave-request-heading';
/** The od field. */
export const LEAVE_REQUEST_FROM_ID = 'leave-request-from';
/** The do field. */
export const LEAVE_REQUEST_TO_ID = 'leave-request-to';
/** The preview's polite live region. */
export const LEAVE_REQUEST_PREVIEW_ID = 'leave-request-preview';
/** The reason line, which the field it names is described by while that field is marked. */
export const LEAVE_REQUEST_REASON_ID = 'leave-request-reason';
/** The refused send's alert, which the od field is described by while it stands. */
export const LEAVE_REQUEST_ERROR_ID = 'leave-request-error';
/** The list's heading on *Godišnji*, which names its section and its list. */
export const MY_LEAVE_REQUESTS_HEADING_ID = 'my-leave-requests-heading';

/**
 * RETRO 8–9 ITEM 17 (0047): the request's first day is before the
 * organization's today. Past leave is recorded by an admin, so the form
 * refuses it before any request, as the database does.
 */
export const LEAVE_REQUEST_IN_PAST = 'inPast';

/** The reasons the request form names: the admin dialog's, and the past start. */
export type LeaveRequestReason = LeaveRangeReason | typeof LEAVE_REQUEST_IN_PAST;

/** The request form's preview: the admin dialog's states, or the past start on *Od*. */
export type LeaveRequestPreviewState =
  | LeavePreviewState
  | {
      readonly kind: typeof LEAVE_PREVIEW_REASON;
      readonly reason: typeof LEAVE_REQUEST_IN_PAST;
      readonly field: typeof LEAVE_FROM_FIELD;
    };

/**
 * The earliest first day the request form takes (0047): the organization's
 * today, as the figures' input holds it; null while the figures are not ready.
 */
export function myLeaveRequestEarliestOf(leave: MyLeave): string | null {
  return leave.kind === MY_LEAVE_READY ? leave.input.today : null;
}

/**
 * STORY 9.3: *Zatraži godišnji*. What the entered range would cost and the
 * balance after it, as the domain's `leavePreviewOf` over the very input the
 * three figures stand on (`leavePreviewStateOf`, the admin dialog's rule, with
 * no record amended): a reason in place of the preview while a date is
 * incomplete, the range is reversed, it is longer than 366 days, or the
 * domain refuses it. Since retro 8–9 item 17 (0047) a first day before the
 * organization's today is a reason too, on *Od*, named as soon as *Od* is a
 * date and before any other. Null while the figures are not ready. A NOTE,
 * NEVER A GATE: over the balance or over the viewer's own leave, the request
 * is sent, and the database decides. Pending requests charge nothing, so they
 * are no part of the input and no part of the balance after it.
 */
export function myLeaveRequestPreviewOf(leave: MyLeave, from: string, to: string): LeaveRequestPreviewState | null {
  if (leave.kind !== MY_LEAVE_READY) return null;

  if (isIsoDate(from) && from < leave.input.today) {
    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_REQUEST_IN_PAST, field: LEAVE_FROM_FIELD };
  }

  return leavePreviewStateOf(leave.input, from, to);
}

/** The reason line's key, in the request form's own words. Exhaustive. */
export function myLeaveRequestReasonMessageKey(
  reason: LeaveRequestReason,
):
  | 'godisnji.request.inPastReason'
  | 'godisnji.request.incomplete'
  | 'godisnji.request.reversed'
  | 'godisnji.request.tooLong'
  | 'godisnji.request.refused' {
  switch (reason) {
    case LEAVE_REQUEST_IN_PAST:
      return 'godisnji.request.inPastReason';
    case LEAVE_RANGE_INCOMPLETE:
      return 'godisnji.request.incomplete';
    case LEAVE_RANGE_REVERSED:
      return 'godisnji.request.reversed';
    case LEAVE_RANGE_TOO_LONG:
      return 'godisnji.request.tooLong';
    // No amend here, so an unchanged range is never a reason the form meets;
    // were it one, it could not be costed either.
    case LEAVE_RANGE_REFUSED:
    case LEAVE_RANGE_UNCHANGED:
      return 'godisnji.request.refused';
    default: {
      const unhandled: never = reason;

      return unhandled;
    }
  }
}

/** The alert a refused send renders as. Exhaustive. */
export function myLeaveRequestSendMessageKey(
  code: LeaveRequestSendFailure,
):
  | 'godisnji.request.overlapsLeave'
  | 'godisnji.request.overlapsRequest'
  | 'godisnji.request.memberInactive'
  | 'godisnji.request.inPast'
  | 'godisnji.request.denied'
  | 'godisnji.request.failed' {
  switch (code) {
    case REQUEST_OVERLAPS_LEAVE:
      return 'godisnji.request.overlapsLeave';
    case REQUEST_OVERLAPS_REQUEST:
      return 'godisnji.request.overlapsRequest';
    case REQUEST_MEMBER_INACTIVE:
      return 'godisnji.request.memberInactive';
    case REQUEST_IN_PAST:
      return 'godisnji.request.inPast';
    case REQUEST_DENIED:
      return 'godisnji.request.denied';
    case REQUEST_FAILED:
      return 'godisnji.request.failed';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}

/** The alert a refused withdrawal renders as. Exhaustive. */
export function myLeaveRequestWithdrawMessageKey(
  code: LeaveRequestWithdrawFailure,
): 'godisnji.request.withdrawNotPending' | 'godisnji.request.withdrawDenied' | 'godisnji.request.withdrawFailed' {
  switch (code) {
    case REQUEST_NOT_PENDING:
      return 'godisnji.request.withdrawNotPending';
    case REQUEST_DENIED:
      return 'godisnji.request.withdrawDenied';
    case REQUEST_FAILED:
      return 'godisnji.request.withdrawFailed';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}

/** A status as the word its badge carries. Exhaustive. */
export function myLeaveRequestStatusMessageKey(
  status: LeaveRequestStatus,
):
  | 'godisnji.request.status.pending'
  | 'godisnji.request.status.approved'
  | 'godisnji.request.status.rejected'
  | 'godisnji.request.status.withdrawn'
  | 'godisnji.request.status.closedOnDeactivation' {
  switch (status) {
    case REQUEST_PENDING:
      return 'godisnji.request.status.pending';
    case REQUEST_APPROVED:
      return 'godisnji.request.status.approved';
    case REQUEST_REJECTED:
      return 'godisnji.request.status.rejected';
    case REQUEST_WITHDRAWN:
      return 'godisnji.request.status.withdrawn';
    case REQUEST_CLOSED_ON_DEACTIVATION:
      return 'godisnji.request.status.closedOnDeactivation';
    default: {
      const unhandled: never = status;

      return unhandled;
    }
  }
}

/** One of the viewer's requests as *Godišnji* lists it. */
export interface MyLeaveRequestRow {
  readonly request: LeaveRequest;
  /** `10.09.2026`, the first date as the list writes it. */
  readonly from: string;
  /** `14.09.2026`, the last. */
  readonly to: string;
  /** `10.09.2026–14.09.2026`. */
  readonly label: string;
  /** The domain's `leaveCostOf` over the whole range, or null when it refuses the range. */
  readonly costDays: number | null;
  /** `20.09.2026`, the date it was closed in the organization's zone, or null while pending. */
  readonly closedOn: string | null;
  /** Whether *Povuci zahtjev* is offered: a pending request alone. */
  readonly withdrawable: boolean;
}

/** Still waiting on the requests read. */
export const MY_REQUESTS_LOADING = 'loading';
/** The read failed, or a row cannot be trusted: one line and a retry. */
export const MY_REQUESTS_UNAVAILABLE = 'unavailable';
/** Every row read, possibly none. */
export const MY_REQUESTS_READY = 'ready';

export type MyLeaveRequests =
  | { readonly kind: typeof MY_REQUESTS_LOADING }
  | { readonly kind: typeof MY_REQUESTS_UNAVAILABLE }
  | { readonly kind: typeof MY_REQUESTS_READY; readonly rows: readonly MyLeaveRequestRow[] };

/** An instant as the organization's calendar date, written `20.09.2026`; null when it is no instant. */
function closedOnOf(closedAt: string | null, timeZone: string): string | null {
  if (closedAt === null) return null;

  const instant = new Date(closedAt);

  if (Number.isNaN(instant.getTime())) return null;

  const date = organizationIsoDate(instant, timeZone);

  return formatIsoDate(date) ?? date;
}

/**
 * Whose requests the list reads, from the calendar snapshot alone: the
 * viewer's member id and the organization's zone, and the balance input a
 * row is costed over — null while the figures are not ready (unscheduled,
 * unavailable), when each row is drawn without its cost. The list never
 * waits on the figures, so a member with no schedule still sees and withdraws
 * their pending requests.
 */
export interface MyLeaveRequestsViewer {
  readonly memberId: string;
  readonly timeZone: string;
  readonly input: LeaveRecordsInput | null;
}

/** The viewer of the list from the snapshot and the figures: the figures' input when ready, else none. */
export function myLeaveRequestsViewerOf(
  snapshot: Pick<CalendarSnapshot, 'viewer' | 'timeZone'>,
  leave: MyLeave,
): MyLeaveRequestsViewer {
  return {
    memberId: snapshot.viewer.memberId,
    timeZone: snapshot.timeZone,
    input: leave.kind === MY_LEAVE_READY ? leave.input : null,
  };
}

/**
 * *Godišnji*'s list of the viewer's own requests, from the requests read
 * alone: loading while the read is, unavailable when it failed or a row is not
 * the viewer's or does not parse, otherwise every request soonest first
 * (`leaveRequestsOf`), each with its range, what it would cost over the
 * viewer's schedule (null with no balance input, or when the domain refuses
 * the range), its status and, once closed, the date. Nothing here is charged:
 * a pending request's cost is what it would cost, and no balance counts it.
 */
export function myLeaveRequestsOf(viewer: MyLeaveRequestsViewer, rows: MyLeaveRowsState): MyLeaveRequests {
  if (rows.rows === null) return rows.loading ? { kind: MY_REQUESTS_LOADING } : { kind: MY_REQUESTS_UNAVAILABLE };

  const requests = leaveRequestsOf(rows.rows, viewer.memberId);

  if (requests === null) {
    console.error(MY_REQUESTS_UNAVAILABLE, 'row');

    return { kind: MY_REQUESTS_UNAVAILABLE };
  }

  const input = viewer.input;

  return {
    kind: MY_REQUESTS_READY,
    rows: requests.map((request) => {
      const values = leaveRangeValuesOf(request);
      let costDays: number | null = null;

      if (input !== null) {
        try {
          costDays = leaveCostOf(input.input, request.from, request.to);
        } catch (cause) {
          console.error(MY_REQUESTS_UNAVAILABLE, cause);
        }
      }

      return {
        request,
        from: values.from,
        to: values.to,
        label: `${values.from}${RANGE_DASH}${values.to}`,
        costDays,
        closedOn: closedOnOf(request.closedAt, viewer.timeZone),
        withdrawable: request.status === REQUEST_PENDING,
      };
    }),
  };
}

/** The closing date's line by status: decided, withdrawn or closed on deactivation; none while pending. Exhaustive. */
export function myLeaveRequestClosedMessageKey(
  status: LeaveRequestStatus,
): 'godisnji.request.decidedOn' | 'godisnji.request.withdrawnOn' | 'godisnji.request.closedOn' | null {
  switch (status) {
    case REQUEST_PENDING:
      return null;
    case REQUEST_APPROVED:
    case REQUEST_REJECTED:
      return 'godisnji.request.decidedOn';
    // 0041: closed on the deactivation's date of writing, as a decision.
    case REQUEST_CLOSED_ON_DEACTIVATION:
      return 'godisnji.request.closedOn';
    case REQUEST_WITHDRAWN:
      return 'godisnji.request.withdrawnOn';
    default: {
      const unhandled: never = status;

      return unhandled;
    }
  }
}

// -------------------------------------------------- the sent line (9.3)

/** The history state the form hands *Godišnji* after a landed send: the range sent. */
export const LEAVE_REQUEST_SENT_STATE = 'leaveRequestSent';

/** What the status line on *Godišnji* names. */
export interface LeaveRequestSent {
  readonly from: string;
  readonly to: string;
}

/** The entry's state with `sent` added under {@link LEAVE_REQUEST_SENT_STATE}, every other field kept. */
export function withLeaveRequestSent<State extends object>(state: State, sent: LeaveRequestSent): State {
  return { ...state, [LEAVE_REQUEST_SENT_STATE]: sent };
}

/** The entry's state without the sent line: what a reload finds. */
export function withoutLeaveRequestSent(state: unknown): Record<string, unknown> {
  if (typeof state !== 'object' || state === null) return {};

  const { [LEAVE_REQUEST_SENT_STATE]: _sent, ...rest } = state as Record<string, unknown>;

  return rest;
}

/** The sent line's range from router state as it came back, or null for none or anything malformed. */
export function leaveRequestSentOf(state: unknown): LeaveRequestSent | null {
  if (typeof state !== 'object' || state === null) return null;

  const sent: unknown = (state as Record<string, unknown>)[LEAVE_REQUEST_SENT_STATE];

  if (typeof sent !== 'object' || sent === null) return null;

  const { from, to } = sent as Record<string, unknown>;

  if (typeof from !== 'string' || typeof to !== 'string' || formatIsoDate(from) === null || formatIsoDate(to) === null) {
    return null;
  }

  return { from, to };
}

/** The sent range's dates as the line names them, `23.09.2026`. */
export function leaveRequestSentValuesOf(sent: LeaveRequestSent): { readonly from: string; readonly to: string } {
  return leaveRangeValuesOf(sent);
}

/** What the sent line does on one location: what it shows, and whether the entry is cleared. */
export interface LeaveRequestSentStep {
  readonly shown: LeaveRequestSent | null;
  readonly clear: boolean;
  readonly clearing: boolean;
}

/**
 * The sent line on one location (the *Za odluku* saved line's rule): a
 * location that brings it shows it and clears it off the entry, so a reload or
 * Back finds none; the clearing replace keeps it; any other location drops it.
 */
export function leaveRequestSentStepOf(
  shown: LeaveRequestSent | null,
  state: unknown,
  clearing: boolean,
): LeaveRequestSentStep {
  const arrived = leaveRequestSentOf(state);

  if (arrived !== null) return { shown: arrived, clear: true, clearing: true };
  if (clearing) return { shown, clear: false, clearing: false };

  return { shown: null, clear: false, clearing: false };
}
