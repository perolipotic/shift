import {
  CARRY_OVER_FIRST_YEAR_MAX,
  CARRY_OVER_FIRST_YEAR_MIN,
  CARRY_OVER_MAX_DAYS_MAX,
  carryOverLastDayOf,
  ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD,
  ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD,
  ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD,
  ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD,
  type CarryOverSetting,
} from '@/features/organization/services/snapshot';
import { formatIsoDayMonth } from '@/lib/i18n/format';

/**
 * The carry-over setting as the organization screen enters it (story 13.4).
 *
 * `0057` stores four nullable columns, all four or none: the cap, the expiry
 * day and month, and the first leave year carried into. An empty *Najviše
 * dana*, or `0` (R4.13, PO 2026-11-11), is no carry-over, whatever the other
 * three hold (the column itself stays `>= 1`); otherwise each value
 * is refused HERE, before anything is sent, naming the field it is about.
 */

/** The longest month's days, `1` to `31`: the expiry day's options. The month decides which of them exist. */
export const CARRY_OVER_EXPIRY_DAYS: readonly number[] = Array.from({ length: 31 }, (_, index) => index + 1);

/** A carry-over field the parser refuses, by the snapshot's field name. */
export type CarryOverField =
  | typeof ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD
  | typeof ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD
  | typeof ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD
  | typeof ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD;

/** What the dialog yields: a setting to send (`null` for none), or the field refused. */
export type EnteredCarryOver =
  | { readonly ok: true; readonly value: CarryOverSetting | null }
  | { readonly ok: false; readonly field: CarryOverField };

/** The four entries, as the form holds them. */
export interface CarryOverEntries {
  readonly maxDays: FormDataEntryValue | null;
  readonly expiryDay: FormDataEntryValue | null;
  readonly expiryMonth: FormDataEntryValue | null;
  readonly firstLeaveYear: FormDataEntryValue | null;
}

/** The trimmed text of an entry: `''` for none, `null` for a file. */
function textOf(value: FormDataEntryValue | null): string | null {
  if (value === null) return '';

  return typeof value === 'string' ? value.trim() : null;
}

/**
 * A whole number from `min` to `max`, or `null`. DIGITS ONLY: `Number` would
 * also read `1e1`, `0x10` and `+3`.
 */
function wholeOf(value: FormDataEntryValue | null, min: number, max: number): number | null {
  const text = textOf(value);

  if (text === null || !/^\d+$/.test(text)) return null;

  const parsed = Number(text);

  return parsed >= min && parsed <= max ? parsed : null;
}

/**
 * The setting four entries mean. Empty *Najviše dana*, or zero (`0`, `00`), is
 * `null`, which clears all four. Otherwise, in the dialog's order: a cap from 1 to 32767, a month,
 * a day that month has (February at 28, so 29.02. and 31.06. are refused), and
 * a first leave year from 1 to 9999.
 */
export function enteredCarryOver(entries: CarryOverEntries): EnteredCarryOver {
  const cap = textOf(entries.maxDays);

  if (cap === '' || (cap !== null && /^0+$/.test(cap))) return { ok: true, value: null };

  const maxDays = wholeOf(entries.maxDays, 1, CARRY_OVER_MAX_DAYS_MAX);

  if (maxDays === null) return { ok: false, field: ORGANIZATION_CARRY_OVER_MAX_DAYS_FIELD };

  const expiryMonth = wholeOf(entries.expiryMonth, 1, 12);

  if (expiryMonth === null) return { ok: false, field: ORGANIZATION_CARRY_OVER_EXPIRY_MONTH_FIELD };

  const expiryDay = wholeOf(entries.expiryDay, 1, carryOverLastDayOf(expiryMonth) ?? 0);

  if (expiryDay === null) return { ok: false, field: ORGANIZATION_CARRY_OVER_EXPIRY_DAY_FIELD };

  const firstLeaveYear = wholeOf(entries.firstLeaveYear, CARRY_OVER_FIRST_YEAR_MIN, CARRY_OVER_FIRST_YEAR_MAX);

  if (firstLeaveYear === null) return { ok: false, field: ORGANIZATION_CARRY_OVER_FIRST_YEAR_FIELD };

  return { ok: true, value: { maxDays, expiryMonth, expiryDay, firstLeaveYear } };
}

/** A reference year with no 29 February, for the day and month only; no date is built from it. */
const REFERENCE_YEAR = 2001;

/** Two digits, as an ISO date spells a month or a day. */
const ISO_PART_WIDTH = 2;

/** `30.06.`: the expiry as the card states it, or `null` for a day no month has. */
export function carryOverExpiryLabel(setting: Pick<CarryOverSetting, 'expiryMonth' | 'expiryDay'>): string | null {
  const month = String(setting.expiryMonth).padStart(ISO_PART_WIDTH, '0');
  const day = String(setting.expiryDay).padStart(ISO_PART_WIDTH, '0');

  return formatIsoDayMonth(`${String(REFERENCE_YEAR)}-${month}-${day}`);
}

/**
 * What the card's fact and its save notice interpolate. The year is a STRING:
 * ICU would group a bare number as `2.027`.
 */
export function carryOverFactValues(setting: CarryOverSetting): {
  readonly count: number;
  readonly dayMonth: string;
  readonly year: string;
} {
  return {
    count: setting.maxDays,
    dayMonth: carryOverExpiryLabel(setting) ?? '',
    year: String(setting.firstLeaveYear),
  };
}
