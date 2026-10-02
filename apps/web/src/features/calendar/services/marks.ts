import {
  CALENDAR_UNAVAILABLE,
  type CalendarReadFailure,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';
import type { CalendarMarks } from '@/features/calendar/utils/month';
import { unresolvedOf, type LeaveRowsAnswer } from '@/features/conflicts/services/conflicts-queue';
import { leaveRecordsOf, organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import type { MemberRole } from '@/features/navigation/utils/destinations';

/**
 * The calendar's conflict and leave marks (story 5.3c; UX-DR8, Q21), as a
 * pure model in a `.ts` that renders nothing (AD-15). The hook only wires
 * the read; `@/features/calendar/utils/month` sets the marks on the cells.
 *
 * DERIVED, NEVER STORED (AD-4). An admin's marks are the UNRESOLVED
 * collisions (story 5.4a) from the calendar's one snapshot, the
 * organization's live leave and its live resolutions, through *Raspored*'s
 * own derivation (`unresolvedOf`), so a cell is marked exactly where the
 * queue lists a conflict; the same records' ranges hatch each member's own
 * dates. A member's marks carry NO collision and only their own live leave,
 * read through `my_leave_records()` and parsed against their own id: no other
 * member's leave ever reaches them, and they read no resolution, since they
 * are shown no conflict.
 *
 * NEVER A MONTH WITHOUT ITS MARKS. The calendar waits for its reads: a leave
 * or resolution read that failed, is paused offline, or answered a row that
 * cannot be trusted — and any `RangeError` of the derivation — make the whole
 * calendar unavailable, logged, rather than a month drawn with its marks
 * missing or a resolved conflict still marked.
 */

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** The role whose marks carry every collision and every member's leave. */
const ADMIN_ROLE: MemberRole = 'admin';

/** Still waiting on the leave read, or an admin's resolution read. */
export const MARKS_LOADING = 'loading';
/** A read failed, or what it answered cannot be trusted. */
export const MARKS_UNAVAILABLE = 'unavailable';
/** The marks, ready for the cells. */
export const MARKS_READY = 'ready';

export type CalendarMarksState =
  | { readonly kind: typeof MARKS_LOADING }
  | {
      readonly kind: typeof MARKS_UNAVAILABLE;
      /**
       * Whether reading again can change the answer: true for a read that
       * failed or is paused offline; false for rows that answered but cannot
       * be trusted, or a derivation the domain refused — the same rows would
       * be refused again.
       */
      readonly retryable: boolean;
    }
  | { readonly kind: typeof MARKS_READY; readonly marks: CalendarMarks };

/** Whether the viewer's marks come from the organization's records — an admin — rather than their own. */
export function readsOrganizationLeave(role: MemberRole): boolean {
  return role === ADMIN_ROLE;
}

/**
 * The marks from the snapshot and the leave rows the viewer's role read, as
 * they came back: the organization's for an admin, the viewer's own for a
 * member; and, for an admin, the organization's resolution rows.
 *
 * @throws RangeError when a row cannot be trusted, or on any precondition of
 *   `collisionsOf`.
 */
export function calendarMarksOf(
  snapshot: CalendarSnapshot,
  rows: readonly unknown[],
  resolutionRows: readonly unknown[],
): CalendarMarks {
  const viewer = snapshot.viewer;

  if (!readsOrganizationLeave(viewer.role)) {
    const own = leaveRecordsOf(rows, viewer.memberId);

    if (own === null) throw new RangeError('an own leave record row cannot be trusted');

    return {
      collisions: [],
      leave: new Map([[viewer.memberId, own.map(({ from, to }) => ({ from, to }))]]),
    };
  }

  const records = organizationLeaveRecordsOf(
    rows,
    snapshot.members.map((member) => member.id),
  );

  if (records === null) throw new RangeError('a leave record row cannot be trusted');

  const leave = new Map<string, { readonly from: string; readonly to: string }[]>();

  for (const { memberId, from, to } of records) {
    const ranges = leave.get(memberId);

    if (ranges === undefined) leave.set(memberId, [{ from, to }]);
    else ranges.push({ from, to });
  }

  return { collisions: unresolvedOf(snapshot, records, resolutionRows), leave };
}

/** Whether a read failed or is paused offline, a failed refetch over cached rows included. */
function readFailed(answer: LeaveRowsAnswer): boolean {
  return answer.isError || answer.fetchStatus === FETCH_PAUSED || (!answer.isPending && answer.data === undefined);
}

/**
 * What the leave read — and, for an admin, the resolution read (story 5.4a);
 * a member's are not read, and pass `null`; an admin's `null` is unavailable — give the calendar
 * once the snapshot is in: unavailable when either failed or is paused
 * offline, or its rows are refused; loading while either is pending;
 * otherwise the marks. A `RangeError` is logged and is unavailable; nothing
 * else is caught.
 */
export function calendarMarksStateOf(
  snapshot: CalendarSnapshot,
  answer: LeaveRowsAnswer,
  resolutions: LeaveRowsAnswer | null,
): CalendarMarksState {
  if (readFailed(answer) || (resolutions !== null && readFailed(resolutions))) {
    return { kind: MARKS_UNAVAILABLE, retryable: true };
  }

  const admin = readsOrganizationLeave(snapshot.viewer.role);

  // An admin's marks are never drawn without their resolutions. A `null` for
  // an admin means the read was never wired to this role — a snapshot whose
  // role changed under the hook — so it is unavailable, logged, and reading
  // again (the snapshot first) is what can mend it; never a skeleton forever.
  if (admin && resolutions === null) {
    console.error(MARKS_UNAVAILABLE, 'resolutions');

    return { kind: MARKS_UNAVAILABLE, retryable: true };
  }

  // A member is shown no conflict, so reads no resolution.
  const resolutionRows = admin ? resolutions?.data : [];

  if (answer.data === undefined || resolutionRows === undefined) return { kind: MARKS_LOADING };

  try {
    return { kind: MARKS_READY, marks: calendarMarksOf(snapshot, answer.data, resolutionRows) };
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;

    console.error(MARKS_UNAVAILABLE, cause);

    return { kind: MARKS_UNAVAILABLE, retryable: false };
  }
}

/** What the calendar refuses to draw, and whether its alert offers a retry. */
export interface CalendarRefusal {
  readonly refusal: CalendarReadFailure | null;
  /** Only for a read that failed or is paused offline: reading again cannot change a deterministic refusal. */
  readonly retryable: boolean;
}

/**
 * The calendar's one refusal from its three sources, first wins: the
 * snapshot read (`calendarSurfaceStateOf`, which refuses only a failed or
 * paused read), the leave read's marks, then the month the domain refused
 * (`calendarMonthOutcomeOf`). The RETRY is offered for a failed or paused
 * read alone — the snapshot's or the leave's — never for rows that cannot be
 * trusted or a month the domain refuses, which reading again leaves as they
 * are.
 */
export function calendarRefusalOf(
  readRefusal: CalendarReadFailure | null,
  marks: CalendarMarksState | null,
  monthRefusal: CalendarReadFailure | null,
): CalendarRefusal {
  if (readRefusal !== null) return { refusal: readRefusal, retryable: true };

  if (marks?.kind === MARKS_UNAVAILABLE) return { refusal: CALENDAR_UNAVAILABLE, retryable: marks.retryable };

  return { refusal: monthRefusal, retryable: false };
}
