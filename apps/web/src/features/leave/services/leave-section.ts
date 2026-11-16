import { LEAVE_HALF_FIRST, LEAVE_HALF_SECOND, type LeaveHalf, type LeaveRange } from '@shift/domain';

import type { AbsenceTypeRow } from '@/features/absence-types/services/list';
import {
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  type LeaveRecordRow,
} from '@/features/leave/services/leave-section-base';
import {
  CARRIED_KEPT,
  CARRIED_LAPSED,
  CARRIED_PENDING,
  type LeaveCarriedKind,
} from '@/features/leave/services/leave-section-carried';
import { LEAVE_AMEND_ACTION, LEAVE_REMOVE_ACTION, type LeaveFailure } from '@/features/leave/services/leave-section-outcome';
import {
  LEAVE_HALF_REFUSED,
  LEAVE_HALF_UNCHOSEN,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_RANGE_UNCHANGED,
  LEAVE_TYPE_UNCHOSEN,
  type LeaveRangeReason,
} from '@/features/leave/services/leave-section-preview';
import { LEAVE_DENIED, LEAVE_FAILED, LEAVE_GONE, LEAVE_OVERLAP } from '@/features/leave/services/leave-write';

/**
 * The member page's leave card (story 5.1c) as a pure view model, in `.ts`
 * modules that render nothing (AD-15). Since epic 13 retro A8 this module is
 * the card's public face and its words: every key picker of the card, and
 * the rest re-exported by name from the `leave-section-*.ts` modules below.
 * The hook only wires these; the node suite executes them through here.
 *
 * ONE COMPUTATION. Every figure and every day count is `@shift/domain`'s —
 * `leaveBalanceOf`, `leavePreviewOf`, `daysBetween` — over the calendar's one
 * schedule recipe; none of these modules does date arithmetic of its own.
 *
 * NEVER A GUESS. A read that failed, or a refetch paused offline, makes the
 * whole card unavailable, and a domain precondition the data breaches does
 * too. Codes and numbers only; the card formats.
 */

/*
 * THE CARD'S WORDS LIVE HERE, its rules beside it (epic 13 retro A8): this
 * module holds every key picker of the card — so `LEAVE_SECTION_KEYS` reads
 * one file — and re-exports, by name, the rest from the `leave-section-*.ts`
 * modules: the DOM ids (`-ids`), the sources and the base (`-base`), the
 * carried line (`-carried`), the half day (`-half`), the absence type
 * (`-types`), the preview (`-preview`), the replacement guard
 * (`-replacements`), the outcome (`-outcome`) and the hand-off (`-handoff`).
 * None of them holds a key literal or imports this module. Two names are
 * deliberately NOT re-exported, so the public list stays as it was:
 * `leaveRecordsInputOf` (`my-leave.ts` imports it from `-base`) and
 * `FETCH_PAUSED` (`-replacements` imports it from `-base`).
 */

export {
  LEAVE_DIALOG_HEADING_ID,
  LEAVE_ERROR_ID,
  LEAVE_HALF_HINT_ID,
  LEAVE_HALF_LABEL_ID,
  LEAVE_HALF_SWITCH_ID,
  LEAVE_HEADING_ID,
  LEAVE_LINE_SEPARATOR,
  LEAVE_NO_DATE,
  LEAVE_PREVIEW_ID,
  LEAVE_REASON_ID,
  LEAVE_RECORDS_HEADING_ID,
  LEAVE_REMOVE_CLEARS_ID,
  LEAVE_REMOVE_PROMPT_ID,
  LEAVE_REMOVE_REPLACEMENTS_ID,
  LEAVE_TYPE_LABEL_ID,
  leaveHalfSwitchDescribedByOf,
} from '@/features/leave/services/leave-section-ids';

export {
  LEAVE_ABSENT,
  LEAVE_LOADING,
  LEAVE_READY,
  LEAVE_UNAVAILABLE,
  LEAVE_UNSCHEDULED,
  type LeaveCalendarSource,
  leaveCarryOverOf,
  type LeaveHeadingYears,
  leaveHeadingYearsOf,
  leaveInYearChargeOf,
  type LeaveMembersSource,
  type LeaveOrganizationAnswer,
  type LeaveOrganizationSource,
  leaveRangeValuesOf,
  type LeaveRecordRow,
  leaveRecordRowsOf,
  type LeaveRecordsInput,
  leaveYearStartOf,
  type MemberLeaveBase,
  memberLeaveBaseOf,
  type MemberLeaveSources,
} from '@/features/leave/services/leave-section-base';

export {
  CARRIED_KEPT,
  CARRIED_LAPSED,
  CARRIED_PENDING,
  EXCEEDS_AFTER_EXPIRY,
  EXCEEDS_BALANCE,
  type LeaveCarriedKind,
  type LeaveCarriedLine,
  leaveCarriedLineOf,
  type LeaveExceeds,
  leaveExceedsOf,
} from '@/features/leave/services/leave-section-carried';

export {
  LEAVE_WHOLE_DAY,
  type LeaveHalfChoice,
  leaveHalfChoiceOf,
  leaveHalfOfferedOf,
  type LeaveHalfOption,
  leaveHalfOptionsOf,
  leaveHalfRestoredOf,
  leaveSentHalfOf,
} from '@/features/leave/services/leave-section-half';

export {
  LEAVE_TYPES_UNAVAILABLE,
  type LeaveTypeChoice,
  leaveTypeChoiceOf,
  leaveTypeNameOf,
  leaveTypesOf,
  typedLeaveBaseOf,
} from '@/features/leave/services/leave-section-types';

export {
  LEAVE_FROM_FIELD,
  LEAVE_HALF_FIELD,
  LEAVE_HALF_REFUSED,
  LEAVE_HALF_UNCHOSEN,
  LEAVE_PREVIEW_READY,
  LEAVE_PREVIEW_REASON,
  LEAVE_RANGE_INCOMPLETE,
  LEAVE_RANGE_REFUSED,
  LEAVE_RANGE_REVERSED,
  LEAVE_RANGE_TOO_LONG,
  LEAVE_RANGE_UNCHANGED,
  LEAVE_TO_FIELD,
  LEAVE_TYPE_FIELD,
  LEAVE_TYPE_UNCHOSEN,
  type LeaveField,
  leavePreviewInYearOf,
  type LeavePreviewState,
  leavePreviewStateOf,
  type LeaveRangeReason,
} from '@/features/leave/services/leave-section-preview';

export {
  leaveUncoversDate,
  NO_REPLACEMENTS,
  type ReplacementGuard,
  replacementGuardOf,
  replacementLinesShown,
  type ReplacementResolutionsSource,
  REPLACEMENTS_KNOWN,
  REPLACEMENTS_UNAVAILABLE,
  REPLACEMENTS_UNKNOWN,
  type ReplacementWarning,
  replacementWarningsOf,
} from '@/features/leave/services/leave-section-replacements';

export {
  LEAVE_AMEND_ACTION,
  LEAVE_RECORD_ACTION,
  LEAVE_REMOVE_ACTION,
  type LeaveAction,
  leaveAmendedOf,
  leaveConfirmFailureOf,
  leaveConflictOf,
  leaveDescribedByOf,
  type LeaveFailure,
  leaveFormFailureOf,
  leaveInvalidFieldOf,
  leaveListFailureOf,
  leaveOverlapNoteShown,
  leaveRefusalValuesOf,
  type LeaveSaved,
  leaveSavedOf,
} from '@/features/leave/services/leave-section-outcome';

export {
  AMEND_ENDS,
  AMEND_REMOVES,
  AMEND_STARTS,
  amendTargetOf,
  LEAVE_HANDOFF_ORIGIN_STATE,
  LEAVE_HANDOFF_STATE,
  type LeaveHandoff,
  leaveHandoffKeyOf,
  leaveHandoffMissed,
  leaveHandoffOf,
  type LeaveHandoffOpening,
  leaveHandoffOpeningOf,
  type LeaveHandoffOrigin,
  leaveHandoffOriginOf,
  type ResolutionAmendKind,
  type ResolutionAmendTarget,
  withLeaveHandoff,
  withoutLeaveHandoffOpening,
} from '@/features/leave/services/leave-section-handoff';

// ---------------------------------------------------------- the key pickers

/** The removal prompt: the range and its cost, and the in-year part when it differs. */
export function leaveRemovePromptMessageKey(
  row: LeaveRecordRow,
): 'ljudi.leaveRecord.removePrompt' | 'ljudi.leaveRecord.removePromptInYear' {
  return row.inYearDays === null ? 'ljudi.leaveRecord.removePrompt' : 'ljudi.leaveRecord.removePromptInYear';
}

/** The line under a balance's figures: *Preneseno 5 dana (istječu 30.06.)*. Exhaustive. */
export function leaveCarriedLineMessageKey(
  kind: LeaveCarriedKind,
): 'godisnji.carried.pending' | 'godisnji.carried.lapsed' | 'godisnji.carried.kept' {
  switch (kind) {
    case CARRIED_PENDING:
      return 'godisnji.carried.pending';
    case CARRIED_LAPSED:
      return 'godisnji.carried.lapsed';
    case CARRIED_KEPT:
      return 'godisnji.carried.kept';
  }
}

/** The member card's *Preneseno* value: *5 dana (istječu 30.06.)*. Exhaustive. */
export function leaveCarriedDaysMessageKey(
  kind: LeaveCarriedKind,
): 'godisnji.carriedDays.pending' | 'godisnji.carriedDays.lapsed' | 'godisnji.carriedDays.kept' {
  switch (kind) {
    case CARRIED_PENDING:
      return 'godisnji.carriedDays.pending';
    case CARRIED_LAPSED:
      return 'godisnji.carriedDays.lapsed';
    case CARRIED_KEPT:
      return 'godisnji.carriedDays.kept';
  }
}

/** The overview's *Preneseno* cell: *5 (istječu 30.06.)*. Exhaustive. */
export function leaveCarriedCellMessageKey(
  kind: LeaveCarriedKind,
): 'godisnji.overview.carriedCell.pending' | 'godisnji.overview.carriedCell.lapsed' | 'godisnji.overview.carriedCell.kept' {
  switch (kind) {
    case CARRIED_PENDING:
      return 'godisnji.overview.carriedCell.pending';
    case CARRIED_LAPSED:
      return 'godisnji.overview.carriedCell.lapsed';
    case CARRIED_KEPT:
      return 'godisnji.overview.carriedCell.kept';
  }
}

/** The line a base with no figures shows in their place. */
export function leaveBaseMessageKey(
  kind: typeof LEAVE_UNAVAILABLE | typeof LEAVE_UNSCHEDULED,
): 'ljudi.leaveRecord.unavailable' | 'ljudi.leaveRecord.unscheduled' {
  return kind === LEAVE_UNSCHEDULED ? 'ljudi.leaveRecord.unscheduled' : 'ljudi.leaveRecord.unavailable';
}

/** A half card's words: *Prvi dio smjene*, *Drugi dio smjene*. */
export function leaveHalfMessageKey(half: LeaveHalf): 'ljudi.leaveRecord.halfFirst' | 'ljudi.leaveRecord.halfSecond' {
  return half === LEAVE_HALF_FIRST ? 'ljudi.leaveRecord.halfFirst' : 'ljudi.leaveRecord.halfSecond';
}

/**
 * The words a half day's cost reads with in a list (story 13.5): `{days}
 * (prvi dio smjene)` or `(drugi dio smjene)`, the days rendered through
 * `count.days` by the caller, so `0,5 dana` goes through the locale and never
 * reads `0.5`; `null` for a whole day, whose days read alone.
 */
export function leaveCostHalfMessageKey(
  record: LeaveRange,
): 'ljudi.leaveRecord.costHalfFirst' | 'ljudi.leaveRecord.costHalfSecond' | null {
  if (record.half === LEAVE_HALF_FIRST) return 'ljudi.leaveRecord.costHalfFirst';
  if (record.half === LEAVE_HALF_SECOND) return 'ljudi.leaveRecord.costHalfSecond';

  return null;
}

/**
 * The words a half-day REQUEST's range reads with (story 13.5b): `{range}
 * (prvi dio smjene)` or `(drugi dio smjene)`, the range written by the
 * caller; `null` for a whole day, whose range reads alone. One helper for
 * every request surface — *Za odluku*'s row, the request's decision screen
 * and the member's own list — so each names the half the same way. A
 * record's cost keeps {@link leaveCostHalfMessageKey}.
 */
export function leaveRangeHalfMessageKey(
  range: LeaveRange,
): 'ljudi.leaveRecord.rangeHalfFirst' | 'ljudi.leaveRecord.rangeHalfSecond' | null {
  if (range.half === LEAVE_HALF_FIRST) return 'ljudi.leaveRecord.rangeHalfFirst';
  if (range.half === LEAVE_HALF_SECOND) return 'ljudi.leaveRecord.rangeHalfSecond';

  return null;
}

/** A half-day range's words, `{range} (prvi dio smjene)` or `(drugi dio smjene)` (story 13.7). */
export type LeaveRangeHalfKey = NonNullable<ReturnType<typeof leaveRangeHalfMessageKey>>;

/** How a surface says a half-day range's words: its own `t`, with the half's key (story 13.7). */
export type LeaveRangeHalfTranslate = (key: LeaveRangeHalfKey, values: { readonly range: string }) => string;

/**
 * `text` — a range's end, or a one-date absence's date, as the surface
 * already writes it — with a half day's half named after it, through
 * `translate` (story 13.7): `10.09.2026 (prvi dio smjene)`. A whole day's
 * `text` comes back unchanged, so its line stays byte-identical. The one
 * helper every leave surface names the half with, so none composes it
 * on its own.
 */
export function leaveHalfNamedOf(translate: LeaveRangeHalfTranslate, text: string, half: LeaveHalf | null | undefined): string {
  const key = leaveRangeHalfMessageKey({ from: text, to: text, half: half ?? null });

  return key === null ? text : translate(key, { range: text });
}

/** The line a reason renders as, in place of the preview. Exhaustive. */
export function leaveReasonMessageKey(
  reason: LeaveRangeReason,
):
  | 'ljudi.leaveRecord.incomplete'
  | 'ljudi.leaveRecord.reversed'
  | 'ljudi.leaveRecord.tooLong'
  | 'ljudi.leaveRecord.refused'
  | 'ljudi.leaveRecord.unchanged'
  | 'ljudi.leaveRecord.typeUnchosen'
  | 'ljudi.leaveRecord.halfUnchosen'
  | 'ljudi.leaveRecord.halfRefused' {
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
    case LEAVE_TYPE_UNCHOSEN:
      return 'ljudi.leaveRecord.typeUnchosen';
    case LEAVE_HALF_UNCHOSEN:
      return 'ljudi.leaveRecord.halfUnchosen';
    case LEAVE_HALF_REFUSED:
      return 'ljudi.leaveRecord.halfRefused';
    default: {
      const unhandled: never = reason;

      return unhandled;
    }
  }
}

/** What one type's card says under its name: whether it draws down the allowance (story 13.2b). */
export function leaveTypeDrawsMessageKey(
  type: AbsenceTypeRow,
): 'organization.absenceTypes.draws' | 'organization.absenceTypes.doesNotDraw' {
  // The *Vrste odsutnosti* card's own words for the flag (story 13.1b).
  return type.drawsAllowance ? 'organization.absenceTypes.draws' : 'organization.absenceTypes.doesNotDraw';
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
