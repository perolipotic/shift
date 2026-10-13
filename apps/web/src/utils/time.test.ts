import { describe, expect, it } from 'vitest';

import { durationValuesOf, minuteOfTime } from '@/utils/time';

describe('minuteOfTime', () => {
  it('parses a stored time and an entered one into the same minute', () => {
    expect(minuteOfTime('07:00:00')).toBe(420);
    expect(minuteOfTime('07:00')).toBe(420);
    expect(minuteOfTime('00:00')).toBe(0);
    expect(minuteOfTime('23:59:00')).toBe(1439);
    for (const refused of ['24:00', '07:60', '07:00:30', '7:00', '', 'nonsense']) {
      expect(minuteOfTime(refused), refused).toBeNull();
    }
  });
});

describe('durationValuesOf', () => {
  it('splits minutes into whole hours and the minutes left', () => {
    expect(durationValuesOf(0)).toEqual({ hours: 0, minutes: 0 });
    expect(durationValuesOf(45)).toEqual({ hours: 0, minutes: 45 });
    expect(durationValuesOf(90)).toEqual({ hours: 1, minutes: 30 });
    expect(durationValuesOf(1440)).toEqual({ hours: 24, minutes: 0 });
  });
});
