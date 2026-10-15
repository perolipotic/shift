import { describe, expect, it } from 'vitest';

import { datesFrom, dayAfter } from '@/utils/dates';

describe('the day after a date', () => {
  it('steps across a month, a year and a leap day', () => {
    expect(dayAfter('2026-09-30')).toBe('2026-10-01');
    expect(dayAfter('2026-12-31')).toBe('2027-01-01');
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
    expect(dayAfter('2028-02-29')).toBe('2028-03-01');
  });

  it('throws a RangeError at the end of the calendar and for a non-date', () => {
    expect(() => dayAfter('9999-12-31')).toThrow(RangeError);
    expect(() => dayAfter('2026-02-30')).toThrow(RangeError);
    expect(() => dayAfter('')).toThrow(RangeError);
  });
});

describe('consecutive dates from a date', () => {
  it('lists count dates in order, across a month', () => {
    expect(datesFrom('2026-09-29', 4)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(datesFrom('2026-09-29', 1)).toEqual(['2026-09-29']);
  });

  it('stops short at the end of the calendar rather than throwing', () => {
    expect(datesFrom('9999-12-30', 7)).toEqual(['9999-12-30', '9999-12-31']);
  });

  it('is empty for no count and for a value that is not a calendar date', () => {
    expect(datesFrom('2026-09-29', 0)).toEqual([]);
    expect(datesFrom('2026-09-29', -1)).toEqual([]);
    expect(datesFrom('2026-02-30', 3)).toEqual([]);
  });
});
