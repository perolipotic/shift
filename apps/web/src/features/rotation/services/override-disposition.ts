import { projectedShiftTypeOn } from '@shift/domain';

import type { CandidateGroupKind } from '@/features/calendar/utils/replacement-candidates';
import { compareText, formatIsoDate } from '@/lib/i18n/format';
import {
  overrideStandingOfSnapshot,
  rosterStandingOfSnapshot,
  teamAssignmentsOf,
  type RotationHistoryRecord,
  type RotationOverride,
  type RotationRosterOverride,
  type RotationSnapshot,
} from '@/features/rotation/services/list';

/**
 * THE DISPOSITION OF AN OVERRIDE A ROTATION CHANGE LEFT PENDING (story 3.5c;
 * CAP-9), in a `.ts` that renders nothing (AD-15).
 *
 * WHICH ARE PENDING is `overrideStandingOf`'s answer from `@shift/domain`,
 * through `overrideStandingOfSnapshot`: an override whose date no version
 * governs, or whose governing version was saved after it was written or last
 * confirmed. The builder lists each one, and the admin disposes of it:
 *
 *   * CONFIRM — 0022's `confirm_shift_type_override`, which re-anchors it to
 *     the version in force now. Not offered where no version governs the date.
 *     It carries the save time of the version the review showed governing
 *     the date (0035), and a newer one saved meanwhile refuses it.
 *   * AMEND — 0022's `amend_shift_type_override`, which soft-removes it and
 *     inserts the new type and reason in one transaction. Not offered where no
 *     version governs the date. It carries the same token as the
 *     confirmation (0036).
 *   * DISCARD — 0021's `remove_shift_type_override`, the calendar's removal.
 *
 * Nothing here writes a rotation row, and nothing hard-deletes: every call is
 * one of the three functions, which attribute on the server.
 *
 * THE ROSTER LAYER (0039) is disposed of in the same review, by the same rule:
 * a roster override a rotation change left pending is CONFIRMED by
 * `confirm_roster_override`, AMENDED to another arriving member by
 * `amend_roster_override` (soft-remove and insert, the member taken off kept),
 * and DISCARDED by 0027's `remove_roster_override`. Confirm and amend carry
 * the same token and are offered only where a version governs the date. A
 * review row says which layer it is (`layer`), and the `review*` functions
 * below pick the layer's own rule.
 *
 * Codes, never messages: the `*MessageKey` functions are the one edge.
 */

/** The functions a disposition calls (0021, 0022). */
export const CONFIRM_OVERRIDE_FUNCTION = 'confirm_shift_type_override';
export const AMEND_OVERRIDE_FUNCTION = 'amend_shift_type_override';
export const DISCARD_OVERRIDE_FUNCTION = 'remove_shift_type_override';

/** The functions a roster override's disposition calls (0039; 0027's removal). */
export const CONFIRM_ROSTER_OVERRIDE_FUNCTION = 'confirm_roster_override';
export const AMEND_ROSTER_OVERRIDE_FUNCTION = 'amend_roster_override';
export const DISCARD_ROSTER_OVERRIDE_FUNCTION = 'remove_roster_override';

/** Which layer a review row disposes of: a shift-type override (3.5c) or a roster override (0039). */
export const REVIEW_SHIFT_TYPE = 'shiftType';
export const REVIEW_ROSTER = 'roster';

/** The caller may not dispose of overrides (42501). */
export const DISPOSITION_DENIED = 'denied';
/** The override is no longer live: disposed of elsewhere, or gone from reach (P0002). */
export const DISPOSITION_GONE = 'gone';
/** The amend's reason is blank or longer than 200 characters once trimmed (preflight, or 23514). */
export const DISPOSITION_REASON = 'reason';
/** The amend's type is the one the rotation now projects, or none (preflight). */
export const DISPOSITION_SAME_AS_PROJECTED = 'sameAsProjected';
/** The team, or the type the override would name, was archived meanwhile (0022's P0001). */
export const DISPOSITION_ARCHIVED = 'archived';
/** The rotation version governing the override's date changed since the review was read (0035's P0001). */
export const DISPOSITION_CHANGED = 'changed';
/** The amend's arriving member is none, the one already put on, or the one taken off (preflight, 0039). */
export const DISPOSITION_SAME_MEMBER = 'sameMember';
/** Another live roster change of the team and date already puts that member on (23505, 0026's live key). */
export const DISPOSITION_TAKEN = 'taken';
/** Anything else, 23503 included: try again. */
export const DISPOSITION_FAILED = 'failed';

export type DispositionFailure =
  | typeof DISPOSITION_DENIED
  | typeof DISPOSITION_GONE
  | typeof DISPOSITION_ARCHIVED
  | typeof DISPOSITION_CHANGED
  | typeof DISPOSITION_REASON
  | typeof DISPOSITION_SAME_AS_PROJECTED
  | typeof DISPOSITION_SAME_MEMBER
  | typeof DISPOSITION_TAKEN
  | typeof DISPOSITION_FAILED;

export type DispositionOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: DispositionFailure };

/** Which disposition landed. */
export const DISPOSITION_CONFIRMED = 'confirmed';
export const DISPOSITION_AMENDED = 'amended';
export const DISPOSITION_DISCARDED = 'discarded';

export type DispositionDone =
  | typeof DISPOSITION_CONFIRMED
  | typeof DISPOSITION_AMENDED
  | typeof DISPOSITION_DISCARDED;

// ----------------------------------------------------------------- the rows

/** One type the amend offers. */
export interface DispositionTypeOption {
  readonly id: string;
  readonly name: string;
}

/** One pending override, as the review lists it. */
export interface PendingOverrideRow {
  readonly layer: typeof REVIEW_SHIFT_TYPE;
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  /** `YYYY-MM-DD`. */
  readonly isoDate: string;
  /** `12.09.2026`. */
  readonly date: string;
  /** The type the override names. */
  readonly shiftTypeId: string;
  readonly typeName: string;
  /** The type the rotation projects on the date NOW; `null` where no version governs it. */
  readonly projectedShiftTypeId: string | null;
  readonly projectedTypeName: string | null;
  readonly reason: string;
  /** Who wrote it; `null` for an author the members embed does not name. */
  readonly authorName: string | null;
  /** Confirm and amend are offered only where a version governs the date. */
  readonly governed: boolean;
  /**
   * The `created_at` of the version governing the date, exactly as sent, or
   * `null` where none does: the confirmation's concurrency token (0035).
   */
  readonly governingSavedAt: string | null;
  /** What the amend offers: every type not archived and not projected now, in creation order. */
  readonly options: readonly DispositionTypeOption[];
}

function nameOf(snapshot: RotationSnapshot, shiftTypeId: string): string {
  const type = snapshot.types.find((one) => one.id === shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${shiftTypeId} is not in the rotation snapshot`);

  return type.name;
}

/**
 * The version governing `teamId` on `date`: the greatest `effective_from` on
 * or before it, over every version's attribution, as the pending rule reads
 * it; `null` where none does.
 */
function governingOf(snapshot: RotationSnapshot, teamId: string, date: string): RotationHistoryRecord | null {
  return snapshot.history
    .filter((record) => record.teamId === teamId && record.effectiveFrom <= date)
    .reduce<RotationHistoryRecord | null>(
      (latest, record) => (latest === null || record.effectiveFrom > latest.effectiveFrom ? record : latest),
      null,
    );
}

function rowOf(snapshot: RotationSnapshot, override: RotationOverride): PendingOverrideRow {
  const team = snapshot.teams.find((one) => one.id === override.teamId);
  const date = formatIsoDate(override.date);

  if (team === undefined) throw new RangeError(`team ${override.teamId} is not in the rotation snapshot`);
  if (date === null) throw new RangeError(`the date ${override.date} could not be formatted`);

  const governing = governingOf(snapshot, override.teamId, override.date);

  const projectedShiftTypeId = projectedShiftTypeOn(
    teamAssignmentsOf(snapshot, override.teamId),
    snapshot.steps,
    override.date,
  );

  return {
    layer: REVIEW_SHIFT_TYPE,
    id: override.id,
    teamId: team.id,
    teamName: team.name,
    isoDate: override.date,
    date,
    shiftTypeId: override.shiftTypeId,
    typeName: nameOf(snapshot, override.shiftTypeId),
    projectedShiftTypeId,
    projectedTypeName: projectedShiftTypeId === null ? null : nameOf(snapshot, projectedShiftTypeId),
    reason: override.reason,
    authorName: snapshot.authors.find((author) => author.authUserId === override.createdBy)?.name ?? null,
    governed: projectedShiftTypeId !== null,
    governingSavedAt: governing?.createdAt ?? null,
    options:
      projectedShiftTypeId === null
        ? []
        : snapshot.types
            .filter((type) => !type.archived && type.id !== projectedShiftTypeId)
            .map((type) => ({ id: type.id, name: type.name })),
  };
}

/**
 * Every pending override of `snapshot`, by date, then team name under the
 * Croatian collation, then id. Empty when nothing is pending: the review is
 * then not shown.
 *
 * @throws RangeError on any precondition of `overrideStandingOf` or
 *   `projectedShiftTypeOn`, or a team or type the snapshot lacks.
 */
export function pendingOverrideRowsOf(snapshot: RotationSnapshot): readonly PendingOverrideRow[] {
  return overrideStandingOfSnapshot(snapshot)
    .pending.map((override) => rowOf(snapshot, override))
    .sort(
      (left, right) =>
        (left.isoDate < right.isoDate ? -1 : left.isoDate > right.isoDate ? 1 : 0) ||
        compareText(left.teamName, right.teamName) ||
        compareText(left.id, right.id),
    );
}

// ------------------------------------------------------ the roster rows (0039)

/** One pending roster override, as the review lists it (0039). */
export interface PendingRosterOverrideRow {
  readonly layer: typeof REVIEW_ROSTER;
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  /** `YYYY-MM-DD`. */
  readonly isoDate: string;
  /** `12.09.2026`. */
  readonly date: string;
  /** Taken off the shift, or `null`; the name `null` for a member the members embed does not name. */
  readonly memberOutId: string | null;
  readonly memberOutName: string | null;
  /** Put on the shift, or `null`; the name `null` as above. */
  readonly memberInId: string | null;
  readonly memberInName: string | null;
  /** The type the rotation projects on the date NOW; `null` where no version governs it. */
  readonly projectedTypeName: string | null;
  readonly reason: string;
  /** Who wrote it; `null` for an author the members embed does not name. */
  readonly authorName: string | null;
  /** Confirm and amend are offered only where a version governs the date. */
  readonly governed: boolean;
  /** The `created_at` of the version governing the date, exactly as sent, or `null`: the token (0039). */
  readonly governingSavedAt: string | null;
}

/** One row of the review: either layer. */
export type ReviewRow = PendingOverrideRow | PendingRosterOverrideRow;

function memberNameOf(snapshot: RotationSnapshot, memberId: string | null): string | null {
  if (memberId === null) return null;

  return snapshot.authors.find((author) => author.memberId === memberId)?.name ?? null;
}

function rosterRowOf(snapshot: RotationSnapshot, override: RotationRosterOverride): PendingRosterOverrideRow {
  const team = snapshot.teams.find((one) => one.id === override.teamId);
  const date = formatIsoDate(override.date);

  if (team === undefined) throw new RangeError(`team ${override.teamId} is not in the rotation snapshot`);
  if (date === null) throw new RangeError(`the date ${override.date} could not be formatted`);

  const governing = governingOf(snapshot, override.teamId, override.date);
  const projectedShiftTypeId = projectedShiftTypeOn(
    teamAssignmentsOf(snapshot, override.teamId),
    snapshot.steps,
    override.date,
  );

  return {
    layer: REVIEW_ROSTER,
    id: override.id,
    teamId: team.id,
    teamName: team.name,
    isoDate: override.date,
    date,
    memberOutId: override.memberOutId,
    memberOutName: memberNameOf(snapshot, override.memberOutId),
    memberInId: override.memberInId,
    memberInName: memberNameOf(snapshot, override.memberInId),
    projectedTypeName: projectedShiftTypeId === null ? null : nameOf(snapshot, projectedShiftTypeId),
    reason: override.reason,
    authorName: snapshot.authors.find((author) => author.authUserId === override.createdBy)?.name ?? null,
    governed: projectedShiftTypeId !== null,
    governingSavedAt: governing?.createdAt ?? null,
  };
}

/** By date, then team name under the Croatian collation, then the shift-type layer first, then id. */
function compareRows(left: ReviewRow, right: ReviewRow): number {
  return (
    (left.isoDate < right.isoDate ? -1 : left.isoDate > right.isoDate ? 1 : 0) ||
    compareText(left.teamName, right.teamName) ||
    (left.layer === right.layer ? 0 : left.layer === REVIEW_SHIFT_TYPE ? -1 : 1) ||
    compareText(left.id, right.id)
  );
}

/**
 * Every pending roster override of `snapshot` (0039), ordered as the
 * shift-type rows are.
 *
 * @throws RangeError on any precondition of `overrideStandingOf` or
 *   `projectedShiftTypeOn`, or a team or type the snapshot lacks.
 */
export function pendingRosterRowsOf(snapshot: RotationSnapshot): readonly PendingRosterOverrideRow[] {
  return rosterStandingOfSnapshot(snapshot)
    .pending.map((override) => rosterRowOf(snapshot, override))
    .sort(compareRows);
}

/** Every row the review lists, both layers, by date, then team, then layer. */
export function reviewRowsOf(snapshot: RotationSnapshot): readonly ReviewRow[] {
  return [...pendingOverrideRowsOf(snapshot), ...pendingRosterRowsOf(snapshot)].sort(compareRows);
}

/** How many overrides are pending, both layers: the count the save's success notice adds. */
export function pendingOverrideCountOf(snapshot: RotationSnapshot): number {
  return overrideStandingOfSnapshot(snapshot).pending.length + rosterStandingOfSnapshot(snapshot).pending.length;
}

/** The label a review that cannot be derived is logged under. */
export const OVERRIDE_REVIEW_UNAVAILABLE = 'OVERRIDE_REVIEW_UNAVAILABLE';

/** The review as the builder shows it: its rows, or that they cannot be derived. */
export type OverrideReview =
  | { readonly ok: true; readonly rows: readonly ReviewRow[] }
  | { readonly ok: false };

/**
 * {@link reviewRowsOf}, GUARDED: a derivation that throws — a defect the
 * calendar reports as its read failure too — is logged and answered as
 * unavailable, which the review says, never as "nothing pending".
 */
export function overrideReviewOf(snapshot: RotationSnapshot): OverrideReview {
  try {
    return { ok: true, rows: reviewRowsOf(snapshot) };
  } catch (cause) {
    console.error(OVERRIDE_REVIEW_UNAVAILABLE, cause);

    return { ok: false };
  }
}

/**
 * The count the save's confirmation carries, from the snapshot re-read once
 * the save has settled, or `null` when it cannot be derived (logged; the
 * review says so). Captured once, so a later disposition does not change what
 * the save said.
 */
export function savedPendingCountOf(snapshot: RotationSnapshot): number | null {
  try {
    return pendingOverrideCountOf(snapshot);
  } catch (cause) {
    console.error(OVERRIDE_REVIEW_UNAVAILABLE, cause);

    return null;
  }
}

/** What the review offers on a row: confirm and amend only where a version governs the date, amend only with a type to choose. */
export function rowOffersOf(row: PendingOverrideRow): { readonly confirm: boolean; readonly amend: boolean } {
  return { confirm: row.governed, amend: row.governed && row.options.length > 0 };
}

/** What the amend opens with: the override's own type when it may be chosen, else the first offered; and its reason. */
export function amendDefaultsOf(row: PendingOverrideRow): { readonly shiftTypeId: string | undefined; readonly reason: string } {
  const own = row.options.some((option) => option.id === row.shiftTypeId);

  return { shiftTypeId: own ? row.shiftTypeId : row.options[0]?.id, reason: row.reason };
}

/** What the review offers on a row of either layer: a roster row's confirm and amend where a version governs the date. */
export function reviewOffersOf(row: ReviewRow): { readonly confirm: boolean; readonly amend: boolean } {
  if (row.layer === REVIEW_SHIFT_TYPE) return rowOffersOf(row);

  return { confirm: row.governed, amend: row.governed };
}

// ---------------------------------------------------------------- the amend

/** The options of a shift-type amend, as one group of types. */
export const AMEND_TYPES = 'types';

/**
 * What an amend offers, in groups: the types for a shift-type override (one
 * group), the members to put on for a roster override, in the calendar's
 * candidate groups (0039).
 */
export interface AmendOptionGroup {
  readonly kind: typeof AMEND_TYPES | CandidateGroupKind;
  readonly options: readonly DispositionTypeOption[];
}

/** A shift-type row's amend options: its types, as one group. */
export function shiftTypeAmendGroupsOf(row: PendingOverrideRow): readonly AmendOptionGroup[] {
  return [{ kind: AMEND_TYPES, options: row.options }];
}

/** Whether `choiceId` is offered in `groups`. */
export function offeredIn(groups: readonly AmendOptionGroup[], choiceId: string): boolean {
  return groups.some((group) => group.options.some((option) => option.id === choiceId));
}

/**
 * What the amend opens with: a shift-type row's own type when it may be
 * chosen, else the first offered; a roster row's first member offered (its
 * own is never offered: the amend changes who arrives). And the reason.
 */
export function reviewAmendDefaultsOf(
  row: ReviewRow,
  groups: readonly AmendOptionGroup[],
): { readonly choiceId: string | undefined; readonly reason: string } {
  if (row.layer === REVIEW_SHIFT_TYPE) {
    const defaults = amendDefaultsOf(row);

    return { choiceId: defaults.shiftTypeId, reason: defaults.reason };
  }

  return { choiceId: groups.flatMap((group) => group.options)[0]?.id, reason: row.reason };
}

/** The reason's bounds once surrounding white space is trimmed, as 0019's check reads them. */
export const DISPOSITION_REASON_MAX = 200;

export type AmendEntry =
  | { readonly ok: true; readonly shiftTypeId: string; readonly reason: string }
  | { readonly ok: false; readonly code: typeof DISPOSITION_REASON | typeof DISPOSITION_SAME_AS_PROJECTED };

/**
 * The browser's preflight of an amend of `row`: the type first, as the first
 * field, then the reason — the calendar's own rule (story 3.5b), kept here
 * because the calendar's preflight is not public. The type may not be empty
 * or the one projected now; the reason is trimmed and must then hold 1–200
 * characters (code points, as `char_length` counts them). What passes is what
 * is sent.
 */
export function amendEntryOf(row: PendingOverrideRow, shiftTypeId: string, reason: string): AmendEntry {
  if (shiftTypeId === '' || shiftTypeId === row.projectedShiftTypeId) {
    return { ok: false, code: DISPOSITION_SAME_AS_PROJECTED };
  }

  const trimmed = trimmedReasonOf(reason);

  if (trimmed === null) return { ok: false, code: DISPOSITION_REASON };

  return { ok: true, shiftTypeId, reason: trimmed };
}

/** The reason, trimmed, when it holds 1–200 code points once trimmed; else `null`. */
function trimmedReasonOf(reason: string): string | null {
  const trimmed = reason.trim();
  const length = [...trimmed].length;

  return length < 1 || length > DISPOSITION_REASON_MAX ? null : trimmed;
}

export type RosterAmendEntry =
  | { readonly ok: true; readonly memberInId: string; readonly reason: string }
  | { readonly ok: false; readonly code: typeof DISPOSITION_REASON | typeof DISPOSITION_SAME_MEMBER };

/**
 * The browser's preflight of an amend of a roster `row` (0039): the member
 * first, as the first field — none, the member already put on, or the member
 * taken off is {@link DISPOSITION_SAME_MEMBER} — then the reason, as for a
 * shift-type amend. What passes is what is sent.
 */
export function rosterAmendEntryOf(row: PendingRosterOverrideRow, memberInId: string, reason: string): RosterAmendEntry {
  if (memberInId === '' || memberInId === row.memberInId || memberInId === row.memberOutId) {
    return { ok: false, code: DISPOSITION_SAME_MEMBER };
  }

  const trimmed = trimmedReasonOf(reason);

  return trimmed === null ? { ok: false, code: DISPOSITION_REASON } : { ok: true, memberInId, reason: trimmed };
}

export type ReviewAmendEntry =
  | { readonly ok: true; readonly choiceId: string; readonly reason: string }
  | {
      readonly ok: false;
      readonly code: typeof DISPOSITION_REASON | typeof DISPOSITION_SAME_AS_PROJECTED | typeof DISPOSITION_SAME_MEMBER;
    };

/** The amend's preflight of either layer, the chosen type or member as `choiceId`. */
export function reviewAmendEntryOf(row: ReviewRow, choiceId: string, reason: string): ReviewAmendEntry {
  if (row.layer === REVIEW_SHIFT_TYPE) {
    const entry = amendEntryOf(row, choiceId, reason);

    return entry.ok ? { ok: true, choiceId: entry.shiftTypeId, reason: entry.reason } : entry;
  }

  const entry = rosterAmendEntryOf(row, choiceId, reason);

  return entry.ok ? { ok: true, choiceId: entry.memberInId, reason: entry.reason } : entry;
}

// ----------------------------------------------------------------- the seams

export interface DispositionError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface DispositionAnswer {
  readonly error: DispositionError | null;
}

/** The three functions a disposition calls, named structurally so they can be stubbed. */
export interface DispositionRpc {
  rpc(
    fn: typeof CONFIRM_OVERRIDE_FUNCTION,
    args: { readonly p_override_id: string; readonly p_governing_saved_at: string | null },
  ): PromiseLike<DispositionAnswer>;
  rpc(fn: typeof DISCARD_OVERRIDE_FUNCTION, args: { readonly p_override_id: string }): PromiseLike<DispositionAnswer>;
  rpc(
    fn: typeof AMEND_OVERRIDE_FUNCTION,
    args: {
      readonly p_override_id: string;
      readonly p_shift_type_id: string;
      readonly p_reason: string;
      readonly p_governing_saved_at: string | null;
    },
  ): PromiseLike<DispositionAnswer>;
}

/** The three functions a roster override's disposition calls (0039), named structurally. */
export interface RosterDispositionRpc {
  rpc(
    fn: typeof CONFIRM_ROSTER_OVERRIDE_FUNCTION,
    args: { readonly p_override_id: string; readonly p_governing_saved_at: string | null },
  ): PromiseLike<DispositionAnswer>;
  rpc(fn: typeof DISCARD_ROSTER_OVERRIDE_FUNCTION, args: { readonly p_override_id: string }): PromiseLike<DispositionAnswer>;
  rpc(
    fn: typeof AMEND_ROSTER_OVERRIDE_FUNCTION,
    args: {
      readonly p_override_id: string;
      readonly p_member_in_id: string;
      readonly p_reason: string;
      readonly p_governing_saved_at: string | null;
    },
  ): PromiseLike<DispositionAnswer>;
}

/** Every call the review makes, both layers. */
export type ReviewRpc = DispositionRpc & RosterDispositionRpc;

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const NO_DATA_FOUND = 'P0002';
const RAISED = 'P0001';
/** The message 0022 raises an archived team or type with; another P0001 is no refusal of ours. */
const ARCHIVED_MESSAGE = 'SHIFT_TYPE_OVERRIDE_ARCHIVED';
/** The message 0035 raises a confirmation (and 0036 an amend) whose governing version changed with. */
const CHANGED_MESSAGE = 'SHIFT_TYPE_OVERRIDE_CHANGED';
const UNIQUE_VIOLATION = '23505';
/** 0039's messages for the roster layer (and 0036's insert trigger's for an archived team). */
const ROSTER_ARCHIVED_MESSAGE = 'ROSTER_OVERRIDE_ARCHIVED';
const ROSTER_CHANGED_MESSAGE = 'ROSTER_OVERRIDE_CHANGED';

/**
 * A refusal of a disposition as this application's own failure. `23514` IS
 * THE REASON, the only check of 0019's an amend can trip; `P0001` with 0022's
 * message is an archived team or type (as is `23514` with it, `0036`'s insert
 * trigger, which the amend's own check pre-empts), and with 0035's a
 * confirmation or amend whose governing version changed meanwhile; `23503` — a
 * type of another tenant — and everything unforeseen are
 * {@link DISPOSITION_FAILED}.
 */
export function dispositionFailureOf(error: DispositionError): DispositionFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return DISPOSITION_DENIED;
  if (error.code === NO_DATA_FOUND) return DISPOSITION_GONE;
  if ((error.code === RAISED || error.code === CHECK_VIOLATION) && error.message === ARCHIVED_MESSAGE) {
    return DISPOSITION_ARCHIVED;
  }
  if (error.code === RAISED && error.message === CHANGED_MESSAGE) return DISPOSITION_CHANGED;
  if (error.code === CHECK_VIOLATION) return DISPOSITION_REASON;

  return DISPOSITION_FAILED;
}

/**
 * A refusal of a roster override's disposition (0039) as this application's
 * own failure: `P0001` (or `23514`, 0036's insert trigger) with
 * `ROSTER_OVERRIDE_ARCHIVED` is an archived team, `P0001` with
 * `ROSTER_OVERRIDE_CHANGED` a governing version changed meanwhile, `23505`
 * the arriving member already put on by another live change, and `23514` the
 * reason (the preflight keeps the members distinct); the rest as for a
 * shift-type override.
 */
export function rosterDispositionFailureOf(error: DispositionError): DispositionFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return DISPOSITION_DENIED;
  if (error.code === NO_DATA_FOUND) return DISPOSITION_GONE;
  if ((error.code === RAISED || error.code === CHECK_VIOLATION) && error.message === ROSTER_ARCHIVED_MESSAGE) {
    return DISPOSITION_ARCHIVED;
  }
  if (error.code === RAISED && error.message === ROSTER_CHANGED_MESSAGE) return DISPOSITION_CHANGED;
  if (error.code === UNIQUE_VIOLATION) return DISPOSITION_TAKEN;
  if (error.code === CHECK_VIOLATION) return DISPOSITION_REASON;

  return DISPOSITION_FAILED;
}

/** Settle one call: a thrown call, a malformed answer, an error, or success. */
async function settled(
  call: () => PromiseLike<DispositionAnswer>,
  failureOf: (error: DispositionError) => DispositionFailure = dispositionFailureOf,
): Promise<DispositionOutcome> {
  let answered: DispositionAnswer;

  try {
    answered = await call();
  } catch (cause) {
    console.error(DISPOSITION_FAILED, cause);

    return { ok: false, code: DISPOSITION_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(DISPOSITION_FAILED, typeof answered);

    return { ok: false, code: DISPOSITION_FAILED };
  }

  if (answered.error !== null) {
    const code = failureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  return { ok: true };
}

/**
 * Confirm `row`'s override; the database attributes the confirmation, and
 * refuses it when the version governing the date is no longer the one `row`
 * was derived from. Refused without a request where no version governs the
 * date.
 */
export async function confirmShiftTypeOverride(client: DispositionRpc, row: PendingOverrideRow): Promise<DispositionOutcome> {
  if (!row.governed || row.governingSavedAt === null) return { ok: false, code: DISPOSITION_FAILED };

  const governingSavedAt = row.governingSavedAt;

  return settled(() =>
    client.rpc(CONFIRM_OVERRIDE_FUNCTION, { p_override_id: row.id, p_governing_saved_at: governingSavedAt }),
  );
}

/**
 * Amend `row`'s override to `shiftTypeId` for `reason`, preflighted first
 * ({@link amendEntryOf}): a refused entry sends nothing. Refused without a
 * request where no version governs the date. Like the confirmation, it carries
 * the save time of the version the review showed governing (`0036`), and the
 * database refuses it when that version is no longer the one.
 */
export async function amendShiftTypeOverride(
  client: DispositionRpc,
  row: PendingOverrideRow,
  shiftTypeId: string,
  reason: string,
): Promise<DispositionOutcome> {
  if (!rowOffersOf(row).amend || row.governingSavedAt === null) return { ok: false, code: DISPOSITION_FAILED };

  const entry = amendEntryOf(row, shiftTypeId, reason);

  if (!entry.ok) return entry;

  const governingSavedAt = row.governingSavedAt;

  return settled(() =>
    client.rpc(AMEND_OVERRIDE_FUNCTION, {
      p_override_id: row.id,
      p_shift_type_id: entry.shiftTypeId,
      p_reason: entry.reason,
      p_governing_saved_at: governingSavedAt,
    }),
  );
}

/** Discard `row`'s override: 0021's soft-remove, attributed by the database. */
export async function discardShiftTypeOverride(client: DispositionRpc, row: PendingOverrideRow): Promise<DispositionOutcome> {
  return settled(() => client.rpc(DISCARD_OVERRIDE_FUNCTION, { p_override_id: row.id }));
}

/**
 * Confirm a roster `row`'s override (0039); the database attributes it, and
 * refuses it when the version governing the date is no longer the one `row`
 * was derived from. Refused without a request where none governs the date.
 */
export async function confirmRosterOverride(client: RosterDispositionRpc, row: PendingRosterOverrideRow): Promise<DispositionOutcome> {
  if (!row.governed || row.governingSavedAt === null) return { ok: false, code: DISPOSITION_FAILED };

  const governingSavedAt = row.governingSavedAt;

  return settled(
    () => client.rpc(CONFIRM_ROSTER_OVERRIDE_FUNCTION, { p_override_id: row.id, p_governing_saved_at: governingSavedAt }),
    rosterDispositionFailureOf,
  );
}

/**
 * Amend a roster `row`'s override to put `memberInId` on for `reason`,
 * preflighted first ({@link rosterAmendEntryOf}): a refused entry sends
 * nothing. Refused without a request where no version governs the date. It
 * carries the confirmation's token.
 */
export async function amendRosterOverride(
  client: RosterDispositionRpc,
  row: PendingRosterOverrideRow,
  memberInId: string,
  reason: string,
): Promise<DispositionOutcome> {
  if (!row.governed || row.governingSavedAt === null) return { ok: false, code: DISPOSITION_FAILED };

  const entry = rosterAmendEntryOf(row, memberInId, reason);

  if (!entry.ok) return entry;

  const governingSavedAt = row.governingSavedAt;

  return settled(
    () =>
      client.rpc(AMEND_ROSTER_OVERRIDE_FUNCTION, {
        p_override_id: row.id,
        p_member_in_id: entry.memberInId,
        p_reason: entry.reason,
        p_governing_saved_at: governingSavedAt,
      }),
    rosterDispositionFailureOf,
  );
}

/** Discard a roster `row`'s override: 0027's soft-remove, attributed by the database. */
export async function discardRosterOverride(client: RosterDispositionRpc, row: PendingRosterOverrideRow): Promise<DispositionOutcome> {
  return settled(
    () => client.rpc(DISCARD_ROSTER_OVERRIDE_FUNCTION, { p_override_id: row.id }),
    rosterDispositionFailureOf,
  );
}

/** Confirm a review row of either layer. */
export function confirmReviewed(client: ReviewRpc, row: ReviewRow): Promise<DispositionOutcome> {
  return row.layer === REVIEW_SHIFT_TYPE ? confirmShiftTypeOverride(client, row) : confirmRosterOverride(client, row);
}

/** Amend a review row of either layer to `choiceId` — a type, or the member to put on. */
export function amendReviewed(client: ReviewRpc, row: ReviewRow, choiceId: string, reason: string): Promise<DispositionOutcome> {
  return row.layer === REVIEW_SHIFT_TYPE
    ? amendShiftTypeOverride(client, row, choiceId, reason)
    : amendRosterOverride(client, row, choiceId, reason);
}

/** Discard a review row of either layer. */
export function discardReviewed(client: ReviewRpc, row: ReviewRow): Promise<DispositionOutcome> {
  return row.layer === REVIEW_SHIFT_TYPE ? discardShiftTypeOverride(client, row) : discardRosterOverride(client, row);
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these refusals becomes Croatian. */
export function dispositionMessageKey(
  failure: DispositionFailure,
):
  | 'rotation.builder.overrides.refused.denied'
  | 'rotation.builder.overrides.refused.gone'
  | 'rotation.builder.overrides.refused.archived'
  | 'rotation.builder.overrides.refused.changed'
  | 'rotation.builder.overrides.refused.reason'
  | 'rotation.builder.overrides.refused.sameAsProjected'
  | 'rotation.builder.overrides.refused.sameMember'
  | 'rotation.builder.overrides.refused.taken'
  | 'rotation.builder.overrides.refused.failed' {
  if (failure === DISPOSITION_DENIED) return 'rotation.builder.overrides.refused.denied';
  if (failure === DISPOSITION_GONE) return 'rotation.builder.overrides.refused.gone';
  if (failure === DISPOSITION_ARCHIVED) return 'rotation.builder.overrides.refused.archived';
  if (failure === DISPOSITION_CHANGED) return 'rotation.builder.overrides.refused.changed';
  if (failure === DISPOSITION_REASON) return 'rotation.builder.overrides.refused.reason';
  if (failure === DISPOSITION_SAME_AS_PROJECTED) return 'rotation.builder.overrides.refused.sameAsProjected';
  if (failure === DISPOSITION_SAME_MEMBER) return 'rotation.builder.overrides.refused.sameMember';
  if (failure === DISPOSITION_TAKEN) return 'rotation.builder.overrides.refused.taken';
  if (failure === DISPOSITION_FAILED) return 'rotation.builder.overrides.refused.failed';

  const unhandled: never = failure;

  return unhandled;
}

/** The key a landed disposition is said with. */
export function dispositionDoneMessageKey(
  done: DispositionDone,
):
  | 'rotation.builder.overrides.done.confirmed'
  | 'rotation.builder.overrides.done.amended'
  | 'rotation.builder.overrides.done.discarded' {
  if (done === DISPOSITION_CONFIRMED) return 'rotation.builder.overrides.done.confirmed';
  if (done === DISPOSITION_AMENDED) return 'rotation.builder.overrides.done.amended';
  if (done === DISPOSITION_DISCARDED) return 'rotation.builder.overrides.done.discarded';

  const unhandled: never = done;

  return unhandled;
}
