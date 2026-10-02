import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  RESOLUTION_DENIED,
  RESOLUTION_FAILED,
  RESOLUTION_GONE,
  RESOLUTION_TAKEN,
  RESOLUTION_WRITE_TABLE,
  REPLACE_CONFLICT_MEMBER_FUNCTION,
  REPLACEMENT_REASON_MAX,
  acceptUncovered,
  replaceMember,
  replacementReasonOf,
  resolutionFailureLineOf,
  resolutionFailureMessageKey,
  resolutionInsertFailureOf,
  resolutionReplaceFailureOf,
  type ReplaceConflictMemberArgs,
  type ResolutionReplaceRpc,
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

const REPLACEMENT = { ...TARGET, replacementId: 'member-2', reason: 'Zamjena za Anu (godišnji)' };

function rpcAnswering(answer: () => PromiseLike<ResolutionWriteAnswer>): {
  readonly client: ResolutionReplaceRpc;
  readonly calls: [string, ReplaceConflictMemberArgs][];
} {
  const calls: [string, ReplaceConflictMemberArgs][] = [];

  return {
    calls,
    client: {
      rpc(fn, args) {
        calls.push([fn, args]);

        return answer();
      },
    },
  };
}

describe('replacing the absent member (story 5.4c)', () => {
  it('calls replace_conflict_member with the key, the replacement and the reason, and nothing else', async () => {
    const { client, calls } = rpcAnswering(() => Promise.resolve({ error: null }));

    await expect(replaceMember(client, REPLACEMENT)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      [
        REPLACE_CONFLICT_MEMBER_FUNCTION,
        {
          p_member_id: 'member-1',
          p_date: '2026-10-02',
          p_team_id: 'team-1',
          p_replacement_id: 'member-2',
          p_reason: 'Zamjena za Anu (godišnji)',
        },
      ],
    ]);
    expect(REPLACE_CONFLICT_MEMBER_FUNCTION).toBe('replace_conflict_member');
  });

  it.each([
    [{ code: '23505', message: 'CONFLICT_REPLACEMENT_TAKEN' }, 'the replacement is already put on', RESOLUTION_TAKEN],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "conflict_resolutions_live_key"' }, 'resolved meanwhile', RESOLUTION_GONE],
    [{ code: 'P0002', message: 'CONFLICT_RESOLUTION_NOT_ON_LEAVE' }, 'the leave is gone', RESOLUTION_GONE],
    [{ code: '42501', message: 'CONFLICT_REPLACEMENT_REFUSED' }, 'not an active admin, or an archived team', RESOLUTION_DENIED],
    [{ code: '23514', message: 'CONFLICT_REPLACEMENT_IS_ABSENT_MEMBER' }, 'a check', RESOLUTION_FAILED],
    [{ code: '23503' }, 'another tenant\'s member or team', RESOLUTION_FAILED],
  ])('answers %o (%s) as %s', async (error, _why, failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = rpcAnswering(() => Promise.resolve({ error }));

    await expect(replaceMember(client, REPLACEMENT)).resolves.toEqual({ ok: false, code: failure });
    expect(resolutionReplaceFailureOf(error)).toBe(failure);
  });

  it('clips a reason a long name pushes past 200 characters, trimmed, before the call', async () => {
    const long = `Zamjena za ${'Ana-Marija '.repeat(30)}(godišnji)`;
    const { client, calls } = rpcAnswering(() => Promise.resolve({ error: null }));

    expect(Array.from(long).length).toBeGreaterThan(REPLACEMENT_REASON_MAX);
    await replaceMember(client, { ...REPLACEMENT, reason: long });

    const sent = calls[0]?.[1].p_reason ?? '';

    expect(Array.from(sent).length).toBeLessThanOrEqual(REPLACEMENT_REASON_MAX);
    expect(sent).toBe(sent.trim());
    expect(long.startsWith(sent)).toBe(true);
    // Counted in code points, as `char_length` counts them, and trimmed at both ends.
    expect(Array.from(replacementReasonOf(`  ${'đ'.repeat(250)}  `)).length).toBe(REPLACEMENT_REASON_MAX);
    expect(replacementReasonOf(`${'a'.repeat(199)} b`)).toBe('a'.repeat(199));
    expect(replacementReasonOf('  Zamjena za Anu (godišnji) ')).toBe('Zamjena za Anu (godišnji)');
  });

  it('never reads the taken message on the insert: a plain 23505 there stays gone', () => {
    expect(resolutionInsertFailureOf({ code: '23505', message: 'CONFLICT_REPLACEMENT_TAKEN' })).toBe(RESOLUTION_GONE);
  });

  it('is failed, logged, on a network error, and sends nothing for a date that is not a calendar date', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown = rpcAnswering(() => Promise.reject(new TypeError('Failed to fetch')));
    const unsent = rpcAnswering(() => Promise.resolve({ error: null }));

    await expect(replaceMember(thrown.client, REPLACEMENT)).resolves.toEqual({ ok: false, code: RESOLUTION_FAILED });
    await expect(replaceMember(unsent.client, { ...REPLACEMENT, date: '2026-13-01' })).resolves.toEqual({
      ok: false,
      code: RESOLUTION_FAILED,
    });
    expect(unsent.calls).toEqual([]);
    expect(errors).toHaveBeenCalled();
  });
});

describe('the refusals as lines', () => {
  it('names the replacement already on the shift, and never draws the taken line without a name', () => {
    const named = resolutionFailureLineOf(RESOLUTION_TAKEN, 'Dino Grgić');

    expect(named.values).toEqual({ name: 'Dino Grgić' });
    expect(t(named.key, { name: 'Dino Grgić' })).toBe('Dino Grgić je već na ovoj smjeni. Odaberi nekoga drugoga.');
    expect(resolutionFailureLineOf(RESOLUTION_TAKEN, null)).toEqual({ key: 'raspored.resolution.error.failed' });
    expect(resolutionFailureLineOf(RESOLUTION_GONE, 'Dino Grgić')).toEqual({ key: 'raspored.resolution.error.gone' });
    expect(resolutionFailureMessageKey(RESOLUTION_TAKEN)).toBe('raspored.resolution.error.taken');
  });

  it('says the conflict is no longer open, denied, or failed with a retry', () => {
    expect(t(resolutionFailureMessageKey(RESOLUTION_GONE))).toMatch(/^Ovaj konflikt više nije otvoren/);
    expect(t(resolutionFailureMessageKey(RESOLUTION_DENIED))).toBe('Nemaš ovlasti odlučiti o ovom konfliktu.');
    expect(t(resolutionFailureMessageKey(RESOLUTION_FAILED))).toBe('Odluku nije bilo moguće spremiti. Pokušaj ponovno.');
  });
});
