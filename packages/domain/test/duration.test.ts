import { describe, expect, it } from 'vitest';

import {
  MINUTES_PER_DAY,
  deriveShiftTimes,
  shiftDurationOn,
  shiftTypeVersionOn,
  type ShiftType,
  type ShiftTypeVersion,
} from '../src/index.js';
import {
  PILOT_SHIFT_TYPES,
  PILOT_SHIFT_TYPE_VERSIONS,
  SEEDED_EFFECTIVE_FROM,
  UJ5_SHIFT_TYPES,
  UJ5_SHIFT_TYPE_VERSIONS,
  at,
} from './fixtures.js';

/**
 * Story 2.2a — the shift-type duration rule and version selection (CAP-7,
 * AD-2, Q7, Q9). Node environment, no browser. Every domain row of the spec's
 * I/O matrix is asserted here, over both fixtures.
 */

const FIXTURES = [
  { fixture: 'pilot', types: PILOT_SHIFT_TYPES, versions: PILOT_SHIFT_TYPE_VERSIONS },
  { fixture: 'UJ-5', types: UJ5_SHIFT_TYPES, versions: UJ5_SHIFT_TYPE_VERSIONS },
] as const;

const versionsOf = (
  versions: readonly ShiftTypeVersion[],
  type: ShiftType,
): readonly ShiftTypeVersion[] => versions.filter((version) => version.shiftTypeId === type.id);

describe('deriveShiftTimes', () => {
  it.each([
    ['night', at(19), at(7), 720, true],
    ['day', at(7), at(19), 720, false],
    ['24 h', at(7), at(7), 1440, true],
    ['24 h at midnight', 0, 0, 1440, false],
    ['UJ-5 night', at(22), at(6), 480, true],
    ['ending exactly at midnight', at(19), 0, 300, false],
    ['one minute', at(12), at(12, 1), 1, false],
    ['one minute short of a day', at(12, 1), at(12), 1439, true],
  ] as const)('derives the %s span', (_label, start, end, durationMinutes, crossesMidnight) => {
    expect(deriveShiftTimes(start, end)).toEqual({
      startMinute: start,
      endMinute: end,
      durationMinutes,
      crossesMidnight,
    });
  });

  it.each(FIXTURES)('derives every $fixture working type as the seed describes it', ({ fixture, versions }) => {
    const derived = versions.map((version) => ({
      id: version.shiftTypeId,
      ...deriveShiftTimes(version.startMinute, version.endMinute),
    }));
    expect(derived).toEqual(
      fixture === 'pilot'
        ? [
            { id: 'pilot-dan', startMinute: at(7), endMinute: at(19), durationMinutes: 720, crossesMidnight: false },
            { id: 'pilot-noc', startMinute: at(19), endMinute: at(7), durationMinutes: 720, crossesMidnight: true },
          ]
        : [
            { id: 'uj5-jutarnja', startMinute: at(6), endMinute: at(14), durationMinutes: 480, crossesMidnight: false },
            { id: 'uj5-popodnevna', startMinute: at(14), endMinute: at(22), durationMinutes: 480, crossesMidnight: false },
            { id: 'uj5-nocna', startMinute: at(22), endMinute: at(6), durationMinutes: 480, crossesMidnight: true },
          ],
    );
  });
});

describe('shiftDurationOn', () => {
  it.each(FIXTURES)(
    'gives every $fixture type its duration on a seeded date, and a non-working one 0',
    ({ types, versions }) => {
      for (const type of types) {
        const own = versionsOf(versions, type);
        const duration = shiftDurationOn(type, own, '2026-09-25');
        if (type.isWorking) {
          expect(own, `${type.id} has no seeded version`).toHaveLength(1);
          expect(duration, type.id).toBe(
            deriveShiftTimes(own[0]!.startMinute, own[0]!.endMinute).durationMinutes,
          );
        } else {
          expect(own, `non-working ${type.id} carries a version`).toEqual([]);
          expect(duration, type.id).toBe(0);
        }
      }
    },
  );

  it('answers null for a working type before its first version, and invents no times', () => {
    const [dan] = PILOT_SHIFT_TYPES;
    expect(shiftDurationOn(dan!, versionsOf(PILOT_SHIFT_TYPE_VERSIONS, dan!), '2019-12-31')).toBeNull();
    expect(shiftDurationOn(dan!, [], '2026-09-25')).toBeNull();
  });

  it('refuses a version on a non-working type, and a version of another type', () => {
    const slobodno = PILOT_SHIFT_TYPES[2]!;
    const dan = PILOT_SHIFT_TYPES[0]!;
    const planted = { shiftTypeId: slobodno.id, effectiveFrom: '2026-01-01', startMinute: 0, endMinute: 60 };

    expect(() => shiftDurationOn(slobodno, [planted], '2026-09-25')).toThrow(RangeError);
    expect(() => shiftDurationOn(slobodno, [planted], '2026-09-25')).toThrow(/pilot-slobodno/);
    expect(() => shiftDurationOn(dan, PILOT_SHIFT_TYPE_VERSIONS, '2026-09-25')).toThrow(/pilot-noc/);
  });
});

describe('shiftTypeVersionOn', () => {
  const first: ShiftTypeVersion = {
    shiftTypeId: 'pilot-noc',
    effectiveFrom: SEEDED_EFFECTIVE_FROM,
    startMinute: at(19),
    endMinute: at(7),
  };
  const corrected: ShiftTypeVersion = {
    shiftTypeId: 'pilot-noc',
    effectiveFrom: '2026-10-01',
    startMinute: at(20),
    endMinute: at(8),
  };

  it('selects the version with the greatest effectiveFrom on or before the date', () => {
    for (const versions of [
      [first, corrected],
      [corrected, first],
    ]) {
      expect(shiftTypeVersionOn(versions, '2019-12-31'), 'a date before 2020').toBeNull();
      expect(shiftTypeVersionOn(versions, '2020-01-01')).toBe(first);
      expect(shiftTypeVersionOn(versions, '2026-09-30')).toBe(first);
      expect(shiftTypeVersionOn(versions, '2026-10-01')).toBe(corrected);
      expect(shiftTypeVersionOn(versions, '2031-02-28')).toBe(corrected);
    }
    expect(shiftTypeVersionOn([], '2026-10-01')).toBeNull();
  });

  it('leaves earlier dates on the old times after a correction from today', () => {
    // The time-correction row: appending a version rewrites no date before it.
    const today = '2026-09-25';
    const correction: ShiftTypeVersion = { ...corrected, effectiveFrom: today };
    const before = shiftTypeVersionOn([first], '2026-09-24');

    expect(shiftTypeVersionOn([first, correction], '2026-09-24')).toEqual(before);
    expect(shiftTypeVersionOn([first, correction], today)).toBe(correction);
  });

  it('shows a rename on every date while each date keeps its own times', () => {
    // AC 3 (AD-2, CAP-7): the name is current-state on the type, the times
    // versioned, so a type renamed after a correction reads its new name on a
    // date the old times still govern.
    const renamed: ShiftType = { id: 'pilot-noc', name: 'renamed', isWorking: true };
    const versions = [first, corrected];
    const read = (date: string) => {
      const version = shiftTypeVersionOn(versions, date);
      return { name: renamed.name, startMinute: version?.startMinute, endMinute: version?.endMinute };
    };

    expect(read('2026-09-30')).toEqual({ name: 'renamed', startMinute: at(19), endMinute: at(7) });
    expect(read('2026-10-01')).toEqual({ name: 'renamed', startMinute: at(20), endMinute: at(8) });
  });

  it.each(FIXTURES)('finds each $fixture working type its seeded version on any date since 2020', ({ types, versions }) => {
    for (const type of types.filter((candidate) => candidate.isWorking)) {
      const own = versionsOf(versions, type);
      expect(shiftTypeVersionOn(own, '2019-12-31'), type.id).toBeNull();
      for (const date of ['2020-01-01', '2024-02-29', '2026-09-25', '2099-12-31']) {
        expect(shiftTypeVersionOn(own, date), `${type.id} on ${date}`).toBe(own[0]);
      }
    }
  });

  it.each([
    ['a date with no padding', '2026-9-25'],
    ['a timestamp', '2026-09-25T00:00:00Z'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-09-00'],
    ['30 February', '2024-02-30'],
    ['29 February in a common year', '2026-02-29'],
    ['29 February in 1900', '1900-02-29'],
    ['an empty string', ''],
  ] as const)('throws a RangeError naming %s', (_label, date) => {
    expect(() => shiftTypeVersionOn([first], date)).toThrow(RangeError);
    expect(() => shiftTypeVersionOn([first], date)).toThrow(JSON.stringify(date));
    const malformed = { ...corrected, effectiveFrom: date };
    expect(() => shiftTypeVersionOn([first, malformed], '2026-09-25')).toThrow(JSON.stringify(date));
    // Both branches of shiftDurationOn check the date, the non-working one too.
    const slobodno = PILOT_SHIFT_TYPES[2]!;
    const dan = PILOT_SHIFT_TYPES[0]!;
    expect(() => shiftDurationOn(slobodno, [], date)).toThrow(RangeError);
    expect(() => shiftDurationOn(slobodno, [], date)).toThrow(JSON.stringify(date));
    expect(() => shiftDurationOn(dan, versionsOf(PILOT_SHIFT_TYPE_VERSIONS, dan), date)).toThrow(
      JSON.stringify(date),
    );
  });

  it('throws a RangeError naming both types when the versions belong to more than one', () => {
    // Otherwise a mixed array would answer another type's times, or report two
    // types' versions on one date as a duplicate.
    const [dan, noc] = PILOT_SHIFT_TYPE_VERSIONS as [ShiftTypeVersion, ShiftTypeVersion];
    for (const mixed of [
      [dan, noc],
      [noc, dan],
    ]) {
      expect(() => shiftTypeVersionOn(mixed, '2026-09-25')).toThrow(RangeError);
      expect(() => shiftTypeVersionOn(mixed, '2026-09-25')).toThrow(/pilot-dan[\s\S]*pilot-noc|pilot-noc[\s\S]*pilot-dan/);
      expect(() => shiftTypeVersionOn(mixed, '2026-09-25')).not.toThrow(/two versions/);
    }
    const other = { ...corrected, shiftTypeId: 'pilot-dan' };
    expect(() => shiftTypeVersionOn([first, other], '2019-01-01'), 'only a selected version was checked').toThrow(
      /pilot-dan/,
    );
  });

  it.each([
    ['a start of 1440', { startMinute: 1440 }, '1440'],
    ['a start of -1', { startMinute: -1 }, '-1'],
    ['an end of 7.5', { endMinute: 7.5 }, '7.5'],
    ['an end of NaN', { endMinute: Number.NaN }, 'NaN'],
  ] as const)('throws a RangeError for %s on a version that is not the one selected', (_label, breach, offender) => {
    // The later version is not in effect on 2026-09-25, so only a check of
    // every given version finds it.
    const malformed: ShiftTypeVersion = { ...corrected, ...breach };
    expect(() => shiftTypeVersionOn([first, malformed], '2026-09-25')).toThrow(RangeError);
    expect(() => shiftTypeVersionOn([first, malformed], '2026-09-25')).toThrow(offender);
    expect(() => shiftTypeVersionOn([first, malformed], '2026-09-25')).toThrow(/2026-10-01/);
  });

  it('admits leap days that exist', () => {
    expect(shiftTypeVersionOn([first], '2024-02-29')).toBe(first);
    // 2000 is a leap year (divisible by 400); it precedes the version, so null.
    expect(shiftTypeVersionOn([first], '2000-02-29')).toBeNull();
  });

  it('throws a RangeError naming the date when two versions share it', () => {
    const twin = { ...corrected, effectiveFrom: SEEDED_EFFECTIVE_FROM };
    expect(() => shiftTypeVersionOn([first, twin], '2026-09-25')).toThrow(RangeError);
    expect(() => shiftTypeVersionOn([first, twin], '2026-09-25')).toThrow(SEEDED_EFFECTIVE_FROM);
  });
});

describe('the duration invariant, over randomized times', () => {
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

  it('keeps every duration in 1–1440, and crosses midnight exactly when 0 < end <= start', () => {
    const random = prng(20260925);

    for (let run = 0; run < 2000; run += 1) {
      const start = Math.floor(random() * MINUTES_PER_DAY);
      // One run in eight lands on a boundary the uniform draw would rarely hit.
      const pick = random();
      const end =
        pick < 0.0625 ? start : pick < 0.125 ? 0 : Math.floor(random() * MINUTES_PER_DAY);
      const times = deriveShiftTimes(start, end);
      const label = `run ${run}: ${start}–${end}`;

      expect(times.durationMinutes, label).toBeGreaterThanOrEqual(1);
      expect(times.durationMinutes, label).toBeLessThanOrEqual(MINUTES_PER_DAY);
      expect((start + times.durationMinutes) % MINUTES_PER_DAY, `${label} ends elsewhere`).toBe(end);
      expect(times.crossesMidnight, label).toBe(end > 0 && end <= start);
    }
  });
});

describe('the preconditions the schema enforces are re-checked, not assumed', () => {
  it.each([
    ['a start of -1', -1, 0, '-1'],
    ['a start of 1440', 1440, 0, '1440'],
    ['an end of 1440', 0, 1440, '1440'],
    ['a start of 7.5', 7.5, 0, '7.5'],
    ['an end of NaN', 0, Number.NaN, 'NaN'],
  ] as const)('throws a RangeError naming the value for %s', (_label, start, end, offender) => {
    expect(() => deriveShiftTimes(start, end)).toThrow(RangeError);
    expect(() => deriveShiftTimes(start, end)).toThrow(offender);
  });

  it('admits the edges, 0 and 1439', () => {
    expect(deriveShiftTimes(0, 1439)).toEqual({
      startMinute: 0,
      endMinute: 1439,
      durationMinutes: 1439,
      crossesMidnight: false,
    });
    expect(deriveShiftTimes(1439, 0).durationMinutes).toBe(1);
  });
});
