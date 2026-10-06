import { describe, expect, it } from 'vitest';

import {
  monthMovedBy,
  monthNameOf,
  monthShortNameOf,
  monthsOfYear,
  monthStepOfKey,
  pickerMonthAfter,
  sameMonthIn,
  yearOfMonth,
} from '@/utils/month-keys';

const NONE = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };

describe('monthStepOfKey (story 7.4)', () => {
  it('reads PgUp as the month before and PgDn as the month after', () => {
    expect(monthStepOfKey('PageUp', NONE)).toBe(-1);
    expect(monthStepOfKey('PageDown', NONE)).toBe(1);
  });

  it('leaves every other key, and either with a modifier, to the browser', () => {
    expect(monthStepOfKey('ArrowLeft', NONE)).toBeNull();
    expect(monthStepOfKey('Home', NONE)).toBeNull();
    expect(monthStepOfKey('PageUp', { ...NONE, ctrlKey: true })).toBeNull();
    expect(monthStepOfKey('PageDown', { ...NONE, metaKey: true })).toBeNull();
    expect(monthStepOfKey('PageDown', { ...NONE, altKey: true })).toBeNull();
    expect(monthStepOfKey('PageDown', { ...NONE, shiftKey: true })).toBeNull();
  });
});

describe('pickerMonthAfter (story 7.4)', () => {
  it('moves by a month on ← and →, and by a row of four on ↑ and ↓', () => {
    expect(pickerMonthAfter('ArrowLeft', '2026-06', NONE)).toBe('2026-05');
    expect(pickerMonthAfter('ArrowRight', '2026-06', NONE)).toBe('2026-07');
    expect(pickerMonthAfter('ArrowUp', '2026-06', NONE)).toBe('2026-02');
    expect(pickerMonthAfter('ArrowDown', '2026-06', NONE)).toBe('2026-10');
  });

  it('crosses into the year before and after', () => {
    expect(pickerMonthAfter('ArrowRight', '2026-12', NONE)).toBe('2027-01');
    expect(pickerMonthAfter('ArrowLeft', '2026-01', NONE)).toBe('2025-12');
    expect(pickerMonthAfter('ArrowDown', '2026-10', NONE)).toBe('2027-02');
    expect(pickerMonthAfter('ArrowUp', '2026-03', NONE)).toBe('2025-11');
  });

  it('stays put at the bounds of the calendar', () => {
    expect(pickerMonthAfter('ArrowLeft', '0001-01', NONE)).toBe('0001-01');
    expect(pickerMonthAfter('ArrowUp', '0001-03', NONE)).toBe('0001-03');
    expect(pickerMonthAfter('ArrowRight', '9999-12', NONE)).toBe('9999-12');
    expect(pickerMonthAfter('ArrowDown', '9999-09', NONE)).toBe('9999-09');
  });

  it('handles no other key, nor an arrow with a modifier', () => {
    expect(pickerMonthAfter('Enter', '2026-06', NONE)).toBeNull();
    expect(pickerMonthAfter('PageDown', '2026-06', NONE)).toBeNull();
    expect(pickerMonthAfter('ArrowLeft', '2026-06', { ...NONE, altKey: true })).toBeNull();
  });
});

describe('the picker grid (story 7.4)', () => {
  it("lists a year's twelve months, padded at the calendar's first year", () => {
    expect(monthsOfYear(2026)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(monthsOfYear(1)[0]).toBe('0001-01');
    expect(monthsOfYear(9999)[11]).toBe('9999-12');
  });

  it('keeps the month of the year when the year changes', () => {
    expect(sameMonthIn('2026-10', 2025)).toBe('2025-10');
    expect(sameMonthIn('2026-01', 1)).toBe('0001-01');
    expect(yearOfMonth('0001-07')).toBe(1);
    expect(monthMovedBy('2026-10', -13)).toBe('2025-09');
  });

  it('names a month short, and refuses what is not a month', () => {
    expect(monthShortNameOf('2026-03')).toBe('ožu');
    expect(monthShortNameOf('0001-12')).toBe('pro');
    expect(() => monthShortNameOf('2026-13')).toThrow(RangeError);
  });

  it('names a month in full, capitalized, holding its short name', () => {
    expect(monthNameOf('2025-03')).toBe('Ožujak');
    expect(monthNameOf('0001-01')).toBe('Siječanj');
    for (const month of monthsOfYear(2026)) {
      expect(monthNameOf(month).toLocaleLowerCase('hr')).toContain(monthShortNameOf(month));
    }
    expect(() => monthNameOf('2026-13')).toThrow(RangeError);
  });
});
