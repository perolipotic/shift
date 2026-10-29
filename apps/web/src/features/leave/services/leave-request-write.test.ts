import { afterEach, describe, expect, it, vi } from 'vitest';

import { REQUEST_APPROVED, REQUEST_REJECTED } from '@/features/leave/services/leave-request-list';
import {
  DECIDE_LEAVE_REQUEST_FUNCTION,
  REQUEST_APPROVAL_STALE,
  REQUEST_DENIED,
  REQUEST_FAILED,
  REQUEST_MEMBER_INACTIVE,
  REQUEST_NOT_PENDING,
  REQUEST_OVERLAPS_LEAVE,
  REQUEST_OVERLAPS_REQUEST,
  WITHDRAW_LEAVE_REQUEST_FUNCTION,
  decideLeaveRequest,
  leaveRequestDecideFailureOf,
  leaveRequestSendFailureOf,
  leaveRequestWithdrawFailureOf,
  sendLeaveRequest,
  withdrawLeaveRequest,
  type DecideLeaveRequestRpc,
  type LeaveRequestInsertTable,
  type WithdrawLeaveRequestRpc,
} from '@/features/leave/services/leave-request-write';

/** Stories 9.3 and 9.4: the write side of the 0040 boundary of leave requests, executed (AD-15). */

const MEMBER = 'member-1';
const ORGANIZATION = 'organization-1';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The withdrawal's and the decision's call, answering `answer` and recording each function and its arguments. */
function rpcAnswering(answer: unknown): WithdrawLeaveRequestRpc & DecideLeaveRequestRpc & { calls: unknown[] } {
  const calls: unknown[] = [];

  return {
    calls,
    rpc: (fn: string, args: object) => {
      calls.push([fn, args]);

      return Promise.resolve(answer) as never;
    },
  };
}

describe('the send', () => {
  function insertAnswering(answer: unknown): LeaveRequestInsertTable & { sent: unknown[] } {
    const sent: unknown[] = [];

    return {
      sent,
      insert: (values) => {
        sent.push(values);

        return Promise.resolve(answer) as never;
      },
    };
  }

  it('inserts the three facts, the range as an inclusive daterange literal, the ids as given', async () => {
    const table = insertAnswering({ error: null });

    expect(await sendLeaveRequest(table, ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({ ok: true });
    expect(table.sent).toEqual([{ organization_id: ORGANIZATION, member_id: MEMBER, during: '[2026-11-02,2026-11-04]' }]);
  });

  it.each([
    ['an overlap with live leave', { code: '23P01', message: 'LEAVE_REQUEST_OVERLAPS_LEAVE' }, REQUEST_OVERLAPS_LEAVE],
    ['an overlap with a pending request', { code: '23P01', message: 'conflicting key value violates exclusion constraint' }, REQUEST_OVERLAPS_REQUEST],
    ['a refusal', { code: '42501', message: 'new row violates row-level security policy' }, REQUEST_DENIED],
    ['a date the member is inactive (0041)', { code: '55000', message: 'LEAVE_REQUEST_MEMBER_INACTIVE' }, REQUEST_MEMBER_INACTIVE],
    ['another 55000', { code: '55000', message: 'something else' }, REQUEST_FAILED],
    ['a check', { code: '23514', message: 'leave_requests_during_at_most_366_days' }, REQUEST_FAILED],
  ] as const)('maps %s by SQLSTATE and message', async (_name, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestSendFailureOf(error)).toBe(code);
    expect(await sendLeaveRequest(insertAnswering({ error }), ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code,
    });
  });

  it.each([
    ['a date that is no calendar date', '2026-02-30', '2026-03-02'],
    ['a reversed range', '2026-11-04', '2026-11-02'],
  ])('sends nothing for %s', async (_name, from, to) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = insertAnswering({ error: null });

    expect(await sendLeaveRequest(table, ORGANIZATION, MEMBER, from, to)).toEqual({ ok: false, code: REQUEST_FAILED });
    expect(table.sent).toEqual([]);
  });

  it("fails on an answer with no error key, as leave-write's answeredErrorOf reads one", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await sendLeaveRequest(insertAnswering({}), ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
  });

  it('fails, never throws, when the call throws or answers nothing it can read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing: LeaveRequestInsertTable = { insert: () => Promise.reject(new Error('network')) };

    expect(await sendLeaveRequest(throwing, ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
    expect(await sendLeaveRequest(insertAnswering(null), ORGANIZATION, MEMBER, '2026-11-02', '2026-11-04')).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
  });
});

describe('the withdrawal', () => {
  it("calls 0040's definer with the request's id", async () => {
    const client = rpcAnswering({ error: null });

    expect(await withdrawLeaveRequest(client, 'request-1')).toEqual({ ok: true });
    expect(client.calls).toEqual([[WITHDRAW_LEAVE_REQUEST_FUNCTION, { p_request_id: 'request-1' }]]);
  });

  it.each([
    ['no longer pending', { code: 'P0002', message: 'LEAVE_REQUEST_NOT_PENDING' }, REQUEST_NOT_PENDING],
    ['not allowed', { code: '42501', message: 'LEAVE_REQUEST_WITHDRAWAL_REFUSED' }, REQUEST_DENIED],
    ['anything else', { code: '22P02', message: 'invalid input syntax for type uuid' }, REQUEST_FAILED],
  ] as const)('maps %s', async (_name, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestWithdrawFailureOf(error)).toBe(code);
    expect(await withdrawLeaveRequest(rpcAnswering({ error }), 'request-1')).toEqual({ ok: false, code });
  });

  it('fails, never throws, when the call throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client: WithdrawLeaveRequestRpc = { rpc: () => Promise.reject(new Error('network')) };

    expect(await withdrawLeaveRequest(client, 'request-1')).toEqual({ ok: false, code: REQUEST_FAILED });
  });
});

describe('the decision (story 9.4)', () => {
  it("calls 0040's definer with the request's id and the outcome, approval or rejection", async () => {
    const client = rpcAnswering({ data: 'record-1', error: null });

    expect(await decideLeaveRequest(client, 'request-1', REQUEST_APPROVED)).toEqual({ ok: true });
    expect(await decideLeaveRequest(rpcAnswering({ data: null, error: null }), 'request-1', REQUEST_REJECTED)).toEqual({
      ok: true,
    });
    expect(client.calls).toEqual([[DECIDE_LEAVE_REQUEST_FUNCTION, { p_request_id: 'request-1', p_outcome: 'approved' }]]);
  });

  it.each([
    ['no longer pending', { code: 'P0002', message: 'LEAVE_REQUEST_NOT_PENDING' }, REQUEST_NOT_PENDING],
    ['a stale approval', { code: '23P01', message: 'LEAVE_REQUEST_APPROVAL_OVERLAPS_LEAVE' }, REQUEST_APPROVAL_STALE],
    ['not allowed', { code: '42501', message: 'LEAVE_REQUEST_DECISION_REFUSED' }, REQUEST_DENIED],
    ['an approval onto an inactive date (0041)', { code: '55000', message: 'LEAVE_REQUEST_MEMBER_INACTIVE' }, REQUEST_MEMBER_INACTIVE],
    ['another 55000', { code: '55000', message: 'something else' }, REQUEST_FAILED],
    ['anything else', { code: '22023', message: 'LEAVE_REQUEST_OUTCOME_UNKNOWN' }, REQUEST_FAILED],
  ] as const)('maps %s', async (_name, error, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(leaveRequestDecideFailureOf(error)).toBe(code);
    expect(await decideLeaveRequest(rpcAnswering({ error }), 'request-1', REQUEST_APPROVED)).toEqual({ ok: false, code });
  });

  it('fails, never throws, when the call throws or answers nothing it can read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const client: DecideLeaveRequestRpc = { rpc: () => Promise.reject(new Error('network')) };

    expect(await decideLeaveRequest(client, 'request-1', REQUEST_REJECTED)).toEqual({ ok: false, code: REQUEST_FAILED });
    expect(await decideLeaveRequest(rpcAnswering(null), 'request-1', REQUEST_REJECTED)).toEqual({
      ok: false,
      code: REQUEST_FAILED,
    });
  });
});
