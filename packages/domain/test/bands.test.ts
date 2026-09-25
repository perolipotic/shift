import { describe, expect, it } from 'vitest';

import {
  MINUTES_PER_DAY,
  deriveHourBands,
  partitionOfDay,
  type DayPartition,
  type HourBand,
} from '../src/index.js';
import { PILOT_HOUR_BANDS, UJ5_HOUR_BANDS, at } from './fixtures.js';

/**
 * Story 2.1a — the hour-band rule (CAP-3, Q7, Q9). Node environment, no
 * browser. Every domain row of the spec's I/O matrix is asserted here.
 */

/** The partition's invariants: ordered, contiguous, 0 to 1440, nothing empty. */
function expectTiles(partition: DayPartition): void {
  const { segments } = partition;
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0]?.fromMinute).toBe(0);
  expect(segments.at(-1)?.toMinute).toBe(MINUTES_PER_DAY);
  for (const [index, segment] of segments.entries()) {
    expect(segment.toMinute, `segment ${index} is empty or reversed`).toBeGreaterThan(
      segment.fromMinute,
    );
    if (index > 0) {
      expect(segment.fromMinute, `gap or overlap before segment ${index}`).toBe(
        segments[index - 1]?.toMinute,
      );
    }
  }
}

const sumOfDurations = (bands: readonly HourBand[]): number =>
  deriveHourBands(bands).reduce((total, window) => total + window.durationMinutes, 0);

describe('deriveHourBands', () => {
  it('derives the pilot: 07:00–19:00 and 19:00–07:00, 720 minutes each, the second crossing', () => {
    expect(deriveHourBands(PILOT_HOUR_BANDS)).toEqual([
      {
        bandId: 'pilot-dan',
        startMinute: at(7),
        endMinute: at(19),
        durationMinutes: 720,
        crossesMidnight: false,
      },
      {
        bandId: 'pilot-noc',
        startMinute: at(19),
        endMinute: at(7),
        durationMinutes: 720,
        crossesMidnight: true,
      },
    ]);
  });

  it('derives UJ-5 through the same path: three 480-minute windows, 21:00 crossing', () => {
    // CAP-3: three bands, three windows, and nothing in the code knows the count.
    expect(deriveHourBands(UJ5_HOUR_BANDS)).toEqual([
      {
        bandId: 'uj5-jutro',
        startMinute: at(5),
        endMinute: at(13),
        durationMinutes: 480,
        crossesMidnight: false,
      },
      {
        bandId: 'uj5-popodne',
        startMinute: at(13),
        endMinute: at(21),
        durationMinutes: 480,
        crossesMidnight: false,
      },
      {
        bandId: 'uj5-noc',
        startMinute: at(21),
        endMinute: at(5),
        durationMinutes: 480,
        crossesMidnight: true,
      },
    ]);
  });

  it('gives a single band the whole day, crossing midnight when it starts after 00:00', () => {
    expect(deriveHourBands([{ id: 'only', name: 'x', startMinute: at(7) }])).toEqual([
      {
        bandId: 'only',
        startMinute: at(7),
        endMinute: at(7),
        durationMinutes: 1440,
        crossesMidnight: true,
      },
    ]);
  });

  it('gives a single band at 00:00 the whole day without crossing midnight', () => {
    expect(deriveHourBands([{ id: 'only', name: 'x', startMinute: 0 }])).toEqual([
      { bandId: 'only', startMinute: 0, endMinute: 0, durationMinutes: 1440, crossesMidnight: false },
    ]);
  });

  it('does not cross midnight when a band ends exactly at 00:00', () => {
    const windows = deriveHourBands([
      { id: 'a', name: 'a', startMinute: 0 },
      { id: 'b', name: 'b', startMinute: at(12) },
    ]);
    expect(windows.map((window) => window.crossesMidnight)).toEqual([false, false]);
    expect(windows[1]?.endMinute).toBe(0);
  });

  it('derives nothing from zero bands', () => {
    expect(deriveHourBands([])).toEqual([]);
  });

  it('sorts unsorted input, and leaves the input untouched', () => {
    const unsorted: HourBand[] = [PILOT_HOUR_BANDS[1]!, PILOT_HOUR_BANDS[0]!];
    const before = [...unsorted];

    expect(deriveHourBands(unsorted)).toEqual(deriveHourBands(PILOT_HOUR_BANDS));
    expect(partitionOfDay(unsorted)).toEqual(partitionOfDay(PILOT_HOUR_BANDS));
    expect(unsorted).toEqual(before);
  });

  it('reads no name: renaming every band changes no derived value', () => {
    const renamed = UJ5_HOUR_BANDS.map((band) => ({ ...band, name: 'same' }));
    expect(deriveHourBands(renamed)).toEqual(deriveHourBands(UJ5_HOUR_BANDS));
  });
});

describe('partitionOfDay', () => {
  it('cuts the pilot day into three segments, the crossing band into two', () => {
    const partition = partitionOfDay(PILOT_HOUR_BANDS);

    expect(partition).toEqual({
      segments: [
        { fromMinute: 0, toMinute: at(7), bandId: 'pilot-noc' },
        { fromMinute: at(7), toMinute: at(19), bandId: 'pilot-dan' },
        { fromMinute: at(19), toMinute: 1440, bandId: 'pilot-noc' },
      ],
      coveredMinutes: 1440,
    });
    expectTiles(partition);
  });

  it('cuts the UJ-5 day into four segments summing to 1440', () => {
    const partition = partitionOfDay(UJ5_HOUR_BANDS);

    expect(partition.segments).toEqual([
      { fromMinute: 0, toMinute: at(5), bandId: 'uj5-noc' },
      { fromMinute: at(5), toMinute: at(13), bandId: 'uj5-jutro' },
      { fromMinute: at(13), toMinute: at(21), bandId: 'uj5-popodne' },
      { fromMinute: at(21), toMinute: 1440, bandId: 'uj5-noc' },
    ]);
    expect(
      partition.segments.reduce((total, s) => total + (s.toMinute - s.fromMinute), 0),
    ).toBe(1440);
    expect(partition.coveredMinutes).toBe(1440);
    expectTiles(partition);
  });

  it('gives a single band at 07:00 two segments, and one at 00:00 exactly one', () => {
    const crossing = partitionOfDay([{ id: 'only', name: 'x', startMinute: at(7) }]);
    expect(crossing).toEqual({
      segments: [
        { fromMinute: 0, toMinute: at(7), bandId: 'only' },
        { fromMinute: at(7), toMinute: 1440, bandId: 'only' },
      ],
      coveredMinutes: 1440,
    });
    expectTiles(crossing);

    const whole = partitionOfDay([{ id: 'only', name: 'x', startMinute: 0 }]);
    expect(whole).toEqual({
      segments: [{ fromMinute: 0, toMinute: 1440, bandId: 'only' }],
      coveredMinutes: 1440,
    });
    expectTiles(whole);
  });

  it('derives a band at 23:59 and two bands one minute apart', () => {
    const lastMinute: HourBand[] = [
      { id: 'a', name: 'a', startMinute: at(7) },
      { id: 'b', name: 'b', startMinute: 1439 },
    ];
    expect(deriveHourBands(lastMinute)).toEqual([
      { bandId: 'a', startMinute: at(7), endMinute: 1439, durationMinutes: 1019, crossesMidnight: false },
      { bandId: 'b', startMinute: 1439, endMinute: at(7), durationMinutes: 421, crossesMidnight: true },
    ]);
    const lastPartition = partitionOfDay(lastMinute);
    expect(lastPartition.segments).toEqual([
      { fromMinute: 0, toMinute: at(7), bandId: 'b' },
      { fromMinute: at(7), toMinute: 1439, bandId: 'a' },
      { fromMinute: 1439, toMinute: 1440, bandId: 'b' },
    ]);
    expectTiles(lastPartition);

    const adjacent: HourBand[] = [
      { id: 'a', name: 'a', startMinute: at(12) },
      { id: 'b', name: 'b', startMinute: at(12, 1) },
    ];
    expect(deriveHourBands(adjacent)).toEqual([
      { bandId: 'a', startMinute: at(12), endMinute: at(12, 1), durationMinutes: 1, crossesMidnight: false },
      { bandId: 'b', startMinute: at(12, 1), endMinute: at(12), durationMinutes: 1439, crossesMidnight: true },
    ]);
    const adjacentPartition = partitionOfDay(adjacent);
    expect(adjacentPartition.segments).toEqual([
      { fromMinute: 0, toMinute: at(12), bandId: 'b' },
      { fromMinute: at(12), toMinute: at(12, 1), bandId: 'a' },
      { fromMinute: at(12, 1), toMinute: 1440, bandId: 'b' },
    ]);
    expectTiles(adjacentPartition);
  });

  it('leaves the whole day as one uncovered segment when there are no bands', () => {
    const partition = partitionOfDay([]);

    expect(partition).toEqual({
      segments: [{ fromMinute: 0, toMinute: 1440, bandId: null }],
      coveredMinutes: 0,
    });
    expectTiles(partition);
  });
});

describe('the partition invariant, over randomized configurations', () => {
  /** mulberry32 — a small seeded PRNG, so a failure reproduces. */
  function prng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('sums durations to 1440 and tiles 0–1440 for 1–12 distinct starts', () => {
    const random = prng(20260925);

    for (let run = 0; run < 500; run += 1) {
      const count = 1 + Math.floor(random() * 12);
      const starts = new Set<number>();
      while (starts.size < count) starts.add(Math.floor(random() * MINUTES_PER_DAY));
      const bands: HourBand[] = [...starts].map((startMinute, index) => ({
        id: `band-${index}`,
        name: `band ${index}`,
        startMinute,
      }));

      const label = `run ${run}: ${[...starts].join(', ')}`;
      expect(sumOfDurations(bands), label).toBe(MINUTES_PER_DAY);

      const partition = partitionOfDay(bands);
      expectTiles(partition);
      expect(partition.coveredMinutes, label).toBe(MINUTES_PER_DAY);
      expect(partition.segments.every((segment) => segment.bandId !== null), label).toBe(true);

      // Each band's segments add up to its own duration, and only a crossing
      // band contributes two.
      for (const window of deriveHourBands(bands)) {
        const own = partition.segments.filter((segment) => segment.bandId === window.bandId);
        expect(own.length, label).toBe(window.crossesMidnight ? 2 : 1);
        expect(
          own.reduce((total, s) => total + (s.toMinute - s.fromMinute), 0),
          label,
        ).toBe(window.durationMinutes);
      }
    }
  });
});

describe('the preconditions the schema enforces are re-checked, not assumed', () => {
  const valid: HourBand = { id: 'valid', name: 'valid', startMinute: at(7) };

  it.each([
    ['a duplicate start', [valid, { id: 'twin', name: 'twin', startMinute: at(7) }], 'twin'],
    ['a start of -1', [valid, { id: 'early', name: 'early', startMinute: -1 }], 'early'],
    ['a start of 1440', [valid, { id: 'late', name: 'late', startMinute: 1440 }], 'late'],
    ['a start of 7.5', [valid, { id: 'half', name: 'half', startMinute: 7.5 }], 'half'],
    ['a start of NaN', [valid, { id: 'nan', name: 'nan', startMinute: Number.NaN }], 'nan'],
  ] as const)('throws a RangeError naming the band for %s', (_label, bands, offender) => {
    for (const derive of [deriveHourBands, partitionOfDay]) {
      expect(() => derive(bands)).toThrow(RangeError);
      expect(() => derive(bands)).toThrow(new RegExp(`\\b${offender}\\b`));
    }
  });

  it('admits the edges, 0 and 1439', () => {
    expect(() =>
      deriveHourBands([
        { id: 'first', name: 'first', startMinute: 0 },
        { id: 'last', name: 'last', startMinute: 1439 },
      ]),
    ).not.toThrow();
  });
});
