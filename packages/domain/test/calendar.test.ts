import { describe, expect, it } from 'vitest';

import { civilDayNumber, dateOfCivilDay } from '../src/calendar.js';

/**
 * `dateOfCivilDay`, the inverse of `civilDayNumber` (story 2.5): the warnings
 * window steps through its dates with it. Both are internal to the package,
 * so they are imported from their module rather than from `index.ts`.
 */

/** Each date, and the date after it, across every leap-year rule and both ends of the range. */
const NEXT_DAY: readonly (readonly [string, string])[] = [
  ['2024-02-28', '2024-02-29'],
  ['2024-02-29', '2024-03-01'],
  ['2023-02-28', '2023-03-01'],
  ['2000-02-28', '2000-02-29'],
  ['2000-02-29', '2000-03-01'],
  ['1900-02-28', '1900-03-01'],
  ['2100-02-28', '2100-03-01'],
  ['2026-12-31', '2027-01-01'],
  ['1969-12-31', '1970-01-01'],
  ['0001-01-01', '0001-01-02'],
  ['9999-12-30', '9999-12-31'],
];

describe('dateOfCivilDay', () => {
  it.each(NEXT_DAY)('round-trips %s and steps to %s', (date, next) => {
    const day = civilDayNumber(date);

    expect(dateOfCivilDay(day)).toBe(date);
    expect(civilDayNumber(dateOfCivilDay(day) ?? '')).toBe(day);
    expect(dateOfCivilDay(day + 1)).toBe(next);
    expect(civilDayNumber(next)).toBe(day + 1);
  });

  it.each(['0001-01-01', '1970-01-01', '2000-02-29', '9999-12-31'])('round-trips %s', (date) => {
    const day = civilDayNumber(date);

    expect(civilDayNumber(dateOfCivilDay(day) ?? '')).toBe(day);
    expect(dateOfCivilDay(day)).toBe(date);
  });

  it('names day 0 as 1970-01-01', () => {
    expect(dateOfCivilDay(0)).toBe('1970-01-01');
  });

  it('returns null just outside years 0001–9999', () => {
    expect(dateOfCivilDay(civilDayNumber('0001-01-01') - 1)).toBeNull();
    expect(dateOfCivilDay(civilDayNumber('9999-12-31') + 1)).toBeNull();
  });
});
