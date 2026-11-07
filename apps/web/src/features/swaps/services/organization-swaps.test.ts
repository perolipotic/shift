import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { unknownSnapshotIdsOf } from '@/features/calendar/services/snapshot-skew';
import { calendarRosterOverrideRow } from '@/features/rotation/rotation.fixture';
import {
  CLOSED_AT,
  DECIDING_ADMIN,
  IVO,
  KARLO,
  SENT_AT,
  TEAM_A,
  TEAM_B,
  adminSwapSnapshotOf,
  decidedSwapRowOf,
  swapDecisionRowOf,
  swapRowOf,
} from '@/features/swaps/organization-swaps.fixture';
import {
  DECISIONS_EMBED,
  ORGANIZATION_SWAPS_UNAVAILABLE,
  ORGANIZATION_SWAP_REQUESTS_COLUMNS,
  ORGANIZATION_SWAP_REQUESTS_KEY,
  SWAP_ACCEPTED,
  SWAP_APPROVED,
  SWAP_DEACTIVATED,
  SWAP_DECLINED,
  SWAP_PROPOSED,
  SWAP_REJECTED,
  SWAP_WITHDRAWN,
  decidedSwapsOf,
  organizationSwapFoundOf,
  organizationSwapRequestsQueryOptions,
  organizationSwapsOf,
  readOrganizationSwapRows,
  swapChangedLaterOf,
  swapFirstDateOf,
  swapLastDateOf,
  waitingSwapsOf,
  type OrganizationSwapsTable,
} from '@/features/swaps/services/organization-swaps';

/** Story 12.4's organization read, executed (AD-15): the parse, the queue's facts and *Odlučeno*'s. */

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  snapshot = await adminSwapSnapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A paged select on the organization's swaps answering `pages` in turn, recording every call. */
function pagedTable(pages: readonly unknown[]): OrganizationSwapsTable & { calls: unknown[] } {
  const calls: unknown[] = [];
  let page = 0;
  const query = {
    order: (column: string, options: { readonly ascending: boolean }) => {
      calls.push(['order', column, options.ascending]);

      return query;
    },
    range: (from: number, to: number) => {
      calls.push(['range', from, to]);

      return Promise.resolve(pages[page++]) as never;
    },
  };

  return {
    calls,
    select: (columns, options) => {
      calls.push(['select', columns, options.count]);

      return query;
    },
  };
}

describe('the read (story 12.4)', () => {
  it('selects every swap with its decision, ordered by id, counted exactly, under its own key', async () => {
    const rows = [swapRowOf()];
    const table = pagedTable([{ data: rows, error: null, count: 1 }]);

    expect(await readOrganizationSwapRows(table)).toEqual({ ok: true, rows });
    expect(table.calls).toEqual([
      ['select', ORGANIZATION_SWAP_REQUESTS_COLUMNS, 'exact'],
      ['order', 'id', true],
      ['range', 0, 999],
    ]);
    expect(ORGANIZATION_SWAP_REQUESTS_COLUMNS).toContain(
      `${DECISIONS_EMBED}(outcome,roster_override_id,return_roster_override_id,decided_by,decided_at)`,
    );
    expect(ORGANIZATION_SWAP_REQUESTS_COLUMNS).toContain('created_at');
    expect(organizationSwapRequestsQueryOptions(() => table).queryKey).toEqual(ORGANIZATION_SWAP_REQUESTS_KEY);
    expect(ORGANIZATION_SWAP_REQUESTS_KEY).toEqual(['organization-swap-requests']);
  });

  it('is unavailable when the read fails or its count disagrees, and the query rejects with the code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailable = { ok: false, code: ORGANIZATION_SWAPS_UNAVAILABLE };

    expect(await readOrganizationSwapRows(pagedTable([{ data: null, error: { code: '42501' }, count: null }]))).toEqual(unavailable);
    expect(await readOrganizationSwapRows(pagedTable([{ data: [], error: null, count: 2 }]))).toEqual(unavailable);
    await expect(
      organizationSwapRequestsQueryOptions(() => pagedTable([{ data: null, error: { code: 'x' }, count: null }])).queryFn?.(
        {} as never,
      ),
    ).rejects.toThrow(ORGANIZATION_SWAPS_UNAVAILABLE);
  });
});

describe('the parse, never a partial list', () => {
  it('derives every status, with when it was sent and its decision', () => {
    const swaps = organizationSwapsOf([
      swapRowOf({ id: 'proposed', answer: null }),
      swapRowOf({ id: 'accepted' }),
      swapRowOf({ id: 'declined', answer: 'declined', closed_at: CLOSED_AT }),
      swapRowOf({ id: 'withdrawn', closed_at: CLOSED_AT }),
      decidedSwapRowOf('approved', { id: 'approved' }),
      decidedSwapRowOf('rejected', { id: 'rejected' }),
      decidedSwapRowOf('deactivated', { id: 'deactivated', answer: null }),
    ]);

    expect(swaps?.map((swap) => [swap.id, swap.status])).toEqual([
      ['proposed', SWAP_PROPOSED],
      ['accepted', SWAP_ACCEPTED],
      ['declined', SWAP_DECLINED],
      ['withdrawn', SWAP_WITHDRAWN],
      ['approved', SWAP_APPROVED],
      ['rejected', SWAP_REJECTED],
      ['deactivated', SWAP_DEACTIVATED],
    ]);
    expect(swaps?.[1]).toMatchObject({ createdAt: SENT_AT, decision: null, given: { teamId: TEAM_B, date: '2026-09-13' } });
    expect(swaps?.[4]?.decision).toEqual({
      outcome: SWAP_APPROVED,
      rosterOverrideId: 'ro-given',
      returnRosterOverrideId: null,
      decidedBy: DECIDING_ADMIN,
      decidedAt: CLOSED_AT,
    });
    expect(swaps?.[5]?.decision).toMatchObject({ outcome: SWAP_REJECTED, rosterOverrideId: null });
  });

  it('reads an approval with a return shift as naming both overrides', () => {
    const swaps = organizationSwapsOf([
      decidedSwapRowOf(
        'approved',
        { return_team_id: TEAM_A, return_date: '2026-09-14' },
        { return_roster_override_id: 'ro-return' },
      ),
    ]);

    expect(swaps?.[0]?.decision).toMatchObject({ rosterOverrideId: 'ro-given', returnRosterOverrideId: 'ro-return' });
  });

  it.each([
    ['a row that is not one', 'row'],
    ['no id', swapRowOf({ id: '' })],
    ['one member on both sides', swapRowOf({ addressee_id: IVO })],
    ['a date that is not one', swapRowOf({ date: '13.09.2026' })],
    ['a half-named return', swapRowOf({ return_team_id: TEAM_A })],
    ['a return that is the given shift', swapRowOf({ return_team_id: TEAM_B, return_date: '2026-09-13' })],
    ['open and declined', swapRowOf({ answer: 'declined' })],
    ['an approval never accepted', decidedSwapRowOf('approved', { answer: null })],
    ['an approval naming no override', decidedSwapRowOf('approved', {}, { roster_override_id: null })],
    ['an approval of a one-way cover naming a return override', decidedSwapRowOf('approved', {}, { return_roster_override_id: 'ro-x' })],
    [
      'an approval with a return shift naming no return override',
      decidedSwapRowOf('approved', { return_team_id: TEAM_A, return_date: '2026-09-14' }),
    ],
    ['a rejection naming an override', decidedSwapRowOf('rejected', {}, { roster_override_id: 'ro-x' })],
    ['a decision without its author', decidedSwapRowOf('rejected', {}, { decided_by: null })],
    ['a decision without its instant', decidedSwapRowOf('rejected', {}, { decided_at: 'never' })],
    ['a sending instant that is not one', swapRowOf({ created_at: 'never' })],
    ['two decisions', swapRowOf({ closed_at: CLOSED_AT, [DECISIONS_EMBED]: [swapDecisionRowOf('approved'), swapDecisionRowOf('rejected')] })],
  ])('refuses every row for %s, and logs it', (_name, bad) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(organizationSwapsOf([swapRowOf({ id: 'kept' }), bad])).toBeNull();
    expect(logged).toHaveBeenCalledWith(ORGANIZATION_SWAPS_UNAVAILABLE, 'row');
  });

  it('refuses two rows of one id', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(organizationSwapsOf([swapRowOf(), swapRowOf({ date: '2026-09-17' })])).toBeNull();
  });

  it('finds one swap by id, none, or nothing it can trust', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(organizationSwapFoundOf([swapRowOf()], 'swap-1')?.swap?.id).toBe('swap-1');
    expect(organizationSwapFoundOf([swapRowOf()], 'swap-9')).toEqual({ swap: null });
    expect(organizationSwapFoundOf(['row'], 'swap-1')).toBeNull();
  });

  it('dates a swap by the earlier of its dates, and spans it to the later', () => {
    const [swap] = organizationSwapsOf([swapRowOf({ return_team_id: TEAM_A, return_date: '2026-09-10' })]) ?? [];

    if (swap === undefined) throw new Error('no swap');

    expect(swapFirstDateOf(swap)).toBe('2026-09-10');
    expect(swapLastDateOf(swap)).toBe('2026-09-13');
  });
});

describe('the swaps waiting for an admin (the queue)', () => {
  it('lists the open, accepted ones alone, named, dated by the earlier date', () => {
    const waiting = waitingSwapsOf(
      snapshot,
      [
        swapRowOf({ id: 'proposed', answer: null }),
        swapRowOf({ id: 'withdrawn', closed_at: CLOSED_AT }),
        decidedSwapRowOf('approved', { id: 'approved' }),
        swapRowOf({ id: 'waiting', return_team_id: TEAM_A, return_date: '2026-09-10' }),
      ],
      '2026-09-08',
    );

    expect(waiting).toEqual([
      {
        requestId: 'waiting',
        date: '2026-09-10',
        dateShown: '10.09.2026',
        proposerName: 'Ivo Horvat',
        addresseeName: 'Karlo Jelić',
        given: { date: '2026-09-13', dateShown: '13.09.2026', teamName: 'Smjena B' },
        returnShift: { date: '2026-09-10', dateShown: '10.09.2026', teamName: 'Smjena A' },
        past: false,
        createdAt: SENT_AT,
      },
    ]);
  });

  it('is past when either date is before today', () => {
    const rows = [swapRowOf({ return_team_id: TEAM_A, return_date: '2026-09-10' })];

    expect(waitingSwapsOf(snapshot, rows, '2026-09-10')[0]?.past).toBe(false);
    expect(waitingSwapsOf(snapshot, rows, '2026-09-11')[0]?.past).toBe(true);
  });

  it('refuses a row it cannot trust, and a member the snapshot lacks, as a RangeError', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => waitingSwapsOf(snapshot, ['row'], '2026-09-08')).toThrow(RangeError);
    expect(() => waitingSwapsOf(snapshot, [swapRowOf({ addressee_id: 'newer-member' })], '2026-09-08')).toThrow(RangeError);
  });

  it('tells a member or team newer than the snapshot apart, as a skew (unknownSnapshotIdsOf)', () => {
    expect(
      unknownSnapshotIdsOf(snapshot, [], [], [], [swapRowOf({ addressee_id: 'newer-member', return_team_id: 'newer-team', return_date: '2026-09-10' })]),
    ).toEqual(['member:newer-member', 'team:newer-team']);
    expect(unknownSnapshotIdsOf(snapshot, [], [], [], [swapRowOf()])).toEqual([]);
  });
});

describe('the decided swaps (Odlučeno, UX-DR52)', () => {
  const actors = new Map([[DECIDING_ADMIN, 'Ivan Marić']]);

  it('lists approved, rejected and deactivation-closed swaps with who decided and when; never a withdrawn or declined one', () => {
    const decided = decidedSwapsOf(
      snapshot,
      [
        swapRowOf({ id: 'waiting' }),
        swapRowOf({ id: 'withdrawn', closed_at: CLOSED_AT }),
        swapRowOf({ id: 'declined', answer: 'declined', closed_at: CLOSED_AT }),
        decidedSwapRowOf('rejected', { id: 'rejected' }),
        decidedSwapRowOf('deactivated', { id: 'deactivated', answer: null }, { decided_by: 'gone-admin' }),
      ],
      actors,
    );

    expect(decided.map((swap) => [swap.requestId, swap.outcome, swap.actorName, swap.changedLater])).toEqual([
      ['rejected', SWAP_REJECTED, 'Ivan Marić', false],
      ['deactivated', SWAP_DEACTIVATED, null, false],
    ]);
    expect(decided[0]).toMatchObject({
      proposerName: 'Ivo Horvat',
      addresseeName: 'Karlo Jelić',
      decidedOn: '07.09.2026',
      decidedAt: '12:00',
      at: Date.parse(CLOSED_AT),
    });
  });

  it('says an approved swap was changed later once an override it wrote is no longer live', async () => {
    const live = await adminSwapSnapshotOf({
      rosterOverrides: [calendarRosterOverrideRow('ro-given', TEAM_B, '2026-09-13', IVO, KARLO)],
    });
    const approved = decidedSwapRowOf('approved');

    expect(decidedSwapsOf(live, [approved], actors)[0]?.changedLater).toBe(false);
    // Amended (0039 replaces the id) or removed: the snapshot no longer holds it.
    expect(decidedSwapsOf(snapshot, [approved], actors)[0]?.changedLater).toBe(true);

    const withReturn = decidedSwapRowOf(
      'approved',
      { return_team_id: TEAM_A, return_date: '2026-09-14' },
      { return_roster_override_id: 'ro-return' },
    );

    expect(decidedSwapsOf(live, [withReturn], actors)[0]?.changedLater).toBe(true);
  });

  it('never says a rejection was changed', () => {
    expect(
      swapChangedLaterOf(snapshot, {
        outcome: SWAP_REJECTED,
        rosterOverrideId: null,
        returnRosterOverrideId: null,
        decidedBy: DECIDING_ADMIN,
        decidedAt: CLOSED_AT,
      }),
    ).toBe(false);
  });
});
