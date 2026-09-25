import { formatMonthName } from '@/i18n/format';

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
