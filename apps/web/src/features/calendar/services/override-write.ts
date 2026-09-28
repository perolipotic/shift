import {
  OVERRIDE_REFUSED_REASON,
  OVERRIDE_REFUSED_SAME,
  overrideEntryOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';

/**
 * Setting and removing a shift-type override from the day detail (story
 * 3.5b) — the calendar's ONE write module, in a `.ts` that renders nothing
 * (AD-15). Every other calendar file only reads.
 *
 * SETTING IS 0019's PLAIN INSERT of the five facts; `created_by` and
 * `created_at` come from their defaults, and the insert policy admits an
 * active admin of the claimed organization alone, on a team and a type that
 * are not archived.
 *
 * REMOVING IS 0021's DEFINER FUNCTION, `remove_shift_type_override`, which
 * sets `removed_by` and `removed_at` on the server: a soft-remove, never a
 * delete, and never a change in place — to change an override, remove it and
 * set a new one.
 *
 * Codes, never messages: {@link overrideWriteMessageKey} is the one edge.
 */

/** The table an override is inserted into (0019). */
export const OVERRIDES_TABLE = 'shift_type_overrides';

/** The function an override is removed through (0021). */
export const REMOVE_OVERRIDE_FUNCTION = 'remove_shift_type_override';

/** Another live override of the team on the date landed first (23505). */
export const OVERRIDE_TAKEN = 'taken';
/** The override is no longer live: removed already, or gone from reach (P0002). */
export const OVERRIDE_GONE = 'gone';
/** The caller may not write overrides (42501). */
export const OVERRIDE_DENIED = 'denied';
/** Anything else, 23503 included: try again. */
export const OVERRIDE_FAILED = 'failed';

export type OverrideWriteFailure =
  | typeof OVERRIDE_REFUSED_REASON
  | typeof OVERRIDE_REFUSED_SAME
  | typeof OVERRIDE_TAKEN
  | typeof OVERRIDE_GONE
  | typeof OVERRIDE_DENIED
  | typeof OVERRIDE_FAILED;

export type OverrideWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: OverrideWriteFailure };

// ----------------------------------------------------------------- the seams

export interface OverrideWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface OverrideWriteAnswer {
  readonly error: OverrideWriteError | null;
}

/** `insert` AND NOTHING ELSE: no update, no delete, no upsert. */
export interface OverrideTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<OverrideWriteAnswer>;
}

/** The one function a removal calls, named structurally so it can be stubbed. */
export interface OverrideRemoval {
  rpc(fn: typeof REMOVE_OVERRIDE_FUNCTION, args: { readonly p_override_id: string }): PromiseLike<OverrideWriteAnswer>;
}

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NO_DATA_FOUND = 'P0002';

/**
 * A refusal of either write, as this application's own failure. `23514` IS
 * THE REASON, because 0019's only checks a session can trip are the reason's
 * (the date's and the removal's are never the browser's to break). `23505` is
 * the one live override per team and date. `23503` — a team or type of
 * another tenant — and everything unforeseen are {@link OVERRIDE_FAILED}.
 */
export function overrideWriteFailureOf(error: OverrideWriteError): OverrideWriteFailure {
  if (error.code === CHECK_VIOLATION) return OVERRIDE_REFUSED_REASON;
  if (error.code === UNIQUE_VIOLATION) return OVERRIDE_TAKEN;
  if (error.code === NO_DATA_FOUND) return OVERRIDE_GONE;
  if (error.code === INSUFFICIENT_PRIVILEGE) return OVERRIDE_DENIED;

  return OVERRIDE_FAILED;
}

/** Settle one write: a thrown call, a malformed answer, an error, or success. */
async function settled(write: () => PromiseLike<OverrideWriteAnswer>): Promise<OverrideWriteOutcome> {
  let answered: OverrideWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(OVERRIDE_FAILED, cause);

    return { ok: false, code: OVERRIDE_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(OVERRIDE_FAILED, typeof answered);

    return { ok: false, code: OVERRIDE_FAILED };
  }

  if (answered.error !== null) {
    const code = overrideWriteFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  return { ok: true };
}

/**
 * Set an override of `detail`'s team on its date. The entry is preflighted
 * first ({@link overrideEntryOf}): a blank or overlong reason, or the
 * projected type, is refused without a request. What is sent is the trimmed
 * reason.
 */
export async function setShiftTypeOverride(
  table: OverrideTable,
  organizationId: string,
  detail: DayDetail,
  shiftTypeId: string,
  reason: string,
): Promise<OverrideWriteOutcome> {
  const entry = overrideEntryOf(detail, shiftTypeId, reason);

  if (!entry.ok) return entry;

  return settled(() =>
    table.insert({
      organization_id: organizationId,
      team_id: detail.teamId,
      date: detail.isoDate,
      shift_type_id: entry.shiftTypeId,
      reason: entry.reason,
    }),
  );
}

/** Remove the override `overrideId`; the database attributes the removal. */
export async function removeShiftTypeOverride(
  client: OverrideRemoval,
  overrideId: string,
): Promise<OverrideWriteOutcome> {
  return settled(() => client.rpc(REMOVE_OVERRIDE_FUNCTION, { p_override_id: overrideId }));
}

/** An override was saved on the open day. */
export const OVERRIDE_SAVED = 'saved';

/** The open day's override was removed, and the projected type is back. */
export const OVERRIDE_REMOVED = 'removed';

/**
 * What the day detail confirms once a write has landed, in a `role="status"`
 * Notice: the save, or the removal with the type the rotation restores —
 * `null` for an override pending review (story 3.5c), on any kind of day,
 * whose removal restores nothing the day did not already show.
 */
export type OverrideDone =
  | { readonly code: typeof OVERRIDE_SAVED }
  | { readonly code: typeof OVERRIDE_REMOVED; readonly projectedTypeName: string | null };

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. */
export function overrideWriteMessageKey(
  failure: OverrideWriteFailure,
):
  | 'kalendar.detail.override.refused.reason'
  | 'kalendar.detail.override.refused.sameAsProjected'
  | 'kalendar.detail.override.refused.taken'
  | 'kalendar.detail.override.refused.gone'
  | 'kalendar.detail.override.refused.denied'
  | 'kalendar.detail.override.refused.failed' {
  if (failure === OVERRIDE_REFUSED_REASON) return 'kalendar.detail.override.refused.reason';
  if (failure === OVERRIDE_REFUSED_SAME) return 'kalendar.detail.override.refused.sameAsProjected';
  if (failure === OVERRIDE_TAKEN) return 'kalendar.detail.override.refused.taken';
  if (failure === OVERRIDE_GONE) return 'kalendar.detail.override.refused.gone';
  if (failure === OVERRIDE_DENIED) return 'kalendar.detail.override.refused.denied';
  if (failure === OVERRIDE_FAILED) return 'kalendar.detail.override.refused.failed';

  const unhandled: never = failure;

  return unhandled;
}

/** The key a landed write is said with. */
export function overrideDoneMessageKey(
  done: OverrideDone,
):
  | 'kalendar.detail.override.saved'
  | 'kalendar.detail.override.removed'
  | 'kalendar.detail.override.pending.removed' {
  if (done.code === OVERRIDE_SAVED) return 'kalendar.detail.override.saved';
  if (done.projectedTypeName === null) return 'kalendar.detail.override.pending.removed';

  return 'kalendar.detail.override.removed';
}
