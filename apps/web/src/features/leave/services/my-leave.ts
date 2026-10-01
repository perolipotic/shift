import { leaveBalanceOf, type LeaveBalance, type LeaveYearStart } from '@shift/domain';

import { calendarTodayOf, memberScheduleInputOf } from '@/features/calendar/utils/month';
import { leaveRecordsOf } from '@/features/leave/services/leave-list';
import type {
  LeaveCalendarSource,
  LeaveMembersSource,
  LeaveOrganizationAnswer,
  LeaveOrganizationSource,
} from '@/features/leave/services/leave-section';

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
  | { readonly kind: typeof MY_LEAVE_READY; readonly balance: LeaveBalance };

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
    return {
      kind: MY_LEAVE_READY,
      balance: leaveBalanceOf({
        input: memberScheduleInputOf(snapshot, viewer),
        allowanceDays: own.leaveAllowanceDays,
        records: recorded,
        today: calendarTodayOf(snapshot, now),
        leaveYearStart,
      }),
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
