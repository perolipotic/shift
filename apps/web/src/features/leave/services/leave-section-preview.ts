import {
  MAX_LEAVE_RANGE_DAYS,
  daysBetween,
  halfDayShiftOf,
  leavePreviewOf,
  type LeavePreview,
  type LeaveRange,
} from '@shift/domain';

import type { LeaveRecord } from '@/features/leave/services/leave-list';
import { leaveInYearChargeOf, type LeaveRecordsInput } from '@/features/leave/services/leave-section-base';
import {
  LEAVE_WHOLE_DAY,
  leaveHalfOfferedOf,
  leaveSentHalfOf,
  type LeaveHalfChoice,
} from '@/features/leave/services/leave-section-half';
import type { LeaveTypeChoice } from '@/features/leave/services/leave-section-types';
import { isIsoDate } from '@/lib/i18n/format';

/**
 * The entered range's preview (story 5.1c): the reasons it is not previewed,
 * the field each is about, and what a ready one would cost. Split out of
 * `leave-section.ts` (epic 13 retro A8), which re-exports its public names;
 * it imports nothing from there.
 */

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

/** No absence type is chosen yet (story 13.2b): nothing is preselected, so nothing is previewed or sent. */
export const LEAVE_TYPE_UNCHOSEN = 'typeUnchosen';

/** *Pola dana* is on and no half is chosen (story 13.5): neither card is preselected. */
export const LEAVE_HALF_UNCHOSEN = 'halfUnchosen';

/**
 * *Pola dana* is on, but the date does not hold exactly one working shift of
 * the member (story 13.5, R4.12): the dialog refuses the half day.
 */
export const LEAVE_HALF_REFUSED = 'halfRefused';

export type LeaveRangeReason =
  | typeof LEAVE_RANGE_INCOMPLETE
  | typeof LEAVE_RANGE_REVERSED
  | typeof LEAVE_RANGE_TOO_LONG
  | typeof LEAVE_RANGE_REFUSED
  | typeof LEAVE_RANGE_UNCHANGED
  | typeof LEAVE_TYPE_UNCHOSEN
  | typeof LEAVE_HALF_UNCHOSEN
  | typeof LEAVE_HALF_REFUSED;

/** The od field. */
export const LEAVE_FROM_FIELD = 'from';
/** The do field. */
export const LEAVE_TO_FIELD = 'to';
/** The absence type's radio card group (story 13.2b). */
export const LEAVE_TYPE_FIELD = 'type';

/** The half day's radio card group (story 13.5). */
export const LEAVE_HALF_FIELD = 'half';

export type LeaveField = typeof LEAVE_FROM_FIELD | typeof LEAVE_TO_FIELD | typeof LEAVE_TYPE_FIELD | typeof LEAVE_HALF_FIELD;

export const LEAVE_PREVIEW_REASON = 'reason';
export const LEAVE_PREVIEW_READY = 'preview';

export type LeavePreviewState =
  | {
      readonly kind: typeof LEAVE_PREVIEW_REASON;
      readonly reason: LeaveRangeReason;
      /** The field the reason is about, which a refused save focuses. */
      readonly field: LeaveField;
    }
  | {
      readonly kind: typeof LEAVE_PREVIEW_READY;
      /** The range, carrying the chosen type's drawing flag, as the domain costs it. */
      readonly range: LeaveRange;
      /** The chosen type, which the write sends (story 13.2b). */
      readonly type: LeaveTypeChoice;
      readonly preview: LeavePreview;
    };

/**
 * What the entered `from`–`to` of the chosen `type` would do, over a ready
 * base: a reason in place of a preview while either date is incomplete, the
 * range is reversed, it is longer than {@link MAX_LEAVE_RANGE_DAYS}, no type
 * is chosen (story 13.2b), an amend leaves both the range and the type as
 * they were, or the domain refuses to cost it; otherwise `leavePreviewOf`'s
 * figures, by the chosen type's drawing flag. Only a ready preview may be
 * sent.
 *
 * AN AMEND (story 5.2b) previews against every record but the one amended:
 * its own dates are no overlap, and what it cost now is given back before the
 * new range is charged. A type-only amend (the same range, another type) is a
 * change (story 13.2b).
 *
 * A STORED HALF (story 13.5b): a request's review passes `refuseHalf` false.
 * The half was checked against the member's schedule when it was sent; the
 * decision is made later against a schedule that may have changed, and is
 * never refused for it — the half then costs what the domain says (0 on a
 * date with no working shift), as a record's does. An amend that KEEPS the
 * record's own half on its own date is never refused for the shift either
 * (epic 13 retro A2): the rotation or an override may since have taken the
 * shift, or doubled it, leaving no single working shift, and the stored half
 * then costs what the domain says. Keeping it skips only the shift refusal,
 * whatever else the amend changes (its type, say). A fresh half (another
 * date, or the other half) is still refused on a date with no single working
 * shift.
 */
export function leavePreviewStateOf(
  input: LeaveRecordsInput,
  from: string,
  to: string,
  type: LeaveTypeChoice | null,
  amending: LeaveRecord | null = null,
  halfChoice: LeaveHalfChoice = LEAVE_WHOLE_DAY,
  refuseHalf = true,
): LeavePreviewState {
  if (!isIsoDate(from)) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_INCOMPLETE, field: LEAVE_FROM_FIELD };
  if (!isIsoDate(to)) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_INCOMPLETE, field: LEAVE_TO_FIELD };
  if (to < from) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_REVERSED, field: LEAVE_TO_FIELD };
  if (daysBetween(from, to) + 1 > MAX_LEAVE_RANGE_DAYS) {
    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_TOO_LONG, field: LEAVE_TO_FIELD };
  }
  if (type === null) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_TYPE_UNCHOSEN, field: LEAVE_TYPE_FIELD };

  // STORY 13.5: the half day, while Od = Do and *Pola dana* is on.
  const half = leaveSentHalfOf(from, to, halfChoice);

  // EPIC 13 RETRO A2: the amended record's own half, on its own date, is never refused for the shift.
  const keepsStoredHalf =
    amending !== null && from === amending.from && to === amending.to && half !== null && half === (amending.half ?? null);

  if (refuseHalf && !keepsStoredHalf && leaveHalfOfferedOf(from, to) && halfChoice.on) {
    // FIRST whether the date can hold a half day at all: with no working
    // shift, or two, no half card is drawn, so asking for one would point at
    // nothing. A domain refusal is the half day's too, never the range's.
    let shift: ReturnType<typeof halfDayShiftOf>;

    try {
      shift = halfDayShiftOf(input.input, from);
    } catch (cause) {
      console.error(LEAVE_RANGE_REFUSED, cause);
      shift = null;
    }

    if (shift === null) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_HALF_REFUSED, field: LEAVE_HALF_FIELD };
    if (half === null) return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_HALF_UNCHOSEN, field: LEAVE_HALF_FIELD };
  }

  // A half-only amend (the same range and type, another half) is a change (story 13.5).
  if (
    amending !== null &&
    from === amending.from &&
    to === amending.to &&
    type.id === amending.absenceTypeId &&
    (amending.half ?? null) === half
  ) {
    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_UNCHANGED, field: LEAVE_FROM_FIELD };
  }

  const range: LeaveRange = { from, to, drawsAllowance: type.drawsAllowance, ...(half === null ? {} : { half }) };
  const records = amending === null ? input.records : input.records.filter((record) => record.id !== amending.id);

  try {
    return { kind: LEAVE_PREVIEW_READY, range, type, preview: leavePreviewOf({ ...input, records, range }) };
  } catch (cause) {
    console.error(LEAVE_RANGE_REFUSED, cause);

    return { kind: LEAVE_PREVIEW_REASON, reason: LEAVE_RANGE_REFUSED, field: LEAVE_FROM_FIELD };
  }
}

/**
 * The in-year line a ready preview states (story 13.2b): none for a type that
 * does not draw — the unchanged-balance line says it instead — else
 * {@link leaveInYearChargeOf}'s.
 */
export function leavePreviewInYearOf(state: { readonly range: LeaveRange; readonly preview: LeavePreview }): number | null {
  return state.range.drawsAllowance === false ? null : leaveInYearChargeOf(state.preview);
}
