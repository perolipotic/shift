import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/lib/i18n';
import { readRotation, type RotationSnapshot } from '@/features/rotation/services/list';
import {
  AMEND_OVERRIDE_FUNCTION,
  CONFIRM_OVERRIDE_FUNCTION,
  DISCARD_OVERRIDE_FUNCTION,
  DISPOSITION_AMENDED,
  DISPOSITION_ARCHIVED,
  DISPOSITION_CONFIRMED,
  DISPOSITION_DENIED,
  DISPOSITION_DISCARDED,
  DISPOSITION_FAILED,
  DISPOSITION_GONE,
  DISPOSITION_REASON,
  DISPOSITION_SAME_AS_PROJECTED,
  OVERRIDE_REVIEW_UNAVAILABLE,
  amendDefaultsOf,
  amendEntryOf,
  amendShiftTypeOverride,
  confirmShiftTypeOverride,
  discardShiftTypeOverride,
  dispositionDoneMessageKey,
  dispositionFailureOf,
  dispositionMessageKey,
  pendingOverrideCountOf,
  overrideReviewOf,
  pendingOverrideRowsOf,
  rowOffersOf,
  savedPendingCountOf,
  type DispositionAnswer,
  type DispositionRpc,
  type PendingOverrideRow,
} from '@/features/rotation/services/override-disposition';
import {
  ADMIN,
  ADMIN_NAME,
  PILOT,
  UJ5,
  answerOf,
  assignmentRow,
  memberRow,
  overrideRow,
  rotationTableOf,
  typeRow,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 3.5c's disposition, executed rather than read (AD-15): which live
 * overrides a rotation change left pending, the rows the review lists, the
 * amend's preflight, what each call sends, and every refusal mapped to its
 * key — over both fixtures.
 */

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation(rotationTableOf(answerOf(rows)));

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** Every override is written at 2026-09-12 17:05 UTC (the fixture's default); the change below is saved after it. */
const CHANGE = '2026-09-20';
const CHANGED_AT = '2026-09-15T10:00:00+00:00';
const AFTER = '2026-09-21';
const EARLIER = '2026-09-19';
const SECOND_ADMIN = '00000000-0000-4000-8000-0000000000a2';

const FIXTURES = [
  { fixture: 'pilot', rows: PILOT, first: 'pilot-smjena-a', offset: 'pilot-step-2', pattern: 'pilot-rotation' },
  { fixture: 'UJ-5', rows: UJ5, first: 'uj5-smjena-a', offset: 'uj5-step-3', pattern: 'uj5-rotation' },
] as const;

/** `rows` with a change of every team's phase from `CHANGE`, saved at `CHANGED_AT`. */
function withChange(rows: FixtureRows, pattern: string, offset: string): FixtureRows {
  return {
    ...rows,
    assignments: [
      ...rows.assignments,
      ...rows.teams.map((team) =>
        assignmentRow(String(team['id']), pattern, offset, CHANGE, CHANGE, undefined, { createdAt: CHANGED_AT }),
      ),
    ],
  };
}

function typeOn(snapshot: RotationSnapshot, id: string): string {
  return snapshot.types.find((type) => type.id === id)?.name ?? '';
}

beforeAll(async () => {
  await initLocalization();
});

describe('which overrides wait for review', () => {
  it.each(FIXTURES)('$fixture: pending on and after the change, in force before it', async ({ rows, first, pattern, offset }) => {
    const other = String(rows.types[1]?.['id']);
    const snapshot = await snapshotOf({
      ...withChange(rows, pattern, offset),
      overrides: [
        overrideRow('o-before', first, EARLIER, other),
        overrideRow('o-on', first, CHANGE, other),
        overrideRow('o-after', first, AFTER, other),
      ],
    });

    expect(pendingOverrideRowsOf(snapshot).map((row) => row.id)).toEqual(['o-on', 'o-after']);
    expect(pendingOverrideCountOf(snapshot)).toBe(2);
    // With no change saved, nothing waits.
    const unchanged = await snapshotOf({ ...rows, overrides: [overrideRow('o-after', first, AFTER, other)] });

    expect(pendingOverrideRowsOf(unchanged)).toEqual([]);
    expect(pendingOverrideCountOf(unchanged)).toBe(0);
  });

  it.each(FIXTURES)('$fixture: written or confirmed after the change, it is in force', async ({ rows, first, pattern, offset }) => {
    const other = String(rows.types[1]?.['id']);
    const snapshot = await snapshotOf({
      ...withChange(rows, pattern, offset),
      overrides: [
        overrideRow('o-written', first, AFTER, other, { createdAt: '2026-09-16T08:00:00+00:00' }),
        overrideRow('o-confirmed', first, '2026-09-22', other, { confirmedAt: '2026-09-16T08:00:00Z' }),
      ],
    });

    expect(pendingOverrideRowsOf(snapshot)).toEqual([]);
  });

  it.each(FIXTURES)('$fixture: cancelling the change puts its overrides back in force, without a write', async ({ rows, first, pattern, offset }) => {
    const overrides = [overrideRow('o1', first, AFTER, String(rows.types[1]?.['id']))];

    expect(pendingOverrideCountOf(await snapshotOf({ ...withChange(rows, pattern, offset), overrides }))).toBe(1);
    expect(pendingOverrideCountOf(await snapshotOf({ ...rows, overrides }))).toBe(0);
  });

  it.each(FIXTURES)('$fixture: a row names the team, the date, both types, the reason and the author', async ({ rows, first, pattern, offset }) => {
    const other = String(rows.types[1]?.['id']);
    const snapshot = await snapshotOf({
      ...withChange(rows, pattern, offset),
      members: [memberRow(ADMIN, ADMIN_NAME)],
      overrides: [
        overrideRow('o1', first, AFTER, other, { reason: 'Vježba.' }),
        overrideRow('o2', first, '2026-09-22', other, { createdBy: SECOND_ADMIN }),
      ],
    });
    const [row, unknown] = pendingOverrideRowsOf(snapshot);
    const projected = row?.projectedShiftTypeId ?? '';

    expect(row).toMatchObject({
      id: 'o1',
      teamId: first,
      teamName: 'Smjena A',
      isoDate: AFTER,
      date: '21.09.2026',
      typeName: typeOn(snapshot, other),
      projectedTypeName: typeOn(snapshot, projected),
      reason: 'Vježba.',
      authorName: ADMIN_NAME,
      governed: true,
    });
    expect(projected).not.toBe('');
    // The amend offers every type not archived and not projected now, in creation order.
    expect(row?.options.map((option) => option.id)).toEqual(
      snapshot.types.filter((type) => type.id !== projected).map((type) => type.id),
    );
    expect(unknown?.authorName).toBeNull();
  });

  it('with no version on its date: pending, and only discarded', async () => {
    const snapshot = await snapshotOf({ ...PILOT, overrides: [overrideRow('o1', 'pilot-smjena-a', '2019-12-31', 'pilot-noc')] });

    expect(pendingOverrideRowsOf(snapshot)).toEqual([
      expect.objectContaining({ id: 'o1', projectedShiftTypeId: null, projectedTypeName: null, governed: false, options: [] }),
    ]);
  });

  it('never offers an archived type, and orders rows by date, then team', async () => {
    const snapshot = await snapshotOf({
      ...withChange(PILOT, 'pilot-rotation', 'pilot-step-2'),
      types: [...PILOT.types, typeRow('pilot-stara', 'Stara', '2026-09-25T20:07:49.339741+00:00', { archived: true })],
      overrides: [
        overrideRow('o3', 'pilot-smjena-b', AFTER, 'pilot-dan'),
        overrideRow('o2', 'pilot-smjena-a', '2026-09-22', 'pilot-dan'),
        overrideRow('o1', 'pilot-smjena-c', AFTER, 'pilot-dan'),
      ],
    });
    const rows = pendingOverrideRowsOf(snapshot);

    expect(rows.map((row) => row.id)).toEqual(['o3', 'o1', 'o2']);
    expect(rows.flatMap((row) => row.options.map((option) => option.id))).not.toContain('pilot-stara');
  });
});

describe('the amend preflight', () => {
  async function rowOf(): Promise<PendingOverrideRow> {
    const snapshot = await snapshotOf({
      ...withChange(PILOT, 'pilot-rotation', 'pilot-step-2'),
      overrides: [overrideRow('o1', 'pilot-smjena-a', AFTER, 'pilot-dan')],
    });
    const row = pendingOverrideRowsOf(snapshot)[0];

    if (row === undefined) throw new Error('nothing is pending');

    return row;
  }

  it('refuses the projected type or none, then a reason outside 1–200 characters, and passes the trimmed reason', async () => {
    const row = await rowOf();
    const projected = row.projectedShiftTypeId ?? '';
    const other = row.options[0]?.id ?? '';

    expect(amendEntryOf(row, projected, 'Zamjena')).toEqual({ ok: false, code: DISPOSITION_SAME_AS_PROJECTED });
    expect(amendEntryOf(row, '', 'Zamjena')).toEqual({ ok: false, code: DISPOSITION_SAME_AS_PROJECTED });
    for (const reason of ['', '  ', '\t\n', 'z'.repeat(201)]) {
      expect(amendEntryOf(row, other, reason), JSON.stringify(reason)).toEqual({ ok: false, code: DISPOSITION_REASON });
    }
    expect(amendEntryOf(row, other, '  Zamjena \n')).toEqual({ ok: true, shiftTypeId: other, reason: 'Zamjena' });
    expect(amendEntryOf(row, other, '🚒'.repeat(200))).toMatchObject({ ok: true });
  });
});

describe('the three calls', () => {
  function clientOf(answer: DispositionAnswer | Promise<never>) {
    const calls: unknown[][] = [];
    const client = {
      rpc(fn: string, args: unknown) {
        calls.push([fn, args]);

        return answer instanceof Promise ? answer : Promise.resolve(answer);
      },
    } as unknown as DispositionRpc;

    return { client, calls };
  }

  const governed: PendingOverrideRow = {
    id: 'o1',
    teamId: 'pilot-smjena-a',
    teamName: 'Smjena A',
    isoDate: AFTER,
    date: '21.09.2026',
    shiftTypeId: 'pilot-dan',
    typeName: 'Dan',
    projectedShiftTypeId: 'pilot-slobodno',
    projectedTypeName: 'Slobodno',
    reason: 'x',
    authorName: null,
    governed: true,
    options: [{ id: 'pilot-noc', name: 'Noć' }],
  };
  const ungoverned: PendingOverrideRow = { ...governed, projectedShiftTypeId: null, projectedTypeName: null, governed: false, options: [] };

  it('confirm, amend and discard each call their one function with the override id', async () => {
    const ok = { error: null };
    const confirm = clientOf(ok);
    const amend = clientOf(ok);
    const discard = clientOf(ok);

    expect(await confirmShiftTypeOverride(confirm.client, governed)).toEqual({ ok: true });
    expect(await amendShiftTypeOverride(amend.client, governed, 'pilot-noc', '  Zamjena ')).toEqual({ ok: true });
    expect(await discardShiftTypeOverride(discard.client, ungoverned)).toEqual({ ok: true });
    expect(confirm.calls).toEqual([[CONFIRM_OVERRIDE_FUNCTION, { p_override_id: 'o1' }]]);
    expect(amend.calls).toEqual([
      [AMEND_OVERRIDE_FUNCTION, { p_override_id: 'o1', p_shift_type_id: 'pilot-noc', p_reason: 'Zamjena' }],
    ]);
    expect(discard.calls).toEqual([[DISCARD_OVERRIDE_FUNCTION, { p_override_id: 'o1' }]]);
    expect([CONFIRM_OVERRIDE_FUNCTION, AMEND_OVERRIDE_FUNCTION, DISCARD_OVERRIDE_FUNCTION]).toEqual([
      'confirm_shift_type_override',
      'amend_shift_type_override',
      'remove_shift_type_override',
    ]);
  });

  it('sends nothing for a refused amend entry, or a confirm or amend where no version governs the date', async () => {
    const { client, calls } = clientOf({ error: null });

    expect(await amendShiftTypeOverride(client, governed, 'pilot-slobodno', 'Zamjena')).toEqual({
      ok: false,
      code: DISPOSITION_SAME_AS_PROJECTED,
    });
    expect(await amendShiftTypeOverride(client, governed, 'pilot-noc', '  ')).toEqual({ ok: false, code: DISPOSITION_REASON });
    expect(await confirmShiftTypeOverride(client, ungoverned)).toMatchObject({ ok: false });
    expect(await amendShiftTypeOverride(client, ungoverned, 'pilot-noc', 'Zamjena')).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it('maps every refusal of the matrix to its key, and a thrown or malformed answer to failed', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      for (const [code, failure] of [
        ['42501', DISPOSITION_DENIED],
        ['P0002', DISPOSITION_GONE],
        ['23514', DISPOSITION_REASON],
        ['P0001', DISPOSITION_FAILED],
        ['23503', DISPOSITION_FAILED],
        ['XX000', DISPOSITION_FAILED],
      ] as const) {
        expect(dispositionFailureOf({ code }), code).toBe(failure);
        expect(dispositionFailureOf({ code: 'P0001', message: 'SHIFT_TYPE_OVERRIDE_ARCHIVED' })).toBe(
          DISPOSITION_ARCHIVED,
        );
        expect(await discardShiftTypeOverride(clientOf({ error: { code } }).client, governed), code).toEqual({
          ok: false,
          code: failure,
        });
      }
      expect(await confirmShiftTypeOverride(clientOf(Promise.reject(new Error('down'))).client, governed)).toEqual({
        ok: false,
        code: DISPOSITION_FAILED,
      });
      expect(
        await confirmShiftTypeOverride(clientOf(null as unknown as DispositionAnswer).client, governed),
      ).toEqual({ ok: false, code: DISPOSITION_FAILED });
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('the words', () => {
  it('says every refusal and every landed disposition in Croatian', () => {
    expect(
      (
        [
          DISPOSITION_DENIED,
          DISPOSITION_GONE,
          DISPOSITION_ARCHIVED,
          DISPOSITION_REASON,
          DISPOSITION_SAME_AS_PROJECTED,
          DISPOSITION_FAILED,
        ] as const
      ).map(
        (failure) => t(dispositionMessageKey(failure)),
      ),
    ).toEqual([
      'Ne možeš mijenjati izmjene. Za to trebaš ovlasti administratora.',
      'Izmjena je već pregledana ili uklonjena. Prikaz je osvježen.',
      'Smjena ili tip smjene je arhiviran. Osvježi prikaz.',
      'Upiši razlog, 1–200 znakova.',
      'To je već tip smjene prema rotaciji.',
      'Promjena nije uspjela. Pokušaj ponovno.',
    ]);
    expect(
      ([DISPOSITION_CONFIRMED, DISPOSITION_AMENDED, DISPOSITION_DISCARDED] as const).map((done) =>
        t(dispositionDoneMessageKey(done)),
      ),
    ).toEqual(['Izmjena je potvrđena i ponovno vrijedi.', 'Izmjena je promijenjena.', 'Izmjena je odbačena.']);
  });

  it('counts the pending overrides in all three plural forms', () => {
    expect([1, 2, 5, 21].map((count) => t('rotation.builder.overrides.count', { count }))).toEqual([
      '1 izmjena čeka pregled.',
      '2 izmjene čekaju pregled.',
      '5 izmjena čeka pregled.',
      '21 izmjena čeka pregled.',
    ]);
  });

  it('names the team, the date and the type restored in the discard', () => {
    expect(
      t('rotation.builder.overrides.discardDialog.prompt', { team: 'Smjena A', date: '21.09.2026', type: 'Slobodno' }),
    ).toBe('Odbaciti izmjenu za Smjena A · 21.09.2026? Vraća se Slobodno prema rotaciji.');
    expect(t('rotation.builder.overrides.discardDialog.promptNoRotation', { team: 'Smjena A', date: '31.12.2019' })).toBe(
      'Odbaciti izmjenu za Smjena A · 31.12.2019? Na taj dan nema rotacije.',
    );
  });
});

describe('what the review offers and opens with', () => {
  const row: PendingOverrideRow = {
    id: 'o1',
    teamId: 'pilot-smjena-a',
    teamName: 'Smjena A',
    isoDate: AFTER,
    date: '21.09.2026',
    shiftTypeId: 'pilot-noc',
    typeName: 'Noć',
    projectedShiftTypeId: 'pilot-slobodno',
    projectedTypeName: 'Slobodno',
    reason: 'Vježba.',
    authorName: null,
    governed: true,
    options: [
      { id: 'pilot-dan', name: 'Dan' },
      { id: 'pilot-noc', name: 'Noć' },
    ],
  };

  it('offers amend only where a version governs the date and a type can be chosen', () => {
    expect(rowOffersOf(row)).toEqual({ confirm: true, amend: true });
    expect(rowOffersOf({ ...row, options: [] })).toEqual({ confirm: true, amend: false });
    expect(rowOffersOf({ ...row, governed: false, options: [] })).toEqual({ confirm: false, amend: false });
  });

  it("opens the amend on the override's own type and reason, else the first type offered", () => {
    expect(amendDefaultsOf(row)).toEqual({ shiftTypeId: 'pilot-noc', reason: 'Vježba.' });
    expect(amendDefaultsOf({ ...row, shiftTypeId: 'pilot-stara' })).toEqual({ shiftTypeId: 'pilot-dan', reason: 'Vježba.' });
  });

  it('says a review that cannot be derived is unavailable, logged under its own label, and counts nothing', async () => {
    const snapshot = await snapshotOf({ ...PILOT, overrides: [overrideRow('o1', 'pilot-smjena-a', '2019-12-31', 'pilot-noc')] });
    const broken = { ...snapshot, types: [] };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(overrideReviewOf(snapshot)).toMatchObject({ ok: true });
      expect(savedPendingCountOf(snapshot)).toBe(1);
      expect(overrideReviewOf(broken)).toEqual({ ok: false });
      expect(savedPendingCountOf({ ...snapshot, history: [...snapshot.history, snapshot.history[0]!] })).toBeNull();
      expect(logged).toHaveBeenCalledWith(OVERRIDE_REVIEW_UNAVAILABLE, expect.anything());
    } finally {
      logged.mockRestore();
    }
  });
});
