import { beforeAll, describe, expect, it } from 'vitest';

import {
  deactivationClosedRangesText,
  deactivationClosedRequestsOf,
} from '@/features/members/services/deactivation-requests';
import { DEACTIVATE, REACTIVATE } from '@/features/members/services/wire';
import { initLocalization, t } from '@/lib/i18n';

const MEMBER = 'member-1';
const OFFER = { change: DEACTIVATE, minimum: '2026-11-01' } as const;
const CLOSED = '2026-10-20T08:00:00Z';

/** One request row as the organization's read answers it: `to` included. */
function rowOf(
  id: string,
  from: string,
  toExclusive: string,
  { memberId = MEMBER, closedAt = null as string | null, decisions = [] as unknown[] } = {},
): unknown {
  return {
    id,
    member_id: memberId,
    during: `[${from},${toExclusive})`,
    closed_at: closedAt,
    created_at: CLOSED,
    leave_request_decisions: decisions,
  };
}

describe('the requests a deactivation closes (retro 8–9, C1 + C4)', () => {
  beforeAll(async () => {
    await initLocalization();
  });

  const rows = [
    rowOf('ended', '2026-11-03', '2026-11-08'),
    rowOf('straddling', '2026-11-08', '2026-11-13'),
    rowOf('ahead', '2026-12-01', '2026-12-04'),
    rowOf('colleague', '2026-11-20', '2026-11-22', { memberId: 'member-2' }),
    rowOf('withdrawn', '2026-11-20', '2026-11-22', { closedAt: CLOSED }),
  ];

  it("names the member's pending requests reaching the day or later, whole, and none that ended before it", () => {
    const closed = deactivationClosedRequestsOf(rows, MEMBER, OFFER, '2026-11-10');

    expect(closed?.map((request) => request.id)).toEqual(['straddling', 'ahead']);
    // The last day counts: a request ending on the day is closed.
    expect(deactivationClosedRequestsOf(rows, MEMBER, OFFER, '2026-11-07')?.map((request) => request.id)).toEqual([
      'ended',
      'straddling',
      'ahead',
    ]);
  });

  it('names none for a member with no such request', () => {
    expect(deactivationClosedRequestsOf(rows, MEMBER, OFFER, '2026-12-05')).toEqual([]);
  });

  it.each([
    ['an unread list', null, OFFER, '2026-11-10'],
    ['a reactivation', rows, { change: REACTIVATE, minimum: '2026-11-01' } as const, '2026-11-10'],
    ['no offer', rows, null, '2026-11-10'],
    ['a day that is no date', rows, OFFER, '2026-11-'],
    ['a day before the minimum', rows, OFFER, '2026-10-31'],
    ['an untrusted row', [...rows, { id: null }], OFFER, '2026-11-10'],
  ] as const)('knows nothing with %s', (_name, read, offer, day) => {
    expect(deactivationClosedRequestsOf(read, MEMBER, offer, day)).toBeNull();
  });

  it('words the ranges in the question', () => {
    const closed = deactivationClosedRequestsOf(rows, MEMBER, OFFER, '2026-11-10') ?? [];

    expect(t('ljudi.status.deactivateRequests', { count: closed.length, ranges: deactivationClosedRangesText(closed) })).toBe(
      'Zatvaraju se 2 zahtjeva za godišnji koji čekaju odluku: 08.11.2026–12.11.2026 i 01.12.2026–03.12.2026. ' +
        'Poništavanje deaktivacije ne vraća zatvorene zahtjeve.',
    );
    expect(t('ljudi.status.deactivateRequests', { count: 1, ranges: '08.11.2026–12.11.2026' })).toBe(
      'Zatvara se 1 zahtjev za godišnji koji čeka odluku: 08.11.2026–12.11.2026. Poništavanje deaktivacije ne vraća zatvorene zahtjeve.',
    );
  });
});
