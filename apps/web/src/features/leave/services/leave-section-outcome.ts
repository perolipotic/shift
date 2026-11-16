import { leaveChargeOf, leavePreviewOf, type LeaveBalanceInput, type LeavePreview, type LeaveRange } from '@shift/domain';

import type { LeaveRecord } from '@/features/leave/services/leave-list';
import { LEAVE_ERROR_ID, LEAVE_REASON_ID } from '@/features/leave/services/leave-section-ids';
import { LEAVE_UNAVAILABLE, leaveRangeValuesOf } from '@/features/leave/services/leave-section-base';
import { leaveExceedsOf, type LeaveExceeds } from '@/features/leave/services/leave-section-carried';
import { LEAVE_FROM_FIELD, type LeaveField } from '@/features/leave/services/leave-section-preview';
import {
  LEAVE_GONE,
  LEAVE_OVERLAP,
  type LeaveAmendOutcome,
  type LeaveChangeFailure,
  type LeaveWriteOutcome,
} from '@/features/leave/services/leave-write';

/**
 * What a leave write's outcome says (story 5.1c onward): the saved line, the
 * failure and which field it marks and describes. Its refusal's words are
 * `leaveRefusalMessageKey`'s, in `leave-section.ts`. Split out of
 * `leave-section.ts` (epic 13 retro A8), which re-exports its public names;
 * it imports nothing from there.
 */

// ------------------------------------------------------------- the outcome

/** What a landed save says: what it cost, and how far over the balance it went, if it did. */
export interface LeaveSaved {
  /** What the record cost, or null when the re-read after it did not answer: a plain saved line. */
  readonly costDays: number | null;
  /**
   * The over-balance warning of the save (story 13.4b: the balance after it,
   * or the year's balance once the carried days lapse), else null.
   */
  readonly overBalance: LeaveExceeds | null;
}

/** The saved line with no figure. */
const PLAIN_SAVED: LeaveSaved = { costDays: null, overBalance: null };

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

  // A half day is one date, so its date alone finds it among the fresh records.
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
    leaveChargeOf(replacement),
  );
}

/** What `range` cost against `others`, and how far over the balance it went; plain when the domain refuses. */
function savedAgainst(input: LeaveBalanceInput, others: readonly LeaveRange[], range: LeaveRange): LeaveSaved {
  try {
    const preview = leavePreviewOf({ ...input, records: others, range });

    return { costDays: preview.costDays, overBalance: leaveExceedsOf(preview) };
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
