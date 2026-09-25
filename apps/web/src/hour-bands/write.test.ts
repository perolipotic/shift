import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HOUR_BANDS_UNAVAILABLE,
  type HourBandRow,
  type HourBandsSurfaceState,
} from '@/hour-bands/list';
import {
  HOUR_BAND_NAME_EMPTY,
  HOUR_BAND_NAME_FIELD,
  HOUR_BAND_NAME_TAKEN,
  HOUR_BAND_REMOVED,
  HOUR_BAND_SAVED,
  HOUR_BAND_STALE,
  HOUR_BAND_START_FIELD,
  HOUR_BAND_START_INVALID,
  HOUR_BAND_START_TAKEN,
  HOUR_BAND_UNKNOWN,
  HOUR_BAND_WRITE_INVALID,
  HOUR_BAND_WRITE_REFUSED,
  HOUR_BAND_WRITE_UNAVAILABLE,
  REMOVE_ARMED,
  REMOVE_BUSY,
  REMOVE_IDLE,
  claimedOrganizationOf,
  createHourBand,
  enteredHourBandName,
  enteredHourBandStart,
  hourBandFormKey,
  hourBandFormStateOf,
  hourBandSavedMessageKey,
  hourBandWriteFailureOf,
  hourBandWriteMessageKey,
  holdsRemovalOutcome,
  marksField,
  refusedFieldOf,
  removeHourBand,
  removeStageOf,
  savesAfter,
  updateHourBand,
  type HourBandWriteAnswer,
  type HourBandWriteFailure,
  type HourBandWriteTable,
} from '@/hour-bands/write';

/** Story 2.1b's write half, executed rather than read (AD-15). */

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const DAN: HourBandRow = { id: 'pilot-dan', organizationId: ORGANIZATION, name: 'Dan', startMinute: 420 };

/** A read's surface state: bands (or none), and whether the read is failing. */
function readOf(
  bands: readonly HourBandRow[] | null,
  loading: boolean,
  failed = false,
): HourBandsSurfaceState {
  return { bands, refusal: failed ? HOUR_BANDS_UNAVAILABLE : null, loading: failed ? false : loading };
}

interface Recorded {
  readonly verb: 'insert' | 'update' | 'delete';
  readonly values: Readonly<Record<string, unknown>> | null;
  readonly filter: readonly [string, string] | null;
  readonly columns: string;
}

function tableAnswering(answer: HourBandWriteAnswer | Promise<never>): HourBandWriteTable & {
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const resolve = (): PromiseLike<HourBandWriteAnswer> =>
    answer instanceof Promise ? answer : Promise.resolve(answer);
  const filtered = (verb: 'update' | 'delete', values: Readonly<Record<string, unknown>> | null) => ({
    eq(column: string, value: string) {
      return {
        select(columns: string) {
          calls.push({ verb, values, filter: [column, value], columns });

          return resolve();
        },
      };
    },
  });

  return {
    calls,
    insert(values) {
      return {
        select(columns) {
          calls.push({ verb: 'insert', values, filter: null, columns });

          return resolve();
        },
      };
    },
    update(values) {
      return filtered('update', values);
    },
    delete() {
      return filtered('delete', null);
    },
  };
}

const ONE_ROW: HourBandWriteAnswer = { data: [{ id: 'new' }], error: null };
const NO_ROWS: HourBandWriteAnswer = { data: [], error: null };

/** The errors `0012` actually raises, as PostgREST reports them. */
function uniqueOn(constraint: string): HourBandWriteAnswer {
  return {
    data: null,
    error: {
      code: '23505',
      message: `duplicate key value violates unique constraint "${constraint}"`,
    },
  };
}

function checkOn(constraint: string): HourBandWriteAnswer {
  return {
    data: null,
    error: {
      code: '23514',
      message: `new row for relation "hour_bands" violates check constraint "${constraint}"`,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is entered', () => {
  it('trims the name, and refuses one that is nothing but whitespace', () => {
    expect(enteredHourBandName('  Jutro ')).toBe('Jutro');
    expect(enteredHourBandName('  ')).toBeNull();
  });

  it('sends a whole minute of the day as HH:MM, and nothing else', () => {
    expect(enteredHourBandStart('05:00')).toBe('05:00');
    expect(enteredHourBandStart('00:00')).toBe('00:00');
    expect(enteredHourBandStart('23:59')).toBe('23:59');
    expect(enteredHourBandStart('  05:00 ')).toBe('05:00');
    for (const refused of ['', '   ', '24:00', '7:00', '07:00:30']) {
      expect(enteredHourBandStart(refused), refused).toBeNull();
    }
  });
});

describe('adding a band', () => {
  it('writes the name and the start and nothing derived', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await createHourBand(table, ORGANIZATION, ' Jutro ', '05:00')).toEqual({ ok: true });
    expect(table.calls).toEqual([
      {
        verb: 'insert',
        values: { organization_id: ORGANIZATION, name: 'Jutro', start_time: '05:00' },
        filter: null,
        columns: 'id',
      },
    ]);
  });

  it('refuses a blank name and an invalid start before anything is sent', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await createHourBand(table, ORGANIZATION, '  ', '05:00')).toEqual({
      ok: false,
      code: HOUR_BAND_NAME_EMPTY,
    });
    expect(await createHourBand(table, ORGANIZATION, 'Jutro', '')).toEqual({
      ok: false,
      code: HOUR_BAND_START_INVALID,
    });
    expect(table.calls).toEqual([]);
  });

  it.each([
    { name: 'a taken start', answer: uniqueOn('hour_bands_organization_id_start_time_key'), code: HOUR_BAND_START_TAKEN },
    { name: 'a taken name', answer: uniqueOn('hour_bands_organization_name_key'), code: HOUR_BAND_NAME_TAKEN },
    { name: 'a blank name', answer: checkOn('hour_bands_name_not_blank'), code: HOUR_BAND_NAME_EMPTY },
    { name: 'a start at 24:00', answer: checkOn('hour_bands_start_before_midnight'), code: HOUR_BAND_START_INVALID },
    { name: 'a start with seconds', answer: checkOn('hour_bands_start_whole_minute'), code: HOUR_BAND_START_INVALID },
  ])('names $name as its own refusal', async ({ answer, code }) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await createHourBand(tableAnswering(answer), ORGANIZATION, ' noć ', '19:00')).toEqual({
      ok: false,
      code,
    });
  });
});

describe('the failure map, by constraint name', () => {
  it('tells the two uniques apart, though both raise 23505', () => {
    const start = hourBandWriteFailureOf(uniqueOn('hour_bands_organization_id_start_time_key').error!);
    const name = hourBandWriteFailureOf(uniqueOn('hour_bands_organization_name_key').error!);

    expect(start).toBe(HOUR_BAND_START_TAKEN);
    expect(name).toBe(HOUR_BAND_NAME_TAKEN);
    expect(hourBandWriteMessageKey(start)).not.toBe(hourBandWriteMessageKey(name));
  });

  it('tells the three checks apart, though all raise 23514', () => {
    expect(hourBandWriteFailureOf(checkOn('hour_bands_name_not_blank').error!)).toBe(
      HOUR_BAND_NAME_EMPTY,
    );
    expect(hourBandWriteFailureOf(checkOn('hour_bands_start_before_midnight').error!)).toBe(
      HOUR_BAND_START_INVALID,
    );
    expect(hourBandWriteFailureOf(checkOn('hour_bands_start_whole_minute').error!)).toBe(
      HOUR_BAND_START_INVALID,
    );
  });

  it('reads the constraint from details as well as from message', () => {
    expect(
      hourBandWriteFailureOf({
        code: '23505',
        message: 'duplicate key',
        details: 'Key violates hour_bands_organization_id_start_time_key.',
      }),
    ).toBe(HOUR_BAND_START_TAKEN);
    expect(
      hourBandWriteFailureOf({
        code: '23505',
        message: 'duplicate key',
        details: 'hour_bands_organization_name_key',
      }),
    ).toBe(HOUR_BAND_NAME_TAKEN);
  });

  it('reads an unknown constraint as invalid, and the rest by class', () => {
    expect(hourBandWriteFailureOf({ code: '23505', message: 'hour_bands_pkey' })).toBe(
      HOUR_BAND_WRITE_INVALID,
    );
    expect(hourBandWriteFailureOf({ code: '23514', message: 'something_else' })).toBe(
      HOUR_BAND_WRITE_INVALID,
    );
    expect(hourBandWriteFailureOf({ code: '22007' })).toBe(HOUR_BAND_START_INVALID);
    expect(hourBandWriteFailureOf({ code: '22008' })).toBe(HOUR_BAND_START_INVALID);
    expect(hourBandWriteFailureOf({ code: '42501' })).toBe(HOUR_BAND_WRITE_REFUSED);
    expect(hourBandWriteFailureOf({ code: '23502' })).toBe(HOUR_BAND_WRITE_INVALID);
    expect(hourBandWriteFailureOf({ code: 'PGRST301' })).toBe(HOUR_BAND_WRITE_UNAVAILABLE);
    expect(hourBandWriteFailureOf({})).toBe(HOUR_BAND_WRITE_UNAVAILABLE);
  });
});

describe('editing a band', () => {
  it('updates the name and start by id', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await updateHourBand(table, DAN, 'Dan', '06:30')).toEqual({ ok: true });
    expect(table.calls).toEqual([
      {
        verb: 'update',
        values: { name: 'Dan', start_time: '06:30' },
        filter: ['id', 'pilot-dan'],
        columns: 'id',
      },
    ]);
  });

  it('refuses a move onto a taken start with the start-taken refusal: no swap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await updateHourBand(
        tableAnswering(uniqueOn('hour_bands_organization_id_start_time_key')),
        DAN,
        'Dan',
        '19:00',
      ),
    ).toEqual({ ok: false, code: HOUR_BAND_START_TAKEN });
  });

  it('refuses a blank name and an invalid start before anything is sent', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await updateHourBand(table, DAN, '   ', '07:00')).toEqual({
      ok: false,
      code: HOUR_BAND_NAME_EMPTY,
    });
    expect(await updateHourBand(table, DAN, 'Dan', '24:00')).toEqual({
      ok: false,
      code: HOUR_BAND_START_INVALID,
    });
    expect(table.calls).toEqual([]);
  });

  it('refuses rows that are not rows as the service, not as stale', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const data of [{ id: 'x' }, 'rows', 0]) {
      expect(
        await updateHourBand(
          tableAnswering({ data, error: null } as unknown as HourBandWriteAnswer),
          DAN,
          'Dan',
          '07:00',
        ),
      ).toEqual({ ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE });
    }
  });

  it('reads zero rows back as stale', async () => {
    expect(await updateHourBand(tableAnswering(NO_ROWS), DAN, 'Dan', '07:00')).toEqual({
      ok: false,
      code: HOUR_BAND_STALE,
    });
  });

  it('reads a thrown call as the service', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await updateHourBand(tableAnswering(Promise.reject(new Error('offline'))), DAN, 'Dan', '07:00'),
    ).toEqual({ ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE });
  });
});

describe('removing a band', () => {
  it('deletes by id and asks for the row back, the last band included', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await removeHourBand(table, DAN)).toEqual({ ok: true });
    expect(table.calls).toEqual([
      { verb: 'delete', values: null, filter: ['id', 'pilot-dan'], columns: 'id' },
    ]);
  });

  it('reads zero rows back as stale: removed elsewhere', async () => {
    expect(await removeHourBand(tableAnswering(NO_ROWS), DAN)).toEqual({
      ok: false,
      code: HOUR_BAND_STALE,
    });
  });

  it('maps a refused removal, a thrown call, a service error and malformed rows', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await removeHourBand(tableAnswering({ data: null, error: { code: '42501' } }), DAN),
    ).toEqual({ ok: false, code: HOUR_BAND_WRITE_REFUSED });
    expect(await removeHourBand(tableAnswering(Promise.reject(new Error('offline'))), DAN)).toEqual({
      ok: false,
      code: HOUR_BAND_WRITE_UNAVAILABLE,
    });
    expect(
      await removeHourBand(tableAnswering({ data: null, error: { code: 'PGRST000' } }), DAN),
    ).toEqual({ ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE });
    expect(
      await removeHourBand(
        tableAnswering({ data: { id: 'pilot-dan' }, error: null } as unknown as HourBandWriteAnswer),
        DAN,
      ),
    ).toEqual({ ok: false, code: HOUR_BAND_WRITE_UNAVAILABLE });
  });
});

describe('where a refusal leaves focus', () => {
  it('keeps focus on the field the refusal is about', () => {
    expect(refusedFieldOf(HOUR_BAND_START_TAKEN)).toBe(HOUR_BAND_START_FIELD);
    expect(refusedFieldOf(HOUR_BAND_START_INVALID)).toBe(HOUR_BAND_START_FIELD);
    expect(refusedFieldOf(HOUR_BAND_NAME_TAKEN)).toBe(HOUR_BAND_NAME_FIELD);
    expect(refusedFieldOf(HOUR_BAND_NAME_EMPTY)).toBe(HOUR_BAND_NAME_FIELD);
    expect(refusedFieldOf(HOUR_BAND_STALE)).toBe(HOUR_BAND_NAME_FIELD);
  });

  it('marks only the field a refusal is about as invalid', () => {
    expect(marksField(null, HOUR_BAND_NAME_FIELD)).toBe(false);
    expect(marksField(HOUR_BAND_START_TAKEN, HOUR_BAND_START_FIELD)).toBe(true);
    expect(marksField(HOUR_BAND_START_TAKEN, HOUR_BAND_NAME_FIELD)).toBe(false);
    expect(marksField(HOUR_BAND_NAME_TAKEN, HOUR_BAND_NAME_FIELD)).toBe(true);
    expect(marksField(HOUR_BAND_NAME_TAKEN, HOUR_BAND_START_FIELD)).toBe(false);
    expect(marksField(HOUR_BAND_STALE, HOUR_BAND_NAME_FIELD)).toBe(false);
  });
});

describe('the organization claim', () => {
  const token = (payload: unknown): string =>
    `x.${btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_')}.y`;

  it('reads the organization from the token, and nothing from a malformed one', () => {
    expect(claimedOrganizationOf(token({ organization_id: ORGANIZATION }))).toBe(ORGANIZATION);
    expect(claimedOrganizationOf(token({ organization_id: '' }))).toBeNull();
    expect(claimedOrganizationOf('nonsense')).toBeNull();
    expect(claimedOrganizationOf(null)).toBeNull();
  });
});

describe('the screen state', () => {
  it('stages the removal: offer, one confirmation, then busy', () => {
    expect(removeStageOf(false, false)).toBe(REMOVE_IDLE);
    expect(removeStageOf(true, false)).toBe(REMOVE_ARMED);
    expect(removeStageOf(true, true)).toBe(REMOVE_BUSY);
    expect(removeStageOf(false, true)).toBe(REMOVE_BUSY);
  });

  it('finds the band, waits while loading, and names one it lacks', () => {
    expect(hourBandFormStateOf(readOf(null, true), 'pilot-dan', false)).toEqual({ band: null, refusal: null });
    expect(hourBandFormStateOf(readOf([DAN], false), 'pilot-dan', false)).toEqual({ band: DAN, refusal: null });
    expect(hourBandFormStateOf(readOf([], true), 'pilot-dan', false)).toEqual({ band: null, refusal: null });
    expect(hourBandFormStateOf(readOf([], false), 'pilot-dan', false)).toEqual({
      band: null,
      refusal: HOUR_BAND_UNKNOWN,
    });
  });

  it('hides the form and names nothing when the read failed, even over cached rows', () => {
    // A form remounted after a landed save would show stale values beside
    // "saved"; the screen shows only the read message instead.
    expect(hourBandFormStateOf(readOf([DAN], false, true), 'pilot-dan', false)).toEqual({
      band: null,
      refusal: null,
    });
    expect(hourBandFormStateOf(readOf([], false, true), 'pilot-dan', false)).toEqual({
      band: null,
      refusal: null,
    });
  });

  it('holds a removal outcome when one landed or was refused, and not otherwise', () => {
    expect(holdsRemovalOutcome(null, null)).toBe(false);
    expect(holdsRemovalOutcome(HOUR_BAND_SAVED, null)).toBe(false);
    expect(holdsRemovalOutcome(HOUR_BAND_REMOVED, null)).toBe(true);
    expect(holdsRemovalOutcome(null, HOUR_BAND_STALE)).toBe(true);
    expect(holdsRemovalOutcome(null, HOUR_BAND_WRITE_REFUSED)).toBe(true);
  });

  it('does not call a band unknown once this screen removed it', () => {
    expect(
      hourBandFormStateOf(readOf([], false), 'pilot-dan', holdsRemovalOutcome(HOUR_BAND_REMOVED, null)),
    ).toEqual({ band: null, refusal: null });
  });

  it('leaves the stale refusal standing, not unknown, when the band was removed elsewhere', () => {
    // The spec's Stale row: the delete matched nothing and the re-read no
    // longer holds the band. The screen says STALE, which it renders outside
    // the band's block; the form state must not stand UNKNOWN over it.
    expect(
      hourBandFormStateOf(readOf([], false), 'pilot-dan', holdsRemovalOutcome(null, HOUR_BAND_STALE)),
    ).toEqual({ band: null, refusal: null });
    expect(hourBandWriteMessageKey(HOUR_BAND_STALE)).toBe('organization.hourBands.error.stale');
  });

  it('still draws the band beside a removal refused while it stays in place', () => {
    expect(
      hourBandFormStateOf(readOf([DAN], false), 'pilot-dan', holdsRemovalOutcome(null, HOUR_BAND_WRITE_REFUSED)),
    ).toEqual({ band: DAN, refusal: null });
  });

  it('remounts the form only on a landed save', () => {
    expect(hourBandFormKey(DAN, 0)).toBe('pilot-dan:0');
    expect(savesAfter(0, { ok: true })).toBe(1);
    expect(savesAfter(1, { ok: false, code: HOUR_BAND_START_TAKEN })).toBe(1);
  });
});

describe('the messages', () => {
  const failures: HourBandWriteFailure[] = [
    HOUR_BAND_NAME_EMPTY,
    HOUR_BAND_NAME_TAKEN,
    HOUR_BAND_START_TAKEN,
    HOUR_BAND_START_INVALID,
    HOUR_BAND_STALE,
    HOUR_BAND_WRITE_REFUSED,
    HOUR_BAND_WRITE_INVALID,
    HOUR_BAND_WRITE_UNAVAILABLE,
    HOUR_BAND_UNKNOWN,
  ];

  it('gives every refusal its own message', () => {
    const keys = failures.map((failure) => hourBandWriteMessageKey(failure));

    expect(new Set(keys).size).toBe(failures.length);
    for (const key of keys) expect(key.startsWith('organization.hourBands.error.')).toBe(true);
  });

  it('confirms an edit and a removal in two sentences', () => {
    expect(hourBandSavedMessageKey(HOUR_BAND_SAVED)).toBe('organization.hourBands.saved');
    expect(hourBandSavedMessageKey(HOUR_BAND_REMOVED)).toBe('organization.hourBands.removed');
  });
});
