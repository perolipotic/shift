import { describe, expect, it, vi } from 'vitest';

import { hourBandDisplayRowsOf, partitionBarOf, type HourBandRow } from '@/hour-bands/list';

/**
 * THE DOMAIN IS THE ONLY IMPLEMENTATION (AD-7), proved rather than asserted.
 *
 * `@shift/domain` is replaced here by one whose answers are deliberately
 * WRONG — a window, a duration, a midnight flag and a partition no correct
 * derivation could produce from the band given. So a `list.ts` that
 * recomputed any of them itself, however correctly, shows the right value and
 * fails here; only a module that reads the domain's answer verbatim passes.
 */

vi.mock('@shift/domain', () => ({
  MINUTES_PER_DAY: 1440,
  deriveHourBands: () => [
    {
      bandId: 'only',
      startMinute: 60,
      endMinute: 120,
      durationMinutes: 777,
      crossesMidnight: true,
    },
  ],
  partitionOfDay: () => ({
    segments: [
      { fromMinute: 0, toMinute: 360, bandId: 'only' },
      { fromMinute: 360, toMinute: 1440, bandId: null },
    ],
    coveredMinutes: 360,
  }),
}));

const ONLY: HourBandRow = {
  id: 'only',
  organizationId: '00000000-0000-4000-8000-000000000001',
  name: 'Jedini',
  startMinute: 420,
};

describe('the web tree derives nothing a band has', () => {
  it('shows the window, duration and midnight flag the domain returned', () => {
    const [row] = hourBandDisplayRowsOf([ONLY]);

    expect(row?.window).toBe('01:00–02:00');
    expect(row?.durationMinutes).toBe(777);
    expect(row?.crossesMidnight).toBe(true);
  });

  it('draws the partition the domain returned, and its coverage', () => {
    const bar = partitionBarOf([ONLY]);

    expect(bar.segments.map((segment) => segment.name)).toEqual(['Jedini', null]);
    expect(bar.segments.map((segment) => segment.widthPercent)).toEqual([25, 75]);
    expect(bar.coveredMinutes).toBe(360);
    expect(bar.uncoveredMinutes).toBe(1080);
  });
});
