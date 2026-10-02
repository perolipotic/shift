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
 */

/** The conflict is no longer open: resolved meanwhile, or its leave removed. */
export const RESOLUTION_GONE = 'gone';
/** The caller may not resolve conflicts. */
export const RESOLUTION_DENIED = 'denied';
/** Anything else; saving again may land. */
export const RESOLUTION_FAILED = 'failed';

export type ResolutionWriteFailure = typeof RESOLUTION_GONE | typeof RESOLUTION_DENIED | typeof RESOLUTION_FAILED;

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

/** A refused insert as this application's own failure. */
export function resolutionInsertFailureOf(error: ResolutionWriteError): ResolutionWriteFailure {
  if (error.code === UNIQUE_VIOLATION || error.code === NO_DATA_FOUND) return RESOLUTION_GONE;
  if (error.code === INSUFFICIENT_PRIVILEGE) return RESOLUTION_DENIED;

  return RESOLUTION_FAILED;
}

/**
 * Accept the conflict as uncovered. A date that is not a calendar
 * `YYYY-MM-DD` is {@link RESOLUTION_FAILED} without a request.
 */
export async function acceptUncovered(table: ResolutionInsertTable, target: ResolutionTarget): Promise<ResolutionWriteOutcome> {
  if (!isIsoDate(target.date)) {
    console.error(RESOLUTION_FAILED, 'not a calendar date');

    return { ok: false, code: RESOLUTION_FAILED };
  }

  let answered: unknown;

  try {
    answered = await table.insert({
      organization_id: target.organizationId,
      member_id: target.memberId,
      date: target.date,
      team_id: target.teamId,
      kind: ACCEPT_UNCOVERED,
    });
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

  const code = resolutionInsertFailureOf(error as ResolutionWriteError);

  if (code === RESOLUTION_FAILED) console.error(code, (error as ResolutionWriteError).code);

  return { ok: false, code };
}

/** The line a failure renders as. Exhaustive. */
export function resolutionFailureMessageKey(
  failure: ResolutionWriteFailure,
): 'raspored.resolution.error.gone' | 'raspored.resolution.error.denied' | 'raspored.resolution.error.failed' {
  switch (failure) {
    case RESOLUTION_GONE:
      return 'raspored.resolution.error.gone';
    case RESOLUTION_DENIED:
      return 'raspored.resolution.error.denied';
    case RESOLUTION_FAILED:
      return 'raspored.resolution.error.failed';
    default: {
      const unhandled: never = failure;

      return unhandled;
    }
  }
}
