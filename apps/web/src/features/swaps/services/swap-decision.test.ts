import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CALENDAR_KEY, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import type { LeaveRowsAnswer } from '@/features/conflicts/services/conflicts-queue';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import { ORGANIZATION_CONFLICT_RESOLUTIONS_KEY } from '@/features/conflicts/services/resolutions';
import { ACTING_ADMINS_KEY } from '@/features/conflicts/services/resolved-conflicts';
import { ORGANIZATION_LEAVE_RECORDS_KEY } from '@/features/leave/services/leave-list';
import { calendarOverrideRow, calendarRosterOverrideRow } from '@/features/rotation/rotation.fixture';
import { SHORT_STAFFED_KNOWN } from '@/features/staffing/services/short-staffed';
import {
  CLOSED_AT,
  DECIDING_ADMIN,
  IVO,
  KARLO,
  TEAM_A,
  TEAM_B,
  adminSwapSnapshotOf,
  decidedSwapRowOf,
  swapRowOf,
} from '@/features/swaps/organization-swaps.fixture';
import {
  ORGANIZATION_SWAP_REQUESTS_KEY,
  SWAP_APPROVED,
  SWAP_REJECTED,
  organizationSwapsOf,
  type OrganizationSwap,
} from '@/features/swaps/services/organization-swaps';
import {
  DECIDE_SWAP_REQUEST_FUNCTION,
  SWAP_DECISION_ARCHIVED,
  SWAP_DECISION_DENIED,
  SWAP_DECISION_FAILED,
  SWAP_DECISION_MEMBER_INACTIVE,
  SWAP_DECISION_NOT_WAITING,
  SWAP_DECISION_STALE,
  SWAP_DECISION_TAKEN,
  SWAP_SCREEN_CLOSED,
  SWAP_SCREEN_LOADING,
  SWAP_SCREEN_MISSING,
  SWAP_SCREEN_UNAVAILABLE,
  SWAP_SCREEN_WAITING,
  decideSwapRequest,
  swapDecisionFailureMessageKey,
  swapDecisionFailureOf,
  swapDecisionOf,
  swapDecisionRefreshKeysOf,
  swapDecisionSurfaceKeysOf,
  swapErasureCheckOf,
  swapNeedsActors,
  swapNeedsPreview,
  swapStatusMessageKey,
  type DecideSwapRequestRpc,
  type SwapDecisionFailure,
  type SwapDecisionScreen,
  type SwapDecisionSources,
} from '@/features/swaps/services/swap-decision';
import { NO_DEPENDENTS, SWAP_REQUEST_DECISION_DEPENDENTS } from '@/features/teams/services/dependents';
import { initLocalization, t } from '@/lib/i18n';
import { persistsKey } from '@/lib/offline/persistence';

/**
 * Story 12.4's decision screen, executed (AD-15): the spec's I/O matrix over
 * the pilot — Ivo gives B's Dan on 2026-09-13 to Karlo, who is off that day —
 * on 9.4's terms.
 */

const TWELVE_HOURS = 12 * 60;
/** Noon in Zagreb on 2026-09-08: the organization's today is before the swap. */
const NOW = new Date('2026-09-08T10:00:00Z');
const ACTORS = [{ auth_user_id: DECIDING_ADMIN, name: 'Ivan Marić' }];

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  snapshot = await adminSwapSnapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function answered(data: readonly unknown[] | undefined, overrides: Partial<LeaveRowsAnswer> = {}): LeaveRowsAnswer {
  return { isPending: data === undefined, isError: false, fetchStatus: 'idle', data, ...overrides };
}

/** A leave record row as `leave_records` answers it: the upper bound exclusive. */
function leaveRowOf(id: string, memberId: string, from: string, toExclusive: string): Record<string, unknown> {
  return { id, member_id: memberId, during: `[${from},${toExclusive})` };
}

function sourcesOf(
  swapRows: readonly unknown[] = [swapRowOf()],
  overrides: Partial<SwapDecisionSources> = {},
  calendar: CalendarSnapshot = snapshot,
): SwapDecisionSources {
  return {
    swaps: answered(swapRows),
    calendar: { snapshot: calendar, refusal: null, loading: false },
    records: answered([]),
    resolutions: answered([]),
    actors: answered(ACTORS),
    ...overrides,
  };
}

function waitingOf(screen: SwapDecisionScreen): Extract<SwapDecisionScreen, { kind: typeof SWAP_SCREEN_WAITING }> {
  if (screen.kind !== SWAP_SCREEN_WAITING) throw new Error(screen.kind);

  return screen;
}

function swapOf(row: Record<string, unknown> = swapRowOf()): OrganizationSwap {
  const [swap] = organizationSwapsOf([row]) ?? [];

  if (swap === undefined) throw new Error('no swap');

  return swap;
}

describe('the states', () => {
  it('is loading while the swaps or the calendar are unanswered, and while a waiting swap\'s preview reads are', () => {
    expect(swapDecisionOf(sourcesOf([], { swaps: answered(undefined) }), 'swap-1', NOW)).toEqual({ kind: SWAP_SCREEN_LOADING });
    expect(
      swapDecisionOf({ ...sourcesOf(), calendar: { snapshot: null, refusal: null, loading: true } }, 'swap-1', NOW),
    ).toEqual({ kind: SWAP_SCREEN_LOADING });
    expect(swapDecisionOf(sourcesOf(undefined, { records: answered(undefined) }), 'swap-1', NOW)).toEqual({
      kind: SWAP_SCREEN_LOADING,
    });
    expect(swapDecisionOf(sourcesOf(undefined, { resolutions: answered(undefined) }), 'swap-1', NOW)).toEqual({
      kind: SWAP_SCREEN_LOADING,
    });
  });

  it('is unavailable when a read failed, is paused offline, or answered rows it cannot trust', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(swapDecisionOf(sourcesOf([], { swaps: answered(undefined, { isError: true, isPending: false }) }), 'swap-1', NOW).kind).toBe(
      SWAP_SCREEN_UNAVAILABLE,
    );
    expect(swapDecisionOf(sourcesOf([], { swaps: answered([swapRowOf()], { fetchStatus: 'paused' }) }), 'swap-1', NOW).kind).toBe(
      SWAP_SCREEN_UNAVAILABLE,
    );
    expect(swapDecisionOf(sourcesOf(['row']), 'swap-1', NOW).kind).toBe(SWAP_SCREEN_UNAVAILABLE);
    expect(
      swapDecisionOf({ ...sourcesOf(), calendar: { snapshot: null, refusal: 'CALENDAR_UNAVAILABLE', loading: false } }, 'swap-1', NOW)
        .kind,
    ).toBe(SWAP_SCREEN_UNAVAILABLE);
  });

  it('is missing for an id no swap has', () => {
    expect(swapDecisionOf(sourcesOf(), 'swap-9', NOW)).toEqual({ kind: SWAP_SCREEN_MISSING });
  });

  it('waits for a snapshot read again when the swap names a member it lacks (a skew), unlogged', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const newer = sourcesOf([swapRowOf({ addressee_id: 'newer-member' })]);

    expect(swapDecisionOf(newer, 'swap-1', NOW)).toEqual({ kind: SWAP_SCREEN_UNAVAILABLE });
    expect(swapDecisionOf({ ...newer, snapshotFetching: true }, 'swap-1', NOW)).toEqual({ kind: SWAP_SCREEN_LOADING });
    expect(logged).not.toHaveBeenCalled();
  });

  it('reads the preview\'s reads only for a waiting swap, and the names only for a decided one', () => {
    expect(swapNeedsPreview(swapOf())).toBe(true);
    expect(swapNeedsPreview(swapOf(swapRowOf({ answer: null })))).toBe(false);
    expect(swapNeedsPreview(null)).toBe(false);
    expect(swapNeedsActors(swapOf(decidedSwapRowOf('rejected')))).toBe(true);
    expect(swapNeedsActors(swapOf(swapRowOf({ closed_at: CLOSED_AT })))).toBe(false);
  });
});

describe('Waits: what the swap does, a warning and never a gate (R9.3)', () => {
  it('names both members, the shift, who works it, and each member\'s hours per month', () => {
    const screen = waitingOf(swapDecisionOf(sourcesOf(), 'swap-1', NOW));

    expect(screen.facts).toMatchObject({
      proposerName: 'Ivo Horvat',
      addresseeName: 'Karlo Jelić',
      given: { teamName: 'Smjena B' },
      returnShift: null,
      dateShown: '13.09.2026',
    });
    expect(screen.facts.given.day).toMatch(/13\.09\.2026$/);
    expect(screen).toMatchObject({ past: false, stale: false });
    expect(screen.preview?.lines).toEqual([
      { day: screen.facts.given.day, teamName: 'Smjena B', inName: 'Karlo Jelić', outName: 'Ivo Horvat' },
    ]);
    expect(screen.preview?.hours).toEqual([
      { memberId: IVO, month: '2026-09', deltaMinutes: -TWELVE_HOURS, name: 'Ivo Horvat' },
      { memberId: KARLO, month: '2026-09', deltaMinutes: TWELVE_HOURS, name: 'Karlo Jelić' },
    ]);
    expect(screen.preview).toMatchObject({ onLeave: [], overlaps: [], shortStaffed: null });
  });

  it('counts a half-day proposer\'s worked half alone: −6 h for them, +12 h for the colleague (story 13.5)', () => {
    const half = { ...leaveRowOf('leave-ivo', IVO, '2026-09-13', '2026-09-14'), half: 'FIRST' };
    const screen = waitingOf(swapDecisionOf(sourcesOf(undefined, { records: answered([half]) }), 'swap-1', NOW));

    expect(screen.preview?.hours).toEqual([
      { memberId: IVO, month: '2026-09', deltaMinutes: -TWELVE_HOURS / 2, name: 'Ivo Horvat' },
      { memberId: KARLO, month: '2026-09', deltaMinutes: TWELVE_HOURS, name: 'Karlo Jelić' },
    ]);
  });

  it('with a return shift: both dates, the proposer back on the colleague\'s shift, and the hours netting out', () => {
    const screen = waitingOf(
      swapDecisionOf(sourcesOf([swapRowOf({ return_team_id: TEAM_A, return_date: '2026-09-14' })]), 'swap-1', NOW),
    );

    expect(screen.preview?.lines.map((line) => [line.teamName, line.inName, line.outName])).toEqual([
      ['Smjena B', 'Karlo Jelić', 'Ivo Horvat'],
      ['Smjena A', 'Ivo Horvat', 'Karlo Jelić'],
    ]);
    expect(screen.preview?.hours.map((delta) => delta.deltaMinutes)).toEqual([0, 0]);
  });

  it('warns when the member it puts on a shift has leave that date — and both decisions stay', () => {
    const screen = waitingOf(
      swapDecisionOf(sourcesOf(undefined, { records: answered([leaveRowOf('leave-karlo', KARLO, '2026-09-13', '2026-09-14')]) }), 'swap-1', NOW),
    );

    expect(screen.preview?.onLeave).toEqual([{ name: 'Karlo Jelić', day: screen.facts.given.day }]);
    expect(screen.stale).toBe(false);
  });

  it('warns of a double booking of the member it puts on, over the swap\'s "after"', async () => {
    // A's day off on 13.09 made a Dan: Karlo already works 07:00–19:00 there when the swap puts him on B's Dan.
    const doubled = await adminSwapSnapshotOf({ overrides: [calendarOverrideRow('ov-a', TEAM_A, '2026-09-13', 'pilot-dan')] });
    const screen = waitingOf(swapDecisionOf(sourcesOf(undefined, {}, doubled), 'swap-1', NOW));

    expect(screen.preview?.overlaps).toEqual([
      expect.objectContaining({ memberName: 'Karlo Jelić', teamName: 'Smjena A', date: '2026-09-13', range: '07:00–19:00' }),
    ]);
    expect(screen.stale).toBe(false);
  });

  it('is stale, and still waiting, once the given shift is no longer the proposer\'s', async () => {
    // A roster override took Ivo off B's 13.09 since he proposed: the swap no longer describes the schedule.
    const off = await adminSwapSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-off', TEAM_B, '2026-09-13', IVO, null)],
    });
    const screen = swapDecisionOf(sourcesOf(undefined, {}, off), 'swap-1', NOW);

    expect(screen.kind).toBe(SWAP_SCREEN_WAITING);
    expect(waitingOf(screen)).toMatchObject({ past: false, stale: true });
  });

  it('reports what it newly leaves short of people, from the earlier date to the later, with the minimum set', async () => {
    // Ivo takes A's Dan on 14.09 in return, while on leave that day: A then has one at work of the two required.
    const minimum = await adminSwapSnapshotOf({ minimumMembers: 2 });
    const screen = waitingOf(
      swapDecisionOf(
        sourcesOf([swapRowOf({ return_team_id: TEAM_A, return_date: '2026-09-14' })], {
          records: answered([leaveRowOf('leave-ivo', IVO, '2026-09-14', '2026-09-15')]),
        }, minimum),
        'swap-1',
        NOW,
      ),
    );

    expect(screen.preview?.shortStaffed).toEqual({
      kind: SHORT_STAFFED_KNOWN,
      rows: [expect.objectContaining({ date: '2026-09-14', teamName: 'Smjena A', atWork: 1, minimum: 2 })],
      more: 0,
    });
    expect(screen.preview?.onLeave).toEqual([{ name: 'Ivo Horvat', day: screen.facts.returnShift?.day }]);
  });

  it('keeps the swap waiting when the preview\'s reads fail or pause: the unknown line, and Odbij reachable', () => {
    for (const records of [
      answered(undefined, { isError: true, isPending: false }),
      answered([], { fetchStatus: 'paused' }),
    ]) {
      const screen = waitingOf(swapDecisionOf(sourcesOf(undefined, { records }), 'swap-1', NOW));

      expect(screen.preview).toBeNull();
      expect(screen.stale).toBe(false);
    }
  });

  it('Past: a date before today says so, and Odobri stays', () => {
    const screen = waitingOf(swapDecisionOf(sourcesOf(), 'swap-1', new Date('2026-09-14T10:00:00Z')));

    expect(screen.past).toBe(true);
    expect(screen.stale).toBe(false);
    expect(screen.preview).not.toBeNull();
  });

  it('Stale: the given shift no longer the proposer\'s withholds Odobri, and shows what can still be derived', async () => {
    const off = await adminSwapSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-off', TEAM_B, '2026-09-13', IVO, null)],
    });
    const screen = waitingOf(swapDecisionOf(sourcesOf(undefined, {}, off), 'swap-1', NOW));

    expect(screen.stale).toBe(true);
    // Ivo is no longer on the shift, so the change itself is refused (ROSTER_TAKEN): no preview.
    expect(screen.preview).toBeNull();

    // A's Dan on 14.09 made a day off: Karlo no longer works the return shift, so the swap is
    // stale — yet the change itself still applies, and what it would do is still shown.
    const moved = await adminSwapSnapshotOf({
      overrides: [calendarOverrideRow('ov-free', TEAM_A, '2026-09-14', 'pilot-slobodno')],
    });
    const withReturn = waitingOf(
      swapDecisionOf(sourcesOf([swapRowOf({ return_team_id: TEAM_A, return_date: '2026-09-14' })], {}, moved), 'swap-1', NOW),
    );

    expect(withReturn.stale).toBe(true);
    expect(withReturn.preview?.lines).toHaveLength(2);
  });

  it('a preview that cannot be derived is none, logged, and the screen stands', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const screen = waitingOf(swapDecisionOf(sourcesOf(undefined, { records: answered(['junk']) }), 'swap-1', NOW));

    expect(screen.preview).toBeNull();
    expect(screen.stale).toBe(false);
    expect(logged).toHaveBeenCalled();
  });
});

describe('a swap no longer waiting, opened by URL: read-only', () => {
  it('says who decided and when', () => {
    const screen = swapDecisionOf(sourcesOf([decidedSwapRowOf('approved')]), 'swap-1', NOW);

    expect(screen).toMatchObject({
      kind: SWAP_SCREEN_CLOSED,
      line: { actor: 'Ivan Marić', date: '07.09.2026', time: '12:00' },
    });
  });

  it('names an admin no longer a member as none, and waits for the names', () => {
    expect(swapDecisionOf(sourcesOf([decidedSwapRowOf('rejected')], { actors: answered([]) }), 'swap-1', NOW)).toMatchObject({
      kind: SWAP_SCREEN_CLOSED,
      line: { actor: null },
    });
    expect(swapDecisionOf(sourcesOf([decidedSwapRowOf('rejected')], { actors: answered(undefined) }), 'swap-1', NOW)).toEqual({
      kind: SWAP_SCREEN_LOADING,
    });
  });

  it('says only its word for a withdrawn, declined or proposed swap', () => {
    for (const row of [
      swapRowOf({ closed_at: CLOSED_AT }),
      swapRowOf({ answer: 'declined', closed_at: CLOSED_AT }),
      swapRowOf({ answer: null }),
    ]) {
      expect(swapDecisionOf(sourcesOf([row], { actors: answered(undefined) }), 'swap-1', NOW)).toMatchObject({
        kind: SWAP_SCREEN_CLOSED,
        line: null,
      });
    }
  });

  it('words every status', () => {
    const words = ['proposed', 'accepted', 'declined', 'withdrawn', 'approved', 'rejected', 'deactivated'] as const;

    expect(words.map((status) => t(swapStatusMessageKey(status)))).toEqual([
      'Čeka odgovor kolege',
      'Čeka odluku',
      'Odbijena',
      'Povučena',
      'Odobrena',
      'Nije odobrena',
      'Zatvorena deaktivacijom',
    ]);
  });
});

describe('the approval\'s erasure check (AD-5)', () => {
  function readsOf(calendar: CalendarSnapshot, records: readonly unknown[] = []): () => Promise<ErasureReads> {
    return () => Promise.resolve({ calendar, records, resolutions: [] });
  }

  it('erases nothing over fresh reads: the write may go at once', async () => {
    expect(await swapErasureCheckOf(readsOf(snapshot), swapOf(), true)).toEqual({ kind: CHECK_READY, rows: [] });
  });

  it('Approve, erasure: the proposer on leave on the given date leaves an unresolved collision the swap would erase', async () => {
    const check = await swapErasureCheckOf(
      readsOf(snapshot, [leaveRowOf('leave-ivo', IVO, '2026-09-13', '2026-09-14')]),
      swapOf(),
      true,
    );

    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    expect(check.rows.map((row) => [row.memberName, row.date, row.teamName, row.teamWorks])).toEqual([
      ['Ivo Horvat', '2026-09-13', 'Smjena B', true],
    ]);
  });

  it('diffs from the earlier date: a return shift before the given one is checked too', async () => {
    const check = await swapErasureCheckOf(
      readsOf(snapshot, [leaveRowOf('leave-karlo', KARLO, '2026-09-10', '2026-09-11')]),
      swapOf(swapRowOf({ return_team_id: TEAM_A, return_date: '2026-09-10' })),
      true,
    );

    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    expect(check.rows.map((row) => [row.memberName, row.date])).toEqual([['Karlo Jelić', '2026-09-10']]);
  });

  it('Stale over fresh reads: refused before anything is derived', async () => {
    const off = await adminSwapSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-off', TEAM_B, '2026-09-13', IVO, null)],
    });

    expect(await swapErasureCheckOf(readsOf(off), swapOf(), true)).toEqual({ kind: CHECK_REFUSED, code: SWAP_DECISION_STALE });
  });

  it('cannot be derived offline, or over a read that fails: refused with a retry, nothing written unchecked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await swapErasureCheckOf(readsOf(snapshot), swapOf(), false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(await swapErasureCheckOf(() => Promise.reject(new Error('network')), swapOf(), true)).toEqual({
      kind: CHECK_UNAVAILABLE,
    });
    expect(await swapErasureCheckOf(readsOf(snapshot, ['junk']), swapOf(), true)).toEqual({ kind: CHECK_UNAVAILABLE });
  });
});

describe('the decision', () => {
  function rpcAnswering(answer: unknown) {
    const rpc = vi.fn(async () => answer);

    return { client: { rpc } as unknown as DecideSwapRequestRpc, rpc };
  }

  it('approves with the overrides\' reason, and rejects with none', async () => {
    const { client, rpc } = rpcAnswering({ error: null });

    expect(await decideSwapRequest(client, 'swap-1', SWAP_APPROVED, 'Odobrena zamjena')).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith(DECIDE_SWAP_REQUEST_FUNCTION, {
      p_request_id: 'swap-1',
      p_outcome: 'approved',
      p_reason: 'Odobrena zamjena',
    });
    expect(await decideSwapRequest(client, 'swap-1', SWAP_REJECTED, 'ignored')).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith(DECIDE_SWAP_REQUEST_FUNCTION, { p_request_id: 'swap-1', p_outcome: 'rejected', p_reason: null });
    expect(t('zaOdluku.swap.approvalReason')).toBe('Odobrena zamjena');
  });

  it.each([
    ['P0002', 'SWAP_REQUEST_NOT_OPEN', SWAP_DECISION_NOT_WAITING],
    ['42501', 'SWAP_REQUEST_DECISION_REFUSED', SWAP_DECISION_DENIED],
    ['55000', 'SWAP_REQUEST_MEMBER_INACTIVE', SWAP_DECISION_MEMBER_INACTIVE],
    ['23505', 'duplicate key value', SWAP_DECISION_TAKEN],
    ['23514', 'ROSTER_OVERRIDE_ARCHIVED', SWAP_DECISION_ARCHIVED],
    ['23514', 'new row violates check constraint', SWAP_DECISION_FAILED],
    ['22023', 'SWAP_REQUEST_OUTCOME_UNKNOWN', SWAP_DECISION_FAILED],
  ] as const)('maps %s to its refusal', async (code, message, failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = rpcAnswering({ error: { code, message } });

    expect(await decideSwapRequest(client, 'swap-1', SWAP_APPROVED, 'Odobrena zamjena')).toEqual({ ok: false, code: failure });
  });

  it('maps by 0049\'s message when the code is missing, and anything else to failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(swapDecisionFailureOf({ message: 'SWAP_REQUEST_NOT_OPEN' })).toBe(SWAP_DECISION_NOT_WAITING);
    expect(swapDecisionFailureOf({ message: 'SWAP_REQUEST_MEMBER_INACTIVE' })).toBe(SWAP_DECISION_MEMBER_INACTIVE);
    expect(swapDecisionFailureOf({})).toBe(SWAP_DECISION_FAILED);
    expect(await decideSwapRequest(rpcAnswering('nope').client, 'swap-1', SWAP_REJECTED, null)).toEqual({
      ok: false,
      code: SWAP_DECISION_FAILED,
    });
    expect(await decideSwapRequest(rpcAnswering({ error: 'nope' }).client, 'swap-1', SWAP_REJECTED, null)).toEqual({
      ok: false,
      code: SWAP_DECISION_FAILED,
    });

    const throwing = { rpc: () => Promise.reject(new Error('network')) } as unknown as DecideSwapRequestRpc;

    expect(await decideSwapRequest(throwing, 'swap-1', SWAP_REJECTED, null)).toEqual({ ok: false, code: SWAP_DECISION_FAILED });
  });

  it('re-reads everything an approval changes after a decision or a refusal that says something moved; nothing more for a refusal of the session', () => {
    for (const outcome of [
      SWAP_APPROVED,
      SWAP_REJECTED,
      SWAP_DECISION_NOT_WAITING,
      SWAP_DECISION_MEMBER_INACTIVE,
      SWAP_DECISION_TAKEN,
      SWAP_DECISION_ARCHIVED,
      SWAP_DECISION_STALE,
    ] as const) {
      expect(swapDecisionRefreshKeysOf(outcome)).toBe(SWAP_REQUEST_DECISION_DEPENDENTS);
    }
    expect(swapDecisionRefreshKeysOf(SWAP_DECISION_DENIED)).toBe(NO_DEPENDENTS);
    expect(swapDecisionRefreshKeysOf(SWAP_DECISION_FAILED)).toBe(NO_DEPENDENTS);
    expect(SWAP_REQUEST_DECISION_DEPENDENTS).toEqual(
      expect.arrayContaining([ORGANIZATION_SWAP_REQUESTS_KEY, CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY]),
    );
  });

  it('words every refusal, and never says konflikt', () => {
    const failures: readonly SwapDecisionFailure[] = [
      SWAP_DECISION_NOT_WAITING,
      SWAP_DECISION_DENIED,
      SWAP_DECISION_MEMBER_INACTIVE,
      SWAP_DECISION_TAKEN,
      SWAP_DECISION_ARCHIVED,
      SWAP_DECISION_FAILED,
      SWAP_DECISION_STALE,
    ];
    const lines = failures.map((code) => t(swapDecisionFailureMessageKey(code)));

    expect(lines[0]).toBe('Zamjena više ne čeka odluku.');
    expect(new Set(lines).size).toBe(failures.length);
    for (const line of lines) expect(line.toLowerCase()).not.toContain('konflikt');
  });
});

describe('one snapshot (story 8.2)', () => {
  it('stands on the swaps and the calendar; a waiting swap on the leave and resolutions too; a decided one on the names', () => {
    expect(swapDecisionSurfaceKeysOf(false, false)).toEqual([ORGANIZATION_SWAP_REQUESTS_KEY, CALENDAR_KEY]);
    expect(swapDecisionSurfaceKeysOf(true, false)).toEqual([
      ORGANIZATION_SWAP_REQUESTS_KEY,
      CALENDAR_KEY,
      ORGANIZATION_LEAVE_RECORDS_KEY,
      ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
    ]);
    expect(swapDecisionSurfaceKeysOf(false, true)).toEqual([ORGANIZATION_SWAP_REQUESTS_KEY, CALENDAR_KEY, ACTING_ADMINS_KEY]);
  });

  it('keeps every key on the device', () => {
    for (const key of swapDecisionSurfaceKeysOf(true, true)) expect(persistsKey(key), JSON.stringify(key)).toBe(true);
  });
});

describe('the queue\'s status line once a decision lands', () => {
  it('names both members and the given date', () => {
    expect(t('zaOdluku.savedSwapApproved', { proposer: 'Ivo Horvat', addressee: 'Karlo Jelić', date: '13.09.2026' })).toBe(
      'Zamjena odobrena: Ivo Horvat → Karlo Jelić, 13.09.2026.',
    );
    expect(t('zaOdluku.savedSwapRejected', { proposer: 'Ivo Horvat', addressee: 'Karlo Jelić', date: '13.09.2026' })).toBe(
      'Zamjena nije odobrena: Ivo Horvat → Karlo Jelić, 13.09.2026.',
    );
  });
});

