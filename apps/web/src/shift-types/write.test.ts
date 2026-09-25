import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHIFT_TYPES_UNAVAILABLE,
  type ShiftTypeRow,
  type ShiftTypesSnapshot,
  type ShiftTypesSurfaceState,
} from '@/shift-types/list';
import {
  ARCHIVE_ARMED,
  ARCHIVE_BUSY,
  ARCHIVE_IDLE,
  SHIFT_TYPE_ARCHIVED,
  SHIFT_TYPE_CHANGE_SCHEDULED,
  SHIFT_TYPE_CREATED,
  SHIFT_TYPE_CREATED_WITHOUT_TIMES,
  SHIFT_TYPE_DATE_FIELD,
  SHIFT_TYPE_DATE_INVALID,
  SHIFT_TYPE_END_FIELD,
  SHIFT_TYPE_KINDS,
  SHIFT_TYPE_NAME_EMPTY,
  SHIFT_TYPE_NAME_FIELD,
  SHIFT_TYPE_NAME_TAKEN,
  SHIFT_TYPE_NONWORKING,
  SHIFT_TYPE_RENAMED,
  SHIFT_TYPE_STALE,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_TIMES_CANCELLED,
  SHIFT_TYPE_TIMES_REFUSED,
  SHIFT_TYPE_TIMES_SAVED,
  SHIFT_TYPE_TIMES_UNCHANGED,
  SHIFT_TYPE_TIME_INVALID,
  SHIFT_TYPE_UNKNOWN,
  SHIFT_TYPE_WORKING,
  SHIFT_TYPE_WRITE_INVALID,
  SHIFT_TYPE_WRITE_REFUSED,
  SHIFT_TYPE_WRITE_UNAVAILABLE,
  TIMES_CANCEL,
  TIMES_CORRECT,
  TIMES_SET,
  archiveFailureOf,
  archiveOfferedOf,
  archiveShiftType,
  archiveStageOf,
  cancelScheduledTimes,
  correctShiftTypeTimes,
  createShiftType,
  createdOutcomeOf,
  enteredShiftTypeName,
  enteredShiftTypeTime,
  focusesConfirmation,
  marksField,
  refusedFieldOf,
  renameShiftType,
  savesAfter,
  shiftTypeFormKey,
  shiftTypeFormStateOf,
  shiftTypeKindMessageKey,
  shiftTypeKindOf,
  shiftTypeSavedMessageKey,
  shiftTypeWriteFailureOf,
  shiftTypeWriteMessageKey,
  timesFailureOf,
  timesFormKey,
  timesMinimumOf,
  timesOfferOf,
  type ShiftTypeVersionWriteTable,
  type ShiftTypeWriteAnswer,
  type ShiftTypeWriteFailure,
  type ShiftTypeWriteTable,
} from '@/shift-types/write';

/** Story 2.2b's write half, executed rather than read (AD-15). */

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const TODAY = '2026-09-25';
const SEEDED = '2020-01-01';

function type(
  overrides: Partial<ShiftTypeRow> & { readonly id?: string } = {},
): ShiftTypeRow {
  const id = overrides.id ?? 'pilot-dan';

  return {
    id,
    organizationId: ORGANIZATION,
    name: 'Dan',
    isWorking: true,
    archived: false,
    createdAt: '2026-09-25T10:00:00+00:00',
    versions: [{ shiftTypeId: id, effectiveFrom: SEEDED, startMinute: 420, endMinute: 1140 }],
    ...overrides,
  };
}

const DAN = type();
const SLOBODNO = type({ id: 'pilot-slobodno', name: 'Slobodno', isWorking: false, versions: [] });
const SCHEDULED = type({
  versions: [
    { shiftTypeId: 'pilot-dan', effectiveFrom: SEEDED, startMinute: 420, endMinute: 1140 },
    { shiftTypeId: 'pilot-dan', effectiveFrom: '2026-10-01', startMinute: 480, endMinute: 1200 },
  ],
});
const NO_TIMES = type({ id: 'bez', name: 'Bez', versions: [] });

interface Recorded {
  readonly verb: 'insert' | 'update' | 'delete';
  readonly values: Readonly<Record<string, unknown>> | null;
  readonly filters: readonly (readonly [string, string])[];
  readonly columns: string;
}

type Answer = ShiftTypeWriteAnswer | Promise<never>;

/** A stub over both tables' verbs, answering each call with the next answer. */
function tableAnswering(...answers: Answer[]): ShiftTypeWriteTable &
  ShiftTypeVersionWriteTable & { readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  const next = (): PromiseLike<ShiftTypeWriteAnswer> => {
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)] as Answer;

    return answer instanceof Promise ? answer : Promise.resolve(answer);
  };
  const selecting = (
    verb: Recorded['verb'],
    values: Recorded['values'],
    filters: Recorded['filters'],
  ) => ({
    select(columns: string) {
      calls.push({ verb, values, filters, columns });

      return next();
    },
  });

  return {
    calls,
    insert(values) {
      return selecting('insert', values, []);
    },
    update(values) {
      return {
        eq(column: string, value: string) {
          return selecting('update', values, [[column, value]]);
        },
      };
    },
    delete() {
      return {
        eq(column: string, value: string) {
          return {
            eq(second: string, secondValue: string) {
              return selecting('delete', null, [
                [column, value],
                [second, secondValue],
              ]);
            },
          };
        },
      };
    },
  };
}

const ONE_ROW: ShiftTypeWriteAnswer = { data: [{ id: 'new-id' }], error: null };
const NO_ROWS: ShiftTypeWriteAnswer = { data: [], error: null };
const REFUSED: ShiftTypeWriteAnswer = {
  data: null,
  error: { code: '42501', message: 'new row violates row-level security policy' },
};

function errorOn(code: string, constraint: string): ShiftTypeWriteAnswer {
  return { data: null, error: { code, message: `violates constraint "${constraint}"` } };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is entered', () => {
  it('trims the name, and refuses one that is only padding', () => {
    expect(enteredShiftTypeName('  Dežurstvo ')).toBe('Dežurstvo');
    expect(enteredShiftTypeName('   ')).toBeNull();
  });

  it('reads times as whole minutes of the day', () => {
    expect(enteredShiftTypeTime('07:00')).toBe('07:00');
    expect(enteredShiftTypeTime('24:00')).toBeNull();
    expect(enteredShiftTypeTime('')).toBeNull();
  });

  it('offers the two kinds, working first, and reads anything else as working', () => {
    expect(SHIFT_TYPE_KINDS).toEqual([SHIFT_TYPE_WORKING, SHIFT_TYPE_NONWORKING]);
    expect(shiftTypeKindOf(SHIFT_TYPE_NONWORKING)).toBe(SHIFT_TYPE_NONWORKING);
    expect(shiftTypeKindOf('x')).toBe(SHIFT_TYPE_WORKING);
    expect(shiftTypeKindMessageKey(SHIFT_TYPE_WORKING)).toBe('rotation.shiftTypes.working');
    expect(shiftTypeKindMessageKey(SHIFT_TYPE_NONWORKING)).toBe('rotation.shiftTypes.nonworking');
  });
});

describe('the failure map, by constraint name', () => {
  it.each([
    [errorOn('23505', 'shift_types_organization_name_key'), SHIFT_TYPE_NAME_TAKEN],
    // A version already on that date: the type changed meanwhile.
    [errorOn('23505', 'shift_type_versions_shift_type_id_effective_from_key'), SHIFT_TYPE_STALE],
    [errorOn('23505', 'something_else'), SHIFT_TYPE_WRITE_INVALID],
    [errorOn('23514', 'shift_types_name_not_blank'), SHIFT_TYPE_NAME_EMPTY],
    [errorOn('23514', 'shift_type_versions_start_before_midnight'), SHIFT_TYPE_TIME_INVALID],
    [errorOn('23514', 'shift_type_versions_end_whole_minute'), SHIFT_TYPE_TIME_INVALID],
    [errorOn('23514', 'shift_type_versions_effective_from_finite'), SHIFT_TYPE_DATE_INVALID],
    [errorOn('23514', 'something_else'), SHIFT_TYPE_WRITE_INVALID],
    [errorOn('22P02', 'x'), SHIFT_TYPE_WRITE_INVALID],
    [REFUSED, SHIFT_TYPE_WRITE_REFUSED],
    [{ data: null, error: { code: 'PGRST000' } }, SHIFT_TYPE_WRITE_UNAVAILABLE],
  ])('maps %j', (answer, expected) => {
    expect(shiftTypeWriteFailureOf(answer.error ?? {})).toBe(expected);
  });

  it('reads the constraint from details too', () => {
    expect(
      shiftTypeWriteFailureOf({ code: '23505', details: 'Key shift_types_organization_name_key' }),
    ).toBe(SHIFT_TYPE_NAME_TAKEN);
  });

  it('reads 42501 on a times write as the times refused', () => {
    expect(timesFailureOf({ code: '42501' })).toBe(SHIFT_TYPE_TIMES_REFUSED);
    expect(timesFailureOf({ code: '23514', message: 'shift_type_versions_end_before_midnight' })).toBe(
      SHIFT_TYPE_TIME_INVALID,
    );
  });

  it('reads 42501 on an archive as a change scheduled only when the snapshot shows one', () => {
    expect(archiveFailureOf({ code: '42501' }, true)).toBe(SHIFT_TYPE_CHANGE_SCHEDULED);
    expect(archiveFailureOf({ code: '42501' }, false)).toBe(SHIFT_TYPE_WRITE_REFUSED);
    expect(archiveFailureOf({ code: 'PGRST000' }, true)).toBe(SHIFT_TYPE_WRITE_UNAVAILABLE);
  });
});

describe('the add', () => {
  /**
   * TWO STUBS, one per table, each asserted on its own — one shared stub would
   * pass a swap of the tables, or a version insert sent to `shift_types`.
   */
  function tables(typeAnswer: Answer, versionAnswer: Answer = ONE_ROW) {
    const types = tableAnswering(typeAnswer);
    const versions = tableAnswering(versionAnswer);

    return { types, versions };
  }

  const WORKING_DEZURSTVO = {
    name: ' Dežurstvo ',
    kind: SHIFT_TYPE_WORKING,
    start: '07:00',
    end: '07:00',
  } as const;

  it('writes a working type to shift_types, then its first times from today to the versions', async () => {
    const both = tables(ONE_ROW, ONE_ROW);
    const outcome = await createShiftType(both, ORGANIZATION, WORKING_DEZURSTVO, TODAY);

    expect(outcome).toEqual({ ok: true });
    expect(both.types.calls).toEqual([
      {
        verb: 'insert',
        values: { organization_id: ORGANIZATION, name: 'Dežurstvo', is_working: true },
        filters: [],
        columns: 'id',
      },
    ]);
    expect(both.versions.calls).toEqual([
      {
        verb: 'insert',
        values: {
          organization_id: ORGANIZATION,
          shift_type_id: 'new-id',
          start_time: '07:00',
          end_time: '07:00',
          effective_from: TODAY,
        },
        filters: [],
        columns: 'id',
      },
    ]);
  });

  it('writes a non-working type alone, with no times', async () => {
    const both = tables(ONE_ROW);
    const outcome = await createShiftType(
      both,
      ORGANIZATION,
      { name: 'Slobodno', kind: SHIFT_TYPE_NONWORKING, start: '', end: '' },
      null,
    );

    expect(outcome).toEqual({ ok: true });
    expect(both.types.calls.map((call) => call.values)).toEqual([
      { organization_id: ORGANIZATION, name: 'Slobodno', is_working: false },
    ]);
    expect(both.versions.calls).toEqual([]);
  });

  it('keeps the type when the second write fails, and says it has no times', async () => {
    const both = tables(ONE_ROW, REFUSED);
    const outcome = await createShiftType(both, ORGANIZATION, WORKING_DEZURSTVO, TODAY);

    expect(outcome).toEqual({ ok: false, code: SHIFT_TYPE_CREATED_WITHOUT_TIMES });
    expect(both.types.calls).toHaveLength(1);
    expect(both.versions.calls).toHaveLength(1);
    expect(shiftTypeWriteMessageKey(SHIFT_TYPE_CREATED_WITHOUT_TIMES)).toBe(
      'rotation.shiftTypes.error.createdWithoutTimes',
    );
  });

  it('says no times too when the second write throws', async () => {
    const both = tables(ONE_ROW, Promise.reject(new Error('down')));

    expect(await createShiftType(both, ORGANIZATION, WORKING_DEZURSTVO, TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_CREATED_WITHOUT_TIMES,
    });
  });

  it('says no times, and makes no second call, when the first answers no id', async () => {
    const both = tables({ data: [{}], error: null });

    expect(await createShiftType(both, ORGANIZATION, WORKING_DEZURSTVO, TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_CREATED_WITHOUT_TIMES,
    });
    expect(both.types.calls).toHaveLength(1);
    expect(both.versions.calls).toEqual([]);
  });

  it('refuses a duplicate name, sending nothing further', async () => {
    const both = tables(errorOn('23505', 'shift_types_organization_name_key'));

    expect(
      await createShiftType(
        both,
        ORGANIZATION,
        { name: ' noć ', kind: SHIFT_TYPE_WORKING, start: '19:00', end: '07:00' },
        TODAY,
      ),
    ).toEqual({ ok: false, code: SHIFT_TYPE_NAME_TAKEN });
    expect(both.types.calls.map((call) => call.values?.['name'])).toEqual(['noć']);
    expect(both.versions.calls).toEqual([]);
  });

  it.each([
    [{ name: '  ', start: '07:00', end: '19:00' }, SHIFT_TYPE_NAME_EMPTY],
    [{ name: 'X', start: '', end: '19:00' }, SHIFT_TYPE_TIME_INVALID],
    [{ name: 'X', start: '07:00', end: '24:00' }, SHIFT_TYPE_TIME_INVALID],
  ])('refuses %j before the first write', async (entered, code) => {
    const both = tables(ONE_ROW, ONE_ROW);

    expect(
      await createShiftType(both, ORGANIZATION, { ...entered, kind: SHIFT_TYPE_WORKING }, TODAY),
    ).toEqual({ ok: false, code });
    expect(both.types.calls).toEqual([]);
    expect(both.versions.calls).toEqual([]);
  });

  it('writes nothing for a working type while today is unknown', async () => {
    const both = tables(ONE_ROW, ONE_ROW);

    expect(
      await createShiftType(
        both,
        ORGANIZATION,
        { name: 'X', kind: SHIFT_TYPE_WORKING, start: '07:00', end: '19:00' },
        null,
      ),
    ).toEqual({ ok: false, code: SHIFT_TYPE_WRITE_UNAVAILABLE });
    expect(both.types.calls).toEqual([]);
    expect(both.versions.calls).toEqual([]);
  });

  it('decides what the form does for each of the three outcome kinds', () => {
    expect(createdOutcomeOf({ ok: true })).toEqual({
      clearForm: true,
      saved: SHIFT_TYPE_CREATED,
      failure: null,
      refetch: true,
    });
    expect(createdOutcomeOf({ ok: false, code: SHIFT_TYPE_CREATED_WITHOUT_TIMES })).toEqual({
      clearForm: true,
      saved: null,
      failure: SHIFT_TYPE_CREATED_WITHOUT_TIMES,
      refetch: true,
    });
    expect(createdOutcomeOf({ ok: false, code: SHIFT_TYPE_NAME_TAKEN })).toEqual({
      clearForm: false,
      saved: null,
      failure: SHIFT_TYPE_NAME_TAKEN,
      refetch: false,
    });
    expect(shiftTypeSavedMessageKey(SHIFT_TYPE_CREATED)).toBe('rotation.shiftTypes.created');
  });
});

describe('rename', () => {
  it('writes the trimmed name and nothing else', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(await renameShiftType(stub, DAN, ' Dnevna ')).toEqual({ ok: true });
    expect(stub.calls).toEqual([
      { verb: 'update', values: { name: 'Dnevna' }, filters: [['id', 'pilot-dan']], columns: 'id' },
    ]);
  });

  it('keeps values on a taken name, and reads zero rows as stale', async () => {
    expect(
      await renameShiftType(tableAnswering(errorOn('23505', 'shift_types_organization_name_key')), DAN, 'Noć'),
    ).toEqual({ ok: false, code: SHIFT_TYPE_NAME_TAKEN });
    expect(await renameShiftType(tableAnswering(NO_ROWS), DAN, 'X')).toEqual({
      ok: false,
      code: SHIFT_TYPE_STALE,
    });
  });

  it('sends nothing for an archived type or a blank name', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(await renameShiftType(stub, type({ archived: true }), 'X')).toEqual({
      ok: false,
      code: SHIFT_TYPE_STALE,
    });
    expect(await renameShiftType(stub, DAN, ' ')).toEqual({ ok: false, code: SHIFT_TYPE_NAME_EMPTY });
    expect(stub.calls).toEqual([]);
  });
});

describe('correcting the times', () => {
  it('the minimum is today when the latest version is in the past', () => {
    expect(timesMinimumOf(DAN, TODAY)).toBe(TODAY);
    expect(timesMinimumOf(NO_TIMES, TODAY)).toBe(TODAY);
  });

  it('the minimum is the day after the latest version when that is today or later', () => {
    const correctedToday = type({
      versions: [
        { shiftTypeId: 'pilot-dan', effectiveFrom: SEEDED, startMinute: 420, endMinute: 1140 },
        { shiftTypeId: 'pilot-dan', effectiveFrom: TODAY, startMinute: 480, endMinute: 1200 },
      ],
    });

    expect(timesMinimumOf(correctedToday, TODAY)).toBe('2026-09-26');
    expect(timesMinimumOf(SCHEDULED, TODAY)).toBe('2026-10-02');
    expect(
      timesMinimumOf(
        type({ versions: [{ shiftTypeId: 'pilot-dan', effectiveFrom: '9999-12-31', startMinute: 0, endMinute: 60 }] }),
        TODAY,
      ),
    ).toBeNull();
  });

  it('offers correct, set, cancel, or nothing', () => {
    expect(timesOfferOf(DAN, TODAY)).toEqual({ kind: TIMES_CORRECT, minimum: TODAY });
    expect(timesOfferOf(NO_TIMES, TODAY)).toEqual({ kind: TIMES_SET, minimum: TODAY });
    expect(timesOfferOf(SCHEDULED, TODAY)).toEqual({
      kind: TIMES_CANCEL,
      scheduled: SCHEDULED.versions[1],
    });
    expect(timesOfferOf(SLOBODNO, TODAY)).toBeNull();
    expect(timesOfferOf(type({ archived: true }), TODAY)).toBeNull();
  });

  it('schedules a correction from a date at or after the minimum', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(
      await correctShiftTypeTimes(stub, DAN, { date: '2026-10-01', start: '08:00', end: '20:00' }, TODAY),
    ).toEqual({ ok: true });
    expect(stub.calls).toEqual([
      {
        verb: 'insert',
        values: {
          organization_id: ORGANIZATION,
          shift_type_id: 'pilot-dan',
          start_time: '08:00',
          end_time: '20:00',
          effective_from: '2026-10-01',
        },
        filters: [],
        columns: 'id',
      },
    ]);
  });

  it('sets first times on a type that has none, from today', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(
      await correctShiftTypeTimes(stub, NO_TIMES, { date: TODAY, start: '07:00', end: '07:00' }, TODAY),
    ).toEqual({ ok: true });
    expect(stub.calls[0]?.values?.['effective_from']).toBe(TODAY);
  });

  it.each([
    ['a past date', { date: '2026-09-24', start: '08:00', end: '20:00' }, SHIFT_TYPE_DATE_INVALID],
    ['not a date', { date: '2026-02-31', start: '08:00', end: '20:00' }, SHIFT_TYPE_DATE_INVALID],
    ['an invalid time', { date: TODAY, start: '8', end: '20:00' }, SHIFT_TYPE_TIME_INVALID],
  ])('refuses %s before sending', async (_, entered, code) => {
    const stub = tableAnswering(ONE_ROW);

    expect(await correctShiftTypeTimes(stub, DAN, entered, TODAY)).toEqual({ ok: false, code });
    expect(stub.calls).toEqual([]);
  });

  it('refuses a date before the day after the latest version, before sending', async () => {
    const correctedToday = type({
      versions: [{ shiftTypeId: 'pilot-dan', effectiveFrom: TODAY, startMinute: 420, endMinute: 1140 }],
    });
    const stub = tableAnswering(ONE_ROW);

    expect(
      await correctShiftTypeTimes(stub, correctedToday, { date: TODAY, start: '08:00', end: '20:00' }, TODAY),
    ).toEqual({ ok: false, code: SHIFT_TYPE_DATE_INVALID });
    expect(stub.calls).toEqual([]);
  });

  it('refuses the latest version\'s own times before sending, by their own message', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(
      await correctShiftTypeTimes(stub, DAN, { date: '2026-10-01', start: '07:00', end: '19:00' }, TODAY),
    ).toEqual({ ok: false, code: SHIFT_TYPE_TIMES_UNCHANGED });
    expect(stub.calls).toEqual([]);
    expect(shiftTypeWriteMessageKey(SHIFT_TYPE_TIMES_UNCHANGED)).toBe(
      'rotation.shiftTypes.error.timesUnchanged',
    );
    expect(shiftTypeWriteMessageKey(SHIFT_TYPE_TIMES_UNCHANGED)).not.toBe(
      shiftTypeWriteMessageKey(SHIFT_TYPE_TIMES_REFUSED),
    );
  });

  it('maps an RLS refusal (a date the database\'s today has passed) to the times refused', async () => {
    expect(
      await correctShiftTypeTimes(
        tableAnswering(REFUSED),
        DAN,
        { date: TODAY, start: '08:00', end: '19:00' },
        TODAY,
      ),
    ).toEqual({ ok: false, code: SHIFT_TYPE_TIMES_REFUSED });
  });

  it('offers no new correction while one is scheduled', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(
      await correctShiftTypeTimes(stub, SCHEDULED, { date: '2026-10-05', start: '08:00', end: '20:00' }, TODAY),
    ).toEqual({ ok: false, code: SHIFT_TYPE_STALE });
    expect(await correctShiftTypeTimes(stub, SLOBODNO, { date: TODAY, start: '08:00', end: '20:00' }, TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_STALE,
    });
    expect(stub.calls).toEqual([]);
  });
});

describe('cancelling the scheduled correction', () => {
  it('deletes exactly that version', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(await cancelScheduledTimes(stub, SCHEDULED, TODAY)).toEqual({ ok: true });
    expect(stub.calls).toEqual([
      {
        verb: 'delete',
        values: null,
        filters: [
          ['shift_type_id', 'pilot-dan'],
          ['effective_from', '2026-10-01'],
        ],
        columns: 'id',
      },
    ]);
  });

  it('reads zero rows as stale', async () => {
    expect(await cancelScheduledTimes(tableAnswering(NO_ROWS), SCHEDULED, TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_STALE,
    });
  });

  it('sends nothing when nothing is scheduled', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(await cancelScheduledTimes(stub, DAN, TODAY)).toEqual({ ok: false, code: SHIFT_TYPE_STALE });
    expect(stub.calls).toEqual([]);
  });

  it('offers the correction again once the cancellation lands', () => {
    const after = type({ versions: SCHEDULED.versions.slice(0, 1) });

    expect(timesOfferOf(after, TODAY)?.kind).toBe(TIMES_CORRECT);
  });
});

describe('archive', () => {
  it('writes archived: true and nothing else', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(await archiveShiftType(stub, DAN, TODAY)).toEqual({ ok: true });
    expect(stub.calls).toEqual([
      { verb: 'update', values: { archived: true }, filters: [['id', 'pilot-dan']], columns: 'id' },
    ]);
  });

  it('with a change scheduled: not offered, and refused before sending, "cancel it first"', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(archiveOfferedOf(SCHEDULED, TODAY)).toBe(false);
    expect(archiveOfferedOf(DAN, TODAY)).toBe(true);
    expect(archiveOfferedOf(type({ archived: true }), TODAY)).toBe(false);
    expect(await archiveShiftType(stub, SCHEDULED, TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_CHANGE_SCHEDULED,
    });
    expect(stub.calls).toEqual([]);
    expect(shiftTypeWriteMessageKey(SHIFT_TYPE_CHANGE_SCHEDULED)).toBe(
      'rotation.shiftTypes.error.changeScheduled',
    );
  });

  it('reads a 42501 the snapshot cannot explain as the plain refusal', async () => {
    expect(await archiveShiftType(tableAnswering(REFUSED), DAN, TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_WRITE_REFUSED,
    });
  });

  it('sends nothing for a type already archived', async () => {
    const stub = tableAnswering(ONE_ROW);

    expect(await archiveShiftType(stub, type({ archived: true }), TODAY)).toEqual({
      ok: false,
      code: SHIFT_TYPE_STALE,
    });
    expect(stub.calls).toEqual([]);
  });

  it('stages the one neutral confirmation: idle, armed, busy', () => {
    expect(archiveStageOf(false, false)).toBe(ARCHIVE_IDLE);
    expect(archiveStageOf(true, false)).toBe(ARCHIVE_ARMED);
    expect(archiveStageOf(true, true)).toBe(ARCHIVE_BUSY);
    // Another write in flight (rename, times, cancel) never reveals the confirmation.
    expect(archiveStageOf(false, true)).toBe(ARCHIVE_IDLE);
  });

  it('moves focus to the confirmation after an archive or a cancellation lands', () => {
    expect(focusesConfirmation(SHIFT_TYPE_ARCHIVED)).toBe(true);
    expect(focusesConfirmation(SHIFT_TYPE_TIMES_CANCELLED)).toBe(true);
    expect(focusesConfirmation(SHIFT_TYPE_RENAMED)).toBe(false);
    expect(focusesConfirmation(SHIFT_TYPE_TIMES_SAVED)).toBe(false);
    expect(focusesConfirmation(null)).toBe(false);
  });
});

describe('any write, settled', () => {
  it('reads a thrown call and a malformed answer as the service', async () => {
    expect(await renameShiftType(tableAnswering(Promise.reject(new Error('down'))), DAN, 'X')).toEqual({
      ok: false,
      code: SHIFT_TYPE_WRITE_UNAVAILABLE,
    });
    expect(
      await renameShiftType(
        tableAnswering({ data: {} as unknown as unknown[], error: null }),
        DAN,
        'X',
      ),
    ).toEqual({ ok: false, code: SHIFT_TYPE_WRITE_UNAVAILABLE });
  });
});

describe('fields, keys and messages', () => {
  it('marks the field a refusal is about, and focuses it', () => {
    expect(marksField(SHIFT_TYPE_NAME_TAKEN, SHIFT_TYPE_NAME_FIELD)).toBe(true);
    expect(marksField(SHIFT_TYPE_NAME_TAKEN, SHIFT_TYPE_START_FIELD)).toBe(false);
    expect(marksField(SHIFT_TYPE_TIME_INVALID, SHIFT_TYPE_START_FIELD)).toBe(true);
    expect(marksField(SHIFT_TYPE_TIME_INVALID, SHIFT_TYPE_END_FIELD)).toBe(true);
    expect(marksField(SHIFT_TYPE_DATE_INVALID, SHIFT_TYPE_DATE_FIELD)).toBe(true);
    expect(marksField(SHIFT_TYPE_TIMES_REFUSED, SHIFT_TYPE_DATE_FIELD)).toBe(false);
    expect(marksField(null, SHIFT_TYPE_NAME_FIELD)).toBe(false);
    expect(refusedFieldOf(SHIFT_TYPE_NAME_EMPTY, SHIFT_TYPE_DATE_FIELD)).toBe(SHIFT_TYPE_NAME_FIELD);
    expect(refusedFieldOf(SHIFT_TYPE_TIME_INVALID, SHIFT_TYPE_NAME_FIELD)).toBe(SHIFT_TYPE_START_FIELD);
    expect(refusedFieldOf(SHIFT_TYPE_DATE_INVALID, SHIFT_TYPE_NAME_FIELD)).toBe(SHIFT_TYPE_DATE_FIELD);
    expect(refusedFieldOf(SHIFT_TYPE_WRITE_UNAVAILABLE, SHIFT_TYPE_DATE_FIELD)).toBe(SHIFT_TYPE_DATE_FIELD);
  });

  it('gives every failure its own key', () => {
    const failures: ShiftTypeWriteFailure[] = [
      SHIFT_TYPE_NAME_EMPTY,
      SHIFT_TYPE_NAME_TAKEN,
      SHIFT_TYPE_TIME_INVALID,
      SHIFT_TYPE_DATE_INVALID,
      SHIFT_TYPE_TIMES_REFUSED,
      SHIFT_TYPE_TIMES_UNCHANGED,
      SHIFT_TYPE_CHANGE_SCHEDULED,
      SHIFT_TYPE_CREATED_WITHOUT_TIMES,
      SHIFT_TYPE_STALE,
      SHIFT_TYPE_WRITE_REFUSED,
      SHIFT_TYPE_WRITE_INVALID,
      SHIFT_TYPE_WRITE_UNAVAILABLE,
      SHIFT_TYPE_UNKNOWN,
    ];
    const keys = failures.map((failure) => shiftTypeWriteMessageKey(failure));

    expect(new Set(keys).size).toBe(failures.length);
    expect(keys.every((key) => key.startsWith('rotation.shiftTypes.error.'))).toBe(true);
  });

  it('gives every confirmation its own key', () => {
    expect(
      (
        [
          SHIFT_TYPE_CREATED,
          SHIFT_TYPE_RENAMED,
          SHIFT_TYPE_TIMES_SAVED,
          SHIFT_TYPE_TIMES_CANCELLED,
          SHIFT_TYPE_ARCHIVED,
        ] as const
      ).map((saved) => shiftTypeSavedMessageKey(saved)),
    ).toEqual([
      'rotation.shiftTypes.created',
      'rotation.shiftTypes.renamed',
      'rotation.shiftTypes.timesSaved',
      'rotation.shiftTypes.timesCancelled',
      'rotation.shiftTypes.archivedDone',
    ]);
  });

  it('keys the rename form by landed saves, and the times form by the history', () => {
    expect(shiftTypeFormKey(DAN, 2)).toBe('pilot-dan:2');
    expect(savesAfter(2, { ok: true })).toBe(3);
    expect(savesAfter(2, { ok: false, code: SHIFT_TYPE_NAME_TAKEN })).toBe(2);
    expect(timesFormKey(DAN)).not.toBe(timesFormKey(SCHEDULED));
    expect(timesFormKey(DAN)).toBe(timesFormKey(type()));
  });

  it('the form state: loading, unknown, a failed read, and the type', () => {
    const snapshot: ShiftTypesSnapshot = { organizationId: ORGANIZATION, timeZone: 'UTC', types: [DAN] };
    const state = (
      value: ShiftTypesSnapshot | null,
      loading: boolean,
      failed = false,
    ): ShiftTypesSurfaceState => ({
      snapshot: value,
      refusal: failed ? SHIFT_TYPES_UNAVAILABLE : null,
      loading,
    });

    expect(shiftTypeFormStateOf(state(null, true), 'pilot-dan')).toEqual({ type: null, refusal: null });
    expect(shiftTypeFormStateOf(state(snapshot, false), 'pilot-dan')).toEqual({ type: DAN, refusal: null });
    expect(shiftTypeFormStateOf(state(snapshot, false), 'nope')).toEqual({
      type: null,
      refusal: SHIFT_TYPE_UNKNOWN,
    });
    expect(shiftTypeFormStateOf(state(snapshot, false, true), 'pilot-dan')).toEqual({
      type: null,
      refusal: null,
    });
  });
});
