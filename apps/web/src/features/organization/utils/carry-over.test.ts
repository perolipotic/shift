import { beforeAll, describe, expect, it } from 'vitest';

import {
  CARRY_OVER_MAX_DAYS_MAX,
  carryOverLastDayOf,
  ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD,
  ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD,
  ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD,
  ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD,
} from '@/features/organization/services/snapshot';
import {
  CARRY_OVER_EXPIRY_DAYS,
  carryOverExpiryLabel,
  carryOverFactValues,
  enteredCarryOver,
  type CarryOverEntries,
} from '@/features/organization/utils/carry-over';
import { initLocalization, t } from '@/lib/i18n';
import hr from '@/lib/i18n/locales/hr.json';

beforeAll(async () => {
  await initLocalization();
});

/** 5, 30.06., 2027: the I/O matrix's set. */
const SET: CarryOverEntries = { maxDays: '5', expiryDay: '30', expiryMonth: '6', firstLeaveYear: '2027' };

describe('enteredCarryOver (story 13.4)', () => {
  it('reads 5, 30.06. and 2027 as the setting', () => {
    expect(enteredCarryOver(SET)).toEqual({
      ok: true,
      value: { maxDays: 5, expiryMonth: 6, expiryDay: 30, firstLeaveYear: 2027 },
    });
    expect(enteredCarryOver({ ...SET, maxDays: ' 007 ' })).toEqual({
      ok: true,
      value: { maxDays: 7, expiryMonth: 6, expiryDay: 30, firstLeaveYear: 2027 },
    });
  });

  it('reads an empty or zero cap as no carry-over, whatever the other fields hold (PO 2026-11-11)', () => {
    for (const maxDays of ['', '   ', null, '0', ' 0 ', '00']) {
      expect(enteredCarryOver({ ...SET, maxDays })).toEqual({ ok: true, value: null });
      expect(
        enteredCarryOver({ maxDays, expiryDay: '31', expiryMonth: '2', firstLeaveYear: 'abc' }),
      ).toEqual({ ok: true, value: null });
    }
  });

  it.each(['-1', '-0', '2.5', '0.5', '2,5', 'abc', '1e1', '+3', String(CARRY_OVER_MAX_DAYS_MAX + 1), '40000'])(
    'refuses the cap %j, on the cap',
    (maxDays) => {
      expect(enteredCarryOver({ ...SET, maxDays })).toEqual({ ok: false, field: ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD });
    },
  );

  it('takes the cap up to the column maximum', () => {
    expect(enteredCarryOver({ ...SET, maxDays: String(CARRY_OVER_MAX_DAYS_MAX) })).toMatchObject({ ok: true });
    expect(enteredCarryOver({ ...SET, maxDays: new File(['5'], 'five.txt') })).toEqual({
      ok: false,
      field: ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD,
    });
  });

  it.each(['', '0', '13', 'lipanj'])('refuses the month %j, on the month', (expiryMonth) => {
    expect(enteredCarryOver({ ...SET, expiryMonth })).toEqual({
      ok: false,
      field: ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD,
    });
  });

  it.each([
    ['31', '6'],
    ['29', '2'],
    ['31', '4'],
    ['', '6'],
    ['0', '6'],
    ['32', '1'],
  ])('refuses the impossible day %s.%s., on the day', (expiryDay, expiryMonth) => {
    expect(enteredCarryOver({ ...SET, expiryDay, expiryMonth })).toEqual({
      ok: false,
      field: ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD,
    });
  });

  it('takes each month\'s last day, February at 28', () => {
    for (const [day, month] of [['31', '1'], ['28', '2'], ['31', '3'], ['30', '6'], ['31', '12']] as const) {
      expect(enteredCarryOver({ ...SET, expiryDay: day, expiryMonth: month }), `${day}.${month}.`).toMatchObject({
        ok: true,
      });
    }
  });

  it.each(['', '0', '10000', '2027.5', 'abc', null])('refuses the year %j with a cap, on the year', (firstLeaveYear) => {
    expect(enteredCarryOver({ ...SET, firstLeaveYear })).toEqual({
      ok: false,
      field: ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD,
    });
  });

  it('takes the year from 1 to 9999', () => {
    expect(enteredCarryOver({ ...SET, firstLeaveYear: '1' })).toMatchObject({ ok: true });
    expect(enteredCarryOver({ ...SET, firstLeaveYear: '9999' })).toMatchObject({ ok: true });
  });
});

describe('the valid days per month (story 13.4)', () => {
  it('ends each month on its last day, February at 28, as 0057 checks', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(carryOverLastDayOf)).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    for (const month of [0, 13, 2.5]) expect(carryOverLastDayOf(month)).toBeNull();
  });

  it('offers 1 to 31, and the month decides which exist', () => {
    expect(CARRY_OVER_EXPIRY_DAYS).toHaveLength(31);
    expect(CARRY_OVER_EXPIRY_DAYS[0]).toBe(1);
    expect(CARRY_OVER_EXPIRY_DAYS.at(-1)).toBe(31);
  });

  it('states the expiry as the card does', () => {
    expect(carryOverExpiryLabel({ expiryMonth: 6, expiryDay: 30 })).toBe('30.06.');
    expect(carryOverExpiryLabel({ expiryMonth: 2, expiryDay: 28 })).toBe('28.02.');
  });
});

describe('the carry-over copy (story 13.4)', () => {
  it('has its fields, facts and refusal in the resource file', () => {
    const organization = hr.organization as Record<string, unknown> & { error: Record<string, unknown> };
    for (const key of [
      'carryOver',
      'editCarryOver',
      'carryOverMaxDays',
      'carryOverMaxDaysHint',
      'carryOverExpiry',
      'carryOverExpiryDay',
      'carryOverExpiryMonth',
      'carryOverExpiryDayEmpty',
      'carryOverExpiryMonthEmpty',
      'carryOverFirstYear',
      'carryOverFirstYearHint',
      'carryOverFact',
      'carryOverNone',
      'carryOverStatusSet',
      'carryOverStatusNone',
    ]) {
      expect(organization[key], key).toBeTruthy();
    }
    expect(organization.error['carryOver']).toBeTruthy();
    expect(organization['carryOverNone']).toBe('Bez prijenosa.');
  });

  it('states 5, 30.06. and 2027 as the I/O matrix does', () => {
    const values = carryOverFactValues({ maxDays: 5, expiryMonth: 6, expiryDay: 30, firstLeaveYear: 2027 });

    for (const [count, text] of [
      [1, 'Najviše 1 dan. Preneseni dani istječu 30.06., od godine godišnjeg 2027.'],
      [21, 'Najviše 21 dan. Preneseni dani istječu 30.06., od godine godišnjeg 2027.'],
      [5, 'Najviše 5 dana. Preneseni dani istječu 30.06., od godine godišnjeg 2027.'],
    ] as const) {
      expect(t('organization.carryOverFact', { ...values, count })).toBe(text);
    }
    expect(t('organization.carryOverStatusSet', values)).toBe(
      'Prijenos godišnjeg: najviše 5 dana. Preneseni dani istječu 30.06., od godine godišnjeg 2027.',
    );
  });
});
