import { describe, expect, it } from 'vitest';

import {
  DEACTIVATE,
  TEAM_MOVE,
  MEMBER_ACCOUNT_STRANDED,
  MEMBER_PASSWORD_NOT_APPLIED,
  MEMBER_READ_REFUSED,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_EFFECT,
  MEMBER_STATUS_IN_PAST,
  MEMBER_STATUS_OUT_OF_ORDER,
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_STATUS_UNCHANGED,
  MEMBER_TEAM_ARCHIVED,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_EFFECT,
  MEMBER_TEAM_IN_PAST,
  MEMBER_TEAM_OUT_OF_ORDER,
  MEMBER_TEAM_POSITION_REQUIRED,
  MEMBER_TEAM_POSITION_UNCHANGED,
  MEMBER_TEAM_SCHEDULED,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_UNPICKED,
  MEMBER_TEAM_UNCHANGED,
  MEMBER_UNKNOWN,
  MEMBER_USERNAME_INVALID,
  MEMBER_USERNAME_NOT_APPLIED,
  MEMBER_USERNAME_TAKEN,
  MEMBER_USERNAME_UNSETTLED,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_REFUSED,
  MEMBER_WRITE_UNAVAILABLE,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
  statusFailureOf,
  statusPreflightOf,
  teamFailureOf,
  teamPreflightOf,
  type MemberWriteFailure,
  type MemberWriteRefusal,
} from '@/features/members/services/write';
import { dateMarkFor, dateMarked } from '@/features/members/utils/date-refusal';

/** Whether a code marks the date when the preflight raised it, and when the
 *  server write came back with it. */
interface Marks {
  readonly preflight: boolean;
  readonly server: boolean;
}

const DATE: Marks = { preflight: true, server: true };
const OTHER: Marks = { preflight: false, server: false };

/**
 * EVERY MEMBER WRITE CODE, CLASSIFIED ONCE. Keyed by the `MemberWriteFailure`
 * union itself, so a code added to it fails to compile here until somebody
 * decides whether it names the date. The status and team blocks raise a subset;
 * the form's own codes (username, password, account) are classified too, as
 * never naming the date, because the union does not say which block raises
 * what.
 */
const CLASSIFIED: Readonly<Record<MemberWriteFailure, Marks>> = {
  // `MEMBER_WRITE_INVALID` IS "NOT A DATE" ONLY FROM THE PREFLIGHT. From the
  // server write it is any 22xxx or 23xxx — a check constraint, a malformed
  // team or position — and names no value in particular.
  [MEMBER_WRITE_INVALID]: { preflight: true, server: false },
  [MEMBER_STATUS_IN_PAST]: DATE,
  [MEMBER_STATUS_DATE_TAKEN]: DATE,
  [MEMBER_STATUS_OUT_OF_ORDER]: DATE,
  [MEMBER_TEAM_IN_PAST]: DATE,
  [MEMBER_TEAM_DATE_TAKEN]: DATE,
  [MEMBER_TEAM_OUT_OF_ORDER]: DATE,
  [MEMBER_STATUS_SELF]: OTHER,
  [MEMBER_STATUS_UNCHANGED]: OTHER,
  [MEMBER_STATUS_IN_EFFECT]: OTHER,
  [MEMBER_STATUS_STALE]: OTHER,
  [ORGANIZATION_WOULD_HAVE_NO_ADMIN]: OTHER,
  [MEMBER_TEAM_UNCHANGED]: OTHER,
  [MEMBER_TEAM_POSITION_UNCHANGED]: OTHER,
  [MEMBER_TEAM_POSITION_REQUIRED]: OTHER,
  [MEMBER_TEAM_SCHEDULED]: OTHER,
  [MEMBER_TEAM_IN_EFFECT]: OTHER,
  [MEMBER_TEAM_ARCHIVED]: OTHER,
  [MEMBER_TEAM_STALE]: OTHER,
  // STORY 7.11: the placeholder names the team picker, never the date.
  [MEMBER_TEAM_UNPICKED]: OTHER,
  [MEMBER_WRITE_UNAVAILABLE]: OTHER,
  [MEMBER_WRITE_REFUSED]: OTHER,
  [MEMBER_USERNAME_TAKEN]: OTHER,
  [MEMBER_USERNAME_INVALID]: OTHER,
  [MEMBER_UNKNOWN]: OTHER,
  [MEMBER_USERNAME_NOT_APPLIED]: OTHER,
  [MEMBER_USERNAME_UNSETTLED]: OTHER,
  [MEMBER_PASSWORD_NOT_APPLIED]: OTHER,
  [MEMBER_ACCOUNT_STRANDED]: OTHER,
  [MEMBER_READ_REFUSED]: OTHER,
};

const CASES = (Object.entries(CLASSIFIED) as [MemberWriteFailure, Marks][]).map(
  ([code, marks]) => ({ code, ...marks }),
);

const HISTORY = 'history-a';

describe('which refusal marks the status or team date invalid', () => {
  it('marks a date the preflight finds is not a date', () => {
    // A context is never read before the first check, so none is built.
    for (const code of [
      statusPreflightOf(DEACTIVATE, 'not-a-date', null as never),
      teamPreflightOf(TEAM_MOVE, 'not-a-date', null, null as never),
    ]) {
      expect(code).toBe(MEMBER_WRITE_INVALID);
      const refusal = { code: code ?? MEMBER_WRITE_UNAVAILABLE, saved: false };

      expect(dateMarkFor(refusal, HISTORY, true)).not.toBeNull();
    }
  });

  it('marks no date for an invalid value the server write names no field for', () => {
    // A check constraint (23514) or a malformed team or position id (22P02)
    // comes back from either write as `MEMBER_WRITE_INVALID`, about no value in
    // particular. Mapped by the write module's own functions, then marked.
    for (const sqlstate of ['23514', '22P02']) {
      const error = { code: sqlstate };

      for (const code of [
        statusFailureOf(error, DEACTIVATE, '2030-01-01', null as never),
        teamFailureOf(error, TEAM_MOVE, '2030-01-01', null, null as never),
      ]) {
        expect(code).toBe(MEMBER_WRITE_INVALID);
        expect(dateMarkFor({ code, saved: false }, HISTORY, false)).toBeNull();
      }
    }
  });

  it.each(CASES)('$code from the preflight marks the date: $preflight', ({ code, preflight }) => {
    const refusal = { code, saved: false };

    expect(dateMarkFor(refusal, HISTORY, true) !== null).toBe(preflight);
  });

  it.each(CASES)('$code from the server write marks the date: $server', ({ code, server }) => {
    const refusal = { code, saved: false };

    expect(dateMarkFor(refusal, HISTORY, false) !== null).toBe(server);
  });
});

describe('a mark stands only over the refusal and the history it was raised on', () => {
  const refusal: MemberWriteRefusal = { code: MEMBER_STATUS_IN_PAST, saved: false };
  const mark = dateMarkFor(refusal, HISTORY, true);

  it('marks the date while its refusal stands on the same history', () => {
    expect(dateMarked(mark, refusal, HISTORY)).toBe(true);
  });

  it('unmarks a block that remounted on a new history', () => {
    // A refused write is refetched, and a refetch that changes the member's
    // versions remounts the block with a fresh date in it.
    expect(dateMarked(mark, refusal, 'history-b')).toBe(false);
    expect(dateMarked(mark, refusal, null)).toBe(false);
  });

  it('unmarks when the refusal is gone or another one replaced it', () => {
    expect(dateMarked(mark, null, HISTORY)).toBe(false);
    expect(dateMarked(mark, { code: MEMBER_STATUS_IN_PAST, saved: false }, HISTORY)).toBe(false);
  });

  it('marks nothing without a mark', () => {
    expect(dateMarked(null, refusal, HISTORY)).toBe(false);
  });
});
