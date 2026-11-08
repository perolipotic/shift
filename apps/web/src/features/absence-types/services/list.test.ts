import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ABSENCE_TYPES_COLUMNS,
  ABSENCE_TYPES_COUNT,
  ABSENCE_TYPES_LIST_KEY,
  ABSENCE_TYPES_TABLE,
  ABSENCE_TYPES_UNAVAILABLE,
  ANNUAL_LEAVE_ID,
  absenceTypeDrawsMessageKey,
  absenceTypeRowOf,
  absenceTypesMessageKey,
  absenceTypesNoticeOf,
  absenceTypesQueryOptions,
  absenceTypesSurfaceStateOf,
  isAnnualLeave,
  orderedAbsenceTypes,
  readAbsenceTypes,
  type AbsenceTypeRow,
  type AbsenceTypesAnswer,
  type AbsenceTypesTable,
} from '@/features/absence-types/services/list';

/** Story 13.1b: the absence type list, read and ordered with no database (stubbed table). */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const SICK = '33333333-3333-4333-8333-333333333333';
const TRAINING = '44444444-4444-4444-8444-444444444444';

const annualRow = { organization_id: ORG, id: ANNUAL_LEAVE_ID, name: 'Godišnji odmor', draws_allowance: true };
const sickRow = { organization_id: ORG, id: SICK, name: 'Bolovanje', draws_allowance: false };
const trainingRow = { organization_id: ORG, id: TRAINING, name: 'Edukacija', draws_allowance: true };

/** A call that rejects, built only when the read makes it. */
const REJECTS = 'rejects';

function tableAnswering(answer: AbsenceTypesAnswer | typeof REJECTS): AbsenceTypesTable & { calls: unknown[][] } {
  const calls: unknown[][] = [];

  return {
    calls,
    select: (...args: unknown[]) => {
      calls.push(args);

      return answer === REJECTS ? Promise.reject(new Error('network')) : Promise.resolve(answer);
    },
  };
}

const rowsAnswer = (rows: unknown[]): AbsenceTypesAnswer => ({ data: rows, error: null, count: rows.length });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the read', () => {
  it('names its own table and key, and selects the four columns with an exact count', async () => {
    expect(ABSENCE_TYPES_TABLE).toBe('absence_types');
    expect(ABSENCE_TYPES_LIST_KEY).toEqual(['absenceTypes']);

    const table = tableAnswering(rowsAnswer([annualRow]));

    await readAbsenceTypes(table);
    expect(table.calls).toEqual([[ABSENCE_TYPES_COLUMNS, ABSENCE_TYPES_COUNT]]);
    expect(ABSENCE_TYPES_COLUMNS).toBe('organization_id,id,name,draws_allowance');
  });

  it("a fresh organization: one row, annual leave, drawing", async () => {
    expect(await readAbsenceTypes(tableAnswering(rowsAnswer([annualRow])))).toEqual({
      ok: true,
      types: [{ id: ANNUAL_LEAVE_ID, organizationId: ORG, name: 'Godišnji odmor', drawsAllowance: true }],
    });
  });

  it('orders annual leave first, then the rest by name in Croatian collation', async () => {
    const čuvanje = { organization_id: ORG, id: '55555555-5555-4555-8555-555555555555', name: 'Čuvanje djeteta', draws_allowance: false };
    const zamjena = { organization_id: ORG, id: '66666666-6666-4666-8666-666666666666', name: 'Zamjena', draws_allowance: false };
    const outcome = await readAbsenceTypes(tableAnswering(rowsAnswer([zamjena, trainingRow, čuvanje, annualRow, sickRow])));

    expect(outcome.ok && outcome.types.map((type) => type.name)).toEqual([
      'Godišnji odmor',
      'Bolovanje',
      // `č` directly after `c`, never after `z` as code-unit order would put it.
      'Čuvanje djeteta',
      'Edukacija',
      'Zamjena',
    ]);
  });

  it('keeps annual leave first whatever it is renamed to', () => {
    const renamed: AbsenceTypeRow = { id: ANNUAL_LEAVE_ID, organizationId: ORG, name: 'Zzz godišnji', drawsAllowance: true };
    const sick: AbsenceTypeRow = { id: SICK, organizationId: ORG, name: 'Bolovanje', drawsAllowance: false };

    expect(orderedAbsenceTypes([sick, renamed]).map((type) => type.id)).toEqual([ANNUAL_LEAVE_ID, SICK]);
  });

  it.each([
    ['a rejected call', REJECTS],
    ['an error', { data: null, error: { code: '42501' }, count: null }],
    ['data that is not an array', { data: 'rows' as unknown as unknown[], error: null, count: 1 }],
    ['a missing count', { data: [annualRow], error: null, count: null }],
    ['a count that disagrees', { data: [annualRow], error: null, count: 2 }],
    ['a malformed row', rowsAnswer([{ ...annualRow, draws_allowance: 'yes' }])],
    ['a row without a name', rowsAnswer([{ ...sickRow, name: null }])],
    ['two rows sharing an id', rowsAnswer([annualRow, { ...sickRow, id: ANNUAL_LEAVE_ID }])],
    ['two organizations', rowsAnswer([annualRow, { ...sickRow, organization_id: OTHER_ORG }])],
  ] as const)('is unavailable on %s', async (_, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readAbsenceTypes(tableAnswering(answer))).toEqual({ ok: false, code: ABSENCE_TYPES_UNAVAILABLE });
  });

  it('reads zero rows as an answer, never a refusal', async () => {
    expect(await readAbsenceTypes(tableAnswering(rowsAnswer([])))).toEqual({ ok: true, types: [] });
  });

  it('validates a row field by field', () => {
    expect(absenceTypeRowOf(sickRow)).toEqual({ id: SICK, organizationId: ORG, name: 'Bolovanje', drawsAllowance: false });
    expect(absenceTypeRowOf(null)).toBeNull();
    expect(absenceTypeRowOf([sickRow])).toBeNull();
    expect(absenceTypeRowOf({ ...sickRow, id: 7 })).toBeNull();
  });

  it('knows annual leave by its fixed id alone', () => {
    expect(ANNUAL_LEAVE_ID).toBe('00000000-0000-0000-0000-000000000001');
    expect(isAnnualLeave(ANNUAL_LEAVE_ID)).toBe(true);
    expect(isAnnualLeave(SICK)).toBe(false);
  });
});

describe('the query and the surface state', () => {
  it('rejects on a failure, so a refetch keeps the cached types', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const options = absenceTypesQueryOptions(() => tableAnswering({ data: null, error: { code: 'x' }, count: null }));

    expect(options.queryKey).toEqual(ABSENCE_TYPES_LIST_KEY);
    await expect(options.queryFn?.({} as never)).rejects.toThrow(ABSENCE_TYPES_UNAVAILABLE);
  });

  it('resolves with the ordered types', async () => {
    const options = absenceTypesQueryOptions(() => tableAnswering(rowsAnswer([sickRow, annualRow])));
    const types = (await options.queryFn?.({} as never)) as readonly AbsenceTypeRow[];

    expect(types.map((type) => type.id)).toEqual([ANNUAL_LEAVE_ID, SICK]);
  });

  const types = [{ id: ANNUAL_LEAVE_ID, organizationId: ORG, name: 'Godišnji odmor', drawsAllowance: true }];

  it('is loading, answered, failed, and paused offline', () => {
    expect(absenceTypesSurfaceStateOf({ isPending: true, isError: false, fetchStatus: 'fetching', data: undefined })).toEqual(
      { types: null, refusal: null, loading: true, paused: false },
    );
    expect(absenceTypesSurfaceStateOf({ isPending: false, isError: false, fetchStatus: 'idle', data: types })).toEqual({
      types,
      refusal: null,
      loading: false,
      paused: false,
    });
    // A failed refetch keeps the types beside the message.
    expect(absenceTypesSurfaceStateOf({ isPending: false, isError: true, fetchStatus: 'idle', data: types })).toEqual({
      types,
      refusal: ABSENCE_TYPES_UNAVAILABLE,
      loading: false,
      paused: false,
    });
    // A first read paused offline is a refusal; a refetch paused over types is not.
    expect(absenceTypesSurfaceStateOf({ isPending: true, isError: false, fetchStatus: 'paused', data: undefined }).refusal).toBe(
      ABSENCE_TYPES_UNAVAILABLE,
    );
    const paused = absenceTypesSurfaceStateOf({ isPending: false, isError: false, fetchStatus: 'paused', data: types });

    expect(paused).toEqual({ types, refusal: null, loading: false, paused: true });
    expect(absenceTypesNoticeOf(paused)).toBe(ABSENCE_TYPES_UNAVAILABLE);
    expect(absenceTypesNoticeOf({ types, refusal: null, loading: false, paused: false })).toBeNull();
  });
});

describe('the messages', () => {
  it('says whether a type draws, and the read failure', () => {
    expect(absenceTypeDrawsMessageKey(true)).toBe('organization.absenceTypes.draws');
    expect(absenceTypeDrawsMessageKey(false)).toBe('organization.absenceTypes.doesNotDraw');
    expect(absenceTypesMessageKey(ABSENCE_TYPES_UNAVAILABLE)).toBe('organization.absenceTypes.error.unavailable');
  });
});
