import { formatIsoDayMonth, formatMonthName } from '@/lib/i18n/format';

/**
 * The leave year's start as the organization screen offers it: a day and a
 * month, chosen side by side (design refresh C).
 *
 * TWO CLOSED LISTS rather than a date picker. A date picker brings a year, which
 * this setting does not have — it recurs every year — and offers the 29th to
 * the 31st, which `0002:106` refuses by SHAPE: a leave year starting on the
 * 30th has no boundary in February. A control that could express them would
 * turn a shape into a refusal the person has to read, so the days stop at 28.
 */

/** The last day a leave year may start on, in any month. */
export const LEAVE_START_LAST_DAY = 28;

const MONTHS_PER_YEAR = 12;

/** A reference year for the month names only; no date is built from it. */
const REFERENCE_YEAR = 2001;

/** The zone the month names are read in, so the device's zone cannot shift one. */
const REFERENCE_ZONE = 'UTC';

/** The middle of the month, far from either edge whatever the zone. */
const REFERENCE_DAY = 15;

/** `1` to `28`. */
export const LEAVE_START_DAYS: readonly number[] = Array.from(
  { length: LEAVE_START_LAST_DAY },
  (_, index) => index + 1,
);

export interface LeaveStartMonth {
  /** `1` to `12`, the value `leave_year_start_month` stores. */
  readonly value: number;
  /** `siječanj` — CLDR's Croatian name, from `formatMonthName`. */
  readonly label: string;
}

/** The twelve months, named in the application's locale. */
export const LEAVE_START_MONTHS: readonly LeaveStartMonth[] = Array.from(
  { length: MONTHS_PER_YEAR },
  (_, index) => ({
    value: index + 1,
    label: formatMonthName(new Date(Date.UTC(REFERENCE_YEAR, index, REFERENCE_DAY)), REFERENCE_ZONE),
  }),
);

/** Two digits, as an ISO date spells a month or a day. */
const ISO_PART_WIDTH = 2;

/**
 * `01.01.` — the leave year's start as the settings page states it (story
 * 7.18), in the binding date shape cut before the year: the setting recurs
 * yearly, so a year is a fact it does not have. Built on the reference year,
 * which is safe because the day is 1 to 28 in every month. `null` for a month
 * or a day no calendar has.
 */
export function leaveYearStartLabel(month: number, day: number): string | null {
  const isoMonth = String(month).padStart(ISO_PART_WIDTH, '0');
  const isoDay = String(day).padStart(ISO_PART_WIDTH, '0');

  return formatIsoDayMonth(`${String(REFERENCE_YEAR)}-${isoMonth}-${isoDay}`);
}
