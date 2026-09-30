import {
  ROSTER_REFUSED_MEMBER,
  ROSTER_REFUSED_REASON,
  rosterEntryOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';

/**
 * Changing a shift's roster from the day detail (story 3.6b) — the calendar's
 * second write module, beside `override-write.ts`, in a `.ts` that renders
 * nothing (AD-15).
 *
 * WRITING IS 0026's PLAIN INSERT of the six facts, one row per action: a
 * member taken off only removes, one put on only adds, and both replace.
 * `created_by` and `created_at` come from their defaults, and the insert
 * policy admits an active admin of the claimed organization alone, on a team
 * that is not archived.
 *
 * REMOVING IS 0027's DEFINER FUNCTION, `remove_roster_override`, which sets
 * `removed_by` and `removed_at` on the server: a soft-remove, never a delete,
 * and never a change in place — to change a change, remove it and save a new
 * one.
 *
 * Codes, never messages: {@link rosterWriteMessageKey} is the one edge.
 */

/** The table a roster change is inserted into (0026). */
export const ROSTER_OVERRIDES_TABLE = 'roster_overrides';

/** The function a roster change is removed through (0027). */
export const REMOVE_ROSTER_OVERRIDE_FUNCTION = 'remove_roster_override';

/** A live roster change naming one of the members on the shift landed first (23505). */
export const ROSTER_TAKEN = 'taken';
/** The roster change is no longer live: removed already, or gone from reach (P0002). */
export const ROSTER_GONE = 'gone';
/** The caller may not change rosters (42501). */
export const ROSTER_DENIED = 'denied';
/** Anything else, 23503 included: try again. */
export const ROSTER_FAILED = 'failed';

export type RosterWriteFailure =
  | typeof ROSTER_REFUSED_MEMBER
  | typeof ROSTER_REFUSED_REASON
  | typeof ROSTER_TAKEN
  | typeof ROSTER_GONE
  | typeof ROSTER_DENIED
  | typeof ROSTER_FAILED;

export type RosterWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RosterWriteFailure };

// ----------------------------------------------------------------- the seams

export interface RosterWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | null | undefined;
}

export interface RosterWriteAnswer {
  readonly error: RosterWriteError | null;
}

/** `insert` AND NOTHING ELSE: no update, no delete, no upsert. */
export interface RosterTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<RosterWriteAnswer>;
}

/** The one function a removal calls, named structurally so it can be stubbed. */
export interface RosterRemoval {
  rpc(
    fn: typeof REMOVE_ROSTER_OVERRIDE_FUNCTION,
    args: { readonly p_override_id: string },
  ): PromiseLike<RosterWriteAnswer>;
}

// ---------------------------------------------------------------- the rules

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const NO_DATA_FOUND = 'P0002';

/** 0026's two member checks, which a `23514` names in its message. */
const MEMBER_CHECKS = ['roster_overrides_member_present', 'roster_overrides_members_distinct'] as const;

/**
 * A refused INSERT, as this application's own failure. `23514` naming one of
 * 0026's member checks — no member, or one member on both sides, which the
 * preflight spares but the database decides — is {@link ROSTER_REFUSED_MEMBER};
 * any other `23514` is the reason's (the date's and the removal's checks are
 * never the browser's to break). `23505` is a live change naming the same
 * member on the shift, `42501` the policy's refusal. `23503` — a team or a
 * member of another tenant — `P0002`, which an insert never answers, and
 * everything unforeseen are {@link ROSTER_FAILED}.
 */
export function rosterInsertFailureOf(error: RosterWriteError): RosterWriteFailure {
  if (error.code === CHECK_VIOLATION) {
    const said = `${error.message ?? ''} ${error.details ?? ''}`;

    return MEMBER_CHECKS.some((check) => said.includes(check)) ? ROSTER_REFUSED_MEMBER : ROSTER_REFUSED_REASON;
  }
  if (error.code === UNIQUE_VIOLATION) return ROSTER_TAKEN;
  if (error.code === INSUFFICIENT_PRIVILEGE) return ROSTER_DENIED;

  return ROSTER_FAILED;
}

/**
 * A refused REMOVAL (0027), as this application's own failure: `42501` the
 * caller is no active admin, `P0002` the change is no longer live, and
 * everything else {@link ROSTER_FAILED}.
 */
export function rosterRemovalFailureOf(error: RosterWriteError): RosterWriteFailure {
  if (error.code === INSUFFICIENT_PRIVILEGE) return ROSTER_DENIED;
  if (error.code === NO_DATA_FOUND) return ROSTER_GONE;

  return ROSTER_FAILED;
}

/** Settle one write: a thrown call, a malformed answer, an error mapped by `failureOf`, or success. */
async function settled(
  write: () => PromiseLike<RosterWriteAnswer>,
  failureOf: (error: RosterWriteError) => RosterWriteFailure,
): Promise<RosterWriteOutcome> {
  let answered: RosterWriteAnswer;

  try {
    answered = await write();
  } catch (cause) {
    console.error(ROSTER_FAILED, cause);

    return { ok: false, code: ROSTER_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(ROSTER_FAILED, typeof answered);

    return { ok: false, code: ROSTER_FAILED };
  }

  if (answered.error !== null) {
    const code = failureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, code };
  }

  return { ok: true };
}

/**
 * Change the roster of `detail`'s team on its date: take `memberOutId` off,
 * put `memberInId` on, or both (`''` for a side not chosen). The entry is
 * preflighted first ({@link rosterEntryOf}): no member chosen, one member on
 * both sides, or a blank or overlong reason, is refused without a request. What is sent is the trimmed
 * reason.
 */
export async function setRosterOverride(
  table: RosterTable,
  organizationId: string,
  detail: DayDetail,
  memberOutId: string,
  memberInId: string,
  reason: string,
): Promise<RosterWriteOutcome> {
  const entry = rosterEntryOf(memberOutId, memberInId, reason);

  if (!entry.ok) return entry;

  return settled(
    () =>
      table.insert({
        organization_id: organizationId,
        team_id: detail.teamId,
        date: detail.isoDate,
        member_out_id: entry.memberOutId,
        member_in_id: entry.memberInId,
        reason: entry.reason,
      }),
    rosterInsertFailureOf,
  );
}

/** Remove the roster change `overrideId`; the database attributes the removal. */
export async function removeRosterOverride(client: RosterRemoval, overrideId: string): Promise<RosterWriteOutcome> {
  return settled(
    () => client.rpc(REMOVE_ROSTER_OVERRIDE_FUNCTION, { p_override_id: overrideId }),
    rosterRemovalFailureOf,
  );
}

/** A roster change was saved on the open day. */
export const ROSTER_SAVED = 'saved';

/** A roster change of the open day was removed. */
export const ROSTER_REMOVED_DONE = 'removedDone';

/** What the day detail confirms once a write has landed, in a `role="status"` Notice. */
export type RosterDone = typeof ROSTER_SAVED | typeof ROSTER_REMOVED_DONE;

// ------------------------------------------------------------ the messages

/** The edge, and the only place one of these codes becomes Croatian. */
export function rosterWriteMessageKey(
  failure: RosterWriteFailure,
):
  | 'kalendar.detail.rosterChange.refused.member'
  | 'kalendar.detail.rosterChange.refused.reason'
  | 'kalendar.detail.rosterChange.refused.taken'
  | 'kalendar.detail.rosterChange.refused.gone'
  | 'kalendar.detail.rosterChange.refused.denied'
  | 'kalendar.detail.rosterChange.refused.failed' {
  if (failure === ROSTER_REFUSED_MEMBER) return 'kalendar.detail.rosterChange.refused.member';
  if (failure === ROSTER_REFUSED_REASON) return 'kalendar.detail.rosterChange.refused.reason';
  if (failure === ROSTER_TAKEN) return 'kalendar.detail.rosterChange.refused.taken';
  if (failure === ROSTER_GONE) return 'kalendar.detail.rosterChange.refused.gone';
  if (failure === ROSTER_DENIED) return 'kalendar.detail.rosterChange.refused.denied';
  if (failure === ROSTER_FAILED) return 'kalendar.detail.rosterChange.refused.failed';

  const unhandled: never = failure;

  return unhandled;
}

/** The key a landed write is said with. */
export function rosterDoneMessageKey(
  done: RosterDone,
): 'kalendar.detail.rosterChange.saved' | 'kalendar.detail.rosterChange.removedDone' {
  if (done === ROSTER_SAVED) return 'kalendar.detail.rosterChange.saved';
  if (done === ROSTER_REMOVED_DONE) return 'kalendar.detail.rosterChange.removedDone';

  const unhandled: never = done;

  return unhandled;
}
