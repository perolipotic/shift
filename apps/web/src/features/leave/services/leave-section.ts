import {
  MAX_LEAVE_RANGE_DAYS,
  daysBetween,
  leaveBalanceOf,
  leaveCostOf,
  leavePreviewOf,
  type LeaveBalance,
  type LeaveBalanceInput,
  type LeavePreview,
  type LeaveRange,
  type LeaveYearStart,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf, memberScheduleInputOf } from '@/features/calendar/utils/month';
import type { LeaveRecord, LeaveRecordsState } from '@/features/leave/services/leave-list';
import {
  LEAVE_DENIED,
  LEAVE_FAILED,
  LEAVE_GONE,
  LEAVE_OVERLAP,
  isCalendarDate,
  type LeaveAmendOutcome,
  type LeaveChangeFailure,
  type LeaveWriteOutcome,
} from '@/features/leave/services/leave-write';
import { RANGE_DASH, formatIsoDate } from '@/lib/i18n/format';

/**
 * The member page's leave card (story 5.1c) as a pure view model, in a `.ts`
 * that renders nothing (AD-15): what the card shows from its four reads, what
 * the entered range would cost, whether a save may be sent, and what each
 * outcome says. The hook only wires these; the node suite executes them.
 * Story 5.2b adds the member's live records as a list, each with what it
 * costs, the amend preview that leaves the amended record out, and what an
 * amend or a removal says.
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
      readonly input: LeaveRecordsInput;
      readonly balance: LeaveBalance;
      /** The member's live records, soonest first, each with what it costs (story 5.2b). */
      readonly rows: readonly LeaveRecordRow[];
    };

/** The balance input over the member's live records, each with the id an amend or a removal names. */
export interface LeaveRecordsInput extends LeaveBalanceInput {
  readonly records: readonly LeaveRecord[];
}

/** One live record as the list shows it: the record, its dates as written, and what it costs. */
export interface LeaveRecordRow {
  readonly record: LeaveRecord;
  /** `10.09.2026`, the first date as the card writes it. */
  readonly from: string;
  /** `14.09.2026`, the last. */
  readonly to: string;
  /** `10.09.2026–14.09.2026`, the two joined by an en dash. */
  readonly label: string;
  /** The domain's `leaveCostOf` over the whole range. */
  readonly costDays: number;
  /**
   * The part of that cost charged to the current leave year, when it differs
   * — a record crossing the leave year's edge or outside it — as 5.1c's
   * preview states it (`leaveInYearChargeOf`); null when the two agree.
   */
  readonly inYearDays: number | null;
}

/** A range's two dates as the card writes them, `23.09.2026`; an unparsable one as it came. */
export function leaveRangeValuesOf(range: LeaveRange): { readonly from: string; readonly to: string } {
  return { from: formatIsoDate(range.from) ?? range.from, to: formatIsoDate(range.to) ?? range.to };
}

/**
 * The records as the list's rows, in the order `leaveRecordsOf` gives them —
 * soonest first — each costed by `leaveCostOf` over the member's schedule,
 * and its in-year part by `leavePreviewOf` against every other record.
 * Throws what the domain throws, so a record it will not cost makes the
 * whole card unavailable.
 */
export function leaveRecordRowsOf(input: LeaveRecordsInput): readonly LeaveRecordRow[] {
  return input.records.map((record) => {
    const values = leaveRangeValuesOf(record);
    const range = { from: record.from, to: record.to };
    const others = input.records.filter((other) => other.id !== record.id);

    return {
      record,
      from: values.from,
      to: values.to,
      label: `${values.from}${RANGE_DASH}${values.to}`,
      costDays: leaveCostOf(input.input, record.from, record.to),
      inYearDays: leaveInYearChargeOf(leavePreviewOf({ ...input, records: others, range })),
    };
  });
}

/** The removal prompt: the range and its cost, and the in-year part when it differs. */
export function leaveRemovePromptMessageKey(
  row: LeaveRecordRow,
): 'ljudi.leaveRecord.removePrompt' | 'ljudi.leaveRecord.removePromptInYear' {
  return row.inYearDays === null ? 'ljudi.leaveRecord.removePrompt' : 'ljudi.leaveRecord.removePromptInYear';
}

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

  const input: LeaveRecordsInput = {
    input: memberScheduleInputOf(snapshot, { ...scheduled, memberId: scheduled.id }),
    allowanceDays: member.leaveAllowanceDays,
    records: recorded,
    today: calendarTodayOf(snapshot, now),
    leaveYearStart,
  };

  try {
    return {
      kind: LEAVE_READY,
      organizationId: snapshot.organizationId,
      input,
      balance: leaveBalanceOf(input),
      rows: leaveRecordRowsOf(input),
    };
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
/** An amend to the range the record already holds: nothing to change, so it is not sent. */
export const LEAVE_RANGE_UNCHANGED = 'unchanged';

export type LeaveRangeReason =
  | typeof LEAVE_RANGE_INCOMPLETE
  | typeof LEAVE_RANGE_REVERSED
  | typeof LEAVE_RANGE_TOO_LONG
  | typeof LEAVE_RANGE_REFUSED
  | typeof LEAVE_RANGE_UNCHANGED;

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

/** The records list's heading id, which names its section (story 5.2b). */
export const LEAVE_RECORDS_HEADING_ID = 'member-leave-records-heading';

/** The removal prompt's id, which names its confirmation (story 5.2b). */
export const LEAVE_REMOVE_PROMPT_ID = 'member-leave-remove-prompt';

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
 * of a preview while either date is incomplete, an amend leaves the range as
 * it was, the range is reversed, it is longer than
 * {@link MAX_LEAVE_RANGE_DAYS}, or the domain refuses to cost it; otherwise
 * `leavePreviewOf`'s figures. Only a ready preview may be sent.
 *
 * AN AMEND (story 5.2b) previews against every record but the one amended:
 * its own dates are no overlap, and what it cost now is given back before the
 * new range is charged.
 */
export function leavePreviewStateOf(
  input: LeaveRecordsInput,
  from: string,
  to: string,
  amending: LeaveRecord | null = null,
): LeavePreviewState {
  if (!isCalendarDate(from)) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_INCOMPLETE, field: LEAVE_FROM_FIELD };
  if (!isCalendarDate(to)) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_INCOMPLETE, field: LEAVE_TO_FIELD };
  if (amending !== null && from === amending.from && to === amending.to) {
    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_UNCHANGED, field: LEAVE_FROM_FIELD };
  }
  if (to < from) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_REVERSED, field: LEAVE_TO_FIELD };
  if (daysBetween(from, to) + 1 > MAX_LEAVE_RANGE_DAYS) {
    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_TOO_LONG, field: LEAVE_TO_FIELD };
  }

  const range = { from, to };
  const records = amending === null ? input.records : input.records.filter((record) => record.id !== amending.id);

  try {
    return { kind: LEAVE_PREVIEW_READY, range, preview: leavePreviewOf({ ...input, records, range }) };
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
  | 'ljudi.leaveRecord.refused'
  | 'ljudi.leaveRecord.unchanged' {
  switch (reason) {
    case LEAVE_RANGE_INCOMPLETE:
      return 'ljudi.leaveRecord.incomplete';
    case LEAVE_RANGE_REVERSED:
      return 'ljudi.leaveRecord.reversed';
    case LEAVE_RANGE_TOO_LONG:
      return 'ljudi.leaveRecord.tooLong';
    case LEAVE_RANGE_REFUSED:
      return 'ljudi.leaveRecord.refused';
    case LEAVE_RANGE_UNCHANGED:
      return 'ljudi.leaveRecord.unchanged';
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

/** The saved line with no figure. */
const PLAIN_SAVED: LeaveSaved = { costDays: null, overBalanceDays: null };

/**
 * The status line of a landed save, from the records the re-read after it
 * answered (`fresh`, null when it did not): the domain's preview of the saved
 * range against every other fresh record, so the balance it is charged to is
 * the database's, with the new record in it. A plain line — no figure — when
 * the re-read did not answer, the saved range is not among the fresh records,
 * or the domain refuses them.
 */
export function leaveSavedOf(input: LeaveBalanceInput, fresh: readonly LeaveRange[] | null, range: LeaveRange): LeaveSaved {
  if (fresh === null) return PLAIN_SAVED;

  const others = fresh.filter((record) => record.from !== range.from || record.to !== range.to);

  if (others.length !== fresh.length - 1) return PLAIN_SAVED;

  return savedAgainst(input, others, range);
}

/**
 * The status line of a landed amend (story 5.2b): the replacement record,
 * found in the fresh records by the id the amend returned, previewed against
 * every other fresh record — so its cost and any over-balance warning are the
 * database's. A plain line when the re-read did not answer, holds no record
 * of that id, or the domain refuses them.
 */
export function leaveAmendedOf(input: LeaveBalanceInput, fresh: readonly LeaveRecord[] | null, id: string): LeaveSaved {
  if (fresh === null) return PLAIN_SAVED;

  const replacement = fresh.find((record) => record.id === id);

  if (replacement === undefined) return PLAIN_SAVED;

  return savedAgainst(
    input,
    fresh.filter((record) => record.id !== id),
    { from: replacement.from, to: replacement.to },
  );
}

/** What `range` cost against `others`, and how far over the balance it went; plain when the domain refuses. */
function savedAgainst(input: LeaveBalanceInput, others: readonly LeaveRange[], range: LeaveRange): LeaveSaved {
  try {
    const preview = leavePreviewOf({ ...input, records: others, range });

    return { costDays: preview.costDays, overBalanceDays: preview.exceedsBalance ? preview.balanceAfterDays : null };
  } catch (cause) {
    console.error(LEAVE_UNAVAILABLE, cause);

    return PLAIN_SAVED;
  }
}

/** A new record saved through the form. */
export const LEAVE_RECORD_ACTION = 'record';
/** A record amended through the form (story 5.2b). */
export const LEAVE_AMEND_ACTION = 'amend';
/** A record removed through its confirmation (story 5.2b). */
export const LEAVE_REMOVE_ACTION = 'remove';

export type LeaveAction = typeof LEAVE_RECORD_ACTION | typeof LEAVE_AMEND_ACTION | typeof LEAVE_REMOVE_ACTION;

/**
 * Why a write did not land, which write it was, and the conflicting record
 * when an overlap named one. Only an amend or a removal can find its record
 * gone.
 */
export interface LeaveFailure {
  readonly code: LeaveChangeFailure;
  readonly action: LeaveAction;
  readonly conflict: LeaveRange | null;
}

/** The conflicting record an outcome names: an overlap's, when it could be read. */
export function leaveConflictOf(outcome: LeaveWriteOutcome | LeaveAmendOutcome): LeaveRange | null {
  return !outcome.ok && outcome.code === LEAVE_OVERLAP ? outcome.conflict : null;
}

/** The alert a failure renders as: denied and failed in the words of the write that failed. Exhaustive. */
export function leaveRefusalMessageKey(
  failure: LeaveFailure,
):
  | 'ljudi.leaveRecord.overlap'
  | 'ljudi.leaveRecord.overlapConflict'
  | 'ljudi.leaveRecord.denied'
  | 'ljudi.leaveRecord.failed'
  | 'ljudi.leaveRecord.amendDenied'
  | 'ljudi.leaveRecord.amendFailed'
  | 'ljudi.leaveRecord.removeDenied'
  | 'ljudi.leaveRecord.removeFailed'
  | 'ljudi.leaveRecord.gone' {
  const code = failure.code;

  switch (code) {
    case LEAVE_OVERLAP:
      return failure.conflict === null ? 'ljudi.leaveRecord.overlap' : 'ljudi.leaveRecord.overlapConflict';
    case LEAVE_DENIED:
      return failure.action === LEAVE_AMEND_ACTION
        ? 'ljudi.leaveRecord.amendDenied'
        : failure.action === LEAVE_REMOVE_ACTION
          ? 'ljudi.leaveRecord.removeDenied'
          : 'ljudi.leaveRecord.denied';
    case LEAVE_FAILED:
      return failure.action === LEAVE_AMEND_ACTION
        ? 'ljudi.leaveRecord.amendFailed'
        : failure.action === LEAVE_REMOVE_ACTION
          ? 'ljudi.leaveRecord.removeFailed'
          : 'ljudi.leaveRecord.failed';
    case LEAVE_GONE:
      return 'ljudi.leaveRecord.gone';
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

  return leaveRangeValuesOf(conflict);
}

/**
 * The failure the form shows: the record's or the amend's, but never that
 * the amended record is gone — amend mode has closed by then, and the list
 * says so, beside the records it refreshed.
 */
export function leaveFormFailureOf(failure: LeaveFailure | null): LeaveFailure | null {
  return failure?.code === LEAVE_GONE ? null : failure;
}

/**
 * The refusal the list shows (story 5.2b): an amend or a removal that found
 * its record gone, once its form mode or its confirmation has closed. Any
 * other removal refusal stays inside the open confirmation.
 */
export function leaveListFailureOf(
  formFailure: LeaveFailure | null,
  removeFailure: LeaveFailure | null,
  confirming: boolean,
): LeaveFailure | null {
  if (!confirming && removeFailure?.code === LEAVE_GONE) return removeFailure;

  return formFailure?.code === LEAVE_GONE ? formFailure : null;
}

/** The refusal shown inside the open removal confirmation: any but gone, which closes it. */
export function leaveConfirmFailureOf(removeFailure: LeaveFailure | null): LeaveFailure | null {
  return removeFailure?.code === LEAVE_GONE ? null : removeFailure;
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
