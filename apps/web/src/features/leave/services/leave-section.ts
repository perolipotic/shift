import {
  MAX_LEAVE_RANGE_DAYS,
  daysBetween,
  leaveBalanceOf,
  leavePreviewOf,
  type LeaveBalance,
  type LeaveBalanceInput,
  type LeavePreview,
  type LeaveRange,
  type LeaveYearStart,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf, memberScheduleInputOf } from '@/features/calendar/utils/month';
import type { LeaveRecordsState } from '@/features/leave/services/leave-list';
import {
  LEAVE_DENIED,
  LEAVE_FAILED,
  LEAVE_OVERLAP,
  isCalendarDate,
  type LeaveWriteFailure,
  type LeaveWriteOutcome,
} from '@/features/leave/services/leave-write';
import { formatIsoDate } from '@/lib/i18n/format';

/**
 * The member page's leave card (story 5.1c) as a pure view model, in a `.ts`
 * that renders nothing (AD-15): what the card shows from its four reads, what
 * the entered range would cost, whether a save may be sent, and what each
 * outcome says. The hook only wires these; the node suite executes them.
 *
 * ONE COMPUTATION. Every figure and every day count is `@shift/domain`'s —
 * `leaveBalanceOf` for the three figures, `leavePreviewOf` for the range and
 * for what a landed save cost, `daysBetween` for the 366-day cap — over the
 * calendar's one schedule recipe (`memberScheduleInputOf`), the member's
 * allowance, the organization's leave year and today, and the member's live
 * records. Nothing here does date arithmetic of its own.
 *
 * NEVER A GUESS. A read that failed, or a refetch paused offline, makes the
 * whole card unavailable, and a domain precondition the data breaches does
 * too; no figure is drawn from rows that cannot be trusted. Codes and numbers
 * only; the card formats.
 */

// ------------------------------------------------------------- the sources

/** TanStack Query's name for a fetch it has not started (offline). */
const FETCH_PAUSED = 'paused';

/** The member list's state, as far as the card reads it. */
export interface LeaveMembersSource {
  readonly members: readonly { readonly id: string; readonly leaveAllowanceDays: number }[] | null;
  readonly refusal: string | null;
  readonly loading: boolean;
  /** A refetch paused offline over cached members: never computed from. */
  readonly paused: boolean;
}

/** The calendar's state: a refusal, or a paused refetch, leaves no snapshot and is not loading. */
export interface LeaveCalendarSource {
  readonly snapshot: CalendarSnapshot | null;
  readonly loading: boolean;
}

/** The organization snapshot's answer, as far as the leave year needs it. */
export type LeaveOrganizationAnswer =
  | {
      readonly ok: true;
      readonly snapshot: { readonly leaveYearStartMonth: number; readonly leaveYearStartDay: number };
    }
  | { readonly ok: false }
  | undefined;

/** The organization read: its answer, whether it is pending, failed or paused offline. */
export interface LeaveOrganizationSource {
  readonly data: LeaveOrganizationAnswer;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
}

export interface MemberLeaveSources {
  readonly members: LeaveMembersSource;
  readonly calendar: LeaveCalendarSource;
  readonly organization: LeaveOrganizationSource;
  readonly records: LeaveRecordsState;
}

/** Still waiting on a read: skeletons, never a figure. */
export const LEAVE_LOADING = 'loading';
/** A read failed or its rows breach a domain rule: one unavailable line, a retry, the form disabled. */
export const LEAVE_UNAVAILABLE = 'unavailable';
/**
 * The member has no schedule to cost leave against — the calendar holds no
 * such member, or they have never been on a team. Not a failure, so no retry:
 * its own line, the form disabled.
 */
export const LEAVE_UNSCHEDULED = 'unscheduled';
/** The member is not in the list: the basics card already says so, and this card draws nothing. */
export const LEAVE_ABSENT = 'absent';
/** Everything read: the figures, and the input a range is previewed against. */
export const LEAVE_READY = 'ready';

export type MemberLeaveBase =
  | { readonly kind: typeof LEAVE_LOADING }
  | { readonly kind: typeof LEAVE_UNAVAILABLE }
  | { readonly kind: typeof LEAVE_UNSCHEDULED }
  | { readonly kind: typeof LEAVE_ABSENT }
  | {
      readonly kind: typeof LEAVE_READY;
      /** The organization a record is written to: the calendar snapshot's. */
      readonly organizationId: string;
      readonly input: LeaveBalanceInput;
      readonly balance: LeaveBalance;
    };

/** Where the leave year begins, or null while it is not known. */
function leaveYearStartOf(answer: LeaveOrganizationAnswer): LeaveYearStart | null {
  return answer !== undefined && answer.ok
    ? { month: answer.snapshot.leaveYearStartMonth, day: answer.snapshot.leaveYearStartDay }
    : null;
}

/**
 * What the card stands on, from its four reads at `now`: unavailable when any
 * read failed or is paused offline — first, so a failure is never hidden
 * behind another's skeleton — absent when the list holds no such member,
 * loading while any read is pending, unscheduled when the member has no
 * schedule to cost against, and otherwise the balance input and its figures.
 */
export function memberLeaveBaseOf(sources: MemberLeaveSources, memberId: string, now: Date): MemberLeaveBase {
  const { members, calendar, organization, records } = sources;
  const leaveYearStart = leaveYearStartOf(organization.data);
  const failed =
    members.paused ||
    (!members.loading && (members.refusal !== null || members.members === null)) ||
    (!calendar.loading && calendar.snapshot === null) ||
    organization.fetchStatus === FETCH_PAUSED ||
    (!organization.isPending && (organization.isError || leaveYearStart === null)) ||
    (!records.loading && records.records === null);

  if (failed) return { kind: LEAVE_UNAVAILABLE };

  const member = members.members?.find((candidate) => candidate.id === memberId);

  if (members.members !== null && member === undefined) return { kind: LEAVE_ABSENT };

  const snapshot = calendar.snapshot;
  const recorded = records.records;

  if (member === undefined || snapshot === null || leaveYearStart === null || recorded === null) {
    return { kind: LEAVE_LOADING };
  }

  const scheduled = snapshot.members.find((candidate) => candidate.id === memberId);

  if (scheduled === undefined || scheduled.memberships.length === 0) return { kind: LEAVE_UNSCHEDULED };

  const input: LeaveBalanceInput = {
    input: memberScheduleInputOf(snapshot, { ...scheduled, memberId: scheduled.id }),
    allowanceDays: member.leaveAllowanceDays,
    records: recorded,
    today: calendarTodayOf(snapshot, now),
    leaveYearStart,
  };

  try {
    return { kind: LEAVE_READY, organizationId: snapshot.organizationId, input, balance: leaveBalanceOf(input) };
  } catch (cause) {
    console.error(LEAVE_UNAVAILABLE, cause);

    return { kind: LEAVE_UNAVAILABLE };
  }
}

/** The line a base with no figures shows in their place. */
export function leaveBaseMessageKey(
  kind: typeof LEAVE_UNAVAILABLE | typeof LEAVE_UNSCHEDULED,
): 'ljudi.leaveRecord.unavailable' | 'ljudi.leaveRecord.unscheduled' {
  return kind === LEAVE_UNSCHEDULED ? 'ljudi.leaveRecord.unscheduled' : 'ljudi.leaveRecord.unavailable';
}

// --------------------------------------------------------------- the range

/** A date is empty or not a calendar date: nothing to cost yet. */
export const LEAVE_RANGE_INCOMPLETE = 'incomplete';
/** The last date is before the first. */
export const LEAVE_RANGE_REVERSED = 'reversed';
/** The range is longer than `MAX_LEAVE_RANGE_DAYS`. */
export const LEAVE_RANGE_TOO_LONG = 'tooLong';
/** `@shift/domain` refused to cost the range: it cannot be previewed, so it is not sent. */
export const LEAVE_RANGE_REFUSED = 'refused';

export type LeaveRangeReason =
  | typeof LEAVE_RANGE_INCOMPLETE
  | typeof LEAVE_RANGE_REVERSED
  | typeof LEAVE_RANGE_TOO_LONG
  | typeof LEAVE_RANGE_REFUSED;

/** The od field. */
export const LEAVE_FROM_FIELD = 'from';
/** The do field. */
export const LEAVE_TO_FIELD = 'to';

export type LeaveField = typeof LEAVE_FROM_FIELD | typeof LEAVE_TO_FIELD;

/** An empty date field: nothing entered yet, or cleared after a landed save. */
export const LEAVE_NO_DATE = '';

/** The refusal's id, which the od field is described by while it stands. */
export const LEAVE_ERROR_ID = 'member-leave-error';

/** The card's heading id, which names its region. */
export const LEAVE_HEADING_ID = 'member-leave-heading';

/** The reason's id, which the field it names is described by while that field is marked. */
export const LEAVE_REASON_ID = 'member-leave-reason';

export const LEAVE_PREVIEW_REASON = 'reason';
export const LEAVE_PREVIEW_READY = 'preview';

export type LeavePreviewState =
  | {
      readonly kind: typeof LEAVE_PREVIEW_REASON;
      readonly reason: LeaveRangeReason;
      /** The field the reason is about, which a refused save focuses. */
      readonly field: LeaveField;
    }
  | { readonly kind: typeof LEAVE_PREVIEW_READY; readonly range: LeaveRange; readonly preview: LeavePreview };

/**
 * What the entered `from`–`to` would do, over a ready base: a reason in place
 * of a preview while either date is incomplete, the range is reversed, it is
 * longer than {@link MAX_LEAVE_RANGE_DAYS}, or the domain refuses to cost it;
 * otherwise `leavePreviewOf`'s figures. Only a ready preview may be sent.
 */
export function leavePreviewStateOf(input: LeaveBalanceInput, from: string, to: string): LeavePreviewState {
  if (!isCalendarDate(from)) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_INCOMPLETE, field: LEAVE_FROM_FIELD };
  if (!isCalendarDate(to)) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_INCOMPLETE, field: LEAVE_TO_FIELD };
  if (to < from) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_REVERSED, field: LEAVE_TO_FIELD };
  if (daysBetween(from, to) + 1 > MAX_LEAVE_RANGE_DAYS) {
    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_TOO_LONG, field: LEAVE_TO_FIELD };
  }

  const range = { from, to };

  try {
    return { kind: LEAVE_PREVIEW_READY, range, preview: leavePreviewOf({ ...input, range }) };
  } catch (cause) {
    console.error(LEAVE_RANGE_REFUSED, cause);

    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_REFUSED, field: LEAVE_FROM_FIELD };
  }
}

/** The line a reason renders as, in place of the preview. Exhaustive. */
export function leaveReasonMessageKey(
  reason: LeaveRangeReason,
):
  | 'ljudi.leaveRecord.incomplete'
  | 'ljudi.leaveRecord.reversed'
  | 'ljudi.leaveRecord.tooLong'
  | 'ljudi.leaveRecord.refused' {
  switch (reason) {
    case LEAVE_RANGE_INCOMPLETE:
      return 'ljudi.leaveRecord.incomplete';
    case LEAVE_RANGE_REVERSED:
      return 'ljudi.leaveRecord.reversed';
    case LEAVE_RANGE_TOO_LONG:
      return 'ljudi.leaveRecord.tooLong';
    case LEAVE_RANGE_REFUSED:
      return 'ljudi.leaveRecord.refused';
    default: {
      const unhandled: never = reason;

      return unhandled;
    }
  }
}

/**
 * The part of the range charged to the current leave year, when it differs
 * from the range's whole cost — a range crossing the leave year's start or
 * end — so the balance after it reads true; null when the two agree.
 */
export function leaveInYearChargeOf(preview: LeavePreview): number | null {
  return preview.costInYearDays === preview.costDays ? null : preview.costInYearDays;
}

// ------------------------------------------------------------- the outcome

/** What a landed save says: what it cost, and how far over the balance it went, if it did. */
export interface LeaveSaved {
  /** What the record cost, or null when the re-read after it did not answer: a plain saved line. */
  readonly costDays: number | null;
  /** The balance after the save when it exceeded the balance (negative), else null. */
  readonly overBalanceDays: number | null;
}

/**
 * The status line of a landed save, from the records the re-read after it
 * answered (`fresh`, null when it did not): the domain's preview of the saved
 * range against every other fresh record, so the balance it is charged to is
 * the database's, with the new record in it. A plain line — no figure — when
 * the re-read did not answer, the saved range is not among the fresh records,
 * or the domain refuses them.
 */
export function leaveSavedOf(input: LeaveBalanceInput, fresh: readonly LeaveRange[] | null, range: LeaveRange): LeaveSaved {
  const plain = { costDays: null, overBalanceDays: null };

  if (fresh === null) return plain;

  const others = fresh.filter((record) => record.from !== range.from || record.to !== range.to);

  if (others.length !== fresh.length - 1) return plain;

  try {
    const preview = leavePreviewOf({ ...input, records: others, range });

    return { costDays: preview.costDays, overBalanceDays: preview.exceedsBalance ? preview.balanceAfterDays : null };
  } catch (cause) {
    console.error(LEAVE_UNAVAILABLE, cause);

    return plain;
  }
}

/** Why a save did not land, and the conflicting record when an overlap named one. */
export interface LeaveFailure {
  readonly code: LeaveWriteFailure;
  readonly conflict: LeaveRange | null;
}

/** The conflicting record an outcome names: an overlap's, when it could be read. */
export function leaveConflictOf(outcome: LeaveWriteOutcome): LeaveRange | null {
  return !outcome.ok && outcome.code === LEAVE_OVERLAP ? outcome.conflict : null;
}

/** The alert a failure renders as. Exhaustive. */
export function leaveRefusalMessageKey(
  failure: LeaveFailure,
):
  | 'ljudi.leaveRecord.overlap'
  | 'ljudi.leaveRecord.overlapConflict'
  | 'ljudi.leaveRecord.denied'
  | 'ljudi.leaveRecord.failed' {
  const code = failure.code;

  switch (code) {
    case LEAVE_OVERLAP:
      return failure.conflict === null ? 'ljudi.leaveRecord.overlap' : 'ljudi.leaveRecord.overlapConflict';
    case LEAVE_DENIED:
      return 'ljudi.leaveRecord.denied';
    case LEAVE_FAILED:
      return 'ljudi.leaveRecord.failed';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}

/**
 * The conflict's dates as the alert names them, `23.09.2026`; undefined for
 * every message without placeholders.
 */
export function leaveRefusalValuesOf(failure: LeaveFailure): { readonly from: string; readonly to: string } | undefined {
  const conflict = failure.code === LEAVE_OVERLAP ? failure.conflict : null;

  if (conflict === null) return undefined;

  return { from: formatIsoDate(conflict.from) ?? conflict.from, to: formatIsoDate(conflict.to) ?? conflict.to };
}

/** Whether the preview's overlap note shows: not while an overlap alert already says it. */
export function leaveOverlapNoteShown(preview: LeavePreview, failure: LeaveFailure | null): boolean {
  return preview.overlapsRecord && failure?.code !== LEAVE_OVERLAP;
}

/**
 * The field marked invalid: the od field after an overlap, which is the one
 * focused, else the field a refused save named, else none.
 */
export function leaveInvalidFieldOf(failure: LeaveFailure | null, refused: LeaveField | null): LeaveField | null {
  return failure?.code === LEAVE_OVERLAP ? LEAVE_FROM_FIELD : refused;
}

/**
 * What a field is described by: the od field by a standing refusal, and a
 * field marked invalid by the reason that names it; nothing otherwise.
 */
export function leaveDescribedByOf(
  field: LeaveField,
  failure: LeaveFailure | null,
  invalid: LeaveField | null,
): typeof LEAVE_ERROR_ID | typeof LEAVE_REASON_ID | undefined {
  if (failure !== null && field === LEAVE_FROM_FIELD) return LEAVE_ERROR_ID;

  return invalid === field ? LEAVE_REASON_ID : undefined;
}
