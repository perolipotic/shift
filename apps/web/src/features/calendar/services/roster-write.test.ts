import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  REMOVE_ROSTER_OVERRIDE_FUNCTION,
  ROSTER_DENIED,
  ROSTER_FAILED,
  ROSTER_GONE,
  ROSTER_OVERRIDES_TABLE,
  ROSTER_REMOVED_DONE,
  ROSTER_SAVED,
  ROSTER_TAKEN,
  removeRosterOverride,
  rosterDoneMessageKey,
  rosterInsertFailureOf,
  rosterRemovalFailureOf,
  rosterWriteMessageKey,
  setRosterOverride,
  type RosterRemoval,
  type RosterTable,
  type RosterWriteAnswer,
  type RosterWriteFailure,
} from '@/features/calendar/services/roster-write';
import {
  DAY_WORKING,
  ROSTER_REFUSED_MEMBER,
  ROSTER_REFUSED_REASON,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 3.6b's writes, executed (AD-15): the insert and the removal, what
 * each sends, and every refusal of the spec's matrix mapped to its key.
 */

const ORGANIZATION = '00000000-0000-4000-8000-0000000000a1';

const DETAIL: DayDetail = {
  teamId: 'pilot-smjena-a',
  teamName: 'Smjena A',
  date: 'subota 26.09.2026',
  isoDate: '2026-09-26',
  projectedShiftTypeId: 'pilot-dan',
  shiftTypeId: 'pilot-dan',
  kind: DAY_WORKING,
  typeName: 'Dan',
  range: '07:00–19:00',
  roster: [],
  override: null,
  pending: null,
  rosterChanges: [],
  rosterPending: [],
  rosterInert: [],
};

function tableAnswering(answer: RosterWriteAnswer | Promise<never>): RosterTable & { readonly sent: unknown[] } {
  const sent: unknown[] = [];

  return {
    sent,
    insert(values) {
      sent.push(values);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  };
}

function removalAnswering(answer: RosterWriteAnswer): RosterRemoval & { readonly sent: unknown[][] } {
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

describe('changing a shift roster (story 3.6b)', () => {
  it('names the table 0026 created', () => {
    expect(ROSTER_OVERRIDES_TABLE).toBe('roster_overrides');
  });

  it('inserts one row per action — replace, add alone, remove alone — the reason trimmed, and nothing else', async () => {
    const table = tableAnswering({ error: null });

    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, 'ana', 'boris', '  Zamjena ')).toEqual({ ok: true });
    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, '', 'cvita', 'Pojačanje')).toEqual({ ok: true });
    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, 'ana', '', 'Bolovanje')).toEqual({ ok: true });
    const fact = { organization_id: ORGANIZATION, team_id: 'pilot-smjena-a', date: '2026-09-26' };

    expect(table.sent).toEqual([
      { ...fact, member_out_id: 'ana', member_in_id: 'boris', reason: 'Zamjena' },
      { ...fact, member_out_id: null, member_in_id: 'cvita', reason: 'Pojačanje' },
      { ...fact, member_out_id: 'ana', member_in_id: null, reason: 'Bolovanje' },
    ]);
  });

  it('refuses no member chosen, and a blank or overlong reason, without a request', async () => {
    const table = tableAnswering({ error: null });

    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, '', '', 'Zamjena')).toEqual({
      ok: false,
      code: ROSTER_REFUSED_MEMBER,
    });
    // One member on both sides, as 0026's `_members_distinct` refuses it.
    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, 'ana', 'ana', 'Zamjena')).toEqual({
      ok: false,
      code: ROSTER_REFUSED_MEMBER,
    });
    for (const reason of ['  ', '', 'z'.repeat(201)]) {
      expect(await setRosterOverride(table, ORGANIZATION, DETAIL, 'ana', 'boris', reason)).toEqual({
        ok: false,
        code: ROSTER_REFUSED_REASON,
      });
    }
    expect(table.sent).toEqual([]);
  });

  it.each([
    ['23514', ROSTER_REFUSED_REASON],
    ['23505', ROSTER_TAKEN],
    ['42501', ROSTER_DENIED],
    ['23503', ROSTER_FAILED],
    ['P0002', ROSTER_FAILED],
    ['P0001', ROSTER_FAILED],
    [undefined, ROSTER_FAILED],
  ] as const)('maps a refused insert %s to %s', async (code, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: { code } });

    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, 'ana', 'boris', 'Zamjena')).toEqual({
      ok: false,
      code: expected,
    });
  });

  it.each([
    ['new row for relation "roster_overrides" violates check constraint "roster_overrides_member_present"', null],
    ['new row for relation "roster_overrides" violates check constraint "roster_overrides_members_distinct"', null],
    ['check violation', 'Failing row violates roster_overrides_members_distinct.'],
  ] as const)('maps a 23514 naming a member check to member: %s', async (message, details) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = tableAnswering({ error: { code: '23514', message, details } });

    expect(await setRosterOverride(table, ORGANIZATION, DETAIL, 'ana', 'boris', 'Zamjena')).toEqual({
      ok: false,
      code: ROSTER_REFUSED_MEMBER,
    });
    expect(
      rosterInsertFailureOf({
        code: '23514',
        message: 'new row for relation "roster_overrides" violates check constraint "roster_overrides_reason_length"',
      }),
    ).toBe(ROSTER_REFUSED_REASON);
  });

  it('reads a thrown call or a malformed answer as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await setRosterOverride(tableAnswering(Promise.reject(new Error('offline'))), ORGANIZATION, DETAIL, 'ana', '', 'x'),
    ).toEqual({ ok: false, code: ROSTER_FAILED });
    expect(
      await setRosterOverride(tableAnswering(null as unknown as RosterWriteAnswer), ORGANIZATION, DETAIL, 'ana', '', 'x'),
    ).toEqual({ ok: false, code: ROSTER_FAILED });
  });
});

describe('removing a roster change (story 3.6b)', () => {
  it('calls the one definer function with the id alone', async () => {
    const removal = removalAnswering({ error: null });

    expect(await removeRosterOverride(removal, 'r1')).toEqual({ ok: true });
    expect(removal.sent).toEqual([[REMOVE_ROSTER_OVERRIDE_FUNCTION, { p_override_id: 'r1' }]]);
    expect(REMOVE_ROSTER_OVERRIDE_FUNCTION).toBe('remove_roster_override');
  });

  it.each([
    ['P0002', ROSTER_GONE],
    ['42501', ROSTER_DENIED],
    ['23514', ROSTER_FAILED],
    ['23505', ROSTER_FAILED],
    ['XX000', ROSTER_FAILED],
    [undefined, ROSTER_FAILED],
  ] as const)('maps a refused removal %s to %s', async (code, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await removeRosterOverride(removalAnswering({ error: { code } }), 'r1')).toEqual({
      ok: false,
      code: expected,
    });
  });

  it('reads a thrown removal or a malformed answer as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrown: RosterRemoval = {
      rpc() {
        return Promise.reject(new Error('offline'));
      },
    };

    expect(await removeRosterOverride(thrown, 'r1')).toEqual({ ok: false, code: ROSTER_FAILED });
    expect(await removeRosterOverride(removalAnswering(null as unknown as RosterWriteAnswer), 'r1')).toEqual({
      ok: false,
      code: ROSTER_FAILED,
    });
  });
});

describe('the roster refusals and notices, as the dialog says them', () => {
  const COPY: Readonly<Record<RosterWriteFailure, string>> = {
    member: 'Odaberi koga skidaš, koga dodaješ ili oboje.',
    reason: 'Upiši razlog, 1–200 znakova.',
    taken: 'Taj je član već u promjeni za ovu smjenu. Osvježi prikaz.',
    gone: 'Promjena je već uklonjena.',
    denied: 'Ne možeš mijenjati sastav. Za to trebaš ovlasti administratora.',
    failed: 'Promjena nije uspjela. Pokušaj ponovno.',
  };

  it.each(Object.entries(COPY))('%s reads its own sentence', (failure, copy) => {
    const key = rosterWriteMessageKey(failure as RosterWriteFailure);

    expect(key).toBe(`kalendar.detail.rosterChange.refused.${failure}`);
    expect(t(key)).toBe(copy);
  });

  it('says a landed save and a landed removal', () => {
    expect(t(rosterDoneMessageKey(ROSTER_SAVED))).toBe('Promjena sastava je spremljena.');
    expect(t(rosterDoneMessageKey(ROSTER_REMOVED_DONE))).toBe('Promjena sastava je uklonjena.');
  });

  it('maps a code with no error code at all to failed, on either write', () => {
    expect(rosterInsertFailureOf({})).toBe(ROSTER_FAILED);
    expect(rosterRemovalFailureOf({})).toBe(ROSTER_FAILED);
  });
});
