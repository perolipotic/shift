import type { QueryKey } from '@tanstack/react-query';
import type { LeavePreview } from '@shift/domain';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { actorNamesOf } from '@/features/conflicts/services/resolved-conflicts';
import { leaveConflictsOf, type LeaveConflicts } from '@/features/leave/services/leave-conflicts';
import { LEAVE_RECORDS_KEY, type LeaveRecordsState } from '@/features/leave/services/leave-list';
import {
  REQUEST_APPROVED,
  REQUEST_PENDING,
  REQUEST_REJECTED,
  REQUEST_WITHDRAWN,
  leaveRequestFoundOf,
  type ReviewedLeaveRequest,
} from '@/features/leave/services/leave-request-list';
import {
  REQUEST_APPROVAL_STALE,
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_MEMBER_INACTIVE,
  REQUEST_NOT_PENDING,
  type LeaveRequestDecideFailure,
  type LeaveRequestOutcome,
} from '@/features/leave/services/leave-request-write';
import {
  LEAVE_ABSENT,
  LEAVE_LOADING,
  LEAVE_PREVIEW_REASON,
  LEAVE_READY,
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  leaveInYearChargeOf,
  leavePreviewStateOf,
  leaveRangeValuesOf,
  leaveReasonMessageKey,
  memberLeaveBaseOf,
  type LeaveCalendarSource,
  type LeaveOrganizationSource,
  type ReplacementResolutionsSource,
} from '@/features/leave/services/leave-section';
import {
  LEAVE_REQUEST_APPROVAL_DEPENDENTS,
  LEAVE_REQUEST_REJECTION_DEPENDENTS,
  NO_DEPENDENTS,
} from '@/features/teams/services/dependents';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { formatDate, formatTime } from '@/lib/i18n/format';

/**
 * STORY 9.4: one leave request on its admin decision screen
 * (`/za-odluku/zahtjev/$requestId`), as a pure view model in a `.ts` that
 * renders nothing (AD-15). Codes, keys and operands only; the components
 * format.
 *
 * THE STATES. Loading while a read the screen stands on is unanswered;
 * unavailable when one failed or answered something that cannot be trusted;
 * missing when no request has that id (or the session may not read it);
 * otherwise the request — PENDING, with the preview and both decisions, or
 * CLOSED, read-only, with its decision's admin and time or its withdrawal's
 * date.
 *
 * THE PREVIEW IS THE ADMIN LEAVE DIALOG'S, never a second implementation:
 * `memberLeaveBaseOf` over the member list, the calendar snapshot, the
 * organization snapshot and the member's live records, then
 * `leavePreviewStateOf` for the requested range, then `leaveConflictsOf` for
 * the collisions approval would create (`{ target: null, next: range }`). A
 * base that is not ready — unscheduled, absent, or a read of its own that
 * failed — is its reason line in place of the figures. NOTHING IN THE PREVIEW
 * DISABLES A DECISION: over the balance, over the member's leave, unknown
 * collisions, both buttons stay; the database decides overlap.
 */

/** A read the screen stands on: TanStack's answer, as `useSnapshotFreshness` reshapes it. */
export interface ReviewReadAnswer {
  readonly data: readonly unknown[] | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
}

/** The member list as the screen reads it: each member's name and allowance. */
export interface ReviewMembersSource {
  readonly members: readonly { readonly id: string; readonly name: string; readonly leaveAllowanceDays: number }[] | null;
  readonly refusal: string | null;
  readonly loading: boolean;
  readonly paused: boolean;
}

/** Every read the screen stands on, and whether the calendar snapshot is being re-read. */
export interface LeaveRequestReviewSources {
  /** The request read by its id: unparsed rows. */
  readonly request: ReviewReadAnswer;
  readonly members: ReviewMembersSource;
  readonly calendar: LeaveCalendarSource;
  readonly organization: LeaveOrganizationSource;
  /** The member's live leave records; read only once the request names the member. */
  readonly records: LeaveRecordsState;
  /** The organization's live resolutions, for the collisions. */
  readonly resolutions: ReplacementResolutionsSource;
  /** The acting admins' names (`actingAdminsQueryOptions`): unparsed member rows. */
  readonly actors: ReviewReadAnswer;
  /** The calendar snapshot is being re-read: the collisions it would derive are about to change. */
  readonly calendarRefreshing: boolean;
}

/** Still waiting on a read: the skeleton. */
export const REVIEW_LOADING = 'loading';
/** A read failed, or answered something that cannot be trusted: one alert and a retry. */
export const REVIEW_UNAVAILABLE = 'unavailable';
/** No request has that id: "Zahtjev ne postoji." */
export const REVIEW_MISSING = 'missing';
/** A pending request: the preview, *Odobri* and *Odbij*. */
export const REVIEW_PENDING = 'pending';
/** A decided or withdrawn request: read-only. */
export const REVIEW_CLOSED = 'closed';

/** What every drawn request names: the request, whose it is and its range as written (`05.10.2026`). */
export interface ReviewFacts {
  readonly request: ReviewedLeaveRequest;
  /** The member's name, or null when neither the member list nor the calendar holds them any more. */
  readonly memberName: string | null;
  readonly from: string;
  readonly to: string;
}

/** The base cannot cost the range: its line in place of the figures. */
export const PREVIEW_BASE = 'base';
/** The range cannot be costed (the domain refused it): its reason line. */
export const PREVIEW_REASON = 'reason';
/** The member's records are being re-read: nothing is drawn until they are in. */
export const PREVIEW_REFRESHING = 'refreshing';
/** The figures and the collisions. */
export const PREVIEW_READY = 'ready';

export type ReviewPreview =
  | {
      readonly kind: typeof PREVIEW_BASE;
      readonly key: ReturnType<typeof reviewBaseMessageKey>;
    }
  | { readonly kind: typeof PREVIEW_REASON; readonly key: ReturnType<typeof leaveReasonMessageKey> }
  | { readonly kind: typeof PREVIEW_REFRESHING }
  | {
      readonly kind: typeof PREVIEW_READY;
      readonly figures: LeavePreview;
      /** The part charged to the current leave year, when it differs from the whole cost. */
      readonly inYearDays: number | null;
      /** What approval would create; null when the range shares a date with the member's leave (the overlap note says so). */
      readonly conflicts: LeaveConflicts | null;
    };

/** A closed request's line: who decided and when, or the date it was withdrawn. */
export type ReviewClosedLine =
  | {
      readonly decided: true;
      /** The deciding admin's name, or null when they are no longer a member of the organization. */
      readonly actor: string | null;
      /** `20.09.2026` */
      readonly date: string;
      /** `14:05` */
      readonly time: string;
    }
  | { readonly decided: false; readonly date: string };

export type LeaveRequestReview =
  | { readonly kind: typeof REVIEW_LOADING }
  | { readonly kind: typeof REVIEW_UNAVAILABLE }
  | { readonly kind: typeof REVIEW_MISSING }
  | { readonly kind: typeof REVIEW_PENDING; readonly facts: ReviewFacts; readonly preview: ReviewPreview }
  | { readonly kind: typeof REVIEW_CLOSED; readonly facts: ReviewFacts; readonly line: ReviewClosedLine };

/** The member a request's records are keyed by before the request names one: no member, so the read waits. */
export const REVIEW_NO_MEMBER = '';

/** What the screen logs for an answer it will not draw: never shown. */
export const REVIEW_UNTRUSTED = 'LEAVE_REQUEST_REVIEW_UNTRUSTED';

/**
 * The request the read answered, before any other read is looked at: loading,
 * unavailable, missing, or the request. The page's surface keys follow it (a
 * pending request's preview reads, a decided one's names).
 */
export function reviewedRequestOf(
  answer: ReviewReadAnswer,
  requestId: string,
): ReviewedLeaveRequest | typeof REVIEW_LOADING | typeof REVIEW_UNAVAILABLE | typeof REVIEW_MISSING {
  if (answer.isError) return REVIEW_UNAVAILABLE;
  if (answer.data === undefined) return answer.isPending ? REVIEW_LOADING : REVIEW_UNAVAILABLE;

  const found = leaveRequestFoundOf(answer.data, requestId);

  if (found === null) {
    console.error(REVIEW_UNTRUSTED, 'request');

    return REVIEW_UNAVAILABLE;
  }

  return found.request ?? REVIEW_MISSING;
}

/** The line a base that cannot cost the range shows in place of the figures. Exhaustive. */
export function reviewBaseMessageKey(
  kind: typeof LEAVE_UNAVAILABLE | typeof LEAVE_UNSCHEDULED | typeof LEAVE_ABSENT,
): 'ljudi.leaveRecord.unavailable' | 'ljudi.leaveRecord.unscheduled' | 'zaOdluku.request.absent' {
  switch (kind) {
    case LEAVE_UNAVAILABLE:
      return 'ljudi.leaveRecord.unavailable';
    case LEAVE_UNSCHEDULED:
      return 'ljudi.leaveRecord.unscheduled';
    case LEAVE_ABSENT:
      return 'zaOdluku.request.absent';
    default: {
      const unhandled: never = kind;

      return unhandled;
    }
  }
}

/** A closed request's line in the organization's zone, or null when its instant is none. */
function closedLineOf(request: ReviewedLeaveRequest, actors: readonly unknown[], timeZone: string): ReviewClosedLine | null {
  if (request.decision !== null) {
    const decidedAt = new Date(request.decision.decidedAt);

    if (Number.isNaN(decidedAt.getTime())) return null;

    return {
      decided: true,
      actor: actorNamesOf(actors).get(request.decision.decidedBy) ?? null,
      date: formatDate(decidedAt, timeZone),
      time: formatTime(decidedAt, timeZone),
    };
  }

  const closedAt = request.closedAt === null ? null : new Date(request.closedAt);

  if (request.status !== REQUEST_WITHDRAWN || closedAt === null || Number.isNaN(closedAt.getTime())) return null;

  return { decided: false, date: formatDate(closedAt, timeZone) };
}

/**
 * The pending request's preview, the admin leave dialog's pipeline over the
 * requested range: the base's line while it is not ready, nothing while the
 * records are re-read, the reason when the range cannot be costed, otherwise
 * the figures and the collisions approval would create.
 */
function previewOf(
  sources: LeaveRequestReviewSources,
  snapshot: CalendarSnapshot,
  request: ReviewedLeaveRequest,
  now: Date,
): ReviewPreview | typeof REVIEW_LOADING {
  const base = memberLeaveBaseOf(
    { members: sources.members, calendar: sources.calendar, organization: sources.organization, records: sources.records },
    request.memberId,
    now,
  );

  if (base.kind === LEAVE_LOADING) return REVIEW_LOADING;
  if (base.kind !== LEAVE_READY) return { kind: PREVIEW_BASE, key: reviewBaseMessageKey(base.kind) };
  // NO FIGURE WHILE THE RECORDS ARE RE-READ: what the range costs may be about to change.
  if (sources.records.refreshing) return { kind: PREVIEW_REFRESHING };

  const state = leavePreviewStateOf(base.input, request.from, request.to);

  if (state.kind === LEAVE_PREVIEW_REASON) return { kind: PREVIEW_REASON, key: leaveReasonMessageKey(state.reason) };

  return {
    kind: PREVIEW_READY,
    figures: state.preview,
    inYearDays: leaveInYearChargeOf(state.preview),
    conflicts: leaveConflictsOf(
      sources.resolutions,
      snapshot,
      request.memberId,
      base.input.records,
      { target: null, next: state.range },
      sources.calendarRefreshing,
    ),
  };
}

/**
 * The screen for `requestId` from its reads at `now`. The request read
 * decides first (loading, unavailable, missing); then the member list and the
 * calendar snapshot, which every drawn request stands on — its member's name,
 * and the organization's zone; then a pending request's preview, or a decided
 * one's acting admins' names.
 */
export function leaveRequestReviewOf(
  sources: LeaveRequestReviewSources,
  requestId: string,
  now: Date,
): LeaveRequestReview {
  const request = reviewedRequestOf(sources.request, requestId);

  if (request === REVIEW_LOADING || request === REVIEW_UNAVAILABLE || request === REVIEW_MISSING) return { kind: request };

  const { members, calendar } = sources;

  if (members.paused || members.refusal !== null || (!members.loading && members.members === null)) {
    return { kind: REVIEW_UNAVAILABLE };
  }
  if (!calendar.loading && calendar.snapshot === null) return { kind: REVIEW_UNAVAILABLE };
  if (members.members === null || calendar.snapshot === null) return { kind: REVIEW_LOADING };

  const snapshot = calendar.snapshot;
  const memberName =
    members.members.find((member) => member.id === request.memberId)?.name ??
    snapshot.members.find((member) => member.id === request.memberId)?.name ??
    null;

  // A MEMBER GONE FROM BOTH LISTS is no read to retry: the request is still
  // drawn, under a neutral line, its preview reaches the base's absent reason,
  // and the decisions stay — the database decides.
  const facts: ReviewFacts = { request, memberName, ...leaveRangeValuesOf(request) };

  if (request.status === REQUEST_PENDING) {
    const preview = previewOf(sources, snapshot, request, now);

    return preview === REVIEW_LOADING ? { kind: REVIEW_LOADING } : { kind: REVIEW_PENDING, facts, preview };
  }

  let actors: readonly unknown[] = [];

  if (request.decision !== null) {
    if (sources.actors.isError) return { kind: REVIEW_UNAVAILABLE };
    if (sources.actors.data === undefined) {
      return sources.actors.isPending ? { kind: REVIEW_LOADING } : { kind: REVIEW_UNAVAILABLE };
    }

    actors = sources.actors.data;
  }

  const line = closedLineOf(request, actors, snapshot.timeZone);

  if (line === null) {
    console.error(REVIEW_UNTRUSTED, 'closed');

    return { kind: REVIEW_UNAVAILABLE };
  }

  return { kind: REVIEW_CLOSED, facts, line };
}

/** Whether the request is decided, so its acting admin's name is read: an approved or rejected one. */
export function reviewNeedsActors(request: ReviewedLeaveRequest | null): boolean {
  return request !== null && request.decision !== null;
}

/** Whether the request is pending, so the preview's reads are made for its member. */
export function reviewNeedsPreview(request: ReviewedLeaveRequest | null): boolean {
  return request !== null && request.status === REQUEST_PENDING;
}

// -------------------------------------------------------------- the decision

/** The refusal of a decision as its alert's line. Exhaustive. */
export function reviewFailureMessageKey(
  code: LeaveRequestDecideFailure,
):
  | 'zaOdluku.request.notPending'
  | 'zaOdluku.request.approvalStale'
  | 'zaOdluku.request.memberInactive'
  | 'zaOdluku.request.denied'
  | 'zaOdluku.request.failed' {
  switch (code) {
    case REQUEST_NOT_PENDING:
      return 'zaOdluku.request.notPending';
    case REQUEST_APPROVAL_STALE:
      return 'zaOdluku.request.approvalStale';
    case REQUEST_MEMBER_INACTIVE:
      return 'zaOdluku.request.memberInactive';
    case REQUEST_DENIED:
      return 'zaOdluku.request.denied';
    case REQUEST_FAILED:
      return 'zaOdluku.request.failed';
    default: {
      const unhandled: never = code;

      return unhandled;
    }
  }
}

/**
 * What a decision's outcome makes stale, besides the request itself (the
 * caller's own key): an approval the request keys, everything a leave record
 * saved makes stale and the member's own records; a rejection the request keys
 * alone; a request no longer pending as an approval — another admin may have
 * approved it meanwhile; a stale approval the request keys and the member's
 * records, whose new leave the overlap note then names; an approval refused
 * because the member is inactive on its dates (0041) the request keys; any other refusal
 * nothing more.
 */
export function decisionRefreshKeysOf(
  outcome: LeaveRequestOutcome | LeaveRequestDecideFailure,
  memberId: string,
): readonly QueryKey[] {
  switch (outcome) {
    case REQUEST_APPROVED:
    case REQUEST_NOT_PENDING:
      return [...LEAVE_REQUEST_APPROVAL_DEPENDENTS, LEAVE_RECORDS_KEY(memberId)];
    case REQUEST_REJECTED:
      return LEAVE_REQUEST_REJECTION_DEPENDENTS;
    case REQUEST_APPROVAL_STALE:
      return [...LEAVE_REQUEST_REJECTION_DEPENDENTS, LEAVE_RECORDS_KEY(memberId)];
    // 0041: the member is inactive on a date of it. The request keys, so a
    // deactivation's close, if one landed meanwhile, is read; and the member
    // list and the member's records, so the review re-reads their status.
    case REQUEST_MEMBER_INACTIVE:
      return [...LEAVE_REQUEST_REJECTION_DEPENDENTS, MEMBERS_LIST_KEY, LEAVE_RECORDS_KEY(memberId)];
    case REQUEST_DENIED:
    case REQUEST_FAILED:
      return NO_DEPENDENTS;
    default: {
      const unhandled: never = outcome;

      return unhandled;
    }
  }
}
