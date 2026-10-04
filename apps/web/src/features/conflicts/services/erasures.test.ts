import { describe, expect, it, vi } from 'vitest';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  ERASURES_UNAVAILABLE,
  RECHECK_CHANGED,
  RECHECK_PROCEED,
  erasureDialogIdsOf,
  erasuresOutcomeOf,
  isoInstantOf,
  latestInstantOf,
  recheckOf,
  type ErasureRow,
} from '@/features/conflicts/services/erasures';
import { instantMicrosOf } from '@/features/rotation/services/list';

/**
 * Story 5.5b's surface-neutral pieces, executed (AD-15). The diff and the
 * rows are executed over real snapshots by the two surfaces' own suites:
 * `features/rotation/services/erasures.test.ts` and
 * `features/calendar/services/roster-erasures.test.ts`.
 */

describe('isoInstantOf', () => {
  it.each([
    0,
    1,
    1_788_000_000_000_001,
    // A leap day, a year end and a century leap year.
    Date.UTC(2028, 1, 29, 23, 59, 59) * 1000 + 999_999,
    Date.UTC(2026, 11, 31, 23, 59, 59) * 1000,
    Date.UTC(2000, 1, 29, 12, 0, 0) * 1000 + 42,
  ])('writes %i so that the calendar reads the very same instant back', (micros) => {
    expect(instantMicrosOf(isoInstantOf(micros))).toBe(micros);
  });

  it('writes the database\'s shape, in UTC', () => {
    expect(isoInstantOf(Date.UTC(2026, 10, 6, 8, 0, 0) * 1000 + 1)).toBe('2026-11-06T08:00:00.000001Z');
  });

  it('refuses what is not an instant', () => {
    expect(() => isoInstantOf(-1)).toThrow(RangeError);
    expect(() => isoInstantOf(1.5)).toThrow(RangeError);
  });
});

describe('latestInstantOf', () => {
  it('takes the latest of every stamp and every override, and 0 for none', () => {
    const snapshot = {
      assignmentStamps: [{ teamId: 'a', effectiveFrom: '2026-09-01', createdAt: 5 }],
      overrides: [{ createdAt: '1970-01-01T00:00:00.000007Z', confirmedAt: null }],
      rosterOverrides: [{ createdAt: '1970-01-01T00:00:00.000006Z' }],
    } as unknown as CalendarSnapshot;

    expect(latestInstantOf(snapshot)).toBe(7);
    expect(latestInstantOf({ assignmentStamps: [], overrides: [], rosterOverrides: [] } as unknown as CalendarSnapshot)).toBe(0);
  });
});

describe('recheckOf', () => {
  const rows = [{ key: 'one' }, { key: 'two' }] as unknown as readonly ErasureRow[];

  it('proceeds over the same conflicts as shown, or none any more', () => {
    expect(recheckOf(rows, [...rows].reverse())).toBe(RECHECK_PROCEED);
    expect(recheckOf(rows, [])).toBe(RECHECK_PROCEED);
  });

  it('shows the list again when it changed', () => {
    expect(recheckOf(rows, rows.slice(1))).toBe(RECHECK_CHANGED);
    expect(recheckOf(rows, [...rows, { key: 'three' } as unknown as ErasureRow])).toBe(RECHECK_CHANGED);
  });
});

describe('erasuresOutcomeOf', () => {
  it('refuses the whole check on a RangeError, logged, and rethrows anything else', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      erasuresOutcomeOf(() => {
        throw new RangeError('untrusted');
      }),
    ).toEqual({ ok: false, code: ERASURES_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(ERASURES_UNAVAILABLE, expect.any(RangeError));
    expect(() =>
      erasuresOutcomeOf(() => {
        throw new TypeError('a bug');
      }),
    ).toThrow(TypeError);
    expect(erasuresOutcomeOf(() => [])).toEqual({ ok: true, rows: [] });
    logged.mockRestore();
  });
});

describe('erasureDialogIdsOf', () => {
  it('derives the three ids from the surface\'s prefix', () => {
    expect(erasureDialogIdsOf('x')).toEqual({ title: 'x-title', lede: 'x-lede', kept: 'x-kept' });
  });
});
