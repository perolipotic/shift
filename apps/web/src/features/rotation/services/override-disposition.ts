import { projectedShiftTypeOn } from '@shift/domain';

import { compareText, formatIsoDate } from '@/lib/i18n/format';
import {
  overrideStandingOfSnapshot,
  teamAssignmentsOf,
  type RotationOverride,
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
 *   * AMEND — 0022's `amend_shift_type_override`, which soft-removes it and
 *     inserts the new type and reason in one transaction. Not offered where no
 *     version governs the date.
 *   * DISCARD — 0021's `remove_shift_type_override`, the calendar's removal.
 *
 * Nothing here writes a rotation row, and nothing hard-deletes: every call is
 * one of the three functions, which attribute on the server.
 *
 * Codes, never messages: the `*MessageKey` functions are the one edge.
 */

/** The functions a disposition calls (0021, 0022). */
export const CONFIRM_OVERRIDE_FUNCTION = 'confirm_shift_type_override';
export const AMEND_OVERRIDE_FUNCTION = 'amend_shift_type_override';
export const DISCARD_OVERRIDE_FUNCTION = 'remove_shift_type_override';

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
/** Anything else, 23503 included: try again. */
export const DISPOSITION_FAILED = 'failed';

export type DispositionFailure =
  | typeof DISPOSITION_DENIED
  | typeof DISPOSITION_GONE
  | typeof DISPOSITION_ARCHIVED
  | typeof DISPOSITION_REASON
  | typeof DISPOSITION_SAME_AS_PROJECTED
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
  /** What the amend offers: every type not archived and not projected now, in creation order. */
  readonly options: readonly DispositionTypeOption[];
}

function nameOf(snapshot: RotationSnapshot, shiftTypeId: string): string {
  const type = snapshot.types.find((one) => one.id === shiftTypeId);

  if (type === undefined) throw new RangeError(`shift type ${shiftTypeId} is not in the rotation snapshot`);

  return type.name;
}

function rowOf(snapshot: RotationSnapshot, override: RotationOverride): PendingOverrideRow {
  const team = snapshot.teams.find((one) => one.id === override.teamId);
  const date = formatIsoDate(override.date);

  if (team === undefined) throw new RangeError(`team ${override.teamId} is not in the rotation snapshot`);
  if (date === null) throw new RangeError(`the date ${override.date} could not be formatted`);

  const projectedShiftTypeId = projectedShiftTypeOn(
    teamAssignmentsOf(snapshot, override.teamId),
    snapshot.steps,
    override.date,
  );

  return {
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

/** How many overrides are pending: the count the save's success notice adds. */
export function pendingOverrideCountOf(snapshot: RotationSnapshot): number {
  return overrideStandingOfSnapshot(snapshot).pending.length;
}

/** The label a review that cannot be derived is logged under. */
export const OVERRIDE_REVIEW_UNAVAILABLE = 'OVERRIDE_REVIEW_UNAVAILABLE';

/** The review as the builder shows it: its rows, or that they cannot be derived. */
export type OverrideReview =
  | { readonly ok: true; readonly rows: readonly PendingOverrideRow[] }
  | { readonly ok: false };

/**
 * {@link pendingOverrideRowsOf}, GUARDED: a derivation that throws — a defect
 * the calendar reports as its read failure too — is logged and answered as
 * unavailable, which the review says, never as "nothing pending".
 */
export function overrideReviewOf(snapshot: RotationSnapshot): OverrideReview {
  try {
    return { ok: true, rows: pendingOverrideRowsOf(snapshot) };
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

// ---------------------------------------------------------------- the amend

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

  const trimmed = reason.trim();
  const length = [...trimmed].length;

  if (length < 1 || length > DISPOSITION_REASON_MAX) return { ok: false, code: DISPOSITION_REASON };

  return { ok: true, shiftTypeId, reason: trimmed };
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
    fn: typeof CONFIRM_OVERRIDE_FUNCTION | typeof DISCARD_OVERRIDE_FUNCTION,
    args: { readonly p_override_id: string },
  ): PromiseLike<DispositionAnswer>;
  rpc(
    fn: typeof AMEND_OVERRIDE_FUNCTION,
    args: { readonly p_override_id: string; readonly p_shift_type_id: string; readonly p_reason: string },
  ): PromiseLike<DispositionAnswer>;
}

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const NO_DATA_FOUND = 'P0002';
const RAISED = 'P0001';
/** The message 0022 raises an archived team or type with; another P0001 is no refusal of ours. */
const ARCHIVED_MESSAGE = 'SHIFT_TYPE_OVERRIDE_ARCHIVED';

/**
 * A refusal of a disposition as this application's own failure. `23514` IS
 * THE REASON, the only check of 0019's an amend can trip; `P0001` with 0022's
 * message is an archived team or type; `23503` — a type of another tenant —
 * and everything unforeseen are {@link DISPOSITION_FAILED}.
 */
export function dispositionFailureOf(error: DispositionError): DispositionFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return DISPOSITION_DENIED;
  if (error.code === NO_DATA_FOUND) return DISPOSITION_GONE;
  if (error.code === RAISED && error.message === ARCHIVED_MESSAGE) return DISPOSITION_ARCHIVED;
  if (error.code === CHECK_VIOLATION) return DISPOSITION_REASON;

  return DISPOSITION_FAILED;
}

/** Settle one call: a thrown call, a malformed answer, an error, or success. */
async function settled(call: () => PromiseLike<DispositionAnswer>): Promise<DispositionOutcome> {
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
    const code = dispositionFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  return { ok: true };
}

/** Confirm `row`'s override; the database attributes the confirmation. Refused without a request where no version governs the date. */
export async function confirmShiftTypeOverride(client: DispositionRpc, row: PendingOverrideRow): Promise<DispositionOutcome> {
  if (!row.governed) return { ok: false, code: DISPOSITION_FAILED };

  return settled(() => client.rpc(CONFIRM_OVERRIDE_FUNCTION, { p_override_id: row.id }));
}

/**
 * Amend `row`'s override to `shiftTypeId` for `reason`, preflighted first
 * ({@link amendEntryOf}): a refused entry sends nothing. Refused without a
 * request where no version governs the date.
 */
export async function amendShiftTypeOverride(
  client: DispositionRpc,
  row: PendingOverrideRow,
  shiftTypeId: string,
  reason: string,
): Promise<DispositionOutcome> {
  if (!rowOffersOf(row).amend) return { ok: false, code: DISPOSITION_FAILED };

  const entry = amendEntryOf(row, shiftTypeId, reason);

  if (!entry.ok) return entry;

  return settled(() =>
    client.rpc(AMEND_OVERRIDE_FUNCTION, {
      p_override_id: row.id,
      p_shift_type_id: entry.shiftTypeId,
      p_reason: entry.reason,
    }),
  );
}

/** Discard `row`'s override: 0021's soft-remove, attributed by the database. */
export async function discardShiftTypeOverride(client: DispositionRpc, row: PendingOverrideRow): Promise<DispositionOutcome> {
  return settled(() => client.rpc(DISCARD_OVERRIDE_FUNCTION, { p_override_id: row.id }));
}

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these refusals becomes Croatian. */
export function dispositionMessageKey(
  failure: DispositionFailure,
):
  | 'rotation.builder.overrides.refused.denied'
  | 'rotation.builder.overrides.refused.gone'
  | 'rotation.builder.overrides.refused.archived'
  | 'rotation.builder.overrides.refused.reason'
  | 'rotation.builder.overrides.refused.sameAsProjected'
  | 'rotation.builder.overrides.refused.failed' {
  if (failure === DISPOSITION_DENIED) return 'rotation.builder.overrides.refused.denied';
  if (failure === DISPOSITION_GONE) return 'rotation.builder.overrides.refused.gone';
  if (failure === DISPOSITION_ARCHIVED) return 'rotation.builder.overrides.refused.archived';
  if (failure === DISPOSITION_REASON) return 'rotation.builder.overrides.refused.reason';
  if (failure === DISPOSITION_SAME_AS_PROJECTED) return 'rotation.builder.overrides.refused.sameAsProjected';
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
