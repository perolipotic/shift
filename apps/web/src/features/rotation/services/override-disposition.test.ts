import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/lib/i18n';
import { readRotation, type RotationSnapshot } from '@/features/rotation/services/list';
import {
  AMEND_OVERRIDE_FUNCTION,
  AMEND_ROSTER_OVERRIDE_FUNCTION,
  AMEND_TYPES,
  CONFIRM_OVERRIDE_FUNCTION,
  CONFIRM_ROSTER_OVERRIDE_FUNCTION,
  DISCARD_OVERRIDE_FUNCTION,
  DISCARD_ROSTER_OVERRIDE_FUNCTION,
  DISPOSITION_SAME_MEMBER,
  DISPOSITION_TAKEN,
  REVIEW_ROSTER,
  amendReviewed,
  amendRosterOverride,
  confirmReviewed,
  confirmRosterOverride,
  discardReviewed,
  discardRosterOverride,
  offeredIn,
  pendingRosterRowsOf,
  reviewAmendDefaultsOf,
  reviewAmendEntryOf,
  reviewOffersOf,
  reviewRowsOf,
  rosterAmendEntryOf,
  rosterDispositionFailureOf,
  shiftTypeAmendGroupsOf,
  type PendingRosterOverrideRow,
  type ReviewRpc,
  DISPOSITION_AMENDED,
  DISPOSITION_ARCHIVED,
  DISPOSITION_CHANGED,
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
  memberIdOf,
  memberRow,
  overrideRow,
  rosterOverrideRow,
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
      // The confirmation's token: the change governing the date, as sent.
      governingSavedAt: CHANGED_AT,
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
      expect.objectContaining({
        id: 'o1',
        projectedShiftTypeId: null,
        projectedTypeName: null,
        governed: false,
        governingSavedAt: null,
        options: [],
      }),
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
    layer: 'shiftType',
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
    governingSavedAt: '2026-09-01T08:00:00.123456+00:00',
    options: [{ id: 'pilot-noc', name: 'Noć' }],
  };
  const ungoverned: PendingOverrideRow = {
    ...governed,
    projectedShiftTypeId: null,
    projectedTypeName: null,
    governed: false,
    governingSavedAt: null,
    options: [],
  };

  it('confirm, amend and discard each call their one function with the override id', async () => {
    const ok = { error: null };
    const confirm = clientOf(ok);
    const amend = clientOf(ok);
    const discard = clientOf(ok);

    expect(await confirmShiftTypeOverride(confirm.client, governed)).toEqual({ ok: true });
    expect(await amendShiftTypeOverride(amend.client, governed, 'pilot-noc', '  Zamjena ')).toEqual({ ok: true });
    expect(await discardShiftTypeOverride(discard.client, ungoverned)).toEqual({ ok: true });
    expect(confirm.calls, 'the confirmation lost its token').toEqual([
      [CONFIRM_OVERRIDE_FUNCTION, { p_override_id: 'o1', p_governing_saved_at: '2026-09-01T08:00:00.123456+00:00' }],
    ]);
    expect(amend.calls, 'the amend lost its token').toEqual([
      [
        AMEND_OVERRIDE_FUNCTION,
        {
          p_override_id: 'o1',
          p_shift_type_id: 'pilot-noc',
          p_reason: 'Zamjena',
          p_governing_saved_at: '2026-09-01T08:00:00.123456+00:00',
        },
      ],
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
    expect(await confirmShiftTypeOverride(client, { ...governed, governingSavedAt: null })).toMatchObject({ ok: false });
    expect(await amendShiftTypeOverride(client, ungoverned, 'pilot-noc', 'Zamjena')).toMatchObject({ ok: false });
    expect(
      await amendShiftTypeOverride(client, { ...governed, governingSavedAt: null }, 'pilot-noc', 'Zamjena'),
    ).toMatchObject({ ok: false });
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
        expect(dispositionFailureOf({ code: '23514', message: 'SHIFT_TYPE_OVERRIDE_ARCHIVED' })).toBe(
          DISPOSITION_ARCHIVED,
        );
        expect(dispositionFailureOf({ code: 'P0001', message: 'SHIFT_TYPE_OVERRIDE_CHANGED' })).toBe(
          DISPOSITION_CHANGED,
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
          DISPOSITION_CHANGED,
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
      'Rotacija je u međuvremenu promijenjena. Prikaz je osvježen, pregledaj izmjenu ponovno.',
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
    layer: 'shiftType',
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
    governingSavedAt: '2026-09-01T08:00:00.123456+00:00',
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

// ------------------------------------------------------- the roster layer (0039)

describe('which roster overrides wait for review (0039)', () => {
  const SPARE = '00000000-0000-4000-8000-0000000000b1';
  const MEMBER = '00000000-0000-4000-8000-0000000000b2';
  const members = [memberRow(ADMIN, ADMIN_NAME), memberRow(MEMBER, 'Marko Horvat'), memberRow(SPARE, 'Petra Kovač')];

  it.each(FIXTURES)('$fixture: pending on and after the change, in force before it, by the one rule', async ({ rows, first, pattern, offset }) => {
    const snapshot = await snapshotOf({
      ...withChange(rows, pattern, offset),
      members,
      rosterOverrides: [
        rosterOverrideRow('r-before', first, EARLIER, memberIdOf(MEMBER), memberIdOf(SPARE)),
        rosterOverrideRow('r-on', first, CHANGE, memberIdOf(MEMBER), null),
        rosterOverrideRow('r-after', first, AFTER, null, memberIdOf(SPARE), { createdBy: SECOND_ADMIN }),
      ],
    });
    const rosterRows = pendingRosterRowsOf(snapshot);

    expect(rosterRows.map((row) => row.id)).toEqual(['r-on', 'r-after']);
    expect(rosterRows[0]).toEqual({
      layer: REVIEW_ROSTER,
      id: 'r-on',
      teamId: first,
      teamName: snapshot.teams.find((team) => team.id === first)?.name,
      isoDate: CHANGE,
      date: '20.09.2026',
      memberOutId: memberIdOf(MEMBER),
      memberOutName: 'Marko Horvat',
      memberInId: null,
      memberInName: null,
      projectedTypeName: expect.any(String) as string,
      reason: 'Zamjena zbog bolovanja.',
      authorName: ADMIN_NAME,
      governed: true,
      governingSavedAt: CHANGED_AT,
    });
    // An author the members embed does not name is nobody.
    expect(rosterRows[1]?.authorName).toBeNull();
    // Both layers in one review, and in the save's count.
    expect(pendingOverrideCountOf(snapshot)).toBe(2);
    // Confirmed after the change, it is in force.
    const confirmed = await snapshotOf({
      ...withChange(rows, pattern, offset),
      members,
      rosterOverrides: [
        rosterOverrideRow('r-on', first, CHANGE, memberIdOf(MEMBER), null, { confirmedAt: '2026-09-16T08:00:00+00:00' }),
      ],
    });

    expect(pendingRosterRowsOf(confirmed)).toEqual([]);
  });

  it('with no version on its date: pending, and only discarded', async () => {
    const snapshot = await snapshotOf({
      ...PILOT,
      members,
      rosterOverrides: [rosterOverrideRow('r1', 'pilot-smjena-a', '2019-12-31', memberIdOf(MEMBER), null)],
    });
    const [row] = pendingRosterRowsOf(snapshot);

    expect(row).toMatchObject({ projectedTypeName: null, governed: false, governingSavedAt: null });
    expect(row === undefined ? null : reviewOffersOf(row)).toEqual({ confirm: false, amend: false });
  });

  it('lists both layers in one review, by date, then team, then the shift-type row first', async () => {
    const snapshot = await snapshotOf({
      ...withChange(PILOT, 'pilot-rotation', 'pilot-step-2'),
      members,
      overrides: [overrideRow('o1', 'pilot-smjena-a', AFTER, 'pilot-noc')],
      rosterOverrides: [
        rosterOverrideRow('r1', 'pilot-smjena-a', AFTER, memberIdOf(MEMBER), null),
        rosterOverrideRow('r0', 'pilot-smjena-b', CHANGE, memberIdOf(MEMBER), null),
      ],
    });

    expect(reviewRowsOf(snapshot).map((row) => [row.layer, row.id])).toEqual([
      ['roster', 'r0'],
      ['shiftType', 'o1'],
      ['roster', 'r1'],
    ]);
    expect(overrideReviewOf(snapshot)).toEqual({ ok: true, rows: reviewRowsOf(snapshot) });
  });
});

describe("the roster amend's preflight and its defaults (0039)", () => {
  const row: PendingRosterOverrideRow = {
    layer: REVIEW_ROSTER,
    id: 'r1',
    teamId: 'pilot-smjena-a',
    teamName: 'Smjena A',
    isoDate: AFTER,
    date: '21.09.2026',
    memberOutId: 'm-out',
    memberOutName: 'Marko Horvat',
    memberInId: 'm-in',
    memberInName: 'Petra Kovač',
    projectedTypeName: 'Dan',
    reason: 'Bolovanje',
    authorName: null,
    governed: true,
    governingSavedAt: '2026-09-01T08:00:00.123456+00:00',
  };
  const groups = [
    { kind: 'free', options: [] },
    { kind: 'working', options: [{ id: 'm-other', name: 'Ivo Ivić' }] },
    { kind: 'onLeave', options: [] },
  ] as const;

  it('refuses none, the member already put on or the one taken off, then a reason outside 1–200 characters', () => {
    for (const member of ['', 'm-in', 'm-out']) {
      expect(rosterAmendEntryOf(row, member, 'Zamjena'), member).toEqual({ ok: false, code: DISPOSITION_SAME_MEMBER });
    }
    expect(rosterAmendEntryOf(row, 'm-other', ' \t ')).toEqual({ ok: false, code: DISPOSITION_REASON });
    expect(rosterAmendEntryOf(row, 'm-other', 'y'.repeat(201))).toEqual({ ok: false, code: DISPOSITION_REASON });
    expect(rosterAmendEntryOf(row, 'm-other', '  Zamjena ')).toEqual({ ok: true, memberInId: 'm-other', reason: 'Zamjena' });
    expect(reviewAmendEntryOf(row, 'm-other', 'Zamjena')).toEqual({ ok: true, choiceId: 'm-other', reason: 'Zamjena' });
  });

  it('opens on the first member offered and its own reason, and offers confirm and amend where a version governs', () => {
    expect(reviewAmendDefaultsOf(row, groups)).toEqual({ choiceId: 'm-other', reason: 'Bolovanje' });
    expect(reviewAmendDefaultsOf(row, [])).toEqual({ choiceId: undefined, reason: 'Bolovanje' });
    expect(offeredIn(groups, 'm-other')).toBe(true);
    expect(offeredIn(groups, 'm-in')).toBe(false);
    expect(reviewOffersOf(row)).toEqual({ confirm: true, amend: true });
  });

  it("offers a shift-type row's types as one group", () => {
    const options = [{ id: 'pilot-noc', name: 'Noć' }];

    expect(
      shiftTypeAmendGroupsOf({
        layer: 'shiftType',
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
        governingSavedAt: null,
        options,
      }),
    ).toEqual([{ kind: AMEND_TYPES, options }]);
  });
});

describe("the roster layer's three calls (0039)", () => {
  function clientOf(answer: DispositionAnswer | Promise<never>) {
    const calls: unknown[][] = [];
    const client = {
      rpc(fn: string, args: unknown) {
        calls.push([fn, args]);

        return answer instanceof Promise ? answer : Promise.resolve(answer);
      },
    } as unknown as ReviewRpc;

    return { client, calls };
  }

  const governed: PendingRosterOverrideRow = {
    layer: REVIEW_ROSTER,
    id: 'r1',
    teamId: 'pilot-smjena-a',
    teamName: 'Smjena A',
    isoDate: AFTER,
    date: '21.09.2026',
    memberOutId: 'm-out',
    memberOutName: null,
    memberInId: null,
    memberInName: null,
    projectedTypeName: 'Dan',
    reason: 'x',
    authorName: null,
    governed: true,
    governingSavedAt: '2026-09-01T08:00:00.123456+00:00',
  };
  const ungoverned: PendingRosterOverrideRow = { ...governed, projectedTypeName: null, governed: false, governingSavedAt: null };

  it('confirm, amend and discard each call their one function, the confirm and amend with the token', async () => {
    const ok = { error: null };
    const confirm = clientOf(ok);
    const amend = clientOf(ok);
    const discard = clientOf(ok);

    expect(await confirmRosterOverride(confirm.client, governed)).toEqual({ ok: true });
    expect(await amendRosterOverride(amend.client, governed, 'm-in', '  Zamjena ')).toEqual({ ok: true });
    expect(await discardRosterOverride(discard.client, ungoverned)).toEqual({ ok: true });
    expect(confirm.calls).toEqual([
      [CONFIRM_ROSTER_OVERRIDE_FUNCTION, { p_override_id: 'r1', p_governing_saved_at: '2026-09-01T08:00:00.123456+00:00' }],
    ]);
    expect(amend.calls).toEqual([
      [
        AMEND_ROSTER_OVERRIDE_FUNCTION,
        {
          p_override_id: 'r1',
          p_member_in_id: 'm-in',
          p_reason: 'Zamjena',
          p_governing_saved_at: '2026-09-01T08:00:00.123456+00:00',
        },
      ],
    ]);
    expect(discard.calls).toEqual([[DISCARD_ROSTER_OVERRIDE_FUNCTION, { p_override_id: 'r1' }]]);
    expect([CONFIRM_ROSTER_OVERRIDE_FUNCTION, AMEND_ROSTER_OVERRIDE_FUNCTION, DISCARD_ROSTER_OVERRIDE_FUNCTION]).toEqual([
      'confirm_roster_override',
      'amend_roster_override',
      'remove_roster_override',
    ]);
  });

  it("picks the row's own layer: a roster row never reaches a shift-type function", async () => {
    const ok = { error: null };
    const both = clientOf(ok);

    await confirmReviewed(both.client, governed);
    await amendReviewed(both.client, governed, 'm-in', 'Zamjena');
    await discardReviewed(both.client, governed);
    expect(both.calls.map(([fn]) => fn)).toEqual([
      CONFIRM_ROSTER_OVERRIDE_FUNCTION,
      AMEND_ROSTER_OVERRIDE_FUNCTION,
      DISCARD_ROSTER_OVERRIDE_FUNCTION,
    ]);
  });

  it('sends nothing for a refused amend entry, or a confirm or amend where no version governs the date', async () => {
    const { client, calls } = clientOf({ error: null });

    expect(await amendRosterOverride(client, governed, 'm-out', 'Zamjena')).toEqual({ ok: false, code: DISPOSITION_SAME_MEMBER });
    expect(await amendRosterOverride(client, governed, 'm-in', '')).toEqual({ ok: false, code: DISPOSITION_REASON });
    expect(await confirmRosterOverride(client, ungoverned)).toMatchObject({ ok: false });
    expect(await amendRosterOverride(client, ungoverned, 'm-in', 'Zamjena')).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("maps every refusal of 0039's matrix to its code", async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      for (const [error, failure] of [
        [{ code: '42501' }, DISPOSITION_DENIED],
        [{ code: 'P0002' }, DISPOSITION_GONE],
        [{ code: 'P0001', message: 'ROSTER_OVERRIDE_ARCHIVED' }, DISPOSITION_ARCHIVED],
        [{ code: '23514', message: 'ROSTER_OVERRIDE_ARCHIVED' }, DISPOSITION_ARCHIVED],
        [{ code: 'P0001', message: 'ROSTER_OVERRIDE_CHANGED' }, DISPOSITION_CHANGED],
        // A shift-type override's message is no refusal of this layer.
        [{ code: 'P0001', message: 'SHIFT_TYPE_OVERRIDE_CHANGED' }, DISPOSITION_FAILED],
        [{ code: '23505' }, DISPOSITION_TAKEN],
        [{ code: '23514' }, DISPOSITION_REASON],
        [{ code: '23503' }, DISPOSITION_FAILED],
      ] as const) {
        expect(rosterDispositionFailureOf(error), JSON.stringify(error)).toBe(failure);
        expect(await confirmRosterOverride(clientOf({ error }).client, governed)).toEqual({ ok: false, code: failure });
      }
    } finally {
      quiet.mockRestore();
    }
  });

  it("says the roster layer's refusals, its row and its discard in Croatian", () => {
    expect(([DISPOSITION_SAME_MEMBER, DISPOSITION_TAKEN] as const).map((failure) => t(dispositionMessageKey(failure)))).toEqual([
      'Odaberi drugu osobu koja dolazi.',
      'Ta osoba već je u promjeni za ovu smjenu. Prikaz je osvježen.',
    ]);
    expect(t('rotation.builder.overrides.roster.replaced', { out: 'Marko Horvat', in: 'Petra Kovač' })).toBe(
      'Promjena sastava: Marko Horvat → Petra Kovač',
    );
    expect(t('rotation.builder.overrides.discardDialog.promptRoster', { team: 'Smjena A', date: '21.09.2026' })).toBe(
      'Odbaciti promjenu sastava za Smjena A · 21.09.2026? Sastav se vraća prema rotaciji.',
    );
  });
});
