import { ACCEPT_UNCOVERED, CONFLICT_RESOLUTIONS_TABLE } from '@/features/conflicts/services/resolutions';
import { isIsoDate } from '@/lib/i18n/format';

/**
 * The one write story 5.4b makes (CAP-16, AD-4, AD-11): a conflict accepted
 * as uncovered, inserted DIRECTLY into `conflict_resolutions` the way a leave
 * record is written (`recordLeave`), in a `.ts` that renders nothing (AD-15).
 *
 * FIVE COLUMNS, NOTHING ELSE. The organization, the conflict's key
 * `(member_id, date, team_id)` and the kind; `created_by` and `created_at`
 * come from 0031's defaults, which the client cannot forge. The collision is
 * never computed in the database: 0031 only refuses a resolution off leave.
 *
 * THE REFUSALS (0031), as this application's own failures:
 *   - 23505 (the live key: already resolved) and P0002 (no live leave covers
 *     the date any more) are {@link RESOLUTION_GONE} — the conflict is no
 *     longer open;
 *   - 42501 (not an active admin of the organization) is
 *     {@link RESOLUTION_DENIED};
 *   - everything else — a network error, a malformed answer, a composite or
 *     check refusal, the unforeseen — is {@link RESOLUTION_FAILED}, which the
 *     screen offers to retry.
 *
 * Nothing is optimistic: the caller re-reads the resolutions after any
 * outcome, and the queue drops the conflict only from what the re-read says.
 *
 * THE SECOND WRITE (story 5.4c): a replacement, through 0032's definer
 * function `replace_conflict_member` ALONE — the roster override that puts
 * the replacement on (nobody taken off) and the `replace_member` resolution
 * linked to it, in one transaction. The reason is the caller's, generated
 * through `t()`. Its refusals map as the insert's, plus one: a 23505 named
 * `CONFLICT_REPLACEMENT_TAKEN` — the replacement is already put on that
 * shift — is {@link RESOLUTION_TAKEN}; any other 23505 is the resolution's
 * live key, {@link RESOLUTION_GONE}.
 *
 * A KEY HELD BY A REPLACEMENT THAT DOES NOT APPLY (story 5.5d). When the
 * screen knows a live `replace_member` row still holds the key although its
 * override no longer applies (`ResolutionView.held`), the caller passes
 * `held`, and a 23505 on the resolution's live key — from either write — is
 * {@link RESOLUTION_HELD}: the override must be removed in the calendar
 * first, which ends that resolution (0033).
 */

/** The conflict is no longer open: resolved meanwhile, or its leave removed. */
export const RESOLUTION_GONE = 'gone';
/** The caller may not resolve conflicts. */
export const RESOLUTION_DENIED = 'denied';
/** Anything else; saving again may land. */
export const RESOLUTION_FAILED = 'failed';
/** The replacement is already put on that shift (story 5.4c): pick someone else. */
export const RESOLUTION_TAKEN = 'taken';
/** A replacement that no longer applies still holds the key (story 5.5d): remove it in the calendar, then decide. */
export const RESOLUTION_HELD = 'held';

export type ResolutionWriteFailure =
  | typeof RESOLUTION_HELD
  | typeof RESOLUTION_GONE
  | typeof RESOLUTION_DENIED
  | typeof RESOLUTION_FAILED
  | typeof RESOLUTION_TAKEN;

export type ResolutionWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ResolutionWriteFailure };

/** 0031's live key. */
const UNIQUE_VIOLATION = '23505';
/** 0031's trigger: no live leave covers the date. */
const NO_DATA_FOUND = 'P0002';
/** 0031's policy or privilege. */
const INSUFFICIENT_PRIVILEGE = '42501';

export interface ResolutionWriteError {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface ResolutionWriteAnswer {
  readonly error: ResolutionWriteError | null;
}

/** The row inserted: 0031's five writable columns. */
export interface ResolutionInsertRow {
  readonly organization_id: string;
  readonly member_id: string;
  readonly date: string;
  readonly team_id: string;
  readonly kind: typeof ACCEPT_UNCOVERED;
}

/** The one call made on `conflict_resolutions`, named structurally so it can be stubbed. */
export interface ResolutionInsertTable {
  insert(row: ResolutionInsertRow): PromiseLike<ResolutionWriteAnswer>;
}

/** The table the write goes to (0031). */
export const RESOLUTION_WRITE_TABLE = CONFLICT_RESOLUTIONS_TABLE;

/** What is decided: the organization, and the conflict's key. */
export interface ResolutionTarget {
  readonly organizationId: string;
  readonly memberId: string;
  readonly date: string;
  readonly teamId: string;
}

/** The function a replacement is written through (0032). */
export const REPLACE_CONFLICT_MEMBER_FUNCTION = 'replace_conflict_member';

/** 0032's message for a replacement already put on the shift, under 23505. */
const REPLACEMENT_TAKEN_MESSAGE = 'CONFLICT_REPLACEMENT_TAKEN';

/** The arguments 0032's function takes. */
export interface ReplaceConflictMemberArgs {
  readonly p_member_id: string;
  readonly p_date: string;
  readonly p_team_id: string;
  readonly p_replacement_id: string;
  readonly p_reason: string;
}

/** The one call a replacement makes, named structurally so it can be stubbed. */
export interface ResolutionReplaceRpc {
  rpc(fn: typeof REPLACE_CONFLICT_MEMBER_FUNCTION, args: ReplaceConflictMemberArgs): PromiseLike<ResolutionWriteAnswer>;
}

/** What a replacement adds to the target: who is put on, and why. */
export interface ReplacementTarget extends ResolutionTarget {
  readonly replacementId: string;
  /** Generated through `t()` by the caller: "Zamjena za {member} (godišnji)". */
  readonly reason: string;
}

/** 0026's bound on a roster override's reason, in code points once trimmed (`char_length`). */
export const REPLACEMENT_REASON_MAX = 200;

/**
 * The reason as 0026 admits it: trimmed, then clipped to
 * {@link REPLACEMENT_REASON_MAX} code points and trimmed again — so a long
 * member name never makes every replacement fail with 23514.
 */
export function replacementReasonOf(reason: string): string {
  return Array.from(reason.trim()).slice(0, REPLACEMENT_REASON_MAX).join('').trim();
}

/**
 * A refused insert as this application's own failure; `held` (story 5.5d)
 * turns the live key's 23505 into {@link RESOLUTION_HELD}.
 */
export function resolutionInsertFailureOf(error: ResolutionWriteError, held = false): ResolutionWriteFailure {
  if (error.code === UNIQUE_VIOLATION && held) return RESOLUTION_HELD;
  if (error.code === UNIQUE_VIOLATION || error.code === NO_DATA_FOUND) return RESOLUTION_GONE;
  if (error.code === INSUFFICIENT_PRIVILEGE) return RESOLUTION_DENIED;

  return RESOLUTION_FAILED;
}

/** A refused replacement as this application's own failure: the insert's, plus the replacement already put on. */
export function resolutionReplaceFailureOf(error: ResolutionWriteError, held = false): ResolutionWriteFailure {
  if (error.code === UNIQUE_VIOLATION && error.message === REPLACEMENT_TAKEN_MESSAGE) return RESOLUTION_TAKEN;

  return resolutionInsertFailureOf(error, held);
}

/**
 * Accept the conflict as uncovered. A date that is not a calendar
 * `YYYY-MM-DD` is {@link RESOLUTION_FAILED} without a request. `held`: the
 * screen knows a replacement that does not apply holds the key (story 5.5d).
 */
export async function acceptUncovered(
  table: ResolutionInsertTable,
  target: ResolutionTarget,
  held = false,
): Promise<ResolutionWriteOutcome> {
  return settledWrite(
    target.date,
    () =>
      table.insert({
        organization_id: target.organizationId,
        member_id: target.memberId,
        date: target.date,
        team_id: target.teamId,
        kind: ACCEPT_UNCOVERED,
      }),
    (error) => resolutionInsertFailureOf(error, held),
  );
}

/**
 * Resolve the conflict by putting `replacementId` on the shift (story 5.4c),
 * through 0032's function. A date that is not a calendar `YYYY-MM-DD` is
 * {@link RESOLUTION_FAILED} without a request. `held` as for
 * {@link acceptUncovered}.
 */
export async function replaceMember(
  client: ResolutionReplaceRpc,
  target: ReplacementTarget,
  held = false,
): Promise<ResolutionWriteOutcome> {
  return settledWrite(
    target.date,
    () =>
      client.rpc(REPLACE_CONFLICT_MEMBER_FUNCTION, {
        p_member_id: target.memberId,
        p_date: target.date,
        p_team_id: target.teamId,
        p_replacement_id: target.replacementId,
        p_reason: replacementReasonOf(target.reason),
      }),
    (error) => resolutionReplaceFailureOf(error, held),
  );
}

/** One write, settled: no request for a bad date, and every answer — thrown, malformed or refused — as an outcome. */
async function settledWrite(
  date: string,
  write: () => PromiseLike<ResolutionWriteAnswer>,
  failureOf: (error: ResolutionWriteError) => ResolutionWriteFailure,
): Promise<ResolutionWriteOutcome> {
  if (!isIsoDate(date)) {
    console.error(RESOLUTION_FAILED, 'not a calendar date');

    return { ok: false, code: RESOLUTION_FAILED };
  }

  let answered: unknown;

  try {
    answered = await write();
  } catch (cause) {
    console.error(RESOLUTION_FAILED, cause);

    return { ok: false, code: RESOLUTION_FAILED };
  }

  if (typeof answered !== 'object' || answered === null) {
    console.error(RESOLUTION_FAILED, typeof answered);

    return { ok: false, code: RESOLUTION_FAILED };
  }

  // `null` alone is success; an absent or non-object error is a malformed answer.
  const error: unknown = (answered as Record<string, unknown>)['error'];

  if (error === null) return { ok: true };

  if (typeof error !== 'object' || error === undefined) {
    console.error(RESOLUTION_FAILED, typeof error);

    return { ok: false, code: RESOLUTION_FAILED };
  }

  const code = failureOf(error as ResolutionWriteError);

  if (code === RESOLUTION_FAILED) console.error(code, (error as ResolutionWriteError).code);

  return { ok: false, code };
}

type FailureKey = ReturnType<typeof resolutionFailureMessageKey>;

/** A failure's line: its key, and for the taken line the name it says. */
export interface ResolutionFailureLine {
  readonly key: FailureKey;
  readonly values?: { readonly name: string };
}

/**
 * The line a failure renders as, with its values: the taken line names who
 * was already on the shift, and without a name falls back to the failed line
 * — the taken key is never rendered without one.
 */
export function resolutionFailureLineOf(failure: ResolutionWriteFailure, taken: string | null): ResolutionFailureLine {
  switch (failure) {
    case RESOLUTION_HELD:
    case RESOLUTION_GONE:
    case RESOLUTION_DENIED:
    case RESOLUTION_FAILED:
      return { key: resolutionFailureMessageKey(failure) };
    case RESOLUTION_TAKEN:
      return taken === null
        ? { key: resolutionFailureMessageKey(RESOLUTION_FAILED) }
        : { key: resolutionFailureMessageKey(failure), values: { name: taken } };
    default: {
      const unhandled: never = failure;

      return unhandled;
    }
  }
}

/** The line a failure renders as. Exhaustive. */
export function resolutionFailureMessageKey(
  failure: ResolutionWriteFailure,
):
  | 'raspored.resolution.held'
  | 'raspored.resolution.error.gone'
  | 'raspored.resolution.error.denied'
  | 'raspored.resolution.error.failed'
  | 'raspored.resolution.error.taken' {
  switch (failure) {
    // The same line the screen states while the key is held (story 5.5d).
    case RESOLUTION_HELD:
      return 'raspored.resolution.held';
    case RESOLUTION_GONE:
      return 'raspored.resolution.error.gone';
    case RESOLUTION_DENIED:
      return 'raspored.resolution.error.denied';
    case RESOLUTION_FAILED:
      return 'raspored.resolution.error.failed';
    case RESOLUTION_TAKEN:
      return 'raspored.resolution.error.taken';
    default: {
      const unhandled: never = failure;

      return unhandled;
    }
  }
}
