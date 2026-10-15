import {
  ROSTER_ARCHIVED,
  ROSTER_CHANGE_AMEND,
  ROSTER_CHANGE_CONFIRM,
  ROSTER_GONE,
  ROSTER_TAKEN,
  rosterErasureCheckOf,
  type RosterAmendChange,
  type RosterChangeRefusal,
  type RosterConfirmChange,
} from '@/features/calendar/services/roster-erasures';
import { replacementCandidatesOf } from '@/features/calendar/utils/replacement-candidates';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import {
  OVERRIDE_CHANGE_AMEND,
  OVERRIDE_CHANGE_ARCHIVED,
  OVERRIDE_CHANGE_CONFIRM,
  OVERRIDE_CHANGE_GONE,
  OVERRIDE_CHANGE_SAME_AS_PROJECTED,
  OVERRIDE_CHANGE_TAKEN,
  overrideErasureCheckOf,
  type OverrideAmendChange,
  type OverrideChangeRefusal,
  type OverrideConfirmChange,
} from '@/features/conflicts/services/override-erasures';
import { organizationLeaveRecordsOf } from '@/features/leave/services/leave-list';
import {
  DISPOSITION_ARCHIVED,
  DISPOSITION_CHANGED,
  DISPOSITION_FAILED,
  DISPOSITION_GONE,
  DISPOSITION_SAME_AS_PROJECTED,
  DISPOSITION_TAKEN,
  REVIEW_SHIFT_TYPE,
  type AmendOptionGroup,
  type DispositionFailure,
  type PendingOverrideRow,
  type PendingRosterOverrideRow,
  type ReviewRow,
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
 * THE ROSTER LAYER (0039), on the same terms: confirming or amending a
 * pending roster override puts it in force, and one that takes a member on
 * leave off a working shift erases their conflict. Its "after" is the
 * calendar roster guard's (`@/features/calendar/services/roster-erasures`,
 * 5.5b), extended by a confirm and an amend; its refusals become the same
 * disposition codes. The amend's choice — who arrives — is the calendar's own
 * candidate rule (`replacementCandidatesOf`, story 5.4c), over the same fresh
 * reads the check stands on.
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

/** The check of a confirm of a roster `row`'s override (0039). */
export function reviewRosterConfirmChangeOf(row: PendingRosterOverrideRow): RosterConfirmChange {
  return { kind: ROSTER_CHANGE_CONFIRM, overrideId: row.id };
}

/** The check of an amend of a roster `row`'s override to put `memberInId` on (the preflight's answer). */
export function reviewRosterAmendChangeOf(row: PendingRosterOverrideRow, memberInId: string): RosterAmendChange {
  return { kind: ROSTER_CHANGE_AMEND, overrideId: row.id, memberInId };
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
 * A refusal the roster check answered (0039), as the review says it: `gone`
 * and `archived` as the definers' own, and `taken` — another live change of
 * the team and date already puts the arriving member on — as 0026's live key.
 */
export function reviewRosterRefusalOf(code: RosterChangeRefusal): DispositionFailure {
  if (code === ROSTER_GONE) return DISPOSITION_GONE;
  if (code === ROSTER_ARCHIVED) return DISPOSITION_ARCHIVED;
  if (code === ROSTER_TAKEN) return DISPOSITION_TAKEN;

  const unhandled: never = code;

  return unhandled;
}

/**
 * Whether a refusal means the review is stale (`gone`, `archived`, `changed`,
 * and for a roster amend `taken`): it is read again, the dialog closes and the
 * review says so — the existing path.
 */
export function staleRefusalOf(code: DispositionFailure): boolean {
  return (
    code === DISPOSITION_GONE || code === DISPOSITION_ARCHIVED || code === DISPOSITION_CHANGED || code === DISPOSITION_TAKEN
  );
}

// ------------------------------------------------------------ either layer

/** What a confirm's or an amend's check stands on, by layer. */
export type ReviewChange =
  | { readonly layer: typeof REVIEW_SHIFT_TYPE; readonly change: OverrideConfirmChange | OverrideAmendChange }
  | { readonly layer: 'roster'; readonly change: RosterConfirmChange | RosterAmendChange };

/** The check of a confirm of a review row of either layer. */
export function reviewedConfirmChangeOf(row: ReviewRow): ReviewChange {
  return row.layer === REVIEW_SHIFT_TYPE
    ? { layer: row.layer, change: reviewConfirmChangeOf(row) }
    : { layer: row.layer, change: reviewRosterConfirmChangeOf(row) };
}

/** The check of an amend of a review row of either layer to `choiceId` (the preflight's answer). */
export function reviewedAmendChangeOf(row: ReviewRow, choiceId: string): ReviewChange {
  return row.layer === REVIEW_SHIFT_TYPE
    ? { layer: row.layer, change: reviewAmendChangeOf(row, choiceId) }
    : { layer: row.layer, change: reviewRosterAmendChangeOf(row, choiceId) };
}

/** A review check's answer, its refusal already the review's own code. */
export type ReviewErasureCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED; readonly code: DispositionFailure }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

/**
 * The check of `change` over `read`'s answer, by its layer's own guard. Never
 * throws: anything that goes wrong is unavailable, and logged.
 */
export async function reviewErasureCheckOf(
  read: () => Promise<ErasureReads>,
  change: ReviewChange,
  online: boolean,
): Promise<ReviewErasureCheck> {
  if (change.layer === REVIEW_SHIFT_TYPE) {
    const check = await overrideErasureCheckOf(read, change.change, online);

    return check.kind === CHECK_REFUSED ? { kind: CHECK_REFUSED, code: reviewRefusalOf(check.code) } : check;
  }

  const check = await rosterErasureCheckOf(read, change.change, online);

  return check.kind === CHECK_REFUSED ? { kind: CHECK_REFUSED, code: reviewRosterRefusalOf(check.code) } : check;
}

// --------------------------------------------- the roster amend's choice (0039)

export type RosterAmendOptions =
  | { readonly ok: true; readonly groups: readonly AmendOptionGroup[] }
  | { readonly ok: false; readonly code: DispositionFailure };

/**
 * Whom the amend of a roster `row` offers to put on, over the fresh `reads`:
 * the calendar's candidates for the team and date (story 5.4c) — active that
 * day, not on its roster, and not already put on by a live change, in the
 * three groups — less the member the change takes off. Refused as the write
 * would be, judged on the fresh calendar: the override no longer live
 * (`gone`) or its team archived (`archived`); anything that cannot be
 * derived is a failure, logged.
 */
export function rosterAmendOptionsOf(reads: ErasureReads, row: PendingRosterOverrideRow): RosterAmendOptions {
  const { calendar, records } = reads;
  const override = calendar.rosterOverrides.find((one) => one.id === row.id);

  if (override === undefined) return { ok: false, code: DISPOSITION_GONE };
  if (calendar.teams.some((team) => team.id === override.teamId && team.archived)) {
    return { ok: false, code: DISPOSITION_ARCHIVED };
  }

  try {
    const leave = organizationLeaveRecordsOf(
      records,
      calendar.members.map((member) => member.id),
    );

    if (leave === null) throw new RangeError('a leave record row cannot be trusted');

    const groups = replacementCandidatesOf(calendar, leave, override.teamId, override.date, null);

    return {
      ok: true,
      groups: groups.map((group) => ({
        kind: group.kind,
        options: group.candidates
          .filter((candidate) => candidate.id !== override.memberOutId)
          .map((candidate) => ({ id: candidate.id, name: candidate.name })),
      })),
    };
  } catch (cause) {
    console.error(DISPOSITION_FAILED, cause);

    return { ok: false, code: DISPOSITION_FAILED };
  }
}
