import {
  leaveBalanceOf,
  leaveChargeOf,
  leavePreviewOf,
  leaveRangeCostOf,
  leaveYearOf,
  type LeaveAllowance,
  type LeaveBalance,
  type LeaveBalanceInput,
  type LeaveCarryOver,
  type LeavePreview,
  type LeaveRange,
  type LeaveYearStart,
} from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { calendarTodayOf, memberScheduleInputOf, type CalendarMemberHistory } from '@/features/calendar/utils/month';
import type { LeaveRecord, LeaveRecordsState } from '@/features/leave/services/leave-list';
import { carryOverOf, type CarryOverSetting } from '@/features/organization/services/snapshot';
import { RANGE_DASH, formatIsoDate } from '@/lib/i18n/format';

/**
 * What the leave card stands on (story 5.1c): its four sources, the base
 * drawn from them, the balance input and the record rows, the leave year's
 * start and carry-over as the organization answers them. Split out of
 * `leave-section.ts` (epic 13 retro A8), which re-exports its public names;
 * it imports nothing from there.
 */

// ------------------------------------------------------------- the sources

/**
 * TanStack Query's name for a fetch it has not started (offline). Exported for
 * `leave-section-replacements.ts` only; not part of the card's public face.
 */
export const FETCH_PAUSED = 'paused';

/**
 * The member list's state, as far as the card reads it: each member's
 * allowance across leave years (story 13.3), which the balance resolves for
 * the leave year it counts.
 */
export interface LeaveMembersSource {
  readonly members: readonly { readonly id: string; readonly leaveAllowance: LeaveAllowance }[] | null;
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

/**
 * The organization snapshot's answer, as far as the leave year needs it: its
 * start, and the carry-over setting (story 13.4b). A snapshot without the
 * setting — a cache or fixture from before 13.4 — reads as no carry-over.
 */
export type LeaveOrganizationAnswer =
  | {
      readonly ok: true;
      readonly snapshot: {
        readonly leaveYearStartMonth: number;
        readonly leaveYearStartDay: number;
        readonly carryOver?: CarryOverSetting | null;
      };
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
  /** The domain's `leaveRangeCostOf` over the whole record: 0.5 for a half day (story 13.5). */
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
 * soonest first — each costed by `leaveRangeCostOf` over the member's
 * schedule, a half day at 0.5 (story 13.5),
 * and its in-year part by `leavePreviewOf` against every other record.
 * Throws what the domain throws, so a record it will not cost makes the
 * whole card unavailable.
 */
export function leaveRecordRowsOf(input: LeaveRecordsInput): readonly LeaveRecordRow[] {
  return input.records.map((record) => {
    const values = leaveRangeValuesOf(record);
    // The record's own drawing flag (story 13.2): a type that does not draw
    // charges the balance nothing.
    const range = leaveChargeOf(record);
    const others = input.records.filter((other) => other.id !== record.id);

    return {
      record,
      from: values.from,
      to: values.to,
      label: `${values.from}${RANGE_DASH}${values.to}`,
      // A half day costs 0.5 (story 13.5).
      costDays: leaveRangeCostOf(input.input, record),
      // A type that does not draw has no in-year charge to state: no part, never `0` (story 13.2).
      inYearDays: record.drawsAllowance ? leaveInYearChargeOf(leavePreviewOf({ ...input, records: others, range })) : null,
    };
  });
}

/**
 * The leave year the card's heading names (story 7.11): the year it begins
 * in, and the year it ends in when it crosses New Year (`null` otherwise) —
 * *Godišnji odmor 2026.* or *Godišnji odmor 2026./2027.* `null` until the
 * card is ready, when the heading is plain *Godišnji odmor*.
 */
export interface LeaveHeadingYears {
  readonly from: string;
  readonly to: string | null;
}

export function leaveHeadingYearsOf(base: MemberLeaveBase): LeaveHeadingYears | null {
  if (base.kind !== LEAVE_READY) return null;

  const year = leaveYearOf(base.input.today, base.input.leaveYearStart);
  const from = year.from.slice(0, 4);
  const to = year.to.slice(0, 4);

  return { from, to: from === to ? null : to };
}

/** Where the leave year begins, or null while it is not known. */
export function leaveYearStartOf(answer: LeaveOrganizationAnswer): LeaveYearStart | null {
  return answer !== undefined && answer.ok
    ? { month: answer.snapshot.leaveYearStartMonth, day: answer.snapshot.leaveYearStartDay }
    : null;
}

/**
 * The carry-over setting every balance input passes (story 13.4b), read as
 * `carryOverOf` reads it: a missing field, a partial or an impossible one is
 * none, so an old cache or fixture keeps every figure as before.
 */
export function leaveCarryOverOf(answer: LeaveOrganizationAnswer): LeaveCarryOver | null {
  return answer !== undefined && answer.ok ? carryOverOf({ carryOver: answer.snapshot.carryOver ?? null }) : null;
}

/**
 * The part of the range charged to the current leave year, when it differs
 * from the range's whole cost — a range crossing the leave year's start or
 * end — so the balance after it reads true; null when the two agree.
 */
export function leaveInYearChargeOf(preview: LeavePreview): number | null {
  return preview.costInYearDays === preview.costDays ? null : preview.costInYearDays;
}

/**
 * One member's balance input over their live records (epic 13 retro A8): the
 * calendar's one schedule recipe for `history`, their allowance across leave
 * years (story 13.3), their records, today in the organization's zone at
 * `now`, the leave year and the carry-over setting (story 13.4b). The admin
 * card and *Godišnji* both build theirs here. Throws what the schedule recipe
 * throws.
 */
export function leaveRecordsInputOf(
  snapshot: CalendarSnapshot,
  history: CalendarMemberHistory,
  allowance: LeaveAllowance,
  records: readonly LeaveRecord[],
  leaveYearStart: LeaveYearStart,
  carryOver: LeaveCarryOver | null,
  now: Date,
): LeaveRecordsInput {
  return {
    input: memberScheduleInputOf(snapshot, history),
    allowance,
    records,
    today: calendarTodayOf(snapshot, now),
    leaveYearStart,
    carryOver,
  };
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

  const input = leaveRecordsInputOf(
    snapshot,
    { ...scheduled, memberId: scheduled.id },
    member.leaveAllowance,
    recorded,
    leaveYearStart,
    leaveCarryOverOf(organization.data),
    now,
  );

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
