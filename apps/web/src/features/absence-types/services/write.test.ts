import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANNUAL_LEAVE_ID, type AbsenceTypeRow } from '@/features/absence-types/services/list';
import {
  ABSENCE_TYPE_ADDED,
  ABSENCE_TYPE_ANNUAL_DRAWS,
  ABSENCE_TYPE_DRAWS_FIELD,
  ABSENCE_TYPE_DRAWS_REQUIRED,
  ABSENCE_TYPE_NAME_EMPTY,
  ABSENCE_TYPE_NAME_FIELD,
  ABSENCE_TYPE_NAME_TAKEN,
  ABSENCE_TYPE_NAME_TOO_LONG,
  ABSENCE_TYPE_SAVED,
  ABSENCE_TYPE_STALE,
  ABSENCE_TYPE_WRITE_REFUSED,
  ABSENCE_TYPE_WRITE_UNAVAILABLE,
  DOES_NOT_DRAW_VALUE,
  DRAWS_OPTIONS,
  DRAWS_VALUE,
  NO_DRAWS_CHOICE,
  absenceTypeSavedMessageKey,
  absenceTypeSavedOf,
  absenceTypeWriteFailureOf,
  absenceTypeWriteMessageKey,
  createAbsenceType,
  drawsHintShown,
  drawsLocked,
  drawsOf,
  drawsValue,
  initialDrawsChoice,
  marksAbsenceTypeField,
  refusedAbsenceTypeFieldOf,
  updateAbsenceType,
  type AbsenceTypeWriteAnswer,
  type AbsenceTypeWriteFailure,
  type AbsenceTypeWriteTable,
} from '@/features/absence-types/services/write';

/**
 * Story 13.1b: adding and editing an absence type, against a stubbed table —
 * every row of the spec's I/O matrix that a write decides, with no database.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const EDUCATION_ID = '44444444-4444-4444-8444-444444444444';

const annual: AbsenceTypeRow = { id: ANNUAL_LEAVE_ID, organizationId: ORG, name: 'Godišnji odmor', drawsAllowance: true };
const education: AbsenceTypeRow = { id: EDUCATION_ID, organizationId: ORG, name: 'Edukacija', drawsAllowance: true };

interface Recorded {
  readonly op: 'insert' | 'update';
  readonly values: Readonly<Record<string, unknown>>;
  readonly eq?: readonly (readonly [string, string])[];
  readonly select: string;
}

/** A table recording every call, answering each write with `answer`. */
function stubTable(answer: AbsenceTypeWriteAnswer | 'throws'): AbsenceTypeWriteTable & { readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  const settle = (): Promise<AbsenceTypeWriteAnswer> =>
    answer === 'throws' ? Promise.reject(new Error('network')) : Promise.resolve(answer);

  return {
    calls,
    insert: (values) => ({
      select: (select) => {
        calls.push({ op: 'insert', values, select });

        return settle();
      },
    }),
    update: (values) => {
      const filters: (readonly [string, string])[] = [];
      const filtering = {
        eq: (column: string, value: string) => {
          filters.push([column, value]);

          return filtering;
        },
        select: (select: string) => {
          calls.push({ op: 'update', values, eq: filters, select });

          return settle();
        },
      };

      return filtering;
    },
  };
}

const oneRow: AbsenceTypeWriteAnswer = { data: [{ id: 'new' }], error: null };
const noRows: AbsenceTypeWriteAnswer = { data: [], error: null };
const refusedWith = (code: string, message = ''): AbsenceTypeWriteAnswer => ({ data: null, error: { code, message } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adding a type', () => {
  it('Bolovanje, not drawing: inserts the tenant, the name and the flag, and nothing else', async () => {
    const table = stubTable(oneRow);

    expect(await createAbsenceType(table, ORG, 'Bolovanje', DOES_NOT_DRAW_VALUE)).toEqual({ ok: true });
    expect(table.calls).toEqual([
      { op: 'insert', values: { organization_id: ORG, name: 'Bolovanje', draws_allowance: false }, select: 'id' },
    ]);
  });

  it('trims the name before it is sent', async () => {
    const table = stubTable(oneRow);

    await createAbsenceType(table, ORG, '  Edukacija\u0085 ', DRAWS_VALUE);
    expect(table.calls[0]?.values).toEqual({ organization_id: ORG, name: 'Edukacija', draws_allowance: true });
  });

  it('with no drawing choice sends nothing: the choice is required', async () => {
    const table = stubTable(oneRow);

    expect(await createAbsenceType(table, ORG, 'Bolovanje', NO_DRAWS_CHOICE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_DRAWS_REQUIRED,
    });
    expect(await createAbsenceType(table, ORG, 'Bolovanje', 'maybe')).toEqual({ ok: false, code: ABSENCE_TYPE_DRAWS_REQUIRED });
    expect(table.calls).toEqual([]);
  });

  it.each([
    ['blank', '   \t', ABSENCE_TYPE_NAME_EMPTY],
    ['empty', '', ABSENCE_TYPE_NAME_EMPTY],
    ['101 characters', 'a'.repeat(101), ABSENCE_TYPE_NAME_TOO_LONG],
    // Counted in code points, as `char_length` counts them.
    ['101 astral characters', '😀'.repeat(101), ABSENCE_TYPE_NAME_TOO_LONG],
  ])('a %s name sends nothing', async (_, name, code) => {
    const table = stubTable(oneRow);

    expect(await createAbsenceType(table, ORG, name, DRAWS_VALUE)).toEqual({ ok: false, code });
    expect(table.calls).toEqual([]);
  });

  it('a name of exactly 100 characters, astral ones included, is sent', async () => {
    const table = stubTable(oneRow);

    expect(await createAbsenceType(table, ORG, '😀'.repeat(100), DRAWS_VALUE)).toEqual({ ok: true });
    expect(table.calls).toHaveLength(1);
  });

  it(' godišnji odmor : the name is taken (23505), and the refusal says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = stubTable(
      refusedWith('23505', 'duplicate key value violates unique constraint "absence_types_organization_name_key"'),
    );

    expect(await createAbsenceType(table, ORG, ' godišnji odmor ', DRAWS_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_NAME_TAKEN,
    });
    expect(table.calls[0]?.values).toMatchObject({ name: 'godišnji odmor' });
  });

  it('zero rows back from an insert is the service, never stale: a new type cannot have changed', async () => {
    expect(await createAbsenceType(stubTable(noRows), ORG, 'Bolovanje', DRAWS_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_WRITE_UNAVAILABLE,
    });
  });

  it('a member-role token is refused (42501)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await createAbsenceType(stubTable(refusedWith('42501')), ORG, 'Bolovanje', DRAWS_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_WRITE_REFUSED,
    });
  });

  it('a thrown call, or an answer that is not rows, is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await createAbsenceType(stubTable('throws'), ORG, 'Bolovanje', DRAWS_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_WRITE_UNAVAILABLE,
    });
    expect(
      await createAbsenceType(stubTable({ data: 'x' as unknown as unknown[], error: null }), ORG, 'Bolovanje', DRAWS_VALUE),
    ).toEqual({ ok: false, code: ABSENCE_TYPE_WRITE_UNAVAILABLE });
  });
});

describe('editing a type', () => {
  it('renames annual leave: saved, and it still draws', async () => {
    const table = stubTable(oneRow);

    expect(await updateAbsenceType(table, annual, 'Godišnji', DRAWS_VALUE)).toEqual({ ok: true });
    expect(table.calls).toEqual([
      { op: 'update', values: { name: 'Godišnji', draws_allowance: true }, eq: [['organization_id', ORG], ['id', ANNUAL_LEAVE_ID]], select: 'id' },
    ]);
  });

  it('annual leave set not to draw sends nothing, and the database check maps to the same refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const table = stubTable(oneRow);

    expect(await updateAbsenceType(table, annual, 'Godišnji odmor', DOES_NOT_DRAW_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_ANNUAL_DRAWS,
    });
    expect(table.calls).toEqual([]);
    expect(
      absenceTypeWriteFailureOf({
        code: '23514',
        message: 'new row for relation "absence_types" violates check constraint "absence_types_annual_draws"',
      }),
    ).toBe(ABSENCE_TYPE_ANNUAL_DRAWS);
  });

  it('flips Edukacija from drawing to not: saved', async () => {
    const table = stubTable(oneRow);

    expect(await updateAbsenceType(table, education, 'Edukacija', DOES_NOT_DRAW_VALUE)).toEqual({ ok: true });
    expect(table.calls[0]).toEqual({
      op: 'update',
      values: { name: 'Edukacija', draws_allowance: false },
      eq: [
        ['organization_id', ORG],
        ['id', EDUCATION_ID],
      ],
      select: 'id',
    });
  });

  it("filters by the type's tenant as well as its id: annual leave's id is shared across tenants", async () => {
    const other: AbsenceTypeRow = { ...annual, organizationId: '22222222-2222-4222-8222-222222222222' };
    const table = stubTable(oneRow);

    await updateAbsenceType(table, other, 'Godišnji', DRAWS_VALUE);
    expect(table.calls[0]?.eq).toEqual([
      ['organization_id', other.organizationId],
      ['id', ANNUAL_LEAVE_ID],
    ]);
  });

  it('a type gone from reach is stale: zero rows', async () => {
    expect(await updateAbsenceType(stubTable(noRows), education, 'Edukacija', DRAWS_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_STALE,
    });
  });

  it('a member token is refused (42501)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await updateAbsenceType(stubTable(refusedWith('42501')), education, 'Edukacija', DRAWS_VALUE)).toEqual({
      ok: false,
      code: ABSENCE_TYPE_WRITE_REFUSED,
    });
  });
});

describe('a refusal, by constraint name', () => {
  it.each([
    ['23505', 'duplicate key value violates unique constraint "absence_types_organization_name_key"', ABSENCE_TYPE_NAME_TAKEN],
    ['23514', 'violates check constraint "absence_types_name_not_blank"', ABSENCE_TYPE_NAME_EMPTY],
    ['23514', 'violates check constraint "absence_types_name_length"', ABSENCE_TYPE_NAME_TOO_LONG],
    ['23514', 'violates check constraint "absence_types_annual_draws"', ABSENCE_TYPE_ANNUAL_DRAWS],
    ['42501', 'permission denied for table absence_types', ABSENCE_TYPE_WRITE_REFUSED],
    // A constraint this module does not know, and anything else: unavailable.
    ['23505', 'duplicate key value violates unique constraint "absence_types_pkey"', ABSENCE_TYPE_WRITE_UNAVAILABLE],
    ['23514', 'violates check constraint "some_other_check"', ABSENCE_TYPE_WRITE_UNAVAILABLE],
    ['PGRST301', 'JWT expired', ABSENCE_TYPE_WRITE_UNAVAILABLE],
    [undefined, undefined, ABSENCE_TYPE_WRITE_UNAVAILABLE],
  ] as const)('%s %s', (code, message, failure) => {
    expect(absenceTypeWriteFailureOf({ code, message })).toBe(failure);
  });

  it('never reads a constraint out of the typed values in details', () => {
    expect(
      absenceTypeWriteFailureOf({
        code: '23514',
        message: 'violates check constraint "some_other_check"',
        details: 'Failing row contains (…, "absence_types_annual_draws", …)',
      }),
    ).toBe(ABSENCE_TYPE_WRITE_UNAVAILABLE);
  });
});

describe('the drawing choice', () => {
  it('starts with neither choice on a new type, and with the stored flag on an edit', () => {
    expect(initialDrawsChoice(null)).toBe(NO_DRAWS_CHOICE);
    expect(initialDrawsChoice(education)).toBe(DRAWS_VALUE);
    expect(initialDrawsChoice({ ...education, drawsAllowance: false })).toBe(DOES_NOT_DRAW_VALUE);
  });

  it('is locked on annual leave only', () => {
    expect(drawsLocked(annual)).toBe(true);
    expect(drawsLocked(education)).toBe(false);
    expect(drawsLocked(null)).toBe(false);
  });

  // STORY 13.2b (Q8): a static line, never a confirmation.
  it("says what changing the flag does on every edited type but annual leave's, and never on a new one", () => {
    expect(drawsHintShown(education)).toBe(true);
    expect(drawsHintShown({ ...education, drawsAllowance: false })).toBe(true);
    expect(drawsHintShown(annual)).toBe(false);
    expect(drawsHintShown(null)).toBe(false);
  });

  it('round-trips its values, draws first', () => {
    expect(DRAWS_OPTIONS).toEqual([true, false]);
    for (const option of DRAWS_OPTIONS) expect(drawsOf(drawsValue(option))).toBe(option);
    expect(drawsOf(NO_DRAWS_CHOICE)).toBeNull();
  });
});

describe('focus, fields and messages', () => {
  const failures: readonly AbsenceTypeWriteFailure[] = [
    ABSENCE_TYPE_NAME_EMPTY,
    ABSENCE_TYPE_NAME_TOO_LONG,
    ABSENCE_TYPE_NAME_TAKEN,
    ABSENCE_TYPE_DRAWS_REQUIRED,
    ABSENCE_TYPE_ANNUAL_DRAWS,
    ABSENCE_TYPE_STALE,
    ABSENCE_TYPE_WRITE_REFUSED,
    ABSENCE_TYPE_WRITE_UNAVAILABLE,
  ];

  it('puts focus on the field a refusal is about, and the name otherwise', () => {
    expect(refusedAbsenceTypeFieldOf(ABSENCE_TYPE_DRAWS_REQUIRED)).toBe(ABSENCE_TYPE_DRAWS_FIELD);
    expect(refusedAbsenceTypeFieldOf(ABSENCE_TYPE_ANNUAL_DRAWS)).toBe(ABSENCE_TYPE_DRAWS_FIELD);
    expect(refusedAbsenceTypeFieldOf(ABSENCE_TYPE_NAME_TAKEN)).toBe(ABSENCE_TYPE_NAME_FIELD);
    expect(refusedAbsenceTypeFieldOf(ABSENCE_TYPE_STALE)).toBe(ABSENCE_TYPE_NAME_FIELD);
  });

  it('marks only the field a refusal is about', () => {
    expect(marksAbsenceTypeField(null, ABSENCE_TYPE_NAME_FIELD)).toBe(false);
    expect(marksAbsenceTypeField(ABSENCE_TYPE_NAME_TAKEN, ABSENCE_TYPE_NAME_FIELD)).toBe(true);
    expect(marksAbsenceTypeField(ABSENCE_TYPE_NAME_TAKEN, ABSENCE_TYPE_DRAWS_FIELD)).toBe(false);
    expect(marksAbsenceTypeField(ABSENCE_TYPE_DRAWS_REQUIRED, ABSENCE_TYPE_DRAWS_FIELD)).toBe(true);
    expect(marksAbsenceTypeField(ABSENCE_TYPE_STALE, ABSENCE_TYPE_NAME_FIELD)).toBe(false);
  });

  it('gives every refusal its own message', () => {
    const keys = failures.map(absenceTypeWriteMessageKey);

    expect(new Set(keys).size).toBe(failures.length);
    for (const key of keys) expect(key).toMatch(/^organization\.absenceTypes\.error\./);
  });

  it('says an add and an edit apart', () => {
    expect(absenceTypeSavedOf(null)).toBe(ABSENCE_TYPE_ADDED);
    expect(absenceTypeSavedOf(education)).toBe(ABSENCE_TYPE_SAVED);
    expect(absenceTypeSavedMessageKey(ABSENCE_TYPE_ADDED)).toBe('organization.absenceTypes.added');
    expect(absenceTypeSavedMessageKey(ABSENCE_TYPE_SAVED)).toBe('organization.absenceTypes.saved');
  });
});
