import {
  OVERRIDE_CHANGE_AMEND,
  OVERRIDE_CHANGE_ARCHIVED,
  OVERRIDE_CHANGE_CONFIRM,
  OVERRIDE_CHANGE_GONE,
  OVERRIDE_CHANGE_SAME_AS_PROJECTED,
  OVERRIDE_CHANGE_TAKEN,
  type OverrideAmendChange,
  type OverrideChangeRefusal,
  type OverrideConfirmChange,
} from '@/features/conflicts/services/override-erasures';
import {
  DISPOSITION_ARCHIVED,
  DISPOSITION_FAILED,
  DISPOSITION_GONE,
  DISPOSITION_SAME_AS_PROJECTED,
  type DispositionFailure,
  type PendingOverrideRow,
} from '@/features/rotation/services/override-disposition';

/**
 * THE OVERRIDE REVIEW'S ERASURE GUARD, ITS PURE PART (story 5.5h; AD-5): what
 * the builder's review (story 3.5c) hands the shared shift-type override check
 * of `@/features/conflicts/services/override-erasures` (5.5f), and how that
 * check's refusals become the review's own disposition codes. A `.ts` that
 * renders nothing (AD-15), executed by `override-review-erasures.test.ts`; the
 * hook `use-override-review` holds the state and the wiring.
 *
 * CONFIRMING OR AMENDING A PENDING OVERRIDE PUTS IT IN FORCE. A non-working
 * type on a day the rotation works takes every rostered member on leave off a
 * working shift, so their unresolved conflicts would leave the queue unasked.
 * DISCARDING ONE IS NEVER CHECKED (human, 2026-10-05): a pending override is
 * not applied, so taking it away changes nothing that is drawn.
 *
 * THE OVERRIDE IS MATCHED BY ID in the fresh calendar: the review's row and
 * the calendar's override are the same database row.
 */

/** The check of a confirm of `row`'s override. */
export function reviewConfirmChangeOf(row: PendingOverrideRow): OverrideConfirmChange {
  return { kind: OVERRIDE_CHANGE_CONFIRM, overrideId: row.id };
}

/** The check of an amend of `row`'s override to `shiftTypeId` (the preflight's answer). */
export function reviewAmendChangeOf(row: PendingOverrideRow, shiftTypeId: string): OverrideAmendChange {
  return { kind: OVERRIDE_CHANGE_AMEND, overrideId: row.id, shiftTypeId };
}

/**
 * A refusal the check answered, as the review's disposition would have said
 * it: `gone` and `archived` as the database's own refusals, `sameAsProjected`
 * as the amend's preflight. `taken` belongs to a calendar set and no review
 * write should meet it, so meeting it is logged and said as a failure.
 */
export function reviewRefusalOf(code: OverrideChangeRefusal): DispositionFailure {
  if (code === OVERRIDE_CHANGE_GONE) return DISPOSITION_GONE;
  if (code === OVERRIDE_CHANGE_ARCHIVED) return DISPOSITION_ARCHIVED;
  if (code === OVERRIDE_CHANGE_SAME_AS_PROJECTED) return DISPOSITION_SAME_AS_PROJECTED;
  if (code === OVERRIDE_CHANGE_TAKEN) {
    console.error(DISPOSITION_FAILED, code);

    return DISPOSITION_FAILED;
  }

  const unhandled: never = code;

  return unhandled;
}

/**
 * Whether a refusal means the review is stale (`gone`, `archived`): it is
 * read again, the dialog closes and the review says so — the existing path.
 */
export function staleRefusalOf(code: DispositionFailure): boolean {
  return code === DISPOSITION_GONE || code === DISPOSITION_ARCHIVED;
}
