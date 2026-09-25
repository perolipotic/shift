import {
  QueryClient,
  QueryObserver,
  environmentManager,
  onlineManager,
} from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initLocalization, t } from '@/i18n';
import {
  NONWORKING_CHIP_CLASS,
  SHIFT_TYPES_COLUMNS,
  SHIFT_TYPES_COUNT,
  SHIFT_TYPES_FETCH_PAUSED,
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_STALE_MS,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_UNAVAILABLE,
  chipClassOf,
  compareCreation,
  durationValuesOf,
  instantOf,
  rampSlotsOf,
  readShiftTypes,
  scheduledVersionOf,
  shiftTypeById,
  shiftTypeDisplayRowOf,
  shiftTypeDurationMessageKey,
  shiftTypeHeadingMessageKey,
  shiftTypeListOf,
  shiftTypeRowOf,
  shiftTypesMessageKey,
  shiftTypesQueryOptions,
  shiftTypesSurfaceStateOf,
  shiftTypesTodayOf,
  type ShiftTypeRow,
  type ShiftTypesAnswer,
  type ShiftTypesSnapshot,
  type ShiftTypesTable,
} from '@/shift-types/list';
import { RAMP_SLOT_COUNT, rampSlotOf, rampTokenOf } from '@/shift-types/ramp';
import { shiftTypeFormStateOf } from '@/shift-types/write';

/**
 * Story 2.2b's list half, executed rather than read (AD-15): every read-side
 * row of the spec's matrix, over both fixtures, in node.
 */

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const OTHER_ORGANIZATION = '00000000-0000-4000-8000-000000000002';
const TODAY = '2026-09-25';
const SEEDED = '2020-01-01';

/** A type as PostgREST embeds it under the organization. */
function typeRow(
  id: string,
  name: string,
  createdAt: string,
  versions: readonly (readonly [string, string, string])[],
  { working = true, archived = false, organization = ORGANIZATION } = {},
): Record<string, unknown> {
  return {
    organization_id: organization,
    id,
    name,
    is_working: working,
    archived,
    created_at: createdAt,
    shift_type_versions: versions.map(([from, start, end]) => ({
      organization_id: organization,
      shift_type_id: id,
      start_time: start,
      end_time: end,
      effective_from: from,
    })),
  };
}

function organizationRow(types: readonly Record<string, unknown>[], timezone = 'Europe/Zagreb') {
  return { id: ORGANIZATION, timezone, shift_types: types };
}

function answerOf(types: readonly Record<string, unknown>[]): ShiftTypesAnswer {
  return { data: [organizationRow(types)], error: null, count: 1 };
}

/** The pilot, as seeded: ascending `created_at`, versions from 2020-01-01. */
const PILOT_TYPES = [
  // Deliberately out of order: the reader sorts by creation.
  typeRow('pilot-slobodno', 'Slobodno', '2026-09-25T16:12:54.887009+00:00', [], { working: false }),
  typeRow('pilot-dan', 'Dan', '2026-09-25T16:12:54.885009+00:00', [[SEEDED, '07:00:00', '19:00:00']]),
  typeRow('pilot-noc', 'Noć', '2026-09-25T16:12:54.886009+00:00', [[SEEDED, '19:00:00', '07:00:00']]),
];

const UJ5_TYPES = [
  typeRow('uj5-jutarnja', 'Jutarnja', '2026-09-25T16:12:54.9+00:00', [[SEEDED, '06:00:00', '14:00:00']]),
  typeRow('uj5-popodnevna', 'Popodnevna', '2026-09-25T16:12:54.91+00:00', [[SEEDED, '14:00:00', '22:00:00']]),
  typeRow('uj5-nocna', 'Noćna', '2026-09-25T16:12:54.911+00:00', [[SEEDED, '22:00:00', '06:00:00']]),
  typeRow('uj5-slobodno', 'Slobodno', '2026-09-25T16:12:54.912+00:00', [], { working: false }),
];

async function snapshotOf(types: readonly Record<string, unknown>[]): Promise<ShiftTypesSnapshot> {
  const outcome = await readShiftTypes(tableAnswering(answerOf(types)));

  if (!outcome.ok) throw new Error('fixture does not validate');

  return outcome.snapshot;
}

function tableAnswering(answer: ShiftTypesAnswer | Promise<never>): ShiftTypesTable & {
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

/** `n` working types created a second apart, `seven-0` … */
function workingTypes(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    typeRow(
      `t-${String(index)}`,
      `Tip ${String(index + 1)}`,
      `2026-09-25T10:00:${String(index).padStart(2, '0')}+00:00`,
      [[SEEDED, '08:00:00', '16:00:00']],
    ),
  );
}

beforeAll(async () => {
  await initLocalization();
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the read', () => {
  it('reads the organization, its zone and every type with its versions in one call', async () => {
    const table = tableAnswering(answerOf(PILOT_TYPES));
    const outcome = await readShiftTypes(table);

    expect(table.calls).toEqual([[SHIFT_TYPES_COLUMNS, SHIFT_TYPES_COUNT]]);
    expect(SHIFT_TYPES_READ_TABLE).toBe('organizations');
    expect(SHIFT_TYPES_COLUMNS).toContain('timezone');
    expect(SHIFT_TYPES_COLUMNS).toContain('shift_type_versions(');
    expect(SHIFT_TYPES_COLUMNS, 'a duration is derived, never selected').not.toMatch(/duration/);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.timeZone).toBe('Europe/Zagreb');
    expect(outcome.snapshot.types.map((type) => type.id)).toEqual([
      'pilot-dan',
      'pilot-noc',
      'pilot-slobodno',
    ]);
  });

  it('answers zero types as an answer, with the zone still there', async () => {
    const outcome = await readShiftTypes(tableAnswering(answerOf([])));

    expect(outcome).toEqual({
      ok: true,
      snapshot: { organizationId: ORGANIZATION, timeZone: 'Europe/Zagreb', types: [] },
    });
  });

  it.each([
    ['a transport error', { data: null, error: { code: '500' }, count: null }],
    ['no organization', { data: [], error: null, count: 0 }],
    ['two organizations', { data: [organizationRow([]), organizationRow([])], error: null, count: 2 }],
    ['a count that disagrees', { data: [organizationRow([])], error: null, count: 2 }],
    ['no count', { data: [organizationRow([])], error: null, count: null }],
    ['data that is not an array', { data: {} as unknown as unknown[], error: null, count: 1 }],
    ['no zone', { data: [{ id: ORGANIZATION, shift_types: [] }], error: null, count: 1 }],
    ['no embedded types', { data: [{ id: ORGANIZATION, timezone: 'UTC' }], error: null, count: 1 }],
  ])('refuses %s', async (_, answer) => {
    expect(await readShiftTypes(tableAnswering(answer as ShiftTypesAnswer))).toEqual({
      ok: false,
      code: SHIFT_TYPES_UNAVAILABLE,
    });
  });

  it('refuses a rejected call', async () => {
    expect(await readShiftTypes(tableAnswering(Promise.reject(new Error('down'))))).toEqual({
      ok: false,
      code: SHIFT_TYPES_UNAVAILABLE,
    });
  });

  it.each([
    ['a type from another tenant', [typeRow('x', 'X', '2026-09-25T10:00:00Z', [], { organization: OTHER_ORGANIZATION })]],
    ['a malformed time', [typeRow('x', 'X', '2026-09-25T10:00:00Z', [[SEEDED, '07:00:30', '19:00:00']])]],
    ['24:00', [typeRow('x', 'X', '2026-09-25T10:00:00Z', [[SEEDED, '24:00:00', '19:00:00']])]],
    ['an impossible date', [typeRow('x', 'X', '2026-09-25T10:00:00Z', [['2026-02-31', '07:00:00', '19:00:00']])]],
    [
      'two versions on one date',
      [
        typeRow('x', 'X', '2026-09-25T10:00:00Z', [
          [SEEDED, '07:00:00', '19:00:00'],
          [SEEDED, '08:00:00', '19:00:00'],
        ]),
      ],
    ],
    ['a version on a non-working type', [typeRow('x', 'X', '2026-09-25T10:00:00Z', [[SEEDED, '07:00:00', '19:00:00']], { working: false })]],
    ['a malformed creation instant', [typeRow('x', 'X', 'yesterday', [])]],
    ['one id twice', [typeRow('x', 'X', '2026-09-25T10:00:00Z', []), typeRow('x', 'Y', '2026-09-25T10:00:01Z', [])]],
  ])('refuses %s', async (_, types) => {
    expect(await readShiftTypes(tableAnswering(answerOf(types)))).toEqual({
      ok: false,
      code: SHIFT_TYPES_UNAVAILABLE,
    });
  });

  it('refuses a version from another tenant than its type and the snapshot', async () => {
    const row = typeRow('x', 'X', '2026-09-25T10:00:00Z', [[SEEDED, '07:00:00', '19:00:00']]);
    const versions = row['shift_type_versions'] as Record<string, unknown>[];

    versions[0] = { ...versions[0], organization_id: OTHER_ORGANIZATION };
    expect(shiftTypeRowOf(row)).toBeNull();
    expect(await readShiftTypes(tableAnswering(answerOf([row])))).toEqual({
      ok: false,
      code: SHIFT_TYPES_UNAVAILABLE,
    });
    expect(SHIFT_TYPES_COLUMNS).toContain('shift_type_versions(organization_id,');
  });

  it('refuses a version naming another type', () => {
    const row = typeRow('x', 'X', '2026-09-25T10:00:00Z', [[SEEDED, '07:00:00', '19:00:00']]);
    const versions = row['shift_type_versions'] as Record<string, unknown>[];

    versions[0] = { ...versions[0], shift_type_id: 'y' };
    expect(shiftTypeRowOf(row)).toBeNull();
  });

  it('orders versions oldest first whatever order they arrive in', () => {
    const row = shiftTypeRowOf(
      typeRow('x', 'X', '2026-09-25T10:00:00Z', [
        ['2026-10-01', '08:00:00', '20:00:00'],
        [SEEDED, '07:00:00', '19:00:00'],
      ]),
    );

    expect(row?.versions.map((version) => version.effectiveFrom)).toEqual([SEEDED, '2026-10-01']);
  });

  it('finds a type by id, and nothing for an id it does not hold', async () => {
    const pilot = await snapshotOf(PILOT_TYPES);

    expect(shiftTypeById(pilot, 'pilot-noc')?.name).toBe('Noć');
    expect(shiftTypeById(pilot, 'nope')).toBeNull();
  });
});

describe('creation order', () => {
  it('reads microseconds, and a fraction with its trailing zeros dropped', () => {
    expect(instantOf('2026-09-25T16:12:54.88+00:00')).toEqual(
      instantOf('2026-09-25T16:12:54.880000+00:00'),
    );
    expect(compareCreation(
      { id: 'b', createdAt: '2026-09-25T16:12:54.000001+00:00' },
      { id: 'a', createdAt: '2026-09-25T16:12:54.000002+00:00' },
    )).toBe(-1);
    expect(compareCreation(
      { id: 'a', createdAt: '2026-09-25T16:12:54.9+00:00' },
      { id: 'b', createdAt: '2026-09-25T16:12:54.10+00:00' },
    )).toBe(1);
  });

  it('compares instants across offsets, not their text', () => {
    // 18:00+02:00 is 16:00Z, BEFORE 17:00Z, though its text sorts after.
    expect(compareCreation(
      { id: 'a', createdAt: '2026-09-25T18:00:00+02:00' },
      { id: 'b', createdAt: '2026-09-25T17:00:00+00:00' },
    )).toBe(-1);
  });

  it('breaks a tie on created_at by id, stably', () => {
    const at = '2026-09-25T10:00:00+00:00';

    expect(compareCreation({ id: 'a', createdAt: at }, { id: 'b', createdAt: at })).toBe(-1);
    expect(compareCreation({ id: 'b', createdAt: at }, { id: 'a', createdAt: at })).toBe(1);
    expect(compareCreation({ id: 'a', createdAt: at }, { id: 'a', createdAt: at })).toBe(0);
  });

  it('refuses a malformed instant', () => {
    expect(instantOf('2026-09-25')).toBeNull();
    expect(instantOf('2026-09-25T10:00:00')).toBeNull();
  });
});

describe('the ramp', () => {
  it('is (i mod 6) + 1', () => {
    expect(RAMP_SLOT_COUNT).toBe(6);
    expect(Array.from({ length: 13 }, (_, index) => rampSlotOf(index))).toEqual([
      1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1,
    ]);
    expect(() => rampSlotOf(-1)).toThrow(RangeError);
    expect(() => rampSlotOf(1.5)).toThrow(RangeError);
  });

  it('names numbered tokens, never named ones', () => {
    expect(rampTokenOf(3)).toBe('shift-slot-3');
    expect(rampTokenOf(null)).toBe('shift-nonworking');
  });

  it('draws each slot in its own static classes, the name always beside', () => {
    for (const slot of [1, 2, 3, 4, 5, 6] as const) {
      expect(chipClassOf(slot)).toContain(`bg-shift-slot-${String(slot)} text-shift-slot-${String(slot)}-foreground`);
    }
    expect(chipClassOf(null)).toContain(NONWORKING_CHIP_CLASS);
    expect(NONWORKING_CHIP_CLASS).toBe('bg-shift-nonworking text-shift-nonworking-foreground');
  });
});

describe('the list, over both fixtures', () => {
  it('pilot: Dan slot 1 07:00–19:00 12 h, Noć slot 2 19:00–07:00 12 h, Slobodno non-working', async () => {
    const { active, archived } = shiftTypeListOf(await snapshotOf(PILOT_TYPES), TODAY);

    expect(archived).toEqual([]);
    expect(
      active.map((row) => [row.type.name, row.slot, row.times?.range ?? null, row.times?.durationMinutes ?? null]),
    ).toEqual([
      ['Dan', 1, '07:00–19:00', 720],
      ['Noć', 2, '19:00–07:00', 720],
      ['Slobodno', null, null, null],
    ]);
    expect(active.map((row) => row.times?.crossesMidnight ?? null)).toEqual([false, true, null]);
    expect(active[2]?.chipClass).toContain(NONWORKING_CHIP_CLASS);
    expect(active[0]?.chipClass).toContain('bg-shift-slot-1');
    expect(active[1]?.chipClass).toContain('bg-shift-slot-2');
    expect(t(shiftTypeDurationMessageKey(720), durationValuesOf(720))).toBe('12 h');
  });

  it('UJ-5: Jutarnja 1, Popodnevna 2, Noćna 3 22:00–06:00 8 h, Slobodno non-working', async () => {
    const { active } = shiftTypeListOf(await snapshotOf(UJ5_TYPES), TODAY);

    expect(active.map((row) => [row.type.name, row.slot, row.times?.range ?? null])).toEqual([
      ['Jutarnja', 1, '06:00–14:00'],
      ['Popodnevna', 2, '14:00–22:00'],
      ['Noćna', 3, '22:00–06:00'],
      ['Slobodno', null, null],
    ]);
    expect(active[2]?.times?.durationMinutes).toBe(480);
    expect(t(shiftTypeDurationMessageKey(480), durationValuesOf(480))).toBe('8 h');
    expect(active[2]?.chipClass).toContain('bg-shift-slot-3 text-shift-slot-3-foreground');
  });

  it('a seventh working type is slot 1 again, and its name tells it apart', async () => {
    const { active } = shiftTypeListOf(await snapshotOf(workingTypes(7)), TODAY);

    expect(active.map((row) => row.slot)).toEqual([1, 2, 3, 4, 5, 6, 1]);
    expect(active[6]?.chipClass).toBe(active[0]?.chipClass);
    expect(active[6]?.type.name).not.toBe(active[0]?.type.name);
  });

  it('a non-working type takes no slot, and moves no working type', async () => {
    const types = [
      typeRow('a', 'A', '2026-09-25T10:00:00Z', [[SEEDED, '08:00:00', '16:00:00']]),
      typeRow('off', 'Off', '2026-09-25T10:00:01Z', [], { working: false }),
      typeRow('b', 'B', '2026-09-25T10:00:02Z', [[SEEDED, '16:00:00', '00:00:00']]),
    ];
    const slots = rampSlotsOf((await snapshotOf(types)).types);

    expect([...slots.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('an archived slot-2 type keeps its slot, and later types keep theirs', async () => {
    const types = [
      typeRow('a', 'A', '2026-09-25T10:00:00Z', [[SEEDED, '08:00:00', '16:00:00']]),
      typeRow('b', 'B', '2026-09-25T10:00:01Z', [[SEEDED, '16:00:00', '00:00:00']], { archived: true }),
      typeRow('c', 'C', '2026-09-25T10:00:02Z', [[SEEDED, '00:00:00', '08:00:00']]),
    ];
    const { active, archived } = shiftTypeListOf(await snapshotOf(types), TODAY);

    expect(active.map((row) => [row.type.id, row.slot])).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
    expect(archived.map((row) => [row.type.id, row.slot])).toEqual([['b', 2]]);
  });

  it('07:00–07:00 is 24 h', async () => {
    const { active } = shiftTypeListOf(
      await snapshotOf([typeRow('d', 'Dežurstvo', '2026-09-25T10:00:00Z', [[TODAY, '07:00:00', '07:00:00']])]),
      TODAY,
    );

    expect(active[0]?.times?.range).toBe('07:00–07:00');
    expect(active[0]?.times?.durationMinutes).toBe(1440);
    expect(t(shiftTypeDurationMessageKey(1440), durationValuesOf(1440))).toBe('24 h');
  });

  it('pilot plus Dežurstvo: it lists as slot 3', async () => {
    const { active } = shiftTypeListOf(
      await snapshotOf([
        ...PILOT_TYPES,
        typeRow('d', 'Dežurstvo', '2026-09-25T17:00:00+00:00', [[TODAY, '07:00:00', '07:00:00']]),
      ]),
      TODAY,
    );

    expect(active.find((row) => row.type.id === 'd')?.slot).toBe(3);
  });

  it('a working type without a version has no times — nothing invents them', async () => {
    const { active } = shiftTypeListOf(
      await snapshotOf([typeRow('x', 'Bez', '2026-09-25T10:00:00Z', [])]),
      TODAY,
    );

    expect(active[0]?.slot).toBe(1);
    expect(active[0]?.times).toBeNull();
    expect(active[0]?.scheduled).toBeNull();
  });

  it('shows a scheduled correction with its date, and today the times in effect', async () => {
    const snapshot = await snapshotOf([
      typeRow('dan', 'Dan', '2026-09-25T10:00:00Z', [
        [SEEDED, '07:00:00', '19:00:00'],
        ['2026-10-01', '08:00:00', '20:00:00'],
      ]),
    ]);
    const row = shiftTypeDisplayRowOf(snapshot, 'dan', TODAY);

    expect(row?.times?.range).toBe('07:00–19:00');
    expect(row?.scheduled).toEqual({
      from: '2026-10-01',
      times: expect.objectContaining({ range: '08:00–20:00', durationMinutes: 720 }),
    });
    // On and after its date, it is the times in effect and nothing is scheduled.
    expect(shiftTypeDisplayRowOf(snapshot, 'dan', '2026-10-01')?.times?.range).toBe('08:00–20:00');
    expect(shiftTypeDisplayRowOf(snapshot, 'dan', '2026-10-01')?.scheduled).toBeNull();
    // A date before the correction keeps the old times (AD-2).
    expect(shiftTypeDisplayRowOf(snapshot, 'dan', '2026-09-30')?.times?.range).toBe('07:00–19:00');
  });

  it('a rename after a correction: the new name, each version’s times with its dates (AD-2)', async () => {
    const versions: readonly (readonly [string, string, string])[] = [
      [SEEDED, '07:00:00', '19:00:00'],
      ['2026-09-20', '06:00:00', '18:00:00'],
    ];
    const snapshot = await snapshotOf([typeRow('dan', 'Dnevna', '2026-09-25T10:00:00Z', versions)]);

    expect(shiftTypeDisplayRowOf(snapshot, 'dan', '2026-09-19')?.type.name).toBe('Dnevna');
    expect(shiftTypeDisplayRowOf(snapshot, 'dan', '2026-09-19')?.times?.range).toBe('07:00–19:00');
    expect(shiftTypeDisplayRowOf(snapshot, 'dan', '2026-09-20')?.times?.range).toBe('06:00–18:00');
  });

  it('scheduled is the latest version only when it is after today', async () => {
    const snapshot = await snapshotOf([
      typeRow('a', 'A', '2026-09-25T10:00:00Z', [[TODAY, '07:00:00', '19:00:00']]),
    ]);
    const type = snapshot.types[0] as ShiftTypeRow;

    expect(scheduledVersionOf(type, TODAY)).toBeNull();
    expect(scheduledVersionOf(type, '2026-09-24')?.effectiveFrom).toBe(TODAY);
  });

  it("reads today in the organization's zone, never the device's", async () => {
    const snapshot = await snapshotOf([]);
    // 23:30Z on the 25th is already the 26th in Zagreb.
    const late = new Date('2026-09-25T23:30:00Z');

    expect(shiftTypesTodayOf(snapshot, late)).toBe('2026-09-26');
    expect(shiftTypesTodayOf({ ...snapshot, timeZone: 'America/Los_Angeles' }, late)).toBe('2026-09-25');
  });

  it('shapes a duration as units, never plurals', () => {
    expect(shiftTypeDurationMessageKey(720)).toBe('rotation.shiftTypes.duration.hours');
    expect(shiftTypeDurationMessageKey(90)).toBe('rotation.shiftTypes.duration.hoursMinutes');
    expect(shiftTypeDurationMessageKey(45)).toBe('rotation.shiftTypes.duration.minutes');
    expect(t(shiftTypeDurationMessageKey(90), durationValuesOf(90))).toBe('1 h 30 min');
  });

  it('titles an archived type as viewed', async () => {
    const snapshot = await snapshotOf([
      typeRow('a', 'A', '2026-09-25T10:00:00Z', [], { archived: true }),
    ]);

    expect(shiftTypeHeadingMessageKey(snapshot.types[0] ?? null)).toBe('rotation.shiftTypes.viewHeading');
    expect(shiftTypeHeadingMessageKey(null)).toBe('rotation.shiftTypes.editHeading');
  });
});

describe('the surface state, driven through the one query definition', () => {
  /**
   * A REAL `QueryClient` and `QueryObserver`, for the reason
   * `hour-bands/list.test.ts` gives: only TanStack Query itself can show that
   * a failed refetch keeps the cached rows.
   */
  const wasServer = environmentManager.isServer();
  const good = answerOf(PILOT_TYPES);
  const miscounted: ShiftTypesAnswer = { ...good, count: 2 };
  let client: QueryClient;
  let unsubscribes: (() => void)[];
  let pilot: ShiftTypesSnapshot;

  beforeAll(async () => {
    environmentManager.setIsServer(() => false);
    pilot = await snapshotOf(PILOT_TYPES);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  beforeEach(() => {
    client = new QueryClient();
    unsubscribes = [];
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
  });

  function answeringInTurn(
    ...answers: ShiftTypesAnswer[]
  ): ShiftTypesTable & { readonly calls: () => number } {
    let calls = 0;

    return {
      calls: () => calls,
      select() {
        const answer = answers[Math.min(calls, answers.length - 1)];

        calls += 1;

        return Promise.resolve(answer as ShiftTypesAnswer);
      },
    };
  }

  function observe(table: () => ShiftTypesTable) {
    const observer = new QueryObserver(client, { ...shiftTypesQueryOptions(table), retryDelay: 0 });

    unsubscribes.push(observer.subscribe(() => undefined));

    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    });

    return observer.getCurrentResult();
  }

  it("keeps the key and the cache bound", () => {
    const options = shiftTypesQueryOptions(() => answeringInTurn(good));

    expect(options.queryKey).toEqual(SHIFT_TYPES_LIST_KEY);
    expect(options.staleTime).toBe(SHIFT_TYPES_READ_STALE_MS);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(1);
    expect(options.retryDelay).toBe(1000);
  });

  it('pulses while the first read is in flight and says nothing', () => {
    const observer = observe(() => answeringInTurn(good));

    expect(shiftTypesSurfaceStateOf(observer.getCurrentResult())).toEqual({
      snapshot: null,
      refusal: null,
      loading: true,
    });
  });

  it('draws a first answer', async () => {
    const result = await settled(observe(() => answeringInTurn(good)));

    expect(shiftTypesSurfaceStateOf(result)).toEqual({ snapshot: pilot, refusal: null, loading: false });
  });

  it('retries an unavailable first read once, then shows the message and no rows', async () => {
    const table = answeringInTurn(miscounted);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(result.status).toBe('error');
    expect(shiftTypesSurfaceStateOf(result)).toEqual({
      snapshot: null,
      refusal: SHIFT_TYPES_UNAVAILABLE,
      loading: false,
    });
  });

  it('keeps the rows beside the message when a refetch fails, retried once', async () => {
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);

    await settled(observer);
    await client.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY });
    const result = await settled(observer);

    expect(table.calls()).toBe(3);
    expect(result.isError).toBe(true);
    expect(shiftTypesSurfaceStateOf(result)).toEqual({
      snapshot: pilot,
      refusal: SHIFT_TYPES_UNAVAILABLE,
      loading: false,
    });
  });

  it('hides the edit form, naming nothing, when a refetch fails over good rows', async () => {
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);

    await settled(observer);
    expect(shiftTypeFormStateOf(shiftTypesSurfaceStateOf(observer.getCurrentResult()), 'pilot-dan').type).not.toBeNull();
    await client.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY });
    const state = shiftTypesSurfaceStateOf(await settled(observer));

    expect(state.snapshot).toEqual(pilot);
    expect(shiftTypeFormStateOf(state, 'pilot-dan')).toEqual({ type: null, refusal: null });
  });

  it('settles as a success when a transient failure is followed by an answer', async () => {
    const table = answeringInTurn(miscounted, good);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(result.status).toBe('success');
  });

  it('rejects when the table cannot even be built', async () => {
    const result = await settled(
      observe(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    );

    expect(shiftTypesSurfaceStateOf(result).refusal).toBe(SHIFT_TYPES_UNAVAILABLE);
  });

  it('says why rather than pulsing while paused offline', () => {
    onlineManager.setOnline(false);
    const result = observe(() => answeringInTurn(good)).getCurrentResult();

    expect(result.fetchStatus).toBe(SHIFT_TYPES_FETCH_PAUSED);
    expect(shiftTypesSurfaceStateOf(result)).toEqual({
      snapshot: null,
      refusal: SHIFT_TYPES_UNAVAILABLE,
      loading: false,
    });
  });

  it('never pulses a skeleton beside a message', () => {
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', SHIFT_TYPES_FETCH_PAUSED]) {
          for (const data of [undefined, pilot]) {
            const state = shiftTypesSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });

  it('names the read failure through its own key', () => {
    expect(shiftTypesMessageKey(SHIFT_TYPES_UNAVAILABLE)).toBe('rotation.shiftTypes.error.unavailable');
  });
});
