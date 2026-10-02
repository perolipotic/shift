import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  RESOLUTION_DENIED,
  RESOLUTION_FAILED,
  RESOLUTION_GONE,
  RESOLUTION_WRITE_TABLE,
  acceptUncovered,
  resolutionFailureMessageKey,
  resolutionInsertFailureOf,
  type ResolutionInsertRow,
  type ResolutionInsertTable,
  type ResolutionWriteAnswer,
} from '@/features/conflicts/services/resolution-write';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 5.4b's one write, executed against a stubbed table (AD-15): the five
 * columns it sends and nothing else, and every refusal of the spec's matrix —
 * Gone (23505, P0002), denied (42501) and Failed (anything else, a network
 * error included).
 */

const TARGET = {
  organizationId: 'org-1',
  memberId: 'member-1',
  date: '2026-10-02',
  teamId: 'team-1',
};

function tableAnswering(answer: () => PromiseLike<ResolutionWriteAnswer>): {
  readonly table: ResolutionInsertTable;
  readonly rows: ResolutionInsertRow[];
} {
  const rows: ResolutionInsertRow[] = [];

  return {
    rows,
    table: {
      insert(row) {
        rows.push(row);

        return answer();
      },
    },
  };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('accepting a conflict as uncovered', () => {
  it('inserts the organization, the key and the kind, and nothing else, into conflict_resolutions', async () => {
    const { table, rows } = tableAnswering(() => Promise.resolve({ error: null }));

    await expect(acceptUncovered(table, TARGET)).resolves.toEqual({ ok: true });
    expect(rows).toEqual([
      { organization_id: 'org-1', member_id: 'member-1', date: '2026-10-02', team_id: 'team-1', kind: 'accept_uncovered' },
    ]);
    expect(RESOLUTION_WRITE_TABLE).toBe('conflict_resolutions');
  });

  it.each([
    ['23505', 'the live key: resolved meanwhile', RESOLUTION_GONE],
    ['P0002', 'no live leave covers the date any more', RESOLUTION_GONE],
    ['42501', 'not an active admin', RESOLUTION_DENIED],
    ['23503', 'another tenant\'s member or team', RESOLUTION_FAILED],
    ['23514', 'a check', RESOLUTION_FAILED],
  ])('answers %s (%s) as %s', async (code, _why, failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { table } = tableAnswering(() => Promise.resolve({ error: { code } }));

    await expect(acceptUncovered(table, TARGET)).resolves.toEqual({ ok: false, code: failure });
    expect(resolutionInsertFailureOf({ code })).toBe(failure);
  });

  it('is failed, logged, on a network error or a malformed answer', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const answer of [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(null as unknown as ResolutionWriteAnswer),
      () => Promise.resolve({} as unknown as ResolutionWriteAnswer),
      () => Promise.resolve({ error: 'x' } as unknown as ResolutionWriteAnswer),
    ]) {
      await expect(acceptUncovered(tableAnswering(answer).table, TARGET)).resolves.toEqual({
        ok: false,
        code: RESOLUTION_FAILED,
      });
    }
    expect(errors).toHaveBeenCalled();
  });

  it('sends nothing for a date that is not a calendar date', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { table, rows } = tableAnswering(() => Promise.resolve({ error: null }));

    await expect(acceptUncovered(table, { ...TARGET, date: '2026-02-30' })).resolves.toEqual({
      ok: false,
      code: RESOLUTION_FAILED,
    });
    expect(rows).toEqual([]);
  });
});

describe('the refusals as lines', () => {
  it('says the conflict is no longer open, denied, or failed with a retry', () => {
    expect(t(resolutionFailureMessageKey(RESOLUTION_GONE))).toMatch(/^Ovaj konflikt više nije otvoren/);
    expect(t(resolutionFailureMessageKey(RESOLUTION_DENIED))).toBe('Nemaš ovlasti odlučiti o ovom konfliktu.');
    expect(t(resolutionFailureMessageKey(RESOLUTION_FAILED))).toBe('Odluku nije bilo moguće spremiti. Pokušaj ponovno.');
  });
});
