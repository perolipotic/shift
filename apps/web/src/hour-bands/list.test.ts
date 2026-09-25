import {
  QueryClient,
  QueryObserver,
  environmentManager,
  onlineManager,
} from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOUR_BANDS_COLUMNS,
  HOUR_BANDS_COUNT,
  HOUR_BANDS_FETCH_PAUSED,
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_READ_STALE_MS,
  HOUR_BANDS_TABLE,
  HOUR_BANDS_UNAVAILABLE,
  durationMessageKey,
  durationValuesOf,
  hourBandById,
  hourBandDisplayRowsOf,
  hourBandRowOf,
  hourBandsMessageKey,
  hourBandsQueryOptions,
  hourBandsSurfaceStateOf,
  minuteOfTime,
  partitionBarOf,
  readHourBands,
  type HourBandRow,
  type HourBandsAnswer,
  type HourBandsTable,
} from '@/hour-bands/list';
import { hourBandFormStateOf } from '@/hour-bands/write';
import { initLocalization, t } from '@/i18n';

/**
 * Story 2.1b's list half, executed rather than read (AD-15): every read-side
 * row of the spec's matrix, over both fixtures, in node.
 *
 * ANY COUNT (CAP-3): zero, two and three bands take one path, and no case
 * names a particular count as special.
 */

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const OTHER_ORGANIZATION = '00000000-0000-4000-8000-000000000002';

/** The pilot, as PostgREST returns it: Dan@07:00, Noć@19:00. */
const PILOT_ROWS = [
  { organization_id: ORGANIZATION, id: 'pilot-noc', name: 'Noć', start_time: '19:00:00' },
  { organization_id: ORGANIZATION, id: 'pilot-dan', name: 'Dan', start_time: '07:00:00' },
];

/** UJ-5: Jutro@05:00, Popodne@13:00, Noć@21:00. */
const UJ5_ROWS = [
  { organization_id: ORGANIZATION, id: 'uj5-jutro', name: 'Jutro', start_time: '05:00:00' },
  { organization_id: ORGANIZATION, id: 'uj5-popodne', name: 'Popodne', start_time: '13:00:00' },
  { organization_id: ORGANIZATION, id: 'uj5-noc', name: 'Noć', start_time: '21:00:00' },
];

function bandsOf(rows: readonly Record<string, unknown>[]): HourBandRow[] {
  return rows.map((row) => {
    const band = hourBandRowOf(row);

    if (band === null) throw new Error('fixture row does not validate');

    return band;
  });
}

const PILOT = bandsOf(PILOT_ROWS);
const UJ5 = bandsOf(UJ5_ROWS);

function tableAnswering(answer: HourBandsAnswer | Promise<never>): HourBandsTable & {
  readonly calls: unknown[][];
} {
  const calls: unknown[][] = [];

  return {
    calls,
    select(...args: unknown[]) {
      calls.push(args);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  };
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A duration as the screen renders it. */
function durationText(minutes: number): string {
  return t(durationMessageKey(minutes), durationValuesOf(minutes));
}

describe('the read', () => {
  it('names one table, one key, the four stored columns and an exact count', () => {
    expect(HOUR_BANDS_TABLE).toBe('hour_bands');
    expect(HOUR_BANDS_LIST_KEY).toEqual(['hourBands']);
    // No window, duration or midnight column: `0012` stores none (AD-3).
    expect(HOUR_BANDS_COLUMNS.split(',').sort()).toEqual(
      ['id', 'name', 'organization_id', 'start_time'].sort(),
    );
    expect(HOUR_BANDS_COUNT).toEqual({ count: 'exact' });
  });

  it('reads both fixtures, and zero rows as an honest answer', async () => {
    for (const rows of [PILOT_ROWS, UJ5_ROWS, []]) {
      const table = tableAnswering({ data: rows, error: null, count: rows.length });
      const outcome = await readHourBands(table);

      expect(outcome.ok).toBe(true);
      expect(outcome.ok ? outcome.bands.length : -1).toBe(rows.length);
      expect(table.calls).toEqual([[HOUR_BANDS_COLUMNS, HOUR_BANDS_COUNT]]);
    }
  });

  it.each([
    { name: 'an error', answer: { data: null, error: { code: '42P01' }, count: null } },
    { name: 'a short answer', answer: { data: PILOT_ROWS.slice(1), error: null, count: 2 } },
    { name: 'a count below the rows', answer: { data: PILOT_ROWS, error: null, count: 1 } },
    { name: 'a missing count', answer: { data: PILOT_ROWS, error: null, count: null } },
    { name: 'data that is not an array', answer: { data: { rows: PILOT_ROWS }, error: null, count: 2 } },
    { name: 'data that is a string', answer: { data: 'rows', error: null, count: 0 } },
    {
      name: 'a malformed row',
      answer: { data: [{ ...PILOT_ROWS[0], start_time: 7 }], error: null, count: 1 },
    },
    {
      name: 'a start with seconds',
      answer: { data: [{ ...PILOT_ROWS[0], start_time: '07:00:30' }], error: null, count: 1 },
    },
    {
      name: 'two bands at one start',
      answer: {
        data: [PILOT_ROWS[0], { ...PILOT_ROWS[1], start_time: '19:00:00' }],
        error: null,
        count: 2,
      },
    },
    {
      name: 'two organizations',
      answer: {
        data: [PILOT_ROWS[0], { ...PILOT_ROWS[1], organization_id: OTHER_ORGANIZATION }],
        error: null,
        count: 2,
      },
    },
  ])('refuses $name as unavailable', async ({ answer }) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readHourBands(tableAnswering(answer as HourBandsAnswer))).toEqual({
      ok: false,
      code: HOUR_BANDS_UNAVAILABLE,
    });
  });

  it('refuses a thrown call as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readHourBands(tableAnswering(Promise.reject(new Error('offline'))))).toEqual({
      ok: false,
      code: HOUR_BANDS_UNAVAILABLE,
    });
  });

  it('parses a stored time and an entered one into the same minute', () => {
    expect(minuteOfTime('07:00:00')).toBe(420);
    expect(minuteOfTime('07:00')).toBe(420);
    expect(minuteOfTime('00:00')).toBe(0);
    expect(minuteOfTime('23:59:00')).toBe(1439);
    for (const refused of ['24:00', '07:60', '07:00:30', '7:00', '', 'nonsense']) {
      expect(minuteOfTime(refused), refused).toBeNull();
    }
  });

  it('finds the band a route names, and nothing for an id it lacks', () => {
    expect(hourBandById(PILOT, 'pilot-dan')?.name).toBe('Dan');
    expect(hourBandById(PILOT, 'missing')).toBeNull();
  });
});

describe('the rows, derived by the domain and only formatted here', () => {
  it('renders the pilot: 07:00–19:00 12 h; 19:00–07:00 12 h, crossing midnight', () => {
    const rows = hourBandDisplayRowsOf(PILOT);

    // START ORDER, whatever order the answer came in.
    expect(rows.map((row) => row.band.name)).toEqual(['Dan', 'Noć']);
    expect(rows.map((row) => row.window)).toEqual(['07:00–19:00', '19:00–07:00']);
    expect(rows.map((row) => durationText(row.durationMinutes))).toEqual(['12 h', '12 h']);
    expect(rows.map((row) => row.crossesMidnight)).toEqual([false, true]);
  });

  it('renders UJ-5 as three 8 h rows through the same path', () => {
    const rows = hourBandDisplayRowsOf(UJ5);

    expect(rows.map((row) => row.window)).toEqual(['05:00–13:00', '13:00–21:00', '21:00–05:00']);
    expect(rows.map((row) => durationText(row.durationMinutes))).toEqual(['8 h', '8 h', '8 h']);
    expect(rows.map((row) => row.crossesMidnight)).toEqual([false, false, true]);
  });

  it('renders zero bands as zero rows', () => {
    expect(hourBandDisplayRowsOf([])).toEqual([]);
  });

  it('says a duration in hours and minutes, with no plural', () => {
    expect(durationText(720)).toBe('12 h');
    expect(durationText(90)).toBe('1 h 30 min');
    expect(durationText(45)).toBe('45 min');
    expect(durationText(0)).toBe('0 h');
    expect(durationText(1440)).toBe('24 h');
    // 21 and 22 are where a hand-rolled plural shows; units take none.
    expect(durationText(21 * 60)).toBe('21 h');
    expect(durationText(22 * 60 + 1)).toBe('22 h 1 min');
  });
});

describe('the 24-hour bar', () => {
  it('draws the pilot as three segments covering 24 of 24 h, Noć labelled twice', () => {
    const bar = partitionBarOf(PILOT);

    expect(bar.segments.map((segment) => segment.name)).toEqual(['Noć', 'Dan', 'Noć']);
    expect(bar.segments.map((segment) => segment.widthPercent)).toEqual([
      (420 / 1440) * 100,
      50,
      (300 / 1440) * 100,
    ]);
    expect(bar.coveredMinutes).toBe(1440);
    expect(bar.uncoveredMinutes).toBe(0);
    expect(new Set(bar.segments.map((segment) => segment.key)).size).toBe(3);
  });

  it('draws UJ-5 as four segments summing to the whole bar', () => {
    const bar = partitionBarOf(UJ5);

    expect(bar.segments.map((segment) => segment.name)).toEqual(['Noć', 'Jutro', 'Popodne', 'Noć']);
    expect(bar.segments.reduce((sum, segment) => sum + segment.widthPercent, 0)).toBeCloseTo(100);
    expect(bar.uncoveredMinutes).toBe(0);
  });

  it('draws zero bands as ONE uncovered segment spanning the day, 0 of 24 h', () => {
    const bar = partitionBarOf([]);

    expect(bar.segments).toHaveLength(1);
    expect(bar.segments[0]?.name).toBeNull();
    expect(bar.segments[0]?.widthPercent).toBe(100);
    expect(bar.coveredMinutes).toBe(0);
    expect(bar.uncoveredMinutes).toBe(1440);
  });

  it('states coverage in numbers, and the uncovered hours at zero bands', () => {
    const sentence = (bands: readonly HourBandRow[]): string => {
      const bar = partitionBarOf(bands);

      return t('organization.hourBands.coverage', {
        covered: durationText(bar.coveredMinutes),
        uncovered: durationText(bar.uncoveredMinutes),
      });
    };

    expect(sentence(PILOT)).toBe('Pokriveno 24 h od 24 h, nepokriveno 0 h.');
    expect(sentence([])).toBe('Pokriveno 0 h od 24 h, nepokriveno 24 h.');
    expect(sentence([])).not.toContain('Nema');
  });

  it('flags the uncovered segment in words, not by colour', () => {
    expect(t('organization.hourBands.uncovered')).toBe('Nepokriveno');
  });
});

describe('the count', () => {
  it.each([
    { count: 0, expected: '0 pojaseva' },
    { count: 1, expected: '1 pojas' },
    { count: 2, expected: '2 pojasa' },
    { count: 5, expected: '5 pojaseva' },
    { count: 21, expected: '21 pojas' },
    { count: 22, expected: '22 pojasa' },
  ])('says $count bands as $expected', ({ count, expected }) => {
    expect(t('organization.hourBands.count', { count })).toBe(expected);
  });
});

describe('the surface state, driven through the one query definition', () => {
  /**
   * A REAL `QueryClient` and `QueryObserver`, for the reason
   * `teams/list.test.ts` gives: only TanStack Query itself can show that a
   * failed refetch keeps the cached bands. Only `retryDelay` is overridden, and
   * node is told it is a browser so the factory's own `retry: 1` applies.
   */
  const wasServer = environmentManager.isServer();
  const good = { data: PILOT_ROWS, error: null, count: PILOT_ROWS.length };
  const miscounted = { data: PILOT_ROWS, error: null, count: PILOT_ROWS.length + 1 };
  let client: QueryClient;
  let unsubscribes: (() => void)[];

  beforeAll(() => {
    environmentManager.setIsServer(() => false);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client = new QueryClient();
    unsubscribes = [];
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  /** A table answering each call with the next answer, the last one for ever. */
  function answeringInTurn(
    ...answers: HourBandsAnswer[]
  ): HourBandsTable & { readonly calls: () => number } {
    let calls = 0;

    return {
      calls: () => calls,
      select() {
        const answer = answers[Math.min(calls, answers.length - 1)];

        calls += 1;

        return Promise.resolve(answer as HourBandsAnswer);
      },
    };
  }

  function observe(table: () => HourBandsTable) {
    const observer = new QueryObserver(client, { ...hourBandsQueryOptions(table), retryDelay: 0 });

    unsubscribes.push(observer.subscribe(() => undefined));

    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    });

    return observer.getCurrentResult();
  }

  it("keeps today's key and cache bound", () => {
    const options = hourBandsQueryOptions(() => answeringInTurn(good));

    expect(options.queryKey).toEqual(HOUR_BANDS_LIST_KEY);
    expect(options.staleTime).toBe(HOUR_BANDS_READ_STALE_MS);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(1);
    expect(options.retryDelay).toBe(1000);
  });

  it('pulses while the first read is in flight and says nothing', () => {
    const observer = observe(() => answeringInTurn(good));

    expect(hourBandsSurfaceStateOf(observer.getCurrentResult())).toEqual({
      bands: null,
      refusal: null,
      loading: true,
    });
  });

  it('draws a first answer, an empty one included', async () => {
    const pilot = await settled(observe(() => answeringInTurn(good)));

    expect(hourBandsSurfaceStateOf(pilot)).toEqual({ bands: PILOT, refusal: null, loading: false });

    client.clear();
    const empty = await settled(observe(() => answeringInTurn({ data: [], error: null, count: 0 })));

    expect(hourBandsSurfaceStateOf(empty)).toEqual({ bands: [], refusal: null, loading: false });
  });

  it('retries an unavailable first read, then shows the message and no bands', async () => {
    const table = answeringInTurn(miscounted);
    const result = await settled(observe(() => table));

    expect(table.calls(), 'the unavailable read was not retried exactly once').toBe(2);
    expect(result.status).toBe('error');
    expect(result.data).toBeUndefined();
    expect(hourBandsSurfaceStateOf(result)).toEqual({
      bands: null,
      refusal: HOUR_BANDS_UNAVAILABLE,
      loading: false,
    });
  });

  it('keeps the bands beside the message when a refetch is unavailable', async () => {
    // The write's `invalidateQueries`, then a blip: the rows, the bar and the
    // edit form's band all stay on screen.
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);

    await settled(observer);
    await client.invalidateQueries({ queryKey: HOUR_BANDS_LIST_KEY });
    const result = await settled(observer);

    expect(table.calls(), 'the unavailable refetch was not retried exactly once').toBe(3);
    expect(result.isError).toBe(true);
    expect(hourBandsSurfaceStateOf(result)).toEqual({
      bands: PILOT,
      refusal: HOUR_BANDS_UNAVAILABLE,
      loading: false,
    });
  });

  it('hides the edit form, and names nothing, when a refetch fails over good bands', async () => {
    // Through the real cache and the same two calls the edit screen makes: the
    // cached bands stay on the surface, and the form gate still withholds the form.
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);
    const id = PILOT[0]?.id ?? '';

    await settled(observer);
    expect(
      hourBandFormStateOf(hourBandsSurfaceStateOf(observer.getCurrentResult()), id, false).band,
    ).not.toBeNull();
    await client.invalidateQueries({ queryKey: HOUR_BANDS_LIST_KEY });
    const state = hourBandsSurfaceStateOf(await settled(observer));

    expect(state.bands).toEqual(PILOT);
    expect(hourBandFormStateOf(state, id, false)).toEqual({ band: null, refusal: null });
  });

  it('settles as a success when a transient failure is followed by an answer', async () => {
    const table = answeringInTurn(miscounted, good);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(result.status).toBe('success');
    expect(hourBandsSurfaceStateOf(result)).toEqual({ bands: PILOT, refusal: null, loading: false });
  });

  it('rejects when the table cannot even be built', async () => {
    const result = await settled(
      observe(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    );

    expect(result.isError).toBe(true);
    expect(hourBandsSurfaceStateOf(result)).toEqual({
      bands: null,
      refusal: HOUR_BANDS_UNAVAILABLE,
      loading: false,
    });
  });

  it('says why rather than pulsing while paused offline', () => {
    onlineManager.setOnline(false);
    const result = observe(() => answeringInTurn(good)).getCurrentResult();

    expect(result.isPending).toBe(true);
    expect(result.fetchStatus).toBe(HOUR_BANDS_FETCH_PAUSED);
    expect(hourBandsSurfaceStateOf(result)).toEqual({
      bands: null,
      refusal: HOUR_BANDS_UNAVAILABLE,
      loading: false,
    });
  });

  it('never pulses a skeleton beside a message', () => {
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', HOUR_BANDS_FETCH_PAUSED]) {
          for (const data of [undefined, [], PILOT]) {
            const state = hourBandsSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });

  it('names the read failure through its own key', () => {
    expect(hourBandsMessageKey(HOUR_BANDS_UNAVAILABLE)).toBe(
      'organization.hourBands.error.unavailable',
    );
  });
});
