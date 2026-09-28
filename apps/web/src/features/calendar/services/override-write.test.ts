import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  OVERRIDE_DENIED,
  OVERRIDE_FAILED,
  OVERRIDE_GONE,
  OVERRIDE_TAKEN,
  REMOVE_OVERRIDE_FUNCTION,
  overrideWriteFailureOf,
  overrideWriteMessageKey,
  removeShiftTypeOverride,
  setShiftTypeOverride,
  type OverrideRemoval,
  type OverrideTable,
  type OverrideWriteAnswer,
  type OverrideWriteFailure,
} from '@/features/calendar/services/override-write';
import {
  DAY_WORKING,
  OVERRIDE_REFUSED_REASON,
  OVERRIDE_REFUSED_SAME,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 3.5b's writes, executed (AD-15): the insert and the removal, what
 * each sends, and every refusal of the spec's matrix mapped to its key.
 */

const ORGANIZATION = '00000000-0000-4000-8000-0000000000a1';

const DETAIL: DayDetail = {
  teamId: 'pilot-smjena-a',
  teamName: 'Smjena A',
  date: 'subota 26.09.2026',
  isoDate: '2026-09-26',
  projectedShiftTypeId: 'pilot-dan',
  kind: DAY_WORKING,
  typeName: 'Dan',
  range: '07:00–19:00',
  roster: [],
  override: null,
  pending: null,
};

function tableAnswering(answer: OverrideWriteAnswer | Promise<never>): OverrideTable & { readonly sent: unknown[] } {
  const sent: unknown[] = [];

  return {
    sent,
    insert(values) {
      sent.push(values);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  };
}

function removalAnswering(answer: OverrideWriteAnswer): OverrideRemoval & { readonly sent: unknown[][] } {
  const sent: unknown[][] = [];

  return {
    sent,
    rpc(fn, args) {
      sent.push([fn, args]);

      return Promise.resolve(answer);
    },
  };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setting a shift-type override (story 3.5b)', () => {
  it('inserts the five facts, the reason trimmed, and nothing else', async () => {
    const table = tableAnswering({ error: null });

    expect(await setShiftTypeOverride(table, ORGANIZATION, DETAIL, 'pilot-noc', '  Zamjena ')).toEqual({ ok: true });
    expect(table.sent).toEqual([
      {
        organization_id: ORGANIZATION,
        team_id: 'pilot-smjena-a',
        date: '2026-09-26',
        shift_type_id: 'pilot-noc',
        reason: 'Zamjena',
      },
    ]);
  });

  it('refuses the projected type, or a blank or overlong reason, without a request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: null });

    expect(await setShiftTypeOverride(table, ORGANIZATION, DETAIL, 'pilot-dan', 'Zamjena')).toEqual({
      ok: false,
      code: OVERRIDE_REFUSED_SAME,
    });
    for (const reason of ['  ', 'z'.repeat(201)]) {
      expect(await setShiftTypeOverride(table, ORGANIZATION, DETAIL, 'pilot-noc', reason)).toEqual({
        ok: false,
        code: OVERRIDE_REFUSED_REASON,
      });
    }
    expect(table.sent).toEqual([]);
  });

  it.each([
    ['23514', OVERRIDE_REFUSED_REASON],
    ['23505', OVERRIDE_TAKEN],
    ['42501', OVERRIDE_DENIED],
    ['23503', OVERRIDE_FAILED],
    ['P0001', OVERRIDE_FAILED],
    [undefined, OVERRIDE_FAILED],
  ] as const)('maps a refused insert %s to %s', async (code, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: { code } });

    expect(await setShiftTypeOverride(table, ORGANIZATION, DETAIL, 'pilot-noc', 'Zamjena')).toEqual({
      ok: false,
      code: expected,
    });
  });

  it('reads a thrown call or a malformed answer as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await setShiftTypeOverride(tableAnswering(Promise.reject(new Error('offline'))), ORGANIZATION, DETAIL, 'pilot-noc', 'x'),
    ).toEqual({ ok: false, code: OVERRIDE_FAILED });
    expect(
      await setShiftTypeOverride(
        tableAnswering(null as unknown as OverrideWriteAnswer),
        ORGANIZATION,
        DETAIL,
        'pilot-noc',
        'x',
      ),
    ).toEqual({ ok: false, code: OVERRIDE_FAILED });
  });
});

describe('removing a shift-type override (story 3.5b)', () => {
  it('calls the one definer function with the id alone', async () => {
    const removal = removalAnswering({ error: null });

    expect(await removeShiftTypeOverride(removal, 'o1')).toEqual({ ok: true });
    expect(removal.sent).toEqual([[REMOVE_OVERRIDE_FUNCTION, { p_override_id: 'o1' }]]);
    expect(REMOVE_OVERRIDE_FUNCTION).toBe('remove_shift_type_override');
  });

  it.each([
    ['P0002', OVERRIDE_GONE],
    ['42501', OVERRIDE_DENIED],
    ['XX000', OVERRIDE_FAILED],
  ] as const)('maps a refused removal %s to %s', async (code, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await removeShiftTypeOverride(removalAnswering({ error: { code } }), 'o1')).toEqual({
      ok: false,
      code: expected,
    });
  });
});

describe('the refusals, as the dialog says them', () => {
  const COPY: Readonly<Record<OverrideWriteFailure, string>> = {
    reason: 'Upiši razlog, 1–200 znakova.',
    sameAsProjected: 'To je već tip smjene prema rotaciji.',
    taken: 'Za taj dan već postoji izmjena. Osvježi prikaz.',
    gone: 'Izmjena je već uklonjena.',
    denied: 'Ne možeš mijenjati izmjene. Za to trebaš ovlasti administratora.',
    failed: 'Promjena nije uspjela. Pokušaj ponovno.',
  };

  it.each(Object.entries(COPY))('%s reads its own sentence', (failure, copy) => {
    const key = overrideWriteMessageKey(failure as OverrideWriteFailure);

    expect(key).toBe(`kalendar.detail.override.refused.${failure}`);
    expect(t(key)).toBe(copy);
  });

  it('maps a code with no error code at all to failed', () => {
    expect(overrideWriteFailureOf({})).toBe(OVERRIDE_FAILED);
  });
});
